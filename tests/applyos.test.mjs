import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

async function runtime(seed = {}) {
  const data = structuredClone(seed);
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
    }
  };
  chrome.runtime = { getManifest: () => ({ version: "test" }) };
  const context = vm.createContext({
    chrome, crypto: webcrypto, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder, Date, Math, console,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"), atob: (value) => Buffer.from(value, "base64").toString("binary"), globalThis: null
  });
  context.globalThis = context;
  for (const file of ["shared/constants.js", "shared/contact-import.js", "shared/matching.js", "shared/offlyn-core.js", "shared/ats-compat.js", "shared/followup.js", "shared/profiles.js", "shared/ai.js", "shared/graph.js", "shared/agent.js", "shared/storage.js", "shared/backup.js", "shared/resume-parser.js"]) {
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

test("migrates a v2 state through v8 without losing applications or the legacy profile", async () => {
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
  assert.equal(state.schema_version, 8);
  assert.equal(state.revision, 0);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].id, "app_existing");
  assert.equal(state.applications[0].notes, "Keep this note");
  assert.equal(JSON.stringify(state.migration_history.map(({ from_version, to_version }) => [from_version, to_version])), JSON.stringify([[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]));
  assert.equal(state.contacts.length, 0);
  assert.equal(state.interviews.length, 0);
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
  assert.equal(second.migration_history.length, 6);
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
  const match = ApplyOS.calculateMatch("Build React and TypeScript services on AWS with Kubernetes.", { resumeText: "Built React TypeScript apps on AWS." });
  assert.ok(match.score > 50);
  assert.deepEqual([...match.matchedSkills], ["typescript", "react", "aws"]);
  assert.ok(match.missingSkills.includes("kubernetes"));
  assert.equal(match.available, true);
  const missingDescription = ApplyOS.calculateMatch("", { resumeText: "React TypeScript AWS Kubernetes" });
  assert.equal(missingDescription.available, false);
  assert.equal(missingDescription.score, 0);
  const binaryOnly = ApplyOS.calculateMatch("Kubernetes", { resume: { dataUrl: "data:application/pdf;base64,a3ViZXJuZXRlcw==" } });
  assert.equal(binaryOnly.score, 0);
});

