# Plan 009: First-class companies and Waiting states

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: Plans 008 and 008.1
- **Planned at**: `f9f16bc`, 2026-08-02
- **Status**: IN PROGRESS

## Outcome

Give Scout two visible CRM capabilities without expanding into mailbox
integration or automation:

1. A **Companies** workspace with editable company records and a focused page
   showing active applications, contacts, interviews, actions, and notes.
2. A **Waiting** workspace for replies and decisions, grouped into overdue,
   expected today, upcoming, and no expected date.

## Data and migration

- Advance local storage to schema v7.
- Add `companies` and `waiting_items` collections.
- Add nullable `company_id` to applications and contacts while retaining their
  displayed `company` string.
- Migrate company strings using exact normalized names only. A matching domain
  may link records when both records expose one; fuzzy matching is forbidden.
- Sync `company` and `waiting_item` as owner-scoped workspace entities.
- Deleting a company detaches related applications and contacts and preserves
  their display strings.

## Product scope

- Create, edit, open, and delete companies from the dashboard.
- Company details show active applications, contacts, upcoming interviews,
  open actions, notes, tags, domain, and website.
- Create or update an open Waiting item from an application or contact.
- Resolve Waiting items, edit expected dates, and turn overdue items into
  user-created follow-up actions.
- Show Waiting indicators on linked application and contact cards.
- Keep existing dashboard layout and drawers; add only the navigation,
  workspaces, forms, and compact indicators needed for these flows.

## Verification

- Unit coverage for migration safety, company CRUD/linking/detach semantics,
  Waiting CRUD/grouping/conversion, and reload persistence.
- Browser regression coverage for the Companies and Waiting dashboard flows.
- Supabase coverage for new owner-scoped entity types.
- Run all commands requested in the Plan 009 brief before publishing a draft
  pull request.

Current implementation verification (2026-08-02): 88/88 unit tests, 10/10 ATS
fixtures plus the packaged extension CRM lifecycle, 63/63 pgTAP assertions,
zero database lint warnings, and a passing aggregate `npm run verify`. The plan
remains **IN PROGRESS** while the draft pull request is reviewed.

## Deliberately out of scope

Mailbox integrations, automatic message reading, sequences, AI or relationship
scoring, analytics, company enrichment, fuzzy matching, and elaborate
automation remain deferred.
