import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const [source, manifestText, account] = await Promise.all([
  readFile(resolve(root, "dist/shared/cloud-config.js"), "utf8"),
  readFile(resolve(root, "dist/manifest.json"), "utf8"),
  readFile(resolve(root, "dist/account.html"), "utf8")
]);

const context = vm.createContext({});
context.globalThis = context;
vm.runInContext(source, context, { filename: "dist/shared/cloud-config.js" });
const config = context.ApplyOS?.CLOUD_DEFAULTS || {};
const manifest = JSON.parse(manifestText);

assert.equal(config.buildMode, "production", "dist is not a production build");
assert.equal(config.allowRuntimeConfig, false, "production runtime configuration must be disabled");
assert.match(config.projectUrl || "", /^https:\/\/[a-z0-9-]+\.supabase\.co$/i, "production project URL is missing or invalid");
assert.match(config.publishableKey || "", /^sb_publishable_[A-Za-z0-9_-]+$/, "production publishable key is missing or invalid");
assert.ok((manifest.host_permissions || []).includes(`${config.projectUrl}/*`), "manifest is missing the configured Supabase origin");
assert.match(manifest.oauth2?.client_id || "", /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i, "production Google Calendar OAuth client ID is missing or invalid");
assert.notEqual(manifest.oauth2?.client_id, "000000000000-scout-development.apps.googleusercontent.com", "production build still uses the development Google OAuth placeholder");
assert.deepEqual(manifest.oauth2?.scopes, ["https://www.googleapis.com/auth/calendar.events.owned"], "production build requests an unexpected Google Calendar scope");
assert.doesNotMatch(account, /Supabase project URL|Publishable key|Save client configuration/i, "customer account UI exposes deployment controls");

console.log(`Production Scout build is configured for ${new URL(config.projectUrl).host}.`);
