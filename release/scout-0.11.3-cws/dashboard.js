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
let selectedCompanyId = null;
let companyReturnFocus = null;
let selectedWaitingId = null;
let waitingReturnFocus = null;
let snoozeActionId = null;
let snoozeReturnFocus = null;
let contactImportParsed = null;
let contactImportRows = [];
let currentView = "board";
let currentContactView = "cards";
let currentSection = "actions";
let currentNetworkView = "contacts";
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
  const waiting = state.waiting_items.filter((entry) => entry.status === "open" && entry.application_id === item.id).length;
  const detailStatus = ["saved", "applied", "interview", "offer"].includes(item.status) ? "" : `<span class="workflow-chip ${item.status === "follow_up_due" ? "attention" : ""}">${escapeHTML(ApplyOS.STATUS_META[item.status]?.label || titleCase(item.status))}</span>`;
  return `<article class="job-card" draggable="true" data-id="${item.id}" tabindex="0"><div class="card-top"><span class="priority ${item.priority}" title="${item.priority} priority"></span><span class="card-signals">${detailStatus}${waiting ? `<span class="waiting-chip">WAITING ${waiting}</span>` : ""}<span class="match-pill">${matchLabel(item, true)}</span></span></div><h3>${escapeHTML(item.role)}</h3><p>${escapeHTML(item.company)}</p><div class="card-meta"><span>${escapeHTML(item.source)}</span><span>${item.deadline ? `Due ${dateLabel(item.deadline)}` : dateLabel(item.created_at)}</span></div></article>`;
}

function renderBoard(items) {
  const stages = [
    { label: "Saved", dropStatus: "saved", statuses: ["saved", "preparing"] },
    { label: "Applied", dropStatus: "applied", statuses: ["applied", "follow_up_due"] },
    { label: "Interviewing", dropStatus: "interview", statuses: ["interview", "assignment"] },
    { label: "Offer", dropStatus: "offer", statuses: ["offer"] },
    { label: "Archived", dropStatus: "closed", statuses: ["rejected", "closed"] }
  ];
  elements.board.innerHTML = stages.map((stage) => {
    const group = items.filter((item) => stage.statuses.includes(item.status));
    return `<section class="column" data-status="${stage.dropStatus}"><div class="column-head"><span>${stage.label.toUpperCase()}</span><span>${group.length}</span></div><div class="column-cards">${group.map(cardHTML).join("")}</div></section>`;
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
  elements.list.innerHTML = `<div class="table-row header"><span>ROLE / COMPANY</span><span>SOURCE</span><span>STATUS</span><span>PRIORITY</span><span>DEADLINE</span><span>MATCH</span></div>` + items.map((item) => {
    const waiting = state.waiting_items.some((entry) => entry.status === "open" && entry.application_id === item.id);
    return `<div class="table-row" data-id="${item.id}" tabindex="0"><div><strong>${escapeHTML(item.role)}</strong><span>${escapeHTML(item.company)}${waiting ? ` · <i class="waiting-inline">Waiting</i>` : ""}</span></div><span>${escapeHTML(item.source)}</span><span class="status-chip">${ApplyOS.STATUS_META[item.status]?.label || item.status}</span><span>${escapeHTML(item.priority)}</span><span>${dateLabel(item.deadline)}</span><span>${matchLabel(item)}</span></div>`;
  }).join("");
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
  const items = [...reminders, ...deadlines, ...interviews].filter((item) => item.application).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 3);
  elements.upcoming.innerHTML = (items.length ? items.map((item) => `<div class="upcoming-card ${item.kind === "deadline" ? "deadline" : ""}"><button class="upcoming-open" data-id="${item.application.id}" type="button"><strong>${escapeHTML(item.application.role)}</strong><span>${item.kind === "deadline" ? "Deadline" : item.kind === "interview" ? "Interview" : "Follow-up"} · ${escapeHTML(dateLabel(item.at))}</span></button>${item.agendaKind === "follow-up" ? `<button class="upcoming-done" data-reminder-id="${item.id}" type="button">Done</button>` : ""}</div>`).join("") : `<span class="upcoming-card"><strong>Nothing urgent</strong><span>Your next actions will appear here.</span></span>`) + `<button id="view-all-today" class="upcoming-view-all" type="button">Open Home →</button>`;
  elements.upcoming.querySelectorAll(".upcoming-open").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id)));
  elements.upcoming.querySelectorAll(".upcoming-done").forEach((button) => button.addEventListener("click", async () => {
    await ApplyOS.completeReminder(button.dataset.reminderId);
    await load();
    toast("Follow-up completed");
  }));
  $("#view-all-today").addEventListener("click", () => showDashboardSection("home", true));
}

function actionContext(action) {
  const application = state.applications.find((item) => item.id === action.application_id);
  const contact = state.contacts.find((item) => item.id === action.contact_id);
  const snapshot = action.context_snapshot || {};
  return [contact?.name || snapshot.contact_name, application ? `${application.role} · ${application.company}` : [snapshot.role, snapshot.company].filter(Boolean).join(" · ")].filter(Boolean).join(" / ") || "Personal action";
}

function actionRowHTML(action) {
  const effective = action.snoozed_until || action.due_at;
  const mainTarget = action.agenda ? `data-open-agenda-application="${action.application_id}"` : `data-open-action="${action.id}"`;
  const controls = action.agenda
    ? `<button data-open-agenda-application="${action.application_id}" type="button">View application</button>`
    : action.status === "open"
      ? `<button class="done" data-action-done="${action.id}" type="button">Done</button><button data-action-snooze="${action.id}" type="button">Snooze</button><button data-open-action="${action.id}" type="button">Details</button>`
      : `<button data-open-action="${action.id}" type="button">View</button>`;
  const calendar = action.google_calendar_event_id
    ? `<i class="calendar-inline">Calendar</i>`
    : action.calendar_sync_status === "error" ? `<i class="calendar-inline error">Sync error</i>` : "";
  return `<article class="action-row ${action.agenda ? "is-agenda" : ""} ${action.group === "overdue" ? "is-overdue" : ""} ${action.group === "done" ? "is-done" : ""}" data-action-id="${action.id}"><i class="action-row-priority ${action.priority}"></i><button class="action-row-main" type="button" ${mainTarget}><strong>${escapeHTML(action.title)}</strong><span>${escapeHTML(action.agenda ? "Agenda" : titleCase(action.kind))} · ${escapeHTML(actionContext(action))}${calendar}</span></button><time class="action-row-time" datetime="${escapeHTML(effective)}">${escapeHTML(dateTimeLabel(effective))}${action.snoozed_until ? " · snoozed" : ""}</time><div class="action-row-controls">${controls}</div></article>`;
}

