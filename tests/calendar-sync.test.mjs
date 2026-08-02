import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

function response(status, body = null) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

async function calendarRuntime(options = {}) {
  const data = {};
  const identityCalls = [];
  const removedTokens = [];
  const apiCalls = [];
  const events = new Map();
  let nextEvent = 1;
  let authorizedToken = options.authorized === false ? "" : "calendar-token";
  let failNext401 = options.failNext401 === true;
  let failAll = options.failAll === true;
  const interactiveError = options.interactiveError || "";
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null) return structuredClone(data);
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
      }
    },
    identity: {
      async getAuthToken(details) {
        identityCalls.push(structuredClone(details));
        if (!details.interactive && !authorizedToken) throw new Error("OAuth2 not granted or revoked.");
        if (details.interactive && interactiveError) throw new Error(interactiveError);
        if (details.interactive && !authorizedToken) authorizedToken = "interactive-token";
        return { token: authorizedToken };
      },
      async removeCachedAuthToken({ token }) {
        removedTokens.push(token);
        if (token === authorizedToken) authorizedToken = options.refreshDenied ? "" : "refreshed-token";
      }
    }
  };
  chrome.runtime = { getManifest: () => ({ version: "test" }) };

  async function request(url, init = {}) {
    const method = init.method || "GET";
    const parsed = new URL(url);
    const authorization = init.headers?.Authorization || "";
    apiCalls.push({ url, method, authorization, body: init.body ? JSON.parse(init.body) : null });
    if (parsed.hostname === "oauth2.googleapis.com") return response(200, {});
    if (failAll) return response(503, { error: { message: "Calendar test outage" } });
    if (failNext401) { failNext401 = false; return response(401, { error: { message: "Expired token" } }); }
    if (!authorization.includes(authorizedToken) || !authorizedToken) return response(401, { error: { message: "Unauthorized" } });
    const eventMatch = parsed.pathname.match(/\/calendars\/primary\/events\/([^/]+)$/);
    if (method === "GET") {
      const actionProperty = parsed.searchParams.get("privateExtendedProperty") || "";
      const actionId = actionProperty.split("=").slice(1).join("=");
      return response(200, { items: [...events.values()].filter((event) => event.extendedProperties?.private?.scout_action_id === actionId) });
    }
    if (method === "POST" && parsed.pathname.endsWith("/calendars/primary/events")) {
      const event = { id: `event-${nextEvent++}`, ...JSON.parse(init.body) };
      events.set(event.id, event);
      return response(200, event);
    }
    if (method === "PATCH" && eventMatch) {
      const id = decodeURIComponent(eventMatch[1]);
      if (!events.has(id)) return response(404, { error: { message: "Event not found" } });
      const event = { id, ...JSON.parse(init.body) };
      events.set(id, event);
      return response(200, event);
    }
    if (method === "DELETE" && eventMatch) {
      const id = decodeURIComponent(eventMatch[1]);
      if (!events.has(id)) return response(404, { error: { message: "Event not found" } });
      events.delete(id);
      return response(204);
    }
    return response(400, { error: { message: "Unexpected test request" } });
  }

  const context = vm.createContext({ chrome, crypto: webcrypto, structuredClone, URL, URLSearchParams, Date, Math, console, globalThis: null });
  context.globalThis = context;
  for (const file of ["shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/storage.js", "shared/calendar.js"]) {
    vm.runInContext(await readFile(resolve(file), "utf8"), context, { filename: file });
  }
  const { ApplyOS } = context;
  ApplyOS.configureCalendarSync({ identity: chrome.identity, request, getState: ApplyOS.getState, mutateState: ApplyOS.mutateState });

  async function seedAction(title = "Follow up with recruiter") {
    const application = await ApplyOS.upsertApplication({ company: "Analytical Engines", role: "Programmer", url: "https://example.test/jobs/calendar", source: "test", description: "" });
    const contact = await ApplyOS.upsertContact({ name: "Casey Recruiter", company: application.company, company_id: application.company_id, application_ids: [application.id], email: "casey@example.test" });
    const action = await ApplyOS.upsertAction({ kind: "application_follow_up", title, due_at: "2026-08-10T09:00:00.000Z", priority: "high", channel: "email", application_id: application.id, contact_id: contact.id, notes: "Ask about next steps.", source: "user" });
    return { action, application, contact };
  }

  return {
    ApplyOS, data, events, apiCalls, identityCalls, removedTokens, seedAction,
    setAuthorized(value) { authorizedToken = value; },
    setFailAll(value) { failAll = value; }
  };
}

