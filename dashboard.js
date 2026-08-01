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
let selectedActionId = null;
let actionReturnFocus = null;
let snoozeActionId = null;
let snoozeReturnFocus = null;
let currentView = "board";
let currentContactView = "cards";
let currentSection = "applications";
let profile = {};
let aiConfig = {};
document.body.inert = true;

function accountGateUrl(reason) {
  const url = new URL(chrome.runtime.getURL("account.html"));
  url.searchParams.set("reason", reason);
  url.searchParams.set("returnTo", `dashboard.html${location.search}${location.hash}`);
  return url.href;
}

async function requireWorkspaceAccess() {
  let response;
  try { response = await chrome.runtime.sendMessage({ type: "APPLYOS_CLOUD_STATUS" }); }
  catch { response = null; }
  const status = response?.ok ? response.status : null;
  const ready = status?.configured === true
    && status?.migrationRequired !== true
    && (status?.workspaceReady === true || status?.offlineAuthorized === true);
  if (!ready) {
    const reason = !response?.ok ? "status-unavailable" : status?.configured !== true ? "configuration-required" : status?.migrationRequired === true ? "migration-required" : "sign-in-required";
    location.replace(accountGateUrl(reason));
    return null;
  }
  document.body.inert = false;
  if (status.offlineAuthorized === true) globalThis.ScoutHeader?.setStatus("Offline · cached", "offline");
  return status;
}

function escapeHTML(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML;
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = String(value ?? "");
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

function hasJobDescription(application) {
  return Boolean(String(application?.description || "").trim());
}

function matchLabel(application, includeWord = false) {
  if (!hasJobDescription(application)) return "-";
  const value = `${Number(application.match_score || 0)}%`;
  return includeWord ? `${value} match` : value;
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

function openDrawer(drawer) {
  drawer.inert = false;
  drawer.classList.add("open");
  drawer.setAttribute("aria-modal", "true");
  drawer.dataset.state = "open";
  elements.scrim.classList.remove("hidden");
}

function closeDrawer(drawer, preferredFocus) {
  if (drawer.contains(document.activeElement)) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (preferredFocus?.isConnected && typeof preferredFocus.focus === "function") preferredFocus.focus({ preventScroll: true });
  }
  drawer.inert = true;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-modal", "false");
  drawer.dataset.state = "closed";
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function populateSelect(select, values, label) {
  const current = select.value;
  const all = new Option(`All ${label}`, "");
  select.replaceChildren(all, ...values.map((value) => new Option(String(value), String(value))));
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
  return `<article class="job-card" draggable="true" data-id="${item.id}" tabindex="0"><div class="card-top"><span class="priority ${item.priority}" title="${item.priority} priority"></span><span class="match-pill">${matchLabel(item, true)}</span></div><h3>${escapeHTML(item.role)}</h3><p>${escapeHTML(item.company)}</p><div class="card-meta"><span>${escapeHTML(item.source)}</span><span>${item.deadline ? `Due ${dateLabel(item.deadline)}` : dateLabel(item.created_at)}</span></div></article>`;
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
  elements.list.innerHTML = `<div class="table-row header"><span>ROLE / COMPANY</span><span>SOURCE</span><span>STATUS</span><span>PRIORITY</span><span>DEADLINE</span><span>MATCH</span></div>` + items.map((item) => `<div class="table-row" data-id="${item.id}" tabindex="0"><div><strong>${escapeHTML(item.role)}</strong><span>${escapeHTML(item.company)}</span></div><span>${escapeHTML(item.source)}</span><span class="status-chip">${ApplyOS.STATUS_META[item.status]?.label || item.status}</span><span>${escapeHTML(item.priority)}</span><span>${dateLabel(item.deadline)}</span><span>${matchLabel(item)}</span></div>`).join("");
  elements.list.querySelectorAll(".table-row[data-id]").forEach((row) => {
    row.addEventListener("click", () => openDetail(row.dataset.id));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") openDetail(row.dataset.id); });
  });
}

function renderUpcoming() {
  const now = Date.now();
  const reminders = state.reminders.filter((item) => item.status === "open" && item.application_id).map((item) => ({ ...item, application: state.applications.find((app) => app.id === item.application_id), agendaKind: "follow-up", at: item.snoozed_until || item.due_at }));
  const deadlines = state.applications.filter((item) => item.deadline && new Date(item.deadline).getTime() >= now - 86400000).map((item) => ({ application: item, kind: "deadline", at: item.deadline }));
  const interviews = state.interviews.filter((item) => !item.completed_at && item.scheduled_at && new Date(item.scheduled_at).getTime() >= now - 86400000).map((item) => ({ ...item, application: state.applications.find((app) => app.id === item.application_id), kind: "interview", at: item.scheduled_at }));
  const items = [...reminders, ...deadlines, ...interviews].filter((item) => item.application).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 8);
  elements.upcoming.innerHTML = items.length ? items.map((item) => `<div class="upcoming-card ${item.kind === "deadline" ? "deadline" : ""}"><button class="upcoming-open" data-id="${item.application.id}" type="button"><strong>${escapeHTML(item.application.role)}</strong><span>${item.kind === "deadline" ? "Deadline" : item.kind === "interview" ? "Interview" : "Follow-up"} · ${escapeHTML(dateLabel(item.at))}</span></button>${item.agendaKind === "follow-up" ? `<button class="upcoming-done" data-reminder-id="${item.id}" type="button">Done</button>` : ""}</div>`).join("") : `<span class="upcoming-card"><strong>Nothing urgent</strong><span>Your next actions will appear here.</span></span>`;
  elements.upcoming.querySelectorAll(".upcoming-open").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id)));
  elements.upcoming.querySelectorAll(".upcoming-done").forEach((button) => button.addEventListener("click", async () => {
    await ApplyOS.completeReminder(button.dataset.reminderId);
    await load();
    toast("Follow-up completed");
  }));
}