test("refreshes saved application matches after profile changes without rewriting unchanged scores", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({
    company: "Acme",
    role: "Engineer",
    url: "https://example.com/jobs/match-refresh",
    description: "Build React and TypeScript services on AWS with Kubernetes."
  }, { jobDescription: "Retail operations" });
  assert.equal(application.match_score, 0);
  const before = await ApplyOS.getState();
  const refreshed = await ApplyOS.refreshApplicationMatches({ resumeText: "Built React and TypeScript services on AWS with Kubernetes." });
  assert.equal(refreshed.count, 1);
  assert.ok(refreshed.applications[0].match_score >= 80);
  assert.ok(refreshed.applications[0].matched_skills.includes("kubernetes"));
  const after = await ApplyOS.getState();
  assert.equal(after.revision, before.revision + 1);
  const unchanged = await ApplyOS.refreshApplicationMatches({ resumeText: "Built React and TypeScript services on AWS with Kubernetes." });
  assert.equal(unchanged.count, 0);
  assert.equal((await ApplyOS.getState()).revision, after.revision);
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

test("schema v6 migrates application, contact, and interview next actions exactly once", async () => {
  const { ApplyOS, data } = await runtime({
    applyos_state: {
      schema_version: 5, revision: 2, migration_history: [],
      applications: [{ id: "app_v5", company: "Acme", role: "Engineer", url: "https://example.com/v5", source: "test", description: "", status: "applied", priority: "high", deadline: null, applied_at: "2026-07-01T00:00:00.000Z", follow_up_date: "2026-07-08T00:00:00.000Z", resume_version_id: null, notes: "", match_score: 0, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }],
      reminders: [{ id: "rem_v5", application_id: "app_v5", type: "follow_up", due_at: "2026-07-08T00:00:00.000Z", completed_at: null, created_at: "2026-07-01T00:00:00.000Z" }],
      contacts: [{ id: "contact_v5", name: "Riley", title: "Recruiter", company: "Acme", email: "riley@example.com", linkedin_url: "", relationship: "recruiter", application_ids: ["app_v5"], notes: "", last_contacted_at: null, next_action_at: "2026-07-09T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }],
      interviews: [{ id: "interview_v5", application_id: "app_v5", type: "technical", format: "video", scheduled_at: "2026-07-10T00:00:00.000Z", location: "", meeting_url: "", interviewer_contact_ids: ["contact_v5"], company_research: "", preparation_notes: "", question_notes: "", next_action: "Send thank-you", next_action_at: "2026-07-11T00:00:00.000Z", completed_at: null, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }],
      answer_memory: [], learned_answers: [], resume_versions: [], settings: { final_follow_up_enabled: true, notification_enabled: true }, migrated_at: "2026-07-01T00:00:00.000Z"
    }
  });
  const first = await ApplyOS.ensureState();
  assert.equal(first.schema_version, 8);
  assert.equal(first.reminders.filter((item) => item.kind === "application_follow_up").length, 1);
  assert.equal(first.reminders.filter((item) => item.kind === "contact_follow_up").length, 1);
  assert.equal(first.reminders.filter((item) => item.kind === "interview_thank_you").length, 1);
  assert.equal(JSON.stringify(first.settings.follow_up_offsets_days), JSON.stringify([7, 14]));
  const serialized = JSON.stringify(data.applyos_state);
  await ApplyOS.ensureState();
  assert.equal(JSON.stringify(data.applyos_state), serialized);
});

test("schema v7 company migration survives the v8 calendar upgrade and preserves display strings", async () => {
  const { ApplyOS } = await runtime({
    applyos_state: {
      schema_version: 6,
      revision: 4,
      migration_history: [],
      applications: [
        { id: "app_acme_a", company: "  Acme   Corp  ", role: "Engineer", url: "https://jobs.example/a", status: "saved" },
        { id: "app_acme_b", company: "acme corp", role: "Designer", url: "https://jobs.example/b", status: "saved" },
        { id: "app_acme_labs", company: "Acme Labs", role: "Analyst", url: "https://jobs.example/c", status: "saved" }
      ],
      contacts: [{ id: "contact_acme", name: "Riley", company: "ACME CORP", application_ids: [] }],
      reminders: [], contact_activities: [], interviews: [], answer_memory: [], learned_answers: [], resume_versions: [], settings: {}
    }
  });
  const state = await ApplyOS.ensureState();
  assert.equal(state.schema_version, 8);
  assert.equal(state.companies.length, 2);
  assert.equal(state.applications[0].company, "  Acme   Corp  ");
  assert.equal(state.applications[0].company_id, state.applications[1].company_id);
  assert.equal(state.contacts[0].company_id, state.applications[0].company_id);
  assert.notEqual(state.applications[2].company_id, state.applications[0].company_id);
});

test("company CRUD links records, matches exact domains, and deletion only detaches", async () => {
  const { ApplyOS } = await runtime();
  const company = await ApplyOS.upsertCompany({ name: "Northstar", domain: "northstar.example", website_url: "https://northstar.example", notes: "Target team", tags: ["target"] });
  const sameDomain = await ApplyOS.upsertCompany({ name: "Northstar Labs", domain: "northstar.example", notes: "Updated note" });
  assert.equal(sameDomain.id, company.id);
  assert.equal(sameDomain.notes, "Updated note");
  const application = await ApplyOS.upsertApplication({ company: "Northstar display", company_id: company.id, role: "Engineer", url: "https://jobs.example/northstar", description: "" });
  const contact = await ApplyOS.upsertContact({ name: "Jordan", company: "Northstar display", company_id: company.id });
  let state = await ApplyOS.getState();
  assert.equal(state.applications[0].company_id, company.id);
  assert.equal(state.contacts[0].company_id, company.id);
  await ApplyOS.deleteCompany(company.id);
  state = await ApplyOS.getState();
  assert.equal(state.companies.length, 0);
  assert.equal(state.applications.find((item) => item.id === application.id).company_id, null);
  assert.equal(state.contacts.find((item) => item.id === contact.id).company_id, null);
  assert.equal(state.applications[0].company, "Northstar display");
  assert.equal(state.contacts[0].company, "Northstar display");
});

test("waiting items group, resolve, and convert overdue records into one linked follow-up", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://jobs.example/waiting", description: "" });
  await ApplyOS.updateApplication(application.id, { status: "applied" });
  const contact = await ApplyOS.upsertContact({ name: "Riley", company: "Acme", application_ids: [application.id], preferred_channel: "linkedin" });
  const overdue = await ApplyOS.upsertWaitingItem({ kind: "recruiter_reply", what: "Recruiter response", application_id: application.id, contact_id: contact.id, waiting_since: "2026-07-01T12:00:00.000Z", expected_by: "2026-07-03T12:00:00.000Z", notes: "Asked about timing" });
  const noDate = await ApplyOS.upsertWaitingItem({ kind: "referral_response", what: "Referral confirmation", contact_id: contact.id, waiting_since: "2026-07-02T12:00:00.000Z" });
  let grouped = await ApplyOS.listWaitingItems({ at: "2026-07-05T12:00:00.000Z", status: "open" });
  assert.equal(grouped.find((item) => item.id === overdue.id).group, "overdue");
  assert.equal(grouped.find((item) => item.id === noDate.id).group, "no_date");
  const action = await ApplyOS.convertWaitingToFollowUp(overdue.id, "2026-07-05T12:00:00.000Z");
  assert.equal(action.kind, "contact_follow_up");
  assert.equal(action.contact_id, contact.id);
  assert.equal(action.application_id, application.id);
  let state = await ApplyOS.getState();
  assert.equal(state.waiting_items.find((item) => item.id === overdue.id).status, "resolved");
  assert.equal(state.applications.find((item) => item.id === application.id).status, "follow_up_due");
  await ApplyOS.resolveWaitingItem(noDate.id);
  state = await ApplyOS.getState();
  assert.ok(state.waiting_items.every((item) => item.status === "resolved"));
});

test("company links and waiting items persist across a storage reload", async () => {
  const first = await runtime();
  const company = await first.ApplyOS.upsertCompany({ name: "Persist Co", domain: "persist.example" });
  const application = await first.ApplyOS.upsertApplication({ company: "Persist Co", company_id: company.id, role: "Tester", url: "https://jobs.example/persist", description: "" });
  const waiting = await first.ApplyOS.upsertWaitingItem({ kind: "assignment_review", what: "Assignment review", application_id: application.id, expected_by: "2026-08-05T12:00:00.000Z" });
  const second = await runtime(first.data);
  const reloaded = await second.ApplyOS.ensureState();
  assert.equal(reloaded.companies.find((item) => item.id === company.id).domain, "persist.example");
  assert.equal(reloaded.applications.find((item) => item.id === application.id).company_id, company.id);
  assert.equal(reloaded.waiting_items.find((item) => item.id === waiting.id).what, "Assignment review");
});

test("unified action lifecycle groups, snoozes, reschedules, and completes without changing unrelated application status", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/action-job", source: "test", description: "" });
  const contact = await ApplyOS.upsertContact({ name: "Riley Recruiter", email: "riley@example.com", application_ids: [application.id] });
  const action = await ApplyOS.upsertAction({ kind: "contact_follow_up", title: "Ask Riley about timing", due_at: "2026-07-01T09:00:00.000Z", priority: "high", channel: "email", contact_id: contact.id, application_id: application.id, source: "user" });
  assert.equal((await ApplyOS.listActions({ at: "2026-07-02T12:00:00.000Z" })).find((item) => item.id === action.id).group, "overdue");
  await ApplyOS.snoozeAction(action.id, "2026-07-05T09:00:00.000Z");
  assert.equal((await ApplyOS.getState()).reminders.find((item) => item.id === action.id).snoozed_until, "2026-07-05T09:00:00.000Z");
  await ApplyOS.rescheduleAction(action.id, "2026-07-06T09:00:00.000Z");
  assert.equal((await ApplyOS.getState()).reminders.find((item) => item.id === action.id).snoozed_until, null);
  await ApplyOS.completeAction(action.id);
  const state = await ApplyOS.getState();
  assert.equal(state.reminders.find((item) => item.id === action.id).status, "done");
  assert.equal(state.applications[0].status, "saved");
});

test("Today grouping uses local day boundaries and deterministic priority and creation ordering", async () => {
  const { ApplyOS } = await runtime();
  const localNoon = new Date(2026, 7, 1, 12, 0, 0);
  const start = new Date(2026, 7, 1, 0, 0, 0);
  const before = new Date(start.getTime() - 1);
  const lowFirst = await ApplyOS.upsertAction({ kind: "custom", title: "Low", due_at: start.toISOString(), priority: "low", created_at: "2026-07-01T00:00:00.000Z" });
  const highLater = await ApplyOS.upsertAction({ kind: "custom", title: "High later", due_at: start.toISOString(), priority: "high", created_at: "2026-07-03T00:00:00.000Z" });
  const highEarlier = await ApplyOS.upsertAction({ kind: "custom", title: "High earlier", due_at: start.toISOString(), priority: "high", created_at: "2026-07-02T00:00:00.000Z" });
  const overdue = await ApplyOS.upsertAction({ kind: "custom", title: "Overdue", due_at: before.toISOString(), priority: "medium" });
  const actions = await ApplyOS.listActions({ at: localNoon.toISOString() });
  assert.equal(actions.find((item) => item.id === overdue.id).group, "overdue");
  assert.ok(actions.filter((item) => item.id !== overdue.id).every((item) => item.group === "today"));
  assert.deepEqual([...actions.filter((item) => item.id !== overdue.id).map((item) => item.id)], [highEarlier.id, highLater.id, lowFirst.id]);
});

test("marking applied replaces only open system application follow-ups", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/preserve-actions", source: "test", description: "" });
  const contact = await ApplyOS.upsertContact({ name: "Riley", application_ids: [application.id] });
  const interview = await ApplyOS.upsertInterview({
    application_id: application.id,
    type: "technical",
    scheduled_at: "2026-08-08T10:00:00.000Z",
    preparation_action_at: "2026-08-07T10:00:00.000Z",
    next_action: "Send thanks",
    next_action_at: "2026-08-09T10:00:00.000Z",
    interviewer_contact_ids: [contact.id]
  });
  const custom = await ApplyOS.upsertAction({ kind: "custom", title: "Research the team", due_at: "2026-08-05T10:00:00.000Z", application_id: application.id, source: "user" });
  const contactAction = await ApplyOS.upsertAction({ kind: "contact_follow_up", title: "Ask Riley", due_at: "2026-08-06T10:00:00.000Z", application_id: application.id, contact_id: contact.id, source: "system" });

  await ApplyOS.markApplicationApplied(application.id, "2026-08-01T10:00:00.000Z");
  const state = await ApplyOS.getState();
  assert.equal(state.reminders.filter((item) => item.application_id === application.id && ["application_follow_up", "application_final_follow_up"].includes(item.kind) && item.status === "open").length, 2);
  assert.ok(state.reminders.some((item) => item.id === custom.id));
  assert.ok(state.reminders.some((item) => item.id === contactAction.id));
  assert.equal(state.reminders.filter((item) => item.interview_id === interview.id && item.status === "open").length, 2);
});

