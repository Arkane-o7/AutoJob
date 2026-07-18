import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist");
const buildMode = (process.env.SCOUT_BUILD_MODE || process.env.APPLYOS_BUILD_MODE) === "production" ? "production" : "development";
const projectUrl = String(process.env.SCOUT_SUPABASE_URL || process.env.APPLYOS_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const publishableKey = String(process.env.SCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.APPLYOS_SUPABASE_PUBLISHABLE_KEY || "").trim();
const validProjectUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl) || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(projectUrl);
if (buildMode === "production" && (!validProjectUrl || !publishableKey.startsWith("sb_publishable_"))) {
  throw new Error("Production build requires SCOUT_SUPABASE_URL and SCOUT_SUPABASE_PUBLISHABLE_KEY.");
}
const files = [
  "manifest.json", "background.js", "capture.js", "content.js", "content.css",
  "popup.html", "popup.css", "popup.js", "options.html", "options.css", "options.js",
  "dashboard.html", "dashboard.css", "dashboard.js", "THIRD_PARTY_NOTICES.md"
  , "onboarding.html", "onboarding.css", "onboarding.js",
  "account.html", "account.css", "account.js"
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of files) await cp(resolve(root, file), resolve(out, file));
await cp(resolve(root, "assets"), resolve(out, "assets"), { recursive: true });
await cp(resolve(root, "shared"), resolve(out, "shared"), { recursive: true });
await cp(resolve(root, "licenses"), resolve(out, "licenses"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(out, "manifest.json"), "utf8"));
const cloudDefaults = {
  projectUrl: validProjectUrl ? projectUrl : "",
  publishableKey,
  provider: "google",
  accountRequired: true,
  providers: { emailOtp: true, google: "google", linkedin: "linkedin_oidc" },
  supportFunction: "submit-support-report",
  deleteFunction: "delete-account",
  buildMode,
  allowRuntimeConfig: buildMode === "development"
};
await writeFile(resolve(out, "shared/cloud-config.js"), `(function(root){"use strict";const ApplyOS=root.ApplyOS=root.ApplyOS||{};ApplyOS.CLOUD_DEFAULTS=Object.freeze(${JSON.stringify(cloudDefaults)});})(globalThis);\n`);
if (validProjectUrl) {
  const originPattern = `${new URL(projectUrl).origin}/*`;
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), originPattern])];
  manifest.optional_host_permissions = (manifest.optional_host_permissions || []).filter((pattern) => !pattern.includes("supabase.co") && !pattern.includes("localhost:54321") && !pattern.includes("127.0.0.1:54321"));
  await writeFile(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
await writeFile(resolve(out, "BUILD.txt"), `Scout ${manifest.version}\nMode ${buildMode}\nBuilt ${new Date().toISOString()}\n`);
console.log(`Built Scout ${manifest.version} in ${out}`);
