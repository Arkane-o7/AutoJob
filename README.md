# ApplyOS

ApplyOS is a private, review-first Chrome extension that combines job capture, application tracking, resume matching, answer memory, follow-up reminders, and the existing autofill engine. It never submits an application or sends a message.

ApplyOS retains its interface and legacy-profile compatibility while incorporating licensed implementation work adapted from [Offlyn Apply](https://github.com/offlyn-ai/offlyn-apply) and [Job App Filler](https://github.com/berellevy/job_app_filler). See `THIRD_PARTY_NOTICES.md` and `licenses/` for attribution and license terms.

## Existing architecture and the upgrade

The original extension was a Manifest V3, plain-JavaScript extension with three surfaces:

- `options.html` stored one legacy `profile` object—including resume data and custom answers—in `chrome.storage.local`.
- `popup.js` asks the background worker to run a reviewed fill pass; the worker targets every application frame explicitly and aggregates one report.
- `content.js` detected form fields from labels, ARIA metadata, names, placeholders, nearby text, ATS attributes, custom controls, open shadow roots, and subframes. It filled empty fields, attached the saved resume when allowed, and watched later multi-step fields.

There was no service worker, CRM schema, storage abstraction, job-page extractor, reminder engine, or dashboard. ApplyOS preserves the legacy `profile`, message name, keyboard shortcut, and autofill path, then adds a parallel versioned `applyos_state` store. Migration copies answer and resume metadata into the new store without deleting or rewriting the old profile.

The new modules are:

- `capture.js`: JSON-LD-first job extraction with adapters for LinkedIn, Workday, Greenhouse, Lever, Ashby, Wellfound, and generic career pages. Every extracted field has a confidence score and ambiguous title/company fields remain editable.
- `shared/offlyn-core.js`: MIT-attributed ATS recognition, semantic field classification, type/value safeguards, and correction matching adapted to the ApplyOS profile schema.
- `shared/ats-compat.js`: a registry-based compatibility layer for ATS field context, custom dropdown options, and resume dropzones. Greenhouse legacy/React patterns are BSD-attributed adaptations from Job App Filler; the remaining adapters use ApplyOS heuristics.
- `shared/profiles.js`: multi-profile index, active-profile switching, legacy `profile` mirroring, completeness checks, and resume-text normalization.
- `shared/storage.js`: explicit versioned migrations, runtime normalization, serialized writes, and CRUD for applications, reminders, contacts, interviews, scoped answer memory, immutable resume versions, and settings. Schema v5 records its revision and migration history while preserving legacy data.
- `shared/matching.js`: deterministic, local skill/keyword matching with matched skills, gaps, keywords, experience hints, and answer prompts.
- `shared/followup.js`: editable 7-day and optional 14-day reminders, interview thank-you drafts, and review-only Gmail, Outlook, and local-email-app compose links.
- `shared/ai.js`: zero-setup Smart Draft fallbacks for cover letters, resume focus plans, and keyword gaps, plus optional localhost-only Ollama enhancement.
- `shared/graph.js`: answer/correction knowledge graph with reusable-answer retrieval and lightweight reinforcement weights.
- `shared/agent.js`: local-AI planning with an allowlist of fill/select/check/skip actions and hard blocks for submission, consent, sensitive fields, CAPTCHAs, and assessments.
- `shared/workday.js`: 1,128-line browser-ready compatibility port of Offlyn's 1,277-line Workday handler. Type-only code and automatic Save-and-Continue navigation are intentionally removed; inline experience Add/Save remains to support multiple editable records.
- `shared/diagnostics.js`: privacy-safe broken-field snapshots containing only reviewed labels and allowlisted DOM structure—never entered values or file contents.
- `shared/submission.js`: conservative confirmation scoring that requires both recent user submit intent and strong confirmation-page evidence.
- `shared/backup.js`: password-derived AES-256-GCM export/import for the complete local workspace, decrypted summary review, safe version checks, and a one-step local restore checkpoint.
- `background.js`: state/profile migration, serialized per-tab application sessions, hourly due-date refresh, follow-up badge, correction learning, and localhost Ollama requests. It has no email credentials or send capability.
- `onboarding.*`: first-run quick setup that patches the canonical profile without replacing fields owned by Profile & Settings.
- `dashboard.*`: Kanban and table views, search/filters, priorities, upcoming actions, application details, contact/networking CRM, interview workspaces, review-only compose handoffs, match guidance, profile switching, and the local-AI studio.
- `types/applyos.ts`: TypeScript contracts for captured jobs, applications, contacts, interviews, reminders, answers, profiles, Ollama, knowledge graph/RL state, agent plans, resume versions, matches, and storage state.

## Install or update locally

1. Run `npm install` and `npm run verify` from this folder.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. If ApplyOS is already loaded, click its reload icon. Otherwise click **Load unpacked** and choose this project folder (or the generated `dist` folder).
4. Refresh any job pages that were already open so the updated content scripts load.
5. Pin **ApplyOS** and choose **Finish setup** once. After completion the same button becomes **Edit profile** and opens the canonical **Profile & Settings** editor.

All application, contact, interview, profile, answer, and resume data stays in `chrome.storage.local`. ApplyOS has no backend or analytics. Clicking Gmail, Outlook, or Email app explicitly opens a reviewed draft in that provider; nothing is sent. If Ollama is enabled, AI prompts go only to the user-configured localhost endpoint (default `http://localhost:11434`).

## Test the complete workflow

### 1. Save a job

Open a LinkedIn, Workday, Greenhouse, Lever, Ashby, Wellfound, or company job page. Open ApplyOS, review the editable company and role plus the extraction-confidence note, then click **Save to ApplyOS**.

For a deterministic fixture, run:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173/demo/job-posting.html`, refresh it after reloading the extension, and save the detected Atlas Robotics role.

### 2. Autofill an application

Open an application form, choose **Autofill application**, and inspect every highlighted answer. Multi-step assist remains active for later fields. The original **Option/Alt + Shift + A** shortcut still works. ApplyOS never clicks Next, Review, Apply, or Submit.

The fixtures `demo/application.html`, `demo/ats-fixtures.html`, and `demo/site-regressions.html` cover standard controls, Greenhouse legacy Select2 and React-select controls, custom ARIA controls, shadow DOM, Workday compound dates, NorthStarz labels, resume upload, and sensitive-field exclusions. On Workday's **My Experience** step, the specialized handler can manage multiple work/education inline entries. It never clicks the main Save and Continue button.

### ATS coverage

- Dedicated handler: Workday.
- Compatibility adapters: Greenhouse (legacy and React), Lever, Ashby, SmartRecruiters, iCIMS, Oracle/Taleo, Microsoft Careers/Eightfold, Workable, Jobvite, SAP SuccessFactors, BambooHR, Recruitee, Teamtailor, and Personio.
- Generic fallback: semantic labels, ARIA controls, native fields, open shadow roots, and accessible subframes on other company career pages.

An adapter means ApplyOS recognizes that ATS's common field containers, labels, dropdown options, and upload zones. Employer customizations can still differ, so every fill remains review-first and unsupported controls stay untouched.

### 3. Mark it applied

After you submit the application yourself, ApplyOS can recognize a likely confirmation page and ask **Did you submit this application?** Choose **Yes, mark applied** to record `applied_at` and create a first follow-up 7 days later plus an optional final follow-up 14 days later. **Not yet** changes nothing. You can still reopen ApplyOS and use **Mark as applied** manually.

Detection never changes an application status on its own. It requires a recent trusted submit interaction, strong confirmation evidence, and your explicit approval.

### Report a site problem

Choose **Report a site problem** in the popup to open an on-page review. No fields are selected by default. Select only the problematic controls and inspect the generated JSON. You can copy or download it locally, or open a prefilled public GitHub issue that you must review and submit manually. Nothing is uploaded automatically. Reports include bounded labels and allowlisted DOM attributes only; entered answers, resume filenames/data, email addresses, phone numbers, page query parameters, and hidden fields are excluded.

### 4. View the dashboard

Choose **Dashboard** from the popup. Switch between Board and List, search, filter by status/source/priority, drag cards between columns, or open a record to edit its status, dates, priority, and notes. An empty dashboard includes a **Load sample data** button.

### 5. See or edit a reminder

Applied records show the next follow-up in the popup and dashboard. Due reminders move an `applied` record to `follow_up_due` and appear in Next Actions and the extension badge. Edit **Next follow-up** in the application detail drawer to reschedule it, or choose **Done** in Next Actions to complete it.

### 6. Generate a follow-up draft

Open an application record, choose first or final follow-up, and click **Generate draft**. Select a linked contact if available, edit the subject and body, then copy it or open the reviewed draft in Gmail, Outlook, or the device email app. ApplyOS has no email credentials and no send function.

### 7. Track contacts and networking

Open **Dashboard → Contacts** to add recruiters, hiring managers, interviewers, referrals, employees, or general networking contacts. Store their company, title, email, LinkedIn URL, relationship, notes, last-contacted date, and next action. A contact can be linked to an application and selected as the recipient for reviewed drafts.

### 8. Use the interview workspace

Open an application and choose **Add interview**. Record the round, format, scheduled time, interviewer, location or meeting URL, company research, preparation notes, question notes, and next action. Saved interviews appear in **Next Actions** and move an active application to Interview. Generate and edit a thank-you draft, then manually open it in an email provider if desired.

### 9. Use Smart Drafts

Open an application and use Smart Draft Studio to create a factual cover-letter starting point, resume focus plan, or keyword-gap analysis. These work immediately without accounts, model downloads, terminal commands, or Ollama. Technical users may optionally connect an existing Ollama installation under **Profile & Settings → Advanced**, but it is never part of onboarding or required for core functionality.

### 10. Export or restore an encrypted backup

Open **Profile & Settings → Encrypted backup**. Choose a password of at least 10 characters and download the `.applyos` file. The file includes the complete local workspace, including saved resume files, and is encrypted before download. To restore, select the file, enter its password, review the decrypted record counts, type `RESTORE`, and confirm. A successful restore keeps one local undo checkpoint. ApplyOS never stores or recovers the backup password.

## Answer memory

Saving the profile imports standard defaults for salary, notice period, authorization, sponsorship, links, relocation, remote preference, and introduction. Custom question/answer pairs are synchronized authoritatively into answer memory and the local knowledge graph, so deleting an answer forgets it. Employer-history and relationship answers can be restricted to one company domain. User corrections are recorded with site/field context and reinforced for later similar questions. During autofill, saved and sufficiently similar questions are considered alongside the original profile rules; no answer is generated or selected when confidence is low.

## Development checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser:dist
# or all five
npm run verify
```

`npm test` covers explicit storage migrations, normalization and serialized writes alongside legacy and multi-profile migration, contact/interview CRUD, encrypted backup round trips and rollback, local matching, answer recall, knowledge-graph correction learning, agent action safety, Workday no-navigation enforcement, 7/14-day reminders and rescheduling, reviewed diagnostics, conservative confirmation scoring, and review-only draft generation.

`npm run test:browser:dist` launches the real unpacked Manifest V3 build in Playwright and runs deterministic regression fixtures for Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, Oracle/Taleo, Microsoft Careers/Eightfold, NorthStarz, and a generic React dropzone. It verifies field values and events, native and portal-rendered dropdowns, readonly-styled radio controls, resume attachment/existing-resume preservation, sensitive/consent exclusions, no navigation or submission, late-rendered fields, reviewed diagnostics and post-submit confirmation, contact creation, compose handoffs, interview preparation, and thank-you drafting. Set `APPLYOS_REQUIRE_BROWSER=1` to make a missing Playwright browser a hard failure. `npm run build` creates the clean extension in `dist/`.

## Safety boundaries and limitations

- Never auto-submits applications, advances application steps, sends emails, or overwrites an existing answer. Workday inline-entry Save buttons may be used only to add editable work/education records on the current step.
- Never autofills CAPTCHAs, consent attestations, assessments, demographic/self-identification fields, disability/veteran questions, government IDs, or birth dates.
- Closed shadow roots and inaccessible cross-origin frames cannot be inspected.
- Employer-specific custom widgets may still need manual entry; low-confidence job metadata is explicitly surfaced for review.
- PDF/DOCX binary contents are not parsed. Matching and AI use pasted resume text plus the structured profile; saved files remain local for attachment.
- Encrypted backups cannot be recovered without their password. Cloud accounts and cross-device sync are not included; those require a separately designed authentication, encryption, conflict-resolution, export, and deletion service.
