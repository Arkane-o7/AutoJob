(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const NOTIFICATION_ID = "applyos-actions-due";

  async function schedule(state, at = new Date()) {
    const chrome = root.chrome;
    const now = new Date(at).getTime();
    const open = state.reminders.filter((item) => item.status === "open").map((item) => {
      const due = new Date(item.snoozed_until || item.due_at).getTime();
      if (!Number.isFinite(due)) return null;
      if (due > now) return due;
      if (!state.settings.desktop_notifications_enabled) return null;
      const notified = item.last_notified_at ? new Date(item.last_notified_at).getTime() : 0;
      return notified ? Math.max(now + 1000, notified + 86400000) : now + 1000;
    }).filter(Number.isFinite).sort((left, right) => left - right);
    await chrome.alarms.clear("applyos-next-action");
    if (open.length) chrome.alarms.create("applyos-next-action", { when: Math.max(now + 1000, open[0]) });
    chrome.alarms.create("applyos-action-digest", { when: ApplyOS.nextDigestAt(state.settings.notification_digest_time, new Date(now)), periodInMinutes: 1440 });
    return open;
  }

  async function notify(at = new Date()) {
    const chrome = root.chrome;
    const state = await ApplyOS.refreshDueApplications(at);
    await schedule(state, at);
    if (!state.settings.desktop_notifications_enabled || !chrome.notifications) return { notified: 0, reason: "disabled" };
    let granted = false;
    try { granted = await chrome.permissions.contains({ permissions: ["notifications"] }); }
    catch { granted = false; }
    if (!granted) {
      await ApplyOS.updateSettings({ desktop_notifications_enabled: false });
      return { notified: 0, reason: "permission" };
    }
    const due = ApplyOS.actionsEligibleForNotification(state, at);
    if (!due.length) return { notified: 0, reason: "none-due" };
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icons/scout-128.png"),
      title: "Scout · actions due",
      message: `${due.length} Scout action${due.length === 1 ? " is" : "s are"} due. Open Today to review.`,
      priority: 1
    });
    const notifiedAt = new Date(at).toISOString();
    const ids = new Set(due.map((item) => item.id));
    await ApplyOS.mutateState((draft) => {
      draft.reminders = draft.reminders.map((item) => ids.has(item.id) ? { ...item, last_notified_at: notifiedAt, updated_at: notifiedAt } : item);
      return draft;
    });
    return { notified: due.length, reason: "success" };
  }

  function openToday() {
    const chrome = root.chrome;
    const url = chrome.runtime.getURL("dashboard.html?section=actions");
    chrome.tabs.query({ url: `${chrome.runtime.getURL("dashboard.html")}*` }, (tabs) => {
      const existing = tabs[0];
      if (existing?.id) chrome.tabs.update(existing.id, { active: true, url }, () => chrome.windows.update(existing.windowId, { focused: true }));
      else chrome.tabs.create({ url });
    });
  }

  ApplyOS.ActionNotifications = Object.freeze({ NOTIFICATION_ID, schedule, notify, openToday });
})(globalThis);
