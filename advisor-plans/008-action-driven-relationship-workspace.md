# Plan 008: Turn follow-ups and contacts into an action-driven relationship workspace

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md` unless a reviewer says they maintain the index.
>
> **Pre-dispatch worktree gate**: This plan was prepared while the maintainer
> had unrelated, uncommitted feature work touching several in-scope files.
> Preserve that work first. Do not start implementation from a dirty worktree,
> and do not discard or overwrite any existing change. A reviewer must commit
> the current feature work, re-run the drift check, and update the "Planned at"
> SHA if the excerpts below no longer match.
>
> **Drift check (run first)**:
>
> ```sh
> git status --short
> git diff --stat a9713b3..HEAD -- types/applyos.ts shared/constants.js shared/followup.js shared/storage.js shared/cloud-repository.js shared/backup.js background.js manifest.json dashboard.html dashboard.js dashboard.css options.html options.js options.css account.html account.js onboarding.html popup.html scripts/check.mjs scripts/browser-test.mjs tests supabase README.md docs privacy-site
> ```
>
> The first command must be empty. If the second command reports changes,
> compare every "Current state" excerpt with the live code. Stop on a semantic
> mismatch and have the plan re-anchored before editing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none; the current schema-v5/cloud-sync baseline must remain green
- **Category**: direction / migration / tests
- **Planned at**: commit `a9713b3` plus the maintainer's in-progress worktree, 2026-07-31
- **Status**: IN PROGRESS — automated release gates are green at `d0596c1`; manual Chrome acceptance is pending

## Why this matters

Scout currently stores enough fields to demonstrate follow-ups, contacts, and
interviews, but it does not give a user a reliable daily workflow. Application
reminders use fixed dates, contact and interview next actions live in separate
fields, compose links leave no history, and "notifications" only change the
toolbar badge. The result is a set of toy records rather than a system a user
can trust to tell them whom to contact and what to do next.

This plan creates one action inbox across applications, people, and interviews;
adds an append-only contact interaction timeline; makes follow-up schedules
configurable; adds explicit logging after reviewed outreach; and delivers
opt-in Chrome notifications. It preserves Scout's core boundary: Scout may
draft, organize, and remind, but it never reads a mailbox, infers that a message
was sent, or contacts anyone automatically.

## Product contract

After this plan lands, the following user story must work end to end:

1. A user marks an application applied. Scout creates editable follow-up
   actions using the user's configured offsets.
2. The actions appear in a dedicated **Today** workspace, grouped into
   Overdue, Today, Upcoming, and Done.
3. The user can complete, skip, reschedule, or snooze an action without opening
   the application drawer.
4. A contact detail drawer shows connected applications, the next open action,
   and a chronological timeline of manually logged email, LinkedIn, phone,
   meeting, and note activity.
5. Opening a compose handoff does not mutate history. A separate
   **Log interaction** confirmation records what the user says happened,
   completes the linked action, updates `last_contacted_at`, and can create the
   next action in one serialized state mutation.
6. Interview preparation and thank-you work appear in the same action inbox.
7. If the user explicitly grants the optional Chrome notification permission,
   Scout shows a generic due-action digest and deep-links to Today. Without
   permission, the badge and in-product inbox still work.
8. Contact CSV import is local, previewed, capped, and duplicate-aware. Scout
   still does not scrape LinkedIn, import an address book, or read external
   messages.

## Target data contract

Keep the persisted state key and cloud entity type named `reminders` for this
release so older backups and the existing sync protocol remain readable. Change
the payload contract and all new code-facing names to `ActionItem`; document
`state.reminders` as a compatibility serialization key. Do not create a second
authoritative `actions` array.

```ts
interface ActionItem {
  id: string;
  kind:
    | "application_follow_up"
    | "application_final_follow_up"
    | "contact_follow_up"
    | "interview_prep"
    | "interview_thank_you"
    | "custom";
  title: string;
  status: "open" | "done" | "skipped" | "cancelled";
  due_at: string;
  snoozed_until: string | null;
  priority: "low" | "medium" | "high";
  channel: "email" | "linkedin" | "phone" | "meeting" | "other";
  application_id: string | null;
  contact_id: string | null;
  interview_id: string | null;
  notes: string;
  source: "system" | "user";
  completed_at: string | null;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactActivity {
  id: string;
  contact_id: string;
  application_id: string | null;
  interview_id: string | null;
  action_id: string | null;
  type: "email" | "linkedin" | "phone" | "meeting" | "note";
  direction: "outbound" | "inbound" | "none";
  occurred_at: string;
  subject: string;
  summary: string;
  outcome: string;
  created_at: string;
  updated_at: string;
}
```

Add `contact_activities: ContactActivity[]` to schema v6. Add `phone`, `tags`,
and `preferred_channel` to `ContactRecord`. Extend settings with:

- `follow_up_offsets_days: number[]`, default `[7, 14]`, unique ascending
  integers limited to 1–60 and at most four offsets;
- `desktop_notifications_enabled: boolean`, default `false`;
- `notification_digest_time: string`, default `"09:00"` in local time.

Keep `final_follow_up_enabled` and `notification_enabled` readable during the
v5-to-v6 migration, then project them into the new settings. Do not silently
request notification permission during migration.

The following fields become compatibility projections, not independent sources
of truth:

- `ApplicationRecord.follow_up_date` = earliest effective due date of its open
  application follow-up action;
- `ContactRecord.next_action_at` = earliest effective due date of its open
  contact-linked action;
- `InterviewRecord.next_action` and `next_action_at` = the title and effective
  due date of its earliest open interview-linked action.

The effective due date is `snoozed_until || due_at`. A normal reschedule changes
`due_at` and clears `snoozed_until`; Snooze preserves `due_at` and sets
`snoozed_until`.

## Current state

Relevant files and their roles:

- `types/applyos.ts` — public state and cloud entity contracts.
- `shared/constants.js` — schema version and allowed enum values.
- `shared/followup.js` — fixed follow-up creation and review-only drafts.
- `shared/storage.js` — normalization, migrations, serialized mutations, and
  the current reminder/contact/interview CRUD.
- `dashboard.html`, `dashboard.js`, `dashboard.css` — application, contact, and
  next-action UI.
- `background.js`, `manifest.json` — hourly badge refresh and extension
  permissions.
- `shared/cloud-repository.js`, `supabase/migrations/` — record projection,
  cloud allowlists, mutation RPCs, and private-record persistence.
- `shared/backup.js`, `options.js` — encrypted workspace backup and summary.
- `tests/applyos.test.mjs`, `tests/cloud-repository.test.mjs`,
  `tests/cloud-launch.test.mjs`, `scripts/browser-test.mjs` — current
  state/cloud/browser regression coverage.

Current reminders cannot represent a person, an interview, a title, a channel,
a snooze, or a skipped state:

```ts
// types/applyos.ts:99-106
export interface FollowUpReminder {
  id: string;
  application_id: string;
  type: "follow_up" | "final_follow_up";
  due_at: string;
  completed_at: string | null;
  created_at: string;
}
```

The schedule is hard-coded:

```js
// shared/followup.js:6-25
ApplyOS.buildFollowUpReminders = function buildFollowUpReminders(application, appliedAt = new Date()) {
  const base = appliedAt instanceof Date ? appliedAt : new Date(appliedAt);
  return [
    { id: ApplyOS.uid("rem"), application_id: application.id,
      type: "follow_up", due_at: ApplyOS.addDays(base, 7), ... },
    { id: ApplyOS.uid("rem"), application_id: application.id,
      type: "final_follow_up", due_at: ApplyOS.addDays(base, 14), ... }
  ];
};
```

The dashboard's next-action strip ignores `ContactRecord.next_action_at` and
`InterviewRecord.next_action_at`, caps the result at eight, and only offers
Done for follow-up reminders:

```js
// dashboard.js:189-200
const reminders = state.reminders
  .filter((item) => !item.completed_at)
  .map((item) => ({ ...item, kind: "follow-up", at: item.due_at }));
const items = [...reminders, ...deadlines, ...interviews]
  .sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 8);
