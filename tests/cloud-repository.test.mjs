import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";

async function repositoryRuntime(responses = []) {
  const data = {};
  const calls = [];
  const local = {
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const context = vm.createContext({ console, TextEncoder, structuredClone, crypto: webcrypto, chrome: { storage: { local } } });
  context.globalThis = context;
  context.ApplyOS = { STORAGE_KEY: "applyos_state", PROFILE_KEY: "profile", nowISO: () => "2026-07-18T00:00:00.000Z" };
  vm.runInContext(await readFile(resolve("shared/cloud-repository.js"), "utf8"), context, { filename: "shared/cloud-repository.js" });
  context.ApplyOS.configureCloudRepository({
    getSession: async () => ({ user: { id: USER_ID } }),
    getDeviceId: async () => "device_browser_test",
    getDeviceLabel: async () => "Chrome on macOS",
    request: async (path, options) => {
      calls.push({ path, body: JSON.parse(options.body) });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { status: "accepted", server_version: calls.length };
    }
  });
  return { ApplyOS: context.ApplyOS, data, calls };
}

test("cloud repository coalesces unsent edits and flushes one idempotent record mutation", async () => {
  const runtime = await repositoryRuntime([{ status: "accepted", server_version: 4 }]);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_1", payload: { role: "Engineer" } });
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_1", payload: { role: "Senior Engineer" } });
  assert.equal((await runtime.ApplyOS.getCloudRepositoryState()).outbox.length, 1);
  const result = await runtime.ApplyOS.flushCloudMutations();
  assert.deepEqual({ flushed: result.flushed, remaining: result.remaining }, { flushed: 1, remaining: 0 });
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].path, "/rest/v1/rpc/apply_workspace_mutation");
  assert.equal(runtime.calls[0].body.p_payload.role, "Senior Engineer");
  assert.equal((await runtime.ApplyOS.getCloudRecord("application", "job_1")).serverVersion, 4);
});

test("same-browser enqueue and flush operations serialize without creating a stale-version conflict", async () => {
  let releaseFirst;
  const firstResponse = new Promise((resolveResponse) => { releaseFirst = resolveResponse; });
  const runtime = await repositoryRuntime([
    firstResponse,
    { status: "accepted", server_version: 2 }
  ]);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_race", payload: { notes: "first edit" } });

  const firstFlush = runtime.ApplyOS.flushCloudMutations();
  while (runtime.calls.length < 1) await new Promise((resolveTick) => setImmediate(resolveTick));
  const secondEdit = runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_race", payload: { notes: "second edit" } });
  const secondFlush = runtime.ApplyOS.flushCloudMutations();
  releaseFirst({ status: "accepted", server_version: 1 });

  await Promise.all([firstFlush, secondEdit, secondFlush]);
  const mutationCalls = runtime.calls.filter((call) => call.path === "/rest/v1/rpc/apply_workspace_mutation");
  assert.equal(mutationCalls.length, 2);
  assert.deepEqual(mutationCalls.map((call) => call.body.p_base_server_version), [0, 1]);
  const repository = await runtime.ApplyOS.getCloudRepositoryState();
  assert.equal(repository.meta.status, "synced");
  assert.equal(repository.meta.conflict, null);
  assert.equal(repository.outbox.length, 0);
  assert.equal((await runtime.ApplyOS.getCloudRecord("application", "job_race")).payload.notes, "second edit");
});

test("a later same-record edit rebases after an attempted offline mutation succeeds", async () => {
  const runtime = await repositoryRuntime([
    new Error("offline"),
    { status: "accepted", server_version: 1 },
    { status: "accepted", server_version: 2 }
  ]);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_retry", payload: { notes: "offline edit" } });
  assert.equal((await runtime.ApplyOS.flushCloudMutations()).remaining, 1);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_retry", payload: { notes: "latest edit" } });

  const result = await runtime.ApplyOS.flushCloudMutations();
  const mutationCalls = runtime.calls.filter((call) => call.path === "/rest/v1/rpc/apply_workspace_mutation");
  assert.deepEqual(mutationCalls.map((call) => call.body.p_base_server_version), [0, 0, 1]);
  assert.deepEqual({ flushed: result.flushed, remaining: result.remaining, status: result.meta.status }, { flushed: 2, remaining: 0, status: "synced" });
  assert.equal((await runtime.ApplyOS.getCloudRecord("application", "job_retry")).payload.notes, "latest edit");
});

