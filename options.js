const form = document.querySelector("#profile-form");
const resumeInput = document.querySelector("#resume-file");
const fileTitle = document.querySelector("#file-title");
const fileDetail = document.querySelector("#file-detail");
const removeResumeButton = document.querySelector("#remove-resume");
const resumeTextInput = form.elements.namedItem("resumeText");
const resumeTextStatus = document.querySelector("#resume-text-status");
const customAnswers = document.querySelector("#custom-answers");
const addAnswerButton = document.querySelector("#add-answer");
const saveStatus = document.querySelector("#save-status");

let savedResume = null;
let pendingResume = null;
let profilesIndex = null;
let pendingRestore = null;
document.body.inert = true;

function accountGateUrl(reason) {
  const url = new URL(chrome.runtime.getURL("account.html"));
  url.searchParams.set("reason", reason);
  url.searchParams.set("returnTo", `options.html${location.search}${location.hash}`);
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
  if (status.offlineAuthorized === true) {
    globalThis.ScoutHeader?.setStatus("Offline · cached", "offline");
  }
  return status;
}

function setBackupStatus(message, tone = "") {
  const status = document.querySelector("#backup-status");
  status.textContent = message;
  status.className = tone;
}

function setCalendarOperation(message = "", tone = "") {
  const element = document.querySelector("#calendar-operation-status");
  element.textContent = message;
  element.className = `calendar-operation-status${tone ? ` ${tone}` : ""}`;
}

async function sendCalendarMessage(type, details = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...details }); }
  catch (error) { return { ok: false, error: error.message }; }
}

async function refreshCalendarStatus(existingState = null) {
  const [response, state] = await Promise.all([
    sendCalendarMessage("APPLYOS_CALENDAR_STATUS"),
    existingState ? Promise.resolve(existingState) : ApplyOS.getState()
  ]);
  const connected = response?.ok && response.status?.connected === true;
  const badge = document.querySelector("#calendar-connection-state");
  badge.textContent = connected ? "CONNECTED" : "DISCONNECTED";
  badge.classList.toggle("connected", connected);
  document.querySelector("#calendar-connection-label").textContent = connected ? "Google Calendar connected" : "Google Calendar disconnected";
  document.querySelector("#calendar-connection-detail").textContent = connected ? "Scout will use the primary calendar only." : "Connect only when you want Scout to manage calendar events.";
  document.querySelector("#calendar-connect").classList.toggle("hidden", connected);
  document.querySelector("#calendar-disconnect").classList.toggle("hidden", !connected);
  document.querySelector("#calendar-sync-all").disabled = !connected;
  const autoSync = document.querySelector("#calendar-auto-sync");
  autoSync.checked = state.settings.calendar_auto_sync === true;
  autoSync.disabled = !connected;
  return connected;
}

