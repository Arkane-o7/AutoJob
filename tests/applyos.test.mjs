import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

async function runtime(seed = {}) {
  const data = structuredClone(seed);
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
      }
    }
  };
  const context = vm.createContext({ chrome, crypto: webcrypto, structuredClone, URL, URLSearchParams, Date, Math, console, globalThis: null });
  context.globalThis = context;
  for (const file of ["shared/constants.js", "shared/matching.js", "shared/offlyn-core.js", "shared/ats-compat.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/graph.js", "shared/agent.js", "shared/storage.js"]) {
    vm.runInContext(await readFile(resolve(file), "utf8"), context, { filename: file });
  }
  return { ApplyOS: context.ApplyOS, data };
}

test("migrates legacy profile without removing it", async () => {
  const profile = { firstName: "Ada", customAnswers: [{ question: "Why this role?", answer: "I enjoy systems work." }], resume: { name: "ada.pdf", size: 42 } };
  const { ApplyOS, data } = await runtime({ profile });
  const state = await ApplyOS.ensureState();
  assert.equal(data.profile.firstName, "Ada");
  assert.equal(state.answer_memory[0].answer, "I enjoy systems work.");
  assert.equal(state.resume_versions[0].name, "ada.pdf");
});

test("migrates a v2 state to v3 without losing applications or the legacy profile", async () => {
  const profile = { firstName: "Ada", email: "ada@example.com" };
  const application = {
    id: "app_existing",
    company: "Analytical Engines",
    role: "Programmer",
    url: "https://example.com/jobs/1",
    source: "example.com",
    description: "Build an engine",
    status: "preparing",
    priority: "high",
    deadline: null,
    applied_at: null,
    follow_up_date: null,
    resume_version_id: null,
    notes: "Keep this note",
    match_score: 88,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z"
  };
  const { ApplyOS, data } = await runtime({
    profile,
    applyos_state: {
      schema_version: 2,
      applications: [application],
      reminders: [],
      answer_memory: [],
      learned_answers: [],
      resume_versions: [],
      settings: { final_follow_up_enabled: true, notification_enabled: true },
      migrated_at: "2026-07-01T00:00:00.000Z"
    }
  });

  const state = await ApplyOS.ensureState();
  assert.equal(state.schema_version, 3);
  assert.equal(state.revision, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].id, "app_existing");
  assert.equal(state.applications[0].notes, "Keep this note");
  assert.equal(JSON.stringify(state.migration_history.map(({ from_version, to_version }) => [from_version, to_version])), JSON.stringify([[2, 3]]));
  assert.equal(data.profile.email, "ada@example.com");
});

test("state migration is idempotent and does not increment the mutation revision", async () => {
  const { ApplyOS, data } = await runtime({
    applyos_state: {
      schema_version: 2,
      applications: [],
      reminders: [],
      answer_memory: [],
      learned_answers: [],
      resume_versions: [],
      settings: {},
      migrated_at: "2026-07-01T00:00:00.000Z"
    }
  });
  const first = await ApplyOS.ensureState();
  const storedAfterFirstRead = structuredClone(data.applyos_state);
  const second = await ApplyOS.ensureState();

  assert.equal(first.revision, 0);
  assert.equal(second.revision, 0);
  assert.equal(second.migration_history.length, 1);
  assert.deepEqual(data.applyos_state, storedAfterFirstRead);
});