```

Contact records are CRUD-only and store one date rather than history:

```ts
// types/applyos.ts:148-161
export interface ContactRecord {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedin_url: string;
  relationship: ContactRelationship;
  application_ids: string[];
  notes: string;
  last_contacted_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}
```

The current "notification" setting only controls a badge that is refreshed by
an hourly alarm:

```js
// background.js:223-240
const due = state.settings.notification_enabled === false ? 0
  : state.reminders.filter((item) => !item.completed_at
      && new Date(item.due_at) <= new Date()).length;
chrome.alarms.create("applyos-follow-ups", { periodInMinutes: 60 });
```

`manifest.json:6` has no `notifications` permission. The new desktop notification
permission must be optional and requested only from a user click in settings.

Cloud sync currently knows `reminder`, `contact`, and `interview`, but not
contact activity:

```js
// shared/cloud-repository.js:10-31
const ENTITY_TYPES = Object.freeze([
  "profile", "application", "contact", "interview", "reminder",
  "answer_memory", "learned_answer", "resume_version",
  "knowledge_graph", "settings", "onboarding_progress"
]);
```

Current tests are green at the planning snapshot:

- `npm run lint` — exit 0, 27 scripts checked.
- `npm run typecheck` — exit 0.
- `npm test` — 61 passed, 0 failed.

Follow the existing serialized mutation pattern in `shared/storage.js`
(`ApplyOS.mutateState`) and the review-only handoff pattern in
`shared/followup.js:73-82`. Follow Conventional Commits; recent examples are
`feat: add contacts and interview workspace` and
`fix: improve popup fit and metadata fallbacks`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0; every runtime script and page reference resolves |
| Typecheck | `npm run typecheck` | exit 0, no TypeScript errors |
| Unit/contract tests | `npm test` | exit 0, all tests pass |
| Build | `npm run build` | exit 0 and `dist/` is created |
| Browser regression | `npm run test:browser:dist` | exit 0 and the full Chromium flow prints PASS |
| Full extension gate | `npm run verify` | all five extension gates pass |
| Start local database | `npm run db:start` | local Supabase starts successfully |
| Apply migrations | `npm run db:reset` | exit 0 with all migrations applied |
| Database tests | `npm run db:test` | exit 0, all pgTAP assertions pass |
| Database lint | `npm run db:lint` | exit 0, no public-schema warnings |

Do not run `npm install` unless `package-lock.json` and `node_modules` are
missing or the reviewer asks. This plan requires no new npm dependency.

## Scope

**In scope** (the only source/product files to modify):

- `types/applyos.ts`
- `shared/constants.js`
- `shared/followup.js`
- `shared/storage.js`
- `shared/cloud-repository.js`
- `shared/backup.js`
- `background.js`
- `manifest.json`
- `dashboard.html`
- `dashboard.js`
- `dashboard.css`
- `options.html`
- `options.js`
- `options.css`
- `account.html`
- `account.js`
- `onboarding.html`
- `popup.html`
- `scripts/check.mjs`
- `scripts/browser-test.mjs`
- `tests/applyos.test.mjs`
- `tests/cloud-repository.test.mjs`
- `tests/cloud-launch.test.mjs`
- `tests/action-notifications.test.mjs` (create)
- `tests/fixtures/contacts-import.csv` (create)
- `supabase/migrations/202607310001_contact_activity_records.sql` (create)
- `supabase/tests/001_rls.sql`
- `supabase/tests/002_authoritative_sync.sql`
- `README.md`
- `docs/product-feature-map.md`
- `docs/data-and-privacy-boundaries.md`
- `docs/extension-permissions.md`
- `docs/privacy-policy-draft.md`
- `privacy-site/index.html`
- `advisor-plans/README.md`

If a new shared runtime module is genuinely necessary, stop and amend this
scope before creating it; do not hide a new architectural boundary inside a
drive-by file.

**Out of scope**:

- Sending email, LinkedIn messages, SMS, or calendar invitations.
- Reading a mailbox, sent folder, LinkedIn inbox/network, native contacts, or
  browser history to infer an interaction.
- Automatic contact discovery, scraping, enrichment, lead scoring, or
  recruiter-facing access.
- Google/Microsoft OAuth scopes, calendar sync, push services, or server jobs.
- AI-generated outreach beyond the existing reviewable draft boundary.
- Team/shared CRM features, mobile apps, sales funnels, or employer ATS
  workflows.
- Renaming the persisted `reminders` collection or cloud `reminder` entity in
  this release.
- Changes to autofill, submission detection, answer learning, or job-page
  prompts.

## Git workflow

- Branch: `codex/008-action-workspace`
- Commit one logical tranche at a time using Conventional Commits:
  - `feat: add unified action lifecycle`
  - `feat: add contact activity timeline`
  - `feat: add opt-in action notifications`
  - `test: cover relationship workflow`
- Do not push or open a PR unless the operator explicitly requests it.
- Never stage or rewrite the maintainer's pre-existing changes as part of this
  plan without their confirmation.

## Steps

### Step 1: Introduce schema v6 and the generalized action contract

1. Increment `ApplyOS.SCHEMA_VERSION` to 6.
2. Replace the code-facing `FollowUpReminder` contract with `ActionItem`, while
   keeping `ApplyOSState.reminders: ActionItem[]` and cloud entity type
   `reminder`.
3. Add `ContactActivity`, `contact_activities`, the contact fields, settings,
   and enum constants defined in "Target data contract".
4. Add a v5-to-v6 migration in `shared/storage.js`:
   - convert `follow_up` to `application_follow_up`;
   - convert `final_follow_up` to `application_final_follow_up`;
   - fill titles from the linked application;
   - mark an item `done` when `completed_at` is present, otherwise `open`;
   - initialize all new nullable/default fields;
   - create one deterministic contact action from `next_action_at` only when no
     equivalent action exists;
   - create one deterministic interview action from `next_action` /
     `next_action_at` only when no equivalent action exists;
   - initialize `contact_activities` to an empty array;
   - translate the old final-follow-up boolean to `[7]` or `[7, 14]`;
   - leave desktop notifications disabled until permission is explicitly
     granted.
5. Make migration and normalization idempotent. Re-running `ensureState()` must
   not duplicate generated actions, rewrite timestamps, or increment revision.
6. Add a single projection helper that updates the three compatibility fields
   after every action mutation and during normalization.

**Verify**: `npm run typecheck && npm test` → exit 0; migration tests prove one
conversion per legacy record, stable IDs on repeated normalization, preserved
completion state, and correct compatibility projections.

### Step 2: Build one action lifecycle and configurable follow-up sequence

In `shared/storage.js` and `shared/followup.js`, add:

- `ApplyOS.listActions(filters)` or a pure equivalent returning effective due
  dates and deterministic Overdue/Today/Upcoming/Done grouping;
- `ApplyOS.upsertAction(input)`;
- `ApplyOS.completeAction(id)`;
- `ApplyOS.skipAction(id)`;
- `ApplyOS.cancelAction(id)`;
- `ApplyOS.snoozeAction(id, until)`;
- `ApplyOS.rescheduleAction(id, dueAt)`;
- `ApplyOS.buildApplicationFollowUpActions(application, appliedAt, offsets)`.

Requirements:

- All writes go through one `ApplyOS.mutateState` call.
- `markApplicationApplied` uses the configured offsets, removes/replaces only
  open system-generated application follow-ups, and never touches custom or
  completed history.
- Existing `completeReminder` and `rescheduleFollowUp` remain thin compatibility
  wrappers until every caller has moved.
- `refreshDueApplications` sets `follow_up_due` only for due, open application
  follow-up kinds. A due contact/interview/custom action must not change an
  application pipeline status.
- Completing or skipping the last due application follow-up returns
  `follow_up_due` to `applied` when appropriate.
- Invalid dates, dangling foreign keys, and impossible action records normalize
  safely; an action must retain at least one valid context link unless its kind
  is `custom`.
- Default follow-up draft greeting uses the selected contact's first name when
  present. Do not add a send function.

**Verify**: `npm test` → all tests pass, including lifecycle, snooze effective
date, reschedule, custom-action preservation, settings validation, due-status
isolation, and recipient-aware draft tests.

### Step 3: Add atomic contact activity and safe contact merge/import services

Add storage operations:

- `ApplyOS.logContactActivity(input, options)` — in one mutation, append the
  activity, set the contact's derived `last_contacted_at`, optionally complete
  the linked action, and optionally create the next action;
- `ApplyOS.updateContactActivity(id, patch)` for correcting a manual log;
- `ApplyOS.deleteContactActivity(id)`;
- `ApplyOS.mergeContacts(sourceId, targetId)` — preserve all unique application,
  interview, action, and activity links before deleting the source;
- a pure duplicate detector using normalized exact email first and normalized
  exact LinkedIn URL second. Names alone may suggest a duplicate but must never
  auto-merge.

Implement local CSV parsing in `dashboard.js` without a dependency:

- accept UTF-8 `.csv` files up to 2 MB and 500 data rows;
- support quoted fields and escaped quotes;
- preview and map columns for name, email, company, title, phone, LinkedIn,
  relationship, and tags;
- require a non-empty name for every imported row;
- show Create / Merge / Skip for every detected duplicate;
- perform no write until the user confirms the preview;
- display per-row validation errors without importing invalid rows.

Deletion behavior:

- deleting a contact requires confirmation, deletes its contact activities,
  cancels contact-only open actions, removes `contact_id` from application or
  interview actions that still have another context, and removes interview
  links;
- deleting an application cancels its open system-generated actions and clears
  `application_id` from retained contact activity history;
- completed/skipped history remains unless its owning contact is explicitly
  deleted.

**Verify**: `npm test` → all tests pass, including atomic log/complete/next,
derived last-contacted time, merge preservation, duplicate precedence, quoted
CSV, cap/size validation, and cascade behavior.

### Step 4: Sync contact activity as an owner-only cloud record

1. Add `contact_activity` to `CloudEntityType`,
   `shared/cloud-repository.js` entity allowlists, private entity types,
   projection, and `background.js` materialization.
2. Keep actions under the existing `reminder` cloud type. Do not introduce an
   `action` cloud type in this plan.
3. Create the additive migration
   `supabase/migrations/202607310001_contact_activity_records.sql`. Do not edit
   already-applied migrations. The new migration must:
   - replace the `private_records.record_type` check to admit
     `contact_activity`;
   - replace the `workspace_changes.entity_type` check to admit it;
   - update every entity-type allowlist in authoritative mutation, legacy
     claim, and provenance RPCs;
   - preserve current payload-size, owner, idempotency, tombstone, and conflict
     rules;
   - grant no new anonymous access.
4. Add a friendly `contact_activity` conflict label in `account.js` without
   rendering activity summary/private payload text on the conflict overview.
5. Update cloud tests for projection, materialization contract, tombstones,
   same-record conflict behavior, and cross-account RLS isolation.

**Verify**:

```sh
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
npm test
```

Expected: every command exits 0; pgTAP proves owner read/write and cross-account
denial for contact activity; JavaScript tests prove it survives cloud
projection/pull without contaminating another user cache.

### Step 5: Replace the eight-card strip with a real Today workspace

In all full-page headers, add a **Today** link to
`dashboard.html?section=actions`. Preserve shareable URLs and `aria-current`.

In `dashboard.html`, `dashboard.js`, and `dashboard.css`:

- create a dedicated actions workspace rather than stretching the current
  horizontal `#upcoming` strip;
