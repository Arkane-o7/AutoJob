importScripts("shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/graph.js", "shared/submission.js", "shared/storage.js");

const SESSION_STORAGE_KEY = "applyos_application_sessions";
let sessionWriteQueue = Promise.resolve();

async function getSessions() {
  const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  return stored[SESSION_STORAGE_KEY] || {};
}

function updateSessions(mutator) {
  const task = sessionWriteQueue.then(async () => {
    const sessions = await getSessions();
    const result = await mutator(sessions);
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: sessions });
    return result;
  });
  sessionWriteQueue = task.catch(() => {});
  return task;
}

function messageTabId(message, sender, allowExplicit = false) {
  if (allowExplicit && Number.isInteger(message?.tabId)) return message.tabId;
  if (Number.isInteger(sender.tab?.id)) return sender.tab.id;
  return null;
}

function canonicalPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

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

chrome.tabs.onRemoved.addListener((tabId) => {
  updateSessions((sessions) => { delete sessions[ApplyOS.Submission.sessionKey(tabId)]; }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLYOS_SESSION_START") {
    const tabId = messageTabId(message, _sender, true);
    if (tabId === null || !message.application?.id) {
      sendResponse({ ok: false, error: "A saved application and active tab are required." });
      return false;
    }
    updateSessions((sessions) => {
      const key = ApplyOS.Submission.sessionKey(tabId);
      sessions[key] = {
        applicationId: String(message.application.id),
        company: String(message.application.company || ""),
        role: String(message.application.role || ""),
        platform: String(message.platform || "generic"),
        startedAt: Date.now(),
        sourceUrl: canonicalPageUrl(message.url),
        submitIntentAt: null,
        submitIntentUrl: null,
        promptState: null,
        promptedIntentAt: null,
        suppressed: false
      };
      return sessions[key];
    }).then(async (session) => {
      await chrome.tabs.sendMessage(tabId, { type: "APPLYOS_SESSION_UPDATED", session }, { frameId: 0 }).catch(() => {});
      sendResponse({ ok: true, session });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_GET") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null) { sendResponse({ ok: true, session: null }); return false; }
    getSessions().then((sessions) => sendResponse({ ok: true, session: sessions[ApplyOS.Submission.sessionKey(tabId)] || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_CLEAR") {
    const tabId = messageTabId(message, _sender, true);
    if (tabId === null) { sendResponse({ ok: false }); return false; }
    updateSessions((sessions) => { delete sessions[ApplyOS.Submission.sessionKey(tabId)]; })
      .then(async () => {
        await chrome.tabs.sendMessage(tabId, { type: "APPLYOS_SESSION_UPDATED", session: null }, { frameId: 0 }).catch(() => {});
        sendResponse({ ok: true });
      }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_SUBMIT_INTENT") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null) { sendResponse({ ok: false, error: "Missing application tab." }); return false; }
    updateSessions((sessions) => {
      const session = sessions[ApplyOS.Submission.sessionKey(tabId)];
      if (!session || session.suppressed) return null;
      session.submitIntentAt = Date.now();
      session.submitIntentUrl = canonicalPageUrl(message.url);
      session.promptState = null;
      session.promptedIntentAt = null;
      return session;
    }).then(async (session) => {
      if (session) await chrome.tabs.sendMessage(tabId, { type: "APPLYOS_SESSION_UPDATED", session }, { frameId: 0 }).catch(() => {});
      sendResponse({ ok: Boolean(session), session });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_PROMPTED") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null) { sendResponse({ ok: false }); return false; }
    updateSessions((sessions) => {
      const session = sessions[ApplyOS.Submission.sessionKey(tabId)];
      if (!session || session.suppressed || !session.submitIntentAt) return null;
      session.promptState = "shown";
      session.promptedIntentAt = session.submitIntentAt;
      return session;
    }).then((session) => sendResponse({ ok: Boolean(session), session })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_DISMISS") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null) { sendResponse({ ok: false }); return false; }
    updateSessions((sessions) => {
      const session = sessions[ApplyOS.Submission.sessionKey(tabId)];
      if (!session) return null;
      session.promptState = message.action === "dont_ask" ? "suppressed" : "not_yet";
      session.promptedIntentAt = session.submitIntentAt;
      if (message.action === "dont_ask") session.suppressed = true;
      return session;
    }).then((session) => sendResponse({ ok: Boolean(session), session })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SESSION_CONFIRM_APPLIED") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null) { sendResponse({ ok: false, error: "Missing application tab." }); return false; }
    getSessions().then(async (sessions) => {
      const key = ApplyOS.Submission.sessionKey(tabId);
      const session = sessions[key];
      if (!session?.applicationId) throw new Error("The application session has expired.");
      const application = await ApplyOS.markApplicationApplied(session.applicationId);
      if (!application) throw new Error("The saved application could not be found.");
      await updateSessions((latest) => { delete latest[key]; });
      await updateBadge(false);
      sendResponse({ ok: true, application });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
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