function actionItems() {
  const now = new Date(); const start = new Date(now); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  const search = $("#action-search")?.value.trim().toLowerCase() || "";
  const kind = $("#action-kind-filter")?.value || ""; const priority = $("#action-priority-filter")?.value || "";
  const channel = $("#action-channel-filter")?.value || ""; const applicationId = $("#action-application-filter")?.value || ""; const contactId = $("#action-contact-filter")?.value || "";
  const deadlineItems = state.applications.filter((item) => item.deadline && !["offer", "rejected", "closed"].includes(item.status)).map((item) => ({
    id: `agenda_deadline_${item.id}`, agenda: true, kind: "application_deadline", title: `Application deadline · ${item.role}`, status: "open", due_at: item.deadline, snoozed_until: null, priority: item.priority, channel: "other", application_id: item.id, contact_id: null, interview_id: null, notes: "", source: "system", created_at: item.created_at, updated_at: item.updated_at
  }));
  const interviewItems = state.interviews.filter((item) => item.scheduled_at && !item.completed_at).map((item) => ({
    id: `agenda_interview_${item.id}`, agenda: true, kind: "interview_schedule", title: `${titleCase(item.type)} interview`, status: "open", due_at: item.scheduled_at, snoozed_until: null, priority: "high", channel: "meeting", application_id: item.application_id, contact_id: item.interviewer_contact_ids[0] || null, interview_id: item.id, notes: "", source: "system", created_at: item.created_at, updated_at: item.updated_at
  }));
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return [...state.reminders, ...deadlineItems, ...interviewItems].map((item) => {
    const effective_due_at = item.snoozed_until || item.due_at; const due = new Date(effective_due_at).getTime();
    const group = item.status !== "open" ? "done" : due < start.getTime() ? "overdue" : due < end.getTime() ? "today" : "upcoming";
    return { ...item, effective_due_at, group };
  }).filter((item) => (!kind || item.kind === kind) && (!priority || item.priority === priority)
    && (!channel || item.channel === channel) && (!applicationId || item.application_id === applicationId) && (!contactId || item.contact_id === contactId)
    && (!search || `${item.title} ${item.notes} ${actionContext(item)} ${item.kind}`.toLowerCase().includes(search)))
    .sort((a, b) => new Date(a.effective_due_at) - new Date(b.effective_due_at)
      || priorityRank[a.priority] - priorityRank[b.priority]
      || new Date(a.created_at) - new Date(b.created_at));
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
  $("#action-groups").querySelectorAll("[data-action-reschedule]").forEach((button) => button.addEventListener("click", async () => {
    const input = $(`[data-action-reschedule-date="${button.dataset.actionReschedule}"]`);
    const dueAt = toISOFromInput(input?.value);
    if (!dueAt) return toast("Choose a valid date and time");
    await ApplyOS.rescheduleAction(button.dataset.actionReschedule, dueAt); await load(); toast("Action rescheduled");
  }));
  $("#action-groups").querySelectorAll("[data-open-agenda-application]").forEach((button) => button.addEventListener("click", () => { showDashboardSection("applications"); openDetail(button.dataset.openAgendaApplication); }));
}

function renderActions() {
  const items = actionItems();
  for (const group of ["overdue", "today", "upcoming"]) $(`#action-${group}-count`).textContent = items.filter((item) => item.group === group).length;
  const groups = [
    { id: "attention", label: "Needs attention", rows: items.filter((item) => item.group === "overdue" || item.group === "today") },
    { id: "upcoming", label: "Coming up", rows: items.filter((item) => item.group === "upcoming") }
  ];
  $("#action-groups").innerHTML = groups.map(({ id, label, rows }) => {
    return `<section class="action-group" data-action-group="${id}"><div class="action-group-heading"><h2>${label}</h2><span>${rows.length} ${rows.length === 1 ? "ITEM" : "ITEMS"}</span></div><div class="action-stack">${rows.length ? rows.map(actionRowHTML).join("") : `<div class="action-empty">Nothing here. You’re all caught up.</div>`}</div></section>`;
  }).join("");
  bindActionRows();
}

function contactCardHTML(contact) {
  const applications = contact.application_ids.map((id) => state.applications.find((item) => item.id === id)).filter(Boolean);
  const initials = contact.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const overdue = contact.next_action_at && new Date(contact.next_action_at).getTime() < Date.now();
  const waiting = state.waiting_items.filter((entry) => entry.status === "open" && entry.contact_id === contact.id).length;
  return `<article class="contact-card ${overdue ? "is-overdue" : ""}" data-contact-id="${contact.id}" tabindex="0"><div class="contact-card-top"><span class="contact-monogram">${escapeHTML(initials)}</span><span class="contact-signals">${waiting ? `<span class="waiting-chip">WAITING ${waiting}</span>` : ""}<span class="relationship-chip">${escapeHTML(titleCase(contact.relationship))}</span></span></div><h3>${escapeHTML(contact.name)}</h3><p>${escapeHTML([contact.title, contact.company].filter(Boolean).join(" · ") || "Add title and company")}</p><div class="tag-line">${(contact.tags || []).slice(0, 4).map((tag) => `<i>${escapeHTML(tag)}</i>`).join("")}</div><footer><span>${applications.length ? `${applications.length} linked role${applications.length === 1 ? "" : "s"}` : "General network"}</span><span>${contact.next_action_at ? `${overdue ? "Overdue" : "Next"} ${dateLabel(contact.next_action_at)}` : "No next action"}</span></footer></article>`;
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

function companyOptions(selected = "") {
  return `<option value="">Not linked</option>` + state.companies
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("");
}

function companyCardHTML(company) {
  const applications = state.applications.filter((item) => item.company_id === company.id && !["rejected", "closed"].includes(item.status));
  const contacts = state.contacts.filter((item) => item.company_id === company.id);
  const openActions = state.reminders.filter((item) => item.status === "open" && (applications.some((application) => application.id === item.application_id) || contacts.some((contact) => contact.id === item.contact_id)));
  return `<article class="company-card" data-company-id="${company.id}" tabindex="0"><div><p class="eyebrow">${escapeHTML(company.domain || "COMPANY")}</p><h2>${escapeHTML(company.name)}</h2><p>${escapeHTML(company.notes || "Add company notes and context.")}</p></div><div class="company-card-counts"><span><strong>${applications.length}</strong> active roles</span><span><strong>${contacts.length}</strong> contacts</span><span><strong>${openActions.length}</strong> open actions</span></div><div class="tag-line">${company.tags.slice(0, 5).map((tag) => `<i>${escapeHTML(tag)}</i>`).join("")}</div></article>`;
}

function renderCompanies() {
  const query = $("#company-search").value.trim().toLowerCase();
  const companies = state.companies.filter((item) => [item.name, item.domain, item.website_url, item.notes, ...item.tags].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("#company-count").textContent = `${companies.length} ${companies.length === 1 ? "company" : "companies"}`;
  $("#companies-empty").classList.toggle("hidden", state.companies.length > 0);
  $("#companies-list").classList.toggle("hidden", state.companies.length === 0);
  $("#companies-list").innerHTML = companies.map(companyCardHTML).join("");
  $("#companies-list").querySelectorAll(".company-card").forEach((card) => {
    card.addEventListener("click", () => openCompany(card.dataset.companyId));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openCompany(card.dataset.companyId); });
  });
}

