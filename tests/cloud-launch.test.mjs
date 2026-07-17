import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

async function cloudRuntime(initial = {}, responses = []) {
  const data = structuredClone(initial);
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
  }
  return { ApplyOS: context.ApplyOS, data, calls };
}

test("cloud configuration accepts only Supabase or local development origins", async () => {
  const { ApplyOS } = await cloudRuntime();
  assert.equal((await ApplyOS.saveCloudConfig({ projectUrl: "https://example.com", publishableKey: "public" })).projectUrl, "");
  assert.equal((await ApplyOS.saveCloudConfig({ projectUrl: "https://project-ref.supabase.co/", publishableKey: "public" })).projectUrl, "https://project-ref.supabase.co");
});

test("LinkedIn PKCE session remains behind the cloud runtime status boundary", async () => {
  const session = { access_token: "PRIVATE_ACCESS", refresh_token: "PRIVATE_REFRESH", expires_in: 3600, user: { id: "user-1", email: "candidate@example.com", user_metadata: { full_name: "Candidate Name" } } };
  const { ApplyOS, calls } = await cloudRuntime({ applyos_cloud_config: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" } }, [session]);
  const status = await ApplyOS.signInWithLinkedIn();
  assert.equal(status.signedIn, true);
  assert.equal(JSON.stringify(status.user), JSON.stringify({ id: "user-1", email: "candidate@example.com", name: "Candidate Name", avatar: "" }));
  assert.equal(JSON.stringify(status).includes("PRIVATE_ACCESS"), false);
  assert.equal(JSON.stringify(status).includes("PRIVATE_REFRESH"), false);
  assert.match(calls.find((call) => call.authUrl).authUrl, /provider=linkedin_oidc/);
  assert.match(calls.find((call) => call.authUrl).authUrl, /code_challenge_method=s256/);
});

test("cloud status blocks account switching from mixing a linked local workspace", async () => {
  const session = { access_token: "PRIVATE_ACCESS", refresh_token: "PRIVATE_REFRESH", expires_in: 3600, user: { id: "user-2", user_metadata: {} } };
  const { ApplyOS } = await cloudRuntime({ applyos_cloud_config: { projectUrl: "https://project-ref.supabase.co", publishableKey: "sb_publishable_test" }, applyos_cloud_owner_id: "user-1" }, [session]);
  const status = await ApplyOS.signInWithLinkedIn();
  assert.equal(status.workspaceOwnerMismatch, true);
  await assert.rejects(() => ApplyOS.getCloudSnapshot(), /different ApplyOS account/);
});

test("launch migration protects private workspace tables and separates recruiter publication", async () => {
  const sql = await readFile(resolve("supabase/migrations/202607170001_launch_foundation.sql"), "utf8");
  for (const table of ["applications", "contacts", "interviews", "private_records", "candidate_publications", "support_reports"]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, /visibility public\.publication_visibility not null default 'private'/);
  assert.match(sql, /revoke all on public\.support_reports from anon, authenticated/);
  assert.match(sql, /apply_workspace_snapshot/);
});

test("private support endpoint re-redacts client text and fails closed when limits cannot be checked", async () => {
  const support = await readFile(resolve("supabase/functions/submit-support-report/index.ts"), "utf8");
  assert.match(support, /const redactText/);
  assert.match(support, /\[redacted-email\]/);
  assert.match(support, /rate_limit_unavailable/);
  assert.match(support, /payload_too_large/);
});

test("account, tutorial, and contact surfaces preserve explicit privacy and CRM boundaries", async () => {
  const [account, onboarding, dashboard, dashboardRuntime] = await Promise.all([readFile(resolve("account.html"), "utf8"), readFile(resolve("onboarding.html"), "utf8"), readFile(resolve("dashboard.html"), "utf8"), readFile(resolve("dashboard.js"), "utf8")]);
  assert.match(account, /LinkedIn is used only to sign in/);
  assert.match(account, /They are not recruiter-visible/);
  assert.match(account, /Make only this reviewed card eligible for future recruiter search/);
  assert.match(onboarding, /Three deliberate clicks/);
  assert.match(onboarding, /CRM & networking/i);
  assert.match(onboarding, /Private support/i);
  assert.match(dashboard, /id="contact-application" multiple/);
  assert.match(dashboardRuntime, /selectedOptions/);
});