function downloadTextFile(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.style.display = "none";
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backupSummaryText(summary) {
  const created = new Date(summary.created_at);
  const date = Number.isNaN(created.getTime()) ? summary.created_at : created.toLocaleString();
  return `${summary.profiles} profiles · ${summary.applications} applications · ${summary.contacts} contacts · ${summary.actions || 0} open actions · ${summary.activities || 0} interactions · ${summary.interviews} interviews · ${summary.answers} remembered answers · Created ${date} with Scout ${summary.extension_version}`;
}

function createAnswerRow(answer = {}) {
  const row = document.createElement("div");
  row.className = "answer-row";
  if (answer.source === "application") {
    row.dataset.answerSource = "application";
    row.dataset.learnedAt = answer.learned_at || answer.updated_at || "";
    row.classList.add("learned-answer-row");
  }

  const questionLabel = document.createElement("label");
  const questionTitle = document.createElement("span");
  questionTitle.textContent = "Question phrase";
  if (answer.source === "application") {
    const learnedBadge = document.createElement("small");
    learnedBadge.className = "learned-answer-badge";
    learnedBadge.textContent = "Learned from an application";
    questionTitle.append(learnedBadge);
  }
  questionLabel.append(questionTitle);
  const question = document.createElement("input");
  question.className = "custom-question";
  question.placeholder = "e.g. Why do you want to work here?";
  question.value = answer.question || "";
  questionLabel.append(question);

  const answerLabel = document.createElement("label");
  answerLabel.innerHTML = "<span>Your answer</span>";
  const text = document.createElement("textarea");
  text.className = "custom-answer";
  text.placeholder = "Your reusable answer";
  text.value = answer.answer || "";
  answerLabel.append(text);

  const scopeWrap = document.createElement("div");
  scopeWrap.className = "answer-scope-wrap";
  const scopeLabel = document.createElement("label");
  const scopeTitle = document.createElement("span");
  scopeTitle.textContent = "Where to reuse";
  const scope = document.createElement("select");
  scope.className = "custom-answer-scope";
  scope.append(new Option("Any employer", "global"), new Option("One company only", "company"));
  scope.value = answer.scope === "company" ? "company" : "global";
  scopeLabel.append(scopeTitle, scope);
  const domainLabel = document.createElement("label");
  domainLabel.className = "answer-domain";
  const domainTitle = document.createElement("span");
  domainTitle.textContent = "Company domain";
  const domain = document.createElement("input");
  domain.className = "custom-answer-domain";
  domain.placeholder = "e.g. microsoft.com";
  domain.value = answer.company_domain || answer.companyDomain || "";
  domainLabel.append(domainTitle, domain);
  const updateScope = () => {
    const companyOnly = scope.value === "company";
    domainLabel.classList.toggle("hidden", !companyOnly);
    domain.required = companyOnly;
  };
  scope.addEventListener("change", updateScope);
  updateScope();
  scopeWrap.append(scopeLabel, domainLabel);

  const remove = document.createElement("button");
  remove.className = "delete-answer";
  remove.type = "button";
  remove.setAttribute("aria-label", "Delete custom answer");
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    row.remove();
    markUnsaved();
  });

  row.append(questionLabel, answerLabel, scopeWrap, remove);
  customAnswers.append(row);
}

async function startProfileTour() {
  const force = new URLSearchParams(location.search).get("tour") === "1";
  await ScoutTour.start({
    id: "main",
    surface: "options",
    force,
    steps: [
      {
        target: '[data-tour-target="profile-switcher"]',
        eyebrow: "ROLE-SPECIFIC PROFILES",
        title: "Keep more than one version of you.",
        body: "Create focused profiles for different role types, then choose which one Scout uses for matching and autofill.",
        placement: "right"
      },
      {
        target: '[data-tour-target="identity"]',
        eyebrow: "CORE DETAILS",
        title: "Your application source of truth.",
        body: "Identity, contact details, links, address, employment, education, and work preferences live here. Scout only fills facts you have provided.",
        placement: "bottom"
      },
      {
        target: '[data-tour-target="resume"]',
        eyebrow: "RESUME",
        title: "Save the file and the evidence.",
        body: "The PDF or DOCX is used for supported upload fields. Resume text powers private matching, keyword gaps, and review-first Smart Tools.",
        placement: "top"
      },
      {
        target: '[data-tour-target="answers"]',
        eyebrow: "ANSWER MEMORY",
        title: "Teach Scout repeated questions.",
        body: "Save reviewed answers once, optionally scope sensitive employer-history answers to one company, and reuse them when similar questions appear.",
        placement: "top"
      },
      {
        target: '[data-tour-target="save-profile"]',
        eyebrow: "YOU STAY IN CONTROL",
        title: "Review, then save your profile.",
        body: "Nothing on this page changes until you choose Save profile. You can edit these details at any time; Scout still never submits an application for you.",
        placement: "top",
        nextLabel: "Finish tour →"
      }
    ],
    onFinish: () => {
      saveStatus.textContent = "Tour complete · add any missing details, then Save profile";
      history.replaceState(null, "", chrome.runtime.getURL("options.html"));
    }
  });
}

function markUnsaved() {
  saveStatus.textContent = "Unsaved changes";
}

