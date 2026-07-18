importScripts("shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/agent.js", "shared/graph.js", "shared/submission.js", "shared/storage.js", "shared/cloud-config.js", "shared/cloud.js", "shared/cloud-repository.js");

ApplyOS.configureCloudRepository({
  request: ApplyOS.cloudRequest,
  getSession: ApplyOS.cloudSession,
  getDeviceId: ApplyOS.getCloudDeviceId,
  getDeviceLabel: ApplyOS.getCloudDeviceLabel
});

const SESSION_STORAGE_KEY = "applyos_application_sessions";
let sessionWriteQueue = Promise.resolve();
let repositoryProjectionQueue = Promise.resolve();
let repositoryProjectionTimer = null;
let materializingRepository = false;

function projectionShadowKey(userId) {
  return `applyos_projection_shadow:${userId}`;
}

function isWorkspaceStorageKey(key) {
  return key === ApplyOS.STORAGE_KEY || key === ApplyOS.PROFILE_KEY || key === "profilesIndex" || key === "applyos_graph" || key === "applyos_tour_progress" || key.startsWith("profile_");
}

async function projectCurrentWorkspace() {
  const status = await ApplyOS.cloudStatus();
  if (!status.workspaceReady && !status.offlineAuthorized) return { queued: 0, offline: Boolean(status.offline) };
  const session = await ApplyOS.cloudSession();
  if (!session?.user?.id) return { queued: 0 };
  const workspace = await chrome.storage.local.get(null);
  const prepared = await ApplyOS.prepareWorkspaceForCloud(workspace).catch(() => workspace);
  const records = ApplyOS.projectLegacyWorkspace(prepared);
  const shadowKey = projectionShadowKey(session.user.id);
  const stored = await chrome.storage.local.get(shadowKey);
  const previous = Array.isArray(stored[shadowKey]) ? stored[shadowKey] : [];
  const previousMap = new Map(previous.map((record) => [`${record.entity_type}:${record.entity_id}`, record]));
  const nextMap = new Map(records.map((record) => [`${record.entity_type}:${record.entity_id}`, record]));
  let queued = 0;
  for (const record of records) {
    const key = `${record.entity_type}:${record.entity_id}`;
    const before = previousMap.get(key);
    if (before && JSON.stringify(before.payload) === JSON.stringify(record.payload)) continue;
    await ApplyOS.enqueueCloudMutation({ entityType: record.entity_type, entityId: record.entity_id, operation: "upsert", payload: record.payload });
    queued += 1;
  }
  for (const record of previous) {
    const key = `${record.entity_type}:${record.entity_id}`;
    if (nextMap.has(key)) continue;
    await ApplyOS.enqueueCloudMutation({ entityType: record.entity_type, entityId: record.entity_id, operation: "delete" });
    queued += 1;
  }
  await chrome.storage.local.set({ [shadowKey]: records.map(({ entity_type, entity_id, payload }) => ({ entity_type, entity_id, payload })) });
  await ApplyOS.persistActiveUserCache?.(session.user.id);
  if (queued) ApplyOS.flushCloudMutations().catch(() => {});
  return { queued };
}

function queueWorkspaceProjection() {
  clearTimeout(repositoryProjectionTimer);
  repositoryProjectionTimer = setTimeout(() => {
    const task = repositoryProjectionQueue.then(projectCurrentWorkspace, projectCurrentWorkspace);
    repositoryProjectionQueue = task.then(() => undefined, () => undefined);
  }, 250);
}