test("Google authorization succeeds only after the explicit interactive connection", async () => {
  const runtime = await calendarRuntime({ authorized: false });
  assert.equal((await runtime.ApplyOS.CalendarSync.status()).connected, false);
  const connected = await runtime.ApplyOS.CalendarSync.connect();
  assert.equal(connected.connected, true);
  assert.deepEqual(runtime.identityCalls.map((call) => call.interactive), [false, false, true]);
  assert.ok(runtime.identityCalls.every((call) => call.scopes.length === 1 && call.scopes[0] === runtime.ApplyOS.GOOGLE_CALENDAR_SCOPE));
});

test("already-authorized Google connection stays non-interactive", async () => {
  const runtime = await calendarRuntime();
  const connected = await runtime.ApplyOS.CalendarSync.connect();
  assert.equal(connected.already_authorized, true);
  assert.deepEqual(runtime.identityCalls.map((call) => call.interactive), [false]);
});

test("authorization cancellation and denial do not connect or change reminders", async () => {
  for (const message of ["The user did not approve access.", "OAuth authorization denied."]) {
    const runtime = await calendarRuntime({ authorized: false, interactiveError: message });
    const { action } = await runtime.seedAction();
    const before = await runtime.ApplyOS.getState();
    const result = await runtime.ApplyOS.CalendarSync.connect();
    const after = await runtime.ApplyOS.getState();
    assert.equal(result.connected, false);
    assert.equal(after.reminders.find((item) => item.id === action.id).status, "open");
    assert.equal(after.revision, before.revision);
  }
});

test("a 401 evicts the cached token and retries exactly once", async () => {
  const runtime = await calendarRuntime({ failNext401: true });
  const { action } = await runtime.seedAction();
  const result = await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  assert.equal(result.ok, true);
  assert.deepEqual(runtime.removedTokens, ["calendar-token"]);
  assert.equal(runtime.apiCalls.filter((call) => call.method === "GET").length, 2);
});

test("event creation uses the safe Scout format and stores only its mapping", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  assert.equal((await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true })).ok, true);
  const event = [...runtime.events.values()][0];
  assert.equal(event.summary, "[Scout] Follow up with recruiter");
  assert.equal(new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime(), 30 * 60 * 1000);
  assert.deepEqual(event.reminders.overrides, [{ method: "popup", minutes: 10 }]);
  assert.equal(event.extendedProperties.private.scout_action_id, action.id);
  assert.match(event.description, /Programmer at Analytical Engines/);
  assert.match(event.description, /Casey Recruiter/);
  assert.doesNotMatch(event.description, /resume|profile|answer/i);
  const saved = (await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id);
  assert.equal(saved.google_calendar_event_id, event.id);
  assert.equal(saved.calendar_sync_status, "synced");
});

test("rescheduling and editing a synced action updates its existing event", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  const before = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.upsertAction({ ...before.reminders.find((item) => item.id === action.id), title: "Updated recruiter follow-up", due_at: "2026-08-12T15:30:00.000Z", notes: "Updated notes" });
  const after = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.CalendarSync.reconcile(before, after);
  const event = [...runtime.events.values()][0];
  assert.equal(event.summary, "[Scout] Updated recruiter follow-up");
  assert.equal(event.start.dateTime, "2026-08-12T15:30:00.000Z");
  assert.equal(runtime.apiCalls.filter((call) => call.method === "POST").length, 1);
  assert.equal(runtime.apiCalls.filter((call) => call.method === "PATCH").length, 1);
});

test("completing a synced action removes its event and preserves history", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  const before = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.completeAction(action.id);
  const after = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.CalendarSync.reconcile(before, after);
  const saved = (await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id);
  assert.equal(runtime.events.size, 0);
  assert.equal(saved.status, "done");
  assert.equal(saved.google_calendar_event_id, null);
});

test("a missing mapped event is cleared and recreated only by explicit sync", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  await runtime.ApplyOS.mutateState((state) => {
    Object.assign(state.reminders.find((item) => item.id === action.id), { google_calendar_event_id: "gone", google_calendar_id: "primary", calendar_sync_status: "synced" });
    return state;
  });
  const result = await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  assert.equal(result.ok, true);
  assert.equal(runtime.events.size, 1);
  assert.notEqual((await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id).google_calendar_event_id, "gone");
});

