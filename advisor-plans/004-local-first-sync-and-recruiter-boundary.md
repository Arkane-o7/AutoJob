# Plan 004: Sync the complete workspace without exposing private data to recruiters

> **Executor instructions**: Execute in order, run each verification, and stop
> on any STOP condition. Update this plan's status in
> `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- shared/storage.js shared/profiles.js shared/graph.js shared/backup.js background.js options.html options.js account.html account.js types/applyos.ts types/cloud.ts supabase/migrations supabase/tests`
> Confirm Plans 002 and 003 are DONE before proceeding.

## Executor prompt

> Implement opt-in, local-first cloud sync for every ApplyOS workspace entity.
> Keep `chrome.storage.local` as the offline source for UI/autofill, add a durable
> outbox and server change cursor, bind each local workspace to one authenticated
> account, and implement deterministic first-sync, retry, deletion, and conflict
> behavior. Sync profiles, applications, reminders, contacts, interviews, answer
> memory, learned answers, resume metadata/opted-in files, settings, onboarding
> progress, and graph snapshots. Never upload before explicit consent and never
> silently overwrite existing local/cloud data. Create a separate candidate
> publication editor/contract, private by default; recruiters must never see the
> private workspace. Add export and account-deletion flows. Follow all scope,
> tests, verification, and STOP rules in this plan.

## Status

- **Priority**: P0
- **Effort**: L (7–12 engineering days)
- **Risk**: HIGH — migration, account mix-up, conflict, and privacy-loss risk
- **Depends on**: Plans 002 and 003
- **Category**: architecture / correctness / security
- **Planned at**: commit `3841724`, reconciled 2026-07-17

## Why this matters

A database is not useful if the extension can lose offline edits, merge two
people's local workspaces, or expose the wrong data to recruiters. The safest
fit for this codebase is local-first sync: existing extension surfaces continue
reading the normalized local state, while the background worker pushes/pulls
owner-scoped changes when authenticated and online.

Recruiter discovery is a separate product boundary. The user's application
history, contacts, answers, interview notes, corrections, and private resume are
job-search activity—not a recruiter data source.

## Current state

- `shared/storage.js:283-290` reads/writes the complete main state directly in
  `chrome.storage.local`.
- `shared/storage.js:340-348` serializes local writes and increments one revision
  but emits no entity change log.
- `shared/storage.js:357-473` mutates applications/reminders locally.
- `shared/storage.js:482-563` mutates answer memory and learned answers locally.
- `shared/storage.js:582-630` mutates contacts/interviews locally.
- `shared/profiles.js:25-99` stores profiles outside `applyos_state`.
- `shared/graph.js:37-53` stores a graph snapshot outside `applyos_state`.
- `shared/backup.js:10-16` proves a complete workspace spans multiple keys.
- `background.js:45-51` already initializes local stores and has an hourly alarm,
  making it the natural sync coordinator.
- `options.html:168-193` and `shared/backup.js` provide encrypted manual export and
  restore, which must remain available independently of cloud sync.

## Sync contract

Create an outbox under a new local key, separate from `applyos_state`:

```text
change_id, device_id, entity_type, entity_id, operation(upsert|delete),
base_server_version, payload, local_updated_at, attempt_count, next_attempt_at
```

The server apply endpoint/RPC must be idempotent by `change_id` and return one of:

- `accepted` with new `server_version`;
- `already_applied` with current version;
- `conflict` with current server record/version;
- `rejected` with a stable validation code.

Pull by a monotonic server change cursor, not client clock. Deletions require
tombstones long enough for other devices to observe them. Do not use bare
last-write-wins based only on client timestamps.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint/type/tests | `npm run lint && npm run typecheck && npm test` | exit 0 |
| Database rebuild/test | `npm run db:reset && npm run db:test` | migrations and RLS tests pass |
| Build/browser | `npm run build && npm run test:browser:dist` | exit 0 |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**:

- `shared/storage.js`, `shared/profiles.js`, `shared/graph.js`, `shared/backup.js`
- `shared/sync.js` or `src/cloud/sync.ts` plus account runtime integration
- `background.js`
- `account.html`, `account.css`, `account.js`
- `options.html`, `options.js` only for sync/export/delete controls
- `types/applyos.ts`, `types/cloud.ts`
- Plan-004-specific `supabase/migrations/*.sql`, Edge Functions/RPCs, and tests
- `tests/sync.test.mjs`, database tests, browser-test additions
- README/privacy docs and `scripts/build.mjs` if new runtime files are added