function waitingGroup(item, at = new Date()) {
  if (item.status !== "open") return "resolved";
  if (!item.expected_by) return "no_date";
  const start = new Date(at); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const expected = new Date(item.expected_by).getTime();
  return expected < start.getTime() ? "overdue" : expected < end.getTime() ? "today" : "upcoming";
}

function waitingRowHTML(item) {
  const application = state.applications.find((entry) => entry.id === item.application_id);
  const contact = state.contacts.find((entry) => entry.id === item.contact_id);
  const context = [application ? `${application.company} · ${application.role}` : "", contact?.name || ""].filter(Boolean).join(" · ");
  return `<article class="waiting-row" data-waiting-id="${item.id}" tabindex="0"><div><span class="waiting-kind">${escapeHTML(titleCase(item.kind))}</span><h3>${escapeHTML(item.what)}</h3><p>${escapeHTML(context || "Linked record unavailable")}</p></div><div class="waiting-date"><span>${item.expected_by ? "Expected" : "Waiting since"}</span><strong>${escapeHTML(dateLabel(item.expected_by || item.waiting_since))}</strong></div><div class="waiting-actions"><button data-resolve-waiting="${item.id}" type="button">Resolve</button>${waitingGroup(item) === "overdue" ? `<button data-convert-waiting="${item.id}" type="button">Follow up</button>` : ""}</div></article>`;
}

function renderWaiting() {
  const labels = { overdue: "Overdue", today: "Expected today", upcoming: "Upcoming", no_date: "No expected date" };
  const groups = Object.entries(labels).map(([group, label]) => {
    const items = state.waiting_items.filter((item) => waitingGroup(item) === group)
      .sort((a, b) => new Date(a.expected_by || a.waiting_since) - new Date(b.expected_by || b.waiting_since));
    return { label, items };
  }).filter(({ items }) => items.length);
  $("#waiting-groups").innerHTML = groups.length ? groups.map(({ label, items }) => `<section class="action-group waiting-group"><div class="action-group-heading"><h2>${label}</h2><span>${items.length} ${items.length === 1 ? "ITEM" : "ITEMS"}</span></div><div class="waiting-stack">${items.map(waitingRowHTML).join("")}</div></section>`).join("") : `<div class="waiting-clear"><span>✓</span><div><h2>Nothing needs a follow-up.</h2><p>When you are waiting on a recruiter, contact, or decision, it will appear here.</p></div></div>`;
  $("#waiting-groups").querySelectorAll(".waiting-row").forEach((row) => {
    row.addEventListener("click", (event) => { if (!event.target.closest("button")) openWaiting(row.dataset.waitingId); });
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") openWaiting(row.dataset.waitingId); });
  });
  $("#waiting-groups").querySelectorAll("[data-resolve-waiting]").forEach((button) => button.addEventListener("click", async () => { await ApplyOS.resolveWaitingItem(button.dataset.resolveWaiting); await load(); toast("Waiting item resolved"); }));
  $("#waiting-groups").querySelectorAll("[data-convert-waiting]").forEach((button) => button.addEventListener("click", async () => { const action = await ApplyOS.convertWaitingToFollowUp(button.dataset.convertWaiting); await load(); toast(action ? "Follow-up added to Today" : "Only overdue items can become follow-ups"); }));
}

function renderWaitingPreview() {
  const preview = $("#waiting-preview");
  if (!preview) return;
  const items = state.waiting_items.filter((item) => item.status === "open")
    .sort((a, b) => new Date(a.expected_by || "9999-12-31") - new Date(b.expected_by || "9999-12-31"))
    .slice(0, 3);
  preview.innerHTML = items.length ? items.map(waitingRowHTML).join("") : `<div class="action-empty">Nothing is waiting on someone else.</div>`;
  preview.querySelectorAll(".waiting-row").forEach((row) => row.addEventListener("click", (event) => {
    if (!event.target.closest("button")) openWaiting(row.dataset.waitingId);
  }));
  preview.querySelectorAll("[data-resolve-waiting]").forEach((button) => button.addEventListener("click", async () => { await ApplyOS.resolveWaitingItem(button.dataset.resolveWaiting); await load(); toast("Waiting item resolved"); }));
  preview.querySelectorAll("[data-convert-waiting]").forEach((button) => button.addEventListener("click", async () => { const action = await ApplyOS.convertWaitingToFollowUp(button.dataset.convertWaiting); await load(); toast(action ? "Follow-up added to Home" : "Only overdue items can become follow-ups"); }));
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
  const applicationFilter = $("#action-application-filter");
  const selectedApplication = applicationFilter.value;
  applicationFilter.innerHTML = `<option value="">All applications</option>` + state.applications.map((item) => `<option value="${item.id}">${escapeHTML(item.company)} · ${escapeHTML(item.role)}</option>`).join("");
  applicationFilter.value = selectedApplication;
  const contactFilter = $("#action-contact-filter");
  const selectedContact = contactFilter.value;
  contactFilter.innerHTML = `<option value="">All contacts</option>` + state.contacts.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("");
  contactFilter.value = selectedContact;
  elements.empty.classList.toggle("hidden", state.applications.length > 0);
  elements.board.classList.toggle("hidden", currentView !== "board" || !state.applications.length);
  elements.list.classList.toggle("hidden", currentView !== "list" || !state.applications.length);
  renderBoard(items); renderList(items); renderUpcoming(); renderActions(); renderContacts(); renderCompanies(); renderWaiting(); renderWaitingPreview();
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
  $("#detail-company-id").innerHTML = companyOptions(item.company_id || "");
  $("#detail-status").value = item.status; $("#detail-priority").value = item.priority; $("#detail-deadline").value = ApplyOS.toDateInput(item.deadline);
  $("#detail-follow-up").value = ApplyOS.toDateInput(item.follow_up_date); $("#detail-notes").value = item.notes || "";
  $("#detail-score").textContent = matchLabel(item); $("#detail-bar").style.width = hasJobDescription(item) ? `${item.match_score || 0}%` : "0%";
  $("#detail-skills").textContent = hasJobDescription(item) ? `Matched: ${item.matched_skills?.join(", ") || "No explicit skills yet"}` : "A job description is required to calculate a match.";
  const highlight = item.suggested_experiences?.[0] || item.missing_skills?.join(", ") || item.suggested_keywords?.slice(0, 6).join(", ") || "No major gaps detected";
  $("#detail-missing").textContent = hasJobDescription(item) ? `Consider highlighting: ${highlight}` : "Reopen the job posting or update the saved job after its description is captured.";
  $("#detail-url").href = item.url; $("#detail-applied").classList.toggle("hidden", Boolean(item.applied_at));
  $("#interview-form").classList.add("hidden");
  $("#application-record-details").open = false;
  $("#application-match").open = false;
  document.querySelectorAll("#detail > .detail-workspace").forEach((workspace) => { workspace.open = false; });
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

function renderContactApplicationPicker(selected = []) {
  const selectedIds = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  const picker = $("#contact-application");
  picker.innerHTML = state.applications.length
    ? state.applications.map((item) => `<label class="contact-application-option"><input type="checkbox" value="${escapeHTML(item.id)}" ${selectedIds.has(item.id) ? "checked" : ""}><span><strong>${escapeHTML(item.role)}</strong><small>${escapeHTML(item.company)}</small></span></label>`).join("")
    : `<p class="contact-application-empty">No saved applications yet.</p>`;
}

function linkedContacts(applicationId) {
  return state.contacts.filter((contact) => contact.application_ids.includes(applicationId));
}

function renderLinkedContacts(application) {
  const contacts = linkedContacts(application.id);
  $("#application-contacts-status").textContent = contacts.length ? `${contacts.length} linked` : "No one linked";
  $("#linked-contacts").innerHTML = contacts.length ? contacts.map((contact) => `<div class="linked-contact"><div><strong>${escapeHTML(contact.name)}</strong><span>${escapeHTML([contact.title, contact.email].filter(Boolean).join(" · ") || titleCase(contact.relationship))}</span></div><button data-contact-id="${contact.id}" type="button">Edit</button></div>`).join("") : `<div class="linked-contact"><div><strong>No contacts linked yet</strong><span>Add a recruiter, interviewer, referral, or employee.</span></div></div>`;
  $("#linked-contacts").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { closeDetail(); openContact(button.dataset.contactId); }));
}