test("normalizes corrupt collections and unsafe entity fields into runtime-safe shapes", async () => {
  const { ApplyOS } = await runtime({
    applyos_state: {
      schema_version: 3,
      revision: "invalid",
      migration_history: "invalid",
      applications: [null, "invalid", { id: "app_safe", company: 42, role: null, status: "made_up", priority: "urgent", match_score: Infinity }],
      reminders: { not: "an array" },
      answer_memory: [false, { id: "answer_safe", question: 4, answer: null, use_count: -3 }],
      learned_answers: ["invalid", { id: "learned_safe", question: null, fingerprint: 7, use_count: "many" }],
      resume_versions: [undefined, { id: "resume_safe", name: 9, size: -10 }],
      settings: "invalid",
      migrated_at: "not-a-date"
    }
  });
  const state = await ApplyOS.ensureState();

  assert.equal(state.revision, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].company, "Unknown company");
  assert.equal(state.applications[0].role, "Untitled role");
  assert.equal(state.applications[0].status, "saved");
  assert.equal(state.applications[0].priority, "medium");
  assert.equal(state.applications[0].match_score, 0);
  assert.equal(state.reminders.length, 0);
  assert.equal(state.answer_memory[0].question, "");
  assert.equal(state.answer_memory[0].answer, "");
  assert.equal(state.learned_answers[0].fingerprint, "");
  assert.equal(state.resume_versions[0].name, "");
  assert.equal(state.resume_versions[0].size, 0);
  assert.equal(state.settings.final_follow_up_enabled, true);
  assert.equal(state.settings.notification_enabled, true);
});

test("serializes overlapping async mutations without losing updates", async () => {
  const { ApplyOS } = await runtime();
  const addApplication = (id, company) => ({
    id,
    company,
    role: "Engineer",
    url: `https://example.com/${id}`,
    source: "test",
    description: "",
    status: "saved",
    priority: "medium",
    deadline: null,
    applied_at: null,
    follow_up_date: null,
    resume_version_id: null,
    notes: "",
    match_score: 0,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z"
  });

  await Promise.all([
    ApplyOS.mutateState(async (state) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      state.applications.push(addApplication("first", "First"));
      return state;
    }),
    ApplyOS.mutateState(async (state) => {
      state.applications.push(addApplication("second", "Second"));
      return state;
    })
  ]);

  const state = await ApplyOS.getState();
  assert.deepEqual(new Set(state.applications.map((item) => item.id)), new Set(["first", "second"]));
  assert.equal(state.revision, 2);
  assert.equal((await ApplyOS.getState()).revision, 2);

  await assert.rejects(ApplyOS.mutateState(async () => {
    throw new Error("intentional mutation failure");
  }), /intentional mutation failure/);
  assert.equal((await ApplyOS.getState()).revision, 2);
});

test("calculates local skill matches and missing skills", async () => {
  const { ApplyOS } = await runtime();
  const match = ApplyOS.calculateMatch("Build React and TypeScript services on AWS with Kubernetes.", { jobDescription: "Built React TypeScript apps on AWS." });
  assert.ok(match.score > 50);
  assert.deepEqual([...match.matchedSkills], ["typescript", "react", "aws"]);
  assert.ok(match.missingSkills.includes("kubernetes"));
});

test("marking applied creates editable 7 and 14 day follow-ups", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/job", source: "example.com", description: "JavaScript" });
  const appliedAt = "2026-07-14T12:00:00.000Z";
  const applied = await ApplyOS.markApplicationApplied(application.id, appliedAt);
  const state = await ApplyOS.getState();
  assert.equal(applied.status, "applied");
  assert.equal(state.reminders.length, 2);
  assert.equal(state.reminders[0].due_at.slice(0, 10), "2026-07-21");
  assert.equal(state.reminders[1].due_at.slice(0, 10), "2026-07-28");
  await ApplyOS.rescheduleFollowUp(application.id, "2026-07-23");
  assert.equal((await ApplyOS.getState()).applications[0].follow_up_date.slice(0, 10), "2026-07-23");
});

test("answer memory uses similar question phrasing", async () => {
  const { ApplyOS } = await runtime();
  await ApplyOS.syncAnswerMemory([{ question: "Why do you want this role?", answer: "It matches my platform background." }]);
  const answer = await ApplyOS.findRememberedAnswer("Why do you want this role");
  assert.equal(answer.answer, "It matches my platform background.");
});

