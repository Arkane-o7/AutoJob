(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const STORAGE_LOCK_NAME = "applyos-state-write";
  const APPLICATION_FOLLOW_UP_KINDS = new Set(["application_follow_up", "application_final_follow_up"]);
  const GENERATED_APPLICATION_PROCESS_KINDS = new Set([
    "application_follow_up",
    "application_final_follow_up",
    "interview_prep",
    "interview_thank_you"
  ]);
  let localStorageQueue = Promise.resolve();

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function safeId(value, prefix) {
    const text = safeString(value).trim();
    return /^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(text) ? text : ApplyOS.uid(prefix);
  }

  function safeDomain(value) {
    const text = safeString(value).trim().toLowerCase();
    if (!text) return "";
    try { return new URL(text.includes("://") ? text : `https://${text}`).hostname; }
    catch { return ""; }
  }

  function normalizedCompanyName(value) {
    return safeString(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function companyIdentityMatch(company, name, domain) {
    const normalizedName = normalizedCompanyName(name);
    const normalizedDomain = safeDomain(domain);
    return Boolean((normalizedName && normalizedCompanyName(company?.name) === normalizedName)
      || (normalizedDomain && safeDomain(company?.domain) === normalizedDomain));
  }

  function ensureCompanyForIdentity(state, name, domain = "", websiteUrl = "") {
    const displayName = safeString(name).trim();
    if (!displayName || normalizedCompanyName(displayName) === "unknown company") return null;
    const matched = state.companies.find((item) => companyIdentityMatch(item, displayName, domain));
    if (matched) return matched;
    const now = ApplyOS.nowISO();
    const company = normalizeCompany({
      id: ApplyOS.uid("company"),
      name: displayName,
      domain,
      website_url: websiteUrl,
      notes: "",
      tags: [],
      created_at: now,
      updated_at: now
    });
    state.companies.unshift(company);
    return company;
  }

  function safeResumeDataUrl(value) {
    const text = safeString(value);
    return /^data:(application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document));base64,[a-z0-9+/=]+$/i.test(text) ? text : "";
  }

  function safeNullableString(value) {
    return typeof value === "string" && value ? value : null;
  }

  function safeNullableDate(value) {
    return typeof value === "string" && value && !Number.isNaN(new Date(value).getTime()) ? value : null;
  }

  function safeDateString(value, fallback) {
    if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) return fallback;
    return value;
  }

  function safeNumber(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function safeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }

  function safeStringRecord(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string"));
  }

  function safeContextSnapshot(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => ["company", "role", "interview_type", "contact_name"].includes(key) && typeof item === "string" && item.trim()));
  }

  function newestDate(...values) {
    return values.filter((value) => safeNullableDate(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
  }

  function isSystemApplicationFollowUp(item, applicationId = item?.application_id) {
    return item?.application_id === applicationId
      && item?.source === "system"
      && item?.status === "open"
      && APPLICATION_FOLLOW_UP_KINDS.has(item?.kind);
  }

  function cancelActionRecord(item, now) {
    if (!item || item.status !== "open") return item;
    item.status = "cancelled";
    item.updated_at = now;
    return item;
  }

  function reconcileApplicationFollowUpStatus(state, applicationId, now = ApplyOS.nowISO()) {
    if (!applicationId) return;
    const application = state.applications.find((item) => item.id === applicationId);
    if (!application || application.status !== "follow_up_due") return;
    const at = new Date(now).getTime();
    const hasDueFollowUp = state.reminders.some((item) => item.application_id === applicationId
      && item.status === "open"
      && APPLICATION_FOLLOW_UP_KINDS.has(item.kind)
      && new Date(item.snoozed_until || item.due_at).getTime() <= at);
    if (!hasDueFollowUp) {
      application.status = "applied";
      application.updated_at = now;
    }
  }

  function safeWebUrl(value) {
    const text = safeString(value).trim();
    if (!text) return "";
    try {
      const parsed = new URL(text);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch { return ""; }
  }

  function normalizeConfidence(value) {
    if (!isRecord(value)) return { overall: 0 };
    return { overall: 0, ...Object.fromEntries(Object.entries(value).filter(([, score]) => typeof score === "number" && Number.isFinite(score))
      .map(([key, score]) => [key, Math.max(0, Math.min(1, score))])) };
  }

  function migrationHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((item) => ({
      from_version: Math.max(0, Math.trunc(safeNumber(item.from_version))),
      to_version: Math.max(0, Math.trunc(safeNumber(item.to_version))),
      migrated_at: safeDateString(item.migrated_at, ApplyOS.nowISO())
    })).filter((item) => item.to_version > item.from_version);
  }

  function recordMigration(state, fromVersion, toVersion) {
    const history = migrationHistory(state.migration_history);
    if (!history.some((item) => item.from_version === fromVersion && item.to_version === toVersion)) {
      history.push({ from_version: fromVersion, to_version: toVersion, migrated_at: ApplyOS.nowISO() });
    }
    return { ...state, schema_version: toVersion, migration_history: history };
  }

  const migrations = {
    0: (state) => recordMigration(state, 0, 1),
    1: (state) => recordMigration(state, 1, 2),
    2: (state) => recordMigration({ ...state, revision: Math.max(0, Math.trunc(safeNumber(state.revision))) }, 2, 3),
    3: (state) => recordMigration({ ...state, contacts: Array.isArray(state.contacts) ? state.contacts : [], interviews: Array.isArray(state.interviews) ? state.interviews : [] }, 3, 4),
    4: (state) => recordMigration({ ...state }, 4, 5),
    5: (state) => {
      const now = ApplyOS.nowISO();
      const applications = Array.isArray(state.applications) ? state.applications : [];
      const appById = new Map(applications.map((item) => [item?.id, item]));
      const reminders = (Array.isArray(state.reminders) ? state.reminders : []).map((item) => {
        const application = appById.get(item?.application_id) || {};
        const isFinal = item?.type === "final_follow_up";
        return {
          ...item,
          kind: isFinal ? "application_final_follow_up" : "application_follow_up",
          title: item?.title || `${isFinal ? "Follow up again" : "Follow up"} on ${application.role || "application"}${application.company ? ` at ${application.company}` : ""}`,
          status: item?.completed_at ? "done" : "open",
          snoozed_until: null,
          priority: application.priority || "medium",
          channel: "email",
          contact_id: null,
          interview_id: null,
          notes: "",
          source: "system",
          last_notified_at: null,
          updated_at: item?.created_at || now
        };
      });
      const existingKeys = new Set(reminders.map((item) => `${item.kind}:${item.contact_id || ""}:${item.interview_id || ""}`));
      for (const contact of Array.isArray(state.contacts) ? state.contacts : []) {
        if (!contact?.id || !contact.next_action_at) continue;
        const key = `contact_follow_up:${contact.id}:`;
        if (existingKeys.has(key)) continue;
        reminders.push({
          id: `contact_next_${String(contact.id).slice(-100)}`,
          kind: "contact_follow_up",
          type: "follow_up",
          title: `Follow up with ${contact.name || "contact"}`,
          status: "open",
          due_at: contact.next_action_at,
          snoozed_until: null,
          priority: "medium",
          channel: contact.preferred_channel || (contact.email ? "email" : contact.linkedin_url ? "linkedin" : "other"),
          application_id: Array.isArray(contact.application_ids) ? contact.application_ids[0] || null : null,
          contact_id: contact.id,
          interview_id: null,
          notes: "",
          source: "system",
          completed_at: null,
          last_notified_at: null,
          created_at: contact.created_at || now,
          updated_at: contact.updated_at || contact.created_at || now
        });
        existingKeys.add(key);
      }
      for (const interview of Array.isArray(state.interviews) ? state.interviews : []) {
        if (!interview?.id || !interview.next_action_at) continue;
        const key = `interview_thank_you::${interview.id}`;
        if (existingKeys.has(key)) continue;
        reminders.push({
          id: `interview_next_${String(interview.id).slice(-98)}`,
          kind: "interview_thank_you",
          type: "follow_up",
          title: interview.next_action || "Send interview thank-you",
          status: "open",
          due_at: interview.next_action_at,
          snoozed_until: null,
          priority: "high",
          channel: "email",
          application_id: interview.application_id || null,
          contact_id: Array.isArray(interview.interviewer_contact_ids) ? interview.interviewer_contact_ids[0] || null : null,
          interview_id: interview.id,
          notes: "",
          source: "system",
          completed_at: null,
          last_notified_at: null,
          created_at: interview.created_at || now,
          updated_at: interview.updated_at || interview.created_at || now
        });
        existingKeys.add(key);
      }
      const oldSettings = isRecord(state.settings) ? state.settings : {};
      return recordMigration({
        ...state,
        reminders,
        contact_activities: Array.isArray(state.contact_activities) ? state.contact_activities : [],
        settings: {
          ...oldSettings,
          follow_up_offsets_days: oldSettings.final_follow_up_enabled === false ? [7] : [7, 14],
          desktop_notifications_enabled: false,
          notification_digest_time: "09:00"
        }
      }, 5, 6);
    },
    6: (state) => {
      const draft = {
        ...state,
        companies: (Array.isArray(state.companies) ? state.companies : []).map(normalizeCompany).filter(Boolean),
        waiting_items: Array.isArray(state.waiting_items) ? state.waiting_items : []
      };
      draft.applications = (Array.isArray(state.applications) ? state.applications : []).map((item) => {
        if (!isRecord(item)) return item;
        const existing = draft.companies.find((company) => company.id === item.company_id);
        const company = existing || ensureCompanyForIdentity(draft, item.company);
        return { ...item, company_id: company?.id || null };
      });
      draft.contacts = (Array.isArray(state.contacts) ? state.contacts : []).map((item) => {
        if (!isRecord(item)) return item;
        const existing = draft.companies.find((company) => company.id === item.company_id);
        const company = existing || ensureCompanyForIdentity(draft, item.company);
        return { ...item, company_id: company?.id || null };
      });
      return recordMigration(draft, 6, 7);
    },
    7: (state) => recordMigration({
      ...state,
      reminders: (Array.isArray(state.reminders) ? state.reminders : []).map((item) => ({
        ...item,
        google_calendar_event_id: null,
        google_calendar_id: null,
        calendar_sync_status: "not_synced",
        calendar_synced_at: null,
        calendar_sync_error: null
      })),
      settings: {
        ...(isRecord(state.settings) ? state.settings : {}),
        calendar_auto_sync: false
      }
    }, 7, 8),
    8: (state) => recordMigration({
      ...state,
      contact_activities: (Array.isArray(state.contact_activities) ? state.contact_activities : []).map((item) => {
        if (!isRecord(item)) return item;
        const { subject: _subject, summary: _summary, outcome: _outcome, ...metadata } = item;
        return metadata;
      })
    }, 8, 9)
  };

  function migrateState(input) {
    let state = isRecord(input) ? { ...input } : {};
    let version = Number.isInteger(state.schema_version) && state.schema_version >= 0 ? state.schema_version : 0;
    while (version < ApplyOS.SCHEMA_VERSION) {
      const migrate = migrations[version];
      if (!migrate) throw new Error(`No ApplyOS storage migration from schema v${version}`);
      state = migrate(state);
      version = state.schema_version;
    }
    return state;
  }

  function normalizeApplication(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    return {
      ...item,
      id: safeId(item.id, "app"),
      company: safeString(item.company, "Unknown company") || "Unknown company",
      company_id: safeNullableString(item.company_id),
      role: safeString(item.role, "Untitled role") || "Untitled role",
      url: safeWebUrl(item.url),
      source: safeString(item.source, "unknown") || "unknown",
      description: safeString(item.description),
      location: safeString(item.location),
      status: ApplyOS.APPLICATION_STATUSES.includes(item.status) ? item.status : "saved",
      priority: ApplyOS.PRIORITIES.includes(item.priority) ? item.priority : "medium",
      deadline: safeNullableDate(item.deadline),
      applied_at: safeNullableDate(item.applied_at),
      follow_up_date: safeNullableDate(item.follow_up_date),
      resume_version_id: safeNullableString(item.resume_version_id),
      notes: safeString(item.notes),
      match_score: Math.max(0, Math.min(100, safeNumber(item.match_score))),
      matched_skills: safeStringArray(item.matched_skills),
      missing_skills: safeStringArray(item.missing_skills),
      suggested_keywords: safeStringArray(item.suggested_keywords),
      suggested_experiences: safeStringArray(item.suggested_experiences),
      suggested_answers: safeStringRecord(item.suggested_answers),
      extraction_confidence: normalizeConfidence(item.extraction_confidence),
      captured_at: safeDateString(item.captured_at, createdAt),
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function normalizeReminder(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const completedAt = safeNullableDate(item.completed_at);
    const legacyFinal = item.type === "final_follow_up";
    const kind = ApplyOS.ACTION_KINDS.includes(item.kind)
      ? item.kind
      : (legacyFinal ? "application_final_follow_up" : "application_follow_up");
    return {
      ...item,
      id: safeId(item.id, "rem"),
      kind,
      type: kind === "application_final_follow_up" ? "final_follow_up" : "follow_up",
      title: safeString(item.title, "Next action") || "Next action",
      status: ApplyOS.ACTION_STATUSES.includes(item.status) ? item.status : (completedAt ? "done" : "open"),
      due_at: safeDateString(item.due_at, now),
      snoozed_until: safeNullableDate(item.snoozed_until),
      priority: ApplyOS.PRIORITIES.includes(item.priority) ? item.priority : "medium",
      channel: ApplyOS.ACTION_CHANNELS.includes(item.channel) ? item.channel : "other",
      application_id: safeNullableString(item.application_id),
      contact_id: safeNullableString(item.contact_id),
      interview_id: safeNullableString(item.interview_id),
      notes: safeString(item.notes),
      source: item.source === "user" ? "user" : "system",
      completed_at: completedAt,
      last_notified_at: safeNullableDate(item.last_notified_at),
      google_calendar_event_id: safeNullableString(item.google_calendar_event_id),
      google_calendar_id: safeNullableString(item.google_calendar_id),
      calendar_sync_status: ApplyOS.CALENDAR_SYNC_STATUSES.includes(item.calendar_sync_status) ? item.calendar_sync_status : "not_synced",
      calendar_synced_at: safeNullableDate(item.calendar_synced_at),
      calendar_sync_error: safeNullableString(item.calendar_sync_error),
      context_snapshot: safeContextSnapshot(item.context_snapshot),
      created_at: safeDateString(item.created_at, now),
      updated_at: safeDateString(item.updated_at, safeDateString(item.created_at, now))
    };
  }

  function normalizeAnswer(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const question = safeString(item.question);
    return {
      ...item,
      id: safeId(item.id, "ans"),
      question,
      answer: safeString(item.answer),
      normalized_question: safeString(item.normalized_question) || ApplyOS.normalizeQuestion(question),
      source: ["profile", "profile_default", "manual", "application"].includes(item.source) ? item.source : "manual",
      scope: item.scope === "company" ? "company" : "global",
      company_domain: safeDomain(item.company_domain),
      profile_id: safeString(item.profile_id),
      memory_group: safeString(item.memory_group),
      use_count: Math.max(0, Math.trunc(safeNumber(item.use_count))),
      created_at: safeDateString(item.created_at, now),
      updated_at: safeDateString(item.updated_at, now)
    };
  }

  function normalizeLearnedAnswer(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const question = safeString(item.question);
    return {
      ...item,
      id: safeId(item.id, "learned"),
      fingerprint: safeString(item.fingerprint),
      question,
      normalized_question: safeString(item.normalized_question) || ApplyOS.normalizeQuestion(question),
      answer: safeString(item.answer),
      canonical_field: safeNullableString(item.canonical_field),
      field_type: safeString(item.field_type, "text") || "text",
      site: safeString(item.site, "unknown") || "unknown",
      use_count: Math.max(0, Math.trunc(safeNumber(item.use_count))),
      created_at: safeDateString(item.created_at, now),
      updated_at: safeDateString(item.updated_at, now)
    };
  }

  function normalizeResumeVersion(item) {
    if (!isRecord(item)) return null;
    return {
      ...item,
      id: safeId(item.id, "resume"),
      name: safeString(item.name),
      type: safeString(item.type),
      size: Math.max(0, safeNumber(item.size)),
      sha256: /^[a-f0-9]{64}$/i.test(safeString(item.sha256)) ? safeString(item.sha256).toLowerCase() : "",
      dataUrl: safeResumeDataUrl(item.dataUrl),
      created_at: safeDateString(item.created_at, ApplyOS.nowISO()),
      is_current: item.is_current === true
    };
  }

  function normalizeContact(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    return {
      ...item,
      id: safeId(item.id, "contact"),
      name: safeString(item.name, "Unnamed contact") || "Unnamed contact",
      title: safeString(item.title),
      company: safeString(item.company),
      company_id: safeNullableString(item.company_id),
      email: safeString(item.email),
      phone: safeString(item.phone),
      linkedin_url: safeWebUrl(item.linkedin_url),
      preferred_channel: ApplyOS.ACTION_CHANNELS.includes(item.preferred_channel) ? item.preferred_channel : (item.email ? "email" : item.linkedin_url ? "linkedin" : "other"),
      tags: [...new Set(safeStringArray(item.tags).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
      relationship: ApplyOS.CONTACT_RELATIONSHIPS.includes(item.relationship) ? item.relationship : "other",
      application_ids: [...new Set(safeStringArray(item.application_ids).filter(Boolean))],
      notes: safeString(item.notes),
      last_contacted_at: safeNullableDate(item.last_contacted_at),
      next_action_at: safeNullableDate(item.next_action_at),
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function normalizeCompany(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    const websiteUrl = safeWebUrl(item.website_url);
    return {
      id: safeId(item.id, "company"),
      name: safeString(item.name, "Unnamed company").trim() || "Unnamed company",
      domain: safeDomain(item.domain || websiteUrl),
      website_url: websiteUrl,
      notes: safeString(item.notes),
      tags: [...new Set(safeStringArray(item.tags).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function normalizeWaitingItem(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    const status = ApplyOS.WAITING_STATUSES.includes(item.status) ? item.status : "open";
    return {
      id: safeId(item.id, "waiting"),
      kind: ApplyOS.WAITING_KINDS.includes(item.kind) ? item.kind : "other",
      what: safeString(item.what, "Reply or decision").trim() || "Reply or decision",
      application_id: safeNullableString(item.application_id),
      contact_id: safeNullableString(item.contact_id),
      waiting_since: safeDateString(item.waiting_since, createdAt),
      expected_by: safeNullableDate(item.expected_by),
      notes: safeString(item.notes),
      status,
      resolved_at: status === "resolved" ? (safeNullableDate(item.resolved_at) || safeDateString(item.updated_at, now)) : null,
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function normalizeContactActivity(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    return {
      id: safeId(item.id, "activity"),
      contact_id: safeString(item.contact_id),
      application_id: safeNullableString(item.application_id),
      interview_id: safeNullableString(item.interview_id),
      action_id: safeNullableString(item.action_id),
      type: ApplyOS.CONTACT_ACTIVITY_TYPES.includes(item.type) ? item.type : "note",
      direction: ApplyOS.CONTACT_ACTIVITY_DIRECTIONS.includes(item.direction) ? item.direction : "none",
      occurred_at: safeDateString(item.occurred_at, now),
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function normalizeInterview(item) {
    if (!isRecord(item)) return null;
    const now = ApplyOS.nowISO();
    const createdAt = safeDateString(item.created_at, now);
    return {
      ...item,
      id: safeId(item.id, "interview"),
      application_id: safeString(item.application_id),
      type: ApplyOS.INTERVIEW_TYPES.includes(item.type) ? item.type : "other",
      format: ApplyOS.INTERVIEW_FORMATS.includes(item.format) ? item.format : "video",
      scheduled_at: safeNullableDate(item.scheduled_at),
      location: safeString(item.location),
      meeting_url: safeWebUrl(item.meeting_url),
      interviewer_contact_ids: [...new Set(safeStringArray(item.interviewer_contact_ids).filter(Boolean))],
      company_research: safeString(item.company_research),
      preparation_notes: safeString(item.preparation_notes),
      question_notes: safeString(item.question_notes),
      next_action: safeString(item.next_action),
      next_action_at: safeNullableDate(item.next_action_at),
      create_preparation_action: item.create_preparation_action !== false,
      preparation_action_at: safeNullableDate(item.preparation_action_at),
      create_thank_you_action: item.create_thank_you_action !== false,
      completed_at: safeNullableDate(item.completed_at),
      created_at: createdAt,
      updated_at: safeDateString(item.updated_at, createdAt)
    };
  }

  function emptyState() {
    return {
      schema_version: ApplyOS.SCHEMA_VERSION,
      revision: 0,
      migration_history: [],
      applications: [],
      reminders: [],
      answer_memory: [],
      learned_answers: [],
      resume_versions: [],
      contacts: [],
      contact_activities: [],
      interviews: [],
      companies: [],
      waiting_items: [],
      settings: {
        final_follow_up_enabled: true,
        notification_enabled: true,
        follow_up_offsets_days: [7, 14],
        desktop_notifications_enabled: false,
        notification_digest_time: "09:00",
        calendar_auto_sync: false
      },
      migrated_at: ApplyOS.nowISO()
    };
  }

  function normalizeState(input) {
    const state = { ...emptyState(), ...(isRecord(input) ? input : {}) };
    state.schema_version = ApplyOS.SCHEMA_VERSION;
    state.revision = Math.max(0, Math.trunc(safeNumber(state.revision)));
    state.migration_history = migrationHistory(state.migration_history);
    state.applications = (Array.isArray(state.applications) ? state.applications : []).map(normalizeApplication).filter(Boolean);
    state.reminders = (Array.isArray(state.reminders) ? state.reminders : []).map(normalizeReminder).filter(Boolean);
    state.answer_memory = (Array.isArray(state.answer_memory) ? state.answer_memory : []).map(normalizeAnswer).filter(Boolean);
    state.learned_answers = (Array.isArray(state.learned_answers) ? state.learned_answers : []).map(normalizeLearnedAnswer).filter(Boolean);
    state.resume_versions = (Array.isArray(state.resume_versions) ? state.resume_versions : []).map(normalizeResumeVersion).filter(Boolean);
    state.contacts = (Array.isArray(state.contacts) ? state.contacts : []).map(normalizeContact).filter(Boolean);
    state.contact_activities = (Array.isArray(state.contact_activities) ? state.contact_activities : []).map(normalizeContactActivity).filter(Boolean);
    state.interviews = (Array.isArray(state.interviews) ? state.interviews : []).map(normalizeInterview).filter(Boolean);
    state.companies = (Array.isArray(state.companies) ? state.companies : []).map(normalizeCompany).filter(Boolean);
    state.waiting_items = (Array.isArray(state.waiting_items) ? state.waiting_items : []).map(normalizeWaitingItem).filter(Boolean);
    const applicationIds = new Set(state.applications.map((item) => item.id));
    const companyIds = new Set(state.companies.map((item) => item.id));
    const resumeIds = new Set(state.resume_versions.map((item) => item.id));
    state.applications = state.applications.map((item) => ({ ...item, company_id: companyIds.has(item.company_id) ? item.company_id : null, resume_version_id: resumeIds.has(item.resume_version_id) ? item.resume_version_id : null }));
    state.contacts = state.contacts.map((item) => ({ ...item, company_id: companyIds.has(item.company_id) ? item.company_id : null, application_ids: item.application_ids.filter((id) => applicationIds.has(id)) }));
    const contactIds = new Set(state.contacts.map((item) => item.id));
    state.waiting_items = state.waiting_items.map((item) => {
      const applicationId = applicationIds.has(item.application_id) ? item.application_id : null;
      const contactId = contactIds.has(item.contact_id) ? item.contact_id : null;
      if (item.status === "open" && !applicationId && !contactId) {
        return { ...item, application_id: null, contact_id: null, status: "resolved", resolved_at: item.resolved_at || item.updated_at };
      }
      return { ...item, application_id: applicationId, contact_id: contactId };
    });
    state.interviews = state.interviews
      .filter((item) => applicationIds.has(item.application_id))
      .map((item) => ({ ...item, interviewer_contact_ids: item.interviewer_contact_ids.filter((id) => contactIds.has(id)) }));
    const interviewIds = new Set(state.interviews.map((item) => item.id));
    state.reminders = state.reminders.filter((item) => {
      if (item.application_id && !applicationIds.has(item.application_id)) item.application_id = null;
      if (item.contact_id && !contactIds.has(item.contact_id)) item.contact_id = null;
      if (item.interview_id && !interviewIds.has(item.interview_id)) item.interview_id = null;
      if (item.kind.startsWith("application_")) return Boolean(item.application_id) || item.status !== "open";
      if (item.kind === "contact_follow_up") return Boolean(item.contact_id) || item.status !== "open";
      if (item.kind.startsWith("interview_")) return Boolean(item.interview_id) || item.status !== "open";
      return item.kind === "custom";
    });
    const actionIds = new Set(state.reminders.map((item) => item.id));
    state.contact_activities = state.contact_activities
      .filter((item) => contactIds.has(item.contact_id))
      .map((item) => ({
        ...item,
        application_id: applicationIds.has(item.application_id) ? item.application_id : null,
        interview_id: interviewIds.has(item.interview_id) ? item.interview_id : null,
        action_id: actionIds.has(item.action_id) ? item.action_id : null
      }));
    state.settings = { ...emptyState().settings, ...(isRecord(state.settings) ? state.settings : {}) };
    state.settings.final_follow_up_enabled = state.settings.final_follow_up_enabled !== false;
    state.settings.notification_enabled = state.settings.notification_enabled !== false;
    state.settings.follow_up_offsets_days = [...new Set((Array.isArray(state.settings.follow_up_offsets_days) ? state.settings.follow_up_offsets_days : [7, 14])
      .map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 60))].sort((a, b) => a - b).slice(0, 4);
    if (!state.settings.follow_up_offsets_days.length) state.settings.follow_up_offsets_days = [7, 14];
    state.settings.desktop_notifications_enabled = state.settings.desktop_notifications_enabled === true;
    state.settings.notification_digest_time = /^([01]\d|2[0-3]):[0-5]\d$/.test(state.settings.notification_digest_time) ? state.settings.notification_digest_time : "09:00";
    state.settings.calendar_auto_sync = state.settings.calendar_auto_sync === true;
    syncNextActionProjections(state);
    state.migrated_at = safeDateString(state.migrated_at, ApplyOS.nowISO());
    return state;
  }

  function actionDueTime(action) {
    return new Date(action.snoozed_until || action.due_at).getTime();
  }

  function firstOpenAction(state, predicate) {
    return state.reminders.filter((item) => item.status === "open" && predicate(item))
      .sort((left, right) => actionDueTime(left) - actionDueTime(right))[0] || null;
  }

  function syncNextActionProjections(state) {
    state.applications = state.applications.map((application) => {
      const action = firstOpenAction(state, (item) => item.application_id === application.id && ["application_follow_up", "application_final_follow_up"].includes(item.kind));
      return { ...application, follow_up_date: action ? (action.snoozed_until || action.due_at) : null };
    });
    state.contacts = state.contacts.map((contact) => {
      const action = firstOpenAction(state, (item) => item.contact_id === contact.id);
      const latestActivity = state.contact_activities.filter((item) => item.contact_id === contact.id)
        .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())[0];
      return { ...contact, next_action_at: action ? (action.snoozed_until || action.due_at) : null, last_contacted_at: latestActivity?.occurred_at || contact.last_contacted_at || null };
    });
  }

  function withStorageLock(task) {
    const locks = root.navigator?.locks;
    if (locks && typeof locks.request === "function") {
      return locks.request(STORAGE_LOCK_NAME, { mode: "exclusive" }, task);
    }
    const run = localStorageQueue.then(task, task);
    localStorageQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readRaw() {
    return chrome.storage.local.get([ApplyOS.STORAGE_KEY, ApplyOS.PROFILE_KEY]);
  }

  async function writeState(state) {
    const normalized = normalizeState(state);
    await chrome.storage.local.set({ [ApplyOS.STORAGE_KEY]: normalized });
    return normalized;
  }

  function answerFromLegacy(item, metadata = {}) {
    return {
      id: ApplyOS.uid("ans"),
      question: String(item.question || "").trim(),
      answer: String(item.answer || "").trim(),
      normalized_question: ApplyOS.normalizeQuestion(item.question),
      source: metadata.source || item.source || "profile",
      scope: item.scope === "company" ? "company" : "global",
      company_domain: safeDomain(item.company_domain || item.companyDomain),
      profile_id: safeString(metadata.profileId || item.profile_id),
      memory_group: safeString(metadata.memoryGroup || item.memory_group),
      use_count: 0,
      created_at: ApplyOS.nowISO(),
      updated_at: ApplyOS.nowISO()
    };
  }

  async function ensureStateUnlocked() {
    await ApplyOS.ensureProfiles?.();
    const raw = await readRaw();
    if (raw[ApplyOS.STORAGE_KEY]) {
      const migrated = migrateState(raw[ApplyOS.STORAGE_KEY]);
      const normalized = normalizeState(migrated);
      if (JSON.stringify(raw[ApplyOS.STORAGE_KEY]) !== JSON.stringify(normalized)) return writeState(normalized);
      return normalized;
    }

    const state = emptyState();
    const profile = raw[ApplyOS.PROFILE_KEY] || {};
    state.answer_memory = (profile.customAnswers || []).filter((item) => item.question && item.answer).map(answerFromLegacy);
    if (profile.resume?.name) {
      state.resume_versions.push({
        id: "resume_current",
        name: profile.resume.name,
        type: profile.resume.type || "",
        size: profile.resume.size || 0,
        created_at: profile.updatedAt || ApplyOS.nowISO(),
        is_current: true
      });
    }
    return writeState(state);
  }

  ApplyOS.ensureState = async function ensureState() {
    return withStorageLock(ensureStateUnlocked);
  };

  ApplyOS.getState = async function getState() {
    return ApplyOS.ensureState();
  };

  ApplyOS.mutateState = async function mutateState(mutator) {
    if (typeof mutator !== "function") throw new TypeError("ApplyOS.mutateState requires a mutator function");
    return withStorageLock(async () => {
      const state = await ensureStateUnlocked();
      const result = await mutator(structuredClone(state));
      const next = isRecord(result) ? result : state;
      next.revision = state.revision;
      const normalized = normalizeState(next);
      if (JSON.stringify(normalized) === JSON.stringify(state)) return state;
      normalized.revision = state.revision + 1;
      return writeState(normalized);
    });
  };

  ApplyOS.getApplicationByUrl = async function getApplicationByUrl(url) {
    const state = await ApplyOS.ensureState();
    const canonical = ApplyOS.canonicalizeUrl(url);
    return state.applications.find((item) => ApplyOS.canonicalizeUrl(item.url) === canonical) || null;
  };

  function applicationMatchFields(description, profile) {
    const match = ApplyOS.calculateMatch?.(description || "", profile) || { score: 0, matchedSkills: [], missingSkills: [], suggestedKeywords: [], suggestedExperiences: [], suggestedAnswers: {} };
    return {
      match_score: match.score,
      matched_skills: match.matchedSkills,
      missing_skills: match.missingSkills,
      suggested_keywords: match.suggestedKeywords,
      suggested_experiences: match.suggestedExperiences,
      suggested_answers: match.suggestedAnswers
    };
  }

  function sameApplicationMatch(application, fields) {
    return JSON.stringify({
      match_score: application.match_score,
      matched_skills: application.matched_skills,
      missing_skills: application.missing_skills,
      suggested_keywords: application.suggested_keywords,
      suggested_experiences: application.suggested_experiences,
      suggested_answers: application.suggested_answers
    }) === JSON.stringify(fields);
  }

  ApplyOS.refreshApplicationMatches = async function refreshApplicationMatches(profile = {}, options = {}) {
    const applicationId = String(options.applicationId || "");
    const applications = [];
    let count = 0;
    await ApplyOS.mutateState((state) => {
      state.applications = state.applications.map((application) => {
        if (applicationId && application.id !== applicationId) return application;
        const fields = applicationMatchFields(application.description, profile);
        if (sameApplicationMatch(application, fields)) {
          applications.push(application);
          return application;
        }
        const updated = { ...application, ...fields, updated_at: ApplyOS.nowISO() };
        applications.push(updated);
        count += 1;
        return updated;
      });
      return state;
    });
    return { count, applications };
  };

  ApplyOS.upsertApplication = async function upsertApplication(job, profile = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const canonical = ApplyOS.canonicalizeUrl(job.url);
      const existing = state.applications.find((item) => ApplyOS.canonicalizeUrl(item.url) === canonical);
      const matchFields = applicationMatchFields(job.description || existing?.description || "", profile);
      const now = ApplyOS.nowISO();
      const base = existing || {
        id: ApplyOS.uid("app"),
        status: "saved",
        priority: "medium",
        applied_at: null,
        follow_up_date: null,
        notes: "",
        created_at: now
      };
      const companyName = job.company || base.company || "Unknown company";
      const explicitCompany = state.companies.find((item) => item.id === job.company_id);
      const company = explicitCompany || ensureCompanyForIdentity(state, companyName, job.company_domain, job.company_website_url);
      saved = {
        ...base,
        company: companyName,
        company_id: company?.id || null,
        role: job.role || base.role || "Untitled role",
        url: job.url || base.url,
        source: job.source || base.source || "unknown",
        description: job.description || base.description || "",
        location: job.location || base.location || "",
        deadline: job.deadline || base.deadline || null,
        resume_version_id: job.resume_version_id || base.resume_version_id || state.resume_versions.find((item) => item.is_current)?.id || null,
        ...matchFields,
        extraction_confidence: job.confidence || base.extraction_confidence || {},
        captured_at: job.captured_at || base.captured_at || now,
        updated_at: now
      };
      if (existing) state.applications[state.applications.indexOf(existing)] = saved;
      else state.applications.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.updateApplication = async function updateApplication(id, patch) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const index = state.applications.findIndex((item) => item.id === id);
      if (index < 0) return state;
      const current = state.applications[index];
      const nextCompanyName = Object.prototype.hasOwnProperty.call(patch, "company") ? patch.company : current.company;
      const explicitCompanyId = Object.prototype.hasOwnProperty.call(patch, "company_id") ? patch.company_id : undefined;
      const linkedCompany = explicitCompanyId === null
        ? null
        : state.companies.find((item) => item.id === (explicitCompanyId || current.company_id))
          || ensureCompanyForIdentity(state, nextCompanyName);
      updated = normalizeApplication({ ...current, ...patch, id, company_id: linkedCompany?.id || null, updated_at: ApplyOS.nowISO() });
      state.applications[index] = updated;
      if (["offer", "rejected", "closed"].includes(updated.status)) {
        const now = ApplyOS.nowISO();
        state.reminders = state.reminders.map((item) => item.application_id === id
          && item.status === "open"
          && item.source === "system"
          && GENERATED_APPLICATION_PROCESS_KINDS.has(item.kind)
          ? { ...item, status: "cancelled", updated_at: now }
          : item);
      }
      return state;
    });
    return updated;
  };

  ApplyOS.deleteApplication = async function deleteApplication(id) {
    const state = await ApplyOS.mutateState((draft) => {
      const application = draft.applications.find((item) => item.id === id);
      if (!application) return draft;
      const now = ApplyOS.nowISO();
      draft.applications = draft.applications.filter((item) => item.id !== id);
      const deletedInterviews = draft.interviews.filter((item) => item.application_id === id);
      const interviewIds = new Set(deletedInterviews.map((item) => item.id));
      const interviewById = new Map(deletedInterviews.map((item) => [item.id, item]));
      draft.reminders = draft.reminders.map((item) => {
        if (item.application_id !== id && !interviewIds.has(item.interview_id)) return item;
        const interview = interviewById.get(item.interview_id);
        const next = {
          ...item,
          application_id: null,
          interview_id: null,
          context_snapshot: {
            ...item.context_snapshot,
            company: application.company,
            role: application.role,
            ...(interview ? { interview_type: interview.type } : {})
          },
          updated_at: now
        };
        if (next.status === "open" && (next.source === "system" || next.kind.startsWith("application_") || next.kind.startsWith("interview_"))) {
          next.status = "cancelled";
        }
        return next;
      });
      draft.interviews = draft.interviews.filter((item) => item.application_id !== id);
      draft.contact_activities = draft.contact_activities.map((item) => item.application_id === id || interviewIds.has(item.interview_id)
        ? { ...item, application_id: item.application_id === id ? null : item.application_id, interview_id: interviewIds.has(item.interview_id) ? null : item.interview_id, updated_at: now }
        : item);
      draft.contacts = draft.contacts.map((item) => ({
        ...item,
        application_ids: item.application_ids.filter((applicationId) => applicationId !== id),
        updated_at: item.application_ids.includes(id) ? now : item.updated_at
      }));
      draft.waiting_items = draft.waiting_items.map((item) => {
        if (item.application_id !== id) return item;
        const next = { ...item, application_id: null, updated_at: now };
        if (!next.contact_id && next.status === "open") return { ...next, status: "resolved", resolved_at: now };
        return next;
      });
      return draft;
    });
    await ApplyOS.removeApplicationGraph?.(id);
    return state;
  };

  ApplyOS.markApplicationApplied = async function markApplicationApplied(id, appliedAt = ApplyOS.nowISO()) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const index = state.applications.findIndex((item) => item.id === id);
      if (index < 0) return state;
      const application = state.applications[index];
      const reminders = ApplyOS.buildFollowUpReminders(application, appliedAt, state.settings.follow_up_offsets_days);
      state.reminders = state.reminders.filter((item) => !isSystemApplicationFollowUp(item, id)).concat(reminders);
      updated = {
        ...application,
        status: "applied",
        applied_at: new Date(appliedAt).toISOString(),
        follow_up_date: reminders[0].due_at,
        updated_at: ApplyOS.nowISO()
      };
      state.applications[index] = updated;
      return state;
    });
    return updated;
  };

  ApplyOS.refreshDueApplications = async function refreshDueApplications(at = new Date()) {
    const now = new Date(at).getTime();
    return ApplyOS.mutateState((state) => {
      const dueIds = new Set(state.reminders.filter((item) => item.status === "open"
        && ["application_follow_up", "application_final_follow_up"].includes(item.kind)
        && new Date(item.snoozed_until || item.due_at).getTime() <= now).map((item) => item.application_id));
      state.applications = state.applications.map((item) => dueIds.has(item.id) && item.status === "applied"
        ? { ...item, status: "follow_up_due", updated_at: ApplyOS.nowISO() }
        : item);
      return state;
    });
  };

  ApplyOS.listActions = async function listActions(filters = {}) {
    const state = await ApplyOS.getState();
    const now = filters.at ? new Date(filters.at) : new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return state.reminders.filter((item) => {
      if (filters.status && item.status !== filters.status) return false;
      if (filters.kind && item.kind !== filters.kind) return false;
      if (filters.priority && item.priority !== filters.priority) return false;
      if (filters.channel && item.channel !== filters.channel) return false;
      if (filters.application_id && item.application_id !== filters.application_id) return false;
      if (filters.contact_id && item.contact_id !== filters.contact_id) return false;
      return true;
    }).map((item) => {
      const effective_due_at = item.snoozed_until || item.due_at;
      const due = new Date(effective_due_at).getTime();
      const group = item.status !== "open" ? "done" : due < start.getTime() ? "overdue" : due < end.getTime() ? "today" : "upcoming";
      return { ...item, effective_due_at, group };
    }).sort((left, right) => {
      const priorityRank = { high: 0, medium: 1, low: 2 };
      return new Date(left.effective_due_at).getTime() - new Date(right.effective_due_at).getTime()
        || priorityRank[left.priority] - priorityRank[right.priority]
        || new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });
  };

  ApplyOS.upsertAction = async function upsertAction(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      const index = state.reminders.findIndex((item) => item.id === input.id);
      const current = index >= 0 ? state.reminders[index] : { id: ApplyOS.uid("rem"), created_at: now, source: "user" };
      saved = normalizeReminder({ ...current, ...input, id: current.id, updated_at: now });
      const validContext = saved.kind === "custom"
        || (saved.kind.startsWith("application_") && state.applications.some((item) => item.id === saved.application_id))
        || (saved.kind === "contact_follow_up" && state.contacts.some((item) => item.id === saved.contact_id))
        || (saved.kind.startsWith("interview_") && state.interviews.some((item) => item.id === saved.interview_id));
      if (!validContext) { saved = null; return state; }
      if (index >= 0) state.reminders[index] = saved;
      else state.reminders.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.completeAction = async function completeAction(id) {
    let applicationId = null;
    const state = await ApplyOS.mutateState((draft) => {
      const reminder = draft.reminders.find((item) => item.id === id && item.status === "open");
      if (!reminder) return draft;
      applicationId = reminder.application_id;
      const now = ApplyOS.nowISO();
      reminder.status = "done";
      reminder.completed_at = now;
      reminder.updated_at = now;
      reconcileApplicationFollowUpStatus(draft, applicationId, now);
      return draft;
    });
    return { state, application_id: applicationId };
  };

  ApplyOS.completeReminder = ApplyOS.completeAction;

  async function transitionAction(id, status) {
    return ApplyOS.mutateState((state) => {
      const action = state.reminders.find((item) => item.id === id && item.status === "open");
      if (!action) return state;
      const applicationId = action.application_id;
      action.status = status;
      const now = ApplyOS.nowISO();
      action.updated_at = now;
      reconcileApplicationFollowUpStatus(state, applicationId, now);
      return state;
    });
  }

  ApplyOS.skipAction = (id) => transitionAction(id, "skipped");
  ApplyOS.cancelAction = (id) => transitionAction(id, "cancelled");

  ApplyOS.snoozeAction = async function snoozeAction(id, until) {
    return ApplyOS.mutateState((state) => {
      const action = state.reminders.find((item) => item.id === id && item.status === "open");
      const iso = safeNullableDate(until);
      if (!action || !iso) return state;
      action.snoozed_until = iso;
      action.updated_at = ApplyOS.nowISO();
      return state;
    });
  };

  ApplyOS.rescheduleAction = async function rescheduleAction(id, dueAt) {
    return ApplyOS.mutateState((state) => {
      const action = state.reminders.find((item) => item.id === id && item.status === "open");
      const iso = safeNullableDate(dueAt);
      if (!action || !iso) return state;
      action.due_at = iso;
      action.snoozed_until = null;
      action.updated_at = ApplyOS.nowISO();
      return state;
    });
  };

  ApplyOS.rescheduleFollowUp = async function rescheduleFollowUp(applicationId, dueAt) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const application = state.applications.find((item) => item.id === applicationId);
      if (!application) return state;
      const reminder = state.reminders
        .filter((item) => item.application_id === applicationId && item.kind === "application_follow_up" && item.status === "open")
        .sort((a, b) => new Date(a.snoozed_until || a.due_at).getTime() - new Date(b.snoozed_until || b.due_at).getTime())[0];
      const iso = dueAt ? new Date(`${String(dueAt).slice(0, 10)}T12:00:00`).toISOString() : null;
      if (reminder && iso) { reminder.due_at = iso; reminder.snoozed_until = null; reminder.updated_at = ApplyOS.nowISO(); }
      else if (iso) {
        const action = ApplyOS.buildFollowUpReminders(application, new Date(new Date(iso).getTime() - 86400000), [1])[0];
        action.due_at = iso;
        state.reminders.push(action);
      }
      application.updated_at = ApplyOS.nowISO();
      updated = application;
      return state;
    });
    return updated;
  };

  ApplyOS.updateSettings = async function updateSettings(patch) {
    return ApplyOS.mutateState((state) => {
      state.settings = { ...state.settings, ...patch };
      return state;
    });
  };

  ApplyOS.removeProfileState = async function removeProfileState(profileId) {
    return ApplyOS.mutateState((state) => {
      state.answer_memory = state.answer_memory.filter((item) => item.profile_id !== profileId);
      return state;
    });
  };

  ApplyOS.syncAnswerMemory = async function syncAnswerMemory(items = [], options = {}) {
    return ApplyOS.mutateState((state) => {
      const memoryGroup = safeString(options.memoryGroup);
      if (options.authoritative && memoryGroup) {
        state.answer_memory = state.answer_memory.filter((answer) => answer.memory_group !== memoryGroup && !(options.removeLegacyProfileEntries && answer.source === "profile" && !answer.memory_group));
      }
      items.filter((item) => item.question && item.answer).forEach((item) => {
        const normalized = ApplyOS.normalizeQuestion(item.question);
        const scope = item.scope === "company" ? "company" : "global";
        const companyDomain = safeDomain(item.company_domain || item.companyDomain);
        const existing = state.answer_memory.find((answer) => answer.normalized_question === normalized && answer.scope === scope && answer.company_domain === companyDomain && (!memoryGroup || answer.memory_group === memoryGroup));
        if (existing) {
          existing.answer = item.answer;
          existing.updated_at = ApplyOS.nowISO();
        } else {
          state.answer_memory.push(answerFromLegacy(item, { source: options.source, profileId: options.profileId, memoryGroup }));
        }
      });
      return state;
    });
  };

  ApplyOS.syncProfileAnswerDefaults = async function syncProfileAnswerDefaults(profile = {}) {
    const items = [
      ["What is your expected salary?", profile.desiredSalary],
      ["What is your notice period?", profile.noticePeriod],
      ["Are you legally authorized to work in this country?", profile.workAuthorization],
      ["Will you require visa sponsorship?", profile.visaSponsorship],
      ["What is your LinkedIn profile?", profile.linkedin],
      ["What is your GitHub profile?", profile.github],
      ["What is your portfolio website?", profile.portfolio],
      ["Are you willing to relocate?", profile.willingToRelocate],
      ["What is your remote work preference?", profile.remotePreference],
      ["Tell us about yourself", profile.coverLetter]
    ].filter(([, answer]) => String(answer || "").trim()).map(([question, answer]) => ({ question, answer: String(answer) }));
    const index = await ApplyOS.getProfilesIndex?.();
    const profileId = index?.activeId || "default";
    return ApplyOS.syncAnswerMemory(items, {
      authoritative: true,
      source: "profile_default",
      profileId,
      memoryGroup: `defaults:${profileId}`
    });
  };

  ApplyOS.findRememberedAnswer = async function findRememberedAnswer(question, context = {}) {
    const state = await ApplyOS.ensureState();
    const domain = safeDomain(context.companyDomain || context.url);
    let best = null;
    for (const item of state.answer_memory) {
      if (item.scope === "company" && (!domain || !(domain === item.company_domain || domain.endsWith(`.${item.company_domain}`)))) continue;
      const score = ApplyOS.questionSimilarity?.(question, item.question) || 0;
      if (score > (best?.score || 0)) best = { ...item, score };
    }
    return best?.score >= 0.58 ? best : null;
  };

  ApplyOS.rememberApplicationAnswer = async function rememberApplicationAnswer(entry = {}) {
    const question = safeString(entry.question).trim().slice(0, 500);
    const answer = safeString(entry.answer).trim().slice(0, 5000);
    if (!question || !answer) return null;
    const profileId = safeString(entry.profile_id || entry.profileId, "default") || "default";
    const scope = entry.scope === "company" ? "company" : "global";
    const companyDomain = scope === "company" ? safeDomain(entry.company_domain || entry.companyDomain) : "";
    if (scope === "company" && !companyDomain) return null;
    let remembered = null;
    await ApplyOS.mutateState((state) => {
      const normalized = ApplyOS.normalizeQuestion(question);
      const now = ApplyOS.nowISO();
      const memoryGroup = `custom:${profileId}`;
      const existing = state.answer_memory.find((item) => item.normalized_question === normalized
        && item.profile_id === profileId
        && item.scope === scope
        && item.company_domain === companyDomain);
      if (existing) {
        existing.question = question;
        existing.answer = answer;
        existing.source = "application";
        existing.memory_group = memoryGroup;
        existing.use_count = Number(existing.use_count || 0) + 1;
        existing.updated_at = now;
        remembered = existing;
      } else {
        remembered = answerFromLegacy({ question, answer, scope, company_domain: companyDomain }, {
          source: "application",
          profileId,
          memoryGroup
        });
        remembered.use_count = 1;
        state.answer_memory.push(remembered);
      }
      return state;
    });
    return remembered;
  };

  ApplyOS.rememberCorrection = async function rememberCorrection(correction = {}) {
    const answer = String(correction.answer || "").trim();
    const question = String(correction.question || "").trim();
    if (!answer || !question || !correction.fingerprint) return null;
    let learned = null;
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      const existing = state.learned_answers.find((item) => item.fingerprint === correction.fingerprint);
      if (existing) {
        existing.answer = answer;
        existing.question = question;
        existing.normalized_question = ApplyOS.normalizeQuestion(question);
        existing.canonical_field = correction.canonical_field || existing.canonical_field || null;
        existing.field_type = correction.field_type || existing.field_type || "text";
        existing.site = correction.site || existing.site || "unknown";
        existing.use_count = Number(existing.use_count || 0) + 1;
        existing.updated_at = now;
        learned = existing;
      } else {
        learned = {
          id: ApplyOS.uid("learned"),
          fingerprint: correction.fingerprint,
          question,
          normalized_question: ApplyOS.normalizeQuestion(question),
          answer,
          canonical_field: correction.canonical_field || null,
          field_type: correction.field_type || "text",
          site: correction.site || "unknown",
          use_count: 1,
          created_at: now,
          updated_at: now
        };
        state.learned_answers.push(learned);
      }
      state.learned_answers = state.learned_answers
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
        .slice(0, 500);
      return state;
    });
    return learned;
  };

  ApplyOS.syncResumeVersion = async function syncResumeVersion(resume) {
    if (!resume?.name) return null;
    const dataUrl = safeResumeDataUrl(resume.dataUrl);
    const bytes = new TextEncoder().encode(dataUrl || `${resume.name}:${resume.size || 0}:${resume.type || ""}`);
    const digest = root.crypto?.subtle ? await root.crypto.subtle.digest("SHA-256", bytes) : null;
    const sha256 = digest ? Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") : "";
    let current = null;
    await ApplyOS.mutateState((state) => {
      state.resume_versions = state.resume_versions.map((item) => ({ ...item, is_current: false }));
      current = state.resume_versions.find((item) => sha256 ? item.sha256 === sha256 : item.name === resume.name && item.size === resume.size);
      if (current) current.is_current = true;
      else {
        current = { id: ApplyOS.uid("resume"), name: resume.name, type: resume.type || "", size: resume.size || 0, sha256, dataUrl, created_at: ApplyOS.nowISO(), is_current: true };
        state.resume_versions.push(current);
      }
      const referenced = new Set(state.applications.map((item) => item.resume_version_id).filter(Boolean));
      const retainedUnreferenced = state.resume_versions
        .filter((item) => !referenced.has(item.id) && !item.is_current)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 10);
      const retainedIds = new Set([...referenced, current.id, ...retainedUnreferenced.map((item) => item.id)]);
      state.resume_versions = state.resume_versions.filter((item) => retainedIds.has(item.id));
      return state;
    });
    return current;
  };

  ApplyOS.setCurrentResumeVersion = async function setCurrentResumeVersion(id) {
    return ApplyOS.mutateState((state) => {
      if (!state.resume_versions.some((item) => item.id === id)) return state;
      state.resume_versions = state.resume_versions.map((item) => ({ ...item, is_current: item.id === id }));
      return state;
    });
  };

  ApplyOS.upsertCompany = async function upsertCompany(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const name = safeString(input.name).trim();
      if (!name) return state;
      const now = ApplyOS.nowISO();
      const requestedIndex = state.companies.findIndex((item) => item.id === input.id);
      const matchedIndex = requestedIndex >= 0 ? requestedIndex : state.companies.findIndex((item) => companyIdentityMatch(item, name, input.domain || input.website_url));
      const current = matchedIndex >= 0 ? state.companies[matchedIndex] : { id: ApplyOS.uid("company"), created_at: now };
      saved = normalizeCompany({ ...current, ...input, id: current.id, name, updated_at: now });
      if (matchedIndex >= 0) state.companies[matchedIndex] = saved;
      else state.companies.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.deleteCompany = async function deleteCompany(id) {
    return ApplyOS.mutateState((state) => {
      if (!state.companies.some((item) => item.id === id)) return state;
      const now = ApplyOS.nowISO();
      state.companies = state.companies.filter((item) => item.id !== id);
      state.applications = state.applications.map((item) => item.company_id === id ? { ...item, company_id: null, updated_at: now } : item);
      state.contacts = state.contacts.map((item) => item.company_id === id ? { ...item, company_id: null, updated_at: now } : item);
      return state;
    });
  };

  ApplyOS.upsertWaitingItem = async function upsertWaitingItem(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const applicationId = state.applications.some((item) => item.id === input.application_id) ? input.application_id : null;
      const contactId = state.contacts.some((item) => item.id === input.contact_id) ? input.contact_id : null;
      if (!applicationId && !contactId) return state;
      const now = ApplyOS.nowISO();
      const index = state.waiting_items.findIndex((item) => item.id === input.id);
      const current = index >= 0 ? state.waiting_items[index] : { id: ApplyOS.uid("waiting"), created_at: now, waiting_since: now, status: "open" };
      saved = normalizeWaitingItem({
        ...current,
        ...input,
        id: current.id,
        application_id: applicationId,
        contact_id: contactId,
        status: input.status === "resolved" ? "resolved" : "open",
        updated_at: now
      });
      if (index >= 0) state.waiting_items[index] = saved;
      else state.waiting_items.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.resolveWaitingItem = async function resolveWaitingItem(id) {
    return ApplyOS.mutateState((state) => {
      const item = state.waiting_items.find((entry) => entry.id === id && entry.status === "open");
      if (!item) return state;
      const now = ApplyOS.nowISO();
      item.status = "resolved";
      item.resolved_at = now;
      item.updated_at = now;
      return state;
    });
  };

  ApplyOS.listWaitingItems = async function listWaitingItems(filters = {}) {
    const state = await ApplyOS.getState();
    const now = filters.at ? new Date(filters.at) : new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return state.waiting_items.filter((item) => !filters.status || item.status === filters.status).map((item) => {
      const expected = item.expected_by ? new Date(item.expected_by).getTime() : null;
      const group = item.status === "resolved" ? "resolved"
        : expected === null ? "no_date"
          : expected < start.getTime() ? "overdue"
            : expected < end.getTime() ? "today"
              : "upcoming";
      return { ...item, group };
    }).sort((left, right) => {
      if (!left.expected_by && !right.expected_by) return new Date(left.waiting_since).getTime() - new Date(right.waiting_since).getTime();
      if (!left.expected_by) return 1;
      if (!right.expected_by) return -1;
      return new Date(left.expected_by).getTime() - new Date(right.expected_by).getTime();
    });
  };

  ApplyOS.convertWaitingToFollowUp = async function convertWaitingToFollowUp(id, at = ApplyOS.nowISO()) {
    let action = null;
    await ApplyOS.mutateState((state) => {
      const waiting = state.waiting_items.find((item) => item.id === id && item.status === "open");
      const now = safeDateString(at, ApplyOS.nowISO());
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      if (!waiting?.expected_by || new Date(waiting.expected_by).getTime() >= dayStart.getTime()) return state;
      const contact = state.contacts.find((item) => item.id === waiting.contact_id);
      const application = state.applications.find((item) => item.id === waiting.application_id);
      if (!contact && !application) return state;
      action = normalizeReminder({
        id: ApplyOS.uid("rem"),
        kind: contact ? "contact_follow_up" : "application_follow_up",
        title: `Follow up: ${waiting.what}`,
        status: "open",
        due_at: now,
        priority: "medium",
        channel: contact?.preferred_channel || "email",
        application_id: application?.id || null,
        contact_id: contact?.id || null,
        interview_id: null,
        notes: waiting.notes,
        source: "user",
        created_at: now,
        updated_at: now
      });
      state.reminders.unshift(action);
      waiting.status = "resolved";
      waiting.resolved_at = now;
      waiting.updated_at = now;
      if (application && application.status === "applied") {
        application.status = "follow_up_due";
        application.updated_at = now;
      }
      return state;
    });
    return action;
  };

  ApplyOS.upsertContact = async function upsertContact(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      const index = state.contacts.findIndex((item) => item.id === input.id);
      const current = index >= 0 ? state.contacts[index] : { id: ApplyOS.uid("contact"), created_at: now };
      const companyName = Object.prototype.hasOwnProperty.call(input, "company") ? input.company : current.company;
      const explicitCompanyId = Object.prototype.hasOwnProperty.call(input, "company_id") ? input.company_id : undefined;
      const linkedCompany = explicitCompanyId === null
        ? null
        : state.companies.find((item) => item.id === (explicitCompanyId || current.company_id))
          || ensureCompanyForIdentity(state, companyName);
      saved = normalizeContact({ ...current, ...input, id: current.id, company_id: linkedCompany?.id || null, updated_at: now });
      if (index >= 0) state.contacts[index] = saved;
      else state.contacts.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.findDuplicateContacts = async function findDuplicateContacts(input = {}, excludeId = "") {
    const state = await ApplyOS.getState();
    const email = safeString(input.email).trim().toLowerCase();
    const linkedin = safeWebUrl(input.linkedin_url).replace(/\/$/, "").toLowerCase();
    const name = safeString(input.name).trim().toLowerCase();
    return state.contacts.filter((item) => item.id !== excludeId).map((item) => {
      const exactEmail = Boolean(email && item.email.trim().toLowerCase() === email);
      const exactLinkedIn = Boolean(linkedin && item.linkedin_url.replace(/\/$/, "").toLowerCase() === linkedin);
      const sameName = Boolean(name && item.name.trim().toLowerCase() === name);
      return { contact: item, exact: exactEmail || exactLinkedIn, reason: exactEmail ? "email" : exactLinkedIn ? "linkedin" : sameName ? "name" : "" };
    }).filter((item) => item.reason);
  };

  ApplyOS.applyContactImportPlan = async function applyContactImportPlan(rows = []) {
    const summary = { created: 0, merged: 0, skipped: 0 };
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      for (const row of rows) {
        if (!row || row.errors?.length || row.decision === "skip") { summary.skipped += 1; continue; }
        if (row.decision === "merge") {
          const index = state.contacts.findIndex((item) => item.id === row.mergeTargetId);
          if (index < 0) { summary.skipped += 1; continue; }
          const target = state.contacts[index];
          const input = normalizeContact({ ...row.input, id: target.id, created_at: target.created_at, updated_at: now });
          state.contacts[index] = normalizeContact({
            ...input,
            ...target,
            id: target.id,
            name: target.name || input.name,
            email: target.email || input.email,
            phone: target.phone || input.phone,
            linkedin_url: target.linkedin_url || input.linkedin_url,
            title: target.title || input.title,
            company: target.company || input.company,
            notes: [target.notes, input.notes].filter(Boolean).join("\n\n"),
            tags: [...new Set([...(target.tags || []), ...(input.tags || [])])],
            application_ids: [...new Set([...(target.application_ids || []), ...(input.application_ids || [])])],
            last_contacted_at: newestDate(target.last_contacted_at, input.last_contacted_at),
            created_at: target.created_at,
            updated_at: now
          });
          summary.merged += 1;
          continue;
        }
        state.contacts.unshift(normalizeContact({ ...row.input, id: ApplyOS.uid("contact"), created_at: now, updated_at: now }));
        summary.created += 1;
      }
      return state;
    });
    return summary;
  };

  ApplyOS.logContactActivity = async function logContactActivity(input = {}, options = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const contact = state.contacts.find((item) => item.id === input.contact_id);
      if (!contact) return state;
      const now = ApplyOS.nowISO();
      saved = normalizeContactActivity({ ...input, id: input.id || ApplyOS.uid("activity"), created_at: input.created_at || now, updated_at: now });
      const existingIndex = state.contact_activities.findIndex((item) => item.id === saved.id);
      if (existingIndex >= 0) state.contact_activities[existingIndex] = saved;
      else state.contact_activities.unshift(saved);
      if (options.complete_action_id) {
        const action = state.reminders.find((item) => item.id === options.complete_action_id && item.status === "open");
        if (action) {
          action.status = "done";
          action.completed_at = now;
          action.updated_at = now;
          reconcileApplicationFollowUpStatus(state, action.application_id, now);
        }
      }
      if (options.next_action?.title && options.next_action?.due_at) {
        const next = normalizeReminder({
          ...options.next_action,
          id: ApplyOS.uid("rem"),
          kind: "contact_follow_up",
          status: "open",
          contact_id: contact.id,
          application_id: options.next_action.application_id || saved.application_id,
          interview_id: null,
          source: "user",
          created_at: now,
          updated_at: now
        });
        state.reminders.unshift(next);
      }
      contact.updated_at = now;
      return state;
    });
    return saved;
  };

  ApplyOS.updateContactActivity = async function updateContactActivity(id, patch = {}) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const index = state.contact_activities.findIndex((item) => item.id === id);
      if (index < 0) return state;
      updated = normalizeContactActivity({ ...state.contact_activities[index], ...patch, id, updated_at: ApplyOS.nowISO() });
      state.contact_activities[index] = updated;
      return state;
    });
    return updated;
  };

  ApplyOS.deleteContactActivity = async function deleteContactActivity(id) {
    return ApplyOS.mutateState((state) => {
      const deleted = state.contact_activities.find((item) => item.id === id);
      state.contact_activities = state.contact_activities.filter((item) => item.id !== id);
      if (deleted) {
        const contact = state.contacts.find((item) => item.id === deleted.contact_id);
        const latest = state.contact_activities.filter((item) => item.contact_id === deleted.contact_id)
          .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())[0];
        if (contact) contact.last_contacted_at = latest?.occurred_at || null;
      }
      return state;
    });
  };

  ApplyOS.mergeContacts = async function mergeContacts(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    let merged = null;
    await ApplyOS.mutateState((state) => {
      const source = state.contacts.find((item) => item.id === sourceId);
      const target = state.contacts.find((item) => item.id === targetId);
      if (!source || !target) return state;
      const now = ApplyOS.nowISO();
      merged = normalizeContact({
        ...source,
        ...target,
        id: target.id,
        name: target.name || source.name,
        email: target.email || source.email,
        phone: target.phone || source.phone,
        linkedin_url: target.linkedin_url || source.linkedin_url,
        title: target.title || source.title,
        company: target.company || source.company,
        notes: [target.notes, source.notes].filter(Boolean).join("\n\n"),
        tags: [...new Set([...(target.tags || []), ...(source.tags || [])])],
        application_ids: [...new Set([...(target.application_ids || []), ...(source.application_ids || [])])],
        last_contacted_at: newestDate(target.last_contacted_at, source.last_contacted_at),
        created_at: [target.created_at, source.created_at].filter(Boolean).sort()[0] || now,
        updated_at: now
      });
      state.contacts = state.contacts.filter((item) => item.id !== sourceId).map((item) => item.id === targetId ? merged : item);
      state.interviews = state.interviews.map((item) => ({ ...item, interviewer_contact_ids: [...new Set(item.interviewer_contact_ids.map((id) => id === sourceId ? targetId : id))] }));
      state.reminders = state.reminders.map((item) => item.contact_id === sourceId ? { ...item, contact_id: targetId, updated_at: now } : item);
      state.contact_activities = state.contact_activities.map((item) => item.contact_id === sourceId ? { ...item, contact_id: targetId, updated_at: now } : item);
      return state;
    });
    return merged;
  };

  ApplyOS.deleteContact = async function deleteContact(id) {
    return ApplyOS.mutateState((state) => {
      state.contacts = state.contacts.filter((item) => item.id !== id);
      state.interviews = state.interviews.map((item) => ({ ...item, interviewer_contact_ids: item.interviewer_contact_ids.filter((contactId) => contactId !== id) }));
      state.contact_activities = state.contact_activities.filter((item) => item.contact_id !== id);
      state.reminders = state.reminders.flatMap((item) => {
        if (item.contact_id !== id) return [item];
        if (item.kind === "contact_follow_up") return [];
        return [{ ...item, contact_id: null, updated_at: ApplyOS.nowISO() }];
      });
      const now = ApplyOS.nowISO();
      state.waiting_items = state.waiting_items.map((item) => {
        if (item.contact_id !== id) return item;
        const next = { ...item, contact_id: null, updated_at: now };
        if (!next.application_id && next.status === "open") return { ...next, status: "resolved", resolved_at: now };
        return next;
      });
      return state;
    });
  };

  ApplyOS.upsertInterview = async function upsertInterview(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      const index = state.interviews.findIndex((item) => item.id === input.id);
      const current = index >= 0 ? state.interviews[index] : { id: ApplyOS.uid("interview"), created_at: now };
      saved = normalizeInterview({ ...current, ...input, id: current.id, updated_at: now });
      if (index >= 0) state.interviews[index] = saved;
      else state.interviews.unshift(saved);
      const existingThankYou = state.reminders.find((item) => item.interview_id === saved.id && item.kind === "interview_thank_you" && item.status === "open");
      if (saved.create_thank_you_action && saved.next_action_at) {
        const action = normalizeReminder({
          ...(existingThankYou || {}),
          id: existingThankYou?.id || ApplyOS.uid("rem"),
          kind: "interview_thank_you",
          title: saved.next_action || "Send interview thank-you",
          status: "open",
          due_at: saved.next_action_at,
          priority: "high",
          channel: "email",
          application_id: saved.application_id,
          contact_id: saved.interviewer_contact_ids[0] || null,
          interview_id: saved.id,
          source: "system",
          created_at: existingThankYou?.created_at || now,
          updated_at: now
        });
        if (existingThankYou) state.reminders[state.reminders.indexOf(existingThankYou)] = action;
        else state.reminders.unshift(action);
      } else cancelActionRecord(existingThankYou, now);
      const existingPrep = state.reminders.find((item) => item.interview_id === saved.id && item.kind === "interview_prep" && item.status === "open");
      if (saved.create_preparation_action && saved.scheduled_at) {
        const due = saved.preparation_action_at || new Date(new Date(saved.scheduled_at).getTime() - 86400000).toISOString();
        saved.preparation_action_at = due;
        state.interviews[state.interviews.findIndex((item) => item.id === saved.id)] = saved;
        const prep = normalizeReminder({
          ...(existingPrep || {}),
          id: existingPrep?.id || ApplyOS.uid("rem"),
          kind: "interview_prep",
          title: `Prepare for ${String(saved.type).replace(/_/g, " ")} interview`,
          status: "open",
          due_at: due,
          priority: "high",
          channel: "meeting",
          application_id: saved.application_id,
          contact_id: saved.interviewer_contact_ids[0] || null,
          interview_id: saved.id,
          source: "system",
          created_at: existingPrep?.created_at || now,
          updated_at: now
        });
        if (existingPrep) state.reminders[state.reminders.indexOf(existingPrep)] = prep;
        else state.reminders.unshift(prep);
      } else cancelActionRecord(existingPrep, now);
      if (saved.application_id) {
        const application = state.applications.find((item) => item.id === saved.application_id);
        if (application && !["offer", "rejected", "closed"].includes(application.status)) {
          application.status = "interview";
          application.updated_at = now;
        }
      }
      return state;
    });
    return saved;
  };

  ApplyOS.deleteInterview = async function deleteInterview(id) {
    return ApplyOS.mutateState((state) => {
      const interview = state.interviews.find((item) => item.id === id);
      if (!interview) return state;
      const application = state.applications.find((item) => item.id === interview.application_id);
      const now = ApplyOS.nowISO();
      state.interviews = state.interviews.filter((item) => item.id !== id);
      state.reminders = state.reminders.map((item) => {
        if (item.interview_id !== id) return item;
        return {
          ...item,
          status: item.status === "open" ? "cancelled" : item.status,
          interview_id: null,
          context_snapshot: {
            ...item.context_snapshot,
            ...(application ? { company: application.company, role: application.role } : {}),
            interview_type: interview.type
          },
          updated_at: now
        };
      });
      state.contact_activities = state.contact_activities.map((item) => item.interview_id === id ? { ...item, interview_id: null, updated_at: now } : item);
      reconcileApplicationFollowUpStatus(state, interview.application_id, now);
      return state;
    });
  };

  ApplyOS.seedMockData = async function seedMockData() {
    const now = new Date();
    const samples = [
      ["Northstar Labs", "Frontend Engineer", "saved", "high", 6, 82],
      ["Acme Cloud", "Platform Engineer", "preparing", "medium", 12, 74],
      ["Orbit AI", "ML Engineer", "applied", "high", 20, 88],
      ["Paper Street", "Product Engineer", "interview", "high", 4, 79],
      ["Greenroom", "Software Engineer", "rejected", "low", -4, 68]
    ];
    return ApplyOS.mutateState((state) => {
      if (state.applications.some((item) => item.source === "demo")) return state;
      samples.forEach(([company, role, status, priority, deadlineDays, score], index) => {
        const created = ApplyOS.addDays(now, -index * 3);
        const id = ApplyOS.uid("demo");
        state.applications.push({
          id, company, role, url: `https://example.com/jobs/${index + 1}`, source: "demo", description: "Sample application for dashboard testing.",
          status: String(status), priority: String(priority), deadline: ApplyOS.addDays(now, Number(deadlineDays)), applied_at: ["applied", "interview", "rejected"].includes(String(status)) ? created : null,
          follow_up_date: status === "applied" ? ApplyOS.addDays(now, 2) : null, resume_version_id: null, notes: "Mock record — safe to edit or delete.",
          match_score: score, matched_skills: ["javascript", "sql"], missing_skills: ["kubernetes"], suggested_keywords: ["kubernetes"],
          created_at: created, updated_at: created, captured_at: created, location: "Remote", extraction_confidence: { overall: 1 }
        });
        if (status === "applied") state.reminders.push({ id: ApplyOS.uid("rem"), application_id: id, contact_id: null, interview_id: null, kind: "application_follow_up", type: "follow_up", title: `Follow up on ${role} at ${company}`, status: "open", due_at: ApplyOS.addDays(now, 2), snoozed_until: null, priority, channel: "email", notes: "", source: "system", completed_at: null, last_notified_at: null, created_at: created, updated_at: created });
        if (status === "interview") {
          const contactId = ApplyOS.uid("contact");
          state.contacts.push({ id: contactId, name: "Morgan Recruiter", title: "Talent Partner", company, email: "morgan@example.com", phone: "", linkedin_url: "", preferred_channel: "email", tags: ["demo"], relationship: "recruiter", application_ids: [id], notes: "Mock contact — safe to edit or delete.", last_contacted_at: null, next_action_at: ApplyOS.addDays(now, 1), created_at: created, updated_at: created });
          state.interviews.push({ id: ApplyOS.uid("interview"), application_id: id, type: "technical", format: "video", scheduled_at: ApplyOS.addDays(now, 3), location: "", meeting_url: "https://example.com/mock-meeting", interviewer_contact_ids: [contactId], company_research: "Review the product and engineering blog.", preparation_notes: "Prepare two system-design stories.", question_notes: "", next_action: "Send thank-you note", next_action_at: ApplyOS.addDays(now, 4), completed_at: null, created_at: created, updated_at: created });
        }
      });
      return state;
    });
  };
})(globalThis);