function showResume(resume) {
  if (!resume) {
    fileTitle.textContent = "Choose a PDF or DOCX";
    fileDetail.textContent = "Best-effort attachment on supported forms · 8 MB maximum";
    removeResumeButton.classList.add("hidden");
    return;
  }
  fileTitle.textContent = resume.name;
  const size = Number(resume.size || 0);
  fileDetail.textContent = resume.dataUrl
    ? `${(size / 1024 / 1024).toFixed(2)} MB · saved securely and ready to attach`
    : "File contents are missing from this older profile · choose the file again, then Save profile";
  removeResumeButton.classList.remove("hidden");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isPdfResume(resume) {
  return /application\/pdf/i.test(String(resume?.type || "")) || /\.pdf$/i.test(String(resume?.name || ""));
}

function setResumeTextStatus(message, tone = "") {
  resumeTextStatus.textContent = message;
  if (tone) resumeTextStatus.dataset.tone = tone;
  else delete resumeTextStatus.dataset.tone;
}

async function extractAndApplyResumeText(source, { allowReplace = false } = {}) {
  setResumeTextStatus("Extracting text privately on this device…");
  try {
    const extracted = await ApplyOS.extractPdfText(source);
    if (extracted.length < 40) {
      setResumeTextStatus("This PDF contains little or no selectable text. It may be scanned; paste or type the resume text here instead.", "warning");
      return false;
    }

    const current = resumeTextInput.value.trim();
    const sameText = ApplyOS.normalizeExtractedResumeText(current) === extracted;
    if (current && !sameText) {
      const replace = allowReplace && await ScoutDialog.confirm({ eyebrow: "RESUME TEXT", title: "Replace the existing text?", message: "Scout extracted selectable text from the new PDF. You can use it for matching and Smart Tools instead of the text currently saved.", confirmLabel: "Use extracted text", cancelLabel: "Keep existing text" });
      if (!replace) {
        setResumeTextStatus(`Extracted ${extracted.length.toLocaleString()} characters. Your existing resume text was kept.`, "success");
        return false;
      }
    }

    if (!sameText) {
      resumeTextInput.value = extracted;
      markUnsaved();
    }
    setResumeTextStatus(`Extracted ${extracted.length.toLocaleString()} characters locally. Review the text, then save your profile.`, "success");
    return true;
  } catch (error) {
    console.error("Resume text extraction failed", error);
    setResumeTextStatus("Scout could not read text from this PDF. The file is still saved for attachment; paste the text here for matching.", "warning");
    return false;
  }
}

async function initialize() {
  const access = await requireWorkspaceAccess();
  if (!access) return;
  profilesIndex = await ApplyOS.getProfilesIndex();
  const [profile, state] = await Promise.all([ApplyOS.getActiveProfile(), ApplyOS.getState()]);
  const profileSelect = document.querySelector("#profile-select");
  profileSelect.replaceChildren(...profilesIndex.profiles.map((meta) => {
    const option = document.createElement("option"); option.value = meta.id; option.textContent = meta.targetRole ? `${meta.name} · ${meta.targetRole}` : meta.name; return option;
  }));
  profileSelect.value = profilesIndex.activeId;
  for (const element of form.elements) {
    if (element.name && Object.hasOwn(profile, element.name)) element.value = profile[element.name] ?? "";
  }
  savedResume = profile.resume || null;
  showResume(savedResume);
  if (savedResume?.dataUrl && isPdfResume(savedResume) && !resumeTextInput.value.trim()) {
    await extractAndApplyResumeText(savedResume.dataUrl);
  } else if (savedResume && !isPdfResume(savedResume)) {
    setResumeTextStatus("Automatic text extraction currently supports PDF resumes. For DOC or DOCX files, paste the text here.", "warning");
  } else if (resumeTextInput.value.trim()) {
    setResumeTextStatus("Saved resume text is ready for matching and Smart Tools.", "success");
  }
  (profile.customAnswers || []).forEach(createAnswerRow);
  if (!(profile.customAnswers || []).length) createAnswerRow();
  saveStatus.textContent = profile.firstName ? "Profile saved" : "Complete your profile";
  const config = await ApplyOS.getAIConfig();
  document.querySelector("#ai-endpoint").value = config.endpoint;
  document.querySelector("#ai-model").value = config.chatModel;
  document.querySelector("#embedding-model").value = config.embeddingModel;
  if (config.enabled) { document.querySelector("#ai-result").textContent = `Connected · Ollama ${config.version || "ready"}`; document.querySelector("#ai-result").className = "success"; }
  document.querySelector("#undo-restore").classList.toggle("hidden", !(await ApplyOS.hasRestoreCheckpoint()));
  document.querySelector("#enable-notifications").checked = state.settings.notification_enabled !== false;
  document.querySelector("#follow-up-offsets").value = (state.settings.follow_up_offsets_days || [7, 14]).join(", ");
  document.querySelector("#notification-digest-time").value = state.settings.notification_digest_time || "09:00";
  await refreshCalendarStatus(state);
  const desktopGranted = await chrome.permissions?.contains?.({ permissions: ["notifications"] }).catch(() => false);
  document.querySelector("#desktop-notification-status").textContent = desktopGranted && state.settings.desktop_notifications_enabled ? "Enabled" : desktopGranted ? "Permission granted · turn on" : "Not enabled";
  document.querySelector("#enable-desktop-notifications").textContent = desktopGranted && state.settings.desktop_notifications_enabled ? "Disable desktop reminders" : "Enable desktop reminders";
  await startProfileTour();
}

resumeInput.addEventListener("change", async () => {
  const file = resumeInput.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    await ScoutDialog.alert({ eyebrow: "UPLOAD LIMIT", title: "That resume is too large.", message: "Choose a resume smaller than 8 MB, then try again.", confirmLabel: "Choose another file" });
    resumeInput.value = "";
    return;
  }
  const allowed = /pdf|msword|officedocument/.test(file.type) || /\.(pdf|doc|docx)$/i.test(file.name);
  if (!allowed) {
    await ScoutDialog.alert({ eyebrow: "FILE TYPE", title: "That format isn’t supported.", message: "Choose a PDF, DOC, or DOCX resume, then try again.", confirmLabel: "Choose another file" });
    resumeInput.value = "";
    return;
  }
  pendingResume = { name: file.name, type: file.type, size: file.size, dataUrl: await fileToDataUrl(file) };
  showResume(pendingResume);
  if (isPdfResume(pendingResume)) {
    await extractAndApplyResumeText(file, { allowReplace: true });
  } else {
    setResumeTextStatus("Automatic text extraction currently supports PDF resumes. Paste the DOC or DOCX text here.", "warning");
  }
  markUnsaved();
});

