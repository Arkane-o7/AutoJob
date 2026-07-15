const form = document.querySelector("#profile-form");
const resumeInput = document.querySelector("#resume-file");
const fileTitle = document.querySelector("#file-title");
const fileDetail = document.querySelector("#file-detail");
const removeResumeButton = document.querySelector("#remove-resume");
const customAnswers = document.querySelector("#custom-answers");
const addAnswerButton = document.querySelector("#add-answer");
const saveStatus = document.querySelector("#save-status");

let savedResume = null;
let pendingResume = null;
let profilesIndex = null;
let pendingRestore = null;

function setBackupStatus(message, tone = "") {
  const status = document.querySelector("#backup-status");
  status.textContent = message;
  status.className = tone;
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
  return `${summary.profiles} profiles · ${summary.applications} applications · ${summary.contacts} contacts · ${summary.interviews} interviews · ${summary.answers} remembered answers · Created ${date} with ApplyOS ${summary.extension_version}`;
}

function createAnswerRow(answer = {}) {
  const row = document.createElement("div");
  row.className = "answer-row";

  const questionLabel = document.createElement("label");
  questionLabel.innerHTML = "<span>Question phrase</span>";
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

  const remove = document.createElement("button");
  remove.className = "delete-answer";
  remove.type = "button";
  remove.setAttribute("aria-label", "Delete custom answer");
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    row.remove();
    markUnsaved();
  });

  row.append(questionLabel, answerLabel, remove);
  customAnswers.append(row);
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
    ? `${(size / 1024 / 1024).toFixed(2)} MB · stored locally and ready to attach`
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

async function initialize() {
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
  (profile.customAnswers || []).forEach(createAnswerRow);
  if (!(profile.customAnswers || []).length) createAnswerRow();
  saveStatus.textContent = profile.firstName ? "Profile saved" : "Complete your profile";
  const config = await ApplyOS.getAIConfig();
  document.querySelector("#ai-endpoint").value = config.endpoint;
  document.querySelector("#ai-model").value = config.chatModel;
  document.querySelector("#embedding-model").value = config.embeddingModel;
  if (config.enabled) { document.querySelector("#ai-result").textContent = `Connected · Ollama ${config.version || "ready"}`; document.querySelector("#ai-result").className = "success"; }
  document.querySelector("#undo-restore").classList.toggle("hidden", !(await ApplyOS.hasRestoreCheckpoint()));
}

resumeInput.addEventListener("change", async () => {
  const file = resumeInput.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    window.alert("Please choose a resume smaller than 8 MB.");
    resumeInput.value = "";
    return;
  }
  const allowed = /pdf|msword|officedocument/.test(file.type) || /\.(pdf|doc|docx)$/i.test(file.name);
  if (!allowed) {
    window.alert("Please choose a PDF, DOC, or DOCX resume.");
    resumeInput.value = "";
    return;
  }
  pendingResume = { name: file.name, type: file.type, size: file.size, dataUrl: await fileToDataUrl(file) };
  showResume(pendingResume);
  markUnsaved();
});

removeResumeButton.addEventListener("click", () => {
  savedResume = null;
  pendingResume = null;
  resumeInput.value = "";
  showResume(null);
  markUnsaved();
});

addAnswerButton.addEventListener("click", () => {
  createAnswerRow();
  customAnswers.lastElementChild.querySelector("input").focus();
  markUnsaved();
});

form.addEventListener("input", (event) => { if (!event.target.closest("#backup")) markUnsaved(); });
form.addEventListener("change", (event) => { if (!event.target.closest("#backup")) markUnsaved(); });

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
      answer: row.querySelector(".custom-answer").value.trim()
    }))
    .filter((item) => item.question && item.answer);
  data.updatedAt = new Date().toISOString();

  try {
    await ApplyOS.saveActiveProfile(data);
    await ApplyOS.syncAnswerMemory(data.customAnswers);
    await ApplyOS.syncProfileAnswerDefaults(data);
    await Promise.all(data.customAnswers.map((item) => ApplyOS.recordGraphAnswer({ question: item.question, answer: item.answer, source: "profile", confidence: 1 })));
    await ApplyOS.syncResumeVersion(data.resume);
    savedResume = data.resume;
    pendingResume = null;
    saveStatus.textContent = "Saved just now";
    window.setTimeout(() => { saveStatus.textContent = "Profile saved"; }, 2200);
  } catch (error) {
    saveStatus.textContent = "Could not save — storage error";
    console.error(error);
  }
});

initialize();

document.querySelector("#profile-select").addEventListener("change", async (event) => { await ApplyOS.setActiveProfile(event.target.value); window.location.reload(); });
document.querySelector("#new-profile").addEventListener("click", async () => {
  const name = window.prompt("Name this profile (for example: Frontend roles)");
  if (!name?.trim()) return;
  const targetRole = window.prompt("Optional target role", "") || "";
  await ApplyOS.createProfile(name.trim(), targetRole.trim(), profilesIndex?.activeId); window.location.reload();
});
document.querySelector("#open-onboarding").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }));
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
    downloadTextFile(result.serialized, `applyos-backup-${date}.applyos`);
    setBackupStatus(`Encrypted backup downloaded · ${backupSummaryText(result.summary)}`, "success");
    document.querySelector("#backup-password").value = ""; document.querySelector("#backup-confirm").value = "";
  } catch (error) { setBackupStatus(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelector("#preview-backup").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const file = document.querySelector("#backup-file").files?.[0];
  if (!file) { setBackupStatus("Choose an encrypted .applyos file first.", "error"); return; }
  if (file.size > 64 * 1024 * 1024) { setBackupStatus("This backup is larger than the 64 MB restore limit.", "error"); return; }
  button.disabled = true; pendingRestore = null; setBackupStatus("Decrypting locally…");
  try {
    pendingRestore = await ApplyOS.decryptBackup(await file.text(), document.querySelector("#restore-password").value);
    const summary = ApplyOS.backupSummary(pendingRestore);
    document.querySelector("#backup-summary-title").textContent = `ApplyOS ${summary.extension_version} backup`;
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
  if (!window.confirm("Replace this browser's ApplyOS data with the reviewed backup? A one-step local undo checkpoint will be kept.")) return;
  const button = event.currentTarget; button.disabled = true; setBackupStatus("Restoring and validating local data…");
  try {
    const summary = await ApplyOS.restoreBackup(pendingRestore);
    setBackupStatus(`Restore complete · ${backupSummaryText(summary)} · Reloading…`, "success");
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) { setBackupStatus(`Restore failed and previous data was recovered: ${error.message}`, "error"); button.disabled = false; }
});

document.querySelector("#undo-restore").addEventListener("click", async (event) => {
  if (!window.confirm("Undo the last successful restore and return to the previous local data?")) return;
  const button = event.currentTarget; button.disabled = true; setBackupStatus("Recovering the pre-restore checkpoint…");
  try { await ApplyOS.undoLastRestore(); setBackupStatus("Previous local data recovered. Reloading…", "success"); window.setTimeout(() => window.location.reload(), 700); }
  catch (error) { setBackupStatus(error.message, "error"); button.disabled = false; }
});