test("skipping or activity-completing the last due follow-up restores applied status", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/reconcile", source: "test", description: "" });
  await ApplyOS.markApplicationApplied(application.id, "2026-01-01T00:00:00.000Z");
  await ApplyOS.refreshDueApplications(new Date("2026-02-01T00:00:00.000Z"));
  let state = await ApplyOS.getState();
  await ApplyOS.skipAction(state.reminders[0].id);
  state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "follow_up_due");
  const contact = await ApplyOS.upsertContact({ name: "Riley", application_ids: [application.id] });
  const remaining = (await ApplyOS.getState()).reminders.find((item) => item.status === "open");
  await ApplyOS.logContactActivity({ contact_id: contact.id, action_id: remaining.id, type: "email", direction: "outbound", occurred_at: "2026-02-01T10:00:00.000Z", summary: "Followed up" }, { complete_action_id: remaining.id });
  state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "applied");
});

test("cancelling the last due follow-up restores applied status", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/cancel-reconcile", source: "test", description: "" });
  await ApplyOS.markApplicationApplied(application.id, "2026-01-01T00:00:00.000Z");
  await ApplyOS.refreshDueApplications(new Date("2026-02-01T00:00:00.000Z"));
  for (const action of (await ApplyOS.getState()).reminders) await ApplyOS.cancelAction(action.id);
  const state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "applied");
  assert.ok(state.reminders.every((item) => item.status === "cancelled"));
});

