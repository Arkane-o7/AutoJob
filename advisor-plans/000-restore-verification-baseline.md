# Plan 000: Verification baseline restored

> **Status note**: This launch gate was completed by commit `3841724`. Do not
> execute the original repair plan again. Use the commands below as the entry
> gate for every remaining launch plan.

## Status

- **Priority**: P0
- **Effort**: complete
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / DX / correctness
- **Completed at**: commit `3841724`, 2026-07-16

## What was completed

- Local state schema v5 has explicit migration and idempotency coverage.
- Profile writes patch rather than replace unknown data; onboarding is
  first-run-only and Profile & Settings is the canonical editor.
- Answer memory is isolated by active profile and optional company domain.
- Concurrent profile, graph, and state writes are serialized.
- Resume versions preserve immutable content and hashes.
- Critical runtime JavaScript is checked semantically by TypeScript.
- CI installs Chromium and sets `APPLYOS_REQUIRE_BROWSER=1`, so release browser
  checks cannot silently skip.
- The real-browser suite covers ten ATS fixtures plus diagnostics, popup,
  onboarding/profile, submission, CRM, interview, and backup flows.

## Verified baseline

Run this before beginning Plans 001–007 and again before merging each plan:

```sh
npm run lint
npm run typecheck
npm test
APPLYOS_REQUIRE_BROWSER=1 npm run verify
```

Expected results at `3841724`:

- lint exits 0 after checking 21 scripts, the manifest, and page references;
- typecheck exits 0;
- `npm test` reports 38 passed, 0 failed;
- release verification builds the extension and runs the real Chromium suite.

## Regression rule

If any command above fails on the executor's starting branch, stop the selected
feature plan and report the regression. Do not weaken, skip, or delete a gate to
make cloud/account work pass.
