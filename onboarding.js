if (!globalThis.chrome?.storage?.local) {
  const previewData = {};
  globalThis.chrome = {
    ...(globalThis.chrome || {}),
    storage: { local: {
      async get(keys) { const wanted = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(wanted.filter((key) => key in previewData).map((key) => [key, structuredClone(previewData[key])])); },
      async set(values) { Object.assign(previewData, structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete previewData[key]; }
    } },
    runtime: { ...(globalThis.chrome?.runtime || {}), sendMessage: async () => ({ ok: false, error: "Ollama proxy is available in the installed extension." }), openOptionsPage() {}, getURL: (path) => path },
    tabs: { create() {} }
  };
}

const form = document.querySelector("#onboarding-form");
const panels = [...document.querySelectorAll("[data-panel]")];
const steps = [...document.querySelectorAll("#steps li")];
const back = document.querySelector("#back");
const next = document.querySelector("#next");
const progress = document.querySelector("#progress");
const TOUR_KEY = "applyos_tour_progress";
const TOUR_VERSION = 1;
let current = 0;

async function saveTourProgress(patch = {}) {
  const stored = await chrome.storage.local.get(TOUR_KEY);
  const value = { version: TOUR_VERSION, lastStep: current, completedAt: null, dismissedAt: null, ...(stored[TOUR_KEY] || {}), ...patch };
  await chrome.storage.local.set({ [TOUR_KEY]: value });
  return value;
}

function render() {
  panels.forEach((panel, index) => panel.classList.toggle("active", index === current));
  steps.forEach((step, index) => { step.classList.toggle("active", index === current); step.classList.toggle("complete", index < current); });
  back.disabled = current === 0 || current === panels.length - 1;
  next.hidden = current === panels.length - 1;
  next.textContent = current === panels.length - 2 ? "Save & finish →" : "Continue →";
  progress.style.width = `${((current + 1) / panels.length) * 100}%`;
}

function validatePanel() {
  const required = [...panels[current].querySelectorAll("[required]")];
  for (const input of required) if (!input.reportValidity()) return false;
  return true;
}

async function saveProfile(complete = false) {
  const values = Object.fromEntries(new FormData(form).entries());
  values.fullName = `${values.firstName || ""} ${values.lastName || ""}`.trim();
  const profile = complete ? await ApplyOS.completeOnboarding(values) : await ApplyOS.patchActiveProfile(values);
  if (complete) await ApplyOS.syncProfileAnswerDefaults(profile);
  return profile;
}

next.addEventListener("click", async () => {
  if (!validatePanel()) return;
  await saveProfile(current === panels.length - 2);
  current = Math.min(panels.length - 1, current + 1);
  await saveTourProgress({ lastStep: current, ...(current === panels.length - 1 ? { completedAt: new Date().toISOString() } : {}) });
  render();
});
back.addEventListener("click", async () => { current = Math.max(0, current - 1); await saveTourProgress({ lastStep: current }); render(); });

document.querySelector("#open-dashboard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
document.querySelector("#open-profile").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#open-ai-settings").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#local-ai") }));
document.querySelector("#open-account").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("account.html") }));

(async function initialize() {
  const [profile, stored] = await Promise.all([ApplyOS.getActiveProfile(), chrome.storage.local.get(TOUR_KEY)]);
  const tour = stored[TOUR_KEY] || {};
  const params = new URLSearchParams(location.search);
  const forced = params.get("quick") === "1" || params.get("tour") === "1";
  if (tour.version === TOUR_VERSION && tour.completedAt && !forced) {
    location.replace(chrome.runtime.getURL("options.html"));
    return;
  }
  for (const element of form.elements) if (element.name && Object.hasOwn(profile, element.name)) element.value = profile[element.name] ?? "";
  current = forced && params.get("start") === "1" ? 0 : Math.min(Math.max(0, Number(tour.lastStep || 0)), panels.length - 1);
  render();
})().catch(console.error);