test("closing an application cancels only open system application-process actions", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/close", source: "test", description: "" });
  const custom = await ApplyOS.upsertAction({ kind: "custom", title: "Keep networking", due_at: "2026-08-10T10:00:00.000Z", application_id: application.id, source: "user" });
  const contact = await ApplyOS.upsertContact({ name: "Riley", application_ids: [application.id] });
  const contactAction = await ApplyOS.upsertAction({ kind: "contact_follow_up", title: "Stay in touch", due_at: "2026-08-11T10:00:00.000Z", application_id: application.id, contact_id: contact.id, source: "user" });
  await ApplyOS.markApplicationApplied(application.id, "2026-08-01T10:00:00.000Z");
  await ApplyOS.updateApplication(application.id, { status: "rejected" });
  const state = await ApplyOS.getState();
  assert.equal(state.reminders.find((item) => item.id === custom.id).status, "open");
  assert.equal(state.reminders.find((item) => item.id === contactAction.id).status, "open");
  assert.ok(state.reminders.filter((item) => ["application_follow_up", "application_final_follow_up"].includes(item.kind)).every((item) => item.status === "cancelled"));
});

test("application and interview deletion preserve action and activity history", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/delete-history", source: "test", description: "" });
  const contact = await ApplyOS.upsertContact({ name: "Riley", application_ids: [application.id] });
  await ApplyOS.markApplicationApplied(application.id, "2026-01-01T00:00:00.000Z");
  let state = await ApplyOS.getState();
  await ApplyOS.completeAction(state.reminders[0].id);
  const interview = await ApplyOS.upsertInterview({ application_id: application.id, type: "technical", scheduled_at: "2026-08-08T10:00:00.000Z", next_action: "Send thanks", next_action_at: "2026-08-09T10:00:00.000Z", interviewer_contact_ids: [contact.id] });
  const prep = (await ApplyOS.getState()).reminders.find((item) => item.interview_id === interview.id && item.kind === "interview_prep");
  await ApplyOS.completeAction(prep.id);
  await ApplyOS.logContactActivity({ contact_id: contact.id, application_id: application.id, interview_id: interview.id, type: "meeting", direction: "none", occurred_at: "2026-08-08T10:00:00.000Z", summary: "Interviewed" });
  await ApplyOS.deleteApplication(application.id);
  state = await ApplyOS.getState();
  assert.equal(state.applications.length, 0);
  assert.equal(state.interviews.length, 0);
  assert.ok(state.reminders.some((item) => item.status === "done"));
  assert.ok(state.reminders.some((item) => item.status === "cancelled"));
  assert.ok(state.reminders.every((item) => item.application_id === null && item.interview_id === null));
  assert.equal(state.contact_activities[0].application_id, null);
  assert.equal(state.contact_activities[0].interview_id, null);
  assert.equal(state.contact_activities[0].summary, "Interviewed");
});

test("clearing interview dates cancels generated open actions without deleting history", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/interview-clear", source: "test", description: "" });
  const interview = await ApplyOS.upsertInterview({ application_id: application.id, type: "technical", scheduled_at: "2026-08-08T10:00:00.000Z", next_action: "Send thanks", next_action_at: "2026-08-09T10:00:00.000Z" });
  assert.equal((await ApplyOS.getState()).reminders.filter((item) => item.interview_id === interview.id && item.status === "open").length, 2);
  await ApplyOS.upsertInterview({ id: interview.id, application_id: application.id, scheduled_at: null, preparation_action_at: null, next_action_at: null });
  const state = await ApplyOS.getState();
  assert.equal(state.reminders.filter((item) => item.interview_id === interview.id && item.status === "open").length, 0);
  assert.equal(state.reminders.filter((item) => item.interview_id === interview.id && item.status === "cancelled").length, 2);
  await ApplyOS.deleteInterview(interview.id);
  const deleted = await ApplyOS.getState();
  assert.equal(deleted.interviews.length, 0);
  assert.equal(deleted.reminders.filter((item) => item.context_snapshot.interview_type === "technical" && item.status === "cancelled").length, 2);
  assert.ok(deleted.reminders.every((item) => item.interview_id === null));
});

test("logging contact activity atomically completes one action and creates the next", async () => {
  const { ApplyOS } = await runtime();
  const contact = await ApplyOS.upsertContact({ name: "Taylor", email: "taylor@example.com" });
  const action = await ApplyOS.upsertAction({ kind: "contact_follow_up", title: "Email Taylor", due_at: "2026-07-02T09:00:00.000Z", priority: "medium", channel: "email", contact_id: contact.id, source: "user" });
  await ApplyOS.logContactActivity({ contact_id: contact.id, action_id: action.id, type: "email", direction: "outbound", occurred_at: "2026-07-02T10:00:00.000Z", subject: "Checking in", summary: "Sent a reviewed note", outcome: "Awaiting reply" }, { complete_action_id: action.id, next_action: { title: "Check for reply", due_at: "2026-07-09T10:00:00.000Z", channel: "email" } });
  const state = await ApplyOS.getState();
  assert.equal(state.contact_activities.length, 1);
  assert.equal(state.reminders.find((item) => item.id === action.id).status, "done");
  assert.equal(state.reminders.filter((item) => item.contact_id === contact.id && item.status === "open").length, 1);
  assert.equal(state.contacts[0].last_contacted_at, "2026-07-02T10:00:00.000Z");
});

test("contact merge preserves applications, actions, activities, tags, and interview links", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/merge", source: "test", description: "" });
  const source = await ApplyOS.upsertContact({ name: "Taylor A", email: "same@example.com", tags: ["warm"], application_ids: [application.id] });
  const target = await ApplyOS.upsertContact({ name: "Taylor", email: "same@example.com", tags: ["recruiter"] });
  const action = await ApplyOS.upsertAction({ kind: "contact_follow_up", title: "Follow up", due_at: "2026-08-01T10:00:00.000Z", contact_id: source.id, channel: "email" });
  await ApplyOS.logContactActivity({ contact_id: source.id, type: "note", direction: "none", occurred_at: "2026-07-01T10:00:00.000Z", summary: "Met at event" });
  await ApplyOS.mergeContacts(source.id, target.id);
  const state = await ApplyOS.getState();
  assert.equal(state.contacts.length, 1);
  assert.deepEqual([...state.contacts[0].tags].sort(), ["recruiter", "warm"]);
  assert.equal(state.reminders.find((item) => item.id === action.id).contact_id, target.id);
  assert.equal(state.contact_activities[0].contact_id, target.id);
});

