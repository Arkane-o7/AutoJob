# Scout Privacy Policy — launch draft

**Effective date:** July 18, 2026  
**Last updated:** July 19, 2026

> **Before publishing:** replace every bracketed placeholder, have the final
> policy reviewed for the countries where Scout will be offered, and host it at
> a stable public HTTPS URL. This repository draft is not legal advice.

Scout is a job-application organization and autofill service operated by
**Abhilaksh Chauhan** ("Scout", "we", "us", or "our"). This policy explains
what information Scout processes, why it is processed, and the choices available
to you.

## 1. Information Scout processes

### Account and identity information

When you create or access a Scout account, we process your email address, user
identifier, sign-in provider, display name, profile image when supplied by the
provider, authentication timestamps, and session/security information. You may
sign in using an email verification code, Google, or LinkedIn OpenID Connect.
Google and LinkedIn are used only for authentication. Scout does not import your
Google data, LinkedIn connections, messages, posts, employment history, or
contacts.

### Profile and resume information

Scout processes information you choose to save for job applications, including
your name, contact information, address, location, work authorization, education,
employment history, skills, salary or availability preferences, portfolio links,
reusable application answers, resume text, and uploaded resume files.

### Application workspace information

Scout processes jobs you save and your related activity, including company,
role, source website, job URL, job description, extracted skills, match results,
application status, deadlines, notes, reminders, follow-ups, drafts, recruiter or
networking contacts, interviews, preparation notes, and next actions.

### Job-page and form information

When Scout runs on a job or application page, it processes page content and form
structure on your device to detect the job, identify fields, suggest answers, and
autofill fields you review. This can include the page domain, job text, visible
field labels, field types, and accessibility attributes. Scout does not submit an
application, accept consent, solve a CAPTCHA, complete an assessment, or send a
message for you.

### Support reports

If you choose **Send private report**, Scout sends the description you write and
the specific sanitized field structures you select. Reports may include the
source domain, ATS platform, extension version, visible labels, field types, and
allowlisted structural attributes. Scout is designed to exclude entered field
values, hidden controls, resume contents, filenames, URL query strings, email
addresses, phone numbers, and authentication tokens. You review the complete
payload before sending it.

### Candidate publication

Scout does not offer recruiter discovery or a recruiter-facing candidate card
in the current release. If that feature is introduced later, this policy and the
product consent flow must be updated before any candidate information can be
published.

## 2. How Scout uses information

We process information to:

- authenticate your account and protect it from misuse;
- maintain your private, account-scoped workspace across supported devices;
- provide job capture, autofill, matching, reminders, CRM, drafts, and interview
  organization;
- preserve user-specific offline access and synchronize queued changes;
- provide export, deletion, conflict review, and account-recovery functions;
- investigate user-submitted support reports and improve compatibility;
- protect Scout, its users, and its infrastructure from abuse; and
- comply with applicable legal obligations.

Scout does not sell personal information. Scout does not use resume or
application information for advertising. Scout does not silently publish a
candidate profile or automatically send an application, email, or message.

Scout's use and transfer of information received from Google APIs adheres to the
Google API Services User Data Policy, including the Limited Use requirements.

## 3. Cloud storage and offline cache

The authoritative Scout workspace is stored in Scout's Supabase project. Data is
transmitted over encrypted HTTPS connections. Resume files are stored in a
private, user-scoped storage bucket. Database Row Level Security restricts normal
client access to records owned by the signed-in user.

Scout also retains an account-specific cache in Chrome extension storage so the
signed-in user can continue working during temporary connection loss. The cache
is separated by Scout user identifier. Signing out removes the active workspace
from use on that browser. Some internal migration identifiers continue to use the
previous product codename for compatibility; this does not create a separate
service or data recipient.

## 4. Service providers

Scout currently relies on:

- **Supabase** for authentication, database hosting, private file storage, and
  server-side functions;
- **Google** and **LinkedIn**, only when you choose those authentication methods;
- **Google Gmail SMTP (`smtp.gmail.com`)** to deliver email verification codes; and
- **Google Chrome and the Chrome Web Store** to distribute and run the extension.

When you explicitly choose a Gmail, Outlook, or default-email compose button,
Scout opens a reviewed draft in that provider. Scout does not receive mailbox
access and does not send the draft.

If you explicitly enable optional local Ollama tools, selected prompt content is
sent to the localhost endpoint you configure. It is not routed through Scout's
hosted infrastructure.

We may disclose information when legally required, to protect users or the
service, or as part of a corporate transaction subject to appropriate safeguards.

## 5. Retention

Your private workspace is retained while your Scout account remains active.
Deleted workspace records may be retained as synchronization tombstones only as
long as necessary to propagate deletion across your devices. Private support
reports are scheduled for deletion or anonymization after 90 days unless a
longer period is required to investigate abuse, resolve a security issue, or
comply with law.

When you delete your Scout account, Scout deletes active database records,
uploaded resume objects, active sessions, and the account's cache on the current
browser. Encrypted provider backups may persist temporarily according to the
infrastructure provider's backup lifecycle and are not used to restore an
individually deleted account.

## 6. Your choices and rights

Scout provides controls to:

- review or change saved profile and application information;
- export your account workspace;
- delete individual applications and related records;
- keep or unpublish the optional candidate card;
- sign out and stop using the local account cache; and
- permanently delete your Scout account.

Depending on your location, you may also have rights to access, correct, delete,
restrict, object to, or receive a portable copy of personal information. Contact
us at **tryjobscout@gmail.com**. We may need to verify that the request belongs to the
account holder.

## 7. Security

Scout uses user-scoped database and storage policies, encrypted transport,
server-side secrets, limited diagnostic payloads, and review gates for external
actions. No online service can guarantee absolute security. If you believe your
account or Scout data is at risk, contact **tryjobscout@gmail.com**.

## 8. Children

Scout is intended for people who are legally able to seek employment and is not
directed to children under 16. If you believe a child has provided information
without appropriate authorization, contact us so we can investigate and delete
it.

## 9. International processing

Scout's current Supabase project is hosted in the Seoul, South Korea region.
Authentication and other providers may process information in additional
countries. Before public launch, **Abhilaksh Chauhan** will publish the
applicable transfer safeguards and update this section if the production region
changes.

## 10. Changes to this policy

We may update this policy as Scout changes. We will update the date above and,
when a change materially affects how previously collected information is used,
provide an in-product notice or request new consent where required.

## 11. Contact

**Abhilaksh Chauhan**  
**Online-only service; no public postal address**  
Privacy: **tryjobscout@gmail.com**  
Support: **tryjobscout@gmail.com**  
Security: **tryjobscout@gmail.com**
