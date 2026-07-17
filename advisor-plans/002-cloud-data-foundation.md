# Plan 002: Establish a secure cloud data foundation for the complete ApplyOS workspace

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result. If a STOP condition
> occurs, stop and report it instead of improvising. Update the status row in
> `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- package.json package-lock.json shared/constants.js shared/storage.js shared/profiles.js shared/graph.js shared/backup.js types/applyos.ts README.md`
> Reconcile schema changes before creating migrations.

## Executor prompt

> Add a Supabase-based cloud data foundation to ApplyOS without changing current
> extension behavior yet. Create version-controlled migrations, RLS policies,
> private resume storage policies, database tests, generated/maintained cloud
> contracts, and an architecture decision record. Map every current local entity
> to an owner-scoped cloud representation while preserving existing text IDs.
> Create a separate candidate-publication table whose default is private; never
> expose applications, contacts, answers, correction memory, or interview notes
> to recruiters. Do not add login UI or sync in this plan. Never place service
> credentials or the LinkedIn client secret in the repo. Follow this plan's exact
> scope, verification gates, and STOP rules.

## Status

- **Priority**: P0
- **Effort**: L (4–7 engineering days)
- **Risk**: MED — incorrect RLS can expose sensitive candidate data
- **Depends on**: Plans 000 and 001
- **Category**: security / architecture / direction
- **Planned at**: commit `3841724`, reconciled 2026-07-17

## Why this matters

Today all data is an unscoped local blob. A cloud database introduces users,
ownership, deletion, migrations, and authorization, and future recruiter search
makes an accidental privacy leak especially costly. The data model and RLS
tests must exist before account or sync code can safely call the backend.

Supabase is recommended for this stage because one system provides LinkedIn
OIDC integration, Postgres, RLS, private object storage, and Edge Functions.
The extension may contain the project URL and publishable key, but never a
service-role key or provider client secret.

## Current state

- `shared/constants.js:6-8` defines the tested local schema v5 baseline.
- `shared/storage.js` contains explicit migrations through v5, runtime
  normalization, serialized mutation, and no-op write suppression.
- `shared/storage.js:237-270` normalizes one state object containing
  applications, reminders, answer memory, learned answers, resume versions,
  contacts, interviews, and settings.
- `shared/storage.js` serializes local mutations and increments one
  workspace-wide revision only when normalized state changes.
- `shared/profiles.js:6-18` stores a profile index separately from the main
  state; profile IDs are readable strings with timestamp suffixes.
- `shared/graph.js` stores the answer knowledge graph under a third local key and
  serializes concurrent writes.
- `shared/backup.js:10-16` lists the current complete-workspace storage keys.
- `types/applyos.ts:72-199` defines the current application, reminder, answer,
  contact, interview, and state contracts.
- `types/applyos.ts:221-276` defines multi-profile metadata and flexible private
  profile content.
- `README.md:46` explicitly says there is no backend or analytics.

## Target data model

Use SQL migrations under `supabase/migrations/`. Preserve local entity IDs as
`text` and use composite primary keys `(user_id, id)` where needed; this avoids
breaking current references such as `app_<uuid>` and profile slugs.

All private tables include `user_id uuid not null references auth.users(id) on
delete cascade`, `created_at`, `updated_at`, `deleted_at`, and `server_version
bigint not null default 1`. Add indexes on `(user_id, updated_at)` and foreign-key
columns used by sync.