async function materializeRepositoryWorkspace() {
  const session = await ApplyOS.cloudSession();
  if (!session?.user?.id) return;
  const repository = await ApplyOS.getCloudRepositoryState();
  if (repository.outbox?.length) return;
  const records = Object.values(repository.records || {}).filter((record) => !record.deletedAt);
  if (!records.length) {
    await ApplyOS.ensureProfiles();
    await ApplyOS.ensureState();
    await ApplyOS.ensureGraph();
    return;
  }
  const byType = (type) => records.filter((record) => record.entityType === type).map((record) => structuredClone(record.payload));
  const current = await ApplyOS.ensureState();
  const profiles = byType("profile");
  const settings = byType("settings")[0] || current.settings;
  const nextState = {
    ...current,
    applications: byType("application"),
    contacts: byType("contact"),
    interviews: byType("interview"),
    reminders: byType("reminder"),
    answer_memory: byType("answer_memory"),
    learned_answers: byType("learned_answer"),
    resume_versions: byType("resume_version"),
    settings,
    revision: Math.max(Number(current.revision || 0), records.reduce((max, record) => Math.max(max, Number(record.serverVersion || 0)), 0))
  };
  const workspace = { [ApplyOS.STORAGE_KEY]: nextState };
  const profileIndex = {
    activeId: profiles[0]?.id || "default",
    profiles: profiles.length ? profiles.map((profile, index) => ({
      id: profile.id || `profile_${index + 1}`,
      name: profile.profileName || profile.name || (index ? `Profile ${index + 1}` : "Primary"),
      targetRole: profile.targetRole || "",
      color: profile.color || "#b7ff3c",
      createdAt: new Date(profile.createdAt || profile.updatedAt || Date.now()).getTime()
    })) : [{ id: "default", name: "Primary", targetRole: "", color: "#b7ff3c", createdAt: Date.now() }]
  };
  workspace.profilesIndex = profileIndex;
  profiles.forEach((profile, index) => { workspace[`profile_${profile.id || profileIndex.profiles[index].id}`] = profile; });
  workspace[ApplyOS.PROFILE_KEY] = profiles[0] || {};
  const graph = byType("knowledge_graph")[0];
  const tour = byType("onboarding_progress")[0];
  if (graph) workspace.applyos_graph = graph;
  if (tour) workspace.applyos_tour_progress = tour;
  await ApplyOS.hydrateWorkspaceFiles?.(workspace).catch(() => workspace);
  materializingRepository = true;
  try {
    await chrome.storage.local.set(workspace);
    await chrome.storage.local.set({
      [projectionShadowKey(session.user.id)]: ApplyOS.projectLegacyWorkspace(workspace).map(({ entity_type, entity_id, payload }) => ({ entity_type, entity_id, payload }))
    });
    await ApplyOS.persistActiveUserCache?.(session.user.id);
  } finally {
    materializingRepository = false;
  }
}

async function bootstrapAuthoritativeWorkspace() {
  await ApplyOS.bootstrapCloudRepository();
  const flushed = await ApplyOS.flushCloudMutations();
  if (flushed.remaining) return flushed;
  await ApplyOS.pullCloudChanges();
  await materializeRepositoryWorkspace();
  return flushed;
}

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

function applicationSession(application, platform, url) {
  return {
    applicationId: String(application.id),
    company: String(application.company || ""),
    role: String(application.role || ""),
    platform: String(platform || "generic"),
    startedAt: Date.now(),
    sourceUrl: canonicalPageUrl(url),
    submitIntentAt: null,
    submitIntentUrl: null,
    promptState: null,
    promptedIntentAt: null,
    suppressed: false
  };
}

async function startApplicationSession(tabId, application, platform, url) {
  const session = await updateSessions((sessions) => {
    const key = ApplyOS.Submission.sessionKey(tabId);
    sessions[key] = applicationSession(application, platform, url);
    return sessions[key];
  });
  await chrome.tabs.sendMessage(tabId, { type: "APPLYOS_SESSION_UPDATED", session }, { frameId: 0 }).catch(() => {});
  return session;
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
  const cloud = await ApplyOS.cloudStatus().catch(() => ({ workspaceReady: false, offlineAuthorized: false }));
  if (!cloud.workspaceReady && !cloud.offlineAuthorized) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Scout · Sign in required" });
    return;
  }
  const state = refreshStatuses ? await ApplyOS.refreshDueApplications() : await ApplyOS.getState();
  const due = state.settings.notification_enabled === false ? 0 : state.reminders.filter((item) => !item.completed_at && new Date(item.due_at) <= new Date()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#ff5c35" });
  await chrome.action.setBadgeText({ text: due ? String(Math.min(due, 99)) : "" });
  await chrome.action.setTitle({ title: due ? `Scout · ${due} follow-up${due === 1 ? "" : "s"} due` : "Scout" });
}

