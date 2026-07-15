if (!globalThis.chrome?.storage?.local) {
  const previewData = {};
  const listeners = [];
  globalThis.chrome = {
    ...(globalThis.chrome || {}),
    storage: {
      local: {
        async get(keys) {
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(wanted.filter((key) => key in previewData).map((key) => [key, structuredClone(previewData[key])]));
        },
        async set(values) {
          const changes = {};
          Object.entries(values).forEach(([key, value]) => { changes[key] = { oldValue: previewData[key], newValue: value }; previewData[key] = structuredClone(value); });
          listeners.forEach((listener) => listener(changes, "local"));
        }
      },
      onChanged: { addListener(listener) { listeners.push(listener); } }
    },
    runtime: { ...(globalThis.chrome?.runtime || {}), openOptionsPage() {} }
  };
}

const $ = (selector) => document.querySelector(selector);
const elements = {
  board: $("#board"), list: $("#list"), empty: $("#empty"), upcoming: $("#upcoming"), search: $("#search"),
  status: $("#filter-status"), source: $("#filter-source"), priority: $("#filter-priority"), detail: $("#detail"), scrim: $("#scrim"), toast: $("#toast")
};
let state = null;
let selectedId = null;
let detailReturnFocus = null;
let selectedContactId = null;
let contactReturnFocus = null;
let selectedInterviewId = null;
let currentView = "board";
let currentSection = "applications";
let profile = {};
let aiConfig = {};

function escapeHTML(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML;
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function dateTimeLabel(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function toDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toISOFromInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function populateSelect(select, values, label) {
  const current = select.value;
  select.innerHTML = `<option value="">All ${label}</option>` + values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
  select.value = current;
}

function filteredApplications() {
  const query = elements.search.value.trim().toLowerCase();
  return state.applications.filter((item) => {
    const text = [item.company, item.role, item.notes, item.location].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (!elements.status.value || item.status === elements.status.value) && (!elements.source.value || item.source === elements.source.value) && (!elements.priority.value || item.priority === elements.priority.value);
  });
}

function cardHTML(item) {
  return `<article class="job-card" draggable="true" data-id="${item.id}" tabindex="0"><div class="card-top"><span class="priority ${item.priority}" title="${item.priority} priority"></span><span class="match-pill">${item.match_score || 0}% match</span></div><h3>${escapeHTML(item.role)}</h3><p>${escapeHTML(item.company)}</p><div class="card-meta"><span>${escapeHTML(item.source)}</span><span>${item.deadline ? `Due ${dateLabel(item.deadline)}` : dateLabel(item.created_at)}</span></div></article>`;
}

function renderBoard(items) {
  elements.board.innerHTML = ApplyOS.APPLICATION_STATUSES.map((status) => {
    const group = items.filter((item) => item.status === status);
    return `<section class="column" data-status="${status}"><div class="column-head"><span>${ApplyOS.STATUS_META[status].label.toUpperCase()}</span><span>${group.length}</span></div><div class="column-cards">${group.map(cardHTML).join("")}</div></section>`;
  }).join("");
  elements.board.querySelectorAll(".job-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openDetail(card.dataset.id); });
    card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.id));
  });
  elements.board.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("dragover"); });
    column.addEventListener("dragleave", () => column.classList.remove("dragover"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault(); column.classList.remove("dragover");
      const id = event.dataTransfer.getData("text/plain");
      const application = state.applications.find((item) => item.id === id);
      if (!application || application.status === column.dataset.status) return;
      if (column.dataset.status === "applied" && !application.applied_at) await ApplyOS.markApplicationApplied(id);
      else await ApplyOS.updateApplication(id, { status: column.dataset.status });
      await load(); toast("Status updated");
    });
  });
}

