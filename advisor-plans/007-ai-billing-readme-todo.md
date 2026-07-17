# Plan 007: Add a README-only TODO for future cloud AI and payments

> **Executor instructions**: This is deliberately documentation-only. Follow the
> exact scope and do not install billing/AI dependencies or create cloud tables.
> Update this plan's status row in `advisor-plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 3841724..HEAD -- README.md shared/ai.js`

## Executor prompt

> Add a concise, technically responsible "Future AI and billing (TODO)" section
> to ApplyOS README. Preserve the current offline Smart Tools and optional local
> Ollama description. List future tasks for a provider-agnostic server AI gateway,
> explicit opt-in and redaction, server-side plans/entitlements, idempotent usage
> metering, Stripe Checkout/Customer Portal/webhooks, quotas and cost controls,
> deletion/retention, and tests. State that secrets and payment logic never ship
> in the extension and that no cloud AI or billing is implemented yet. Change no
> runtime file, dependency, schema, or permission.

## Status

- **Priority**: P2
- **Effort**: S (under half a day)
- **Risk**: LOW
- **Depends on**: Plan 001 terminology
- **Category**: docs / direction
- **Planned at**: commit `3841724`, reconciled 2026-07-17
- **Completed in**: this launch-product-contracts PR

## Why this matters

The repo already has provider-specific local Ollama code and deterministic
offline Smart Tools, but no paid cloud AI, entitlements, usage ledger, billing,
or Stripe lifecycle. A scoped TODO preserves the direction without prematurely
adding payment infrastructure or misleading users before the business model is
approved.

## Current state

- `README.md:108` says Smart Drafts work without accounts/model downloads and
  Ollama is optional/local.
- `shared/ai.js:6-18` stores only local Ollama configuration.
- `shared/ai.js:132-178` generates deterministic offline Smart outputs.
- `shared/ai.js:181-258` optionally sends prompts only to the user's configured
  localhost Ollama endpoint.
- `package.json` has no AI provider, Stripe, billing, or entitlement dependency.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Scope check | `git diff --name-only` | only README plus plan status |
| TODO check | `rg -n "Future AI and billing|provider-agnostic|entitlements|usage|Stripe|webhook|quota|retention" README.md` | all roadmap terms present |
| Baseline | `npm run lint && npm run typecheck && npm test` | exit 0 |

## Scope

**In scope**:

- `README.md`
- Plan status row in `advisor-plans/README.md`

**Out of scope**:

- Any `.js`, `.ts`, SQL, manifest, package, lockfile, environment, or deployment
  change.
- Selecting prices/models/providers or creating Stripe/Supabase resources.

## Git workflow

- Branch: `codex/007-ai-billing-readme-todo`
- Commit: `docs: add future AI and billing TODO`
- Do not push/open a PR unless instructed.

## Steps

### Step 1: Add the TODO section

Place the following meaning near Smart Drafts/development roadmap, adapting only
for README style:

```markdown
## Future AI and billing (TODO — not implemented)

- [ ] Add a provider-agnostic server AI gateway; keep provider secrets and model
      routing out of the extension.
- [ ] Require explicit cloud-AI opt-in and define prompt redaction, retention,
      deletion, and no-training commitments before transmitting profile/resume data.
- [ ] Keep current offline Smart Tools and optional local Ollama available without
      a paid plan.
- [ ] Add server-owned plans, entitlements, feature flags, quotas, and an
      idempotent usage/cost ledger before any metered AI release.
- [ ] Integrate Stripe Checkout, Customer Portal, and signed webhook processing
      server-side; never put Stripe secret keys or price authority in the extension.
- [ ] Enforce subscription state and usage limits server-side, including webhook
      retries, duplicate events, refunds, cancellations, grace periods, and abuse.
- [ ] Add billing/AI observability and tests without logging prompts, resumes,
      payment details, authentication tokens, or other sensitive content.
```

Add one sentence that pricing, providers, and launch timing remain undecided.

**Verify**: the TODO check command returns all concepts.

### Step 2: Confirm no implementation leaked into scope

Run `git diff --name-only` and `git diff -- README.md`. Revert no user changes;
if unrelated changed files are present, leave them untouched and verify this
plan's own diff only.

**Verify**: no runtime/dependency/schema/permission file was changed by this plan.

### Step 3: Run baseline checks

Run `npm run lint && npm run typecheck && npm test`; all existing tests pass.

## Test plan

Documentation-only. Use the scope and targeted `rg` checks plus existing baseline.

## Done criteria

- [ ] README contains the explicit not-implemented TODO checklist.
- [ ] Offline Smart Tools and optional local Ollama remain promised.
- [ ] Secrets, entitlements, usage metering, Stripe webhooks, quotas, privacy, and
  tests are covered.
- [ ] No AI/billing provider, price, or timeline is prematurely selected.
- [ ] No runtime/dependency/schema/permission file changed.
- [ ] Existing checks pass.

## STOP conditions

- The operator asks to select/implement billing or AI rather than document it.
- README already contains a newer approved roadmap that conflicts with this one.
- Adding the TODO would claim a feature or price is committed when it is not.

## Maintenance notes

When implementation begins, split this checklist into separate architecture,
entitlements/usage, AI privacy, Stripe lifecycle, and operations plans. Billing
webhooks and usage enforcement must remain server-authoritative.