function renderInterviews(application) {
  const interviews = state.interviews.filter((item) => item.application_id === application.id).sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0));
  $("#application-interviews-status").textContent = interviews.length ? `${interviews.length} scheduled` : "No interviews scheduled";
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
    return `<article class="timeline-entry"><strong>${escapeHTML(titleCase(item.type))}</strong><span>${escapeHTML(titleCase(item.direction))} · ${escapeHTML(dateTimeLabel(item.occurred_at))}${application ? ` · ${escapeHTML(application.company)}` : ""}</span></article>`;
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
  $("#activity-action").value = prefill.action_id || "";
  $("#activity-complete-action").checked = Boolean(prefill.action_id);
  $("#activity-next-title").value = ""; $("#activity-next-date").value = "";
  $("#activity-type").focus();
}

function renderActionCalendar(action) {
  const panel = $("#action-calendar");
  const available = Boolean(action && action.status === "open");
  panel.classList.toggle("hidden", !available);
  if (!available) return;
  const mapped = Boolean(action.google_calendar_event_id);
  const status = action.calendar_sync_status || "not_synced";
  const labels = {
    syncing: "Synchronizing with Google Calendar…",
    synced: "Added to Google Calendar",
    error: "Google Calendar needs attention",
    disconnected: "Google Calendar is disconnected",
    not_synced: "Not added to Google Calendar"
  };
  $("#action-calendar-status").textContent = labels[status] || labels.not_synced;
  $("#action-calendar-error").textContent = action.calendar_sync_error || "";
  $("#action-calendar-sync").textContent = status === "error" ? "Retry Google Calendar" : mapped ? "Update Google Calendar" : "Add to Google Calendar";
  $("#action-calendar-remove").classList.toggle("hidden", !mapped);
}

async function actionCalendarRequest(type, actionId) {
  const buttons = [$("#action-calendar-sync"), $("#action-calendar-remove"), $("#action-calendar-download")];
  buttons.forEach((button) => { button.disabled = true; });
  let response;
  try { response = await chrome.runtime.sendMessage({ type, actionId }); }
  catch (error) { response = { ok: false, error: error.message }; }
  await load();
  const action = state.reminders.find((item) => item.id === actionId);
  renderActionCalendar(action);
  buttons.forEach((button) => { button.disabled = false; });
  toast(response?.ok ? (type === "APPLYOS_CALENDAR_REMOVE_ACTION" ? "Removed from Google Calendar" : "Google Calendar updated") : response?.error || "Calendar sync failed; the Scout action was preserved");
  return response;
}