function actionContext(action) {
  const application = state.applications.find((item) => item.id === action.application_id);
  const contact = state.contacts.find((item) => item.id === action.contact_id);
  return [contact?.name, application ? `${application.role} · ${application.company}` : ""].filter(Boolean).join(" / ") || "Personal action";
}

function actionRowHTML(action) {
  const effective = action.snoozed_until || action.due_at;
  return `<article class="action-row ${action.group === "overdue" ? "is-overdue" : ""} ${action.group === "done" ? "is-done" : ""}" data-action-id="${action.id}"><i class="action-row-priority ${action.priority}"></i><button class="action-row-main" type="button" data-open-action="${action.id}"><strong>${escapeHTML(action.title)}</strong><span>${escapeHTML(titleCase(action.kind))} · ${escapeHTML(actionContext(action))}</span></button><time class="action-row-time" datetime="${escapeHTML(effective)}">${escapeHTML(dateTimeLabel(effective))}${action.snoozed_until ? " · snoozed" : ""}</time><div class="action-row-controls">${action.status === "open" ? `<button class="done" data-action-done="${action.id}" type="button">Done</button><button data-action-snooze="${action.id}" type="button">Snooze</button><button data-action-skip="${action.id}" type="button">Skip</button>` : `<button data-open-action="${action.id}" type="button">View</button>`}</div></article>`;
}

function actionItems() {
  const now = new Date(); const start = new Date(now); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  const search = $("#action-search")?.value.trim().toLowerCase() || "";
  const kind = $("#action-kind-filter")?.value || ""; const priority = $("#action-priority-filter")?.value || "";
  return state.reminders.map((item) => {
    const effective_due_at = item.snoozed_until || item.due_at; const due = new Date(effective_due_at).getTime();
    const group = item.status !== "open" ? "done" : due < start.getTime() ? "overdue" : due < end.getTime() ? "today" : "upcoming";
    return { ...item, effective_due_at, group };
  }).filter((item) => (!kind || item.kind === kind) && (!priority || item.priority === priority)
    && (!search || `${item.title} ${item.notes} ${actionContext(item)} ${item.kind}`.toLowerCase().includes(search)))
    .sort((a, b) => new Date(a.effective_due_at) - new Date(b.effective_due_at));
}

function snoozeDays() {
  return Number($("#snooze-days").value);
}

function updateSnoozeDialog() {
  const days = snoozeDays();
  const valid = Number.isInteger(days) && days >= 1 && days <= 30;
  $("#snooze-submit").disabled = !valid;
  setText("#snooze-error", valid ? "" : "Choose a whole number from 1 to 30 days.");
  for (const button of document.querySelectorAll("[data-snooze-preset]")) button.setAttribute("aria-pressed", String(valid && Number(button.dataset.snoozePreset) === days));
  if (!valid) { setText("#snooze-preview", "Your action will stay exactly where it is until the delay is valid."); return; }
  const returnsAt = new Date(Date.now() + days * 86400000);
  const label = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(returnsAt);
  setText("#snooze-preview", `Back on your action desk ${label}.`);
}

function openSnoozeDialog(actionId, trigger) {
  const action = state.reminders.find((item) => item.id === actionId);
  if (!action) return;
  snoozeActionId = actionId;
  snoozeReturnFocus = trigger;
  $("#snooze-days").value = "1";
  setText("#snooze-copy", `${action.title} · ${actionContext(action)}`);
  setText("#snooze-error", "");
  updateSnoozeDialog();
  $("#snooze-dialog").returnValue = "";
  $("#snooze-dialog").showModal();
  requestAnimationFrame(() => document.querySelector('[data-snooze-preset="1"]')?.focus());
}

function closeSnoozeDialog(value = "cancel") {
  const dialog = $("#snooze-dialog");
  if (dialog.open) dialog.close(value);
}

for (const button of document.querySelectorAll("[data-snooze-preset]")) button.addEventListener("click", () => {
  $("#snooze-days").value = button.dataset.snoozePreset;
  updateSnoozeDialog();
});
$("#snooze-days").addEventListener("input", updateSnoozeDialog);
$("#snooze-close").addEventListener("click", () => closeSnoozeDialog());
$("#snooze-cancel").addEventListener("click", () => closeSnoozeDialog());
$("#snooze-dialog").addEventListener("close", () => {
  if ($("#snooze-dialog").returnValue !== "saved" && snoozeReturnFocus?.isConnected) snoozeReturnFocus.focus();
  snoozeActionId = null;
  snoozeReturnFocus = null;
});
$("#snooze-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const days = snoozeDays();
  if (!snoozeActionId || !Number.isInteger(days) || days < 1 || days > 30) { updateSnoozeDialog(); $("#snooze-days").focus(); return; }
  const button = $("#snooze-submit");
  button.disabled = true;
  button.textContent = "Snoozing…";
  try {
    await ApplyOS.snoozeAction(snoozeActionId, new Date(Date.now() + days * 86400000).toISOString());
    closeSnoozeDialog("saved");
    await load();
    toast(`Snoozed ${days} day${days === 1 ? "" : "s"}`);
  } catch (error) {
    setText("#snooze-error", error.message || "Scout could not snooze this action.");
  } finally {
    button.textContent = "Snooze action";
    if ($("#snooze-dialog").open) button.disabled = false;
  }
});

