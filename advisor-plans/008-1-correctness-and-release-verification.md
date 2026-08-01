# Plan 008.1: Correctness and release verification

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: Plan 008 implementation draft
- **Status**: DONE — automated and installed-extension acceptance passed on 2026-08-02
- **Pre-documentation verified heads**: `d0596c1` (implementation and tests), `60bfa81` (plan handoff)

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

## Verification status — 2026-08-02

The pre-documentation implementation and plan-handoff heads (`d0596c1` and
`60bfa81`) passed 30-script lint/reference checks, TypeScript checking, 83/83
unit tests, 10/10 ATS browser fixtures, 11/11 extension regression scenarios,
3 database test files containing 49/49 pgTAP assertions, database reset,
database lint with zero warnings, build, `verify`, and `git diff --check`.

The clean branch is `codex/scout-action-workspace-clean`, created from current
`main`. The mixed branch remains preserved at
`backup/scout-action-workspace-hardening` (`dda094e`). No release ZIP or
generated output is part of the clean diff. Plan references use the
repository-relative path
`advisor-plans/008-1-correctness-and-release-verification.md`.

## Installed-extension acceptance — 2026-08-02

All five flows passed against the installed Scout extension and its persisted
workspace:

- Skipping the final due application follow-up reconciled the application from
  `follow_up_due` to `applied`, and the corrected status survived reload.
- Deleting an application preserved its completed action in history, removed
  invalid open actions, and retained the historical record after reload.
- Disabling interview preparation and thank-you options cancelled only each
  corresponding open system-generated action; completed, skipped, and
  unrelated actions remained intact.
- Reviewed CSV import exposed mapping and preview, reported invalid rows,
  detected exact and name-only duplicate candidates, supported per-row
  Create/Merge/Skip decisions and final confirmation, parsed quoted commas,
  and persisted the approved batch after reload.
- Logging a relationship interaction updated the timeline and derived
  last-contact date; its dated next action appeared in Today, and all four
  states survived extension reload.

Temporary `ACCEPTANCE 008` records were cleaned up after verification. There
are no remaining Plan 008.1 release blockers.
