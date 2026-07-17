# Plan 006: Replace public GitHub issues with private, reviewed support reports

> **Executor instructions**: Follow the plan step by step, run every verification
> gate, and stop on STOP conditions. Update the status row in
> `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- shared/diagnostics.js content.js content.css popup.js README.md tests/submission-diagnostics.test.mjs scripts/browser-test.mjs supabase/migrations supabase/functions`
> Confirm Plans 002 and 003 are DONE.

## Executor prompt

> Remove the public GitHub issue handoff from ApplyOS and replace it with a
> private support-report pipeline. Preserve the existing explicit field
> selection, sanitization, preview, copy, and download behavior. Add description,
> expected/actual behavior, and explicit submission consent. Send signed-in
> reports through a validating, authenticated, rate-limited Supabase Edge
> Function into an owner/private support table and return a short report ID.
> Signed-out/offline users retain copy/download and get a clear sign-in/retry
> option; never permit anonymous direct table inserts. Store no full page URL,
> query parameters, field values, resume data, auth tokens, or repo URL. Update
> unit/browser/database tests and remove all runtime references to the public
> GitHub repo. Follow all scope and STOP rules in this plan.

## Status

- **Priority**: P0
- **Effort**: M (3–5 engineering days)
- **Risk**: MED — diagnostics can contain sensitive context and endpoint abuse is possible
- **Depends on**: Plans 002 and 003
- **Category**: security / direction / tests
- **Planned at**: commit `3841724`, reconciled 2026-07-17

## Why this matters

Current diagnostics are strongly sanitized and user-reviewed, but the final
button exposes the repository and creates a public issue. A private first-party
pipeline preserves user review while keeping the repo private and giving ApplyOS
a controlled retention, triage, rate-limit, and deletion path.

This plan addresses manual site-compatibility reports. Do not silently add broad
analytics or automatic browsing/error telemetry as part of it.

## Current state

- `shared/diagnostics.js:6-39` allowlists structural attributes and redacts URLs,
  emails, token-like strings, phone numbers, and data URLs.
- `shared/diagnostics.js:53-81` drops hidden fields, bounds field count, and keeps
  only domain/platform/version/selected structural records.
- `shared/diagnostics.js:84-130` constructs a public issue URL containing the
  hardcoded repository `Arkane-o7/AutoJob`.
- `content.js:1188-1208` opens a privacy-review dialog and makes users choose the
  fields to include.
- `content.js:1250-1274` labels the destination a public GitHub issue and enables
  the report button only after explicit field selection.
- `content.js:1279-1295` supports copy/download and opens the GitHub report.
- `popup.js:221-229` describes the GitHub handoff after opening review.
- `tests/submission-diagnostics.test.mjs:62-80` currently asserts the public repo
  URL, and `scripts/browser-test.mjs:302-326` exercises the reviewed handoff.

## Private report contract

Add `support_reports` via a new migration with:

- `id uuid`, short human-facing `reference_code` generated server-side;
- `user_id uuid` from the verified JWT, nullable only if a future separately
  approved anonymous design is implemented (not in this plan);
- `created_at`, `extension_version`, `source_domain`, `platform`;
- bounded `description`, `expected_behavior`, `actual_behavior`;
- sanitized `diagnostic_payload jsonb`;
- private operational `status`, `resolution_note`, `retain_until`.

Do not grant direct insert/select/update access to normal extension clients. The
Edge Function verifies the JWT, validates/redacts again, enforces payload size
and per-user rate limits, inserts using a server-side credential, and returns
only `{ok, referenceCode}`. Triage can use the private Supabase dashboard at
launch; a separate admin UI is not required here.

Recommended limits:

- description/expected/actual: 2,000 characters each;
- at most 80 fields, with per-label/attribute bounds matching diagnostics;
- total JSON request body: 64 KiB;
- no more than 5 accepted reports per user per hour and 20 per day;
- 90-day default retention unless an active investigation requires an explicitly
  documented extension.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm test` | diagnostic and existing tests pass |
| DB/RLS tests | `npm run db:reset && npm run db:test` | private table policies pass |
| Build/browser | `npm run build && npm run test:browser:dist` | private-report UI flow passes |
| Full gate | `npm run verify` | exit 0 |
| Runtime repo leak check | `rg -n "Arkane-o7/AutoJob|issues/new|Open GitHub report|Public GitHub issue" --glob '!advisor-plans/**' --glob '!THIRD_PARTY_NOTICES.md' .` | no runtime/docs matches |

## Scope

**In scope**:

- `shared/diagnostics.js`
- `content.js`, `content.css`, `popup.js`
- background/cloud message handling for report submission
- Plan-006 `supabase/migrations/*.sql`, `supabase/functions/submit-support-report/*`,
  database/function tests
- `tests/submission-diagnostics.test.mjs`, `scripts/browser-test.mjs`
- README/product/privacy/retention docs for the private report destination

**Out of scope**:

- GitHub issues, GitHub API tokens, or a public/private GitHub repo integration.
- General analytics, session replay, screenshots, automatic page capture, or
  automatic form/error upload.
- A full support admin application or Slack/email integrations.
- Anonymous direct database access.
- Changing autofill behavior.

## Git workflow

- Branch: `codex/006-private-support-reports`
- Suggested commits: `feat: add private support report endpoint`, `feat: replace
  GitHub report handoff`, `test: enforce diagnostic privacy and rate limits`
- Deploy only to staging until payload review and retention checks pass.

## Steps

### Step 1: Separate payload construction from transport

Keep `Diagnostics.buildReport` and structural redaction as pure/testable code.
Remove `githubIssueUrl`. Add a pure submission-envelope builder that accepts the
already sanitized payload plus bounded user description/expected/actual text.
Run redaction over those text fields too.

Never include location.href beyond `source_domain`; never include page title,
query/fragment, entered values, resume name/content, email/phone, hidden fields,
cookies, local storage, auth/session data, extension ID, or repository URL.

**Verify**: sentinel tests put private values in every raw field and narrative
field and confirm none survive serialization.

### Step 2: Add private table, retention, and RLS denial

Create the support table and an internal rate-limit table/function. Enable RLS
and revoke normal direct client access. Service-role use is limited to the Edge
Function/server. Add cleanup SQL/scheduled-function documentation for expired
reports.

**Verify**: DB tests prove authenticated and anonymous clients cannot directly
select/insert/update support rows, while the server function can insert only
after a verified user context is supplied.

### Step 3: Implement the validating Edge Function

The function must:

1. Require a valid authenticated JWT and derive `user_id` server-side.
2. Enforce content type and 64 KiB body limit before parsing deeply.
3. Validate report version, domain, platform, extension version, narrative
   lengths, fields, attributes, ancestors, and count.
4. Re-run redaction and reject unexpected keys/prototype keys.
5. Apply per-user hourly/daily limits transactionally.
6. Insert the sanitized report and return only a reference code.
7. Log request ID/status/latency, not body/PII/tokens.

Use stable error codes such as `AUTH_REQUIRED`, `INVALID_REPORT`, `RATE_LIMITED`,
and `TEMPORARY_FAILURE`; do not return stack traces.

**Verify**: function tests cover valid, unauthenticated, oversized, malformed,
extra-key, redaction, rate-limit, and storage failure paths.

### Step 4: Update the reviewed report UI

Keep field selection default-empty and JSON preview. Add required "What went
wrong?" plus optional expected/actual fields. Add a checkbox confirming the user
reviewed the selected payload and agrees to send it to private ApplyOS support.

Buttons:

- **Send private report** — enabled only with selected fields, required
  description, consent, and signed-in account.
- **Copy JSON** and **Download JSON** — always local fallbacks.
- Signed-out state: **Sign in to send** plus copy/download; do not discard draft.
- Offline/failure state: keep draft, show stable error, allow retry.

On success show reference code, retention summary, and Close. Never link to the
repo.

**Verify**: browser tests cover default-empty, consent gating, signed-out,
success, rate limit, offline retry, and no repo URL.

### Step 5: Route submission through the trusted background runtime

Add a privileged `APPLYOS_SUPPORT_REPORT_SUBMIT` message handled in the account
background/cloud boundary. Apply the same extension-page sender guard as auth.
Content-script UI may hand its sanitized envelope to the background through a
narrow message, but the background must not return tokens or raw backend errors.

If the sender is the content script on the active job page, bind the request to
the current tab/session and revalidate the envelope; do not grant it generic
cloud query access.

**Verify**: tests prove only the report operation is exposed and arbitrary URL,
method, table, or auth-header forwarding is impossible.

### Step 6: Update documentation and operational handling

Update README from "public GitHub issue" to private ApplyOS support, preserving
the reviewed/no-auto-upload explanation. Document retention, who can access
reports, export/deletion handling, and incident response. Decide whether support
reports are deleted or anonymized on account deletion and make code/policy agree.

**Verify**: runtime repo leak check returns no matches and privacy docs contain
the support-report data/retention/access details.

### Step 7: Run staging privacy review and the full gate

Submit reports containing test sentinel emails, phones, URLs with query strings,
tokens, field values, hidden fields, and resume-like data. Inspect the stored row
and function logs manually. No sentinel may appear. Run `npm run verify`, DB
tests, and function tests.

## Test plan

- Unit: existing redaction plus narrative redaction, strict envelope schema,
  payload bounds, no repo URL.
- DB/function: auth required, no direct access, limits, retention, validation,
  sanitized server insert, stable error codes.
- Browser: review selection, description/consent, sign-in fallback, success
  reference, offline retry, copy/download.
- Manual: inspect staging row and logs with sentinel data.

## Done criteria

- [ ] Runtime/docs no longer reveal or link to the GitHub repository for reports.
- [ ] Reports remain selection-based, previewed, and explicitly consented.
- [ ] Private submission requires authentication and server-side validation.
- [ ] Anonymous users cannot insert directly; copy/download still work.
- [ ] Full URLs, values, resumes, PII, tokens, and hidden fields are absent.
- [ ] Rate limits and 90-day retention are implemented/documented.
- [ ] Success returns a user-visible reference code.
- [ ] `npm run verify`, DB, function, and sentinel privacy tests pass.

## STOP conditions

- The endpoint requires a privileged key in the extension.
- The transport needs full URLs, form values, screenshots, or resume contents.
- Direct table inserts cannot be disabled.
- Rate limiting cannot be enforced transactionally enough to prevent abuse.
- Retention/deletion policy is undecided or contradicts account deletion.
- A failure path discards the user's reviewed draft.

## Maintenance notes

Adding automatic crash telemetry later is a separate privacy decision and must
not reuse this consent implicitly. Keep report schemas versioned and backward
compatible across extension releases; retain sanitizer tests for every new field.
