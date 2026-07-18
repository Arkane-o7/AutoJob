# Plan 003: Add a real ApplyOS account with user-initiated LinkedIn OIDC login

> **Executor instructions**: Follow this plan step by step and run every
> verification gate. Stop on any STOP condition. Update the plan status in
> `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- manifest.json background.js popup.html popup.js dashboard.html dashboard.js options.html options.js onboarding.html onboarding.js scripts/build.mjs scripts/check.mjs package.json`
> Also confirm Plan 002 migrations and cloud contracts are present.

## Executor prompt

> Implement a production-grade ApplyOS account using Supabase Auth and Sign In
> with LinkedIn using OpenID Connect. The OAuth window must start only from an
> explicit user click and use `chrome.identity.launchWebAuthFlow` plus PKCE.
> Configure Supabase JS in the background/service-worker trust boundary, keep
> session tokens out of content scripts and UI responses, and add an Account &
> Sync page with sign-in, identity, sign-out, privacy, export/deletion links, and
> sync-not-yet-enabled status. Request only `openid profile email`; handle missing
> email; never import LinkedIn contacts; never claim LinkedIn verifies identity.
> Use placeholders/config for public project settings and keep all secrets out of
> the repo. Follow all scope, tests, and STOP conditions in this plan.

## Status

- **Priority**: P0
- **Effort**: L (3–5 engineering days plus provider setup)
- **Risk**: HIGH — session leakage or callback mistakes compromise accounts
- **Depends on**: `advisor-plans/002-cloud-data-foundation.md`
- **Category**: security / direction
- **Planned at**: commit `3841724`, reconciled 2026-07-17

## Why this matters

The extension currently has profiles but no user identity, backend session,
account lifecycle, or account-switch boundary. LinkedIn OIDC is appropriate for
sign-in, but its client secret cannot be shipped in an extension and its basic
identity claims must not be confused with access to LinkedIn's network or
verified-candidate status.

## Current state

- `manifest.json:5-7` requests storage, unlimited storage, active tab, and alarm
  permissions; it does not request `identity` or any production API host.
- `background.js:1` loads local shared modules; there is no cloud/auth runtime.
- `background.js:70-206` is the message broker for sessions, correction learning,
  reminders, and local Ollama, but has no privileged sender guard for account
  operations because those operations do not yet exist.
- `onboarding.js:49-58` advances a local form and opens dashboard/options pages;
  it has no login action or completion record.
- `popup.html:16-20` shows active local profile, Setup, and AI status, but no
  account state.
- `dashboard.html:13-17` labels data as local and links only to profile settings.
- `scripts/build.mjs:7-20` copies plain files into `dist/`; no dependency bundle
  currently exists.

## Required provider configuration

Before the real smoke test:

1. Create separate staging and production Supabase projects.
2. Create a LinkedIn developer app associated with the ApplyOS LinkedIn Page.
3. Request the **Sign In with LinkedIn using OpenID Connect** product.
4. In LinkedIn, register Supabase's provider callback:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
5. In Supabase Auth, enable `linkedin_oidc`, store the LinkedIn client ID/secret,
   and add `chrome.identity.getRedirectURL("auth/callback")` to the redirect
   allow list.
6. Use only `openid profile email`. Email is optional in real responses, so the
   account UI must tolerate its absence.

Provider secret entry is a manual operator step. Never automate it into tracked
files or terminal output.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install locked deps | `npm install` | exit 0; lockfile unchanged afterward |
| Lint | `npm run lint` | account/auth files checked; exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all tests pass |
| Build | `npm run build` | cloud/auth bundle emitted only under `dist/` |
| Browser tests | `npm run test:browser:dist` | deterministic account UI tests pass without real OAuth |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**:

- `manifest.json`
- `background.js`
- `content.js` and `popup.js` only for the one-time, user-initiated fill-context
  capability and removal of direct broad storage reads
- `account.html`, `account.css`, `account.js` (create)
- `popup.html`, `popup.js`, `dashboard.html`, `dashboard.js`, `options.html`
  only for account links/status
- `src/cloud/auth.ts`, `src/cloud/client.ts`, `src/cloud/session-storage.ts`,
  `src/cloud/messages.ts` (create; adjust exact split only within `src/cloud/`)