**Out of scope**:

- Recruiter search UI, recruiter onboarding, organizations, or shortlist UI.
- Automatic LinkedIn imports.
- Automatic cloud AI, billing, analytics, or telemetry.
- Removing encrypted local backup or local-only mode.
- Making candidate publications visible by default.

## Git workflow

- Branch: `codex/004-local-first-sync`
- Commit by layer: server contract/tests, local outbox, sync engine, first-sync UX,
  publication boundary, deletion/export, browser tests.
- Do not push or run migrations against production until staging tests pass.

## Steps

### Step 1: Add workspace ownership and migration state

Extend local settings with:

- `workspace_owner_id`: `null` for legacy/local-only, auth UUID after linking.
- `cloud_sync_enabled`: false by default.
- `sync_schema_version`, `last_server_cursor`, `last_successful_sync_at`.
- `device_id`: random local installation UUID, not a hardware fingerprint.

On first sign-in, count local/cloud records and show a blocking choice:

1. **Upload this local workspace** when cloud is empty.
2. **Download cloud workspace** when local is empty.
3. **Review merge** when both contain records.
4. **Stay local** and do not link/upload.

Never infer the choice. Once linked, a different auth user cannot read or merge
the existing local workspace. Offer export + clear, or sign back into the owner.

**Verify**: tests cover legacy local-only, first owner link, same-owner return,
different-account rejection, canceled migration, and zero network writes before
consent.

### Step 2: Instrument local mutations with a durable outbox

Add a sync-aware mutation path that compares the previous and next normalized
collections by entity ID and queues upserts/deletes only after the local write
succeeds. Add an `origin: "remote"` mode so pulled changes do not enqueue
themselves. Instrument profile writes and graph snapshot writes separately.

Queue changes for:

- job profiles/index;
- applications, reminders, contacts and contact links;
- interviews and interviewer links;
- answer memory and learned answers;
- resume metadata;
- settings/onboarding progress;
- graph snapshot.

Outbox writes must be serialized with local state writes or recoverable by a
reconciliation scan. A service-worker suspension between data write and queue
write must not permanently lose a change.

Before migrating contact relations, fix the existing multi-link truncation:
`types/applyos.ts:150` supports multiple `application_ids`, but
`dashboard.js:264` displays only the first and `dashboard.js:411` replaces the
array with zero or one on save. Add a real link/unlink or multi-select UI and a
regression test proving that editing a contact linked to two applications keeps
both links. Then map those relations to `contact_applications` join rows.

**Verify**: crash-window characterization tests simulate failure before/after
queue persistence and prove reconciliation restores missing changes without
duplicating accepted ones.

### Step 3: Implement idempotent server apply/pull operations

Add database functions or Edge Functions that validate authenticated ownership,
allowed fields, payload sizes, enums, foreign-key ownership, and base version.
Store processed `change_id` values and append server change records with a
monotonic cursor. Service-role access remains server-side only.

Use exponential retry with jitter and a cap. Classify errors:

- retryable: offline, 429, 5xx, transient token refresh;
- blocked: auth revoked, ownership mismatch, schema version too new;
- rejected: invalid payload; preserve locally and show a repair message.

**Verify**: DB/integration tests replay the same change, deliver changes out of
order, attempt cross-user references, and test token expiry/retry.

### Step 4: Implement deterministic pull and conflicts

Apply remote changes under the existing local storage lock. When a local pending
change and newer server change touch the same entity:

- Automatically merge only disjoint safe fields when both base versions match a
  known ancestor.
- For competing edits, preserve the local record, store the server variant in a
  conflict record, and show a user choice in Account & Sync.
- Never duplicate linked contacts/interviews or silently discard notes/answers.
- Deletes conflict with local pending edits and require review.

**Verify**: two-device tests cover independent updates, same-field conflicts,
delete-versus-edit, relation creation order, duplicate delivery, and interrupted
pull replay.

### Step 5: Handle profile and resume privacy explicitly

Profile JSON remains private owner data. Resume binary upload is opt-in with a
separate switch and clear size/type information. Store files only in the private
owner path from Plan 002. Do not convert private object paths into public URLs.

Keep the current local encrypted backup fully functional. Update backup keys so
sync ownership/outbox metadata is either excluded from portable backup or
sanitized/rebound on restore; never restore one account's auth/session tokens.