| Table | Purpose and minimum shape |
|---|---|
| `app_accounts` | one row per auth user; display name, avatar URL, account status; candidate role by default |
| `devices` | owner-scoped installation/device IDs, last seen, last sync cursor; never store raw auth tokens |
| `job_profiles` | current profile metadata plus private `profile_data jsonb`; preserve flexible profile fields |
| `applications` | explicit current application fields from `ApplicationRecord`, including the `profile_id` used for matching/filling; arrays/maps may be `jsonb` |
| `reminders` | application FK, type, due/completed timestamps |
| `contacts` | current contact fields; application links use `contact_applications` join rows rather than one array |
| `interviews` | current interview fields; interviewer links use `interview_contacts` join rows |
| `answer_memory` | remembered question/answer pairs, owner-only |
| `learned_answers` | field fingerprints and corrections, owner-only |
| `resume_versions` | metadata and optional private Storage object path; no public URL |
| `knowledge_graph_snapshots` | owner-scoped versioned graph JSON for initial sync; normalize later only if query needs justify it |
| `user_settings` | final follow-up, notifications, sync preferences, and local/cloud mode |
| `onboarding_progress` | tour version, last step, completed timestamp |
| `candidate_publications` | separate user-approved recruiter-searchable snapshot; visibility defaults to `private` |

`candidate_publications` must contain only intentionally publishable fields such
as headline, target roles, coarse location, skills, experience summary, work
authorization preference when explicitly selected, portfolio/LinkedIn URLs when
selected, and publication timestamps. It must never be populated by a database
trigger that copies the private profile automatically.

Do not create recruiter organizations or shortlists yet. Record their future
contract in the ADR: shortlists will reference `candidate_publications`, never
private workspace tables, and recruiter role assignment will require a later
organization/invite verification design.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Existing lint | `npm run lint` | exit 0 |
| Existing types | `npm run typecheck` | exit 0 |
| Existing tests | `npm test` | 30 or more pass |
| Start local backend | `npx supabase start` | local services start; exit 0 |
| Rebuild DB | `npx supabase db reset` | all migrations apply from zero |
| Database tests | `npx supabase test db` | all pgTAP/RLS tests pass |
| DB lint | `npx supabase db lint --level warning` | no schema errors; reviewed warnings only |

If the pinned Supabase CLI version uses a changed command, update the npm script
and this plan's verification table together; do not silently skip the test.

## Scope

**In scope**:

- `supabase/config.toml` and `.gitignore` entries for local Supabase state
- `supabase/migrations/*.sql`
- `supabase/tests/*.sql`
- `docs/adr/0001-cloud-data-and-privacy-boundary.md`
- `docs/cloud-schema.md`
- `types/cloud.ts` (create; contracts only)
- `package.json` and `package-lock.json` for pinned CLI/test scripts if needed
- `.env.example` containing names/placeholders only

**Out of scope**:

- Real credentials, linked project refs, `.env` values, production data, or
  provider secrets.
- Extension login UI, OAuth flow, session persistence, sync engine, support
  endpoint, recruiter UI, shortlist tables, AI endpoints, or billing.
- Changing existing local storage behavior or whichever local schema Plan 000
  finalizes.

## Git workflow

- Branch: `codex/002-cloud-data-foundation`
- Suggested commits: `docs: decide cloud data boundary`, `feat: add cloud schema
  migrations`, `test: enforce cloud row ownership`
- Do not link/push a production Supabase project from automation.

## Steps

### Step 1: Record the architecture decision and data classification

Create the ADR with:

- Supabase choice and alternatives considered.
- Local-first cache plus opt-in sync; cloud is not required for autofill.
- Transport/provider-at-rest encryption wording; no end-to-end claim.
- Private workspace versus candidate publication boundary.
- Data classes: authentication, basic account, profile PII, resumes, job-search
  activity, contacts, interview notes, learned answers, diagnostics.
- Retention/export/deletion expectations.
- No recruiter query path to private tables.
- No service-role key in browser code.

**Verify**:
`rg -n "local-first|candidate publication|service-role|end-to-end|retention|deletion" docs/adr/0001-cloud-data-and-privacy-boundary.md`
shows every decision.

### Step 2: Initialize version-controlled local Supabase tooling

Add CLI configuration without linking any real project. Add package scripts
named `db:start`, `db:reset`, `db:test`, and `db:lint`. Add only variable names
to `.env.example`, for example project URL and publishable key placeholders.
Explicitly comment that the service role and LinkedIn secret are server/provider
secrets and must not be extension build variables.

