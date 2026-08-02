import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function helpers() {
  const context = vm.createContext({ Date, console, globalThis: null });
  context.globalThis = context;
  context.ApplyOS = { nowISO: () => "2026-08-01T00:00:00.000Z", uid: (prefix) => `${prefix}_test`, addDays(value, days) { return new Date(new Date(value).getTime() + days * 86400000).toISOString(); } };
  vm.runInContext(await readFile("shared/followup.js", "utf8"), context, { filename: "shared/followup.js" });
  return context.ApplyOS;
}

async function notificationRuntime({ granted = true, createError = null, tabs = [] } = {}) {
  const calls = { alarms: [], settings: [], notifications: [], tabQueries: [], tabUpdates: [], tabCreates: [], windowUpdates: [] };
  const state = {
    settings: { desktop_notifications_enabled: true, notification_digest_time: "09:00" },
    reminders: [{ id: "due", status: "open", due_at: "2026-08-01T10:00:00.000Z", snoozed_until: null, last_notified_at: null, updated_at: "2026-08-01T00:00:00.000Z" }]
  };
  const chrome = {
    alarms: { async clear(name) { calls.alarms.push(["clear", name]); }, create(name, options) { calls.alarms.push(["create", name, options]); } },
    permissions: { async contains(value) { calls.permission = value; return granted; } },
    notifications: { async create(id, options) { calls.notifications.push([id, options]); if (createError) throw createError; return id; } },
    runtime: { getURL(path) { return `chrome-extension://test/${path}`; } },
    tabs: {
      query(query, callback) { calls.tabQueries.push(query); callback(tabs); },
      update(id, options, callback) { calls.tabUpdates.push([id, options]); callback?.(); },
      create(options) { calls.tabCreates.push(options); }
    },
    windows: { update(id, options) { calls.windowUpdates.push([id, options]); } }
  };
  const ApplyOS = {
    nextDigestAt: () => new Date("2026-08-02T09:00:00.000Z").getTime(),
    actionsEligibleForNotification(current) { return current.reminders.filter((item) => item.status === "open" && !item.last_notified_at); },
    async refreshDueApplications() { return state; },
    async updateSettings(patch) { calls.settings.push(patch); Object.assign(state.settings, patch); },
    async mutateState(mutator) { Object.assign(state, await mutator(structuredClone(state))); return state; }
  };
  const context = vm.createContext({ Date, console, structuredClone, chrome, ApplyOS, globalThis: null });
  context.globalThis = context;
  vm.runInContext(await readFile("shared/action-notifications.js", "utf8"), context, { filename: "shared/action-notifications.js" });
  return { notifications: context.ApplyOS.ActionNotifications, state, calls };
}

test("desktop notification selector includes only open due actions outside the cooldown", async () => {
  const ApplyOS = await helpers();
  const at = "2026-08-01T12:00:00.000Z";
  const state = { reminders: [
    { id: "due", status: "open", due_at: "2026-08-01T10:00:00.000Z", snoozed_until: null, last_notified_at: null },
    { id: "snoozed", status: "open", due_at: "2026-07-31T10:00:00.000Z", snoozed_until: "2026-08-02T10:00:00.000Z", last_notified_at: null },
    { id: "recent", status: "open", due_at: "2026-07-31T10:00:00.000Z", snoozed_until: null, last_notified_at: "2026-08-01T08:00:00.000Z" },
    { id: "done", status: "done", due_at: "2026-07-31T10:00:00.000Z", snoozed_until: null, last_notified_at: null }
  ] };
  assert.deepEqual(Array.from(ApplyOS.actionsEligibleForNotification(state, at), (item) => item.id), ["due"]);
});

test("daily digest calculation rolls past an elapsed local reminder time", async () => {
  const ApplyOS = await helpers();
  const before = new Date("2026-08-01T08:00:00");
  const after = new Date("2026-08-01T10:00:00");
  assert.equal(new Date(ApplyOS.nextDigestAt("09:00", before)).getDate(), 1);
  assert.equal(new Date(ApplyOS.nextDigestAt("09:00", after)).getDate(), 2);
});

test("manifest keeps desktop notifications optional and background copy generic", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const background = await readFile("background.js", "utf8");
  const notificationRuntimeSource = await readFile("shared/action-notifications.js", "utf8");
  assert.ok(manifest.optional_permissions.includes("notifications"));
  assert.ok(!manifest.permissions.includes("notifications"));
  assert.match(notificationRuntimeSource, /Scout action.*due/);
  assert.doesNotMatch(`${background}\n${notificationRuntimeSource}`, /notification.*contact\.name|notification.*company|notification.*notes/i);
  assert.match(notificationRuntimeSource, /dashboard\.html\?section=actions/);
});

test("notification runtime schedules alarms and disables the setting when permission is denied", async () => {
  const { notifications, state, calls } = await notificationRuntime({ granted: false });
  const result = await notifications.notify(new Date("2026-08-01T12:00:00.000Z"));
  assert.equal(result.reason, "permission");
  assert.equal(state.settings.desktop_notifications_enabled, false);
  assert.equal(calls.settings.length, 1);
  assert.equal(calls.settings[0].desktop_notifications_enabled, false);
  assert.ok(calls.alarms.some((item) => item[0] === "create" && item[1] === "applyos-action-digest"));
  assert.equal(calls.notifications.length, 0);
});

test("last-notified timestamps update only after notification creation succeeds", async () => {
  const failed = await notificationRuntime({ createError: new Error("notification failed") });
  await assert.rejects(failed.notifications.notify(new Date("2026-08-01T12:00:00.000Z")), /notification failed/);
  assert.equal(failed.state.reminders[0].last_notified_at, null);

  const successful = await notificationRuntime();
  const result = await successful.notifications.notify(new Date("2026-08-01T12:00:00.000Z"));
  assert.equal(result.notified, 1);
  assert.equal(successful.state.reminders[0].last_notified_at, "2026-08-01T12:00:00.000Z");
  assert.equal(successful.calls.notifications[0][0], "applyos-actions-due");
});

test("notification click focuses an existing Today tab or creates one", async () => {
  const existing = await notificationRuntime({ tabs: [{ id: 7, windowId: 3 }] });
  existing.notifications.openToday();
  assert.equal(existing.calls.tabUpdates[0][0], 7);
  assert.match(existing.calls.tabUpdates[0][1].url, /dashboard\.html\?section=actions$/);
  assert.equal(existing.calls.windowUpdates[0][0], 3);
  assert.equal(existing.calls.windowUpdates[0][1].focused, true);

  const missing = await notificationRuntime({ tabs: [] });
  missing.notifications.openToday();
  assert.match(missing.calls.tabCreates[0].url, /dashboard\.html\?section=actions$/);
});
