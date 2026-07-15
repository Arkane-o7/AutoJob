importScripts("shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/graph.js", "shared/storage.js");

async function updateBadge(refreshStatuses = true) {
  const state = refreshStatuses ? await ApplyOS.refreshDueApplications() : await ApplyOS.getState();
  const due = state.reminders.filter((item) => !item.completed_at && new Date(item.due_at) <= new Date()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#ff5c35" });
  await chrome.action.setBadgeText({ text: due ? String(Math.min(due, 99)) : "" });
  await chrome.action.setTitle({ title: due ? `ApplyOS · ${due} follow-up${due === 1 ? "" : "s"} due` : "ApplyOS" });
}

async function initialize() {
  await ApplyOS.ensureState();
  await ApplyOS.ensureProfiles();
  await ApplyOS.ensureGraph();
  chrome.alarms.create("applyos-follow-ups", { periodInMinutes: 60 });
  await updateBadge();
}

chrome.runtime.onInstalled.addListener((details) => {
  initialize().then(() => {
    if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => initialize().catch(console.error));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "applyos-follow-ups") updateBadge().catch(console.error);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ApplyOS.STORAGE_KEY]) updateBadge(false).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLYOS_REFRESH_DUE") {
    updateBadge().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_LEARN_CORRECTION") {
    ApplyOS.rememberCorrection(message.correction)
      .then(async (learned) => {
        await ApplyOS.recordGraphCorrection({
          question: message.correction?.question,
          correctedValue: message.correction?.answer,
          canonicalField: message.correction?.canonical_field,
          fingerprint: message.correction?.fingerprint,
          platform: message.correction?.site
        });
        sendResponse({ ok: true, learned });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_OLLAMA_PROXY") {
    ApplyOS.ollamaProxy(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