- group items into Overdue, Today, Upcoming, and Done;
- include a count in each group and a useful empty state;
- add kind, priority, channel, and linked-application/contact filters;
- add text search and deterministic sort by effective due date, then priority,
  then creation time;
- provide inline Done, Snooze, Reschedule, Skip, and Open context actions;
- add a keyboard-accessible quick-add action form;
- render application deadlines and interview schedule dates as read-only agenda
  items, clearly distinct from completable actions;
- deep-link an individual action with
  `dashboard.html?section=actions&action=<id>`;
- make the application page's compact "Next Actions" area show only the next
  three items plus a link to Today.

Do not remove the Applications or Contacts workspaces. Keep focus restoration,
`inert`, dialog labels, and live-region behavior consistent with the existing
drawers.

**Verify**: `npm run lint && npm run typecheck && npm test` → exit 0; DOM
contract tests cover all three nav surfaces, grouping, empty state, action
deep-link, and accessible dialog state.

### Step 6: Turn Contacts into a usable relationship workspace

Upgrade the Contacts page and drawer:

- offer list and card views;
- filter by relationship, company, tag, and overdue/has-next-action state;
- sort by next action, last contacted, and name;
- show overdue and due-today states visibly, not only as a date string;
- show phone, preferred channel, tags, linked roles, next open action, and last
  contacted;