function renderList(items) {
  elements.list.innerHTML = `<div class="table-row header"><span>ROLE / COMPANY</span><span>SOURCE</span><span>STATUS</span><span>PRIORITY</span><span>DEADLINE</span><span>MATCH</span></div>` + items.map((item) => `<div class="table-row" data-id="${item.id}" tabindex="0"><div><strong>${escapeHTML(item.role)}</strong><span>${escapeHTML(item.company)}</span></div><span>${escapeHTML(item.source)}</span><span class="status-chip">${ApplyOS.STATUS_META[item.status]?.label || item.status}</span><span>${escapeHTML(item.priority)}</span><span>${dateLabel(item.deadline)}</span><span>${item.match_score || 0}%</span></div>`).join("");
  elements.list.querySelectorAll(".table-row[data-id]").forEach((row) => {
    row.addEventListener("click", () => openDetail(row.dataset.id));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") openDetail(row.dataset.id); });
  });
}

function renderUpcoming() {
  const now = Date.now();
  const reminders = state.reminders.filter((item) => !item.completed_at).map((item) => ({ ...item, application: state.applications.find((app) => app.id === item.application_id), kind: "follow-up", at: item.due_at }));
  const deadlines = state.applications.filter((item) => item.deadline && new Date(item.deadline).getTime() >= now - 86400000).map((item) => ({ application: item, kind: "deadline", at: item.deadline }));
  const interviews = state.interviews.filter((item) => !item.completed_at && item.scheduled_at && new Date(item.scheduled_at).getTime() >= now - 86400000).map((item) => ({ ...item, application: state.applications.find((app) => app.id === item.application_id), kind: "interview", at: item.scheduled_at }));
  const items = [...reminders, ...deadlines, ...interviews].filter((item) => item.application).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 8);
  elements.upcoming.innerHTML = items.length ? items.map((item) => `<button class="upcoming-card ${item.kind === "deadline" ? "deadline" : ""}" data-id="${item.application.id}" type="button"><strong>${escapeHTML(item.application.role)}</strong><span>${item.kind === "deadline" ? "Deadline" : item.kind === "interview" ? "Interview" : "Follow-up"} · ${dateLabel(item.at)}</span></button>`).join("") : `<span class="upcoming-card"><strong>Nothing urgent</strong><span>Your next actions will appear here.</span></span>`;
  elements.upcoming.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id)));
}

function contactCardHTML(contact) {
  const applications = contact.application_ids.map((id) => state.applications.find((item) => item.id === id)).filter(Boolean);
  const initials = contact.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return `<article class="contact-card" data-contact-id="${contact.id}" tabindex="0"><div class="contact-card-top"><span class="contact-monogram">${escapeHTML(initials)}</span><span class="relationship-chip">${escapeHTML(titleCase(contact.relationship))}</span></div><h3>${escapeHTML(contact.name)}</h3><p>${escapeHTML([contact.title, contact.company].filter(Boolean).join(" · ") || "Add title and company")}</p><footer><span>${applications.length ? `${applications.length} linked role${applications.length === 1 ? "" : "s"}` : "General network"}</span><span>${contact.next_action_at ? `Next ${dateLabel(contact.next_action_at)}` : "No next action"}</span></footer></article>`;
}