function bindActionRows() {
  $("#action-groups").querySelectorAll("[data-open-action]").forEach((button) => button.addEventListener("click", () => openAction(button.dataset.openAction)));
  $("#action-groups").querySelectorAll("[data-action-done]").forEach((button) => button.addEventListener("click", async () => { await ApplyOS.completeAction(button.dataset.actionDone); await load(); toast("Action completed"); }));
  $("#action-groups").querySelectorAll("[data-action-skip]").forEach((button) => button.addEventListener("click", async () => { await ApplyOS.skipAction(button.dataset.actionSkip); await load(); toast("Action skipped"); }));
  $("#action-groups").querySelectorAll("[data-action-snooze]").forEach((button) => button.addEventListener("click", () => openSnoozeDialog(button.dataset.actionSnooze, button)));
}

function renderActions() {
  const items = actionItems();
  for (const group of ["overdue", "today", "upcoming"]) $(`#action-${group}-count`).textContent = items.filter((item) => item.group === group).length;
  const labels = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", done: "Done / skipped" };
  $("#action-groups").innerHTML = Object.entries(labels).map(([group, label]) => {
    const rows = items.filter((item) => item.group === group);
    return `<section class="action-group"><div class="action-group-heading"><h2>${label}</h2><span>${rows.length} ${rows.length === 1 ? "ITEM" : "ITEMS"}</span></div><div class="action-stack">${rows.length ? rows.map(actionRowHTML).join("") : `<div class="action-empty">No ${label.toLowerCase()} actions.</div>`}</div></section>`;
  }).join("");
  bindActionRows();
}

function contactCardHTML(contact) {
  const applications = contact.application_ids.map((id) => state.applications.find((item) => item.id === id)).filter(Boolean);
  const initials = contact.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const overdue = contact.next_action_at && new Date(contact.next_action_at).getTime() < Date.now();
  return `<article class="contact-card ${overdue ? "is-overdue" : ""}" data-contact-id="${contact.id}" tabindex="0"><div class="contact-card-top"><span class="contact-monogram">${escapeHTML(initials)}</span><span class="relationship-chip">${escapeHTML(titleCase(contact.relationship))}</span></div><h3>${escapeHTML(contact.name)}</h3><p>${escapeHTML([contact.title, contact.company].filter(Boolean).join(" · ") || "Add title and company")}</p><div class="tag-line">${(contact.tags || []).slice(0, 4).map((tag) => `<i>${escapeHTML(tag)}</i>`).join("")}</div><footer><span>${applications.length ? `${applications.length} linked role${applications.length === 1 ? "" : "s"}` : "General network"}</span><span>${contact.next_action_at ? `${overdue ? "Overdue" : "Next"} ${dateLabel(contact.next_action_at)}` : "No next action"}</span></footer></article>`;
}