removeResumeButton.addEventListener("click", () => {
  savedResume = null;
  pendingResume = null;
  resumeInput.value = "";
  showResume(null);
  setResumeTextStatus(resumeTextInput.value.trim()
    ? "The saved file was removed. Your editable resume text is still available."
    : "PDF text is extracted privately on this device when you upload your resume.");
  markUnsaved();
});

addAnswerButton.addEventListener("click", () => {
  createAnswerRow();
  customAnswers.lastElementChild.querySelector("input").focus();
  markUnsaved();
});

form.addEventListener("input", (event) => { if (!event.target.closest("#backup, #calendar")) markUnsaved(); });
form.addEventListener("change", (event) => { if (!event.target.closest("#backup, #calendar")) markUnsaved(); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  delete data["resume-file"];
  data.fullName = `${data.firstName} ${data.lastName}`.trim();
  data.resume = pendingResume || savedResume || null;
  data.customAnswers = Array.from(customAnswers.querySelectorAll(".answer-row"))
    .map((row) => ({
      question: row.querySelector(".custom-question").value.trim(),
      answer: row.querySelector(".custom-answer").value.trim(),
      scope: row.querySelector(".custom-answer-scope").value,
      company_domain: row.querySelector(".custom-answer-domain").value.trim().toLowerCase(),
      ...(row.dataset.answerSource === "application" ? {
        source: "application",
        learned_at: row.dataset.learnedAt || new Date().toISOString()
      } : {})
    }))
    .filter((item) => item.question && item.answer);
  data.updatedAt = new Date().toISOString();

  try {
    const profileId = profilesIndex?.activeId || "default";
    const savedProfile = await ApplyOS.completeOnboarding(data);
    await ApplyOS.updateSettings({
      final_follow_up_enabled: document.querySelector("#follow-up-offsets").value.split(",").map(Number).includes(14),
      notification_enabled: document.querySelector("#enable-notifications").checked,
      follow_up_offsets_days: document.querySelector("#follow-up-offsets").value.split(",").map((item) => Number(item.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 60),
      notification_digest_time: document.querySelector("#notification-digest-time").value || "09:00",
      calendar_auto_sync: document.querySelector("#calendar-auto-sync").checked
    });
    await ApplyOS.syncAnswerMemory(data.customAnswers, {
      authoritative: true,
      removeLegacyProfileEntries: true,
      source: "profile",
      profileId,
      memoryGroup: `custom:${profileId}`
    });
    await ApplyOS.syncProfileAnswerDefaults(savedProfile);
    await ApplyOS.reconcileProfileGraphAnswers(profileId, data.customAnswers);
    await Promise.all(data.customAnswers.map((item) => ApplyOS.recordGraphAnswer({
      question: item.question,
      answer: item.answer,
      source: "profile",
      profileId,
      scope: item.scope,
      companyDomain: item.company_domain,
      confidence: 1
    })));
    const resumeVersion = await ApplyOS.syncResumeVersion(data.resume);
    if (resumeVersion) await ApplyOS.patchActiveProfile({ currentResumeVersionId: resumeVersion.id });
    savedResume = data.resume;
    pendingResume = null;
    saveStatus.textContent = "Saved just now";
    window.setTimeout(() => { saveStatus.textContent = "Profile saved"; }, 2200);
  } catch (error) {
    saveStatus.textContent = "Could not save — storage error";
    console.error(error);
  }
});

initialize().catch((error) => {
  document.body.inert = false;
  saveStatus.textContent = `Could not load profile — ${error.message}`;
});

document.querySelector("#calendar-connect").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Opening Google authorization…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_CONNECT");
  button.disabled = false;
  if (!response?.ok) {
    const cancelled = response?.status?.reason === "cancelled";
    setCalendarOperation(cancelled ? "Connection cancelled. Scout reminders were not changed." : response?.error || "Google Calendar could not be connected.", cancelled ? "" : "error");
    await refreshCalendarStatus();
    return;
  }
  setCalendarOperation(response.status?.already_authorized ? "Google Calendar was already authorized." : "Google Calendar connected. Existing reminders remain unsynced until you choose Sync all.", "success");
  await refreshCalendarStatus();
});