async function initialize() {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  chrome.alarms.create("applyos-follow-ups", { periodInMinutes: 60 });
  chrome.alarms.create("applyos-cloud-sync", { periodInMinutes: 15 });
  const cloud = await ApplyOS.cloudStatus();
  if (cloud.workspaceReady || cloud.offlineAuthorized) {
    await ApplyOS.ensureState();
    await ApplyOS.ensureProfiles();
    await ApplyOS.ensureGraph();
    await bootstrapAuthoritativeWorkspace().catch(() => {});
    await updateBadge();
  } else {
    await updateBadge(false);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  initialize().then(() => {
    if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("account.html?firstRun=1") });
  }).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => initialize().catch(console.error));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "applyos-follow-ups") updateBadge().catch(console.error);
  if (alarm.name === "applyos-cloud-sync") {
    projectCurrentWorkspace()
      .then(() => ApplyOS.flushCloudMutations?.())
      .catch(() => {});
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ApplyOS.STORAGE_KEY]) updateBadge(false).catch(console.error);
  if (area === "local" && !materializingRepository && Object.keys(changes).some(isWorkspaceStorageKey)) queueWorkspaceProjection();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateSessions((sessions) => { delete sessions[ApplyOS.Submission.sessionKey(tabId)]; }).catch(() => {});
});

function isTrustedExtensionSender(sender) {
  return sender?.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
}

function requireTrustedSender(sender, sendResponse) {
  if (isTrustedExtensionSender(sender)) return true;
  sendResponse({ ok: false, error: "This account operation is available only from a Scout page." });
  return false;
}