- `scripts/build.mjs`, `scripts/check.mjs`
- `package.json`, `package-lock.json`, `tsconfig.json`
- `tests/auth.test.mjs` and deterministic browser-test additions
- `.env.example`, README setup/privacy copy required by real account behavior

**Out of scope**:

- Uploading local workspace data, conflict resolution, resume cloud storage, or
  recruiter publication (Plan 004).
- Private report submission (Plan 006).
- Password/email login unless LinkedIn approval is blocked and the operator
  explicitly approves a fallback.
- LinkedIn contacts, posts, messages, employment import, or recruiter API access.
- Service-role/client-secret values in any client/build file.

## Git workflow

- Branch: `codex/003-linkedin-account`
- Suggested commits: `build: bundle cloud auth runtime`, `feat: add LinkedIn
  account flow`, `test: cover account session boundaries`
- Do not push or configure production credentials unless instructed.

## Steps

### Step 1: Add a maintainable cloud-auth bundle

Add pinned `@supabase/supabase-js` and a small pinned bundler such as `esbuild`.
Compile TypeScript source under `src/cloud/` into a single classic-script runtime
for the Manifest V3 service worker, emitted inside `dist/`; do not load remote
JavaScript. Update the build/check scripts so production instructions load
`dist/` for cloud functionality and missing generated files fail the build.

Only project URL and publishable key may be build-time public configuration.
Fail with a clear "cloud account not configured" UI in local builds that omit
them.

**Verify**: `npm run build` exits 0, `dist/` contains the auth runtime, and
`rg -n "service_role|client_secret" dist src manifest.json` finds no credentials.

### Step 2: Establish a trusted storage/message boundary before auth

The current content script runs on all HTTP(S) pages/frames and
`content.js:1039-1055` reads the entire local profile, application state, and
knowledge graph directly. Before adding session/sync material:

1. Move all broad `chrome.storage.local` reads to trusted extension pages or the
   service worker.
2. On startup call `chrome.storage.local.setAccessLevel({accessLevel:
   "TRUSTED_CONTEXTS"})` after tests prove popup/dashboard/options still work.
3. Add a one-time fill-context capability: the popup arms the active tab after a
   user clicks Autofill/AI assist, receives a nonce, and passes it to the content
   script. The background consumes that nonce and returns only the minimum
   profile/resume/answer projection needed for that fill. Keep it in tab memory
   for the existing multi-step assist session and discard it when the session/tab
   ends.
4. Never return applications, contacts, interviews, sync outbox, account data,
   or tokens to a content script unless a specific user-facing operation truly
   requires an allowlisted projection.

**Verify**: tests prove an unarmed content script cannot read the workspace or
request fill context, a nonce is tab-bound and single-use, and existing multi-step
autofill/Workday/browser fixtures still pass.

### Step 3: Keep auth in the service-worker trust boundary

Create one Supabase client in the background runtime with `flowType: "pkce"` and
a custom async session storage adapter backed by extension-origin IndexedDB (not
the existing `chrome.storage.local` data blob). Content scripts and UI pages must
not receive access tokens, refresh tokens, provider tokens, or raw session JSON.

Expose a minimal message contract:

- `APPLYOS_ACCOUNT_STATUS` → `{signedIn, user:{id,displayName,email?,avatarUrl?}}`
- `APPLYOS_ACCOUNT_SIGN_IN` → sanitized success/error only
- `APPLYOS_ACCOUNT_SIGN_OUT` → sanitized result
- `APPLYOS_ACCOUNT_DELETE_REQUEST` → link/intent only; deletion lands in Plan 004

Before privileged handling, require `sender.id === chrome.runtime.id` and an
extension-page sender URL. Reject calls originating from a web-page content
script. Redact auth errors before returning them to UI or logs.

**Verify**: unit tests prove privileged messages reject a content-script sender
and no response contains token-like fields.

### Step 4: Implement user-initiated PKCE OAuth

On the Account page's LinkedIn button:

1. Ask the background auth module to create the provider URL with
   `provider: "linkedin_oidc"`, `redirectTo: chrome.identity.getRedirectURL("auth/callback")`,
   PKCE, and no automatic page redirect.
2. Call `chrome.identity.launchWebAuthFlow({url, interactive: true})` only from
   that button event.