function renderContacts() {
  const query = $("#contact-search").value.trim().toLowerCase();
  const contacts = state.contacts.filter((contact) => [contact.name, contact.title, contact.company, contact.email, contact.notes].join(" ").toLowerCase().includes(query));
  $("#contact-count").textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`;
  $("#contacts-empty").classList.toggle("hidden", state.contacts.length > 0);
  $("#contacts-list").classList.toggle("hidden", state.contacts.length === 0);
  $("#contacts-list").innerHTML = contacts.map(contactCardHTML).join("");
  $("#contacts-list").querySelectorAll(".contact-card").forEach((card) => {
    card.addEventListener("click", () => openContact(card.dataset.contactId));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openContact(card.dataset.contactId); });
  });
}

function render() {
  const items = filteredApplications();
  const active = state.applications.filter((item) => !["rejected", "closed"].includes(item.status)).length;
  const due = state.reminders.filter((item) => !item.completed_at && new Date(item.due_at) <= new Date()).length;
  $("#metric-total").textContent = active;
  $("#metric-due").textContent = due;
  $("#metric-interviews").textContent = state.applications.filter((item) => item.status === "interview").length;
  populateSelect(elements.source, [...new Set(state.applications.map((item) => item.source).filter(Boolean))].sort(), "sources");
  elements.empty.classList.toggle("hidden", state.applications.length > 0);
  elements.board.classList.toggle("hidden", currentView !== "board" || !state.applications.length);
  elements.list.classList.toggle("hidden", currentView !== "list" || !state.applications.length);
  renderBoard(items); renderList(items); renderUpcoming(); renderContacts();
}

async function load() {
  state = await ApplyOS.refreshDueApplications();
  render();
}

function openDetail(id) {
  const item = state.applications.find((application) => application.id === id);
  if (!item) return;
  if (!elements.detail.classList.contains("open")) {
    const active = document.activeElement;
    detailReturnFocus = active instanceof HTMLElement && !elements.detail.contains(active) ? active : null;
  }
  selectedId = id;
  $("#detail-id").value = id; $("#detail-role").value = item.role; $("#detail-company").value = item.company;
  $("#detail-status").value = item.status; $("#detail-priority").value = item.priority; $("#detail-deadline").value = ApplyOS.toDateInput(item.deadline);
  $("#detail-follow-up").value = ApplyOS.toDateInput(item.follow_up_date); $("#detail-notes").value = item.notes || "";
  $("#detail-score").textContent = `${item.match_score || 0}%`; $("#detail-bar").style.width = `${item.match_score || 0}%`;
  $("#detail-skills").textContent = `Matched: ${item.matched_skills?.join(", ") || "No explicit skills yet"}`;
  const highlight = item.suggested_experiences?.[0] || item.missing_skills?.join(", ") || item.suggested_keywords?.slice(0, 6).join(", ") || "No major gaps detected";
  $("#detail-missing").textContent = `Consider highlighting: ${highlight}`;
  $("#detail-url").href = item.url; $("#detail-applied").classList.toggle("hidden", Boolean(item.applied_at));
  $("#draft").classList.add("hidden");
  $("#thank-you").classList.add("hidden");
  $("#interview-form").classList.add("hidden");
  selectedInterviewId = null;
  renderLinkedContacts(item);
  renderInterviews(item);
  $("#ai-output-wrap").classList.add("hidden");
  elements.detail.inert = false; elements.detail.classList.add("open"); elements.detail.setAttribute("aria-hidden", "false"); elements.scrim.classList.remove("hidden");
  $("#detail-role").focus();
}

function applicationOptions(selected = "") {
  return `<option value="">General networking</option>` + state.applications.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHTML(item.company)} · ${escapeHTML(item.role)}</option>`).join("");
}

function linkedContacts(applicationId) {
  return state.contacts.filter((contact) => contact.application_ids.includes(applicationId));
}

function renderLinkedContacts(application) {
  const contacts = linkedContacts(application.id);
  $("#linked-contacts").innerHTML = contacts.length ? contacts.map((contact) => `<div class="linked-contact"><div><strong>${escapeHTML(contact.name)}</strong><span>${escapeHTML([contact.title, contact.email].filter(Boolean).join(" · ") || titleCase(contact.relationship))}</span></div><button data-contact-id="${contact.id}" type="button">Edit</button></div>`).join("") : `<div class="linked-contact"><div><strong>No contacts linked yet</strong><span>Add a recruiter, interviewer, referral, or employee.</span></div></div>`;
  $("#linked-contacts").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { closeDetail(); openContact(button.dataset.contactId); }));
  const draftContact = $("#draft-contact");
  draftContact.innerHTML = `<option value="">Hiring team / no address</option>` + contacts.map((contact) => `<option value="${contact.id}">${escapeHTML(contact.name)}${contact.email ? ` · ${escapeHTML(contact.email)}` : ""}</option>`).join("");
}

function renderInterviews(application) {
  const interviews = state.interviews.filter((item) => item.application_id === application.id).sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0));
  $("#interview-list").innerHTML = interviews.length ? interviews.map((interview) => {
    const contacts = interview.interviewer_contact_ids.map((id) => state.contacts.find((contact) => contact.id === id)).filter(Boolean);
    return `<div class="interview-card"><div><strong>${escapeHTML(titleCase(interview.type))} · ${escapeHTML(dateTimeLabel(interview.scheduled_at))}</strong><span>${escapeHTML([titleCase(interview.format), contacts.map((contact) => contact.name).join(", ")].filter(Boolean).join(" · "))}${interview.next_action ? ` · Next: ${escapeHTML(interview.next_action)}` : ""}</span></div><button data-interview-id="${interview.id}" type="button">Open workspace</button></div>`;
  }).join("") : `<div class="interview-card"><div><strong>No interviews scheduled</strong><span>Add a round to prepare notes and next actions.</span></div></div>`;
  $("#interview-list").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => openInterviewEditor(button.dataset.interviewId)));
}

