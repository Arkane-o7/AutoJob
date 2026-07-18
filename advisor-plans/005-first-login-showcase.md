# Plan 005: Build a resumable first-login showcase for every core ApplyOS feature

> **Executor instructions**: Follow this plan in order and run all verification
> gates. Stop on STOP conditions. Update the status row in
> `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- onboarding.html onboarding.css onboarding.js background.js popup.html popup.js dashboard.html dashboard.js options.html options.js shared/storage.js scripts/browser-test.mjs`
> Confirm account and sync flows from Plans 003/004 before writing tutorial copy.

## Executor prompt

> Redesign the existing ApplyOS onboarding into a resumable, accessible
> first-login setup and product showcase. Keep profile setup, add user-initiated
> LinkedIn account/sync privacy choices, and teach job capture, review-first
> autofill, pipeline CRM, contacts/networking, reminders/follow-ups, interviews,
> Smart Drafts/local AI, encrypted backup, and private support reporting. Persist
> a versioned last step locally and in the user's cloud progress row; auto-open
> after first successful login only when the current tour is incomplete, but
> never auto-launch OAuth. Use an interactive non-mutating demo by default and
> allow replay from Account/Options. Meet keyboard, focus, reduced-motion, and
> screen-reader requirements. Follow all scope, tests, and STOP rules here.

## Status

- **Priority**: P1
- **Effort**: M (4–6 engineering days)
- **Risk**: MED — onboarding can block login or misstate data practices
- **Depends on**: Plans 003 and 004
- **Category**: direction / docs / tests
- **Planned at**: commit `3841724`, reconciled 2026-07-17

## Why this matters

The current wizard collects a profile and explains Smart Tools, but it does not
teach most of the product and it does not remember completion. A first-login
tutorial should make the extension's workflow and privacy model obvious without
forcing users to discover Contacts, interview prep, backups, reporting, and
local-versus-cloud behavior by trial and error.

## Current state

- `background.js:53-56` opens onboarding only on extension install.
- `onboarding.html:20-26` has five steps: identity, career context, defaults,
  Smart Tools, and ready.
- `onboarding.html:29-89` collects local profile data and explains Smart Tools,
  but does not showcase capture, autofill, dashboard CRM, contacts, reminders,
  interviews, backup, or support reports.
- `onboarding.js` patches profile data after each step and records explicit final
  completion; tests verify onboarding is first-run-only.
- `shared/profiles.js` owns the versioned profile-completion contract, while
  Profile & Settings is now the sole full editor.
- Completed users are redirected from onboarding to Profile & Settings, but the
  product still has no resumable tutorial state or tour version.
- `shared/storage.js:261-294` has settings but no versioned onboarding progress.
- `dashboard.html:45` can load sample data, but that mutates the real local
  workspace and has no single tutorial cleanup flow.

## Tutorial information architecture

Use a versioned `TOUR_VERSION` and these phases:

1. **Welcome and privacy choice** — local-only versus optional cloud sync.
2. **Account** — user-clicked LinkedIn login or Continue locally.
3. **Profile essentials** — existing identity/career/default fields with save on
   each step and Skip for optional fields.
4. **Save a job** — job-page capture, editable role/company, confidence.
5. **Autofill safely** — fills only confident empty fields; review and manual
   submission; sensitive/consent/CAPTCHA exclusions.
6. **Application CRM** — board/list, statuses, search/filters, match, deadlines.
7. **Contacts and networking** — manual records linked to roles; no LinkedIn
   import; draft-only email handoffs.
8. **Follow-ups and interviews** — 7/14-day reminders, badge, interview prep,
   thank-you draft.
9. **Smart Tools** — offline deterministic drafts and optional localhost Ollama;
   no paid cloud AI yet.
10. **Control your data** — sync status/publication boundary, encrypted backup,
    export/deletion, and private site-problem report.
11. **Ready** — open a real job page or explicitly load removable sample data.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint/types/unit | `npm run lint && npm run typecheck && npm test` | exit 0 |
| Build/browser | `npm run build && npm run test:browser:dist` | tutorial cases pass |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**:

- `onboarding.html`, `onboarding.css`, `onboarding.js`
- `background.js` first-login/tour-version trigger only
- `account.html`, `account.js`, `options.html`, `options.js`, `popup.html`,
  `popup.js`, `dashboard.html`, `dashboard.js` only for replay/status anchors
- local/cloud onboarding progress contracts and migrations
- `tests/onboarding.test.mjs`, `scripts/browser-test.mjs`, optional static demo
  assets created specifically for the showcase
- README tutorial section/privacy wording

**Out of scope**:

- Changing actual autofill, CRM, sync, report, AI, or billing behavior.
- Real OAuth in automated tests.
- Auto-populating or publishing recruiter-visible candidate data.
- Writing sample records into the workspace without explicit user action.

## Git workflow

- Branch: `codex/005-first-login-showcase`
- Suggested commits: `feat: persist onboarding progress`, `feat: add first-login
  product showcase`, `test: cover resumable accessible tour`
- Do not push/open a PR unless instructed.

## Steps

### Step 1: Add versioned resumable progress

