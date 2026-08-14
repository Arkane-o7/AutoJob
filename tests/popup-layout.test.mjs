import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("popup profile controls stay grouped when the selector is hidden", async () => {
  const [html, css] = await Promise.all([
    readFile(resolve("popup.html"), "utf8"),
    readFile(resolve("popup.css"), "utf8")
  ]);

  assert.match(html, /<div class="profile-actions">\s*<label class="profile-picker">[\s\S]*?id="profile-select"[\s\S]*?id="onboarding"[\s\S]*?<\/div>\s*<button id="dashboard"/);
  assert.match(css, /\.profile-strip\s*\{[^}]*grid-template-columns:88px minmax\(0,1fr\) auto;/s);
  assert.match(css, /\.profile-actions\s*\{[^}]*display:flex;[^}]*justify-content:flex-end;/s);
  assert.match(css, /\.profile-picker\s*\{[^}]*width:min\(126px,100%\);/s);
});