function openContact(id = null, applicationId = "") {
  const contact = state.contacts.find((item) => item.id === id) || null;
  const active = document.activeElement;
  contactReturnFocus = active instanceof HTMLElement && !$("#contact-detail").contains(active) ? active : null;
  selectedContactId = contact?.id || null;
  $("#contact-id").value = contact?.id || "";
  $("#contact-name").value = contact?.name || "";
  $("#contact-title").value = contact?.title || "";
  $("#contact-company").value = contact?.company || state.applications.find((item) => item.id === applicationId)?.company || "";
  $("#contact-relationship").value = contact?.relationship || "recruiter";
  $("#contact-email").value = contact?.email || "";
  $("#contact-linkedin").value = contact?.linkedin_url || "";
  $("#contact-application").innerHTML = applicationOptions(contact?.application_ids?.[0] || applicationId);
  $("#contact-last").value = ApplyOS.toDateInput(contact?.last_contacted_at);
  $("#contact-next").value = ApplyOS.toDateInput(contact?.next_action_at);
  $("#contact-notes").value = contact?.notes || "";
  $("#delete-contact").classList.toggle("hidden", !contact);
  $("#open-contact-linkedin").classList.toggle("hidden", !contact?.linkedin_url);
  $("#open-contact-linkedin").href = contact?.linkedin_url || "#";
  $("#contact-message").value = contact ? `Hello ${contact.name.split(/\s+/)[0]},\n\nIt was great connecting with you. I wanted to stay in touch regarding opportunities at ${contact.company || "your company"}.\n\nBest,\n${profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || ""}` : "";
  updateContactComposeLinks();
  $("#contact-detail").inert = false; $("#contact-detail").classList.add("open"); $("#contact-detail").setAttribute("aria-hidden", "false"); elements.scrim.classList.remove("hidden");
  $("#contact-name").focus();
}

function closeContact() {
  const detail = $("#contact-detail");
  if (!detail.classList.contains("open")) return;
  const focusTarget = contactReturnFocus?.isConnected ? contactReturnFocus : $("#contact-search");
  if (detail.contains(document.activeElement)) focusTarget?.focus();
  selectedContactId = null; detail.inert = true; detail.classList.remove("open"); detail.setAttribute("aria-hidden", "true");
  if (!elements.detail.classList.contains("open")) elements.scrim.classList.add("hidden");
  contactReturnFocus = null;
}

function openInterviewEditor(id = null) {
  const interview = state.interviews.find((item) => item.id === id) || null;
  selectedInterviewId = interview?.id || null;
  $("#interview-id").value = interview?.id || "";
  $("#interview-type").value = interview?.type || "recruiter_screen";
  $("#interview-format").value = interview?.format || "video";
  $("#interview-scheduled").value = toDateTimeInput(interview?.scheduled_at);
  $("#interview-location").value = interview?.location || "";
  $("#interview-url").value = interview?.meeting_url || "";
  $("#interview-research").value = interview?.company_research || "";
  $("#interview-prep").value = interview?.preparation_notes || "";
  $("#interview-questions").value = interview?.question_notes || "";
  $("#interview-next-action").value = interview?.next_action || "";
  $("#interview-next-date").value = ApplyOS.toDateInput(interview?.next_action_at);
  const contacts = linkedContacts(selectedId);
  $("#interview-contact").innerHTML = `<option value="">Not linked</option>` + contacts.map((contact) => `<option value="${contact.id}">${escapeHTML(contact.name)}</option>`).join("");
  $("#interview-contact").value = interview?.interviewer_contact_ids?.[0] || "";
  $("#delete-interview").classList.toggle("hidden", !interview);
  $("#interview-form").classList.remove("hidden");
  $("#thank-you").classList.add("hidden");
  $("#interview-type").focus();
}