**Verify**: backup round-trip still passes; restored data does not inherit auth
tokens, device ID, owner ID, cursor, or accepted change IDs.

### Step 6: Add explicit candidate publication

Add an Account page section that previews a limited publication snapshot. Every
field has an individual include/exclude control and visibility remains `private`
until the user confirms publication. Provide Withdraw, which removes recruiter
visibility without deleting the private job profile.

Never include or derive:

- application companies/statuses/notes;
- contact CRM or interview details;
- expected salary unless separately and explicitly added later;
- answer memory, learned corrections, graph data;
- private resume file/object path;
- street address, phone, or full date history by default.

In this plan there is no recruiter read policy. The publication contract is
created and tested for later shortlist work only.

**Verify**: publication tests prove private default, per-field allowlist, no
trigger-based auto-publication, and Withdraw behavior.

### Step 7: Add sync status, export, and deletion lifecycle

Account & Sync must display local-only/syncing/synced/offline/conflict/error,
pending change count, and last successful time. Add manual Sync Now and Pause
Sync. Pausing stops network activity without deleting local or cloud data.

Add:

- server-side account export containing documented user-owned data;
- authenticated account deletion request with recent-session check;
- cascade deletion of workspace/publication/storage objects;
- local cleanup choice after server deletion;
- clear progress and retry-safe deletion status.

Do not claim deletion is complete until storage and auth records are removed.

**Verify**: staging test creates data in every table/storage bucket, exports it,
deletes the account, and verifies no owner rows/objects remain.

### Step 8: Update product/privacy copy

Replace unconditional "LOCAL DATA"/"everything stays in browser" claims with
state-aware language:

- local-only mode: stays on device;
- sync enabled: selected data is sent to the private cloud workspace;
- recruiter publication: only explicitly selected publication fields can later
  become searchable.

Update README, onboarding, Account, Options, dashboard header, Smart Studio, and
Web Store disclosure checklist. Do not hide the transmission behind a terms link.

**Verify**: `rg -n "LOCAL DATA|stays on this device|stays in the browser|no backend" README.md *.html *.js`
returns only contextually true statements.

### Step 9: Run full offline/multi-device/browser verification

Run `npm run verify`, database tests, and a staging matrix:

- new empty account;
- legacy local workspace upload;
- cloud workspace download;
- non-empty merge;
- browser offline edit and recovery;
- Chrome/service-worker restart during sync;
- two devices editing same and different records;
- sign out/sign in same user;
- attempted different-account switch;
- resume sync on/off;
- export and deletion;
- publication preview/private/withdraw.

Record sanitized results in `docs/testing/cloud-sync-matrix.md`.

## Test plan

- Unit: diff/outbox generation, idempotency keys, retry schedule, cursor handling,
  conflict reducer, account binding, backup sanitization.
- DB/integration: apply/pull ownership, versions, tombstones, duplicate replay,
  cross-user denial, deletion cascade, storage ownership.
- Browser: first-sync choices, status states, conflict UI, offline behavior,
  publication controls, account-switch guard.
- Manual staging: real restart/two-profile workflow and complete deletion.

## Done criteria

- [ ] No record uploads before explicit sync consent.
- [ ] Every current workspace entity syncs or is explicitly documented local-only.
- [ ] Editing a contact preserves all application links before/after migration.
- [ ] Offline writes survive and eventually sync exactly once.
- [ ] Conflicting edits are preserved and reviewable.
- [ ] Different accounts cannot inherit/merge the same local workspace silently.
- [ ] Resume upload is private and opt-in.
- [ ] Recruiter publication is separate, allowlisted, and private by default.
- [ ] Export and complete account deletion pass staging tests.
- [ ] Local encrypted backup remains functional and excludes auth/sync identity.
- [ ] All DB and `npm run verify` gates pass.

## STOP conditions

- A merge policy would silently discard notes, answers, contacts, or interviews.
- Account ownership cannot be enforced before local data is displayed/uploaded.
- Any recruiter policy needs access to private workspace tables.
- Resume objects would require public bucket access.
- Deletion cannot remove all table rows/storage objects/auth records.
- Real cloud operations require a service-role key in the extension.

## Maintenance notes

New syncable entities must define IDs, ownership, versioning, tombstones,
payload limits, conflict behavior, export/deletion behavior, and tests. Future
recruiter shortlists must reference publication IDs only and must not relax
private workspace RLS.