document.querySelector("#calendar-auto-sync").addEventListener("change", async (event) => {
  await ApplyOS.updateSettings({ calendar_auto_sync: event.target.checked });
  setCalendarOperation(event.target.checked ? "New open reminders will sync automatically." : "Automatic synchronization is off.", "success");
});

document.querySelector("#calendar-sync-all").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Synchronizing open reminders…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_SYNC_ALL");
  button.disabled = false;
  const result = response?.result;
  if (!response?.ok) setCalendarOperation(response?.error || "Some reminders could not be synchronized.", "error");
  else setCalendarOperation(`${result.synced} open reminder${result.synced === 1 ? "" : "s"} synchronized.`, "success");
});

document.querySelector("#calendar-disconnect").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Disconnecting Google Calendar…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_DISCONNECT");
  button.disabled = false;
  if (!response?.ok) setCalendarOperation(response?.error || "Google Calendar could not be disconnected.", "error");
  else setCalendarOperation("Disconnected. Existing Google events were left in place.", "success");
  await refreshCalendarStatus();
});

document.querySelector("#enable-desktop-notifications").addEventListener("click", async () => {
  const status = document.querySelector("#desktop-notification-status");
  const current = await chrome.permissions.contains({ permissions: ["notifications"] });
  const state = await ApplyOS.getState();
  if (current && state.settings.desktop_notifications_enabled) {
    await ApplyOS.updateSettings({ desktop_notifications_enabled: false });
    status.textContent = "Disabled";
    document.querySelector("#enable-desktop-notifications").textContent = "Enable desktop reminders";
    return;
  }
  const granted = current || await chrome.permissions.request({ permissions: ["notifications"] });
  await ApplyOS.updateSettings({ desktop_notifications_enabled: granted });
  status.textContent = granted ? "Enabled" : "Permission not granted";
  document.querySelector("#enable-desktop-notifications").textContent = granted ? "Disable desktop reminders" : "Enable desktop reminders";
});