test("a stale conflict from the same browser automatically rebases once", async () => {
  const runtime = await repositoryRuntime([
    { status: "conflict", server_version: 4, payload: { notes: "earlier same-browser sync" }, updated_at: "2026-07-18T00:01:00.000Z" },
    { device_id: "device_browser_test", device_label: "Chrome on macOS", updated_at: "2026-07-18T00:01:00.000Z" },
    { status: "accepted", server_version: 5, updated_at: "2026-07-18T00:02:00.000Z" }
  ]);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "application", entityId: "job_same_device", payload: { notes: "current browser edit" } });

  const result = await runtime.ApplyOS.flushCloudMutations();
  const mutationCalls = runtime.calls.filter((call) => call.path === "/rest/v1/rpc/apply_workspace_mutation");
  assert.deepEqual(mutationCalls.map((call) => call.body.p_base_server_version), [0, 4]);
  assert.deepEqual({ flushed: result.flushed, remaining: result.remaining, status: result.meta.status }, { flushed: 1, remaining: 0, status: "synced" });
  assert.equal(result.meta.conflict, null);
  assert.equal((await runtime.ApplyOS.getCloudRecord("application", "job_same_device")).payload.notes, "current browser edit");
});

test("cloud repository preserves readable version provenance for explicit conflict review", async () => {
  const runtime = await repositoryRuntime([
    { status: "conflict", server_version: 9, payload: { notes: "server copy" } },
    { device_id: "device_other", device_label: "Chrome on Windows", updated_at: "2026-07-17T23:00:00.000Z" }
  ]);
  await runtime.ApplyOS.enqueueCloudMutation({ entityType: "contact", entityId: "contact_1", payload: { notes: "local copy" } });
  const result = await runtime.ApplyOS.flushCloudMutations();
  assert.equal(result.remaining, 1);
  assert.equal(result.meta.status, "conflict");
  assert.equal(result.meta.conflict.localPayload.notes, "local copy");
  assert.equal(result.meta.conflict.serverPayload.notes, "server copy");
  assert.equal(result.meta.conflict.localDeviceLabel, "Chrome on macOS");
  assert.equal(result.meta.conflict.serverDeviceLabel, "Chrome on Windows");
  assert.equal(result.meta.conflict.serverUpdatedAt, "2026-07-17T23:00:00.000Z");
  assert.equal(runtime.calls[1].path, "/rest/v1/rpc/workspace_record_provenance");
});

test("cloud repository silently reconciles semantically identical records", async () => {
  const runtime = await repositoryRuntime([{ status: "conflict", server_version: 9, payload: { version: 1, completedAt: null, id: "primary", lastStep: 3 } }]);
  await runtime.ApplyOS.enqueueCloudMutation({
    entityType: "onboarding_progress",
    entityId: "primary",
    payload: { completedAt: null, id: "primary", lastStep: 3, version: 1 }
  });
  const result = await runtime.ApplyOS.flushCloudMutations();
  assert.deepEqual({ flushed: result.flushed, remaining: result.remaining, status: result.meta.status }, { flushed: 1, remaining: 0, status: "synced" });
  assert.equal(result.meta.conflict, null);
  assert.equal((await runtime.ApplyOS.getCloudRecord("onboarding_progress", "primary")).serverVersion, 9);
});

test("cloud repository clears an already-stored identical conflict on status read", async () => {
  const runtime = await repositoryRuntime();
  const mutation = await runtime.ApplyOS.enqueueCloudMutation({
    entityType: "onboarding_progress",
    entityId: "primary",
    payload: { completedAt: null, id: "primary", lastStep: 3, version: 1 }
  });
  const keys = runtime.ApplyOS.cloudRepositoryKeys(USER_ID);
  runtime.data[keys.meta] = {
    cursor: 2,
    status: "conflict",
    conflict: {
      mutationId: mutation.mutationId,
      entityType: "onboarding_progress",
      entityId: "primary",
      localPayload: { completedAt: null, id: "primary", lastStep: 3, version: 1 },
      serverPayload: { version: 1, completedAt: null, id: "primary", lastStep: 3 },
      serverVersion: 7,
      deletedAt: null,
      detectedAt: "2026-07-18T00:00:00.000Z"
    }
  };
  const state = await runtime.ApplyOS.getCloudRepositoryState();
  assert.equal(state.meta.conflict, null);
  assert.equal(state.meta.status, "synced");
  assert.equal(state.outbox.length, 0);
  assert.equal((await runtime.ApplyOS.getCloudRecord("onboarding_progress", "primary")).serverVersion, 7);
});

test("legacy projection creates record-level mutations and strips inline resume bytes", async () => {
  const runtime = await repositoryRuntime();
  const records = runtime.ApplyOS.projectLegacyWorkspace({
    profile: { id: "primary", fullName: "Ada Lovelace", resume: { dataUrl: "data:application/pdf;base64,private" } },
    applyos_state: {
      applications: [{ id: "job_1", role: "Engineer" }],
      resume_versions: [{ id: "resume_1", name: "resume.pdf", dataUrl: "data:application/pdf;base64,private" }],
      settings: { theme: "system" }
    }
  });
  assert.deepEqual(Array.from(records, (record) => String(record.entity_type)), ["profile", "application", "resume_version", "settings"]);
  assert.equal(records.find((record) => record.entity_type === "profile").payload.resume.dataUrl, "");
  assert.equal(records.find((record) => record.entity_type === "resume_version").payload.dataUrl, "");
});