test("Offlyn-derived classifier recognizes ATS fields and keeps sensitive answers manual", async () => {
  const { ApplyOS } = await runtime();
  assert.equal(ApplyOS.OfflynCore.platformForHost("copart.wd12.myworkdayjobs.com"), "workday");
  assert.equal(ApplyOS.OfflynCore.isJobUrl("https://example.com/careers/engineering/software-intern"), true);
  const authorization = ApplyOS.OfflynCore.classifyField("Are you legally permitted to work in this country?", "select-one", "workAuth");
  assert.equal(authorization.canonicalField, "workAuthorization");
  assert.equal(authorization.shouldAutofill, true);
  const demographic = ApplyOS.OfflynCore.classifyField("What is your race or ethnicity?", "select-one", "race");
  assert.equal(demographic.shouldAutofill, false);
});

test("stores corrections and reuses the best site-aware learned answer", async () => {
  const { ApplyOS } = await runtime();
  const learned = await ApplyOS.rememberCorrection({
    fingerprint: "workday|yearsExperience|number|experience|years handling data",
    question: "How many years have you handled large datasets?",
    answer: "4",
    canonical_field: "yearsExperience",
    field_type: "number",
    site: "example.myworkdayjobs.com"
  });
  assert.equal(learned.answer, "4");
  const state = await ApplyOS.getState();
  assert.equal(state.schema_version, 3);
  assert.equal(state.learned_answers.length, 1);
  const match = ApplyOS.OfflynCore.bestLearnedAnswer("How many years have you handled large datasets", state.learned_answers, {
    site: "example.myworkdayjobs.com",
    fieldType: "number"
  });
  assert.equal(match.answer, "4");
});

test("follow-up generation produces a draft but no send action", async () => {
  const { ApplyOS } = await runtime();
  const draft = ApplyOS.generateFollowUpDraft({ company: "Acme", role: "Engineer", matched_skills: ["typescript"] }, { firstName: "Ada", lastName: "Lovelace" });
  assert.match(draft.subject, /Engineer at Acme/);
  assert.match(draft.body, /Ada Lovelace/);
  assert.equal(typeof ApplyOS.sendFollowUp, "undefined");
});

test("migrates the legacy profile into a switchable active profile", async () => {
  const { ApplyOS, data } = await runtime({ profile: { firstName: "Grace", lastName: "Hopper" } });
  const index = await ApplyOS.ensureProfiles();
  assert.equal(index.activeId, "default");
  assert.equal((await ApplyOS.getActiveProfile()).firstName, "Grace");
  const created = await ApplyOS.createProfile("Platform roles", "Platform Engineer", "default");
  assert.equal(data.profilesIndex.activeId, created.id);
  assert.equal((await ApplyOS.getActiveProfile()).lastName, "Hopper");
});

test("knowledge graph learns corrections and reinforces a reusable answer", async () => {
  const { ApplyOS } = await runtime();
  await ApplyOS.recordGraphCorrection({ question: "How many years of TypeScript experience do you have?", correctedValue: "5", canonicalField: "yearsExperience", fingerprint: "typescript-years", platform: "workday" });
  const answer = await ApplyOS.bestGraphAnswer("Years of experience with TypeScript", { canonicalField: "yearsExperience", platform: "workday" });
  assert.equal(answer.answer, "5");
  const stats = await ApplyOS.graphStats();
  assert.equal(stats.corrections, 1);
  assert.equal(stats.learnedPatterns, 1);
});

test("browser agent rejects submit, consent, and sensitive actions", async () => {
  const { ApplyOS } = await runtime();
  const plan = ApplyOS.validateAgentPlan({ actions: [
    { action: "fill", fieldId: "name", label: "Full name", value: "Ada Lovelace", confidence: 0.99 },
    { action: "fill", fieldId: "ssn", label: "Social Security Number", value: "123", confidence: 0.99 },
    { action: "fill", fieldId: "submit", label: "Submit application", value: "click", confidence: 0.99 },
    { action: "check", fieldId: "terms", label: "I agree to terms", value: "yes", confidence: 0.99 }
  ] });
  assert.deepEqual([...plan.actions.map((action) => action.fieldId)], ["name"]);
  assert.equal(plan.reviewRequired, true);
  assert.equal(plan.blockedActions, 3);
});