function downloadActionCalendar(action) {
  const contents = ApplyOS.calendarICS(action, state);
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ApplyOS.calendarFilename(action);
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  renderActionCalendar(action);
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
  $("#contact-company-id").innerHTML = companyOptions(contact?.company_id || state.applications.find((item) => item.id === applicationId)?.company_id || "");
  $("#contact-relationship").value = contact?.relationship || "recruiter";
  $("#contact-email").value = contact?.email || "";
  $("#contact-phone").value = contact?.phone || "";
  $("#contact-linkedin").value = contact?.linkedin_url || "";
  $("#contact-channel").value = contact?.preferred_channel || (contact?.email ? "email" : contact?.linkedin_url ? "linkedin" : "other");
  $("#contact-tags").value = (contact?.tags || []).join(", ");
  renderContactApplicationPicker(contact?.application_ids?.length ? contact.application_ids : [applicationId].filter(Boolean));
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
  $("#log-interaction").disabled = !contact;
  $("#activity-form").classList.add("hidden");
  renderContactTimeline(contact?.id || "");
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

function renderCompanyContext(company) {
  const applications = state.applications.filter((item) => item.company_id === company.id && !["rejected", "closed"].includes(item.status));
  const contacts = state.contacts.filter((item) => item.company_id === company.id);
  const applicationIds = new Set(applications.map((item) => item.id));
  const contactIds = new Set(contacts.map((item) => item.id));
  const interviews = state.interviews.filter((item) => applicationIds.has(item.application_id) && !item.completed_at && item.scheduled_at && new Date(item.scheduled_at) >= new Date()).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const actions = state.reminders.filter((item) => item.status === "open" && (applicationIds.has(item.application_id) || contactIds.has(item.contact_id))).sort((a, b) => new Date(a.snoozed_until || a.due_at) - new Date(b.snoozed_until || b.due_at));
  const section = (title, items, empty) => `<section><h3>${title}</h3>${items.length ? `<div>${items.join("")}</div>` : `<p>${empty}</p>`}</section>`;
  $("#company-context").innerHTML = [
    section("Active applications", applications.map((item) => `<button data-company-application="${item.id}" type="button"><strong>${escapeHTML(item.role)}</strong><span>${escapeHTML(titleCase(item.status))}</span></button>`), "No active applications."),
    section("Related contacts", contacts.map((item) => `<button data-company-contact="${item.id}" type="button"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.title || titleCase(item.relationship))}</span></button>`), "No related contacts."),
    section("Upcoming interviews", interviews.map((item) => `<article><strong>${escapeHTML(titleCase(item.type))}</strong><span>${escapeHTML(dateTimeLabel(item.scheduled_at))}</span></article>`), "No upcoming interviews."),
    section("Open actions", actions.map((item) => `<article><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(dateLabel(item.snoozed_until || item.due_at))}</span></article>`), "No open actions.")
  ].join("");
  $("#company-context").querySelectorAll("[data-company-application]").forEach((button) => button.addEventListener("click", () => { closeCompany(); showDashboardSection("applications"); openDetail(button.dataset.companyApplication); }));
  $("#company-context").querySelectorAll("[data-company-contact]").forEach((button) => button.addEventListener("click", () => { closeCompany(); showDashboardSection("contacts"); openContact(button.dataset.companyContact); }));
}

function openCompany(id = null) {
  const company = state.companies.find((item) => item.id === id) || null;
  const active = document.activeElement;
  companyReturnFocus = active instanceof HTMLElement ? active : null;
  selectedCompanyId = company?.id || null;
  $("#company-id").value = company?.id || "";
  $("#company-name").value = company?.name || "";
  $("#company-domain").value = company?.domain || "";
  $("#company-website").value = company?.website_url || "";
  $("#company-tags").value = (company?.tags || []).join(", ");
  $("#company-notes").value = company?.notes || "";
  $("#delete-company").classList.toggle("hidden", !company);
  $("#company-context").classList.toggle("hidden", !company);
  if (company) renderCompanyContext(company);
  openDrawer($("#company-detail"));
  $("#company-name").focus();
}

function closeCompany() {
  const detail = $("#company-detail");
  if (!detail.classList.contains("open")) return;
  closeDrawer(detail, companyReturnFocus || $("#company-search"));
  selectedCompanyId = null;
  companyReturnFocus = null;
  elements.scrim.classList.add("hidden");
}

function openWaiting(id = null, context = {}) {
  const item = state.waiting_items.find((entry) => entry.id === id) || null;
  const active = document.activeElement;
  waitingReturnFocus = active instanceof HTMLElement ? active : null;
  selectedWaitingId = item?.id || null;
  $("#waiting-id").value = item?.id || "";
  $("#waiting-what").value = item?.what || "";
  $("#waiting-kind").value = item?.kind || context.kind || "recruiter_reply";
  $("#waiting-application").innerHTML = `<option value="">None</option>` + applicationOptions(item?.application_id || context.application_id || "");
  $("#waiting-contact").innerHTML = `<option value="">None</option>` + state.contacts.map((contact) => `<option value="${contact.id}">${escapeHTML(contact.name)}${contact.company ? ` · ${escapeHTML(contact.company)}` : ""}</option>`).join("");
  $("#waiting-application").value = item?.application_id || context.application_id || "";
  $("#waiting-contact").value = item?.contact_id || context.contact_id || "";
  $("#waiting-since").value = ApplyOS.toDateInput(item?.waiting_since || new Date().toISOString());
  $("#waiting-expected").value = ApplyOS.toDateInput(item?.expected_by);
  $("#waiting-notes").value = item?.notes || "";
  $("#resolve-waiting").classList.toggle("hidden", !item || item.status !== "open");
  $("#convert-waiting").classList.toggle("hidden", !item || waitingGroup(item) !== "overdue");
  openDrawer($("#waiting-detail"));
  $("#waiting-what").focus();
}

function closeWaiting() {
  const detail = $("#waiting-detail");
  if (!detail.classList.contains("open")) return;
  closeDrawer(detail, waitingReturnFocus || $("#add-waiting"));
  selectedWaitingId = null;
  waitingReturnFocus = null;
  elements.scrim.classList.add("hidden");
}

function openInterviewEditor(id = null) {
  $("#application-interviews").open = true;
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
  $("#interview-next-date").value = toDateTimeInput(interview?.next_action_at);
  $("#interview-create-prep").checked = interview?.create_preparation_action !== false;
  $("#interview-prep-date").value = toDateTimeInput(interview?.preparation_action_at || (interview?.scheduled_at ? new Date(new Date(interview.scheduled_at).getTime() - 86400000).toISOString() : null));
  $("#interview-create-thanks").checked = interview?.create_thank_you_action !== false;
  const contacts = linkedContacts(selectedId);
  $("#interview-contact").innerHTML = `<option value="">Not linked</option>` + contacts.map((contact) => `<option value="${contact.id}">${escapeHTML(contact.name)}</option>`).join("");
  $("#interview-contact").value = interview?.interviewer_contact_ids?.[0] || "";
  $("#delete-interview").classList.toggle("hidden", !interview);
  $("#interview-form").classList.remove("hidden");
  updateInterviewActionReview();
  $("#interview-type").focus();
}

function updateInterviewActionReview() {
  const prepEnabled = $("#interview-create-prep").checked;
  const thanksEnabled = $("#interview-create-thanks").checked;
  $("#interview-prep-date").disabled = !prepEnabled;
  $("#interview-next-action").disabled = !thanksEnabled;
  $("#interview-next-date").disabled = !thanksEnabled;
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
  if (["home", "actions"].includes(section)) currentSection = "actions";
  else if (["pipeline", "applications"].includes(section)) currentSection = "applications";
  else if (["network", "contacts"].includes(section)) currentSection = currentNetworkView = "contacts";
  else if (section === "companies") currentSection = currentNetworkView = "companies";
  else currentSection = section === "waiting" ? "waiting" : "actions";
  const visibleSection = currentSection === "applications" ? "pipeline" : ["contacts", "companies"].includes(currentSection) ? "network" : "home";
  document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item.dataset.section === visibleSection));
  globalThis.ScoutHeader?.setActiveNavigation(visibleSection);
  document.querySelectorAll(".application-only").forEach((item) => item.classList.toggle("hidden", currentSection !== "applications"));
  $("#actions-workspace").classList.toggle("hidden", currentSection !== "actions");
  $("#contacts-workspace").classList.toggle("hidden", currentSection !== "contacts");
  $("#companies-workspace").classList.toggle("hidden", currentSection !== "companies");
  $("#waiting-workspace").classList.toggle("hidden", currentSection !== "waiting");
  $("#network-shell").classList.toggle("hidden", !["contacts", "companies"].includes(currentSection));
  document.querySelectorAll("[data-network-view]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.networkView === (currentSection === "companies" ? "companies" : "people"))));
  if (focusSearch && currentSection === "contacts") $("#contact-search").focus();
  if (focusSearch && currentSection === "actions") $("#action-search").focus();
  if (focusSearch && currentSection === "companies") $("#company-search").focus();
}

