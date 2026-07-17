# ApplyOS data and privacy boundaries

ApplyOS currently stores its workspace locally. Planned accounts and sync must
preserve that local-first behavior and create an explicit boundary between a
candidate's private job search and any future recruiter product.

## Zone 1: Local private workspace

This is the current product and the source of truth while cloud sync is absent
or disabled. It lives in `chrome.storage.local` and includes:

- job-search profiles and active-profile metadata;
- applications, descriptions, priorities, statuses, deadlines, and notes;
- reminders and completion history;
- contacts, relationships, emails, LinkedIn URLs, and networking notes;
- interviews, meeting details, research, preparation, and question notes;
- answer memory, company-scoped answers, corrections, and knowledge graph;
- resume files, resume text, versions, hashes, and application references;
- local settings, optional localhost Ollama configuration, and encrypted backup
  checkpoints.

No recruiter, employer, or other user may read this workspace. The current
release has no ApplyOS backend or analytics. Explicit Gmail, Outlook, LinkedIn,
job, and meeting links navigate to those services but do not give ApplyOS access
to the user's external account.

## Zone 2: Opt-in cloud private workspace

This zone is planned, not implemented. It may contain an owner-only synchronized
copy of selected Zone 1 records after the user signs in and affirmatively enables
sync.

Required rules:

- local-only mode remains available and core autofill does not require network;
- the first upload shows which collections and resume files will be transmitted;
- resume-file synchronization is a separate explicit choice;
- data is encrypted in transit and protected by provider storage controls;
- PostgreSQL Row Level Security proves per-user ownership for every exposed row;
- privileged credentials and provider secrets never ship in the extension;
- sync uses durable outbox records, idempotency, versions, tombstones, and
  deterministic conflict handling rather than client-clock last-write-wins;
- account switching cannot mix one user's local workspace with another's;
- users can export and delete their cloud account and data; and
- privacy, retention, support-access, and deletion behavior are documented
  before production data is accepted.

Do not call this end-to-end encrypted unless client-side encryption is designed,
implemented, independently reviewed, and prevents the service from reading the
plaintext. Provider encryption at rest is not the same promise.

## Zone 3: Opt-in recruiter publication

This zone is also planned, not implemented. It is a separate searchable snapshot
that a candidate deliberately creates, previews, publishes, updates, pauses, or
withdraws.

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

Private support reporting is planned to accept only a user-reviewed, sanitized
diagnostic payload through an authenticated, validating, rate-limited endpoint.
It must not include field values, resume data, auth tokens, full URLs/query
parameters, screenshots, or general browsing telemetry. Support access and
retention are separate from recruiter publication.

## Claims that must change when cloud sync launches

Before production sync is enabled, audit and update:

- `README.md` local-only and no-backend statements;
- onboarding privacy and consent copy;
- popup/account sync status and first-upload disclosure;
- dashboard privacy labels;
- Profile & Settings account, resume-sync, export, and deletion controls;
- Smart Draft/Ollama copy if any prompt can leave localhost;
- the public privacy policy, terms, retention, support, and deletion pages;
- Chrome Web Store listing, privacy questionnaire, permissions justification,
  and prominent in-product disclosure; and
- this document and `docs/product-feature-map.md`.

Do not update these claims early. The current release should continue to state
that its implemented workspace is local until real opt-in cloud behavior ships.
