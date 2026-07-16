(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});

  ApplyOS.SCHEMA_VERSION = 5;
  ApplyOS.STORAGE_KEY = "applyos_state";
  ApplyOS.PROFILE_KEY = "profile";
  ApplyOS.APPLICATION_STATUSES = [
    "saved",
    "preparing",
    "applied",
    "follow_up_due",
    "interview",
    "assignment",
    "offer",
    "rejected",
    "closed"
  ];
  ApplyOS.STATUS_META = {
    saved: { label: "Saved", tone: "slate" },
    preparing: { label: "Preparing", tone: "amber" },
    applied: { label: "Applied", tone: "blue" },
    follow_up_due: { label: "Follow-up due", tone: "orange" },
    interview: { label: "Interview", tone: "violet" },
    assignment: { label: "Assignment", tone: "cyan" },
    offer: { label: "Offer", tone: "green" },
    rejected: { label: "Rejected", tone: "red" },
    closed: { label: "Closed", tone: "slate" }
  };
  ApplyOS.PRIORITIES = ["low", "medium", "high"];
  ApplyOS.CONTACT_RELATIONSHIPS = ["recruiter", "hiring_manager", "interviewer", "employee", "referral", "other"];
  ApplyOS.INTERVIEW_TYPES = ["recruiter_screen", "hiring_manager", "technical", "behavioral", "panel", "final", "other"];
  ApplyOS.INTERVIEW_FORMATS = ["video", "phone", "onsite", "other"];

  ApplyOS.uid = function uid(prefix = "id") {
    if (root.crypto?.randomUUID) return `${prefix}_${root.crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  };

  ApplyOS.nowISO = function nowISO() {
    return new Date().toISOString();
  };

  ApplyOS.addDays = function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };

  ApplyOS.toDateInput = function toDateInput(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
  };

  ApplyOS.normalizeQuestion = function normalizeQuestion(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  ApplyOS.canonicalizeUrl = function canonicalizeUrl(value) {
    try {
      const url = new URL(value);
      ["source", "src", "ref", "refId", "trackingId", "trk", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => url.searchParams.delete(key));
      url.hostname = url.hostname.toLowerCase();
      url.pathname = url.pathname.replace(/\/$/, "") || "/";
      return url.toString();
    } catch {
      return String(value || "");
    }
  };
})(globalThis);