function draftRecipient() {
  return state.contacts.find((contact) => contact.id === $("#draft-contact").value)?.email || "";
}

function setComposeLinks(prefix, draft, recipient) {
  const links = ApplyOS.buildComposeLinks(draft, recipient);
  $(`#${prefix}-gmail`).href = links.gmail;
  $(`#${prefix}-outlook`).href = links.outlook;
  $(`#${prefix}-mailto`).href = links.mailto;
}

function updateDraftComposeLinks() {
  setComposeLinks("compose", { subject: $("#draft-subject").value, body: $("#draft-body").value }, draftRecipient());
}

function updateContactComposeLinks() {
  setComposeLinks("contact", { subject: $("#contact-subject").value, body: $("#contact-message").value }, $("#contact-email").value);
}

function updateThankYouComposeLinks() {
  const email = state.contacts.find((contact) => contact.id === $("#interview-contact").value)?.email || "";
  setComposeLinks("thank-you", { subject: $("#thank-you-subject").value, body: $("#thank-you-body").value }, email);
}

function closeDetail() {
  if (!elements.detail.classList.contains("open")) return;
  const fallback = $("#search");
  const focusTarget = detailReturnFocus?.isConnected && typeof detailReturnFocus.focus === "function" ? detailReturnFocus : fallback;
  if (elements.detail.contains(document.activeElement)) focusTarget?.focus();
  selectedId = null;
  elements.detail.inert = true;
  elements.detail.classList.remove("open");
  elements.detail.setAttribute("aria-hidden", "true");
  elements.scrim.classList.add("hidden");
  detailReturnFocus = null;
}

async function initialize() {
  const [index, activeProfile, config, graphStats] = await Promise.all([ApplyOS.getProfilesIndex(), ApplyOS.getActiveProfile(), ApplyOS.getAIConfig(), ApplyOS.graphStats()]);
  profile = activeProfile; aiConfig = config;
  const profileSelect = $("#active-profile");
  profileSelect.replaceChildren(...index.profiles.map((meta) => { const option = document.createElement("option"); option.value = meta.id; option.textContent = meta.targetRole ? `${meta.name} · ${meta.targetRole}` : meta.name; return option; }));
  profileSelect.value = index.activeId;
  $("#metric-memory").textContent = graphStats.answers;
  $("#studio-status").textContent = aiConfig.enabled ? "LOCALLY ENHANCED" : "READY OFFLINE";
  $("#studio-status").classList.add("on");
  ApplyOS.APPLICATION_STATUSES.forEach((status) => {
    const label = ApplyOS.STATUS_META[status].label;
    elements.status.insertAdjacentHTML("beforeend", `<option value="${status}">${label}</option>`);
    $("#detail-status").insertAdjacentHTML("beforeend", `<option value="${status}">${label}</option>`);
  });
  ApplyOS.CONTACT_RELATIONSHIPS.forEach((relationship) => $("#contact-relationship").insertAdjacentHTML("beforeend", `<option value="${relationship}">${titleCase(relationship)}</option>`));
  ApplyOS.INTERVIEW_TYPES.forEach((type) => $("#interview-type").insertAdjacentHTML("beforeend", `<option value="${type}">${titleCase(type)}</option>`));
  ApplyOS.INTERVIEW_FORMATS.forEach((format) => $("#interview-format").insertAdjacentHTML("beforeend", `<option value="${format}">${titleCase(format)}</option>`));
  await load();
}

