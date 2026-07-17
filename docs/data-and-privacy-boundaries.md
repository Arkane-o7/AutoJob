# ApplyOS data and privacy boundaries

ApplyOS stores its workspace locally by default. A configured production build
can also keep an owner-only cloud copy after explicit consent. The account and
publication design preserves a strict boundary between a candidate's private
job search and any future recruiter product.

## Zone 1: Local private workspace

This is the default product and source of truth while cloud sync is absent or
disabled. It lives in `chrome.storage.local` and includes:

- job-search profiles and active-profile metadata;
- applications, descriptions, priorities, statuses, deadlines, and notes;
- reminders and completion history;
- contacts, relationships, emails, LinkedIn URLs, and networking notes;
- interviews, meeting details, research, preparation, and question notes;
- answer memory, company-scoped answers, corrections, and knowledge graph;
- resume files, resume text, versions, hashes, and application references;
- local settings, optional localhost Ollama configuration, and encrypted backup
  checkpoints.

No recruiter, employer, or other user may read this workspace. ApplyOS has no
analytics. Explicit Gmail, Outlook, LinkedIn, job, and meeting links navigate to
those services but do not give ApplyOS access to the user's external account.

## Zone 2: Opt-in cloud private workspace

The version 0.10 runtime and supplied Supabase backend implement an owner-only
synchronized snapshot of selected Zone 1 records after the user signs in and
affirmatively enables sync. It is disabled when no production project is
configured.

Required rules:

- local-only mode remains available and core autofill does not require network;
- the first upload shows which collections and resume files will be transmitted;
- resume-file synchronization is a separate explicit choice;
- data is encrypted in transit and protected by provider storage controls;
- PostgreSQL Row Level Security proves per-user ownership for every exposed row;
- privileged credentials and provider secrets never ship in the extension;
- sync uses a durable client retry record, idempotent change IDs, server versions,
  and explicit conflict handling rather than client-clock last-write-wins;
- account switching cannot mix one user's local workspace with another's;
- users can export and delete their cloud account and data; and
- privacy, retention, support-access, and deletion behavior are documented
  before production data is accepted.

Do not call this end-to-end encrypted unless client-side encryption is designed,
implemented, independently reviewed, and prevents the service from reading the
plaintext. Provider encryption at rest is not the same promise.

## Zone 3: Opt-in recruiter publication

The candidate can create and withdraw this separate publication record. It is
private by default and can be marked eligible only after a separate reviewed
choice. No recruiter-facing read policy exists yet. Recruiter organizations,
verification, search, and shortlist products are still planned and must use
this record rather than Zone 1 or Zone 2.

Potential publishable fields are limited to values the candidate explicitly
selects, such as:

- professional headline and target roles;
- coarse location and work preferences;
- selected skills and experience summary;
- selected portfolio, GitHub, or LinkedIn links;
- selected work-authorization preference; and
- publication and visibility timestamps.

It must never contain or derive recruiter access to:

- applications, saved jobs, statuses, rejections, offers, or deadlines;
- employer-specific notes or private match scores;
- contacts, recruiter emails, relationships, or networking notes;
- answer memory, corrections, field fingerprints, or knowledge graph;
- interview schedules, meeting URLs, research, preparation, or question notes;
- full private profiles or resume files unless a later, separately consented
  sharing workflow is designed; or
- authentication tokens, device identifiers, sync metadata, support reports,
  or encrypted-backup material.

Recruiter organizations, verification, search, and shortlists require a later
authorization design. A shortlist may reference a candidate publication; it may
not reference or query the private workspace.

## Data-flow rules

```text
Job page + user input
        |
        v
Zone 1: local private workspace
        |
        | explicit sign-in + sync consent
        v
Zone 2: owner-only cloud workspace
        |
        | separate preview + publish action
        v
Zone 3: limited recruiter publication
```

There is no automatic Zone 1 → Zone 3 path. Cloud sync consent is not recruiter
publication consent. LinkedIn sign-in is not sync consent. Publishing a profile
is not permission to expose private job-search activity.

## Support-report boundary

Private support reporting accepts only a user-reviewed, sanitized diagnostic
payload through an authenticated, validating, rate-limited endpoint.
It must not include field values, resume data, auth tokens, full URLs/query
parameters, screenshots, or general browsing telemetry. Support access and
retention are separate from recruiter publication.

## Production cloud release gate

Before production sync is enabled, deploy and verify the backend, then audit:

- all product claims about local-only/default and optional cloud behavior;
- onboarding privacy and consent copy;
- popup/account sync status and first-upload disclosure;
- dashboard privacy labels;
- Profile & Settings account, resume-sync, export, and deletion controls;
- Smart Draft/Ollama copy if any prompt can leave localhost;
- the public privacy policy, terms, retention, support, and deletion pages;
- Chrome Web Store listing, privacy questionnaire, permissions justification,
  and prominent in-product disclosure; and
- this document and `docs/product-feature-map.md`.

The implementation must not be marketed as available until the provider setup,
two-account RLS tests, private support path, resume consent, export/deletion,
legal disclosures, and Chrome Web Store review are complete. See
[`cloud-deployment.md`](cloud-deployment.md).
