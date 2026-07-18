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
  next.textContent = current === panels.length - 1 ? "Save & show me around →" : "Start setup →";
  document.querySelector("#rail-progress").style.width = `${((current + 1) / panels.length) * 100}%`;
  document.querySelector("#rail-step").textContent = String(current + 1).padStart(2, "0");
  document.querySelector("#rail-label").textContent = current === 0 ? "A quick hello" : "Your essentials";
}

function validatePanel() {
  for (const input of panels[current].querySelectorAll("[required]")) if (!input.reportValidity()) return false;
  return true;
}

async function saveStarterProfile() {
  const values = Object.fromEntries(new FormData(form).entries());
  values.fullName = `${values.firstName || ""} ${values.lastName || ""}`.trim();
  const profile = await ApplyOS.completeOnboarding(values);
  await ApplyOS.syncProfileAnswerDefaults(profile);
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
    await ScoutTour.prepareFirstRun();
    location.assign(chrome.runtime.getURL("dashboard.html?tour=1"));
  } catch (error) {
    next.disabled = false;
    next.textContent = "Try again →";
    console.error(error);
  }
});

back.addEventListener("click", () => {
  current = Math.max(minimumStep, current - 1);
  render();
});

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
  current = quick ? 1 : 0;
  minimumStep = quick ? 1 : 0;
  render();
})().catch((error) => {
  document.body.inert = false;
  console.error(error);
});
