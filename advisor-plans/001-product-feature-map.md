# Plan 001: Document what ApplyOS already does and define the cloud/recruiter vocabulary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report it instead of improvising. When done,
> update this plan's row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3841724..HEAD -- README.md THIRD_PARTY_NOTICES.md dashboard.html onboarding.html shared/storage.js shared/profiles.js shared/ai.js`
> If cited behavior has changed, re-check every claim before writing docs.

## Executor prompt

> Audit the current ApplyOS code at the planned commit and create an accurate,
> plain-language product guide. Explain the candidate-side CRM, online-account
> concept, contacts/networking, interviews, follow-ups, answer memory, Smart
> Tools, local AI, backups, reporting, and safety boundaries. Clearly separate
> what exists now from what later plans will add. Document licensed adaptations
> from Offlyn Apply and Job App Filler exactly as stated in
> `THIRD_PARTY_NOTICES.md`; do not call unverified parts copied. Define LinkedIn
> login as authentication only, and define recruiter shortlisting as a future,
> opt-in publication flow that cannot read the private job-search workspace.
> Follow all scope, verification, and STOP rules in this plan.

## Status

- **Priority**: P1
- **Effort**: S (about 1 day)
- **Risk**: LOW
- **Depends on**: `advisor-plans/000-restore-verification-baseline.md`
- **Category**: docs / direction
- **Planned at**: commit `3841724`, reconciled 2026-07-17
- **Completed in**: this launch-product-contracts PR

## Why this matters

The current repo contains many mature local features, but product terms are easy
to misread. In particular, "CRM" can sound like a recruiter ATS, "LinkedIn" can
sound like network access, and "AI" can sound like a paid cloud model even
though the current implementation is local/deterministic. A shared product map
prevents the account, database, onboarding, support, and future recruiter work
from making contradictory promises.

## Current state

- `README.md:3-36` describes job capture, tracking, matching, answer memory,
  reminders, contacts, interviews, Smart Drafts, optional Ollama, backups, and
  reviewed diagnostics.
- `dashboard.html:21-48` implements the application command center: metrics,
  deadlines, follow-ups, search, status/source/priority filters, board/list
  views, and sample data.
- `dashboard.html:50-55` labels Contacts as a candidate-side networking CRM.
- `dashboard.html:75-105` links contacts to applications, generates reviewed
  follow-up/thank-you drafts, stores interview preparation, and offers Smart
  Draft tools.
- `shared/storage.js:237-270` stores applications, reminders, answer memory,
  learned answers, resume versions, contacts, interviews, and settings in one
  versioned local state.
- `shared/profiles.js:25-99` stores multiple switchable local job-search profiles.
- `shared/ai.js:132-178` provides deterministic Smart cover-letter, resume-focus,
  and keyword-gap outputs without an account or external model.
- `shared/ai.js:181-258` optionally enhances those outputs through a
  user-configured localhost Ollama endpoint.
- `shared/backup.js:109-184` exports and restores the local workspace using
  password-derived AES-GCM encryption and a rollback checkpoint.
- `THIRD_PARTY_NOTICES.md:5-13` identifies Offlyn Apply adaptations: ATS
  recognition, field classification/safeguards, normalization, controlled-input
  compatibility, local Ollama patterns, multi-profile patterns, knowledge
  memory, and the Workday inline-form handler.
- `THIRD_PARTY_NOTICES.md:15-23` identifies Job App Filler adaptations limited to
  Greenhouse field-container, Select2/react-select option, and file-dropzone
  compatibility patterns.
- `README.md:46` currently says there is no backend or analytics and all listed
  user data stays in `chrome.storage.local`. Later plans must revise that copy
  only after opt-in cloud behavior exists.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax/reference checks | `npm run lint` | exit 0 |
| Type contracts | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | 30 or more tests pass |
| Claim review | `rg -n "CRM|LinkedIn|recruiter|local|cloud|adapt" README.md docs THIRD_PARTY_NOTICES.md` | every relevant claim is inspectable |

## Scope

**In scope**:

- `docs/product-feature-map.md` (create)
- `docs/data-and-privacy-boundaries.md` (create)
- `README.md` (add links and a concise terminology section only)

**Out of scope**:

- Source-code behavior, UI, database, authentication, or permissions.
- Rewriting `THIRD_PARTY_NOTICES.md` or license files unless an existing claim is
  demonstrably inaccurate.
- Adding the AI/payments TODO; Plan 007 owns that README section.
- Marketing claims about features not present in the repo.

## Git workflow

- Branch: `codex/001-product-feature-map`
- Match the repository's imperative conventional commit style, for example:
  `docs: explain product and data boundaries`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Write the current-feature glossary