test("contact merge preserves the newest legacy last-contacted date", async () => {
  const { ApplyOS } = await runtime();
  const source = await ApplyOS.upsertContact({ name: "Taylor A", last_contacted_at: "2026-07-20T10:00:00.000Z" });
  const target = await ApplyOS.upsertContact({ name: "Taylor", last_contacted_at: "2026-07-01T10:00:00.000Z" });
  await ApplyOS.mergeContacts(source.id, target.id);
  assert.equal((await ApplyOS.getState()).contacts[0].last_contacted_at, "2026-07-20T10:00:00.000Z");
});

test("editing contact activity recalculates the derived last-contacted date", async () => {
  const { ApplyOS } = await runtime();
  const contact = await ApplyOS.upsertContact({ name: "Taylor" });
  const first = await ApplyOS.logContactActivity({ contact_id: contact.id, type: "note", direction: "none", occurred_at: "2026-07-01T10:00:00.000Z", summary: "First" });
  const second = await ApplyOS.logContactActivity({ contact_id: contact.id, type: "note", direction: "none", occurred_at: "2026-07-10T10:00:00.000Z", summary: "Second" });
  assert.equal((await ApplyOS.getState()).contacts[0].last_contacted_at, second.occurred_at);
  await ApplyOS.updateContactActivity(second.id, { occurred_at: "2026-06-01T10:00:00.000Z" });
  assert.equal((await ApplyOS.getState()).contacts[0].last_contacted_at, first.occurred_at);
});

test("CSV contact staging handles quoted fields, mapping, row errors, and duplicate decisions", async () => {
  const { ApplyOS } = await runtime();
  const existing = await ApplyOS.upsertContact({ name: "Alex Nguyen", email: "alex@example.com" });
  const text = await readFile(resolve("tests/fixtures/contacts-import.csv"), "utf8");
  const parsed = ApplyOS.parseContactCSV(text);
  const mapping = ApplyOS.inferContactImportMapping(parsed.headers);
  const staged = ApplyOS.stageContactImport(parsed, mapping, [existing]);
  assert.equal(parsed.rows.length, 3);
  assert.equal(staged[0].input.name, "Nguyen, Alex");
  assert.equal(staged[0].input.title, "Senior, Recruiting Partner");
  assert.equal(staged[0].decision, "merge");
  assert.equal(staged[0].mergeTargetId, existing.id);
  assert.equal(staged[1].decision, "create");
  assert.equal(staged[2].decision, "skip");
  assert.match(staged[2].errors.join(" "), /Name is required/);
});

test("CSV staging surfaces name-only candidates and applies one reviewed batch plan", async () => {
  const { ApplyOS } = await runtime();
  const existing = await ApplyOS.upsertContact({ name: "Taylor Example", company: "Old Co", tags: ["existing"] });
  const parsed = ApplyOS.parseContactCSV("Name,Company,Tags\nTaylor Example,New Co,imported\nNew Person,Elsewhere,new\n");
  const staged = ApplyOS.stageContactImport(parsed, ApplyOS.inferContactImportMapping(parsed.headers), [existing]);
  assert.equal(staged[0].duplicateCandidates[0].reason, "name");
  assert.equal(staged[0].decision, "skip");
  staged[0].decision = "merge";
  staged[0].mergeTargetId = existing.id;
  const summary = await ApplyOS.applyContactImportPlan(staged);
  const state = await ApplyOS.getState();
  assert.equal(summary.created, 1);
  assert.equal(summary.merged, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(state.contacts.length, 2);
  assert.deepEqual([...state.contacts.find((item) => item.id === existing.id).tags].sort(), ["existing", "imported"]);
});

test("CSV parser rejects unclosed quotes and row counts above the cap", async () => {
  const { ApplyOS } = await runtime();
  assert.throws(() => ApplyOS.parseContactCSV('Name\n"Unclosed'), /unclosed quoted field/);
  assert.throws(() => ApplyOS.parseContactCSV(`Name\n${Array.from({ length: 501 }, (_, index) => `Person ${index}`).join("\n")}`), /at most 500/);
});

test("answer memory uses similar question phrasing", async () => {
  const { ApplyOS } = await runtime();
  await ApplyOS.syncAnswerMemory([{ question: "Why do you want this role?", answer: "It matches my platform background." }]);
  const answer = await ApplyOS.findRememberedAnswer("Why do you want this role");
  assert.equal(answer.answer, "It matches my platform background.");
});

test("application completions become reusable profile-scoped answer memory", async () => {
  const { ApplyOS } = await runtime();
  const remembered = await ApplyOS.rememberApplicationAnswer({
    question: "What kind of systems do you enjoy building?",
    answer: "I enjoy building reliable distributed systems.",
    profile_id: "default",
    scope: "global"
  });
  assert.equal(remembered.source, "application");
  assert.equal(remembered.memory_group, "custom:default");
  const recalled = await ApplyOS.findRememberedAnswer("What kind of software systems do you enjoy building?");
  assert.equal(recalled.answer, "I enjoy building reliable distributed systems.");

  const scoped = await ApplyOS.rememberApplicationAnswer({
    question: "Why do you want to work here?",
    answer: "The company mission matches my experience.",
    profile_id: "default",
    scope: "company",
    company_domain: "jobs.example.com"
  });
  assert.equal(scoped.company_domain, "jobs.example.com");
  assert.equal(await ApplyOS.findRememberedAnswer("Why do you want to work here?", { companyDomain: "other.example.com" }), null);
});

test("Offlyn-derived classifier recognizes ATS fields and keeps sensitive answers manual", async () => {
  const { ApplyOS } = await runtime();
  assert.equal(ApplyOS.OfflynCore.platformForHost("copart.wd12.myworkdayjobs.com"), "workday");
  assert.equal(ApplyOS.OfflynCore.isJobUrl("https://example.com/careers/engineering/software-intern"), true);
  const address = ApplyOS.OfflynCore.classifyField("Address", "text", "Contact_Information_q_address");
  assert.equal(address.canonicalField, "address");
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
  assert.equal(state.schema_version, 8);
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

test("contact CRM links people to applications and preserves review-only compose URLs", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/contact-job", source: "test", description: "" });
  const contact = await ApplyOS.upsertContact({
    name: "Riley Recruiter", title: "Talent Partner", company: "Acme", email: "riley@example.com",
    linkedin_url: "https://www.linkedin.com/in/riley", relationship: "recruiter", application_ids: [application.id], notes: "Met at a hiring event."
  });
  const state = await ApplyOS.getState();
  assert.equal(state.contacts[0].id, contact.id);
  assert.deepEqual([...state.contacts[0].application_ids], [application.id]);
  const links = ApplyOS.buildComposeLinks({ subject: "Following up", body: "Reviewed draft" }, contact.email);
  assert.match(links.gmail, /^https:\/\/mail\.google\.com\/mail\/\?/);
  assert.match(links.outlook, /^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?/);
  assert.match(links.mailto, /^mailto:riley@example\.com\?/);
  assert.equal(typeof ApplyOS.sendContactMessage, "undefined");
});

test("interview workspace stores preparation and builds a manual thank-you draft", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/interview-job", source: "test", description: "" });
  const contact = await ApplyOS.upsertContact({ name: "Taylor Manager", email: "taylor@example.com", relationship: "interviewer", application_ids: [application.id] });
  const interview = await ApplyOS.upsertInterview({
    application_id: application.id, type: "technical", format: "video", scheduled_at: "2026-08-02T10:30:00.000Z",
    interviewer_contact_ids: [contact.id], company_research: "Read the engineering blog", preparation_notes: "Review system design",
    question_notes: "event-driven architecture and observability", next_action: "Send thank-you", next_action_at: "2026-08-03T12:00:00.000Z"
  });
  const state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "interview");
  assert.equal(state.interviews[0].id, interview.id);
  assert.equal(state.interviews[0].preparation_notes, "Review system design");
  const draft = ApplyOS.generateThankYouDraft(state.applications[0], interview, { fullName: "Ada Lovelace" }, contact);
  assert.match(draft.subject, /Engineer interview/);
  assert.match(draft.body, /Hello Taylor/);
  assert.match(draft.body, /event-driven architecture/);
  assert.equal(typeof ApplyOS.sendThankYou, "undefined");
  await ApplyOS.deleteContact(contact.id);
  assert.equal((await ApplyOS.getState()).interviews[0].interviewer_contact_ids.length, 0);
});