const contactImportLabels = { name: "Name *", email: "Email", company: "Company", title: "Title", phone: "Phone", linkedin_url: "LinkedIn URL", relationship: "Relationship", tags: "Tags" };

function contactImportMapping() {
  return Object.fromEntries(ApplyOS.CONTACT_IMPORT_FIELDS.map((field) => [field, Number($(`[data-import-field="${field}"]`)?.value ?? -1)]));
}

function importDecisionOptions(row) {
  const options = [`<option value="create" ${row.decision === "create" ? "selected" : ""}>Create new</option>`, `<option value="skip" ${row.decision === "skip" ? "selected" : ""}>Skip row</option>`];
  for (const candidate of row.duplicateCandidates) {
    const value = `merge:${candidate.contactId}`;
    options.push(`<option value="${value}" ${row.decision === "merge" && row.mergeTargetId === candidate.contactId ? "selected" : ""}>Merge with ${escapeHTML(candidate.name)} · ${candidate.reason}${candidate.exact ? " match" : " only"}</option>`);
  }
  return options.join("");
}

function updateContactImportSummary() {
  const counts = contactImportRows.reduce((summary, row) => { summary[row.decision] += 1; return summary; }, { create: 0, merge: 0, skip: 0 });
  setText("#contact-import-summary", `${counts.create} create · ${counts.merge} merge · ${counts.skip} skip`);
  const approved = counts.create + counts.merge;
  $("#contact-import-submit").textContent = `Import ${approved} contact${approved === 1 ? "" : "s"}`;
  $("#contact-import-submit").disabled = approved === 0 || contactImportRows.some((row) => row.errors.length && row.decision !== "skip");
}

function renderContactImportRows() {
  contactImportRows = ApplyOS.stageContactImport(contactImportParsed, contactImportMapping(), state.contacts);
  $("#contact-import-rows").innerHTML = contactImportRows.map((row, index) => {
    const duplicateNote = row.duplicateCandidates.length ? row.duplicateCandidates.map((item) => `${item.name} · ${item.reason}${item.exact ? " match" : " only"}`).join("; ") : "No duplicate found";
    const validation = row.errors.length ? `<span class="import-invalid">${escapeHTML(row.errors.join(" "))}</span>` : `<span class="import-valid">${escapeHTML(duplicateNote)}</span>`;
    return `<tr class="${row.errors.length ? "has-errors" : ""}"><td>${row.rowNumber}</td><td><strong>${escapeHTML(row.input.name || "Missing name")}</strong><span>${escapeHTML(row.input.email || row.input.linkedin_url || "No direct contact")}</span></td><td><strong>${escapeHTML(row.input.company || "—")}</strong><span>${escapeHTML(row.input.title || "—")}</span></td><td>${validation}</td><td><select data-import-decision="${index}" ${row.errors.length ? "disabled" : ""}>${importDecisionOptions(row)}</select></td></tr>`;
  }).join("");
  $("#contact-import-rows").querySelectorAll("[data-import-decision]").forEach((select) => select.addEventListener("change", () => {
    const row = contactImportRows[Number(select.dataset.importDecision)];
    if (select.value.startsWith("merge:")) { row.decision = "merge"; row.mergeTargetId = select.value.slice(6); }
    else { row.decision = select.value; row.mergeTargetId = null; }
    updateContactImportSummary();
  }));
  updateContactImportSummary();
}

function openContactImport(parsed, fileName) {
  contactImportParsed = parsed;
  const inferred = ApplyOS.inferContactImportMapping(parsed.headers);
  $("#contact-import-mapping").innerHTML = ApplyOS.CONTACT_IMPORT_FIELDS.map((field) => `<label><span>${contactImportLabels[field]}</span><select data-import-field="${field}"><option value="-1">Not mapped</option>${parsed.headers.map((header, index) => `<option value="${index}" ${inferred[field] === index ? "selected" : ""}>${escapeHTML(header)}</option>`).join("")}</select></label>`).join("");
  $("#contact-import-mapping").querySelectorAll("select").forEach((select) => select.addEventListener("change", renderContactImportRows));
  setText("#contact-import-file", `${fileName} · ${parsed.rows.length} data row${parsed.rows.length === 1 ? "" : "s"}`);
  setText("#contact-import-error", "");
  renderContactImportRows();
  $("#contact-import-dialog").showModal();
}

function closeContactImport() {
  if ($("#contact-import-dialog").open) $("#contact-import-dialog").close();
  contactImportParsed = null;
  contactImportRows = [];
}

async function importContactsFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error("Choose a CSV smaller than 2 MB.");
  openContactImport(ApplyOS.parseContactCSV(await file.text()), file.name);
}

async function initialize() {
  const access = await requireWorkspaceAccess();
  if (!access) return;
  const query = new URLSearchParams(location.search);
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
  ApplyOS.WAITING_KINDS.forEach((kind) => $("#waiting-kind").insertAdjacentHTML("beforeend", `<option value="${kind}">${titleCase(kind)}</option>`));
  ApplyOS.ACTION_KINDS.forEach((kind) => $("#action-kind-filter").insertAdjacentHTML("beforeend", `<option value="${kind}">${titleCase(kind)}</option>`));
  [["application_deadline", "Application deadline"], ["interview_schedule", "Interview schedule"]].forEach(([value, label]) => $("#action-kind-filter").insertAdjacentHTML("beforeend", `<option value="${value}">${label}</option>`));
  ApplyOS.ACTION_CHANNELS.forEach((channel) => $("#action-channel-filter").insertAdjacentHTML("beforeend", `<option value="${channel}">${titleCase(channel)}</option>`));
  ApplyOS.INTERVIEW_TYPES.forEach((type) => $("#interview-type").insertAdjacentHTML("beforeend", `<option value="${type}">${titleCase(type)}</option>`));
  ApplyOS.INTERVIEW_FORMATS.forEach((format) => $("#interview-format").insertAdjacentHTML("beforeend", `<option value="${format}">${titleCase(format)}</option>`));
  // Contextual coach marks are strictly read-only. Normal dashboard visits
  // refresh any saved scores made stale by profile or resume updates.
  await ApplyOS.refreshApplicationMatches(profile);
  await load();
  const requested = query.get("section") || "home";
  if (requested === "network" && query.get("view") === "companies") currentNetworkView = "companies";
  showDashboardSection(requested);
  if (query.get("action")) openAction(query.get("action"));
}

