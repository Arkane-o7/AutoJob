import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const scripts = [
  manifest.background?.service_worker,
  ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  "popup.js", "options.js", "dashboard.js", "onboarding.js", "account.js",
  "shared/constants.js", "shared/matching.js", "shared/followup.js", "shared/storage.js", "shared/backup.js", "shared/resume-parser.js", "shared/cloud-config.js", "shared/cloud.js", "shared/header.js", "shared/tour.js"
].filter(Boolean);

for (const file of new Set(scripts)) {
  await access(resolve(root, file));
  execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "pipe" });
}

for (const page of [manifest.action.default_popup, manifest.options_page, "dashboard.html", "onboarding.html", "account.html"]) {
  const html = await readFile(resolve(root, page), "utf8");
  const references = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(?:https?:|data:)/.test(value))
    .map((value) => value.split(/[?#]/, 1)[0]);
  for (const reference of references) await access(resolve(root, reference));
}

for (const icon of new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
])) await access(resolve(root, icon));

if (manifest.version !== packageJson.version) throw new Error("package and manifest version are out of sync");
console.log(`Checked ${new Set(scripts).size} scripts, manifest, and extension page references.`);