test("encrypted backup round-trip restores reviewed data and keeps a one-step undo checkpoint", async () => {
  const { ApplyOS } = await runtime({ profile: { firstName: "Ada", email: "private@example.test", resume: { name: "private-resume.pdf", dataUrl: "data:application/pdf;base64,UERG" } } });
  await ApplyOS.ensureState();
  await ApplyOS.upsertApplication({ company: "Original Co", role: "Engineer", url: "https://example.com/original", source: "test", description: "" });
  await ApplyOS.upsertContact({ name: "Original Recruiter", email: "recruiter@example.test", relationship: "recruiter" });
  const password = "correct horse battery staple";
  const exported = await ApplyOS.exportEncryptedBackup(password, "0.8.1");
  assert.doesNotMatch(exported.serialized, /private@example\.test|private-resume\.pdf|Original Recruiter/);
  await assert.rejects(ApplyOS.decryptBackup(exported.serialized, "wrong password"), /Could not decrypt/);
  const snapshot = await ApplyOS.decryptBackup(exported.serialized, password);
  assert.equal(ApplyOS.backupSummary(snapshot).applications, 1);
  assert.equal(ApplyOS.backupSummary(snapshot).contacts, 1);

  await ApplyOS.upsertApplication({ company: "Later Co", role: "Developer", url: "https://example.com/later", source: "test", description: "" });
  assert.equal((await ApplyOS.getState()).applications.length, 2);
  await ApplyOS.restoreBackup(snapshot);
  assert.equal((await ApplyOS.getState()).applications.length, 1);
  assert.equal(await ApplyOS.hasRestoreCheckpoint(), true);
  await ApplyOS.undoLastRestore();
  assert.equal((await ApplyOS.getState()).applications.length, 2);
  assert.equal(await ApplyOS.hasRestoreCheckpoint(), false);
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

test("profile patches preserve fields owned by other surfaces and mark completed onboarding", async () => {
  const original = {
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    employment: [{ company: "Navy", title: "Rear Admiral" }],
    futureFeature: { enabled: true }
  };
  const { ApplyOS } = await runtime({ profile: original });
  const migrated = await ApplyOS.getActiveProfile();
  assert.equal(ApplyOS.isOnboardingComplete(migrated), false);
  const saved = await ApplyOS.patchActiveProfile({ phone: "+1 555 0100" });
  assert.equal(saved.employment[0].company, "Navy");
  assert.equal(saved.futureFeature.enabled, true);
  assert.equal(saved.phone, "+1 555 0100");
  assert.ok(saved.onboardingCompletedAt);
  assert.equal(ApplyOS.isOnboardingComplete(saved), true);
});

test("authoritative answer sync forgets deleted answers and honors company scope", async () => {
  const { ApplyOS } = await runtime();
  await ApplyOS.syncAnswerMemory([
    { question: "Why this role?", answer: "Systems work", scope: "global" },
    { question: "Have you worked here?", answer: "No", scope: "company", company_domain: "microsoft.com" }
  ], { authoritative: true, source: "profile", profileId: "default", memoryGroup: "custom:default" });
  await ApplyOS.syncAnswerMemory([
    { question: "Have you worked here?", answer: "No", scope: "company", company_domain: "microsoft.com" }
  ], { authoritative: true, source: "profile", profileId: "default", memoryGroup: "custom:default" });
  const state = await ApplyOS.getState();
  assert.equal(state.answer_memory.some((item) => item.question === "Why this role?"), false);
  assert.equal(await ApplyOS.findRememberedAnswer("Have you worked here?", { url: "https://jobs.google.com/apply" }), null);
  assert.equal((await ApplyOS.findRememberedAnswer("Have you worked here?", { url: "https://apply.microsoft.com/job" })).answer, "No");
});

test("serialized graph writes retain every concurrent profile answer", async () => {
  const { ApplyOS } = await runtime();
  await Promise.all(Array.from({ length: 12 }, (_, index) => ApplyOS.recordGraphAnswer({
    question: `Unique application question ${index}`,
    answer: `Answer ${index}`,
    source: "profile",
    profileId: "default"
  })));
  const graph = await ApplyOS.ensureGraph();
  assert.equal(graph.nodes.filter((node) => node.type === "answer").length, 12);
});

test("resume versions store immutable content hashes and application deletion preserves cancelled history", async () => {
  const { ApplyOS } = await runtime();
  const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
  const version = await ApplyOS.syncResumeVersion({ name: "resume.pdf", type: "application/pdf", size: 8, dataUrl });
  assert.equal(version.dataUrl, dataUrl);
  assert.match(version.sha256, /^[a-f0-9]{64}$/);
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/job", source: "example.com", description: "" });
  await ApplyOS.markApplicationApplied(application.id);
  await ApplyOS.upsertInterview({ application_id: application.id, type: "technical" });
  await ApplyOS.deleteApplication(application.id);
  const state = await ApplyOS.getState();
  assert.equal(state.applications.length, 0);
  assert.ok(state.reminders.length >= 2);
  assert.ok(state.reminders.every((item) => item.status === "cancelled"));
  assert.ok(state.reminders.every((item) => item.application_id === null && item.interview_id === null));
  assert.equal(state.interviews.length, 0);
});

test("completing the final due reminder clears follow-up-due status", async () => {
  const { ApplyOS } = await runtime();
  const application = await ApplyOS.upsertApplication({ company: "Acme", role: "Engineer", url: "https://example.com/job", source: "example.com", description: "" });
  await ApplyOS.markApplicationApplied(application.id, "2026-01-01T00:00:00.000Z");
  await ApplyOS.refreshDueApplications(new Date("2026-02-01T00:00:00.000Z"));
  let state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "follow_up_due");
  for (const reminder of state.reminders) await ApplyOS.completeReminder(reminder.id);
  state = await ApplyOS.getState();
  assert.equal(state.applications[0].status, "applied");
  assert.equal(state.applications[0].follow_up_date, null);
});

test("a no-op due refresh does not rewrite or increment state", async () => {
  const { ApplyOS } = await runtime();
  const before = await ApplyOS.getState();
  const after = await ApplyOS.refreshDueApplications(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(after.revision, before.revision);
});

test("restored application identifiers and links are normalized before dashboard use", async () => {
  const { ApplyOS } = await runtime({
    applyos_state: {
      schema_version: 5,
      applications: [{ id: 'bad" autofocus', company: "Acme", role: "Engineer", url: "javascript:alert(1)", status: "saved", priority: "medium" }]
    }
  });
  const state = await ApplyOS.getState();
  assert.match(state.applications[0].id, /^[a-z0-9][a-z0-9:_-]+$/i);
  assert.equal(state.applications[0].url, "");
});

test("onboarding stays activation-focused and product surfaces avoid forced tours", async () => {
  const [popup, options, onboardingHtml, onboarding, popupScript] = await Promise.all([
    readFile(resolve("popup.html"), "utf8"),
    readFile(resolve("options.html"), "utf8"),
    readFile(resolve("onboarding.html"), "utf8"),
    readFile(resolve("onboarding.js"), "utf8"),
    readFile(resolve("popup.js"), "utf8")
  ]);
  assert.doesNotMatch(options, /Run setup again/);
  assert.doesNotMatch(popup, /Profile & answer memory/);
  assert.doesNotMatch(onboarding, /ScoutTour/);
  assert.match(onboarding, /dashboard\.html\?welcome=1/);
  assert.match(onboarding, /location\.replace\(chrome\.runtime\.getURL\("options\.html"\)\)/);
  assert.equal((onboardingHtml.match(/data-panel=/g) || []).length, 3);
  assert.match(onboardingHtml, /id="starter-resume"/);
  assert.match(popupScript, /Edit profile/);
  assert.match(popup, /id="dashboard"[^>]*>Open Scout<\/button>/);
  assert.doesNotMatch(popupScript, /ScoutTour/);
  assert.doesNotMatch(popup, /SMART READY/);
  assert.match(popupScript, /chrome\.runtime\.getURL\("dashboard\.html"\)/);
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
    { action: "fill", fieldId: "name", candidateId: "name_profile", label: "Full name", confidence: 0.99 },
    { action: "fill", fieldId: "ssn", candidateId: "ssn_profile", label: "Social Security Number", confidence: 0.99 },
    { action: "fill", fieldId: "submit", candidateId: "submit_profile", label: "Submit application", confidence: 0.99 },
    { action: "check", fieldId: "terms", candidateId: "terms_profile", label: "I agree to terms", confidence: 0.99 },
    { action: "fill", fieldId: "email", candidateId: "invented", label: "Email", confidence: 0.99 }
  ] }, [
    { fieldId: "name", candidates: [{ id: "name_profile" }] },
    { fieldId: "ssn", candidates: [{ id: "ssn_profile" }] },
    { fieldId: "submit", candidates: [{ id: "submit_profile" }] },
    { fieldId: "terms", candidates: [{ id: "terms_profile" }] },
    { fieldId: "email", candidates: [{ id: "email_profile" }] }
  ]);
  assert.deepEqual([...plan.actions.map((action) => action.fieldId)], ["name"]);
  assert.equal(plan.reviewRequired, true);
  assert.equal(plan.blockedActions, 4);
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

test("resume PDF extraction preserves readable page and line boundaries", async () => {
  const { ApplyOS } = await runtime();
  let destroyed = false;
  const pdfjs = {
    getDocument({ data, isEvalSupported }) {
      assert.ok(ArrayBuffer.isView(data));
      assert.equal(isEvalSupported, false);
      return {
        promise: Promise.resolve({
          numPages: 2,
          async getPage(pageNumber) {
            return {
              async getTextContent() {
                return pageNumber === 1
                  ? { items: [
                    { str: "Ada", transform: [1, 0, 0, 1, 0, 700] },
                    { str: "Lovelace", transform: [1, 0, 0, 1, 30, 700], hasEOL: true },
                    { str: "Software   Engineer", transform: [1, 0, 0, 1, 0, 680] }
                  ] }
                  : { items: [{ str: "TypeScript", transform: [1, 0, 0, 1, 0, 700] }] };
              },
              cleanup() {}
            };
          },
          async destroy() { destroyed = true; }
        })
      };
    }
  };
  const text = await ApplyOS.extractPdfText(new Uint8Array([1, 2, 3]), pdfjs);
  assert.equal(text, "Ada Lovelace\nSoftware Engineer\n\nTypeScript");
  assert.equal(destroyed, true);
});

test("dashboard drawers use inert state instead of aria-hidden focus transitions", async () => {
  const html = await readFile(resolve("dashboard.html"), "utf8");
  const source = await readFile(resolve("dashboard.js"), "utf8");
  assert.doesNotMatch(html, /aria-hidden=/);
  assert.doesNotMatch(source, /setAttribute\(["']aria-hidden/);
  assert.match(html, /data-state="closed" inert/);
  assert.match(source, /drawer\.inert = true/);
});

test("application details use an essentials-first disclosure hierarchy", async () => {
  const [html, source] = await Promise.all([readFile(resolve("dashboard.html"), "utf8"), readFile(resolve("dashboard.js"), "utf8")]);
  assert.match(html, /class="detail-grid application-primary-grid">\s*<label><span>Status<\/span>[\s\S]*?<label><span>Deadline<\/span>/);
  assert.match(html, /<details id="application-record-details"/);
  assert.match(html, /<details id="application-match"/);
  assert.equal((html.match(/<details id="application-[^"]+" class="detail-workspace/g) || []).length, 4);
  for (const id of ["application-contacts", "application-follow-up", "application-interviews", "application-smart-drafts"]) assert.match(html, new RegExp(`<details id="${id}"`));
  assert.doesNotMatch(html, /application-more-actions/);
  assert.match(html, /class="application-actions__secondary"><button id="mark-application-waiting"[\s\S]*?<a id="detail-url"[\s\S]*?<button id="delete-application"/);
  assert.match(source, /document\.querySelectorAll\("#detail > \.detail-workspace"\)/);
  assert.match(source, /application-contacts-status/);
  assert.match(source, /application-interviews-status/);
});

test("popup stays within Chrome's surface without exposing a native scrollbar", async () => {
  const css = await readFile(resolve("popup.css"), "utf8");
  assert.match(css, /html,body\s*\{[^}]*max-height:600px;[^}]*overflow:hidden;/s);
  assert.match(css, /main\s*\{[^}]*max-height:600px;[^}]*overflow:hidden;[^}]*background:var\(--paper\);/s);
  assert.match(css, /body\s*\{[^}]*padding:0;/s);
  assert.match(css, /\.result:empty\s*\{[^}]*display:none;/s);
  assert.doesNotMatch(css, /overflow-y:auto/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*height:600px/);
  assert.doesNotMatch(css, /min-height:650px/);
});

