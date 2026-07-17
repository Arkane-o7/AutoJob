# ApplyOS cloud deployment and launch gate

Version 0.10 contains the client runtime, database migration, Row Level Security
(RLS), private resume bucket, Edge Functions, account UI, consent controls, and
tests. It intentionally contains no production URL, publishable key, LinkedIn
secret, service-role key, customer data, or billing secret.

## What the deployer must supply

- A staging and production Supabase project.
- A LinkedIn Developer app with **Sign In with LinkedIn using OpenID Connect**.
- The final Chrome Web Store extension ID. `chrome.identity.getRedirectURL()`
  produces `https://<extension-id>.chromiumapp.org/auth/callback`; add that exact
  URL to the Supabase Auth redirect allow list.
- The Supabase Auth callback
  `https://<project-ref>.supabase.co/auth/v1/callback` in LinkedIn's authorized
  redirect URLs. LinkedIn redirects to Supabase; Supabase returns to the exact
  extension URL.
- A public privacy policy, terms, support contact, retention policy, and account
  deletion instructions that accurately describe local and optional cloud data.

Official references:

- [Supabase LinkedIn OIDC setup](https://supabase.com/docs/guides/auth/social-login/auth-linkedin)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Chrome Web Store user-data requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## 1. Run the local database gate

Install Docker, then from the repository root:

```sh
cp supabase/.env.example supabase/.env
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

`supabase/tests/001_rls.sql` verifies that private tables have RLS and that the
support table has no normal-client policy. Add authenticated cross-user tests
before accepting production data. Docker is not bundled with this repository.

## 2. Create and link staging

```sh
npx supabase@2.109.1 login
npx supabase@2.109.1 link --project-ref YOUR_STAGING_REF
npx supabase@2.109.1 db push
npx supabase@2.109.1 functions deploy submit-support-report
npx supabase@2.109.1 functions deploy delete-account
```

Set Edge Function secrets in Supabase, never in Git or the extension:

```sh
npx supabase@2.109.1 secrets set \
  SUPABASE_URL=https://YOUR_STAGING_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

The service-role key bypasses RLS and must stay server-side. The extension needs
only the project URL and publishable key.

## 3. Configure LinkedIn OIDC

1. Create the LinkedIn Project/App and request the OpenID Connect sign-in
   product.
2. Add Supabase's callback URL to LinkedIn.
3. Enable **LinkedIn (OIDC)** in Supabase Auth and enter the LinkedIn client ID
   and secret there.
4. Add the exact staging extension redirect URL to Supabase's redirect allow
   list. Do not use a wildcard in production.
5. Put the staging project URL and publishable key into the Account page during
   internal testing. Before public release, set the non-secret defaults in
   `shared/cloud-config.js` so ordinary users never see deployment setup.

LinkedIn sign-in provides basic identity claims. It does not authorize ApplyOS
to import a member's connections, messages, posts, contacts, or work history.
Do not present it as candidate identity or employment verification.

## 4. Verify the data boundaries

Test with two unrelated accounts and prove:

- Account A cannot read, update, or delete Account B's private tables or resume
  objects.
- Support reports can be inserted only through the authenticated Edge Function
  and are redacted, bounded, rate-limited, retained for the documented period,
  and inaccessible to normal clients.
- Workspace sync is off before explicit consent; resume bytes remain local
  before separate resume consent.
- A version conflict pauses without overwriting either copy. **Use cloud copy**
  and **Replace cloud with local** require typed confirmation, and **Undo cloud
  restore** restores the local checkpoint.
- Candidate publication starts private. Recruiter visibility exposes only its
  reviewed allowlist and never applications, notes, contacts, interviews,
  answers, or resume files.
- Sign-out, export, and cloud-account deletion work on a clean browser profile.
- Signing a different account into an already linked local workspace triggers an
  account-safety stop instead of uploading or restoring either user's data.

The current sync protocol is owner-only snapshot sync with durable client retry,
idempotent change IDs, server versions, and explicit conflict resolution. It is
not end-to-end encrypted or a collaborative per-record merge engine.

## 5. Privacy and Chrome Web Store release gate

Before staging becomes production:

- Publish and link the privacy policy and terms from the Store listing and
  product website.
- Complete the Chrome Web Store privacy questionnaire for identity, personal
  information, website content, form data, locally stored data, and optional
  transmissions.
- Keep the in-product prominent disclosure and affirmative sync/resume/
  publication choices. A policy page alone is not sufficient consent.
- Document subprocessors, encryption in transit/at rest, retention, support
  access, breach handling, export, and deletion service levels.
- Establish a private staff support console and least-privilege support roles;
  do not use the Supabase dashboard as the long-term support product.
- Run a legal/privacy/security review and a third-party penetration test before
  accepting real resumes or recruiter publication.
- Confirm the final public name, domain, publisher identity, support address,
  OAuth branding, and billing descriptor before creating production apps.

## 6. Promote staging to production

Apply the same committed migration and functions to a separate production
project, configure the final extension redirect, embed only the production URL
and publishable key, build from a clean checkout, and run:

```sh
npm ci
npm run verify
npm run db:test
git diff --exit-code
```

Do not mark the cloud release ready if the database tests, two-account isolation
test, LinkedIn login, deletion, private support, resume consent, conflict flow,
or Chrome Web Store disclosures have not been verified against production-like
staging.