function renderContacts() {
  const query = $("#contact-search").value.trim().toLowerCase();
  const relationship = $("#contact-relationship-filter")?.value || ""; const actionFilter = $("#contact-action-filter")?.value || ""; const sort = $("#contact-sort")?.value || "next";
  const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  const contacts = state.contacts.filter((contact) => [contact.name, contact.title, contact.company, contact.email, contact.phone, contact.notes, ...(contact.tags || [])].join(" ").toLowerCase().includes(query))
    .filter((contact) => !relationship || contact.relationship === relationship).filter((contact) => {
      const due = contact.next_action_at ? new Date(contact.next_action_at).getTime() : null;
      return !actionFilter || (actionFilter === "none" ? !due : actionFilter === "overdue" ? due < start.getTime() : actionFilter === "today" ? due >= start.getTime() && due < end.getTime() : true);
    }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "recent" ? new Date(b.last_contacted_at || 0) - new Date(a.last_contacted_at || 0) : new Date(a.next_action_at || "9999-12-31") - new Date(b.next_action_at || "9999-12-31"));
  $("#contact-count").textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`;
  $("#contacts-empty").classList.toggle("hidden", state.contacts.length > 0);
  $("#contacts-list").classList.toggle("hidden", state.contacts.length === 0);
  $("#contacts-list").classList.toggle("list-mode", currentContactView === "list");
  $("#contacts-list").innerHTML = contacts.map(contactCardHTML).join("");
  $("#contacts-list").querySelectorAll(".contact-card").forEach((card) => {
    card.addEventListener("click", () => openContact(card.dataset.contactId));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openContact(card.dataset.contactId); });
  });
}

function render() {
  if (!state) return;
  const items = filteredApplications();
  const active = state.applications.filter((item) => !["rejected", "closed"].includes(item.status)).length;
  const due = state.reminders.filter((item) => item.status === "open" && new Date(item.snoozed_until || item.due_at) <= new Date()).length;
  $("#metric-total").textContent = active;
  $("#metric-due").textContent = due;
  $("#metric-interviews").textContent = state.applications.filter((item) => item.status === "interview").length;
  populateSelect(elements.source, [...new Set(state.applications.map((item) => item.source).filter(Boolean))].sort(), "sources");
  elements.empty.classList.toggle("hidden", state.applications.length > 0);
  elements.board.classList.toggle("hidden", currentView !== "board" || !state.applications.length);
  elements.list.classList.toggle("hidden", currentView !== "list" || !state.applications.length);
  renderBoard(items); renderList(items); renderUpcoming(); renderActions(); renderContacts();
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
  $("#detail-score").textContent = matchLabel(item); $("#detail-bar").style.width = hasJobDescription(item) ? `${item.match_score || 0}%` : "0%";
  $("#detail-skills").textContent = hasJobDescription(item) ? `Matched: ${item.matched_skills?.join(", ") || "No explicit skills yet"}` : "A job description is required to calculate a match.";
  const highlight = item.suggested_experiences?.[0] || item.missing_skills?.join(", ") || item.suggested_keywords?.slice(0, 6).join(", ") || "No major gaps detected";
  $("#detail-missing").textContent = hasJobDescription(item) ? `Consider highlighting: ${highlight}` : "Reopen the job posting or update the saved job after its description is captured.";
  $("#detail-url").href = item.url; $("#detail-applied").classList.toggle("hidden", Boolean(item.applied_at));
  $("#draft").classList.add("hidden");
  $("#thank-you").classList.add("hidden");
  $("#interview-form").classList.add("hidden");
  selectedInterviewId = null;
  renderLinkedContacts(item);
  renderInterviews(item);
  $("#ai-output-wrap").classList.add("hidden");
  openDrawer(elements.detail);
  $("#detail-role").focus();
}

function applicationOptions(selected = []) {
  const selectedIds = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  return state.applications.map((item) => `<option value="${item.id}" ${selectedIds.has(item.id) ? "selected" : ""}>${escapeHTML(item.company)} · ${escapeHTML(item.role)}</option>`).join("");
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

function renderContactTimeline(contactId) {
  const activities = (state.contact_activities || []).filter((item) => item.contact_id === contactId)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  $("#contact-timeline").innerHTML = activities.length ? activities.map((item) => {
    const application = state.applications.find((entry) => entry.id === item.application_id);
    return `<article class="timeline-entry"><strong>${escapeHTML(item.subject || titleCase(item.type))}</strong><span>${escapeHTML(titleCase(item.direction))} ${escapeHTML(titleCase(item.type))} · ${escapeHTML(dateTimeLabel(item.occurred_at))}${application ? ` · ${escapeHTML(application.company)}` : ""}</span>${item.summary ? `<p>${escapeHTML(item.summary)}</p>` : ""}${item.outcome ? `<p><strong>Outcome:</strong> ${escapeHTML(item.outcome)}</p>` : ""}</article>`;
  }).join("") : `<div class="action-empty">No interactions logged yet. Scout never infers them from your inbox.</div>`;
  const actions = state.reminders.filter((item) => item.contact_id === contactId && item.status === "open").sort((a, b) => new Date(a.snoozed_until || a.due_at) - new Date(b.snoozed_until || b.due_at));
  $("#activity-action").innerHTML = `<option value="">None</option>` + actions.map((item) => `<option value="${item.id}">${escapeHTML(item.title)} · ${escapeHTML(dateLabel(item.snoozed_until || item.due_at))}</option>`).join("");
}

function openActivityForm(prefill = {}) {
  if (!selectedContactId) return;
  $("#activity-form").classList.remove("hidden");
  $("#activity-type").value = prefill.type || "email";
  $("#activity-direction").value = prefill.direction || "outbound";
  $("#activity-when").value = toDateTimeInput(prefill.occurred_at || new Date().toISOString());
  $("#activity-subject").value = prefill.subject || "";
  $("#activity-summary").value = prefill.summary || "";
  $("#activity-outcome").value = prefill.outcome || "";
  $("#activity-action").value = prefill.action_id || "";
  $("#activity-complete-action").checked = Boolean(prefill.action_id);
  $("#activity-next-title").value = ""; $("#activity-next-date").value = "";
  $("#activity-summary").focus();
}

function openAction(id = null, context = {}) {
  const action = state.reminders.find((item) => item.id === id) || null;
  const active = document.activeElement; actionReturnFocus = active instanceof HTMLElement ? active : null; selectedActionId = action?.id || null;
  $("#action-id").value = action?.id || ""; $("#action-title").value = action?.title || ""; $("#action-due").value = toDateTimeInput(action?.snoozed_until || action?.due_at || new Date(Date.now() + 86400000).toISOString());
  $("#action-priority").value = action?.priority || "medium"; $("#action-kind").value = action?.kind || (context.contact_id ? "contact_follow_up" : context.application_id ? "application_follow_up" : "custom");
  $("#action-channel").value = action?.channel || "email"; $("#action-notes").value = action?.notes || "";
  $("#action-application").innerHTML = `<option value="">None</option>` + applicationOptions(action?.application_id || context.application_id || "");
  $("#action-contact").innerHTML = `<option value="">None</option>` + state.contacts.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}${item.company ? ` · ${escapeHTML(item.company)}` : ""}</option>`).join("");
  $("#action-application").value = action?.application_id || context.application_id || ""; $("#action-contact").value = action?.contact_id || context.contact_id || "";
  $("#action-done").classList.toggle("hidden", !action || action.status !== "open"); $("#action-delete").classList.toggle("hidden", !action || action.status !== "open");
  openDrawer($("#action-detail")); $("#action-title").focus();
}

function closeAction() {
  if (!$("#action-detail").classList.contains("open")) return;
  closeDrawer($("#action-detail"), actionReturnFocus || $("#action-search")); selectedActionId = null; actionReturnFocus = null;
  if (!elements.detail.classList.contains("open") && !$("#contact-detail").classList.contains("open")) elements.scrim.classList.add("hidden");
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
  $("#contact-phone").value = contact?.phone || "";
  $("#contact-linkedin").value = contact?.linkedin_url || "";
  $("#contact-channel").value = contact?.preferred_channel || (contact?.email ? "email" : contact?.linkedin_url ? "linkedin" : "other");
  $("#contact-tags").value = (contact?.tags || []).join(", ");
  $("#contact-application").innerHTML = applicationOptions(contact?.application_ids?.length ? contact.application_ids : [applicationId].filter(Boolean));
  $("#contact-last").value = ApplyOS.toDateInput(contact?.last_contacted_at);
  $("#contact-next").value = ApplyOS.toDateInput(contact?.next_action_at);
  $("#contact-notes").value = contact?.notes || "";
  $("#delete-contact").classList.toggle("hidden", !contact);
  $("#merge-contact").classList.add("hidden"); $("#merge-contact").dataset.targetId = "";
  if (contact) ApplyOS.findDuplicateContacts(contact, contact.id).then((matches) => {
    const duplicate = matches.find((item) => item.exact) || matches.find((item) => item.reason === "name");
    if (!duplicate || selectedContactId !== contact.id) return;
    $("#merge-contact").classList.remove("hidden"); $("#merge-contact").dataset.targetId = duplicate.contact.id; $("#merge-contact").textContent = `Merge with ${duplicate.contact.name}`;
  });
  $("#open-contact-linkedin").classList.toggle("hidden", !contact?.linkedin_url);
  $("#open-contact-linkedin").href = contact?.linkedin_url || "#";
  $("#contact-message").value = contact ? `Hello ${contact.name.split(/\s+/)[0]},\n\nIt was great connecting with you. I wanted to stay in touch regarding opportunities at ${contact.company || "your company"}.\n\nBest,\n${profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || ""}` : "";
  $("#log-interaction").disabled = !contact;
  $("#activity-form").classList.add("hidden");
  renderContactTimeline(contact?.id || "");
  updateContactComposeLinks();
  openDrawer($("#contact-detail"));
  $("#contact-name").focus();
}