test("Scout pages share one polished scrollbar system", async () => {
  const [scrollbars, contentCss, privacyCss, ...pages] = await Promise.all([
    readFile(resolve("shared/scrollbars.css"), "utf8"),
    readFile(resolve("content.css"), "utf8"),
    readFile(resolve("privacy-site/styles.css"), "utf8"),
    ...["dashboard.html", "options.html", "account.html", "onboarding.html"].map((file) => readFile(resolve(file), "utf8"))
  ]);
  for (const page of pages) assert.match(page, /href="shared\/scrollbars\.css"/);
  assert.match(scrollbars, /scrollbar-color:/);
  assert.match(scrollbars, /scrollbar-gutter:\s*stable/);
  assert.match(scrollbars, /html:has\(> body\[data-scout-page\]\)::-webkit-scrollbar-track\s*\{[^}]*margin-top:\s*var\(--scout-header-height,\s*68px\)/s);
  assert.match(scrollbars, /::-webkit-scrollbar-thumb:hover/);
  assert.match(scrollbars, /min-height:\s*44px/);
  assert.match(contentCss, /\.applyos-review-fields::-webkit-scrollbar-thumb/);
  assert.match(privacyCss, /\*::-webkit-scrollbar-thumb/);
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
    "company.personio.de": "personio",
    "apply.careers.microsoft.com": "microsoft"
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
  assert.match(captureSource, /microsoft:/);
  assert.match(source, /Microsoft Careers/);
  assert.doesNotMatch(source, /requestSubmit|\.submit\s*\(/);
  assert.doesNotMatch(source, /save.and.continue|next.button/i);
  assert.match(fixture, /Greenhouse legacy and React controls/);
  assert.match(notices, /Job App Filler/);
  assert.match(notices, /BSD 3-Clause/);
});
