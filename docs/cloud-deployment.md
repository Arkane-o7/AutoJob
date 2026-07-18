# Scout cloud deployment and launch gate

The current release contains the account-required client runtime, authoritative
record repository, database migrations, Row Level Security (RLS), private resume
bucket, Edge Functions, account UI, offline cache, and
tests. It intentionally contains no production URL, publishable key, LinkedIn
secret, service-role key, customer data, or billing secret.

## What the deployer must supply

- A staging and production Supabase project.
- A Google Cloud OAuth client configured for Supabase Auth.
- A LinkedIn Developer app with **Sign In with LinkedIn using OpenID Connect**.
- A production email provider/SMTP configuration for verification-code delivery.
- The final Chrome Web Store extension ID. `chrome.identity.getRedirectURL()`
  produces `https://<extension-id>.chromiumapp.org/auth/callback`; add that exact
  URL to the Supabase Auth redirect allow list.
- The Supabase Auth callback
  `https://<project-ref>.supabase.co/auth/v1/callback` in LinkedIn's authorized
  redirect URLs. LinkedIn redirects to Supabase; Supabase returns to the exact
  extension URL.
- A public privacy policy, terms, support contact, retention policy, and account
  deletion instructions that accurately describe authoritative cloud data and
  the user-specific offline cache.

Official references:

- [Supabase LinkedIn OIDC setup](https://supabase.com/docs/guides/auth/social-login/auth-linkedin)
- [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase email OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
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

Hosted Supabase Edge Functions receive `SUPABASE_URL` and the server-only API
keys as protected default environment variables. Do not copy, override, commit,
or embed those server-only values. Set only additional application secrets you
introduce later (for example, a payment webhook secret) through Edge Function
Secrets. The extension needs only the project URL and publishable key.

## 3. Configure email, Google, and LinkedIn authentication

1. Configure production SMTP and email OTP templates in Supabase Auth. Set
   appropriate expiry, abuse controls, CAPTCHA/rate limits, and branded sender.
2. Create a Google OAuth client, add Supabase's callback URL, enable Google in
   Supabase Auth, and store the Google client secret only in Supabase.
3. Create the LinkedIn Project/App and request the OpenID Connect sign-in
   product.
4. Add Supabase's callback URL to LinkedIn.
5. Enable **LinkedIn (OIDC)** in Supabase Auth and enter the LinkedIn client ID
   and secret there.
6. Add the exact staging extension redirect URL to Supabase's redirect allow
   list. Do not use a wildcard in production.
7. Build the staging extension with the non-secret client configuration:

   ```sh
   SCOUT_BUILD_MODE=production \
   SCOUT_SUPABASE_URL=https://YOUR_STAGING_REF.supabase.co \
   SCOUT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY \
   npm run build:production
   ```

   The build writes these values into `dist/shared/cloud-config.js` and grants
   only that Supabase origin. The Account page never asks customers for them.

   Run the deterministic browser suite before this command with `npm run verify`.
   That suite deliberately installs a local test session and therefore uses a
   development build. After creating the production build, validate its embedded
   public configuration without replacing it:

   ```sh
   npm run test:production-build
   ```

LinkedIn sign-in provides basic identity claims. It does not authorize Scout
to import a member's connections, messages, posts, contacts, or work history.
Do not present it as candidate identity or employment verification.

## 4. Verify the data boundaries

Test with two unrelated accounts and prove:

- Account A cannot read, update, or delete Account B's private tables or resume
  objects.
- Support reports can be inserted only through the authenticated Edge Function
  and are redacted, bounded, rate-limited, retained for the documented period,
  and inaccessible to normal clients.
- Signed-out users cannot open profile, popup, dashboard, onboarding, or autofill
  workspaces; a previously authenticated offline session can use only its own cache.
- Record mutations retry idempotently, remote changes pull incrementally, and
  deletion tombstones propagate across devices.
- A record version conflict pauses without overwriting either copy and remains
  available for explicit review.
- The current extension exposes no candidate-publication or recruiter-search
  controls. Reserved publication tables have no recruiter-facing read policy.
- Sign-out, export, and cloud-account deletion work on a clean browser profile.
- Signing a different account into an already linked local workspace triggers an
  account-safety stop instead of uploading or restoring either user's data.

The current sync protocol is an owner-only, record-level repository with durable
client retries, idempotent mutation IDs, incremental cursors, server versions,
tombstones, and explicit conflict state. It is not end-to-end encrypted or a
collaborative real-time document system.

## 5. Privacy and Chrome Web Store release gate

Before staging becomes production:

- Publish and link the privacy policy and terms from the Store listing and
  product website.
- Complete the Chrome Web Store privacy questionnaire for identity, personal
  information, website content, form data, locally stored data, and optional
  transmissions.
- Keep the in-product prominent account/cloud disclosure and the separate
  candidate-publication choice. A policy page alone is not sufficient notice.
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
test, email/Google/LinkedIn login, deletion, private support, resume upload, conflict flow,
or Chrome Web Store disclosures have not been verified against production-like
staging.
