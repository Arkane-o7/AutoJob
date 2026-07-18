(function (/** @type {any} */ root) {
  "use strict";
  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const CONFIG_KEY = "applyos_cloud_config";
  const SYNC_KEY = "applyos_sync_meta";
  const DEVICE_KEY = "applyos_device_id";
  const DEVICE_LABEL_KEY = "applyos_device_label";
  const OWNER_KEY = "applyos_cloud_owner_id";
  const OUTBOX_KEY = "applyos_sync_outbox";
  const CLOUD_RESTORE_CHECKPOINT_KEY = "applyos_cloud_restore_checkpoint";
  const CACHE_OWNER_KEY = "applyos_cache_owner_id";
  const CACHE_PREFIX = "applyos_user_cache:";
  const LEGACY_DECISION_KEY = "applyos_legacy_workspace_decision";
  const DB_NAME = "applyos-private-runtime";
  const SESSION_KEY = "auth-session";
  const WORKSPACE_KEYS = [
    ApplyOS.STORAGE_KEY || "applyos_state",
    ApplyOS.PROFILE_KEY || "profile",
    "profilesIndex",
    "applyos_graph",
    "ollamaConfig",
    "applyos_tour_progress"
  ];
  let memorySession = null;

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function sha256(value) {
    return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  }

  function randomToken(size = 48) {
    return base64Url(crypto.getRandomValues(new Uint8Array(size)));
  }

  function openPrivateDb() {
    if (!root.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("private");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function privateGet(key) {
    const db = await openPrivateDb();
    if (!db) return memorySession;
    return new Promise((resolve, reject) => {
      const request = db.transaction("private").objectStore("private").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function privateSet(key, value) {
    memorySession = value;
    const db = await openPrivateDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const request = db.transaction("private", "readwrite").objectStore("private").put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function privateDelete(key) {
    memorySession = null;
    const db = await openPrivateDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const request = db.transaction("private", "readwrite").objectStore("private").delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function normalizeConfig(value = {}) {
    const projectUrl = String(value.projectUrl || "").trim().replace(/\/+$/, "");
    return {
      ...ApplyOS.CLOUD_DEFAULTS,
      ...value,
      projectUrl: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl) || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(projectUrl) ? projectUrl : "",
      publishableKey: String(value.publishableKey || "").trim()
    };
  }

  ApplyOS.getCloudConfig = async function getCloudConfig() {
    if (ApplyOS.CLOUD_DEFAULTS?.allowRuntimeConfig !== true) return normalizeConfig(ApplyOS.CLOUD_DEFAULTS);
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return normalizeConfig({ ...ApplyOS.CLOUD_DEFAULTS, ...(stored[CONFIG_KEY] || {}) });
  };

  ApplyOS.saveCloudConfig = async function saveCloudConfig(value = {}) {
    if (ApplyOS.CLOUD_DEFAULTS?.allowRuntimeConfig !== true) throw new Error("Runtime cloud configuration is disabled in this build.");
    const config = normalizeConfig(value);
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return config;
  };

  /** @param {string} path @param {any} options */
  async function request(path, options = {}) {
    const config = await ApplyOS.getCloudConfig();
    if (!config.projectUrl || !config.publishableKey) throw new Error("Scout Cloud is not configured in this build.");
    const { public: isPublic, raw: wantsRaw, ...fetchOptions } = options;
    const session = isPublic ? null : await validSession();
    if (!isPublic && !session?.access_token) throw new Error("Sign in to Scout first.");
    let response;
    try {
      response = await fetch(`${config.projectUrl}${path}`, {
        ...fetchOptions,
        headers: {
          apikey: config.publishableKey,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          ...(fetchOptions.body && !(typeof Blob !== "undefined" && fetchOptions.body instanceof Blob) ? { "content-type": "application/json" } : {}),
          ...(fetchOptions.headers || {})
        }
      });
    } catch (cause) {
      const error = Object.assign(new Error("Scout Cloud is temporarily unreachable. Your reviewed changes will remain pending on this device."), { status: 0, cause });
      throw error;
    }
    if (wantsRaw && response.ok) return response.blob();
    const text = await response.text();
    const payload = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
    if (!response.ok) {
      const error = Object.assign(new Error(payload?.msg || payload?.message || payload?.code || `Cloud request failed (${response.status}).`), { status: response.status });
      throw error;
    }
    return payload;
  }

  async function validSession() {
    let session = await privateGet(SESSION_KEY);
    if (!session?.access_token) return null;
    if (Number(session.expires_at || 0) * 1000 > Date.now() + 60_000) return session;
    if (!session.refresh_token) { await privateDelete(SESSION_KEY); return null; }
    try {
      const refreshed = await request(`/auth/v1/token?grant_type=refresh_token`, { public: true, method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) });
      session = { ...refreshed, expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600) };
      await privateSet(SESSION_KEY, session);
      return session;
    } catch (error) {
      if (error?.status === 0) return { ...session, offline: true };
      await privateDelete(SESSION_KEY);
      return null;
    }
  }

  function cacheKey(userId) {
    return `${CACHE_PREFIX}${String(userId || "")}`;
  }

  async function workspaceSnapshot() {
    const stored = await chrome.storage.local.get(null);
    return Object.fromEntries(Object.entries(stored).filter(([key]) => WORKSPACE_KEYS.includes(key) || /^profile_[a-z0-9_:-]+$/i.test(key)));
  }

  function summarizeWorkspace(value = {}) {
    const state = value[ApplyOS.STORAGE_KEY] || {};
    const profiles = value.profilesIndex?.profiles || [];
    return {
      profiles: profiles.length || (value[ApplyOS.PROFILE_KEY] ? 1 : 0),
      applications: Array.isArray(state.applications) ? state.applications.length : 0,
      contacts: Array.isArray(state.contacts) ? state.contacts.length : 0,
      interviews: Array.isArray(state.interviews) ? state.interviews.length : 0,
      answers: Array.isArray(state.answer_memory) ? state.answer_memory.length : 0,
      resumes: Array.isArray(state.resume_versions) ? state.resume_versions.length : 0
    };
  }

  async function removeActiveWorkspace() {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored).filter((key) => WORKSPACE_KEYS.includes(key) || /^profile_[a-z0-9_:-]+$/i.test(key));
    if (keys.length) await chrome.storage.local.remove(keys);
  }

  async function persistActiveCache(userId) {
    if (!userId) return;
    const data = await workspaceSnapshot();
    await chrome.storage.local.set({ [cacheKey(userId)]: { userId, updatedAt: new Date().toISOString(), data } });
  }

  async function activateUserCache(userId) {
    const stored = await chrome.storage.local.get([cacheKey(userId), CACHE_OWNER_KEY]);
    if (stored[CACHE_OWNER_KEY] && stored[CACHE_OWNER_KEY] !== userId) await removeActiveWorkspace();
    const cache = stored[cacheKey(userId)];
    // A same-owner active workspace may contain newer offline edits than the
    // last named cache snapshot. Restore the snapshot only when reconnecting a
    // cache that is not already active.
    if (stored[CACHE_OWNER_KEY] !== userId && cache?.data && typeof cache.data === "object") await chrome.storage.local.set(cache.data);
    await chrome.storage.local.set({ [CACHE_OWNER_KEY]: userId, [OWNER_KEY]: userId });
  }

  async function legacyWorkspace() {
    const stored = await chrome.storage.local.get([CACHE_OWNER_KEY, LEGACY_DECISION_KEY, ...WORKSPACE_KEYS]);
    if (stored[CACHE_OWNER_KEY] || stored[LEGACY_DECISION_KEY]) return null;
    const data = await workspaceSnapshot();
    const summary = summarizeWorkspace(data);
    return Object.values(summary).some((count) => count > 0) ? { data, summary } : null;
  }

  ApplyOS.cloudStatus = async function cloudStatus() {
    const config = await ApplyOS.getCloudConfig();
    const session = await validSession();
    const stored = await chrome.storage.local.get([SYNC_KEY, DEVICE_KEY, OWNER_KEY, CACHE_OWNER_KEY, ApplyOS.STORAGE_KEY]);
    const state = stored[ApplyOS.STORAGE_KEY] || { settings: {} };
    const legacy = session?.user?.id ? await legacyWorkspace() : null;
    const cacheOwner = stored[CACHE_OWNER_KEY] || stored[OWNER_KEY] || null;
    const ownerMatches = Boolean(session?.user?.id && cacheOwner === session.user.id);
    const migrationRequired = Boolean(session?.user?.id && legacy);
    let repository = null;
    if (session?.user?.id && !migrationRequired && typeof ApplyOS.getCloudRepositoryState === "function") {
      repository = await ApplyOS.getCloudRepositoryState().catch(() => null);
    }
    const repositorySync = repository ? {
      enabled: true,
      status: repository.meta?.status || (repository.outbox?.length ? "pending" : "synced"),
      serverVersion: 0,
      lastSyncedAt: repository.meta?.lastFlushedAt || repository.meta?.lastPulledAt || null,
      conflict: repository.meta?.conflict ? {
        entityType: repository.meta.conflict.entityType,
        entityId: repository.meta.conflict.entityId,
        detectedAt: repository.meta.conflict.detectedAt
      } : null,
      pendingCount: repository.outbox?.length || 0,
      error: repository.meta?.lastError || null
    } : null;
    return {
      configured: Boolean(config.projectUrl && config.publishableKey),
      projectUrl: config.projectUrl,
      signedIn: Boolean(session?.user?.id),
      user: session?.user ? { id: session.user.id, email: session.user.email || "", name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || "", avatar: session.user.user_metadata?.avatar_url || "" } : null,
      sync: { enabled: true, status: "pending", serverVersion: 0, lastSyncedAt: null, conflict: null, ...(stored[SYNC_KEY] || {}), ...(repositorySync || {}), resumeFilesEnabled: state.settings?.resume_sync_enabled !== false },
      deviceId: stored[DEVICE_KEY] || null,
      offline: Boolean(session?.offline),
      offlineAuthorized: Boolean(session?.user?.id && session?.offline && ownerMatches),
      migrationRequired,
      legacyWorkspaceAvailable: Boolean(legacy),
      legacySummary: legacy?.summary || null,
      workspaceReady: Boolean(session?.user?.id && !migrationRequired && (!cacheOwner || ownerMatches)),
      workspaceOwnerMismatch: Boolean(session?.user?.id && cacheOwner && cacheOwner !== session.user.id)
    };
  };

  ApplyOS.signInWithOAuth = async function signInWithOAuth(provider = "google") {
    const config = await ApplyOS.getCloudConfig();
    if (!config.projectUrl || !config.publishableKey) throw new Error("This Scout build is missing its cloud connection. Reinstall or contact support.");
    if (!new Set(["google", "linkedin_oidc"]).has(provider)) throw new Error("Unsupported sign-in provider.");
    const redirectTo = chrome.identity.getRedirectURL("auth/callback");
    const verifier = randomToken();
    const challenge = await sha256(verifier);
    const url = new URL(`${config.projectUrl}/auth/v1/authorize`);
    url.searchParams.set("provider", provider);
    url.searchParams.set("redirect_to", redirectTo);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "s256");
    const callback = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
    if (!callback) throw new Error("Sign-in was cancelled.");
    const result = new URL(callback);
    if (result.searchParams.get("error")) throw new Error(result.searchParams.get("error_description") || result.searchParams.get("error"));
    const code = result.searchParams.get("code");
    if (!code) throw new Error("The sign-in callback did not contain an authorization code.");
    const session = await request(`/auth/v1/token?grant_type=pkce`, { public: true, method: "POST", body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    await privateSet(SESSION_KEY, session);
    if (!(await legacyWorkspace())) await activateUserCache(session.user?.id);
    return ApplyOS.cloudStatus();
  };

  ApplyOS.signInWithLinkedIn = async function signInWithLinkedIn() {
    return ApplyOS.signInWithOAuth("linkedin_oidc");
  };

  ApplyOS.requestEmailOtp = async function requestEmailOtp(email) {
    const value = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");
    await request("/auth/v1/otp", { public: true, method: "POST", body: JSON.stringify({ email: value, create_user: true }) });
    return { email: value };
  };

  ApplyOS.verifyEmailOtp = async function verifyEmailOtp(email, token) {
    const value = String(email || "").trim().toLowerCase();
    const code = String(token || "").trim();
    if (!/^\d{6,8}$/.test(code)) throw new Error("Enter the verification code from your email.");
    const session = await request("/auth/v1/verify", { public: true, method: "POST", body: JSON.stringify({ email: value, token: code, type: "email" }) });
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    await privateSet(SESSION_KEY, session);
    if (!(await legacyWorkspace())) await activateUserCache(session.user?.id);
    return ApplyOS.cloudStatus();
  };

  ApplyOS.signOutCloud = async function signOutCloud() {
    const session = await privateGet(SESSION_KEY);
    if (session?.user?.id) await persistActiveCache(session.user.id);
    if (session?.access_token) await request("/auth/v1/logout", { method: "POST" }).catch(() => {});
    await privateDelete(SESSION_KEY);
    await removeActiveWorkspace();
    await chrome.storage.local.remove([CACHE_OWNER_KEY, OWNER_KEY]);
    return ApplyOS.cloudStatus();
  };

  ApplyOS.importLegacyWorkspace = async function importLegacyWorkspace() {
    const session = await validSession();
    if (!session?.user?.id) throw new Error("Sign in before importing this workspace.");
    const legacy = await legacyWorkspace();
    if (!legacy) throw new Error("No unclaimed local workspace is available.");
    await chrome.storage.local.set({
      [CACHE_OWNER_KEY]: session.user.id,
      [OWNER_KEY]: session.user.id,
      [LEGACY_DECISION_KEY]: { decision: "imported", userId: session.user.id, at: new Date().toISOString() },
      [cacheKey(session.user.id)]: { userId: session.user.id, updatedAt: new Date().toISOString(), data: legacy.data }
    });
    return { summary: legacy.summary, status: await ApplyOS.cloudStatus() };
  };

  ApplyOS.discardLegacyWorkspace = async function discardLegacyWorkspace() {
    const session = await validSession();
    if (!session?.user?.id) throw new Error("Sign in before starting a new workspace.");
    await removeActiveWorkspace();
    await chrome.storage.local.set({
      [CACHE_OWNER_KEY]: session.user.id,
      [OWNER_KEY]: session.user.id,
      [LEGACY_DECISION_KEY]: { decision: "discarded", userId: session.user.id, at: new Date().toISOString() }
    });
    await activateUserCache(session.user.id);
    return ApplyOS.cloudStatus();
  };

  ApplyOS.cloudRequest = request;
  ApplyOS.cloudSession = validSession;
  ApplyOS.persistActiveUserCache = persistActiveCache;

  // Browser regressions need an authenticated account without talking to a
  // real identity provider. This hook is absent from production builds.
  if (ApplyOS.CLOUD_DEFAULTS?.buildMode !== "production") {
    ApplyOS.installDevelopmentSession = async function installDevelopmentSession(session) {
      if (!session?.access_token || !session?.user?.id) throw new Error("A development session requires an access token and user id.");
      await privateSet(SESSION_KEY, {
        ...structuredClone(session),
        expires_at: Number(session.expires_at || Math.floor(Date.now() / 1000) + 3600)
      });
      return ApplyOS.cloudStatus();
    };
  }

  async function deviceId() {
    const stored = await chrome.storage.local.get(DEVICE_KEY);
    if (stored[DEVICE_KEY]) return stored[DEVICE_KEY];
    const id = `device_${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [DEVICE_KEY]: id });
    return id;
  }

  ApplyOS.getCloudDeviceId = deviceId;

  function inferredDeviceLabel() {
    const platform = String(root.navigator?.userAgentData?.platform || root.navigator?.platform || root.navigator?.userAgent || "").toLowerCase();
    const operatingSystem = /mac/.test(platform)
      ? "macOS"
      : /win/.test(platform)
        ? "Windows"
        : /android/.test(platform)
          ? "Android"
          : /iphone|ipad|ios/.test(platform)
            ? "iOS"
            : /linux|x11/.test(platform)
              ? "Linux"
              : "this device";
    return operatingSystem === "this device" ? "Chrome on this device" : `Chrome on ${operatingSystem}`;
  }

  async function deviceLabel() {
    const stored = await chrome.storage.local.get(DEVICE_LABEL_KEY);
    const existing = String(stored[DEVICE_LABEL_KEY] || "").trim();
    if (existing) return existing.slice(0, 80);
    const label = inferredDeviceLabel();
    await chrome.storage.local.set({ [DEVICE_LABEL_KEY]: label });
    return label;
  }

  ApplyOS.getCloudDeviceLabel = deviceLabel;

  function resumeRecords(value) {
    const records = [];
    if (value.profile?.resume) records.push(value.profile.resume);
    for (const key of Object.keys(value)) {
      if (/^profile_/.test(key) && value[key]?.resume) records.push(value[key].resume);
    }
    if (value.applyos_state?.resume_versions) records.push(...value.applyos_state.resume_versions);
    return records.filter((item) => item && typeof item === "object");
  }

  function safeObjectName(resume, index) {
    const identity = String(resume.sha256 || resume.id || `resume-${index}`).replace(/[^a-z0-9._-]/gi, "-").slice(0, 120);
    const name = String(resume.fileName || resume.file_name || resume.name || "resume.pdf");
    const extension = (name.match(/\.(pdf|doc|docx)$/i)?.[1] || "bin").toLowerCase();
    return `${identity}.${extension}`;
  }

  async function uploadResumeFiles(value, userId) {
    const cache = new Map();
    let index = 0;
    for (const resume of resumeRecords(value)) {
      index += 1;
      if (!String(resume.dataUrl || "").startsWith("data:")) { resume.dataUrl = ""; continue; }
      const cacheKey = String(resume.sha256 || resume.dataUrl);
      let path = cache.get(cacheKey);
      if (!path) {
        const blob = await fetch(resume.dataUrl).then((response) => response.blob());
        path = `${userId}/${safeObjectName(resume, index)}`;
        await request(`/storage/v1/object/resumes/${path.split("/").map(encodeURIComponent).join("/")}`, {
          method: "POST",
          headers: { "content-type": blob.type || resume.type || resume.mime_type || "application/octet-stream", "x-upsert": "true" },
          body: blob
        });
        cache.set(cacheKey, path);
      }
      resume.cloud_object_path = path;
      resume.dataUrl = "";
    }
    return value;
  }

  ApplyOS.prepareWorkspaceForCloud = async function prepareWorkspaceForCloud(value) {
    const session = await validSession();
    if (!session?.user?.id) throw new Error("Sign in before uploading this workspace.");
    return uploadResumeFiles(structuredClone(value || {}), session.user.id);
  };

  async function hydrateResumeFiles(value) {
    const cache = new Map();
    for (const resume of resumeRecords(value)) {
      const path = String(resume.cloud_object_path || "");
      if (!path || !path.includes("/")) continue;
      let dataUrl = cache.get(path);
      if (!dataUrl) {
        const blob = await request(`/storage/v1/object/resumes/${path.split("/").map(encodeURIComponent).join("/")}`, { raw: true });
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        cache.set(path, dataUrl);
      }
      resume.dataUrl = dataUrl;
    }
    return value;
  }

  ApplyOS.hydrateWorkspaceFiles = hydrateResumeFiles;

  ApplyOS.getCandidatePublication = async function getCandidatePublication() {
    const rows = await request("/rest/v1/candidate_publications?select=*&limit=1");
    return Array.isArray(rows) ? rows[0] || null : null;
  };

  ApplyOS.saveCandidatePublication = async function saveCandidatePublication(publication = {}) {
    const session = await validSession();
    if (!session?.user?.id) throw new Error("Sign in first.");
    const safe = {
      user_id: session.user.id,
      visibility: publication.visibility === "recruiters" ? "recruiters" : "private",
      headline: String(publication.headline || "").slice(0, 160),
      target_roles: (Array.isArray(publication.target_roles) ? publication.target_roles : []).slice(0, 12).map((item) => String(item).slice(0, 100)),
      location: String(publication.location || "").slice(0, 160),
      skills: (Array.isArray(publication.skills) ? publication.skills : []).slice(0, 80).map((item) => String(item).slice(0, 80)),
      experience_summary: String(publication.experience_summary || "").slice(0, 2000),
      portfolio_url: String(publication.portfolio_url || "").slice(0, 500),
      linkedin_url: String(publication.linkedin_url || "").slice(0, 500),
      published_at: publication.visibility === "recruiters" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };
    const rows = await request("/rest/v1/candidate_publications?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(safe) });
    return Array.isArray(rows) ? rows[0] : rows;
  };

  ApplyOS.submitSupportReport = async function submitSupportReport(input = {}) {
    const config = await ApplyOS.getCloudConfig();
    return request(`/functions/v1/${config.supportFunction}`, { method: "POST", body: JSON.stringify(input) });
  };

  ApplyOS.deleteCloudAccount = async function deleteCloudAccount() {
    const config = await ApplyOS.getCloudConfig();
    const session = await validSession();
    const userId = session?.user?.id || "";
    const result = await request(`/functions/v1/${config.deleteFunction}`, { method: "POST", body: "{}" });
    if (userId) await ApplyOS.clearCloudRepositoryCache?.(userId);
    await privateDelete(SESSION_KEY);
    await removeActiveWorkspace();
    await chrome.storage.local.remove([SYNC_KEY, OUTBOX_KEY, OWNER_KEY, CACHE_OWNER_KEY, LEGACY_DECISION_KEY, cacheKey(userId), `applyos_projection_shadow:${userId}`]);
    return result;
  };
})(globalThis);