document.querySelector("#profile-select").addEventListener("change", async (event) => { await ApplyOS.setActiveProfile(event.target.value); window.location.reload(); });
document.querySelector("#new-profile").addEventListener("click", async () => {
  const values = await ScoutDialog.form({ eyebrow: "NEW PROFILE", title: "Create another version of you.", message: "Use profiles to keep different resumes, answers, and targets organized.", fields: [{ name: "name", label: "Profile name", placeholder: "Frontend roles", required: true, maxLength: 80 }, { name: "targetRole", label: "Target role (optional)", placeholder: "Senior Frontend Engineer", maxLength: 120 }], confirmLabel: "Create profile", cancelLabel: "Not now" });
  if (!values?.name.trim()) return;
  await ApplyOS.createProfile(values.name.trim(), values.targetRole.trim(), profilesIndex?.activeId); window.location.reload();
});
document.querySelector("#rename-profile").addEventListener("click", async () => {
  const current = profilesIndex.profiles.find((item) => item.id === profilesIndex.activeId);
  const values = await ScoutDialog.form({ eyebrow: "EDIT PROFILE", title: "Rename this profile.", message: "The saved application data in your CRM will not change.", fields: [{ name: "name", label: "Profile name", value: current?.name || "", required: true, maxLength: 80 }, { name: "targetRole", label: "Target role (optional)", value: current?.targetRole || "", maxLength: 120 }], confirmLabel: "Save profile name", cancelLabel: "Keep current name" });
  if (!values?.name.trim()) return;
  await ApplyOS.updateProfileMeta(profilesIndex.activeId, { name: values.name.trim(), targetRole: values.targetRole.trim() });
  window.location.reload();
});
document.querySelector("#delete-profile").addEventListener("click", async () => {
  const current = profilesIndex.profiles.find((item) => item.id === profilesIndex.activeId);
  if (profilesIndex.profiles.length <= 1) { await ScoutDialog.alert({ eyebrow: "PROFILE REQUIRED", title: "Keep at least one profile.", message: "Scout needs one active profile for autofill and saved answers.", confirmLabel: "Keep profile" }); return; }
  if (!await ScoutDialog.confirm({ eyebrow: "DELETE PROFILE", title: `Delete “${current?.name || "this profile"}”?`, message: "Applications will remain in the CRM.", consequences: ["The profile’s resume, autofill details, and saved answers will be removed."], tone: "danger", confirmLabel: "Delete profile", cancelLabel: "Keep profile" })) return;
  await ApplyOS.deleteProfile(profilesIndex.activeId);
  window.location.reload();
});
document.querySelector("#test-ai").addEventListener("click", async (event) => {
  const button = event.currentTarget; const result = document.querySelector("#ai-result"); button.disabled = true; result.className = ""; result.textContent = "Checking…";
  const endpoint = document.querySelector("#ai-endpoint").value.trim();
  try {
    const origin = new URL(endpoint).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Localhost access was not granted. Smart Tools remain available without it.");
    await ApplyOS.saveAIConfig({ endpoint, chatModel: document.querySelector("#ai-model").value.trim(), embeddingModel: document.querySelector("#embedding-model").value.trim() });
    const status = await ApplyOS.testAIConnection(); result.className = status.success ? "success" : "error"; result.textContent = status.success ? `Connected · ${status.config.chatModel} · Ollama ${status.version}` : status.error;
    if (status.success) document.querySelector("#ai-model").value = status.config.chatModel;
  } catch (error) { result.className = "error"; result.textContent = error.message; }
  button.disabled = false;
});