Create `docs/product-feature-map.md` with a table containing: feature name,
plain-language meaning, current behavior, data used, network behavior, and what
it explicitly does not do. Include at least:

1. Job-page capture and ATS compatibility.
2. Review-first autofill and safety exclusions.
3. Application CRM/pipeline, status board, filters, deadlines, and match score.
4. Answer memory and correction/knowledge graph.
5. Follow-up reminders, badge, and reviewed compose handoffs.
6. Contacts/networking CRM.
7. Interview workspace and thank-you drafts.
8. Multiple job-search profiles and resume versions.
9. Smart Drafts and optional local Ollama enhancement.
10. Conservative post-submission confirmation.
11. Encrypted backup/restore.
12. Reviewed site diagnostics.

Use these definitions:

- **Candidate CRM**: a private personal system for the user's own applications,
  reminders, interviews, and relationships. It is not an employer ATS.
- **Contact/networking record**: a manually entered recruiter, manager,
  interviewer, referral, employee, or other contact. ApplyOS stores notes and
  opens reviewed email drafts; it does not import LinkedIn connections or send
  messages automatically.
- **Online account**: ApplyOS identity, session, optional cross-device sync,
  export, and deletion. LinkedIn is the sign-in provider, not the database.
- **Candidate publication**: a future, separate, user-approved recruiter-facing
  snapshot. It is not the private profile used for autofill.

**Verify**:
`rg -n "Candidate CRM|Online account|Candidate publication|does not" docs/product-feature-map.md`
must show all four distinctions.

### Step 2: Document provenance without overclaiming

Add a section called "Licensed adaptations and ApplyOS-specific product work."
Paraphrase `THIRD_PARTY_NOTICES.md` and cite the local notice/license files.
Explicitly say the repository confirms adaptations from the two named projects;
do not infer that dashboard CRM, onboarding, private reports, or future cloud
architecture were copied unless evidence is added later.

Add a separate "Market inspiration is not code provenance" note: Simplify,
Huntr, and Teal may be used as positioning and feature research, but the
repository does not document copied code from them. Re-check competitor claims
before publication and do not present strategic inspiration as licensed source
reuse.

**Verify**:
`rg -n "Offlyn Apply|Job App Filler|THIRD_PARTY_NOTICES|MIT|BSD" docs/product-feature-map.md`
returns all expected attributions.

### Step 3: Create the data/privacy boundary document

Create `docs/data-and-privacy-boundaries.md` with three zones:

1. **Local private workspace** — the current profiles, applications, contacts,
   interviews, reminders, answers, corrections, resume files, and settings.
2. **Opt-in cloud private workspace** — the same user's data after explicit sync
   consent, encrypted in transit/provider storage, owner-only through RLS; do not
   call it end-to-end encrypted unless that is later implemented and verified.
3. **Opt-in recruiter publication** — a deliberately limited searchable snapshot
   with its own visibility control; never includes private applications,
   employer notes, contacts, answer memory, corrections, or interview notes.

Add a claim-change checklist naming the local-only copy that Plans 003/004 must
update in README, onboarding, dashboard header, Smart Studio copy, options, and
Chrome Web Store disclosures.

**Verify**:
`rg -n "Local private workspace|Opt-in cloud private workspace|Opt-in recruiter publication|end-to-end" docs/data-and-privacy-boundaries.md`
returns the three zones and encryption caveat.

### Step 4: Link the docs from README

Add a short "Product and data model" section near the architecture overview
linking both new docs. Keep the current local-only release description accurate;
do not announce cloud sync before it exists.

**Verify**: `npm run lint && npm run typecheck && npm test` exits 0 and all tests
pass.

## Test plan

This is documentation-only. No new automated test is required. Review every
behavioral statement against the cited source, and run the existing baseline to
catch broken README/source references.

## Done criteria

- [ ] Both docs exist and are linked from README.
- [ ] Current behavior and future behavior are visually distinct.
- [ ] CRM, contacts/networking, online account, LinkedIn sign-in, candidate
  publication, Smart Tools, and local AI are defined.
- [ ] All adaptation claims match `THIRD_PARTY_NOTICES.md`.
- [ ] No claim says LinkedIn imports connections or verifies identity.
- [ ] No claim says recruiters can access private workspace data.
- [ ] `npm run lint && npm run typecheck && npm test` exits 0.
- [ ] Only in-scope files plus the plan status row changed.

## STOP conditions

- The notice/license files conflict with the source comments or README.
- A requested product claim cannot be demonstrated from code or docs.
- Cloud behavior is already implemented differently from the three-zone model.
- Completing the docs would require changing runtime behavior.

## Maintenance notes

Review these docs whenever storage location, permissions, provider integrations,
AI routing, recruiter visibility, or automatic actions change. The privacy
boundary document is the source for onboarding and Web Store disclosure copy.
