(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});

  ApplyOS.actionEffectiveDue = function actionEffectiveDue(action = {}) {
    return action.snoozed_until || action.due_at || null;
  };

  ApplyOS.actionsEligibleForNotification = function actionsEligibleForNotification(state = {}, at = new Date()) {
    const now = new Date(at).getTime();
    return (Array.isArray(state.reminders) ? state.reminders : []).filter((item) => item.status === "open"
      && new Date(item.snoozed_until || item.due_at).getTime() <= now
      && (!item.last_notified_at || now - new Date(item.last_notified_at).getTime() >= 86400000));
  };

  ApplyOS.nextDigestAt = function nextDigestAt(time = "09:00", at = new Date()) {
    const [hours, minutes] = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)?.slice(1).map(Number) || [9, 0];
    const next = new Date(at); next.setHours(hours, minutes, 0, 0); if (next <= at) next.setDate(next.getDate() + 1);
    return next.getTime();
  };

  ApplyOS.buildFollowUpReminders = function buildFollowUpReminders(application, appliedAt = new Date(), offsets = [7, 14]) {
    const base = appliedAt instanceof Date ? appliedAt : new Date(appliedAt);
    const safeOffsets = [...new Set((Array.isArray(offsets) ? offsets : [7, 14])
      .map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 60))].sort((a, b) => a - b).slice(0, 4);
    return (safeOffsets.length ? safeOffsets : [7, 14]).map((days, index) => {
      const now = ApplyOS.nowISO();
      return {
        id: ApplyOS.uid("rem"),
        application_id: application.id,
        contact_id: null,
        interview_id: null,
        kind: index === 0 ? "application_follow_up" : "application_final_follow_up",
        type: index === 0 ? "follow_up" : "final_follow_up",
        title: `${index === 0 ? "Follow up" : "Follow up again"} on ${application.role} at ${application.company}`,
        status: "open",
        due_at: ApplyOS.addDays(base, days),
        snoozed_until: null,
        priority: application.priority || "medium",
        channel: "email",
        notes: "",
        source: "system",
        completed_at: null,
        last_notified_at: null,
        created_at: now,
        updated_at: now
      };
    });
  };

})(globalThis);