function closeContact() {
  const detail = $("#contact-detail");
  if (!detail.classList.contains("open")) return;
  const focusTarget = contactReturnFocus?.isConnected ? contactReturnFocus : $("#contact-search");
  closeDrawer(detail, focusTarget);
  selectedContactId = null;
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
  selectedId = null;
  closeDrawer(elements.detail, focusTarget);
  elements.scrim.classList.add("hidden");
  detailReturnFocus = null;
}

function showDashboardSection(section, focusSearch = false) {
  currentSection = ["contacts", "actions"].includes(section) ? section : "applications";
  document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item.dataset.section === currentSection));
  globalThis.ScoutHeader?.setActiveNavigation(currentSection);
  document.querySelectorAll(".application-only").forEach((item) => item.classList.toggle("hidden", currentSection !== "applications"));
  $("#actions-workspace").classList.toggle("hidden", currentSection !== "actions");
  $("#contacts-workspace").classList.toggle("hidden", currentSection !== "contacts");
  if (focusSearch && currentSection === "contacts") $("#contact-search").focus();
  if (focusSearch && currentSection === "actions") $("#action-search").focus();
}

function parseContactsCSV(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one contact.");
  const aliases = { name: ["name", "full name", "contact"], email: ["email", "email address"], company: ["company", "organization"], title: ["title", "role", "job title"], phone: ["phone", "phone number"], linkedin_url: ["linkedin", "linkedin url", "profile url"], relationship: ["relationship", "type"], tags: ["tags", "labels"] };
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex((header) => names.includes(header))]));
  if (indexes.name < 0) throw new Error("Map a column named Name or Full name before importing.");
  if (rows.length - 1 > 500) throw new Error("Import at most 500 contacts at a time.");
  return rows.slice(1).map((values, index) => ({
    row: index + 2,
    name: values[indexes.name]?.trim() || "",
    email: indexes.email >= 0 ? values[indexes.email]?.trim() || "" : "",
    company: indexes.company >= 0 ? values[indexes.company]?.trim() || "" : "",
    title: indexes.title >= 0 ? values[indexes.title]?.trim() || "" : "",
    phone: indexes.phone >= 0 ? values[indexes.phone]?.trim() || "" : "",
    linkedin_url: indexes.linkedin_url >= 0 ? values[indexes.linkedin_url]?.trim() || "" : "",
    relationship: indexes.relationship >= 0 && ApplyOS.CONTACT_RELATIONSHIPS.includes(values[indexes.relationship]?.trim().toLowerCase().replace(/\s+/g, "_")) ? values[indexes.relationship].trim().toLowerCase().replace(/\s+/g, "_") : "other",
    tags: indexes.tags >= 0 ? values[indexes.tags].split(/[;|]/).map((tag) => tag.trim()).filter(Boolean) : []
  }));
}

async function importContactsFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error("Choose a CSV smaller than 2 MB.");
  const rows = parseContactsCSV(await file.text()); const invalid = rows.filter((item) => !item.name);
  if (invalid.length) throw new Error(`Rows ${invalid.slice(0, 5).map((item) => item.row).join(", ")} need a name.`);
  if (!await ScoutDialog.confirm({ eyebrow: "CONTACT IMPORT", title: `Import ${rows.length} contact${rows.length === 1 ? "" : "s"}?`, message: "Scout will check exact email and LinkedIn matches before anything is merged.", confirmLabel: "Review & import", cancelLabel: "Cancel import" })) return;
  let created = 0; let merged = 0; let skipped = 0;
  for (const row of rows) {
    const { row: _rowNumber, ...contactInput } = row;
    const duplicates = await ApplyOS.findDuplicateContacts(row);
    const exact = duplicates.find((item) => item.exact);
    if (exact) {
      if (!await ScoutDialog.confirm({ eyebrow: "DUPLICATE FOUND", title: "Merge this contact?", message: `${row.name} matches ${exact.contact.name} by ${exact.reason}.`, consequences: ["Linked roles, notes, tags, and relationship history will be combined."], confirmLabel: "Merge contact", cancelLabel: "Skip this row" })) { skipped += 1; continue; }
      const imported = await ApplyOS.upsertContact({ ...contactInput, id: undefined });
      await ApplyOS.mergeContacts(imported.id, exact.contact.id); merged += 1;
    } else { await ApplyOS.upsertContact(contactInput); created += 1; }
  }
  await load(); toast(`Import complete · ${created} new · ${merged} merged · ${skipped} skipped`);
}

