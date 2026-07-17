# ApplyOS product feature map

This document explains what ApplyOS does today, which behavior is planned, and
where licensed open-source adaptations end. It is a product and privacy guide,
not a promise that future cloud, recruiter, AI, or billing features are already
available.

## Feature glossary

| Feature | Plain-language meaning | Current behavior | Data used | Network behavior | It explicitly does not do |
|---|---|---|---|---|---|
| Job capture and ATS recognition | Save a job from its posting or application page | Extracts company, role, description, location, deadline, source, URL, and keywords with confidence indicators and editable fallbacks | Visible job-page metadata and text | None for storage; captured records stay local | It does not silently save every visited page or treat uncertain metadata as fact |
| Review-first autofill | Fill application fields from a chosen profile | Fills confident empty fields, supports common ATS controls and accessible frames, and can attach the locally saved resume | Active profile, answer memory, resume file, and reviewed form labels/structure | None unless the user explicitly enables localhost Ollama | It never clicks Next, Review, Apply, or Submit and does not fill blocked sensitive, consent, CAPTCHA, or assessment fields |
| Candidate CRM | A private personal system for managing the user's own job search | Tracks applications, pipeline status, priority, deadlines, notes, match score, applied date, follow-ups, resume version, and source in board and list views | Applications, reminders, profiles, resume versions, notes, and job descriptions | None in the current release | It is not an employer ATS and is not recruiter-visible |
| Resume/job matching | Explain how well the active profile matches a saved role | Calculates a deterministic score, matched and missing skills, keyword suggestions, and experience hints | Pasted resume text, structured profile fields, and job description | None for the built-in matcher | It does not claim hiring probability or invent qualifications |
| Answer memory | Reuse answers the user has reviewed | Matches repeated questions to profile defaults, custom answers, and learned corrections; custom answers can be limited to one company domain and profile | Application-question text, user-approved answers, field fingerprints, profile ID, and optional company domain | None | It does not answer when confidence is low or reuse another profile's/company's restricted answer |
| Knowledge/correction graph | Improve retrieval after the user corrects a field | Stores local question, field, profile, company, and reinforcement relationships used to rank reusable answers | Reviewed corrections and structural field context | None | It does not upload corrections, train a remote model, or learn from hidden field values |
| Follow-up reminders | Help the candidate remember when to contact an employer | Creates an editable 7-day reminder and optional 14-day reminder after the user marks an application applied; due items appear in the dashboard and badge | Application, applied date, reminder preferences, and completion state | None | It does not infer submission silently or contact anyone automatically |
| Follow-up compose handoff | Prepare a message without sending it | Generates an editable draft and opens a reviewed Gmail, Outlook, or local-email compose URL | Candidate profile, application, selected contact, and draft type | Only the explicit provider compose page opened by the user | It has no mailbox credentials and never sends email |
| Contacts/networking CRM | Remember people connected to the job search | Stores manually entered recruiters, hiring managers, interviewers, referrals, employees, and other contacts with company, role, email, LinkedIn URL, notes, and next action | Contact records and explicit application links | Only explicit LinkedIn-page or email-compose navigation | It does not import LinkedIn connections, scrape a network, read messages, or send outreach |
| Interview workspace | Organize interview preparation and follow-through | Stores round, format, schedule, interviewer, meeting details, research, preparation notes, question notes, next action, and a reviewed thank-you draft | Interview, application, contact, and profile records | Only explicit meeting/email links opened by the user | It does not record meetings, join calls, send thank-you messages, or evaluate the candidate |
| Multiple job-search profiles | Keep distinct profile/resume contexts | Supports a switchable active profile, canonical Profile & Settings editor, profile-specific answer isolation, and resume-version references | Local profile index, structured profile fields, answers, and resume versions | None | It does not merge profiles silently or expose one profile's restricted answers to another |
| Resume versions and attachment | Reuse the correct local resume file | Stores immutable resume content and hashes, links a version to an application, and attaches it only to compatible empty upload controls | Local resume file, type, size, data URL, hash, and version ID | None | It does not parse PDF/DOCX binary contents or replace an already attached file |
| Smart Drafts | Produce immediate reviewable writing guidance without setup | Creates deterministic cover-letter starting points, resume focus plans, and keyword-gap guidance from known facts | Candidate profile/resume text and saved job description | None in default mode | It does not require an account, paid model, or model download and must not invent facts |
| Optional local Ollama enhancement | Let technical users use a model running on their own computer | Sends selected Smart Draft prompts to the configured localhost Ollama endpoint when explicitly enabled | The prompt assembled for the selected Smart Tool | Localhost only, using the user-configured endpoint | It is not required during onboarding and is not a hosted ApplyOS AI service |
| Conservative submission confirmation | Ask whether a likely completed application should be tracked | Combines a recent trusted submit interaction with strong confirmation-page evidence, then asks the user to confirm | Recent local submit intent and confirmation-page structure/text | None | It never changes status or schedules reminders without explicit confirmation |
| Encrypted backup and restore | Move or recover the complete local workspace manually | Exports a password-derived AES-256-GCM `.applyos` file, previews a restore, validates versions, and retains one local undo checkpoint | Complete local workspace including saved resume files | None; export/import is performed locally | It cannot recover a forgotten password and is not cloud sync |
| Reviewed site diagnostics | Let the user inspect a privacy-safe broken-field report | Includes only selected labels and allowlisted DOM structure after review; values, hidden controls, resume contents, and sensitive URL data are excluded | Selected structural field metadata, domain, platform, and extension version | Current release can open a user-reviewed GitHub issue; a private first-party endpoint is planned | It does not capture entered answers, upload automatically, or collect general browsing analytics |

