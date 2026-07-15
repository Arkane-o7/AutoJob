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
let currentView = "board";
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
  const items = [...reminders, ...deadlines].filter((item) => item.application).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 8);
  elements.upcoming.innerHTML = items.length ? items.map((item) => `<button class="upcoming-card ${item.kind === "deadline" ? "deadline" : ""}" data-id="${item.application.id}" type="button"><strong>${escapeHTML(item.application.role)}</strong><span>${item.kind === "deadline" ? "Deadline" : "Follow-up"} · ${dateLabel(item.at)}</span></button>`).join("") : `<span class="upcoming-card"><strong>Nothing urgent</strong><span>Your next actions will appear here.</span></span>`;
  elements.upcoming.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id)));
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
  renderBoard(items); renderList(items); renderUpcoming();
}

async function load() {
  state = await ApplyOS.refreshDueApplications();
  render();
}

function openDetail(id) {
  const item = state.applications.find((application) => application.id === id);
  if (!item) return;
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
  $("#ai-output-wrap").classList.add("hidden");
  elements.detail.classList.add("open"); elements.detail.setAttribute("aria-hidden", "false"); elements.scrim.classList.remove("hidden");
  $("#detail-role").focus();
}

function closeDetail() {
  selectedId = null; elements.detail.classList.remove("open"); elements.detail.setAttribute("aria-hidden", "true"); elements.scrim.classList.add("hidden");
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
  await load();
}

[elements.search, elements.status, elements.source, elements.priority].forEach((control) => control.addEventListener(control === elements.search ? "input" : "change", render));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button)); render();
}));
$("#mock").addEventListener("click", async () => { await ApplyOS.seedMockData(); await load(); toast("Sample applications added"); });
$("#profile").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#active-profile").addEventListener("change", async (event) => { await ApplyOS.setActiveProfile(event.target.value); window.location.reload(); });
$("#close-detail").addEventListener("click", closeDetail); elements.scrim.addEventListener("click", closeDetail);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetail(); });
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
  const draft = ApplyOS.generateFollowUpDraft(application, profile, $("#draft-type").value); $("#draft-subject").value = draft.subject; $("#draft-body").value = draft.body; $("#draft").classList.remove("hidden");
});
$("#copy-draft").addEventListener("click", async () => { await navigator.clipboard.writeText(`Subject: ${$("#draft-subject").value}\n\n${$("#draft-body").value}`); toast("Draft copied for manual review"); });
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
