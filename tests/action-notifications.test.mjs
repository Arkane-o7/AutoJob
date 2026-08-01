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
  assert.ok(manifest.optional_permissions.includes("notifications"));
  assert.ok(!manifest.permissions.includes("notifications"));
  assert.match(background, /Scout action.*due/);
  assert.doesNotMatch(background, /notification.*contact\.name|notification.*company|notification.*notes/i);
  assert.match(background, /dashboard\.html\?section=actions/);
});
