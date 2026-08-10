(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
  const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
  const PRIMARY_CALENDAR = "primary";
  const SYNC_FIELDS = [
    "google_calendar_event_id",
    "google_calendar_id",
    "calendar_sync_status",
    "calendar_synced_at",
    "calendar_sync_error"
  ];

  let dependencies = {};
  let reconciliationQueue = Promise.resolve();

  function dependency(name) {
    const value = dependencies[name];
    if (!value) throw new Error(`Calendar integration is missing ${name}.`);
    return value;
  }

  function tokenValue(result) {
    return typeof result === "string" ? result : typeof result?.token === "string" ? result.token : "";
  }

  function errorMessage(error) {
    return String(error?.message || error || "Calendar synchronization failed.");
  }

  function authorizationReason(error) {
    const message = errorMessage(error).toLowerCase();
    if (/cancel|closed|did not approve|user rejected|user denied/.test(message)) return "cancelled";
    if (/denied|not granted|oauth|authorization/.test(message)) return "denied";
    return "unavailable";
  }

  function effectiveDueAt(action) {
    return action?.snoozed_until || action?.due_at;
  }

  function recordType(action) {
    if (action?.application_id) return "application";
    if (action?.contact_id) return "contact";
    if (action?.interview_id) return "interview";
    return "action";
  }

  function relatedContext(action, state) {
    const application = state?.applications?.find((item) => item.id === action?.application_id);
    const contact = state?.contacts?.find((item) => item.id === action?.contact_id);
    const snapshot = action?.context_snapshot || {};
    return {
      role: application?.role || snapshot.role || "",
      company: application?.company || snapshot.company || "",
      contact: contact?.name || snapshot.contact_name || ""
    };
  }

  function descriptionLines(action, state) {
    const context = relatedContext(action, state);
    const lines = [];
    if (context.role || context.company) lines.push(`Application: ${[context.role, context.company].filter(Boolean).join(" at ")}`);
    if (context.contact) lines.push(`Contact: ${context.contact}`);
    if (action?.notes) lines.push(`Notes: ${String(action.notes).trim()}`);
    lines.push("Created by Scout from a job-search action.");
    return lines;
  }

  function googleEvent(action, state) {
    const start = new Date(effectiveDueAt(action));
    if (Number.isNaN(start.getTime())) throw new Error("Choose a valid due time before adding this action to a calendar.");
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return {
      summary: `[Scout] ${String(action.title || "Action").trim() || "Action"}`,
      description: descriptionLines(action, state).join("\n"),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      extendedProperties: {
        private: {
          scout_action_id: String(action.id),
          scout_record_type: recordType(action),
          scout_created: "true"
        }
      }
    };
  }

  function icsEscape(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function icsDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Calendar export requires a valid date.");
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function foldICSLine(line) {
    if (line.length <= 73) return line;
    const parts = [];
    let rest = line;
    while (rest.length > 73) {
      parts.push(rest.slice(0, 73));
      rest = ` ${rest.slice(73)}`;
    }
    parts.push(rest);
    return parts.join("\r\n");
  }

  function calendarICS(action, state) {
    const start = new Date(effectiveDueAt(action));
    if (Number.isNaN(start.getTime())) throw new Error("Choose a valid due time before downloading this event.");
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const created = action.created_at || action.updated_at || new Date().toISOString();
    const updated = action.updated_at || created;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Scout//Job Application CRM//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:scout-action-${icsEscape(action.id)}@scout.local`,
      `DTSTAMP:${icsDate(updated)}`,
      `CREATED:${icsDate(created)}`,
      `LAST-MODIFIED:${icsDate(updated)}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(`[Scout] ${action.title || "Action"}`)}`,
      `DESCRIPTION:${icsEscape(descriptionLines(action, state).join("\n"))}`,
      `X-SCOUT-ACTION-ID:${icsEscape(action.id)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(`Scout reminder: ${action.title || "Action"}`)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ];
    return `${lines.map(foldICSLine).join("\r\n")}\r\n`;
  }

  function calendarFilename(action) {
    const slug = String(action?.title || "scout-action").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "scout-action";
    return `${slug}.ics`;
  }

  async function getToken(interactive) {
    const identity = dependency("identity");
    const result = await identity.getAuthToken({ interactive: Boolean(interactive), scopes: [GOOGLE_SCOPE] });
    const token = tokenValue(result);
    if (!token) throw new Error(interactive ? "Google authorization was not completed." : "Google Calendar is not connected.");
    return token;
  }

  async function evictToken(token) {
    if (!token) return;
    await dependency("identity").removeCachedAuthToken({ token }).catch(() => {});
  }

  async function disconnectState(message = "Google Calendar is disconnected.") {
    const mutateState = dependency("mutateState");
    await mutateState((state) => {
      state.settings.calendar_auto_sync = false;
      state.reminders = state.reminders.map((action) => action.google_calendar_event_id ? {
        ...action,
        calendar_sync_status: "disconnected",
        calendar_sync_error: message
      } : action);
      return state;
    });
  }

  async function authorizedRequest(path, options = {}) {
    const request = dependency("request");
    let token = await getToken(false);
    const run = (accessToken) => request(`${GOOGLE_API}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    let response = await run(token);
    if (response.status === 401) {
      await evictToken(token);
      try { token = await getToken(false); }
      catch (error) {
        await disconnectState("Google authorization was revoked. Connect again to resume synchronization.");
        throw error;
      }
      response = await run(token);
    }
    if (response.status === 401) {
      await evictToken(token);
      await disconnectState("Google authorization was revoked. Connect again to resume synchronization.");
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Google Calendar request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function patchAction(actionId, patch) {
    let updated = null;
    await dependency("mutateState")((state) => {
      const action = state.reminders.find((item) => item.id === actionId);
      if (!action) return state;
      Object.assign(action, patch, { updated_at: patch.updated_at || action.updated_at });
      updated = action;
      return state;
    });
    return updated;
  }

  async function setSyncError(actionId, error) {
    return patchAction(actionId, {
      calendar_sync_status: "error",
      calendar_sync_error: errorMessage(error)
    });
  }

  async function saveMapping(actionId, event) {
    const at = new Date().toISOString();
    return patchAction(actionId, {
      google_calendar_event_id: event.id,
      google_calendar_id: PRIMARY_CALENDAR,
      calendar_sync_status: "synced",
      calendar_synced_at: at,
      calendar_sync_error: null
    });
  }

  async function clearMapping(actionId, status = "not_synced") {
    return patchAction(actionId, {
      google_calendar_event_id: null,
      google_calendar_id: null,
      calendar_sync_status: status,
      calendar_synced_at: null,
      calendar_sync_error: null
    });
  }

  async function findExistingEvent(actionId) {
    const query = new URLSearchParams({
      privateExtendedProperty: `scout_action_id=${actionId}`,
      singleEvents: "true",
      maxResults: "1",
      showDeleted: "false"
    });
    query.append("privateExtendedProperty", "scout_created=true");
    const result = await authorizedRequest(`/calendars/${encodeURIComponent(PRIMARY_CALENDAR)}/events?${query}`);
    return Array.isArray(result?.items) ? result.items[0] || null : null;
  }

  async function createOrReuseEvent(action, state) {
    const payload = googleEvent(action, state);
    const existing = await findExistingEvent(action.id);
    if (existing?.id) {
      const updated = await authorizedRequest(`/calendars/${encodeURIComponent(PRIMARY_CALENDAR)}/events/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: payload });
      return updated || existing;
    }
    return authorizedRequest(`/calendars/${encodeURIComponent(PRIMARY_CALENDAR)}/events`, { method: "POST", body: payload });
  }

  async function updateMappedEvent(action, state) {
    return authorizedRequest(`/calendars/${encodeURIComponent(action.google_calendar_id || PRIMARY_CALENDAR)}/events/${encodeURIComponent(action.google_calendar_event_id)}`, {
      method: "PATCH",
      body: googleEvent(action, state)
    });
  }

  async function syncAction(actionId, options = {}) {
    const state = await dependency("getState")();
    const action = state.reminders.find((item) => item.id === actionId);
    if (!action) return { ok: false, error: "Scout action not found." };
    if (action.status !== "open") return removeAction(actionId);
    const mayCreate = options.explicit === true || options.reason === "update" || state.settings.calendar_auto_sync === true;
    if (!action.google_calendar_event_id && !mayCreate) return { ok: true, skipped: true, action };
    await patchAction(actionId, { calendar_sync_status: "syncing", calendar_sync_error: null });
    try {
      let event;
      if (action.google_calendar_event_id) {
        try { event = await updateMappedEvent(action, state); }
        catch (error) {
          if (error.status !== 404) throw error;
          await clearMapping(actionId);
          if (!mayCreate) return { ok: true, missing: true };
          event = await createOrReuseEvent({ ...action, google_calendar_event_id: null, google_calendar_id: null }, state);
        }
      } else {
        event = await createOrReuseEvent(action, state);
      }
      await saveMapping(actionId, event);
      return { ok: true, event, action_id: actionId };
    } catch (error) {
      await setSyncError(actionId, error);
      return { ok: false, error: errorMessage(error), action_id: actionId };
    }
  }

  async function removeAction(actionId, suppliedAction = null) {
    const state = await dependency("getState")();
    const action = suppliedAction || state.reminders.find((item) => item.id === actionId);
    if (!action?.google_calendar_event_id) {
      if (action) await clearMapping(actionId);
      return { ok: true, missing: true, action_id: actionId };
    }
    try {
      await authorizedRequest(`/calendars/${encodeURIComponent(action.google_calendar_id || PRIMARY_CALENDAR)}/events/${encodeURIComponent(action.google_calendar_event_id)}`, { method: "DELETE" });
      await clearMapping(actionId);
      return { ok: true, removed: true, action_id: actionId };
    } catch (error) {
      if (error.status === 404) {
        await clearMapping(actionId);
        return { ok: true, missing: true, action_id: actionId };
      }
      await setSyncError(actionId, error);
      return { ok: false, error: errorMessage(error), action_id: actionId };
    }
  }

  async function connectionStatus() {
    try {
      await getToken(false);
      return { connected: true, scope: GOOGLE_SCOPE, calendar_id: PRIMARY_CALENDAR };
    } catch (error) {
      return { connected: false, scope: GOOGLE_SCOPE, calendar_id: PRIMARY_CALENDAR, reason: authorizationReason(error) };
    }
  }

  async function connect() {
    const existing = await connectionStatus();
    if (existing.connected) return { ...existing, already_authorized: true };
    try {
      await getToken(true);
      return { connected: true, scope: GOOGLE_SCOPE, calendar_id: PRIMARY_CALENDAR, already_authorized: false };
    } catch (error) {
      return { connected: false, scope: GOOGLE_SCOPE, reason: authorizationReason(error), error: errorMessage(error) };
    }
  }

  async function syncAll() {
    const state = await dependency("getState")();
    const ids = state.reminders.filter((item) => item.status === "open").map((item) => item.id);
    const results = [];
    for (const id of ids) results.push(await syncAction(id, { explicit: true }));
    return {
      total: results.length,
      synced: results.filter((item) => item.ok && !item.skipped).length,
      failed: results.filter((item) => !item.ok).length,
      results
    };
  }

  async function disconnect(options = {}) {
    let token = "";
    try { token = await getToken(false); } catch {}
    if (options.removeEvents === true && token) {
      const state = await dependency("getState")();
      for (const action of state.reminders.filter((item) => item.google_calendar_event_id)) await removeAction(action.id);
    }
    if (token) {
      await evictToken(token);
      await dependency("request")(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }).catch(() => {});
    }
    await disconnectState("Reconnect Google Calendar to update or remove this event.");
    return { connected: false };
  }

  function eventChanged(beforeAction, beforeState, afterAction, afterState) {
    try { return JSON.stringify(googleEvent(beforeAction, beforeState)) !== JSON.stringify(googleEvent(afterAction, afterState)); }
    catch { return effectiveDueAt(beforeAction) !== effectiveDueAt(afterAction); }
  }

  async function reconcileStateChange(beforeState, afterState) {
    if (!beforeState || !afterState) return { processed: 0 };
    const before = new Map((beforeState.reminders || []).map((item) => [item.id, item]));
    const after = new Map((afterState.reminders || []).map((item) => [item.id, item]));
    let processed = 0;
    for (const [id, oldAction] of before) {
      const nextAction = after.get(id);
      if (oldAction.google_calendar_event_id && (!nextAction || nextAction.status !== "open")) {
        await removeAction(id, nextAction || oldAction);
        processed += 1;
      }
    }
    for (const [id, action] of after) {
      if (action.status !== "open") continue;
      const oldAction = before.get(id);
      if (!oldAction && afterState.settings?.calendar_auto_sync === true) {
        await syncAction(id, { reason: "new" });
        processed += 1;
      } else if (oldAction?.google_calendar_event_id && eventChanged(oldAction, beforeState, action, afterState)) {
        await syncAction(id, { reason: "update" });
        processed += 1;
      }
    }
    return { processed };
  }

  ApplyOS.GOOGLE_CALENDAR_SCOPE = GOOGLE_SCOPE;
  ApplyOS.CALENDAR_SYNC_FIELDS = SYNC_FIELDS;
  ApplyOS.googleCalendarEvent = googleEvent;
  ApplyOS.calendarICS = calendarICS;
  ApplyOS.calendarFilename = calendarFilename;
  ApplyOS.configureCalendarSync = function configureCalendarSync(next = {}) {
    dependencies = { ...dependencies, ...next };
    return ApplyOS.CalendarSync;
  };
  ApplyOS.CalendarSync = {
    connect,
    status: connectionStatus,
    syncAction,
    removeAction,
    syncAll,
    disconnect,
    reconcile(beforeState, afterState) {
      const run = () => reconcileStateChange(beforeState, afterState);
      const task = reconciliationQueue.then(run, run);
      reconciliationQueue = task.then(() => undefined, () => undefined);
      return task;
    }
  };
})(globalThis);