Add local progress with `tour_version`, `last_step`, `completed_at`, and
`dismissed_at`. Sync it to `onboarding_progress` only when signed in/sync-enabled.
Save after each navigation and profile field commit. Reopening resumes at the
last safe step. If the current `TOUR_VERSION` increases, show a short What's New
path; do not force the full profile wizard again.

After first successful login, open onboarding only if current tour completion is
missing. Do not launch OAuth; the user must click the login button. Continue
locally remains visible if accounts are optional.

**Verify**: unit tests cover first run, reload resume, completed tour, version
bump, continue locally, signed-in cloud progress, and unavailable network.

### Step 2: Separate required setup from optional education

Required setup: privacy choice, account/local mode choice, four core identity
fields needed by existing `hasCoreProfile`, and explicit finish. Every other
field is optional/skippable. Preserve previously entered values and do not clear
fields when replaying the tour.

**Verify**: a user can finish with the four core fields; optional skips do not
write empty values over an existing profile.

### Step 3: Build an interactive non-mutating showcase

Create one cohesive visual story using the current ApplyOS industrial/editorial
design language, CSS variables, typography, and colors. Use a contained mock job
page/popup/board/contact/interview panel to demonstrate interactions. Do not
write sample applications/contacts to the user's workspace by default.

Each feature panel must state:

- what the user does;
- what ApplyOS does;
- what remains manual;
- where the data lives in the selected local/cloud mode.

Provide Back, Next, Skip tutorial, and progress. On final step, offer explicit
"Load removable sample workspace" only if Plan 004 can tag and remove the entire
sample set safely; otherwise offer Open dashboard without mutation.

**Verify**: browser test confirms state count is unchanged after completing the
default showcase.

### Step 4: Teach the exact feature and safety boundaries

Copy must include:

- CRM is the candidate's private pipeline, not a recruiter ATS.
- Contacts are manual; LinkedIn login does not import a network.
- Autofill never submits/advances and skips sensitive/consent fields.
- Email actions open reviewed drafts only.
- Smart Tools work without a cloud model; Ollama is optional/local.
- Cloud sync and recruiter publication are separate opt-ins.
- Site reports go to private ApplyOS support only after review.

Use terms from `docs/product-feature-map.md` and
`docs/data-and-privacy-boundaries.md`.

**Verify**: targeted `rg` checks show every boundary in onboarding copy.

### Step 5: Meet accessibility and motion requirements

- Semantic ordered progress and one visible `h1`.
- Keyboard-operable navigation; no keyboard trap.
- Focus moved to the panel heading on step change.
- Error/status updates through `aria-live`.
- Current step announced with `aria-current="step"`.
- Back/Skip/Close behavior preserves progress.
- `prefers-reduced-motion` disables nonessential transitions.
- Responsive at extension-page widths and 200% zoom.
- No color-only progress/error states.

**Verify**: browser assertions cover focus, keyboard, aria-current, reduced
motion CSS, 200% zoom layout, and no horizontal overflow.

### Step 6: Add replay and contextual help

Add "Replay product tour" to Account and Options, and a compact Help/Tour link
from dashboard or popup. Replay starts at the showcase, not destructive profile
setup, unless the user chooses Edit setup. Replaying never changes completion or
profile data until the user saves edits.

**Verify**: browser test opens replay from Account/Options and confirms existing
profile/local state remains intact.

### Step 7: Run the complete gate and user walkthrough

Run `npm run verify`. Manually complete:

- new local-only user;
- new LinkedIn user with empty workspace;
- existing local user signing in and choosing merge later;
- reload midway;
- keyboard-only completion;
- offline completion;
- replay after completion.

Record outcomes in `docs/testing/onboarding-matrix.md` without PII.

## Test plan

- Unit: version/progress reducer, save/restore, optional-field preservation,
  completion and What's New logic.
- Browser: non-mutating showcase, focus/keyboard/ARIA, reduced motion, reload,
  replay, signed-out/signed-in/offline modes.
- Manual: local-only, first login, legacy profile, merge-deferred, 200% zoom.

## Done criteria

- [ ] First successful login opens the incomplete current-version tour.
- [ ] OAuth never starts automatically.
- [ ] The tour resumes after close/reload and saves profile steps safely.
- [ ] Every requested product feature is explained.
- [ ] CRM/networking/LinkedIn/recruiter/privacy boundaries are explicit.
- [ ] Default showcase does not mutate real workspace data.
- [ ] Replay is available and nondestructive.
- [ ] Keyboard, focus, ARIA, reduced-motion, and zoom checks pass.
- [ ] `npm run verify` passes.

## STOP conditions

- Account/sync/privacy behavior is not final enough to describe accurately.
- Completing the tutorial requires silently signing in, syncing, or publishing.
- Sample cleanup cannot reliably identify every tutorial-created record.
- Accessibility requires changing unrelated production components.

## Maintenance notes

Increment `TOUR_VERSION` only for user-visible workflow/privacy changes. Keep the
feature map as copy source-of-truth. New permissions, data destinations, or
automatic behavior require a tutorial/privacy update before release.
