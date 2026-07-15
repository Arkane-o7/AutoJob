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
let current = 0;

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

async function saveProfile() {
  const existing = await ApplyOS.getActiveProfile();
  const values = Object.fromEntries(new FormData(form).entries());
  const profile = { ...existing, ...values };
  profile.fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  profile.customAnswers = existing.customAnswers || [];
  await ApplyOS.saveActiveProfile(profile);
  await ApplyOS.syncProfileAnswerDefaults(profile);
  return profile;
}

next.addEventListener("click", async () => {
  if (!validatePanel()) return;
  if (current === panels.length - 2) await saveProfile();
  current = Math.min(panels.length - 1, current + 1); render();
});
back.addEventListener("click", () => { current = Math.max(0, current - 1); render(); });

document.querySelector("#open-dashboard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
document.querySelector("#open-profile").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#open-ai-settings").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#local-ai") }));

(async function initialize() {
  const profile = await ApplyOS.getActiveProfile();
  for (const element of form.elements) if (element.name && Object.hasOwn(profile, element.name)) element.value = profile[element.name] ?? "";
  render();
})().catch(console.error);
