(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const STORAGE_LOCK_NAME = "applyos-state-write";
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
    4: (state) => recordMigration({ ...state }, 4, 5)
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
    return {
      ...item,
      id: safeId(item.id, "rem"),
      application_id: safeString(item.application_id),
      type: item.type === "final_follow_up" ? "final_follow_up" : "follow_up",
      due_at: safeDateString(item.due_at, now),
      completed_at: safeNullableString(item.completed_at),
      created_at: safeDateString(item.created_at, now)
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
      email: safeString(item.email),
      linkedin_url: safeWebUrl(item.linkedin_url),
      relationship: ApplyOS.CONTACT_RELATIONSHIPS.includes(item.relationship) ? item.relationship : "other",
      application_ids: [...new Set(safeStringArray(item.application_ids).filter(Boolean))],
      notes: safeString(item.notes),
      last_contacted_at: safeNullableDate(item.last_contacted_at),
      next_action_at: safeNullableDate(item.next_action_at),
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
      interviews: [],
      settings: { final_follow_up_enabled: true, notification_enabled: true },
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
    state.interviews = (Array.isArray(state.interviews) ? state.interviews : []).map(normalizeInterview).filter(Boolean);
    const applicationIds = new Set(state.applications.map((item) => item.id));
    const resumeIds = new Set(state.resume_versions.map((item) => item.id));
    state.applications = state.applications.map((item) => ({ ...item, resume_version_id: resumeIds.has(item.resume_version_id) ? item.resume_version_id : null }));
    state.reminders = state.reminders.filter((item) => applicationIds.has(item.application_id));
    state.contacts = state.contacts.map((item) => ({ ...item, application_ids: item.application_ids.filter((id) => applicationIds.has(id)) }));
    const contactIds = new Set(state.contacts.map((item) => item.id));
    state.interviews = state.interviews
      .filter((item) => applicationIds.has(item.application_id))
      .map((item) => ({ ...item, interviewer_contact_ids: item.interviewer_contact_ids.filter((id) => contactIds.has(id)) }));
    state.settings = { ...emptyState().settings, ...(isRecord(state.settings) ? state.settings : {}) };
    state.settings.final_follow_up_enabled = state.settings.final_follow_up_enabled !== false;
    state.settings.notification_enabled = state.settings.notification_enabled !== false;
    state.migrated_at = safeDateString(state.migrated_at, ApplyOS.nowISO());
    return state;
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
      saved = {
        ...base,
        company: job.company || base.company || "Unknown company",
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
      updated = { ...state.applications[index], ...patch, id, updated_at: ApplyOS.nowISO() };
      state.applications[index] = updated;
      if (["offer", "rejected", "closed"].includes(updated.status)) {
        state.reminders = state.reminders.map((item) => item.application_id === id && !item.completed_at ? { ...item, completed_at: ApplyOS.nowISO() } : item);
      }
      return state;
    });
    return updated;
  };

  ApplyOS.deleteApplication = async function deleteApplication(id) {
    const state = await ApplyOS.mutateState((draft) => {
      if (!draft.applications.some((item) => item.id === id)) return draft;
      draft.applications = draft.applications.filter((item) => item.id !== id);
      draft.reminders = draft.reminders.filter((item) => item.application_id !== id);
      draft.interviews = draft.interviews.filter((item) => item.application_id !== id);
      draft.contacts = draft.contacts.map((item) => ({
        ...item,
        application_ids: item.application_ids.filter((applicationId) => applicationId !== id)
      }));
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
      const reminders = ApplyOS.buildFollowUpReminders(application, appliedAt);
      state.reminders = state.reminders.filter((item) => item.application_id !== id || item.completed_at).concat(
        state.settings.final_follow_up_enabled === false ? reminders.slice(0, 1) : reminders
      );
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
      const dueIds = new Set(state.reminders.filter((item) => !item.completed_at && new Date(item.due_at).getTime() <= now).map((item) => item.application_id));
      state.applications = state.applications.map((item) => dueIds.has(item.id) && item.status === "applied"
        ? { ...item, status: "follow_up_due", updated_at: ApplyOS.nowISO() }
        : item);
      return state;
    });
  };

  ApplyOS.completeReminder = async function completeReminder(id) {
    let applicationId = null;
    const state = await ApplyOS.mutateState((draft) => {
      const reminder = draft.reminders.find((item) => item.id === id && !item.completed_at);
      if (!reminder) return draft;
      applicationId = reminder.application_id;
      reminder.completed_at = ApplyOS.nowISO();
      const application = draft.applications.find((item) => item.id === applicationId);
      const hasDueReminder = draft.reminders.some((item) => item.application_id === applicationId && !item.completed_at && new Date(item.due_at).getTime() <= Date.now());
      if (application?.status === "follow_up_due" && !hasDueReminder) {
        application.status = "applied";
        application.updated_at = ApplyOS.nowISO();
      }
      const next = draft.reminders
        .filter((item) => item.application_id === applicationId && !item.completed_at)
        .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime())[0];
      if (application) application.follow_up_date = next?.due_at || null;
      return draft;
    });
    return { state, application_id: applicationId };
  };

  ApplyOS.rescheduleFollowUp = async function rescheduleFollowUp(applicationId, dueAt) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const application = state.applications.find((item) => item.id === applicationId);
      if (!application) return state;
      const reminder = state.reminders
        .filter((item) => item.application_id === applicationId && item.type === "follow_up" && !item.completed_at)
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
      const iso = dueAt ? new Date(`${String(dueAt).slice(0, 10)}T12:00:00`).toISOString() : null;
      if (reminder && iso) reminder.due_at = iso;
      else if (iso) state.reminders.push({ id: ApplyOS.uid("rem"), application_id: applicationId, type: "follow_up", due_at: iso, completed_at: null, created_at: ApplyOS.nowISO() });
      application.follow_up_date = iso;
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

  ApplyOS.upsertContact = async function upsertContact(input = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const now = ApplyOS.nowISO();
      const index = state.contacts.findIndex((item) => item.id === input.id);
      const current = index >= 0 ? state.contacts[index] : { id: ApplyOS.uid("contact"), created_at: now };
      saved = normalizeContact({ ...current, ...input, id: current.id, updated_at: now });
      if (index >= 0) state.contacts[index] = saved;
      else state.contacts.unshift(saved);
      return state;
    });
    return saved;
  };

  ApplyOS.deleteContact = async function deleteContact(id) {
    return ApplyOS.mutateState((state) => {
      state.contacts = state.contacts.filter((item) => item.id !== id);
      state.interviews = state.interviews.map((item) => ({ ...item, interviewer_contact_ids: item.interviewer_contact_ids.filter((contactId) => contactId !== id) }));
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
      state.interviews = state.interviews.filter((item) => item.id !== id);
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
        if (status === "applied") state.reminders.push({ id: ApplyOS.uid("rem"), application_id: id, type: "follow_up", due_at: ApplyOS.addDays(now, 2), completed_at: null, created_at: created });
        if (status === "interview") {
          const contactId = ApplyOS.uid("contact");
          state.contacts.push({ id: contactId, name: "Morgan Recruiter", title: "Talent Partner", company, email: "morgan@example.com", linkedin_url: "", relationship: "recruiter", application_ids: [id], notes: "Mock contact — safe to edit or delete.", last_contacted_at: null, next_action_at: ApplyOS.addDays(now, 1), created_at: created, updated_at: created });
          state.interviews.push({ id: ApplyOS.uid("interview"), application_id: id, type: "technical", format: "video", scheduled_at: ApplyOS.addDays(now, 3), location: "", meeting_url: "https://example.com/mock-meeting", interviewer_contact_ids: [contactId], company_research: "Review the product and engineering blog.", preparation_notes: "Prepare two system-design stories.", question_notes: "", next_action: "Send thank-you note", next_action_at: ApplyOS.addDays(now, 4), completed_at: null, created_at: created, updated_at: created });
        }
      });
      return state;
    });
  };
})(globalThis);