test("private action metadata prevents duplicate event creation", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  runtime.events.set("existing-event", { id: "existing-event", extendedProperties: { private: { scout_action_id: action.id, scout_created: "true" } } });
  await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  assert.equal(runtime.events.size, 1);
  assert.equal(runtime.apiCalls.filter((call) => call.method === "POST").length, 0);
  assert.equal((await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id).google_calendar_event_id, "existing-event");
});

test("manual sync-all synchronizes every open reminder and skips history", async () => {
  const runtime = await calendarRuntime();
  const first = await runtime.seedAction("First open reminder");
  const second = await runtime.ApplyOS.upsertAction({ kind: "custom", title: "Second open reminder", due_at: "2026-08-11T10:00:00.000Z", priority: "medium", channel: "other", notes: "", source: "user" });
  const done = await runtime.ApplyOS.upsertAction({ kind: "custom", title: "Completed reminder", due_at: "2026-08-11T11:00:00.000Z", priority: "low", channel: "other", notes: "", source: "user" });
  await runtime.ApplyOS.completeAction(done.id);
  const result = await runtime.ApplyOS.CalendarSync.syncAll();
  assert.equal(result.total, 2);
  assert.equal(result.synced, 2);
  assert.equal(runtime.events.size, 2);
  assert.ok(first.action.id);
});

test("auto-sync applies only to newly created open actions when enabled", async () => {
  const runtime = await calendarRuntime();
  const before = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.updateSettings({ calendar_auto_sync: true });
  const action = await runtime.ApplyOS.upsertAction({ kind: "custom", title: "Auto-synced action", due_at: "2026-08-11T12:00:00.000Z", priority: "medium", channel: "other", notes: "", source: "user" });
  const after = await runtime.ApplyOS.getState();
  await runtime.ApplyOS.CalendarSync.reconcile(before, after);
  assert.equal((await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id).calendar_sync_status, "synced");

  const runtimeOff = await calendarRuntime();
  const offBefore = await runtimeOff.ApplyOS.getState();
  const offAction = await runtimeOff.ApplyOS.upsertAction({ kind: "custom", title: "Local action", due_at: "2026-08-11T12:00:00.000Z", priority: "medium", channel: "other", notes: "", source: "user" });
  await runtimeOff.ApplyOS.CalendarSync.reconcile(offBefore, await runtimeOff.ApplyOS.getState());
  assert.equal((await runtimeOff.ApplyOS.getState()).reminders.find((item) => item.id === offAction.id).google_calendar_event_id, null);
});

test("disconnect removes the cached authorization but leaves Google events in place", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  await runtime.ApplyOS.updateSettings({ calendar_auto_sync: true });
  await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  await runtime.ApplyOS.CalendarSync.disconnect();
  const saved = (await runtime.ApplyOS.getState()).reminders.find((item) => item.id === action.id);
  assert.equal(runtime.events.size, 1);
  assert.equal(saved.google_calendar_event_id, [...runtime.events.keys()][0]);
  assert.equal(saved.calendar_sync_status, "disconnected");
  assert.equal((await runtime.ApplyOS.getState()).settings.calendar_auto_sync, false);
  assert.ok(runtime.removedTokens.length === 1);
});

test("ICS export has a stable UID, 30-minute duration, safe description, and alarm", async () => {
  const runtime = await calendarRuntime();
  const { action } = await runtime.seedAction();
  const state = await runtime.ApplyOS.getState();
  const ics = runtime.ApplyOS.calendarICS(state.reminders.find((item) => item.id === action.id), state);
  assert.match(ics, new RegExp(`UID:scout-action-${action.id}@scout\\.local`));
  assert.match(ics, /DTSTART:20260810T090000Z/);
  assert.match(ics, /DTEND:20260810T093000Z/);
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.match(ics, /Application:Programmer at Analytical Engines|Application: Programmer at Analytical Engines/);
  assert.doesNotMatch(ics, /BEGIN:VTODO/);
});

test("OAuth tokens are never persisted and calendar failures preserve reminders", async () => {
  const runtime = await calendarRuntime({ failAll: true });
  const { action } = await runtime.seedAction();
  const result = await runtime.ApplyOS.CalendarSync.syncAction(action.id, { explicit: true });
  assert.equal(result.ok, false);
  const state = await runtime.ApplyOS.getState();
  const saved = state.reminders.find((item) => item.id === action.id);
  assert.equal(saved.status, "open");
  assert.equal(saved.calendar_sync_status, "error");
  assert.match(saved.calendar_sync_error, /outage/i);
  assert.doesNotMatch(JSON.stringify(runtime.data), /calendar-token|refreshed-token|interactive-token/);
});