async function startDashboardTour() {
  const force = new URLSearchParams(location.search).get("tour") === "1";
  await ScoutTour.start({
    id: "main",
    surface: "dashboard",
    force,
    steps: [
      {
        target: '[data-tour-target="metrics"]',
        eyebrow: "YOUR SEARCH AT A GLANCE",
        title: "Know what needs attention.",
        body: "These live totals show active applications, follow-ups due, and interviews.",
        placement: "bottom"
      },
      {
        target: '[data-tour-target="next-actions"]',
        eyebrow: "DEADLINES & REMINDERS",
        title: "Your next move stays visible.",
        body: "Deadlines, seven-day follow-ups, fourteen-day final follow-ups, and interview actions surface here as they become due.",
        placement: "bottom"
      },
      {
        target: '[data-tour-target="pipeline"]',
        eyebrow: "APPLICATION CRM",
        title: "This is your working pipeline.",
        body: "Search and filter every opportunity, move between board and list views, and open a card to manage status, notes, drafts, interviews, and match guidance.",
        placement: "top"
      },
      {
        target: '[data-tour-target="contacts-workspace"]',
        eyebrow: "CONTACTS & NETWORKING",
        title: "Map the people behind each role.",
        body: "Keep recruiters, hiring managers, referrals, and interviewers connected to applications—with notes and next-contact dates.",
        placement: "top",
        prepare: () => showDashboardSection("contacts")
      },
      {
        target: '[data-tour-target="profile-settings"]',
        eyebrow: "YOUR SOURCE OF TRUTH",
        title: "Complete your application profile.",
        body: "Profile & answers holds your resume, address, work history, preferences, and reusable answers. Next, Scout will show you the most important sections.",
        placement: "bottom",
        nextLabel: "Open profile →",
        prepare: () => showDashboardSection("applications"),
        onNext: async () => {
          await ScoutTour.handoff("main", "options");
          location.assign(chrome.runtime.getURL("options.html?tour=1"));
          return false;
        }
      }
    ],
    onSkip: () => showDashboardSection("applications")
  });
}

async function initialize() {
  const access = await requireWorkspaceAccess();
  if (!access) return;
  const query = new URLSearchParams(location.search);
  const isTour = query.get("tour") === "1";
  const [activeProfile, config] = await Promise.all([ApplyOS.getActiveProfile(), ApplyOS.getAIConfig()]);
  profile = activeProfile; aiConfig = config;
  $("#studio-status").textContent = aiConfig.enabled ? "AI ENHANCED" : "SMART READY";
  $("#studio-status").classList.add("on");
  ApplyOS.APPLICATION_STATUSES.forEach((status) => {
    const label = ApplyOS.STATUS_META[status].label;
    elements.status.insertAdjacentHTML("beforeend", `<option value="${status}">${label}</option>`);
    $("#detail-status").insertAdjacentHTML("beforeend", `<option value="${status}">${label}</option>`);
  });
  ApplyOS.CONTACT_RELATIONSHIPS.forEach((relationship) => $("#contact-relationship").insertAdjacentHTML("beforeend", `<option value="${relationship}">${titleCase(relationship)}</option>`));
  ApplyOS.CONTACT_RELATIONSHIPS.forEach((relationship) => $("#contact-relationship-filter").insertAdjacentHTML("beforeend", `<option value="${relationship}">${titleCase(relationship)}</option>`));
  ApplyOS.ACTION_KINDS.forEach((kind) => $("#action-kind-filter").insertAdjacentHTML("beforeend", `<option value="${kind}">${titleCase(kind)}</option>`));
  ApplyOS.INTERVIEW_TYPES.forEach((type) => $("#interview-type").insertAdjacentHTML("beforeend", `<option value="${type}">${titleCase(type)}</option>`));
  ApplyOS.INTERVIEW_FORMATS.forEach((format) => $("#interview-format").insertAdjacentHTML("beforeend", `<option value="${format}">${titleCase(format)}</option>`));
  // Contextual coach marks are strictly read-only. Normal dashboard visits
  // refresh any saved scores made stale by profile or resume updates.
  if (!isTour) await ApplyOS.refreshApplicationMatches(profile);
  await load();
  if (!query.has("tour")) showDashboardSection(query.get("section") || "applications");
  if (query.get("action")) openAction(query.get("action"));
  await startDashboardTour();
}

[elements.search, elements.status, elements.source, elements.priority].forEach((control) => control.addEventListener(control === elements.search ? "input" : "change", render));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button)); render();
}));
document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  showDashboardSection(button.dataset.section, true);
  const url = new URL(location.href);
  if (["contacts", "actions"].includes(button.dataset.section)) url.searchParams.set("section", button.dataset.section);
  else url.searchParams.delete("section");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}));