- add a chronological timeline with activity type, direction, date, subject,
  summary, outcome, and linked role/interview;
- add **Log interaction**, **Create action**, **Merge duplicate**, and
  **Import CSV** flows;
- keep email and LinkedIn navigation explicit and user-initiated.

Compose behavior:

- clicking Gmail/Outlook/mailto only opens the reviewed draft;
- after a compose handoff, show a non-blocking prompt:
  **Log this interaction** / **Not yet**;
- the log form is prefilled but editable and must be confirmed;
- confirmation can complete the originating action and schedule a next action;
- closing the prompt records nothing.

Interview behavior:

- saving a scheduled interview offers visible, editable prep and thank-you
  actions before commit;
- interview changes update the corresponding open system actions without
  rewriting completed history;
- deleting an interview cancels its open system actions;
- thank-you drafts remain reviewed and manual.

**Verify**: `npm run build && npm run test:browser:dist` → exit 0; the browser
test creates/imports and merges contacts, logs an interaction, completes an
action, schedules the next one, verifies the timeline after reload, and proves
that merely opening a compose URL creates no activity.

### Step 7: Deliver opt-in, generic desktop reminders

1. Add `"notifications"` to `optional_permissions`, not required
   `permissions`, in `manifest.json`.
2. Replace the settings checkbox copy with:
   - badge/in-product reminder toggle;
   - desktop notification enable button that calls
     `chrome.permissions.request({ permissions: ["notifications"] })` only
     inside its click handler;
   - daily digest time;
   - configurable follow-up offsets.
