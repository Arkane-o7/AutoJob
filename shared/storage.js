(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};

  function emptyState() {
    return {
      schema_version: ApplyOS.SCHEMA_VERSION,
      applications: [],
      reminders: [],
      answer_memory: [],
      learned_answers: [],
      resume_versions: [],
      settings: { final_follow_up_enabled: true, notification_enabled: true },
      migrated_at: ApplyOS.nowISO()
    };
  }

  function normalizeState(input) {
    const state = { ...emptyState(), ...(input || {}) };
    state.schema_version = ApplyOS.SCHEMA_VERSION;
    state.applications = Array.isArray(state.applications) ? state.applications : [];
    state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
    state.answer_memory = Array.isArray(state.answer_memory) ? state.answer_memory : [];
    state.learned_answers = Array.isArray(state.learned_answers) ? state.learned_answers : [];
    state.resume_versions = Array.isArray(state.resume_versions) ? state.resume_versions : [];
    state.settings = { ...emptyState().settings, ...(state.settings || {}) };
    return state;
  }

  async function readRaw() {
    return chrome.storage.local.get([ApplyOS.STORAGE_KEY, ApplyOS.PROFILE_KEY]);
  }

  async function writeState(state) {
    const normalized = normalizeState(state);
    await chrome.storage.local.set({ [ApplyOS.STORAGE_KEY]: normalized });
    return normalized;
  }

  function answerFromLegacy(item) {
    return {
      id: ApplyOS.uid("ans"),
      question: String(item.question || "").trim(),
      answer: String(item.answer || "").trim(),
      normalized_question: ApplyOS.normalizeQuestion(item.question),
      source: "profile",
      use_count: 0,
      created_at: ApplyOS.nowISO(),
      updated_at: ApplyOS.nowISO()
    };
  }

  ApplyOS.ensureState = async function ensureState() {
    await ApplyOS.ensureProfiles?.();
    const raw = await readRaw();
    if (raw[ApplyOS.STORAGE_KEY]) {
      const normalized = normalizeState(raw[ApplyOS.STORAGE_KEY]);
      if (raw[ApplyOS.STORAGE_KEY].schema_version !== ApplyOS.SCHEMA_VERSION) return writeState(normalized);
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
  };

  ApplyOS.getState = async function getState() {
    return ApplyOS.ensureState();
  };

  ApplyOS.mutateState = async function mutateState(mutator) {
    const state = await ApplyOS.ensureState();
    const next = (await mutator(structuredClone(state))) || state;
    return writeState(next);
  };

  ApplyOS.getApplicationByUrl = async function getApplicationByUrl(url) {
    const state = await ApplyOS.ensureState();
    const canonical = ApplyOS.canonicalizeUrl(url);
    return state.applications.find((item) => ApplyOS.canonicalizeUrl(item.url) === canonical) || null;
  };

  ApplyOS.upsertApplication = async function upsertApplication(job, profile = {}) {
    let saved = null;
    await ApplyOS.mutateState((state) => {
      const canonical = ApplyOS.canonicalizeUrl(job.url);
      const existing = state.applications.find((item) => ApplyOS.canonicalizeUrl(item.url) === canonical);
      const match = ApplyOS.calculateMatch?.(job.description || existing?.description || "", profile) || { score: 0, matchedSkills: [], missingSkills: [], suggestedKeywords: [] };
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
        match_score: match.score,
        matched_skills: match.matchedSkills,
        missing_skills: match.missingSkills,
        suggested_keywords: match.suggestedKeywords,
        suggested_experiences: match.suggestedExperiences,
        suggested_answers: match.suggestedAnswers,
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
    return ApplyOS.mutateState((state) => {
      state.reminders = state.reminders.map((item) => item.id === id ? { ...item, completed_at: ApplyOS.nowISO() } : item);
      return state;
    });
  };

  ApplyOS.rescheduleFollowUp = async function rescheduleFollowUp(applicationId, dueAt) {
    let updated = null;
    await ApplyOS.mutateState((state) => {
      const application = state.applications.find((item) => item.id === applicationId);
      if (!application) return state;
      const reminder = state.reminders
        .filter((item) => item.application_id === applicationId && item.type === "follow_up" && !item.completed_at)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
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

  ApplyOS.syncAnswerMemory = async function syncAnswerMemory(items = []) {
    return ApplyOS.mutateState((state) => {
      items.filter((item) => item.question && item.answer).forEach((item) => {
        const normalized = ApplyOS.normalizeQuestion(item.question);
        const existing = state.answer_memory.find((answer) => answer.normalized_question === normalized);
        if (existing) {
          existing.answer = item.answer;
          existing.updated_at = ApplyOS.nowISO();
        } else {
          state.answer_memory.push(answerFromLegacy(item));
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
    return ApplyOS.syncAnswerMemory(items);
  };

  ApplyOS.findRememberedAnswer = async function findRememberedAnswer(question) {
    const state = await ApplyOS.ensureState();
    let best = null;
    for (const item of state.answer_memory) {
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
        .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
        .slice(0, 500);
      return state;
    });
    return learned;
  };

  ApplyOS.syncResumeVersion = async function syncResumeVersion(resume) {
    if (!resume?.name) return null;
    let current = null;
    await ApplyOS.mutateState((state) => {
      state.resume_versions = state.resume_versions.map((item) => ({ ...item, is_current: false }));
      current = state.resume_versions.find((item) => item.name === resume.name && item.size === resume.size);
      if (current) current.is_current = true;
      else {
        current = { id: ApplyOS.uid("resume"), name: resume.name, type: resume.type || "", size: resume.size || 0, created_at: ApplyOS.nowISO(), is_current: true };
        state.resume_versions.push(current);
      }
      return state;
    });
    return current;
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
          status, priority, deadline: ApplyOS.addDays(now, deadlineDays), applied_at: ["applied", "interview", "rejected"].includes(status) ? created : null,
          follow_up_date: status === "applied" ? ApplyOS.addDays(now, 2) : null, resume_version_id: null, notes: "Mock record — safe to edit or delete.",
          match_score: score, matched_skills: ["javascript", "sql"], missing_skills: ["kubernetes"], suggested_keywords: ["kubernetes"],
          created_at: created, updated_at: created, captured_at: created, location: "Remote", extraction_confidence: { overall: 1 }
        });
        if (status === "applied") state.reminders.push({ id: ApplyOS.uid("rem"), application_id: id, type: "follow_up", due_at: ApplyOS.addDays(now, 2), completed_at: null, created_at: created });
      });
      return state;
    });
  };
})(globalThis);