## Terms for planned cloud work

- **Online account** means an ApplyOS identity and session that can later own
  optional cross-device sync, export, and deletion. LinkedIn is the proposed
  sign-in provider; it is not the database.
- **LinkedIn sign-in** means authentication using LinkedIn OpenID Connect. It
  does not import connections, contacts, messages, posts, employment history,
  or recruiter permissions, and it is not identity verification.
- **Opt-in private cloud workspace** means an owner-only synchronized copy of
  selected ApplyOS data after prominent disclosure and explicit consent. Local
  mode must continue to work without an account.
- **Candidate publication** means a future, separate, user-approved recruiter-
  facing snapshot. It is not the private profile used for autofill, and it can
  be withdrawn independently.

Cloud accounts, sync, candidate publication, recruiter search, paid cloud AI,
and billing are not implemented in the current release.

## Licensed adaptations and ApplyOS-specific product work

ApplyOS contains licensed implementation adaptations from two repositories, as
recorded in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md):

- **Offlyn Apply**, MIT licensed: ATS recognition, semantic field
  classification and safeguards, value normalization, controlled-input
  compatibility, localhost Ollama service patterns, multi-profile patterns,
  knowledge-memory patterns, and the Workday inline-form handler. ApplyOS
  removed automatic Workday step navigation and keeps submission manual. See
  [`licenses/OFFLYN_APPLY_MIT.txt`](../licenses/OFFLYN_APPLY_MIT.txt).
- **Job App Filler**, BSD 3-Clause licensed: Greenhouse legacy/React field
  containers, Select2/react-select option discovery, and file-dropzone
  compatibility patterns. Its UI, storage system, injected React-property
  access, and automatic behavior are not included. See
  [`licenses/JOB_APP_FILLER_BSD_3_CLAUSE.txt`](../licenses/JOB_APP_FILLER_BSD_3_CLAUSE.txt).

The ApplyOS interface, job capture, candidate CRM, dashboard, reminders,
contacts/networking CRM, interview workspace, reviewed compose handoffs,
submission confirmation, encrypted backups, privacy-reviewed reporting flow,
and the planned cloud/recruiter architecture are ApplyOS product work unless a
source file or third-party notice explicitly states otherwise.

### Market inspiration is not code provenance

Products such as Simplify, Huntr, and Teal are useful competitive references
for user expectations and positioning. A similar feature category does not mean
their source code was copied. Do not describe competitor-inspired product ideas
as licensed adaptations unless repository evidence and the appropriate license
notice are added.

## Product safety contract

ApplyOS remains review-first:

- users review and submit applications themselves;
- users review and send messages themselves;
- low-confidence and sensitive fields remain manual;
- local-only mode remains usable without an account;
- cloud transmission requires accurate disclosure and explicit consent; and
- recruiter visibility, if built, is limited to a separate publication the
  candidate deliberately creates and can withdraw.