async function autofillBundle() {
  const status = await ApplyOS.cloudStatus();
  if (!status.workspaceReady && !status.offlineAuthorized) throw new Error("Sign in to Scout before autofilling.");
  const [profile, state, graphStored] = await Promise.all([
    ApplyOS.getActiveProfile(),
    ApplyOS.getState(),
    chrome.storage.local.get("applyos_graph")
  ]);
  return {
    profile,
    answerMemory: (state.answer_memory || []).map(({ question, answer, scope, company_domain }) => ({ question, answer, scope, company_domain })),
    learnedAnswers: state.learned_answers || [],
    graphAnswers: (graphStored.applyos_graph?.nodes || []).filter((node) => node.type === "answer")
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLYOS_CLOUD_STATUS") {
    ApplyOS.cloudStatus().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_AUTOFILL_BUNDLE") {
    autofillBundle().then((bundle) => sendResponse({ ok: true, bundle })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_AGENT_PLAN") {
    autofillBundle()
      .then((bundle) => ApplyOS.generateAgentPlan(message.fields || [], bundle.profile || {}, message.job || {}))
      .then((plan) => sendResponse({ ok: true, plan }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_CONFIGURE") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    if (!ApplyOS.CLOUD_DEFAULTS?.allowRuntimeConfig) { sendResponse({ ok: false, error: "Runtime cloud configuration is disabled in this build." }); return false; }
    ApplyOS.saveCloudConfig(message.config).then((config) => sendResponse({ ok: true, config })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SIGN_IN") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.signInWithLinkedIn().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_AUTH_SIGN_IN_OAUTH") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.signInWithOAuth(message.provider).then(async (status) => {
    if (status.workspaceReady) await bootstrapAuthoritativeWorkspace();
      sendResponse({ ok: true, status });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_AUTH_EMAIL_REQUEST") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.requestEmailOtp(message.email).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_AUTH_EMAIL_VERIFY") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.verifyEmailOtp(message.email, message.token).then(async (status) => {
      if (status.workspaceReady) await bootstrapAuthoritativeWorkspace();
      sendResponse({ ok: true, status });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_LEGACY_IMPORT") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    chrome.storage.local.get(null)
      .then((workspace) => ApplyOS.prepareWorkspaceForCloud(workspace))
      .then((workspace) => ApplyOS.claimLegacyWorkspace(workspace, { confirmed: true }))
      .then((claim) => {
        if (!claim || !["accepted", "already_applied"].includes(claim.status)) throw new Error("The cloud workspace already contains data. Scout did not replace it with this browser copy.");
        return ApplyOS.importLegacyWorkspace().then((result) => ({ ...result, claim }));
      })
      .then(async (result) => {
        await materializeRepositoryWorkspace();
        sendResponse({ ok: true, result, status: await ApplyOS.cloudStatus() });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_LEGACY_DISCARD") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.discardLegacyWorkspace().then(async (status) => {
      await bootstrapAuthoritativeWorkspace();
      sendResponse({ ok: true, status });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SIGN_OUT") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.signOutCloud().then((status) => sendResponse({ ok: true, status })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SYNC") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    Promise.resolve()
      .then(() => projectCurrentWorkspace())
      .then(() => bootstrapAuthoritativeWorkspace())
      .then(async (result) => {
        const session = await ApplyOS.cloudSession();
        if (session?.user?.id) await ApplyOS.persistActiveUserCache?.(session.user.id);
        sendResponse({ ok: true, result: { ...result, status: result.meta?.status || "synced" } });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_CONFLICT_GET") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.getCloudRepositoryState()
      .then((repository) => sendResponse({ ok: true, conflict: repository.meta?.conflict || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_CONFLICT_RESOLVE") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    if (!["use_server", "retry_local"].includes(message.strategy)) {
      sendResponse({ ok: false, error: "Choose a valid conflict resolution." });
      return false;
    }
    ApplyOS.resolveCloudConflict(message.strategy)
      .then(() => bootstrapAuthoritativeWorkspace())
      .then(async (result) => sendResponse({ ok: true, result, status: await ApplyOS.cloudStatus() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_SNAPSHOT") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.getCloudRepositoryState()
      .then((repository) => sendResponse({
        ok: true,
        snapshot: {
          format: "applyos-authoritative-export-v1",
          exported_at: new Date().toISOString(),
          user_id: repository.userId,
          sync_cursor: Number(repository.meta?.cursor || 0),
          records: Object.values(repository.records || {})
            .filter((record) => !record.deletedAt)
            .map((record) => ({
              entity_type: record.entityType,
              entity_id: record.entityId,
              server_version: record.serverVersion,
              updated_at: record.updatedAt,
              payload: record.payload
            }))
        }
      }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_PUBLICATION_GET") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.getCandidatePublication().then((publication) => sendResponse({ ok: true, publication })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_PUBLICATION_SAVE") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
    ApplyOS.saveCandidatePublication(message.publication).then((publication) => sendResponse({ ok: true, publication })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_SUPPORT_SUBMIT") {
    ApplyOS.submitSupportReport(message.report).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "APPLYOS_CLOUD_DELETE_ACCOUNT") {
    if (!requireTrustedSender(_sender, sendResponse)) return false;
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
  if (message?.type === "SCOUT_PAGE_ACTION") {
    const tabId = messageTabId(message, _sender);
    if (tabId === null || _sender.frameId !== 0) { sendResponse({ ok: false, error: "Missing application tab." }); return false; }
    Promise.resolve().then(async () => {
      if (!["save", "autofill"].includes(message.action)) throw new Error("Choose a valid Scout page action.");
      const status = await ApplyOS.cloudStatus();
      if (!status.workspaceReady && !status.offlineAuthorized) throw new Error("Sign in to Scout before saving or autofilling.");
      const profile = await ApplyOS.getActiveProfile();
      const job = message.job && typeof message.job === "object" ? message.job : {};
      if (!String(job.company || "").trim() || !String(job.role || "").trim()) throw new Error("Review the detected company and role in Scout before saving.");
      const application = await ApplyOS.upsertApplication(job, profile);
      const session = await startApplicationSession(tabId, application, job.platform, message.url || _sender.tab?.url);
      const report = message.action === "autofill" ? await messageAllFrames(tabId, "APPLYKIT_FILL") : null;
      return { application, session, report };
    }).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
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
    startApplicationSession(tabId, message.application, message.platform, message.url).then(async (session) => {
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