$("#contact-search").addEventListener("input", renderContacts);
[$("#contact-relationship-filter"), $("#contact-action-filter"), $("#contact-sort")].forEach((control) => control.addEventListener("change", renderContacts));
[$("#action-search"), $("#action-kind-filter"), $("#action-priority-filter")].forEach((control) => control.addEventListener(control.tagName === "INPUT" ? "input" : "change", renderActions));
$("#add-action").addEventListener("click", () => openAction());
$("#add-contact").addEventListener("click", () => openContact());
$("#contacts-empty-add").addEventListener("click", () => openContact());
$("#import-contacts").addEventListener("click", () => $("#contacts-csv").click());
$("#contact-view-toggle").addEventListener("click", () => { currentContactView = currentContactView === "cards" ? "list" : "cards"; $("#contact-view-toggle").textContent = currentContactView === "cards" ? "List view" : "Card view"; renderContacts(); });
$("#contacts-csv").addEventListener("change", async () => { try { await importContactsFile($("#contacts-csv").files?.[0]); } catch (error) { toast(error.message); } finally { $("#contacts-csv").value = ""; } });
$("#add-linked-contact").addEventListener("click", () => { const applicationId = selectedId; closeDetail(); openContact(null, applicationId); });
$("#mock").addEventListener("click", async () => { await ApplyOS.seedMockData(); await load(); toast("Sample applications added"); });
$("#close-detail").addEventListener("click", closeDetail);
$("#close-contact").addEventListener("click", closeContact);
$("#close-action").addEventListener("click", closeAction);
elements.scrim.addEventListener("click", () => { closeAction(); closeContact(); closeDetail(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if ($("#action-detail").classList.contains("open")) closeAction(); else if ($("#contact-detail").classList.contains("open")) closeContact(); else closeDetail(); } });
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
$("#delete-application").addEventListener("click", async () => {
  const application = state.applications.find((item) => item.id === selectedId);
  if (!application || !await ScoutDialog.confirm({ eyebrow: "DELETE APPLICATION", title: `Remove ${application.role}?`, message: `${application.company} will be removed from your Scout pipeline.`, consequences: ["Linked reminders will be deleted.", "Interview workspaces for this application will be deleted."], tone: "danger", confirmLabel: "Delete application", cancelLabel: "Keep application" })) return;
  const id = selectedId;
  closeDetail();
  await ApplyOS.deleteApplication(id);
  await load();
  toast("Application deleted");
});
$("#generate-draft").addEventListener("click", () => {
  const application = state.applications.find((item) => item.id === selectedId); if (!application) return;
  const contact = state.contacts.find((item) => item.id === $("#draft-contact").value) || {};
  const draft = ApplyOS.generateFollowUpDraft(application, profile, $("#draft-type").value, contact); $("#draft-subject").value = draft.subject; $("#draft-body").value = draft.body; updateDraftComposeLinks(); $("#draft").classList.remove("hidden");
});
$("#copy-draft").addEventListener("click", async () => { await navigator.clipboard.writeText(`Subject: ${$("#draft-subject").value}\n\n${$("#draft-body").value}`); toast("Draft copied for manual review"); });
[$("#draft-subject"), $("#draft-body"), $("#draft-contact")].forEach((control) => control.addEventListener(control.tagName === "SELECT" ? "change" : "input", updateDraftComposeLinks));

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const applicationIds = Array.from($("#contact-application").selectedOptions, (option) => option.value).filter(Boolean);
  const previous = state.contacts.find((item) => item.id === selectedContactId);
  const saved = await ApplyOS.upsertContact({
    id: selectedContactId || undefined,
    name: $("#contact-name").value.trim(), title: $("#contact-title").value.trim(), company: $("#contact-company").value.trim(),
    email: $("#contact-email").value.trim(), phone: $("#contact-phone").value.trim(), linkedin_url: $("#contact-linkedin").value.trim(), relationship: $("#contact-relationship").value,
    preferred_channel: $("#contact-channel").value, tags: $("#contact-tags").value.split(",").map((item) => item.trim()).filter(Boolean),
    application_ids: applicationIds, notes: $("#contact-notes").value.trim(),
    last_contacted_at: previous?.last_contacted_at || null,
    created_at: previous?.created_at
  });
  const nextDate = $("#contact-next").value ? new Date(`${$("#contact-next").value}T12:00:00`).toISOString() : null;
  const existingAction = state.reminders.find((item) => item.contact_id === saved.id && item.kind === "contact_follow_up" && item.status === "open");
  if (nextDate) await ApplyOS.upsertAction({ ...(existingAction || {}), kind: "contact_follow_up", title: existingAction?.title || `Follow up with ${saved.name}`, due_at: nextDate, priority: existingAction?.priority || "medium", channel: saved.preferred_channel, contact_id: saved.id, application_id: applicationIds[0] || null, source: existingAction?.source || "user" });
  else if (existingAction) await ApplyOS.cancelAction(existingAction.id);
  await load(); closeContact(); toast("Contact saved");
});
$("#delete-contact").addEventListener("click", async () => {
  if (!selectedContactId) return;
  const contact = state.contacts.find((item) => item.id === selectedContactId);
  if (!await ScoutDialog.confirm({ eyebrow: "DELETE CONTACT", title: `Remove ${contact?.name || "this contact"}?`, message: "This person will be removed from your relationship workspace.", consequences: ["Their linked relationship history and contact actions will be removed."], tone: "danger", confirmLabel: "Delete contact", cancelLabel: "Keep contact" })) return;
  await ApplyOS.deleteContact(selectedContactId); await load(); closeContact(); toast("Contact deleted");
});
$("#merge-contact").addEventListener("click", async () => {
  const targetId = $("#merge-contact").dataset.targetId; const source = state.contacts.find((item) => item.id === selectedContactId); const target = state.contacts.find((item) => item.id === targetId);
  if (!source || !target || !await ScoutDialog.confirm({ eyebrow: "MERGE CONTACTS", title: `Merge ${source.name} into ${target.name}?`, message: "Scout will keep the destination contact and combine the useful context from both records.", consequences: ["Linked applications, actions, interviews, notes, tags, and history will be preserved."], confirmLabel: "Merge contacts", cancelLabel: "Keep separate" })) return;
  await ApplyOS.mergeContacts(source.id, target.id); await load(); closeContact(); openContact(target.id); toast("Contacts merged");
});
[$("#contact-subject"), $("#contact-message"), $("#contact-email")].forEach((control) => control.addEventListener("input", updateContactComposeLinks));
$("#log-interaction").addEventListener("click", () => openActivityForm());
$("#cancel-activity").addEventListener("click", () => $("#activity-form").classList.add("hidden"));
$("#activity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const actionId = $("#activity-action").value;
  const contact = state.contacts.find((item) => item.id === selectedContactId); if (!contact) return;
  await ApplyOS.logContactActivity({
    contact_id: contact.id,
    application_id: actionId ? state.reminders.find((item) => item.id === actionId)?.application_id || null : contact.application_ids[0] || null,
    action_id: actionId || null,
    type: $("#activity-type").value,
    direction: $("#activity-direction").value,
    occurred_at: toISOFromInput($("#activity-when").value),
    subject: $("#activity-subject").value.trim(),
    summary: $("#activity-summary").value.trim(),
    outcome: $("#activity-outcome").value.trim()
  }, {
    complete_action_id: $("#activity-complete-action").checked ? actionId : "",
    next_action: $("#activity-next-title").value.trim() && $("#activity-next-date").value ? {
      title: $("#activity-next-title").value.trim(), due_at: toISOFromInput($("#activity-next-date").value), priority: "medium", channel: contact.preferred_channel || "email", application_id: contact.application_ids[0] || null
    } : null
  });
  await load(); selectedContactId = contact.id; renderContactTimeline(contact.id); $("#activity-form").classList.add("hidden"); toast("Interaction logged");
});
document.querySelectorAll("[data-log-compose]").forEach((link) => link.addEventListener("click", () => {
  window.setTimeout(() => openActivityForm({ type: link.dataset.logCompose, direction: "outbound", subject: $("#contact-subject").value, summary: "Reviewed message opened in compose. Confirm only after sending." }), 150);
}));

