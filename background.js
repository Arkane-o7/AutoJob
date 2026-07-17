importScripts("shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/graph.js", "shared/submission.js", "shared/storage.js", "shared/cloud-config.js", "shared/cloud.js");

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

async function messageAllFrames(tabId, type) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const settled = await Promise.allSettled((frames || [{ frameId: 0 }]).map(async ({ frameId }) => {
    const response = await chrome.tabs.sendMessage(tabId, { type }, { frameId });
    if (!response?.ok) throw new Error(response?.error || `Frame ${frameId} did not complete.`);
    return { frameId, report: response.report || {} };
  }));
  const completed = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!completed.length) {
    const firstError = settled.find((result) => result.status === "rejected");
    throw firstError?.reason || new Error("No application frame could be reached.");
  }
  const reports = completed.map((item) => item.report);
  const resumePriority = ["attached", "already-attached", "failed", "missing", "not-found"];
  const report = {
    scanned: reports.reduce((sum, item) => sum + Number(item.scanned || 0), 0),
    filled: reports.reduce((sum, item) => sum + Number(item.filled || 0), 0),
    attached: reports.reduce((sum, item) => sum + Number(item.attached || 0), 0),
    skipped: reports.reduce((sum, item) => sum + Number(item.skipped || 0), 0),
    blockedActions: reports.reduce((sum, item) => sum + Number(item.blockedActions || 0), 0),
    unmatchedRequired: reports.reduce((sum, item) => sum + Number(item.unmatchedRequired || 0), 0),
    missingProfileFields: [...new Set(reports.flatMap((item) => item.missingProfileFields || []))],
    fields: [...new Set(reports.flatMap((item) => item.fields || []))],
    site: reports.find((item) => item.site)?.site || "This form",
    resumeStatus: resumePriority.find((status) => reports.some((item) => item.resumeStatus === status)) || "not-found",
    reviewRequired: true,
    frameCount: completed.length,
    frameErrors: settled.length - completed.length
  };
  return report;
}

async function updateBadge(refreshStatuses = true) {
  const state = refreshStatuses ? await ApplyOS.refreshDueApplications() : await ApplyOS.getState();
  const due = state.settings.notification_enabled === false ? 0 : state.reminders.filter((item) => !item.completed_at && new Date(item.due_at) <= new Date()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#ff5c35" });
  await chrome.action.setBadgeText({ text: due ? String(Math.min(due, 99)) : "" });
  await chrome.action.setTitle({ title: due ? `ApplyOS · ${due} follow-up${due === 1 ? "" : "s"} due` : "ApplyOS" });
}

async function initialize() {
  await ApplyOS.ensureState();
  await ApplyOS.ensureProfiles();
  await ApplyOS.ensureGraph();
  chrome.alarms.create("applyos-follow-ups", { periodInMinutes: 60 });
  chrome.alarms.create("applyos-cloud-sync", { periodInMinutes: 15 });
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
  if (alarm.name === "applyos-cloud-sync") {
    ApplyOS.getState().then((state) => state.settings.cloud_sync_enabled ? ApplyOS.syncCloudNow().catch(() => {}) : null).catch(() => {});
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ApplyOS.STORAGE_KEY]) updateBadge(false).catch(console.error);
  if (area === "local" && Object.keys(changes).some((key) => key === ApplyOS.STORAGE_KEY || key === "profilesIndex" || key === ApplyOS.PROFILE_KEY || key.startsWith("profile_"))) {
    chrome.storage.local.get("applyos_sync_meta").then((stored) => {
      const current = stored.applyos_sync_meta || {};
      if (current.enabled) return chrome.storage.local.set({ applyos_sync_meta: { ...current, status: "pending", dirtyAt: new Date().toISOString() } });
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateSessions((sessions) => { delete sessions[ApplyOS.Submission.sessionKey(tabId)]; }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLYOS_CLOUD_STATUS") {
    ApplyOS.cloudStatus().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_CONFIGURE") {
    ApplyOS.saveCloudConfig(message.config).then((config) => sendResponse({ ok: true, config })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SIGN_IN") {
    ApplyOS.signInWithLinkedIn().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SIGN_OUT") {
    ApplyOS.signOutCloud().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SYNC") {
    ApplyOS.syncCloudNow({ force: Boolean(message.force) }).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_PREFERENCES") {
    const enabled = Boolean(message.enabled);
    ApplyOS.updateSettings({ cloud_sync_enabled: enabled, resume_sync_enabled: Boolean(message.includeResumes) })
      .then(async () => {
        const stored = await chrome.storage.local.get("applyos_sync_meta");
        const next = { ...(stored.applyos_sync_meta || {}), enabled, status: enabled ? "pending" : "off" };
        await chrome.storage.local.remove("applyos_sync_outbox");
        await chrome.storage.local.set({ applyos_sync_meta: next });
        sendResponse({ ok: true, sync: next });
      }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_RESOLVE_LOCAL") {
    chrome.storage.local.remove("applyos_sync_outbox")
      .then(() => ApplyOS.syncCloudNow({ force: true }))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SNAPSHOT") {
    ApplyOS.getCloudSnapshot().then((snapshot) => sendResponse({ ok: true, snapshot })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_RESTORE") {
    ApplyOS.restoreCloudSnapshot().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_UNDO_RESTORE") {
    ApplyOS.undoCloudRestore().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_PUBLICATION_GET") {
    ApplyOS.getCandidatePublication().then((publication) => sendResponse({ ok: true, publication })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_PUBLICATION_SAVE") {
    ApplyOS.saveCandidatePublication(message.publication).then((publication) => sendResponse({ ok: true, publication })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SUPPORT_SUBMIT") {
    ApplyOS.submitSupportReport(message.report).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_DELETE_ACCOUNT") {
    ApplyOS.deleteCloudAccount().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_FILL_TAB" || message?.type === "APPLYOS_AGENT_TAB") {
    if (!Number.isInteger(message.tabId)) { sendResponse({ ok: false, error: "Missing active application tab." }); return false; }
    messageAllFrames(message.tabId, message.type === "APPLYOS_FILL_TAB" ? "APPLYKIT_FILL" : "APPLYOS_AGENT_ASSIST")
      .then((report) => sendResponse({ ok: true, report }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_RUNTIME_PING") {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version,
      features: { applicationTracking: true }
    });
    return false;
  }
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
