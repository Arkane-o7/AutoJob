import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist");
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
await cp(resolve(root, "shared"), resolve(out, "shared"), { recursive: true });
await cp(resolve(root, "licenses"), resolve(out, "licenses"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(out, "manifest.json"), "utf8"));
await writeFile(resolve(out, "BUILD.txt"), `ApplyOS ${manifest.version}\nBuilt ${new Date().toISOString()}\n`);
console.log(`Built ApplyOS ${manifest.version} in ${out}`);
