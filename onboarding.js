if (!globalThis.chrome?.storage?.local) {
  const previewData = {};
  globalThis.chrome = {
    ...(globalThis.chrome || {}),
    storage: { local: {
      async get(keys) { const wanted = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(wanted.filter((key) => key in previewData).map((key) => [key, structuredClone(previewData[key])])); },
      async set(values) { Object.assign(previewData, structuredClone(values)); }
    } },
    runtime: { ...(globalThis.chrome?.runtime || {}), sendMessage: async () => ({ ok: false }), getURL: (path) => path }
  };
}

const form = document.querySelector("#onboarding-form");
const panels = [...document.querySelectorAll("[data-panel]")];
const back = document.querySelector("#back");
const next = document.querySelector("#next");
let current = 0;
let minimumStep = 0;
let selectedResume = null;
document.body.inert = true;

function accountGateUrl(reason) {
  const url = new URL(chrome.runtime.getURL("account.html"));
  url.searchParams.set("reason", reason);
  url.searchParams.set("returnTo", `onboarding.html${location.search}${location.hash}`);
  return url.href;
}

async function requireWorkspaceAccess() {
  let response;
  try { response = await chrome.runtime.sendMessage({ type: "APPLYOS_CLOUD_STATUS" }); }
  catch { response = null; }
  const status = response?.ok ? response.status : null;
  const ready = status?.configured === true && status?.migrationRequired !== true && (status?.workspaceReady === true || status?.offlineAuthorized === true);
  if (!ready) {
    const reason = !response?.ok ? "status-unavailable" : status?.configured !== true ? "configuration-required" : status?.migrationRequired === true ? "migration-required" : "sign-in-required";
    location.replace(accountGateUrl(reason));
    return null;
  }
  document.body.inert = false;
  if (status.offlineAuthorized === true) globalThis.ScoutHeader?.setStatus("Offline · cached", "offline");
  return status;
}

function render() {
  panels.forEach((panel, index) => panel.classList.toggle("active", index === current));
  back.disabled = current <= minimumStep;
  next.textContent = current === panels.length - 1 ? "Open my workspace →" : current === 1 ? "Continue →" : "Get started →";
  document.querySelector("#rail-progress").style.width = `${((current + 1) / panels.length) * 100}%`;
  document.querySelector("#rail-step").textContent = String(current + 1).padStart(2, "0");
  document.querySelector("#rail-label").textContent = ["A quick hello", "Add your resume", "Your essentials"][current];
}

function validatePanel() {
  for (const input of panels[current].querySelectorAll("[required]")) if (!input.reportValidity()) return false;
  return true;
}

async function saveStarterProfile() {
  const values = Object.fromEntries(new FormData(form).entries());
  delete values.targetRole;
  values.fullName = `${values.firstName || ""} ${values.lastName || ""}`.trim();
  if (selectedResume) {
    const dataUrl = await fileToDataUrl(selectedResume);
    values.resume = { name: selectedResume.name, type: selectedResume.type, size: selectedResume.size, dataUrl };
    if (selectedResume.type === "application/pdf" || /\.pdf$/i.test(selectedResume.name)) {
      try { values.resumeText = await ApplyOS.extractPdfText(selectedResume); }
      catch { /* A difficult or scanned PDF should never block activation. */ }
    }
  }
  const profile = await ApplyOS.completeOnboarding(values);
  const index = await ApplyOS.getProfilesIndex();
  const targetRole = String(new FormData(form).get("targetRole") || "").trim();
  if (targetRole) await ApplyOS.updateProfileMeta(index.activeId, { targetRole });
  if (profile.resume) {
    const version = await ApplyOS.syncResumeVersion?.(profile.resume);
    if (version?.id) await ApplyOS.patchActiveProfile({ currentResumeVersionId: version.id });
  }
  await ApplyOS.syncProfileAnswerDefaults(profile);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Scout could not read that file."));
    reader.readAsDataURL(file);
  });
}

function setResume(file) {
  const status = document.querySelector("#setup-status");
  status.textContent = "";
  if (!file) selectedResume = null;
  else if (!/\.(pdf|doc|docx)$/i.test(file.name) || (file.type && !/pdf|msword|officedocument/.test(file.type))) status.textContent = "Choose a PDF, DOC, or DOCX file.";
  else if (file.size > 8 * 1024 * 1024) status.textContent = "Choose a resume smaller than 8 MB.";
  else selectedResume = file;
  document.querySelector("#resume-drop-title").textContent = selectedResume ? selectedResume.name : "Choose your resume";
  document.querySelector("#resume-drop-copy").textContent = selectedResume ? `${Math.max(1, Math.round(selectedResume.size / 1024))} KB · ready to add` : "PDF, DOC, or DOCX · up to 8 MB";
  document.querySelector("#remove-resume").classList.toggle("hidden", !selectedResume);
  document.querySelector(".resume-drop").classList.toggle("has-file", Boolean(selectedResume));
}

next.addEventListener("click", async () => {
  if (!validatePanel()) return;
  if (current < panels.length - 1) {
    current += 1;
    render();
    panels[current].querySelector("input")?.focus();
    return;
  }
  next.disabled = true;
  next.textContent = "Preparing your workspace…";
  try {
    await saveStarterProfile();
    location.assign(chrome.runtime.getURL("dashboard.html?welcome=1"));
  } catch (error) {
    next.disabled = false;
    next.textContent = "Try again →";
    document.querySelector("#setup-status").textContent = error.message || "Scout could not finish setup. Try again.";
  }
});

back.addEventListener("click", () => {
  current = Math.max(minimumStep, current - 1);
  render();
});

document.querySelector("#starter-resume").addEventListener("change", (event) => setResume(event.target.files?.[0] || null));
document.querySelector("#remove-resume").addEventListener("click", () => { document.querySelector("#starter-resume").value = ""; setResume(null); });

(async function initialize() {
  const access = await requireWorkspaceAccess();
  if (!access) return;
  const profile = await ApplyOS.getActiveProfile();
  const params = new URLSearchParams(location.search);
  const quick = params.get("quick") === "1";
  if (ApplyOS.isOnboardingComplete(profile) && !params.has("start") && !quick) {
    location.replace(chrome.runtime.getURL("options.html"));
    return;
  }
  for (const element of form.elements) if (element.name && Object.hasOwn(profile, element.name)) element.value = profile[element.name] ?? "";
  current = quick ? 2 : 0;
  minimumStep = quick ? 2 : 0;
  render();
})().catch((error) => {
  document.body.inert = false;
  console.error(error);
});
