# Plan 008.1: Correctness and release verification

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: Plan 008 implementation draft
- **Status**: IN PROGRESS — automated release gates are green; manual Chrome acceptance is pending
- **Verified implementation commit**: `d0596c1`

## Goal

Make Plan 008 merge-ready without beginning Plan 009. This tranche preserves
CRM history, makes every generated action visible and reviewable, completes the
Today workspace and CSV import contract, and proves notification and cloud
ownership behavior.

## Required corrections

- Replace only open system application follow-ups when an application is marked
  applied.
- Reconcile `follow_up_due` after complete, skip, cancel, activity completion,
  and relevant deletion flows.
- Cancel open generated work while preserving completed, skipped, and cancelled
  history when applications or interviews are deleted.
- Restrict application-close cancellation to open system application-process
  actions.
- Show editable preparation and thank-you action choices before saving an
  interview; cancelling either date must cancel the corresponding open action.
- Add Today filters for channel, application, and contact; deterministic
  priority/creation sorting; inline rescheduling; deadline/interview agenda
  rows; and a three-item Applications preview linking to Today.
- Replace prompt-driven CSV writes with column mapping, full preview, per-row
  validation, duplicate candidates, Create/Merge/Skip decisions, and one final
  batch commit.
- Use the same explicit post-compose activity confirmation from contact,
  application follow-up, final follow-up, and interview thank-you drafts.

## Verification gates

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test` (83 passing)
- [x] `npm run build`
- [x] `npm run test:browser:dist` (10/10 ATS fixtures and 11/11 extension regression scenarios passing)
- [x] `npm run db:start`
- [x] `npm run db:reset`
- [x] `npm run db:test` (3 pgTAP files, 49 assertions passing)
- [x] `npm run db:lint` (0 warnings)
- [x] `npm run verify`
- [x] `git status --short` reviewed (hardening files only; no release archive changes)

Do not mark this plan or Plan 008 DONE until every automated and manual gate
passes.

## Verification status — 2026-08-02

The clean implementation at `d0596c1` passed 30-script lint/reference checks,
TypeScript checking, 83/83 unit tests, 10/10 ATS browser fixtures, 11/11
extension regression scenarios, 3 database test files containing 49/49 pgTAP
assertions, database reset, database lint with zero warnings, build, `verify`,
and `git diff --check`.

The clean branch is `codex/scout-action-workspace-clean`, created from current
`main`. The mixed branch remains preserved at
`backup/scout-action-workspace-hardening` (`dda094e`). No release ZIP or
generated output is part of the clean diff. Plan references use the
repository-relative path
`advisor-plans/008-1-correctness-and-release-verification.md`.

## Remaining blockers

- Manually complete the five Chrome acceptance flows against the installed
  extension and real extension storage. Browser automation cannot navigate to
  a `chrome-extension://` page unless the user first opens a Scout tab that can
  be claimed.
- Keep this plan and Plan 008 IN PROGRESS until those five flows pass.