test("the full Workday port has no automatic step navigation or submit action", async () => {
  const source = await readFile(resolve("shared/workday.js"), "utf8");
  assert.ok(source.split("\n").length > 1000);
  assert.doesNotMatch(source, /function clickSaveAndContinue/);
  assert.doesNotMatch(source, /bottom-navigation-next-button/);
  assert.match(source, /ApplyOS\.Workday/);
});

test("Smart Drafts work without Ollama or any model setup", async () => {
  const { ApplyOS } = await runtime();
  const profile = { firstName: "Ada", lastName: "Lovelace", currentTitle: "Software Engineer", currentCompany: "Engine Co", jobDescription: "Built TypeScript services and React interfaces." };
  const application = { role: "Product Engineer", company: "Acme", description: "We need React and TypeScript experience." };
  const cover = await ApplyOS.generateAICoverLetter(application, profile);
  const focus = await ApplyOS.tailorResumeWithAI(application, profile);
  const gap = await ApplyOS.analyzeKeywordGapWithAI(application, profile);
  assert.equal(cover.provider, "applyos-smart");
  assert.match(cover.text, /Product Engineer/);
  assert.equal(focus.provider, "applyos-smart");
  assert.match(focus.tailoredResume, /RESUME FOCUS PLAN/);
  assert.ok(gap.present.includes("typescript"));
});

test("resume attachment handles unlabeled React dropzones without repeated attachment", async () => {
  const source = await readFile(resolve("content.js"), "utf8");
  const fixture = await readFile(resolve("demo/site-regressions.html"), "utf8");
  assert.match(fixture, /accept="\.pdf,\.doc,\.docx"/);
  assert.match(source, /function fileInputContext/);
  assert.match(source, /Object\.getOwnPropertyDescriptor\(HTMLInputElement\.prototype, "files"\)/);
  assert.match(source, /applyosResumeAttached/);
  assert.match(source, /resumeStatus === "failed"/);
  assert.doesNotMatch(source, /attributeFilter: \["class"/);
  const optionsSource = await readFile(resolve("options.js"), "utf8");
  assert.match(optionsSource, /File contents are missing from this older profile/);
});

test("major ATS compatibility registry recognizes hosted application domains", async () => {
  const { ApplyOS } = await runtime();
  const cases = {
    "boards.greenhouse.io": "greenhouse",
    "jobs.lever.co": "lever",
    "jobs.ashbyhq.com": "ashby",
    "jobs.smartrecruiters.com": "smartrecruiters",
    "careers.icims.com": "icims",
    "example.taleo.net": "oracle",
    "apply.workable.com": "workable",
    "jobs.jobvite.com": "jobvite",
    "career5.successfactors.eu": "successfactors",
    "company.bamboohr.com": "bamboohr",
    "company.recruitee.com": "recruitee",
    "jobs.teamtailor.com": "teamtailor",
    "company.personio.de": "personio"
  };
  for (const [host, expected] of Object.entries(cases)) {
    assert.equal(ApplyOS.ATSCompat.platformForHost(host), expected, host);
  }
});

test("ATS adapters add controls without adding submission or navigation actions", async () => {
  const source = await readFile(resolve("shared/ats-compat.js"), "utf8");
  const captureSource = await readFile(resolve("capture.js"), "utf8");
  const fixture = await readFile(resolve("demo/ats-fixtures.html"), "utf8");
  const notices = await readFile(resolve("THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(source, /select2-container/);
  assert.match(source, /select__option/);
  assert.match(source, /notifyFileAttached/);
  assert.match(captureSource, /smartrecruiters:/);
  assert.match(captureSource, /successfactors:/);
  assert.match(captureSource, /teamtailor:/);
  assert.doesNotMatch(source, /requestSubmit|\.submit\s*\(/);
  assert.doesNotMatch(source, /save.and.continue|next.button/i);
  assert.match(fixture, /Greenhouse legacy and React controls/);
  assert.match(notices, /Job App Filler/);
  assert.match(notices, /BSD 3-Clause/);
});