$("#action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = $("#action-kind").value; const applicationId = $("#action-application").value || null; const contactId = $("#action-contact").value || null;
  if (kind.startsWith("application_") && !applicationId) return toast("Choose an application for this action");
  if (kind === "contact_follow_up" && !contactId) return toast("Choose a contact for this action");
  const existing = state.reminders.find((item) => item.id === selectedActionId);
  await ApplyOS.upsertAction({ ...(existing || {}), id: selectedActionId || undefined, kind, title: $("#action-title").value.trim(), due_at: toISOFromInput($("#action-due").value), snoozed_until: null, priority: $("#action-priority").value, channel: $("#action-channel").value, application_id: applicationId, contact_id: contactId, interview_id: existing?.interview_id || null, notes: $("#action-notes").value.trim(), source: existing?.source || "user" });
  await load(); closeAction(); toast("Action saved");
});
$("#action-done").addEventListener("click", async () => { if (!selectedActionId) return; await ApplyOS.completeAction(selectedActionId); await load(); closeAction(); toast("Action completed"); });
$("#action-delete").addEventListener("click", async () => {
  if (!selectedActionId || !await ScoutDialog.confirm({ eyebrow: "CANCEL ACTION", title: "Cancel this action?", message: "It will move out of your open action list and remain visible under Done / skipped.", tone: "danger", confirmLabel: "Cancel action", cancelLabel: "Keep action" })) return;
  await ApplyOS.cancelAction(selectedActionId); await load(); closeAction(); toast("Action cancelled");
});

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
$("#delete-interview").addEventListener("click", async () => {
  if (!selectedInterviewId || !await ScoutDialog.confirm({ eyebrow: "DELETE INTERVIEW", title: "Delete this interview workspace?", message: "The application will stay in your pipeline.", consequences: ["Preparation, research, question notes, and linked interview actions will be removed."], tone: "danger", confirmLabel: "Delete interview", cancelLabel: "Keep interview" })) return;
  const applicationId = selectedId; await ApplyOS.deleteInterview(selectedInterviewId); await load(); openDetail(applicationId); toast("Interview deleted");
});
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
  $("#ai-output-wrap").classList.remove("hidden"); $("#ai-output-title").textContent = "Building from your profile…"; $("#ai-output").value = "Scout is comparing the job description with your active profile.";
  try {
    if (kind === "cover") { const result = await ApplyOS.generateAICoverLetter(application, profile); $("#ai-output-title").textContent = `${result.provider === "ollama" ? "Enhanced" : "Smart"} cover letter · review required`; $("#ai-output").value = result.text; }
    if (kind === "resume") { const result = await ApplyOS.tailorResumeWithAI(application, profile); $("#ai-output-title").textContent = `${result.provider === "ollama" ? "Enhanced resume" : "Resume focus plan"} · review required`; $("#ai-output").value = result.tailoredResume; }
    if (kind === "keywords") { const result = await ApplyOS.analyzeKeywordGapWithAI(application, profile); $("#ai-output-title").textContent = `Keyword gap · ${result.score}%`; $("#ai-output").value = `PRESENT\n${result.present.join(", ") || "None detected"}\n\nMISSING / VERIFY BEFORE ADDING\n${result.missing.join(", ") || "None detected"}\n\nEXPERIENCE TO HIGHLIGHT\n${result.highlights.join("\n") || "No suggestions"}`; }
  } catch (error) { $("#ai-output-title").textContent = "AI enhancement error"; $("#ai-output").value = error.message; }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}
$("#ai-cover-letter").addEventListener("click", () => runAIStudio("cover"));
$("#ai-tailor-resume").addEventListener("click", () => runAIStudio("resume"));
$("#ai-keywords").addEventListener("click", () => runAIStudio("keywords"));
$("#copy-ai-output").addEventListener("click", async () => { await navigator.clipboard.writeText($("#ai-output").value); toast("AI output copied for manual review"); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.applyos_state) return;
  // Account/cache transitions can briefly remove the local projection before
  // replacing it. Keep the last rendered state until a complete value arrives.
  const nextState = changes.applyos_state.newValue;
  if (!nextState || !Array.isArray(nextState.applications)) return;
  state = nextState;
  render();
});
initialize().catch((error) => {
  document.body.inert = false;
  toast(error.message);
});
