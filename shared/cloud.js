(function (/** @type {any} */ root) {
  "use strict";
  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const CONFIG_KEY = "applyos_cloud_config";
  const SYNC_KEY = "applyos_sync_meta";
  const DEVICE_KEY = "applyos_device_id";
  const OWNER_KEY = "applyos_cloud_owner_id";
  const OUTBOX_KEY = "applyos_sync_outbox";
  const CLOUD_RESTORE_CHECKPOINT_KEY = "applyos_cloud_restore_checkpoint";
  const DB_NAME = "applyos-private-runtime";
  const SESSION_KEY = "auth-session";
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
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return normalizeConfig(stored[CONFIG_KEY]);
  };

  ApplyOS.saveCloudConfig = async function saveCloudConfig(value = {}) {
    const config = normalizeConfig(value);
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return config;
  };

  /** @param {string} path @param {any} options */
  async function request(path, options = {}) {
    const config = await ApplyOS.getCloudConfig();
    if (!config.projectUrl || !config.publishableKey) throw new Error("ApplyOS Cloud is not configured in this build.");
    const { public: isPublic, raw: wantsRaw, ...fetchOptions } = options;
    const session = isPublic ? null : await validSession();
    if (!isPublic && !session?.access_token) throw new Error("Sign in with LinkedIn first.");
    const response = await fetch(`${config.projectUrl}${path}`, {
      ...fetchOptions,
      headers: {
        apikey: config.publishableKey,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(fetchOptions.body && !(typeof Blob !== "undefined" && fetchOptions.body instanceof Blob) ? { "content-type": "application/json" } : {}),
        ...(fetchOptions.headers || {})
      }
    });
    if (wantsRaw && response.ok) return response.blob();
    const text = await response.text();
    const payload = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
    if (!response.ok) throw new Error(payload?.msg || payload?.message || payload?.code || `Cloud request failed (${response.status}).`);
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
    } catch { await privateDelete(SESSION_KEY); return null; }
  }

  ApplyOS.cloudStatus = async function cloudStatus() {
    const config = await ApplyOS.getCloudConfig();
    const session = await validSession();
    const stored = await chrome.storage.local.get([SYNC_KEY, DEVICE_KEY, OWNER_KEY]);
    const state = ApplyOS.getState ? await ApplyOS.getState() : { settings: {} };
    return {
      configured: Boolean(config.projectUrl && config.publishableKey),
      projectUrl: config.projectUrl,
      signedIn: Boolean(session?.user?.id),
      user: session?.user ? { id: session.user.id, email: session.user.email || "", name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || "", avatar: session.user.user_metadata?.avatar_url || "" } : null,
      sync: { enabled: false, status: "off", serverVersion: 0, lastSyncedAt: null, conflict: null, ...(stored[SYNC_KEY] || {}), resumeFilesEnabled: state.settings.resume_sync_enabled === true },
      deviceId: stored[DEVICE_KEY] || null,
      workspaceOwnerMismatch: Boolean(session?.user?.id && stored[OWNER_KEY] && stored[OWNER_KEY] !== session.user.id)
    };
  };

  async function assertWorkspaceOwner(userId) {
    const stored = await chrome.storage.local.get(OWNER_KEY);
    if (stored[OWNER_KEY] && stored[OWNER_KEY] !== userId) throw new Error("This browser workspace is linked to a different ApplyOS account. Sign back into that account or use a separate Chrome profile to prevent private data from mixing.");
    if (!stored[OWNER_KEY]) await chrome.storage.local.set({ [OWNER_KEY]: userId });
  }

  ApplyOS.signInWithLinkedIn = async function signInWithLinkedIn() {
    const config = await ApplyOS.getCloudConfig();
    if (!config.projectUrl || !config.publishableKey) throw new Error("Configure the Supabase project URL and publishable key first.");
    const redirectTo = chrome.identity.getRedirectURL("auth/callback");
    const verifier = randomToken();
    const challenge = await sha256(verifier);
    const url = new URL(`${config.projectUrl}/auth/v1/authorize`);
    url.searchParams.set("provider", config.provider || "linkedin_oidc");
    url.searchParams.set("redirect_to", redirectTo);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "s256");
    const callback = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
    if (!callback) throw new Error("LinkedIn sign-in was cancelled.");
    const result = new URL(callback);
    if (result.searchParams.get("error")) throw new Error(result.searchParams.get("error_description") || result.searchParams.get("error"));
    const code = result.searchParams.get("code");
    if (!code) throw new Error("The LinkedIn callback did not contain an authorization code.");
    const session = await request(`/auth/v1/token?grant_type=pkce`, { public: true, method: "POST", body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    await privateSet(SESSION_KEY, session);
    return ApplyOS.cloudStatus();
  };

  ApplyOS.signOutCloud = async function signOutCloud() {
    const session = await privateGet(SESSION_KEY);
    if (session?.access_token) await request("/auth/v1/logout", { method: "POST" }).catch(() => {});
    await privateDelete(SESSION_KEY);
    return ApplyOS.cloudStatus();
  };

  async function deviceId() {
    const stored = await chrome.storage.local.get(DEVICE_KEY);
    if (stored[DEVICE_KEY]) return stored[DEVICE_KEY];
    const id = `device_${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [DEVICE_KEY]: id });
    return id;
  }

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

  function withoutResumeBytes(value) {
    const copy = structuredClone(value || {});
    const strip = (resume) => resume && typeof resume === "object" ? { ...resume, dataUrl: "", cloud_object_path: "" } : resume;
    if (copy.profile?.resume) copy.profile.resume = strip(copy.profile.resume);
    for (const key of Object.keys(copy)) {
      if (/^profile_/.test(key) && copy[key]?.resume) copy[key].resume = strip(copy[key].resume);
    }
    if (copy.applyos_state?.resume_versions) copy.applyos_state.resume_versions = copy.applyos_state.resume_versions.map(strip);
    return copy;
  }

  ApplyOS.syncCloudNow = async function syncCloudNow(options = {}) {
    const state = await ApplyOS.getState();
    if (!state.settings.cloud_sync_enabled && !options.force) throw new Error("Cloud sync is off. Enable it after reviewing the privacy notice.");
    const status = await ApplyOS.cloudStatus();
    if (!status.signedIn) throw new Error("Sign in with LinkedIn first.");
    await assertWorkspaceOwner(status.user.id);
    const stored = await chrome.storage.local.get(null);
    const snapshotSource = Object.fromEntries(Object.entries(stored).filter(([key]) => ![CONFIG_KEY, SYNC_KEY, OUTBOX_KEY, CLOUD_RESTORE_CHECKPOINT_KEY].includes(key) && !key.startsWith("applyos_restore_checkpoint")));
    let payload = withoutResumeBytes(snapshotSource);
    if (state.settings.resume_sync_enabled === true) payload = await uploadResumeFiles(structuredClone(snapshotSource), status.user.id);
    const pending = stored[OUTBOX_KEY];
    const outbox = pending?.payload ? pending : { changeId: crypto.randomUUID(), baseServerVersion: Number(status.sync.serverVersion || 0), payload, createdAt: new Date().toISOString() };
    await chrome.storage.local.set({ [OUTBOX_KEY]: outbox });
    const result = await request("/rest/v1/rpc/apply_workspace_snapshot", { method: "POST", body: JSON.stringify({ p_change_id: outbox.changeId, p_device_id: await deviceId(), p_base_server_version: Number(outbox.baseServerVersion || 0), p_payload: outbox.payload }) });
    const next = result.status === "conflict"
      ? { ...status.sync, enabled: true, status: "conflict", serverVersion: result.server_version, conflict: { serverVersion: result.server_version, detectedAt: new Date().toISOString() } }
      : { enabled: true, status: "synced", serverVersion: result.server_version, lastSyncedAt: new Date().toISOString(), conflict: null };
    await chrome.storage.local.set({ [SYNC_KEY]: next });
    if (result.status !== "conflict") await chrome.storage.local.remove(OUTBOX_KEY);
    return { ...result, sync: next };
  };

  ApplyOS.getCloudSnapshot = async function getCloudSnapshot() {
    const session = await validSession();
    if (!session?.user?.id) throw new Error("Sign in with LinkedIn first.");
    await assertWorkspaceOwner(session.user.id);
    const rows = await request("/rest/v1/workspace_snapshots?select=payload,server_version,updated_at&limit=1");
    return Array.isArray(rows) ? rows[0] || null : null;
  };

  ApplyOS.restoreCloudSnapshot = async function restoreCloudSnapshot() {
    const snapshot = await ApplyOS.getCloudSnapshot();
    if (!snapshot?.payload || typeof snapshot.payload !== "object" || Array.isArray(snapshot.payload)) throw new Error("No valid cloud workspace is available.");
    const allowed = Object.fromEntries(Object.entries(structuredClone(snapshot.payload)).filter(([key]) => [ApplyOS.STORAGE_KEY, ApplyOS.PROFILE_KEY, "profilesIndex", "applyos_graph", "ollamaConfig", "applyos_tour_progress"].includes(key) || /^profile_[a-z0-9_:-]+$/i.test(key)));
    if (!allowed[ApplyOS.STORAGE_KEY]) throw new Error("The cloud copy does not contain a valid ApplyOS workspace.");
    if (allowed[ApplyOS.STORAGE_KEY]?.schema_version > ApplyOS.SCHEMA_VERSION) throw new Error("The cloud workspace was created by a newer ApplyOS version.");
    const current = await chrome.storage.local.get(Object.keys(allowed));
    await chrome.storage.local.set({ [CLOUD_RESTORE_CHECKPOINT_KEY]: { createdAt: new Date().toISOString(), keys: Object.keys(allowed), data: current } });
    await hydrateResumeFiles(allowed);
    await chrome.storage.local.set(allowed);
    await chrome.storage.local.remove(OUTBOX_KEY);
    const meta = { enabled: true, status: "synced", serverVersion: Number(snapshot.server_version || 0), lastSyncedAt: new Date().toISOString(), conflict: null };
    await chrome.storage.local.set({ [SYNC_KEY]: meta });
    await ApplyOS.ensureProfiles?.();
    await ApplyOS.ensureState?.();
    await ApplyOS.ensureGraph?.();
    return { restoredKeys: Object.keys(allowed).length, sync: meta };
  };

  ApplyOS.undoCloudRestore = async function undoCloudRestore() {
    const stored = await chrome.storage.local.get(CLOUD_RESTORE_CHECKPOINT_KEY);
    const checkpoint = stored[CLOUD_RESTORE_CHECKPOINT_KEY];
    if (!checkpoint?.data || typeof checkpoint.data !== "object") throw new Error("No cloud-restore checkpoint is available.");
    await chrome.storage.local.remove(Array.isArray(checkpoint.keys) ? checkpoint.keys : []);
    await chrome.storage.local.set(checkpoint.data);
    await chrome.storage.local.remove([CLOUD_RESTORE_CHECKPOINT_KEY, OUTBOX_KEY]);
    await ApplyOS.ensureProfiles?.();
    await ApplyOS.ensureState?.();
    await ApplyOS.ensureGraph?.();
    return { restoredKeys: Object.keys(checkpoint.data).length };
  };

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
    const result = await request(`/functions/v1/${config.deleteFunction}`, { method: "POST", body: "{}" });
    await privateDelete(SESSION_KEY);
    await chrome.storage.local.remove([SYNC_KEY, OUTBOX_KEY, OWNER_KEY]);
    return result;
  };
})(globalThis);