3. Validate the returned origin/path, extract the single-use code, and call
   `exchangeCodeForSession` through the same client/storage context that created
   the verifier.
4. Upsert the owner-only `app_accounts` row with basic display data.
5. Return only sanitized account status.

Do not launch OAuth automatically from `onInstalled`, `onStartup`, onboarding
initialization, or popup initialization.

**Verify**: mocked tests cover success, user cancellation, wrong callback host,
missing code, expired exchange, missing email, and provider failure.

### Step 5: Build Account & Sync UI

Create an accessible full-page extension surface with:

- Signed-out explanation: account enables optional sync; autofill remains local.
- Officially styled user-initiated "Continue with LinkedIn" action.
- Signed-in name/avatar/email when present.
- "Sync is not enabled yet" until Plan 004 lands; do not imply data is online.
- Links to privacy policy, terms, support, export, and deletion information.
- Sign out with an explanation that local data currently remains on this device.
- Clear text: LinkedIn is used only for sign-in; no contacts/network/messages are
  imported; LinkedIn sign-in is not identity verification.

Add Account links/status to popup, dashboard, and options without crowding the
existing primary workflows.

**Verify**: keyboard navigation reaches every action, status uses `aria-live`,
and signed-out/signed-in/error/loading states are browser-tested.

### Step 6: Update manifest and disclosures minimally

Add the `identity` permission and only the exact Supabase/API host permission
required by this implemented feature. Do not request permissions for future AI,
billing, or recruiter features. Update README and onboarding copy so local-only
users and signed-in-but-not-synced users are described accurately.

**Verify**: `npm run lint` validates manifest/page references and
`npm run test:browser:dist` passes.

### Step 7: Run staging OAuth smoke tests

Using the production-form extension ID in a staging build:

- New LinkedIn user creates exactly one `auth.users` and `app_accounts` row.
- Returning user signs into the same account.
- Cancel returns to a stable signed-out screen.
- Missing LinkedIn email does not block account creation.
- Sign out revokes/clears the session and Account page shows signed out.
- Restarting Chrome restores/refreshes the ApplyOS session without exposing it
  to content scripts.
- No local workspace record is uploaded yet.

Record results in `docs/testing/linkedin-auth-smoke.md` without user PII or
tokens.

### Step 8: Run the full gate

Run `npm run verify`. Inspect the built manifest and bundle to ensure no secret,
service-role key, source map with environment values, or auth token is included.

## Test plan

- Unit: auth state mapper, callback URL validation, message sender guard, token
  redaction, missing email, sign-out, storage adapter serialization, and one-time
  tab-bound fill capabilities.
- Browser: account page signed-out/signed-in/loading/error states using a fake
  background auth adapter; never call real LinkedIn in CI.
- Manual staging: real provider flow and restart/refresh behavior.
- Regression: all 30+ existing local tests and ATS browser tests pass.

## Done criteria

- [ ] A user can deliberately sign in/out with LinkedIn in a staging build.
- [ ] OAuth uses PKCE and `chrome.identity.launchWebAuthFlow`.
- [ ] OAuth never starts without a user click.
- [ ] Tokens stay inside the background auth/storage boundary.
- [ ] Content scripts cannot directly read broad local/account/sync storage and
  receive only a user-triggered minimal fill projection.
- [ ] Client secret and service-role key are absent from repo and build.
- [ ] Missing email and cancel/error paths are handled.
- [ ] UI says LinkedIn is sign-in only and not identity verification.
- [ ] No local workspace data is uploaded in this plan.
- [ ] `npm run verify` and staging smoke checks pass.
- [ ] Only in-scope files plus plan status changed.

## STOP conditions

- LinkedIn OIDC product access is unavailable or callback approval is blocked.
- The production extension ID is unknown at final callback configuration time.
- The SDK/bundle requires remote executable code.
- Tokens cannot be kept out of content-script-readable storage.
- A real session can be created only by embedding a client secret/service key.
- Implementation requires silently uploading current local data.

## Maintenance notes

Provider claims and email availability may change; keep account UI tolerant.
Review redirect allow lists whenever the extension ID, Supabase project, or
environment changes. Any new privileged background message needs the same sender
guard and sanitized response contract.
