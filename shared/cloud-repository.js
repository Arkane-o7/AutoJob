(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const REPOSITORY_VERSION = 1;
  const KEY_PREFIX = `applyos_cloud_repository_v${REPOSITORY_VERSION}`;
  const MAX_PAYLOAD_BYTES = 512 * 1024;
  const MAX_OUTBOX_ITEMS = 5000;
  const DEFAULT_PULL_LIMIT = 250;
  const ENTITY_TYPES = Object.freeze([
    "profile",
    "application",
    "contact",
    "interview",
    "reminder",
    "answer_memory",
    "learned_answer",
    "resume_version",
    "knowledge_graph",
    "settings",
    "onboarding_progress"
  ]);
  const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
  const PRIVATE_ENTITY_TYPES = new Set([
    "reminder",
    "answer_memory",
    "learned_answer",
    "resume_version",
    "knowledge_graph",
    "settings",
    "onboarding_progress"
  ]);
  let transport = null;
  let repositoryOperationQueue = Promise.resolve();

  function nowISO() {
    return typeof ApplyOS.nowISO === "function" ? ApplyOS.nowISO() : new Date().toISOString();
  }

  function uid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    throw new Error("Scout cloud sync requires crypto.randomUUID support.");
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function serializeRepositoryOperation(operation) {
    const task = repositoryOperationQueue.then(operation, operation);
    repositoryOperationQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  function byteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }

  function semanticallyEqual(left, right) {
    return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
  }

  function safeId(value, label = "record id") {
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id)) throw new Error(`Invalid ${label}.`);
    return id;
  }

  function safeUserId(value) {
    const id = String(value || "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw new Error("The authenticated Scout user id is invalid.");
    }
    return id;
  }

  function safeEntityType(value) {
    const type = String(value || "");
    if (!ENTITY_TYPE_SET.has(type)) throw new Error(`Unsupported cloud entity type: ${type || "(empty)"}.`);
    return type;
  }

  function safePayload(value) {
    if (!isObject(value)) throw new Error("Cloud record payloads must be objects.");
    const payload = clone(value);
    if (byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error("Cloud record payload exceeds the 512 KiB limit.");
    return payload;
  }

  function safeDeviceLabel(value) {
    return String(value || "Chrome device").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Chrome device";
  }

  function withoutInlineFiles(value) {
    const output = clone(value);
    const visit = (item) => {
      if (!item || typeof item !== "object") return;
      if (Object.prototype.hasOwnProperty.call(item, "dataUrl")) item.dataUrl = "";
      if (Object.prototype.hasOwnProperty.call(item, "data_url")) item.data_url = "";
      for (const child of Object.values(item)) visit(child);
    };
    visit(output);
    return output;
  }

  function storageArea() {
    if (!root.chrome?.storage?.local) throw new Error("Scout cloud repository requires chrome.storage.local.");
    return chrome.storage.local;
  }

  function recordKey(type, id) {
    return `${safeEntityType(type)}:${safeId(id)}`;
  }

  function keysForUser(userId) {
    const owner = safeUserId(userId);
    return Object.freeze({
      cache: `${KEY_PREFIX}:${owner}:cache`,
      outbox: `${KEY_PREFIX}:${owner}:outbox`,
      meta: `${KEY_PREFIX}:${owner}:meta`,
      legacyClaim: `${KEY_PREFIX}:${owner}:legacy_claim`
    });
  }

  async function currentIdentity() {
    const provider = transport?.getSession || ApplyOS.getCloudSession || ApplyOS.cloudSession;
    if (typeof provider !== "function") {
      throw new Error("Cloud repository transport is not configured. The service worker must provide getSession().");
    }
    const session = await provider();
    const user = session?.user || session;
    if (!user?.id) throw new Error("Sign in to Scout before accessing the cloud workspace.");
    return { userId: safeUserId(user.id), user };
  }

  async function cloudRequest(path, options = {}) {
    const request = transport?.request || ApplyOS.cloudRequest;
    if (typeof request !== "function") {
      throw new Error("Cloud repository transport is not configured. The service worker must provide request(path, options).");
    }
    return request(path, options);
  }

  async function readUserState(userId) {
    const keys = keysForUser(userId);
    const stored = await storageArea().get([keys.cache, keys.outbox, keys.meta]);
    return {
      keys,
      cache: isObject(stored[keys.cache]) ? stored[keys.cache] : {},
      outbox: Array.isArray(stored[keys.outbox]) ? stored[keys.outbox] : [],
      meta: isObject(stored[keys.meta]) ? stored[keys.meta] : { cursor: 0, status: "not_started", lastPulledAt: null, lastFlushedAt: null, conflict: null }
    };
  }

  async function writeUserState(state) {
    await storageArea().set({
      [state.keys.cache]: state.cache,
      [state.keys.outbox]: state.outbox,
      [state.keys.meta]: state.meta
    });
  }

  function mutationFromInput(input, cachedRecord) {
    const entityType = safeEntityType(input.entityType || input.entity_type);
    const entityId = safeId(input.entityId || input.entity_id);
    const operation = input.operation === "delete" ? "delete" : "upsert";
    const payload = operation === "delete" ? {} : safePayload(input.payload);
    const explicitBase = input.baseVersion ?? input.base_server_version;
    const baseVersion = explicitBase == null
      ? Number(cachedRecord?.serverVersion || 0)
      : Number(explicitBase);
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) throw new Error("Cloud mutation base version is invalid.");
    return {
      mutationId: String(input.mutationId || input.mutation_id || uid()),
      entityType,
      entityId,
      operation,
      baseVersion,
      payload,
      createdAt: nowISO(),
      attempts: 0
    };
  }

  function applyChangeToCache(cache, change) {
    const entityType = safeEntityType(change.entity_type || change.entityType);
    const entityId = safeId(change.entity_id || change.entityId);
    const key = recordKey(entityType, entityId);
    const serverVersion = Number(change.server_version ?? change.serverVersion);
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) throw new Error("Cloud change has an invalid server version.");
    const deletedAt = change.deleted_at || change.deletedAt || null;
    cache[key] = {
      entityType,
      entityId,
      payload: deletedAt ? {} : safePayload(change.payload || {}),
      serverVersion,
      deletedAt,
      updatedAt: change.updated_at || change.created_at || nowISO()
    };
    return cache[key];
  }

  function reconcileEquivalentStoredConflict(state) {
    const conflict = state.meta?.conflict;
    if (!conflict || !semanticallyEqual(conflict.localPayload || {}, conflict.serverPayload || {})) return false;
    const serverVersion = Number(conflict.serverVersion || 0);
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) return false;
    const index = state.outbox.findIndex((item) => item.mutationId === conflict.mutationId);
    applyChangeToCache(state.cache, {
      entity_type: conflict.entityType,
      entity_id: conflict.entityId,
      payload: conflict.deletedAt ? {} : (conflict.serverPayload || {}),
      server_version: serverVersion,
      deleted_at: conflict.deletedAt || null,
      updated_at: conflict.detectedAt || nowISO()
    });
    if (index >= 0) state.outbox.splice(index, 1);
    state.meta = {
      ...state.meta,
      conflict: null,
      status: state.outbox.length ? "pending" : "synced",
      lastError: null,
      lastFlushedAt: nowISO()
    };
    return true;
  }

  function rebaseNextQueuedMutation(state, completedMutation, serverVersion) {
    const version = Number(serverVersion || 0);
    if (!Number.isSafeInteger(version) || version < 1) return false;
    const next = state.outbox.find((item) => item.entityType === completedMutation.entityType
      && item.entityId === completedMutation.entityId
      && item.mutationId !== completedMutation.mutationId);
    if (!next || Number(next.attempts || 0) > 0) return false;
    next.baseVersion = version;
    return true;
  }

  function rpcBody(mutation, deviceId) {
    return {
      p_mutation_id: mutation.mutationId,
      p_device_id: safeId(deviceId, "device id"),
      p_entity_type: mutation.entityType,
      p_entity_id: mutation.entityId,
      p_base_server_version: mutation.baseVersion,
      p_operation: mutation.operation,
      p_payload: mutation.payload
    };
  }

  async function repositoryDeviceId() {
    if (typeof transport?.getDeviceId === "function") return safeId(await transport.getDeviceId(), "device id");
    if (typeof ApplyOS.getCloudDeviceId === "function") return safeId(await ApplyOS.getCloudDeviceId(), "device id");
    const key = `${KEY_PREFIX}:device`;
    const stored = await storageArea().get(key);
    if (stored[key]) return safeId(stored[key], "device id");
    const value = `device_${uid()}`;
    await storageArea().set({ [key]: value });
    return value;
  }

  async function repositoryDeviceLabel() {
    if (typeof transport?.getDeviceLabel === "function") return safeDeviceLabel(await transport.getDeviceLabel());
    if (typeof ApplyOS.getCloudDeviceLabel === "function") return safeDeviceLabel(await ApplyOS.getCloudDeviceLabel());
    return "Chrome device";
  }

  async function registerRepositoryDevice(deviceId) {
    const deviceLabel = await repositoryDeviceLabel();
    await cloudRequest("/rest/v1/rpc/register_workspace_device", {
      method: "POST",
      body: JSON.stringify({ p_device_id: deviceId, p_device_label: deviceLabel })
    });
    return deviceLabel;
  }

  async function conflictProvenance(entityType, entityId, serverVersion) {
    try {
      const result = await cloudRequest("/rest/v1/rpc/workspace_record_provenance", {
        method: "POST",
        body: JSON.stringify({ p_entity_type: entityType, p_entity_id: entityId, p_server_version: Number(serverVersion || 0) })
      });
      return isObject(result) ? result : {};
    } catch (_error) {
      // Older backends still get a safe, readable conflict screen. Exact
      // cloud-device metadata appears after the accompanying migration lands.
      return {};
    }
  }

  /**
   * Installs service-worker-owned authentication and network hooks. The request
   * function must attach the current bearer token; tokens are never persisted by
   * this repository or exposed to content scripts.
   */
  ApplyOS.configureCloudRepository = function configureCloudRepository(value) {
    if (!value || typeof value.request !== "function" || typeof value.getSession !== "function") {
      throw new TypeError("configureCloudRepository requires request and getSession functions.");
    }
    transport = { request: value.request, getSession: value.getSession, getDeviceId: value.getDeviceId, getDeviceLabel: value.getDeviceLabel };
  };

  ApplyOS.CLOUD_ENTITY_TYPES = ENTITY_TYPES;
  ApplyOS.cloudRepositoryKeys = keysForUser;

  async function getCloudRepositoryState() {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    if (reconcileEquivalentStoredConflict(state)) await writeUserState(state);
    return { userId, records: clone(state.cache), outbox: clone(state.outbox), meta: clone(state.meta) };
  }

  async function getCloudRecord(entityType, entityId, options = {}) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    const record = state.cache[recordKey(entityType, entityId)] || null;
    if (record?.deletedAt && options.includeDeleted !== true) return null;
    return record ? clone(record) : null;
  }

  async function listCloudRecords(entityType, options = {}) {
    const type = safeEntityType(entityType);
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    return Object.values(state.cache)
      .filter((record) => record.entityType === type && (options.includeDeleted === true || !record.deletedAt))
      .map(clone);
  }

  async function enqueueCloudMutation(input = {}) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    const type = safeEntityType(input.entityType || input.entity_type);
    const id = safeId(input.entityId || input.entity_id);
    const mutation = mutationFromInput({ ...input, entityType: type, entityId: id }, state.cache[recordKey(type, id)]);
    if (state.outbox.length >= MAX_OUTBOX_ITEMS) throw new Error("Cloud sync queue is full. Reconnect and sync before making more changes.");

    const previousIndex = state.outbox.findIndex((item) => item.entityType === type && item.entityId === id && item.attempts === 0);
    if (previousIndex >= 0) {
      const previous = state.outbox[previousIndex];
      mutation.baseVersion = previous.baseVersion;
      state.outbox.splice(previousIndex, 1, mutation);
    } else {
      state.outbox.push(mutation);
    }
    state.meta = { ...state.meta, status: "pending", conflict: null };
    await writeUserState(state);
    return clone(mutation);
  }

  async function flushCloudMutations(options = {}) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    if (reconcileEquivalentStoredConflict(state)) await writeUserState(state);
    const deviceId = await repositoryDeviceId();
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    let flushed = 0;

    while (state.outbox.length && flushed < limit) {
      const mutation = state.outbox[0];
      mutation.attempts = Number(mutation.attempts || 0) + 1;
      mutation.lastAttemptAt = nowISO();
      await writeUserState(state);
      let result;
      try {
        result = await cloudRequest("/rest/v1/rpc/apply_workspace_mutation", {
          method: "POST",
          body: JSON.stringify(rpcBody(mutation, deviceId))
        });
      } catch (error) {
        state.meta = { ...state.meta, status: "offline", lastError: String(error?.message || error), lastErrorAt: nowISO() };
        await writeUserState(state);
        if (options.throwOnNetworkError === true) throw error;
        break;
      }

      if (result?.status === "conflict") {
        const serverPayload = safePayload(result.payload || {});
        const equivalentUpsert = mutation.operation === "upsert"
          && !result.deleted_at
          && semanticallyEqual(mutation.payload, serverPayload);
        const equivalentDelete = mutation.operation === "delete" && Boolean(result.deleted_at);
        if (equivalentUpsert || equivalentDelete) {
          // Another device already wrote the exact same logical record. Key
          // order is irrelevant, so adopt the server version and keep syncing
          // instead of asking the user to resolve a meaningless conflict.
          applyChangeToCache(state.cache, {
            entity_type: mutation.entityType,
            entity_id: mutation.entityId,
            payload: equivalentDelete ? {} : serverPayload,
            server_version: result.server_version,
            deleted_at: equivalentDelete ? result.deleted_at : null,
            updated_at: result.updated_at || nowISO()
          });
          state.outbox.shift();
          rebaseNextQueuedMutation(state, mutation, result.server_version);
          state.meta = { ...state.meta, status: state.outbox.length ? "pending" : "synced", conflict: null, lastError: null, lastFlushedAt: nowISO() };
          flushed += 1;
          await writeUserState(state);
          continue;
        }
        const [localDeviceLabel, provenance] = await Promise.all([
          repositoryDeviceLabel(),
          conflictProvenance(mutation.entityType, mutation.entityId, result.server_version)
        ]);
        const serverDeviceId = String(provenance.device_id || "");
        if (serverDeviceId && serverDeviceId === deviceId && Number(mutation.sameDeviceRebases || 0) < 1) {
          applyChangeToCache(state.cache, {
            entity_type: mutation.entityType,
            entity_id: mutation.entityId,
            payload: result.deleted_at ? {} : serverPayload,
            server_version: result.server_version,
            deleted_at: result.deleted_at || null,
            updated_at: provenance.updated_at || result.updated_at || nowISO()
          });
          mutation.baseVersion = Number(result.server_version || 0);
          mutation.attempts = 0;
          mutation.sameDeviceRebases = Number(mutation.sameDeviceRebases || 0) + 1;
          state.meta = { ...state.meta, status: "pending", conflict: null, lastError: null };
          await writeUserState(state);
          continue;
        }
        state.meta = {
          ...state.meta,
          status: "conflict",
          conflict: {
            mutationId: mutation.mutationId,
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            localPayload: clone(mutation.payload),
            serverPayload: clone(serverPayload),
            serverVersion: Number(result.server_version || 0),
            localDeviceId: deviceId,
            localDeviceLabel,
            localUpdatedAt: mutation.createdAt || mutation.lastAttemptAt || nowISO(),
            serverDeviceId,
            serverDeviceLabel: safeDeviceLabel(provenance.device_label || "Another Chrome device"),
            serverUpdatedAt: provenance.updated_at || result.updated_at || null,
            deletedAt: result.deleted_at || null,
            detectedAt: nowISO()
          }
        };
        await writeUserState(state);
        break;
      }

      if (!result || !["accepted", "already_applied"].includes(result.status)) {
        throw new Error("Scout Cloud returned an invalid mutation response.");
      }
      applyChangeToCache(state.cache, {
        entity_type: mutation.entityType,
        entity_id: mutation.entityId,
        payload: mutation.operation === "delete" ? {} : mutation.payload,
        server_version: result.server_version,
        deleted_at: mutation.operation === "delete" ? (result.deleted_at || nowISO()) : null,
        updated_at: result.updated_at || nowISO()
      });
      state.outbox.shift();
      rebaseNextQueuedMutation(state, mutation, result.server_version);
      state.meta = { ...state.meta, status: state.outbox.length ? "pending" : "synced", conflict: null, lastError: null, lastFlushedAt: nowISO() };
      flushed += 1;
      await writeUserState(state);
    }
    return { flushed, remaining: state.outbox.length, meta: clone(state.meta) };
  }

  async function pullCloudChanges(options = {}) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    const limit = Math.max(1, Math.min(500, Number(options.limit || DEFAULT_PULL_LIMIT)));
    let pages = 0;
    let received = 0;
    let hasMore = true;

    while (hasMore && pages < Math.max(1, Number(options.maxPages || 20))) {
      const result = await cloudRequest("/rest/v1/rpc/pull_workspace_changes", {
        method: "POST",
        body: JSON.stringify({ p_after_cursor: Number(state.meta.cursor || 0), p_limit: limit })
      });
      const changes = Array.isArray(result?.changes) ? result.changes : [];
      for (const change of changes) applyChangeToCache(state.cache, change);
      const nextCursor = Number(result?.cursor ?? state.meta.cursor ?? 0);
      if (!Number.isSafeInteger(nextCursor) || nextCursor < Number(state.meta.cursor || 0)) throw new Error("Scout Cloud returned an invalid sync cursor.");
      state.meta.cursor = nextCursor;
      state.meta.lastPulledAt = nowISO();
      state.meta.status = state.outbox.length ? "pending" : "synced";
      state.meta.lastError = null;
      hasMore = result?.has_more === true;
      received += changes.length;
      pages += 1;
      await writeUserState(state);
      if (changes.length === 0) break;
    }
    return { received, cursor: Number(state.meta.cursor || 0), hasMore, pages, records: clone(state.cache) };
  }

  async function resolveCloudConflict(strategy) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    const conflict = state.meta.conflict;
    if (!conflict) throw new Error("No cloud conflict is waiting for review.");
    const index = state.outbox.findIndex((item) => item.mutationId === conflict.mutationId);
    if (index < 0) throw new Error("The conflicting local change is no longer queued.");
    if (strategy === "use_server") {
      applyChangeToCache(state.cache, {
        entity_type: conflict.entityType,
        entity_id: conflict.entityId,
        payload: conflict.serverPayload,
        server_version: conflict.serverVersion,
        deleted_at: conflict.deletedAt
      });
      state.outbox.splice(index, 1);
      rebaseNextQueuedMutation(state, conflict, conflict.serverVersion);
    } else if (strategy === "retry_local") {
      state.outbox[index].baseVersion = Number(conflict.serverVersion || 0);
      state.outbox[index].attempts = 0;
    } else {
      throw new Error("Choose use_server or retry_local after reviewing both versions.");
    }
    state.meta = { ...state.meta, conflict: null, status: state.outbox.length ? "pending" : "synced" };
    await writeUserState(state);
    return { strategy, remaining: state.outbox.length, meta: clone(state.meta) };
  }

  async function bootstrapCloudRepository(options = {}) {
    const { userId } = await currentIdentity();
    const state = await readUserState(userId);
    const deviceId = await repositoryDeviceId();
    await registerRepositoryDevice(deviceId).catch(() => null);
    const server = await cloudRequest("/rest/v1/rpc/bootstrap_workspace", {
      method: "POST",
      body: JSON.stringify({ p_device_id: deviceId, p_after_cursor: Number(state.meta.cursor || 0), p_limit: Math.max(1, Math.min(500, Number(options.limit || DEFAULT_PULL_LIMIT))) })
    });
    for (const change of Array.isArray(server?.changes) ? server.changes : []) applyChangeToCache(state.cache, change);
    state.meta = {
      ...state.meta,
      cursor: Math.max(Number(state.meta.cursor || 0), Number(server?.cursor || 0)),
      status: state.outbox.length ? "pending" : "synced",
      accountStatus: server?.account_status || "active",
      lastPulledAt: nowISO(),
      conflict: null
    };
    await writeUserState(state);
    if (server?.has_more === true) await pullCloudChanges(options);
    return getCloudRepositoryState();
  }

  ApplyOS.getCloudRepositoryState = () => serializeRepositoryOperation(getCloudRepositoryState);
  ApplyOS.getCloudRecord = (entityType, entityId, options = {}) => serializeRepositoryOperation(() => getCloudRecord(entityType, entityId, options));
  ApplyOS.listCloudRecords = (entityType, options = {}) => serializeRepositoryOperation(() => listCloudRecords(entityType, options));
  ApplyOS.enqueueCloudMutation = (input = {}) => serializeRepositoryOperation(() => enqueueCloudMutation(input));
  ApplyOS.flushCloudMutations = (options = {}) => serializeRepositoryOperation(() => flushCloudMutations(options));
  ApplyOS.pullCloudChanges = (options = {}) => serializeRepositoryOperation(() => pullCloudChanges(options));
  ApplyOS.resolveCloudConflict = (strategy) => serializeRepositoryOperation(() => resolveCloudConflict(strategy));
  ApplyOS.bootstrapCloudRepository = (options = {}) => serializeRepositoryOperation(() => bootstrapCloudRepository(options));

  function addProjected(records, entityType, item, fallbackId) {
    if (!isObject(item)) return;
    const entityId = safeId(item.id || fallbackId);
    const payload = withoutInlineFiles(item);
    records.push({
      mutation_id: uid(),
      entity_type: safeEntityType(entityType),
      entity_id: entityId,
      payload: safePayload(payload),
      base_server_version: 0,
      operation: "upsert"
    });
  }

  /** Converts the schema-v5 local workspace into reviewed, ordered cloud records. */
  ApplyOS.projectLegacyWorkspace = function projectLegacyWorkspace(workspace = {}) {
    const records = [];
    const state = isObject(workspace[ApplyOS.STORAGE_KEY])
      ? workspace[ApplyOS.STORAGE_KEY]
      : (isObject(workspace.applyos_state) ? workspace.applyos_state : workspace);

    const profilesIndex = isObject(workspace.profilesIndex) ? workspace.profilesIndex : {};
    const profileIds = Array.isArray(profilesIndex.profiles) ? profilesIndex.profiles.map((item) => item?.id).filter(Boolean) : [];
    const activeProfileId = profilesIndex.activeId || profilesIndex.activeProfileId || "";
    const seenProfiles = new Set();
    for (const id of profileIds) {
      const profile = workspace[`profile_${id}`] || (activeProfileId === id ? workspace[ApplyOS.PROFILE_KEY] : null);
      if (isObject(profile)) { addProjected(records, "profile", { ...profile, id }, id); seenProfiles.add(id); }
    }
    if (isObject(workspace[ApplyOS.PROFILE_KEY]) && !seenProfiles.size) {
      addProjected(records, "profile", { ...workspace[ApplyOS.PROFILE_KEY], id: workspace[ApplyOS.PROFILE_KEY].id || "primary" }, "primary");
    }

    for (const item of Array.isArray(state.applications) ? state.applications : []) addProjected(records, "application", item);
    for (const item of Array.isArray(state.contacts) ? state.contacts : []) addProjected(records, "contact", item);
    for (const item of Array.isArray(state.interviews) ? state.interviews : []) addProjected(records, "interview", item);
    for (const item of Array.isArray(state.reminders) ? state.reminders : []) addProjected(records, "reminder", item);
    for (const item of Array.isArray(state.answer_memory) ? state.answer_memory : []) addProjected(records, "answer_memory", item);
    for (const item of Array.isArray(state.learned_answers) ? state.learned_answers : []) addProjected(records, "learned_answer", item);
    for (const item of Array.isArray(state.resume_versions) ? state.resume_versions : []) {
      addProjected(records, "resume_version", { ...item, dataUrl: "" }, item.id);
    }
    if (isObject(workspace.applyos_graph)) addProjected(records, "knowledge_graph", { id: "primary", ...workspace.applyos_graph }, "primary");
    if (isObject(state.settings)) addProjected(records, "settings", { id: "workspace", ...state.settings }, "workspace");
    if (isObject(workspace.applyos_tour_progress)) addProjected(records, "onboarding_progress", { id: "primary", ...workspace.applyos_tour_progress }, "primary");
    return records;
  };

  ApplyOS.claimLegacyWorkspace = async function claimLegacyWorkspace(workspace, options = {}) {
    if (options.confirmed !== true) throw new Error("Legacy workspace import requires explicit user confirmation.");
    const { userId } = await currentIdentity();
    const keys = keysForUser(userId);
    const stored = await storageArea().get(keys.legacyClaim);
    const claimId = stored[keys.legacyClaim]?.claimId || uid();
    const records = ApplyOS.projectLegacyWorkspace(workspace);
    if (records.length > MAX_OUTBOX_ITEMS) throw new Error("Legacy workspace contains too many records for one reviewed import.");
    // Persist the claim id before the request. If the server commits but the
    // browser closes before receiving the response, a retry remains idempotent.
    await storageArea().set({ [keys.legacyClaim]: { claimId, status: "pending", recordCount: records.length, startedAt: nowISO() } });
    const result = await cloudRequest("/rest/v1/rpc/claim_legacy_workspace", {
      method: "POST",
      body: JSON.stringify({ p_claim_id: claimId, p_device_id: await repositoryDeviceId(), p_records: records })
    });
    await storageArea().set({ [keys.legacyClaim]: { claimId, status: result?.status || "accepted", recordCount: records.length, claimedAt: nowISO() } });
    await ApplyOS.bootstrapCloudRepository();
    return { ...result, recordCount: records.length };
  };

  // Trusted service-worker convenience used after the account page's explicit
  // import confirmation. It deliberately has no content-script message route.
  ApplyOS.claimLegacyCloudWorkspace = async function claimLegacyCloudWorkspace() {
    const workspace = await storageArea().get(null);
    return ApplyOS.claimLegacyWorkspace(workspace, { confirmed: true });
  };

  ApplyOS.clearCloudRepositoryCache = async function clearCloudRepositoryCache(userId) {
    const keys = keysForUser(userId);
    await storageArea().remove([keys.cache, keys.outbox, keys.meta, keys.legacyClaim]);
  };
})(globalThis);