[elements.search, elements.status, elements.source, elements.priority].forEach((control) => control.addEventListener(control === elements.search ? "input" : "change", render));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button)); render();
}));
document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
  currentSection = button.dataset.section;
  document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".application-only").forEach((item) => item.classList.toggle("hidden", currentSection !== "applications"));
  $("#contacts-workspace").classList.toggle("hidden", currentSection !== "contacts");
  if (currentSection === "contacts") $("#contact-search").focus();
}));
$("#contact-search").addEventListener("input", renderContacts);
$("#add-contact").addEventListener("click", () => openContact());
$("#contacts-empty-add").addEventListener("click", () => openContact());
$("#add-linked-contact").addEventListener("click", () => { const applicationId = selectedId; closeDetail(); openContact(null, applicationId); });
$("#mock").addEventListener("click", async () => { await ApplyOS.seedMockData(); await load(); toast("Sample applications added"); });
$("#profile").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#active-profile").addEventListener("change", async (event) => { await ApplyOS.setActiveProfile(event.target.value); window.location.reload(); });
$("#close-detail").addEventListener("click", closeDetail);
$("#close-contact").addEventListener("click", closeContact);
elements.scrim.addEventListener("click", () => { closeContact(); closeDetail(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if ($("#contact-detail").classList.contains("open")) closeContact(); else closeDetail(); } });
$("#detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const application = state.applications.find((item) => item.id === selectedId);
  const status = $("#detail-status").value;
  if (status === "applied" && !application.applied_at) await ApplyOS.markApplicationApplied(selectedId);
  await ApplyOS.updateApplication(selectedId, { role: $("#detail-role").value.trim(), company: $("#detail-company").value.trim(), status, priority: $("#detail-priority").value, deadline: $("#detail-deadline").value || null, notes: $("#detail-notes").value.trim() });
  if ($("#detail-follow-up").value !== ApplyOS.toDateInput(application.follow_up_date)) await ApplyOS.rescheduleFollowUp(selectedId, $("#detail-follow-up").value);
  await load(); openDetail(selectedId); toast("Application updated");
});
$("#detail-applied").addEventListener("click", async () => { await ApplyOS.markApplicationApplied(selectedId); await load(); openDetail(selectedId); toast("Applied · follow-ups scheduled for 7 and 14 days"); });
$("#generate-draft").addEventListener("click", () => {
  const application = state.applications.find((item) => item.id === selectedId); if (!application) return;
  const draft = ApplyOS.generateFollowUpDraft(application, profile, $("#draft-type").value); $("#draft-subject").value = draft.subject; $("#draft-body").value = draft.body; updateDraftComposeLinks(); $("#draft").classList.remove("hidden");
});
$("#copy-draft").addEventListener("click", async () => { await navigator.clipboard.writeText(`Subject: ${$("#draft-subject").value}\n\n${$("#draft-body").value}`); toast("Draft copied for manual review"); });
[$("#draft-subject"), $("#draft-body"), $("#draft-contact")].forEach((control) => control.addEventListener(control.tagName === "SELECT" ? "change" : "input", updateDraftComposeLinks));

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const applicationId = $("#contact-application").value;
  const previous = state.contacts.find((item) => item.id === selectedContactId);
  await ApplyOS.upsertContact({
    id: selectedContactId || undefined,
    name: $("#contact-name").value.trim(), title: $("#contact-title").value.trim(), company: $("#contact-company").value.trim(),
    email: $("#contact-email").value.trim(), linkedin_url: $("#contact-linkedin").value.trim(), relationship: $("#contact-relationship").value,
    application_ids: applicationId ? [applicationId] : [], notes: $("#contact-notes").value.trim(),
    last_contacted_at: $("#contact-last").value ? new Date(`${$("#contact-last").value}T12:00:00`).toISOString() : null,
    next_action_at: $("#contact-next").value ? new Date(`${$("#contact-next").value}T12:00:00`).toISOString() : null,
    created_at: previous?.created_at
  });
  await load(); closeContact(); toast("Contact saved");
});
$("#delete-contact").addEventListener("click", async () => { if (!selectedContactId || !confirm("Delete this contact from ApplyOS?")) return; await ApplyOS.deleteContact(selectedContactId); await load(); closeContact(); toast("Contact deleted"); });
[$("#contact-subject"), $("#contact-message"), $("#contact-email")].forEach((control) => control.addEventListener("input", updateContactComposeLinks));

