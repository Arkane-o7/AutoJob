import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

async function cloudRuntime(initial = {}, responses = []) {
  const data = structuredClone(initial);
  const cloudDefaults = data.__cloudDefaults;
  delete data.__cloudDefaults;
  const calls = [];
  const local = {
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const context = vm.createContext({
    console, URL, TextEncoder, structuredClone, crypto: webcrypto, btoa,
    chrome: {
      storage: { local },
      identity: {
        getRedirectURL: () => "https://extension-id.chromiumapp.org/auth/callback",
        launchWebAuthFlow: async ({ url }) => { calls.push({ authUrl: url }); return "https://extension-id.chromiumapp.org/auth/callback?code=auth-code"; }
      }
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      const body = responses.length ? responses.shift() : {};
      return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
    }
  });
  context.globalThis = context;
  for (const file of ["shared/constants.js", "shared/cloud-config.js", "shared/cloud.js"]) {
    vm.runInContext(await readFile(resolve(file), "utf8"), context, { filename: file });
    if (file === "shared/cloud-config.js" && cloudDefaults) {
      context.ApplyOS.CLOUD_DEFAULTS = Object.freeze({ ...context.ApplyOS.CLOUD_DEFAULTS, ...cloudDefaults });
    }
  }
  return { ApplyOS: context.ApplyOS, data, calls };
}

test("cloud configuration accepts only Supabase or local development origins", async () => {
  const { ApplyOS } = await cloudRuntime({ __cloudDefaults: { allowRuntimeConfig: true } });
  assert.equal((await ApplyOS.saveCloudConfig({ projectUrl: "https://example.com", publishableKey: "public" })).projectUrl, "");
  assert.equal((await ApplyOS.saveCloudConfig({ projectUrl: "https://project-ref.supabase.co/", publishableKey: "public" })).projectUrl, "https://project-ref.supabase.co");
});

test("LinkedIn PKCE session remains behind the cloud runtime status boundary", async () => {
  const session = { access_token: "PRIVATE_ACCESS", refresh_token: "PRIVATE_REFRESH", expires_in: 3600, user: { id: "user-1", email: "candidate@example.com", user_metadata: { full_name: "Candidate Name" } } };
  const { ApplyOS, calls } = await cloudRuntime({ __cloudDefaults: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" } }, [session]);
  const status = await ApplyOS.signInWithLinkedIn();
  assert.equal(status.signedIn, true);
  assert.equal(JSON.stringify(status.user), JSON.stringify({ id: "user-1", email: "candidate@example.com", name: "Candidate Name", avatar: "" }));
  assert.equal(JSON.stringify(status).includes("PRIVATE_ACCESS"), false);
  assert.equal(JSON.stringify(status).includes("PRIVATE_REFRESH"), false);
  assert.match(calls.find((call) => call.authUrl).authUrl, /provider=linkedin_oidc/);
  assert.match(calls.find((call) => call.authUrl).authUrl, /code_challenge_method=s256/);
  ApplyOS.getCloudRepositoryState = async () => ({ outbox: [], meta: { status: "conflict", conflict: { entityType: "application", entityId: "job_1", localPayload: { notes: "private local" }, serverPayload: { notes: "private server" } } } });
  const conflictStatus = await ApplyOS.cloudStatus();
  assert.equal(JSON.stringify(conflictStatus).includes("private local"), false);
  assert.equal(JSON.stringify(conflictStatus).includes("private server"), false);
  assert.equal(conflictStatus.sync.conflict.entityId, "job_1");
});

test("account switching locks the old active workspace and activates only the new user's cache", async () => {
  const session = { access_token: "PRIVATE_ACCESS", refresh_token: "PRIVATE_REFRESH", expires_in: 3600, user: { id: "user-2", user_metadata: {} } };
  const { ApplyOS, data } = await cloudRuntime({
    __cloudDefaults: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" },
    applyos_cloud_owner_id: "user-1",
    applyos_cache_owner_id: "user-1",
    profile: { firstName: "Old owner" }
  }, [session]);
  const status = await ApplyOS.signInWithLinkedIn();
  assert.equal(status.workspaceOwnerMismatch, false);
  assert.equal(status.workspaceReady, true);
  assert.equal(data.applyos_cache_owner_id, "user-2");
  assert.equal(data.profile, undefined);
});

test("reauthenticating the same account never replaces newer active offline edits with an older cache snapshot", async () => {
  const session = { access_token: "PRIVATE_ACCESS", refresh_token: "PRIVATE_REFRESH", expires_in: 3600, user: { id: "user-1", user_metadata: {} } };
  const { ApplyOS, data } = await cloudRuntime({
    __cloudDefaults: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" },
    applyos_cache_owner_id: "user-1",
    applyos_cloud_owner_id: "user-1",
    profile: { firstName: "New offline edit" },
    "applyos_user_cache:user-1": { userId: "user-1", data: { profile: { firstName: "Older cached value" } } }
  }, [session]);
  await ApplyOS.signInWithLinkedIn();
  assert.equal(data.profile.firstName, "New offline edit");
});

test("Google OAuth and email OTP share the provider-neutral account boundary", async () => {
  const googleSession = { access_token: "GOOGLE_ACCESS", refresh_token: "GOOGLE_REFRESH", expires_in: 3600, user: { id: "google-user", email: "google@example.com", user_metadata: {} } };
  const google = await cloudRuntime({ __cloudDefaults: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" } }, [googleSession]);
  assert.equal((await google.ApplyOS.signInWithOAuth("google")).signedIn, true);
  assert.match(google.calls.find((call) => call.authUrl).authUrl, /provider=google/);

  const emailSession = { access_token: "EMAIL_ACCESS", refresh_token: "EMAIL_REFRESH", expires_in: 3600, user: { id: "email-user", email: "member@example.com", user_metadata: {} } };
  const email = await cloudRuntime({ __cloudDefaults: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" } }, [{}, emailSession]);
  await email.ApplyOS.requestEmailOtp("member@example.com");
  const status = await email.ApplyOS.verifyEmailOtp("member@example.com", "123456");
  assert.equal(status.signedIn, true);
  assert.match(email.calls.find((call) => String(call.url).includes("/auth/v1/otp")).options.body, /member@example\.com/);
});

test("launch migration protects private workspace tables and separates recruiter publication", async () => {
  const sql = await readFile(resolve("supabase/migrations/202607170001_launch_foundation.sql"), "utf8");
  for (const table of ["applications", "contacts", "interviews", "private_records", "candidate_publications", "support_reports"]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, /visibility public\.publication_visibility not null default 'private'/);
  assert.match(sql, /revoke all on public\.support_reports from anon, authenticated/);
  assert.match(sql, /apply_workspace_snapshot/);
  const authoritative = await readFile(resolve("supabase/migrations/202607180001_authoritative_workspace.sql"), "utf8");
  assert.match(authoritative, /apply_workspace_mutation/);
  assert.match(authoritative, /pull_workspace_changes/);
  assert.match(authoritative, /claim_legacy_workspace/);
  assert.match(authoritative, /revoke insert, update, delete on public\.applications from authenticated/);
  assert.match(authoritative, /revoke insert, update, delete on public\.workspace_snapshots from authenticated/);
  assert.match(authoritative, /revoke execute on function public\.apply_workspace_snapshot/);
  const conflictMetadata = await readFile(resolve("supabase/migrations/202607180003_sync_conflict_metadata.sql"), "utf8");
  assert.match(conflictMetadata, /register_workspace_device/);
  assert.match(conflictMetadata, /workspace_record_provenance/);
  assert.match(conflictMetadata, /auth\.uid\(\)/);
});

test("private support endpoint re-redacts client text and fails closed when limits cannot be checked", async () => {
  const support = await readFile(resolve("supabase/functions/submit-support-report/index.ts"), "utf8");
  assert.match(support, /const redactText/);
  assert.match(support, /\[redacted-email\]/);
  assert.match(support, /rate_limit_unavailable/);
  assert.match(support, /payload_too_large/);
});

test("account, contextual tutorial, and contact surfaces preserve current product boundaries", async () => {
  const [account, onboarding, dashboard, dashboardRuntime, popup, popupRuntime, options] = await Promise.all([readFile(resolve("account.html"), "utf8"), readFile(resolve("onboarding.html"), "utf8"), readFile(resolve("dashboard.html"), "utf8"), readFile(resolve("dashboard.js"), "utf8"), readFile(resolve("popup.html"), "utf8"), readFile(resolve("popup.js"), "utf8"), readFile(resolve("options.html"), "utf8")]);
  assert.match(account, /Continue with Google/);
  assert.match(account, /Continue with LinkedIn/);
  assert.match(account, /or use email/);
  assert.match(account, /I agree to create my private Scout workspace/);
  assert.doesNotMatch(account, /Candidate publication|future recruiter search|publish-consent/i);
  assert.match(account, /No recruiter-facing profile in this release/);
  assert.match(account, /Review a sync conflict/);
  assert.match(account, /id="conflict-local-time"/);
  assert.match(account, /id="conflict-server-device"/);
  assert.doesNotMatch(account, /id="conflict-(?:local|server)"[^>]*textarea|<textarea[^>]*id="conflict-(?:local|server)"/);
  assert.match(onboarding, /TWO-MINUTE START/);
  assert.equal((onboarding.match(/data-panel=/g) || []).length, 2);
  assert.match(dashboard, /data-tour-target="pipeline"/);
  assert.match(dashboard, /data-tour-target="contacts-workspace"/);
  assert.doesNotMatch(dashboard, /metric-memory|LEARNED ANSWERS/);
  assert.match(options, /data-tour-target="resume"/);
  assert.match(options, /data-tour-target="answers"/);
  assert.match(options, /shared\/resume-parser\.js/);
  assert.match(options, /PDF text is extracted privately on this device/);
  assert.match(popupRuntime, /application\.description\?\.trim\(\) \? `\$\{application\.match_score \|\| 0\}%` : "-"/);
  assert.match(dashboardRuntime, /function matchLabel\(application, includeWord = false\)/);
  assert.match(dashboardRuntime, /A job description is required to calculate a match/);
  assert.match(popup, /data-tour-target="autofill"/);
  assert.match(dashboard, /id="contact-application" multiple/);
  assert.match(dashboardRuntime, /selectedOptions/);
});

test("full-page Scout surfaces share one header contract", async () => {
  const pages = await Promise.all(["dashboard.html", "account.html", "options.html", "onboarding.html"].map((file) => readFile(resolve(file), "utf8")));
  for (const html of pages) {
    assert.match(html, /class="scout-header" data-scout-header/);
    assert.match(html, /assets\/brand\/scout-wordmark\.png/);
    assert.match(html, /assets\/brand\/scout-mark\.png/);
    assert.match(html, /data-scout-nav="applications"/);
    assert.match(html, /data-scout-nav="contacts"/);
    assert.match(html, /data-scout-nav="account"/);
    assert.match(html, /data-scout-nav="profile"/);
    assert.match(html, /data-scout-profile-select/);
    assert.match(html, /shared\/header\.css/);
    assert.match(html, /shared\/header\.js/);
  }
  const popup = await readFile(resolve("popup.html"), "utf8");
  assert.doesNotMatch(popup, /scout-header|shared\/header\.css|Account &amp; sync|Dashboard ↗/);
});

test("popup detection works without privileged access to the active tab URL", async () => {
  const [popup, popupHtml, capture] = await Promise.all([
    readFile(resolve("popup.js"), "utf8"),
    readFile(resolve("popup.html"), "utf8"),
    readFile(resolve("capture.js"), "utf8")
  ]);
  assert.match(popup, /if \(!activeTab\?\.id\)/);
  assert.doesNotMatch(popup, /!\/\^https\?:\/\.test\(activeTab\.url/);
  assert.match(popup, /activeTab\.url = response\.job\?\.url/);
  assert.doesNotMatch(popupHtml, /Private account workspace|Review first · never auto-submits/);
  assert.match(capture, /fallback \? 0\.82/);
});

test("dashboard ignores transient removal of its cached state", async () => {
  const dashboard = await readFile(resolve("dashboard.js"), "utf8");
  assert.match(dashboard, /if \(!state\) return;/);
  assert.match(dashboard, /if \(!nextState \|\| !Array\.isArray\(nextState\.applications\)\) return;/);
});

test("contextual tour is review-only and hands off between real product surfaces", async () => {
  const [onboarding, dashboard, tour] = await Promise.all([readFile(resolve("onboarding.js"), "utf8"), readFile(resolve("dashboard.js"), "utf8"), readFile(resolve("shared/tour.js"), "utf8")]);
  assert.match(onboarding, /ScoutTour\.prepareFirstRun/);
  assert.match(onboarding, /dashboard\.html\?tour=1/);
  assert.match(dashboard, /ScoutTour\.handoff\("main", "options"\)/);
  assert.doesNotMatch(tour, /\.click\(/);
  assert.doesNotMatch(tour, /ApplyOS\.(?:upsert|update|mark|seed)/);
});