[elements.search, elements.status, elements.source, elements.priority].forEach((control) => control.addEventListener(control === elements.search ? "input" : "change", render));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button)); render();
}));
document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  showDashboardSection(button.dataset.section, true);
  const url = new URL(location.href);
  if (button.dataset.section === "home") url.searchParams.delete("section");
  else url.searchParams.set("section", button.dataset.section);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}));
document.querySelectorAll("[data-network-view]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.networkView === "companies" ? "companies" : "contacts";
  showDashboardSection(view, true);
  const url = new URL(location.href);
  url.searchParams.set("section", "network");
  if (view === "companies") url.searchParams.set("view", "companies"); else url.searchParams.delete("view");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}));
$("#view-waiting").addEventListener("click", () => {
  showDashboardSection("waiting");
  const url = new URL(location.href); url.searchParams.set("section", "waiting"); history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
});
$("#contact-search").addEventListener("input", renderContacts);
$("#company-search").addEventListener("input", renderCompanies);
[$("#contact-relationship-filter"), $("#contact-action-filter"), $("#contact-sort")].forEach((control) => control.addEventListener("change", renderContacts));
[$("#action-search"), $("#action-kind-filter"), $("#action-priority-filter"), $("#action-channel-filter"), $("#action-application-filter"), $("#action-contact-filter")].forEach((control) => control.addEventListener(control.tagName === "INPUT" ? "input" : "change", renderActions));
$("#add-action").addEventListener("click", () => openAction());
$("#add-contact").addEventListener("click", () => openContact());
$("#add-company").addEventListener("click", () => openCompany());
$("#companies-empty-add").addEventListener("click", () => openCompany());
$("#add-waiting").addEventListener("click", () => openWaiting());
$("#contacts-empty-add").addEventListener("click", () => openContact());
$("#import-contacts").addEventListener("click", () => $("#contacts-csv").click());
$("#contact-view-toggle").addEventListener("click", () => { currentContactView = currentContactView === "cards" ? "list" : "cards"; $("#contact-view-toggle").textContent = currentContactView === "cards" ? "List view" : "Card view"; renderContacts(); });
$("#contacts-csv").addEventListener("change", async () => { try { await importContactsFile($("#contacts-csv").files?.[0]); } catch (error) { toast(error.message); } finally { $("#contacts-csv").value = ""; } });
$("#contact-import-close").addEventListener("click", closeContactImport);
$("#contact-import-cancel").addEventListener("click", closeContactImport);
$("#contact-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#contact-import-submit");
  button.disabled = true;
  try {
    const summary = await ApplyOS.applyContactImportPlan(contactImportRows);
    closeContactImport();
    await load();
    toast(`Import complete · ${summary.created} new · ${summary.merged} merged · ${summary.skipped} skipped`);
  } catch (error) {
    setText("#contact-import-error", error.message || "Scout could not import these contacts.");
    button.disabled = false;
  }
});
$("#add-linked-contact").addEventListener("click", () => { const applicationId = selectedId; closeDetail(); openContact(null, applicationId); });
document.querySelectorAll("#detail > .detail-workspace").forEach((workspace) => workspace.addEventListener("toggle", () => {
  if (!workspace.open) return;
  document.querySelectorAll("#detail > .detail-workspace").forEach((other) => { if (other !== workspace) other.open = false; });
}));
$("#mock").addEventListener("click", async () => { await ApplyOS.seedMockData(); await load(); toast("Sample applications added"); });
$("#close-detail").addEventListener("click", closeDetail);
$("#close-contact").addEventListener("click", closeContact);
$("#close-action").addEventListener("click", closeAction);
$("#close-company").addEventListener("click", closeCompany);
$("#close-waiting").addEventListener("click", closeWaiting);
elements.scrim.addEventListener("click", () => { closeAction(); closeContact(); closeDetail(); closeCompany(); closeWaiting(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if ($("#waiting-detail").classList.contains("open")) closeWaiting(); else if ($("#company-detail").classList.contains("open")) closeCompany(); else if ($("#action-detail").classList.contains("open")) closeAction(); else if ($("#contact-detail").classList.contains("open")) closeContact(); else closeDetail(); } });
$("#detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const application = state.applications.find((item) => item.id === selectedId);
  const status = $("#detail-status").value;
  if (status === "applied" && !application.applied_at) await ApplyOS.markApplicationApplied(selectedId);
  await ApplyOS.updateApplication(selectedId, { role: $("#detail-role").value.trim(), company: $("#detail-company").value.trim(), company_id: $("#detail-company-id").value || null, status, priority: $("#detail-priority").value, deadline: $("#detail-deadline").value || null, notes: $("#detail-notes").value.trim() });
  if ($("#detail-follow-up").value !== ApplyOS.toDateInput(application.follow_up_date)) await ApplyOS.rescheduleFollowUp(selectedId, $("#detail-follow-up").value);
  await load(); openDetail(selectedId); toast("Application updated");
});
$("#detail-applied").addEventListener("click", async () => { await ApplyOS.markApplicationApplied(selectedId); await load(); openDetail(selectedId); toast("Applied · follow-ups scheduled for 7 and 14 days"); });
$("#mark-application-waiting").addEventListener("click", () => { const applicationId = selectedId; closeDetail(); openWaiting(null, { application_id: applicationId, kind: "recruiter_reply" }); });
$("#delete-application").addEventListener("click", async () => {
  const application = state.applications.find((item) => item.id === selectedId);
  if (!application || !await ScoutDialog.confirm({ eyebrow: "DELETE APPLICATION", title: `Remove ${application.role}?`, message: `${application.company} will be removed from your Scout pipeline.`, consequences: ["Open system actions will be cancelled.", "Completed and skipped history will remain.", "Interview workspaces for this application will be removed."], tone: "danger", confirmLabel: "Delete application", cancelLabel: "Keep application" })) return;
  const id = selectedId;
  closeDetail();
  await ApplyOS.deleteApplication(id);
  await load();
  toast("Application deleted");
});
$("#company-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saved = await ApplyOS.upsertCompany({
    id: selectedCompanyId || undefined,
    name: $("#company-name").value.trim(),
    domain: $("#company-domain").value.trim(),
    website_url: $("#company-website").value.trim(),
    tags: $("#company-tags").value.split(",").map((item) => item.trim()).filter(Boolean),
    notes: $("#company-notes").value.trim()
  });
  await load();
  closeCompany();
  if (saved) openCompany(saved.id);
  toast("Company saved");
});
$("#delete-company").addEventListener("click", async () => {
  const company = state.companies.find((item) => item.id === selectedCompanyId);
  if (!company || !await ScoutDialog.confirm({ eyebrow: "DELETE COMPANY", title: `Delete ${company.name}?`, message: "The company record will be removed, but the applications and contacts stay in Scout.", consequences: ["Applications and contacts will be detached.", "Their displayed company names will not change."], tone: "danger", confirmLabel: "Delete company", cancelLabel: "Keep company" })) return;
  await ApplyOS.deleteCompany(company.id);
  await load();
  closeCompany();
  toast("Company deleted · linked records kept");
});