3. In `background.js`, schedule the next wake-up from the earliest effective
   due action plus a daily digest safety alarm. Keep one periodic recovery alarm
   so service-worker suspension or clock changes cannot lose reminders.
4. Create one generic notification such as "3 Scout actions are due." Do not
   put contact names, companies, message summaries, notes, or interview details
   in the OS notification.
5. Set `last_notified_at` only after `chrome.notifications.create` succeeds.
   Do not notify the same still-open action more than once in 24 hours.
6. Notification click opens/focuses
   `dashboard.html?section=actions`; button support is optional, but no action
   may be completed from the notification.
7. If permission is denied or revoked, turn off the desktop setting, keep the
   badge/in-product inbox working, and show a clear settings status.

Extract notification selection/scheduling into pure functions testable with
fixed timestamps. Mock Chrome alarms, permissions, notifications, tabs, and
windows in `tests/action-notifications.test.mjs`; do not rely only on a manual
Chrome test.

**Verify**: `npm test` → notification tests pass for permission absent/denied,
due selection, 24-hour dedupe, generic copy, next-alarm calculation, and
deep-link behavior.

### Step 8: Complete backup, privacy, documentation, and release regression

1. Ensure encrypted backup/restore includes schema-v6 actions and contact
   activities automatically and that `backupSummary` reports open actions and
   activity count. Update the options preview copy.