document.querySelector("#export-backup").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const password = document.querySelector("#backup-password").value;
  const confirmation = document.querySelector("#backup-confirm").value;
  if (password !== confirmation) { setBackupStatus("Backup passwords do not match.", "error"); return; }
  button.disabled = true; setBackupStatus("Encrypting locally…");
  try {
    const result = await ApplyOS.exportEncryptedBackup(password, chrome.runtime.getManifest().version);
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(result.serialized, `scout-backup-${date}.scout`);
    setBackupStatus(`Encrypted backup downloaded · ${backupSummaryText(result.summary)}`, "success");
    document.querySelector("#backup-password").value = ""; document.querySelector("#backup-confirm").value = "";
  } catch (error) { setBackupStatus(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelector("#preview-backup").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const file = document.querySelector("#backup-file").files?.[0];
  if (!file) { setBackupStatus("Choose an encrypted Scout backup first.", "error"); return; }
  if (file.size > 64 * 1024 * 1024) { setBackupStatus("This backup is larger than the 64 MB restore limit.", "error"); return; }
  button.disabled = true; pendingRestore = null; setBackupStatus("Decrypting locally…");
  try {
    pendingRestore = await ApplyOS.decryptBackup(await file.text(), document.querySelector("#restore-password").value);
    const summary = ApplyOS.backupSummary(pendingRestore);
    document.querySelector("#backup-summary-title").textContent = `Scout ${summary.extension_version} backup`;
    document.querySelector("#backup-summary").textContent = backupSummaryText(summary);
    document.querySelector("#restore-confirmation").value = "";
    document.querySelector("#restore-backup").disabled = true;
    document.querySelector("#backup-preview").classList.remove("hidden");
    setBackupStatus("Backup decrypted. Review the counts before restoring.", "success");
  } catch (error) { document.querySelector("#backup-preview").classList.add("hidden"); setBackupStatus(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelector("#restore-confirmation").addEventListener("input", (event) => {
  document.querySelector("#restore-backup").disabled = !pendingRestore || event.target.value !== "RESTORE";
});

document.querySelector("#restore-backup").addEventListener("click", async (event) => {
  if (!pendingRestore || document.querySelector("#restore-confirmation").value !== "RESTORE") return;
  if (!await ScoutDialog.confirm({ eyebrow: "RESTORE CHECKPOINT", title: "Replace this browser’s Scout data?", message: "You already reviewed and unlocked this encrypted backup.", consequences: ["Current browser workspace data will be replaced.", "Scout will keep a one-step local undo checkpoint."], tone: "danger", confirmLabel: "Restore backup", cancelLabel: "Keep current data" })) return;
  const button = event.currentTarget; button.disabled = true; setBackupStatus("Restoring and validating workspace data…");
  try {
    const summary = await ApplyOS.restoreBackup(pendingRestore);
    setBackupStatus(`Restore complete · ${backupSummaryText(summary)} · Reloading…`, "success");
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) { setBackupStatus(`Restore failed and previous data was recovered: ${error.message}`, "error"); button.disabled = false; }
});

document.querySelector("#undo-restore").addEventListener("click", async (event) => {
  if (!await ScoutDialog.confirm({ eyebrow: "UNDO RESTORE", title: "Return to the previous workspace?", message: "Scout will use the local checkpoint created before your last successful restore.", confirmLabel: "Undo restore", cancelLabel: "Keep restored data" })) return;
  const button = event.currentTarget; button.disabled = true; setBackupStatus("Recovering the pre-restore checkpoint…");
  try { await ApplyOS.undoLastRestore(); setBackupStatus("Previous workspace state recovered. Reloading…", "success"); window.setTimeout(() => window.location.reload(), 700); }
  catch (error) { setBackupStatus(error.message, "error"); button.disabled = false; }
});