$("#waiting-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const applicationId = $("#waiting-application").value || null;
  const contactId = $("#waiting-contact").value || null;
  if (!applicationId && !contactId) return toast("Link an application or contact");
  const saved = await ApplyOS.upsertWaitingItem({
    id: selectedWaitingId || undefined,
    kind: $("#waiting-kind").value,
    what: $("#waiting-what").value.trim(),
    application_id: applicationId,
    contact_id: contactId,
    waiting_since: new Date(`${$("#waiting-since").value}T12:00:00`).toISOString(),
    expected_by: $("#waiting-expected").value ? new Date(`${$("#waiting-expected").value}T12:00:00`).toISOString() : null,
    notes: $("#waiting-notes").value.trim()
  });
  await load();
  closeWaiting();
  if (saved) openWaiting(saved.id);
  toast("Waiting item saved");
});
$("#resolve-waiting").addEventListener("click", async () => { if (!selectedWaitingId) return; await ApplyOS.resolveWaitingItem(selectedWaitingId); await load(); closeWaiting(); toast("Waiting item resolved"); });
$("#convert-waiting").addEventListener("click", async () => { if (!selectedWaitingId) return; const action = await ApplyOS.convertWaitingToFollowUp(selectedWaitingId); await load(); closeWaiting(); if (action) { showDashboardSection("actions"); toast("Follow-up added to Today"); } else toast("Only overdue items can become follow-ups"); });

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const applicationIds = Array.from($("#contact-application").querySelectorAll("input:checked"), (input) => input.value).filter(Boolean);
  const previous = state.contacts.find((item) => item.id === selectedContactId);
  const saved = await ApplyOS.upsertContact({
    id: selectedContactId || undefined,
    name: $("#contact-name").value.trim(), title: $("#contact-title").value.trim(), company: $("#contact-company").value.trim(),
    ...(selectedContactId || $("#contact-company-id").value ? { company_id: $("#contact-company-id").value || null } : {}),
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
$("#mark-contact-waiting").addEventListener("click", () => { if (!selectedContactId) return toast("Save the contact before marking it waiting"); const contactId = selectedContactId; closeContact(); openWaiting(null, { contact_id: contactId, kind: "recruiter_reply" }); });
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
    occurred_at: toISOFromInput($("#activity-when").value)
  }, {
    complete_action_id: $("#activity-complete-action").checked ? actionId : "",
    next_action: $("#activity-next-title").value.trim() && $("#activity-next-date").value ? {
      title: $("#activity-next-title").value.trim(), due_at: toISOFromInput($("#activity-next-date").value), priority: "medium", channel: contact.preferred_channel || "email", application_id: contact.application_ids[0] || null
    } : null
  });
  await load(); selectedContactId = contact.id; renderContactTimeline(contact.id); $("#activity-form").classList.add("hidden"); toast("Interaction logged");
});

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
$("#action-calendar-sync").addEventListener("click", async () => {
  if (selectedActionId) await actionCalendarRequest("APPLYOS_CALENDAR_SYNC_ACTION", selectedActionId);
});
$("#action-calendar-remove").addEventListener("click", async () => {
  if (selectedActionId) await actionCalendarRequest("APPLYOS_CALENDAR_REMOVE_ACTION", selectedActionId);
});
$("#action-calendar-download").addEventListener("click", () => {
  const action = state.reminders.find((item) => item.id === selectedActionId && item.status === "open");
  if (!action) return;
  try { downloadActionCalendar(action); toast("Calendar event downloaded"); }
  catch (error) { toast(error.message); }
});

$("#add-interview").addEventListener("click", () => openInterviewEditor());
$("#cancel-interview").addEventListener("click", () => { selectedInterviewId = null; $("#interview-form").classList.add("hidden"); });
[$("#interview-create-prep"), $("#interview-create-thanks")].forEach((control) => control.addEventListener("change", updateInterviewActionReview));
$("#interview-scheduled").addEventListener("change", () => {
  if (!$("#interview-prep-date").value && $("#interview-scheduled").value) {
    const scheduled = toISOFromInput($("#interview-scheduled").value);
    $("#interview-prep-date").value = toDateTimeInput(new Date(new Date(scheduled).getTime() - 86400000).toISOString());
  }
});
$("#interview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await ApplyOS.upsertInterview({
    id: selectedInterviewId || undefined, application_id: selectedId, type: $("#interview-type").value, format: $("#interview-format").value,
    scheduled_at: toISOFromInput($("#interview-scheduled").value), location: $("#interview-location").value.trim(), meeting_url: $("#interview-url").value.trim(),
    interviewer_contact_ids: $("#interview-contact").value ? [$("#interview-contact").value] : [], company_research: $("#interview-research").value.trim(),
    preparation_notes: $("#interview-prep").value.trim(), question_notes: $("#interview-questions").value.trim(), next_action: $("#interview-next-action").value.trim(),
    next_action_at: toISOFromInput($("#interview-next-date").value), create_thank_you_action: $("#interview-create-thanks").checked,
    create_preparation_action: $("#interview-create-prep").checked, preparation_action_at: toISOFromInput($("#interview-prep-date").value)
  });
  await load(); openDetail(selectedId); toast("Interview workspace saved");
});
$("#delete-interview").addEventListener("click", async () => {
  if (!selectedInterviewId || !await ScoutDialog.confirm({ eyebrow: "DELETE INTERVIEW", title: "Delete this interview workspace?", message: "The application will stay in your pipeline.", consequences: ["Open interview actions will be cancelled.", "Completed and skipped action history will remain."], tone: "danger", confirmLabel: "Delete interview", cancelLabel: "Keep interview" })) return;
  const applicationId = selectedId; await ApplyOS.deleteInterview(selectedInterviewId); await load(); openDetail(applicationId); toast("Interview deleted");
});
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