$("#add-interview").addEventListener("click", () => openInterviewEditor());
$("#cancel-interview").addEventListener("click", () => { selectedInterviewId = null; $("#interview-form").classList.add("hidden"); $("#thank-you").classList.add("hidden"); });
$("#interview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await ApplyOS.upsertInterview({
    id: selectedInterviewId || undefined, application_id: selectedId, type: $("#interview-type").value, format: $("#interview-format").value,
    scheduled_at: toISOFromInput($("#interview-scheduled").value), location: $("#interview-location").value.trim(), meeting_url: $("#interview-url").value.trim(),
    interviewer_contact_ids: $("#interview-contact").value ? [$("#interview-contact").value] : [], company_research: $("#interview-research").value.trim(),
    preparation_notes: $("#interview-prep").value.trim(), question_notes: $("#interview-questions").value.trim(), next_action: $("#interview-next-action").value.trim(),
    next_action_at: $("#interview-next-date").value ? new Date(`${$("#interview-next-date").value}T12:00:00`).toISOString() : null
  });
  await load(); openDetail(selectedId); toast("Interview workspace saved");
});
$("#delete-interview").addEventListener("click", async () => { if (!selectedInterviewId || !confirm("Delete this interview workspace?")) return; const applicationId = selectedId; await ApplyOS.deleteInterview(selectedInterviewId); await load(); openDetail(applicationId); toast("Interview deleted"); });
$("#generate-thank-you").addEventListener("click", () => {
  const application = state.applications.find((item) => item.id === selectedId); if (!application) return;
  const interview = state.interviews.find((item) => item.id === selectedInterviewId) || { type: $("#interview-type").value, question_notes: $("#interview-questions").value };
  const contact = state.contacts.find((item) => item.id === $("#interview-contact").value) || {};
  const draft = ApplyOS.generateThankYouDraft(application, interview, profile, contact); $("#thank-you-subject").value = draft.subject; $("#thank-you-body").value = draft.body; updateThankYouComposeLinks(); $("#thank-you").classList.remove("hidden");
});
$("#copy-thank-you").addEventListener("click", async () => { await navigator.clipboard.writeText(`Subject: ${$("#thank-you-subject").value}\n\n${$("#thank-you-body").value}`); toast("Thank-you draft copied"); });
[$("#thank-you-subject"), $("#thank-you-body")].forEach((control) => control.addEventListener("input", updateThankYouComposeLinks));
$("#interview-contact").addEventListener("change", updateThankYouComposeLinks);
async function runAIStudio(kind) {
  const application = state.applications.find((item) => item.id === selectedId); if (!application) return;
  const buttons = [...document.querySelectorAll(".studio-actions button")]; buttons.forEach((button) => { button.disabled = true; });
  $("#ai-output-wrap").classList.remove("hidden"); $("#ai-output-title").textContent = "Building from your profile…"; $("#ai-output").value = "ApplyOS is comparing the job description with your active profile.";
  try {
    if (kind === "cover") { const result = await ApplyOS.generateAICoverLetter(application, profile); $("#ai-output-title").textContent = `${result.provider === "ollama" ? "Enhanced" : "Smart"} cover letter · review required`; $("#ai-output").value = result.text; }
    if (kind === "resume") { const result = await ApplyOS.tailorResumeWithAI(application, profile); $("#ai-output-title").textContent = `${result.provider === "ollama" ? "Enhanced resume" : "Resume focus plan"} · review required`; $("#ai-output").value = result.tailoredResume; }
    if (kind === "keywords") { const result = await ApplyOS.analyzeKeywordGapWithAI(application, profile); $("#ai-output-title").textContent = `Keyword gap · ${result.score}%`; $("#ai-output").value = `PRESENT\n${result.present.join(", ") || "None detected"}\n\nMISSING / VERIFY BEFORE ADDING\n${result.missing.join(", ") || "None detected"}\n\nEXPERIENCE TO HIGHLIGHT\n${result.highlights.join("\n") || "No suggestions"}`; }
  } catch (error) { $("#ai-output-title").textContent = "Local AI error"; $("#ai-output").value = error.message; }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}
$("#ai-cover-letter").addEventListener("click", () => runAIStudio("cover"));
$("#ai-tailor-resume").addEventListener("click", () => runAIStudio("resume"));
$("#ai-keywords").addEventListener("click", () => runAIStudio("keywords"));
$("#copy-ai-output").addEventListener("click", async () => { await navigator.clipboard.writeText($("#ai-output").value); toast("AI output copied for manual review"); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.applyos_state) { state = changes.applyos_state.newValue; render(); } });
initialize().catch((error) => toast(error.message));