**Verify**: `git grep -nE "service_role|client_secret" -- ':!advisor-plans/**'`
contains documentation/placeholder names only and no values.

### Step 3: Create private workspace migrations

Create enums/check constraints and tables in dependency order. Use foreign keys
that include `user_id` so one user's join row cannot point at another user's
entity. Add updated-at/version triggers with a fixed `search_path`. Use soft
deletion for syncable records and cascade hard deletion from `auth.users` for
account deletion.

Do not store binary resumes in Postgres. Create a private `resumes` bucket with
path ownership convention `<user_id>/<resume_id>/<filename>` and MIME/size
limits for PDF/DOC/DOCX matching current extension behavior.

**Verify**: `npx supabase db reset` exits 0 from an empty local database.

### Step 4: Add RLS and grants for every exposed table/storage object

Enable RLS explicitly. For private rows, `select/insert/update/delete` policies
must require `auth.uid() = user_id`, with both `using` and `with check` where
appropriate. Grant nothing useful to unauthenticated `anon` users. Do not expose
views that bypass RLS.

For `candidate_publications`, owners may manage their row, but recruiter reads
remain disabled in this plan. Visibility defaults to `private` and publication
requires an explicit later action.

**Verify**: query `pg_class`/`pg_policies` in a pgTAP test and fail if any public
table lacks RLS or an ownership policy.

### Step 5: Write adversarial database tests

Create pgTAP tests for two users plus anonymous context. Cover:

- User A CRUD succeeds on each private table.
- User B cannot select/update/delete User A rows.
- User B cannot create join rows referencing User A entities.
- Anonymous users cannot access any private or publication rows.
- `candidate_publications.visibility` defaults to private.
- Resume object paths cannot cross user IDs.
- Deleting an auth user cascades workspace rows.
- Invalid status/relationship/interview enum values are rejected.

**Verify**: `npx supabase test db` exits 0 with all tests passing.

### Step 6: Add cloud contracts and schema documentation

Create `types/cloud.ts` with cloud row, sync envelope, conflict, and publication
types. Keep these separate from `types/applyos.ts` until Plan 004 implements the
mapper. Document table-to-local mappings, private/public classification, indexes,
and deletion behavior in `docs/cloud-schema.md`.

**Verify**: `npm run typecheck` exits 0.

### Step 7: Run the complete gate

Run:

```sh
npm run lint
npm run typecheck
npm test
npm run db:reset
npm run db:test
npm run db:lint
```

All commands must exit 0. A reviewed CLI warning must be documented in the ADR;
do not hide warnings by weakening the lint level.

## Test plan

- Database: owner isolation, anon denial, cross-owner FK denial, private default,
  storage object ownership, cascade deletion, and constraints.
- Type contracts: `types/cloud.ts` compiles under existing strict no-emit config.
- Existing local tests remain unchanged and pass.

## Done criteria

- [ ] Supabase can be rebuilt from zero using committed migrations.
- [ ] Every current local entity has a documented cloud representation.
- [ ] Every exposed table has RLS and automated owner-isolation tests.
- [ ] Resume storage is private and owner-scoped.
- [ ] Candidate publication is separate and private by default.
- [ ] No recruiter/anonymous read path exists yet.
- [ ] No secret or real environment value is committed.
- [ ] All existing and new verification commands pass.
- [ ] Only in-scope files plus the plan status row changed.

## STOP conditions

- Docker/local Supabase cannot run after one documented setup attempt.
- A current entity or relationship cannot be mapped without changing runtime
  behavior; report the mismatch for Plan 004.
- The chosen provider cannot support LinkedIn OIDC in the target region/project.
- Any policy requires a service-role key in the extension.
- The implementation would expose private candidate data to recruiter queries.

## Maintenance notes

Treat migrations and RLS tests as production code. Any future recruiter, AI, or
billing table needs an explicit owner/organization model and adversarial tests.
Never broaden candidate-publication visibility by changing a default alone.
