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
let isDirty = false;
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

function createAnswerRow(answer = {}) {
  const row = document.createElement("div");
  row.className = "answer-row";
  if (answer.source === "application") {
    row.dataset.answerSource = "application";
    row.dataset.learnedAt = answer.learned_at || answer.updated_at || "";
    row.classList.add("learned-answer-row");
  }

  const questionLabel = document.createElement("label");
  questionLabel.className = "answer-question-field";
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
  answerLabel.className = "answer-copy-field";
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
  remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`;
  remove.addEventListener("click", () => {
    row.remove();
    markUnsaved();
  });

  row.append(questionLabel, answerLabel, scopeWrap, remove);
  customAnswers.append(row);
}

function markUnsaved() {
  isDirty = true;
  saveStatus.textContent = "Unsaved changes";
  updateSaveBarVisibility();
  updateProfileOverview(profileFromForm());
}

function updateSaveBarVisibility(view = document.querySelector("[data-profile-view][aria-selected='true']")?.dataset.profileView) {
  document.querySelector(".save-bar").classList.toggle("hidden", view === "overview" || !isDirty);
}

function profileFromForm() {
  const value = Object.fromEntries(new FormData(form).entries());
  value.resume = pendingResume || savedResume;
  return value;
}

function updateProfileOverview(profile) {
  const completeness = ApplyOS.profileCompleteness(profile);
  document.querySelector("#completion-value").textContent = `${completeness.percentage}%`;
  document.querySelector("#completion-ring").style.setProperty("--completion", `${completeness.percentage * 3.6}deg`);
  document.querySelector("#ready-count").textContent = `${10 - completeness.missing.length} of 10 essentials`;
  document.querySelector("#missing-fields").innerHTML = completeness.missing.length
    ? completeness.missing.slice(0, 5).map((field) => `<li>${field}</li>`).join("")
    : "<li>Everything essential is ready.</li>";
}

function setProfileView(view) {
  const active = ["overview", "basics", "experience", "preferences", "resume", "answers"].includes(view) ? view : "overview";
  document.querySelectorAll("[data-profile-group]").forEach((section) => section.classList.toggle("profile-section-active", section.dataset.profileGroup === active));
  document.querySelectorAll("[data-profile-view]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.profileView === active)));
  updateSaveBarVisibility(active);
  history.replaceState(null, "", `${location.pathname}#${active}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const profile = await ApplyOS.getActiveProfile();
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
  updateProfileOverview(profile);
  setProfileView(location.hash.replace("#", "") || "overview");
  isDirty = false;
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

form.addEventListener("input", markUnsaved);
form.addEventListener("change", markUnsaved);

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
    isDirty = false;
    updateProfileOverview(savedProfile);
    saveStatus.textContent = "Saved just now";
    window.setTimeout(() => { saveStatus.textContent = "Profile saved"; updateSaveBarVisibility(); }, 900);
  } catch (error) {
    saveStatus.textContent = "Could not save — storage error";
    console.error(error);
  }
});

initialize().catch((error) => {
  document.body.inert = false;
  saveStatus.textContent = `Could not load profile — ${error.message}`;
});

document.querySelectorAll("[data-profile-view]").forEach((button) => button.addEventListener("click", () => setProfileView(button.dataset.profileView)));
document.querySelectorAll("[data-profile-jump]").forEach((button) => button.addEventListener("click", () => setProfileView(button.dataset.profileJump)));
window.addEventListener("beforeunload", (event) => { if (isDirty) event.preventDefault(); });
document.querySelector("#profile-select").addEventListener("change", async (event) => {
  if (isDirty && !await ScoutDialog.confirm({ eyebrow: "UNSAVED PROFILE", title: "Switch profiles without saving?", message: "Changes on this profile will be lost.", confirmLabel: "Discard and switch", cancelLabel: "Keep editing", tone: "danger" })) { event.target.value = profilesIndex.activeId; return; }
  isDirty = false;
  await ApplyOS.setActiveProfile(event.target.value); window.location.reload();
});
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