2. Update product and privacy documentation accurately at a category level:
   Scout stores private action and relationship activity data in the user's
   owner-only workspace and cache; notification text is generic; CSV processing
   is local; external services are opened only on user action.
3. Keep in-product microcopy concise. Do not enumerate every stored field in a
   compose prompt, but do not obscure the feature in the privacy policy or use
   wording that would make the disclosure misleading.
4. Update `docs/extension-permissions.md` for the optional notifications
   permission and Chrome Web Store disclosure.
5. Expand `scripts/browser-test.mjs` to cover the complete product contract,
   including persistence after reload and cloud projection of activity.
6. Retain explicit negative assertions that Scout exposes no send API and does
   not create history from a compose-link click.

**Verify**:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser:dist
npm run db:test
npm run db:lint
git status --short
```

Expected: all commands exit 0; only the in-scope files are modified; no release
archive is created or changed.

## Test plan

Add at least these regression cases:

- v5 reminder/contact/interview next-action migration to v6 is lossless and
  idempotent;
- action normalization rejects invalid kinds/statuses/dates and dangling links;
- configurable offsets create the expected system actions and preserve custom
  or completed actions;
- Overdue/Today/Upcoming/Done grouping is timezone-safe at day boundaries;
- snooze versus reschedule semantics are distinct;
- due contact/interview actions do not change application status;
- log interaction + complete action + create next action is atomic;
- editing/deleting activity recalculates `last_contacted_at`;
- deleting and merging contacts preserves or removes references exactly as
  specified;
- CSV parser handles quoted commas/quotes, missing names, duplicates, 500-row
  cap, and all-or-reviewed import;
- contact activity projects, syncs, tombstones, conflicts, exports, restores,
  and remains owner-only under RLS;
- opening compose links creates no activity; confirmed manual logging does;
- desktop permission is requested only from settings click;
- notification text contains no contact/company/activity detail;
- denied/revoked permission falls back to the inbox and badge;
- notification click deep-links to Today;
- browser flow persists actions and activity after dashboard reload.

Model new storage tests after `tests/applyos.test.mjs:227-350`, cloud tests after
`tests/cloud-repository.test.mjs`, RLS assertions after
`supabase/tests/001_rls.sql`, and the full UI flow after
`scripts/browser-test.mjs:720-815`.

## Done criteria

- [ ] Schema v6 is explicit, idempotent, and preserves all existing reminder,
      contact, and interview data.
- [ ] One action lifecycle powers application, contact, and interview work.
- [ ] Today shows all due work and supports Done, Snooze, Reschedule, Skip, and
      context navigation.
- [ ] Contacts have a persistent activity timeline, next action, filters,
      duplicate merge, and reviewed CSV import.
- [ ] Compose handoffs never create activity without explicit confirmation and
      never send a message.
- [ ] Desktop notifications are optional, generic, deduplicated, and deep-link
      to Today.
- [ ] Contact activity is synced as an owner-only private record and covered by
      RLS, conflict, tombstone, export, and deletion tests.
- [ ] Backup/restore and summaries include the new records.
- [ ] Product, permission, and privacy documentation match behavior.
- [ ] `npm run verify` exits 0.
- [ ] `npm run db:test` and `npm run db:lint` exit 0.
- [ ] `git status --short` lists no file outside Scope.
- [ ] `advisor-plans/README.md` marks Plan 008 DONE only after all gates pass.

## STOP conditions

Stop and report; do not improvise if:

- The pre-dispatch worktree is dirty or contains changes the executor cannot
  confidently attribute.
- Current code no longer matches the data, cloud, dashboard, or notification
  excerpts above.
- Implementing contact activity appears to require loosening RLS, allowing
  anonymous writes, or exposing activity payloads outside the owner workspace.
- Chrome requires `notifications` as a non-optional permission for the proposed
  implementation.
- A compose provider requires mailbox OAuth or a send permission.
- Correct timezone handling would require storing only date strings; action
  due times must remain valid ISO instants with local-day presentation.
- The schema migration duplicates actions on its second run.
- Cloud materialization drops current records, crosses account caches, or
  requires editing already-applied migration files.
- CSV import cannot be implemented with a preview and explicit duplicate
  decision before writes.
- Any verification command fails twice after one reasonable correction.
- The change requires touching a source file outside Scope.

## Maintenance notes

- `state.reminders` and cloud entity type `reminder` intentionally remain
  compatibility names. A later breaking migration may rename them only after
  mixed-version cloud clients and backup compatibility have a dedicated plan.
- Contact activity is append-oriented but editable because users need to
  correct mistakes. Reviewers should scrutinize concurrent activity creation
  and merge behavior across two devices.
- OS notification copy must stay generic even if richer content seems useful;
  the dashboard is the place for private detail.
- If calendar or mailbox integrations are proposed later, require a separate
  permission/privacy plan. They are not a natural extension of compose links.
- Review the final UI with real datasets: at least 50 contacts, 100 actions, and
  200 activity records. This is a usability check, not permission to add demo
  data to production state.
