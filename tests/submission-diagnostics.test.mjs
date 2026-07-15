import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

async function pureRuntime() {
  const context = vm.createContext({ URL, Date, console, globalThis: null });
  context.globalThis = context;
  for (const file of ["shared/diagnostics.js", "shared/submission.js"]) {
    vm.runInContext(await readFile(resolve(file), "utf8"), context, { filename: file });
  }
  return context.ApplyOS;
}

test("broken-field diagnostics redact sentinels and only expose the reviewed structural allowlist", async () => {
  const ApplyOS = await pureRuntime();
  const report = ApplyOS.Diagnostics.buildReport({
    pageUrl: "https://jobs.example.com/apply?token=QUERY_SECRET_778899#resume",
    platform: "workday",
    extensionVersion: "0.6.3",
    generatedAt: "2026-07-15T10:00:00.000Z",
    fields: [{
      label: "Contact CANDIDATE_SENTINEL_12345678901234567890 person@example.com +91 98765 43210",
      tag: "input",
      type: "email",
      role: "textbox",
      required: true,
      autocomplete: "email",
      value: "ENTERED_VALUE_SECRET",
      checked: true,
      selected: "SELECTED_ANSWER_SECRET",
      filename: "secret-resume.pdf",
      outerHTML: "<input value='DOM_SECRET'>",
      attributes: {
        "aria-label": "Email person@example.com",
        "data-automation-id": "contactField",
        value: "ATTRIBUTE_VALUE_SECRET",
        class: "unrelated-page-class",
        "data-user-answer": "ANSWER_SECRET"
      },
      ancestors: [{ tag: "DIV", role: "group", textContent: "NEARBY_SECRET" }]
    }]
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.source_domain, "jobs.example.com");
  assert.deepEqual(Object.keys(report.fields[0].attributes), ["data-automation-id"]);
  for (const secret of ["QUERY_SECRET", "ENTERED_VALUE", "SELECTED_ANSWER", "secret-resume", "DOM_SECRET", "ATTRIBUTE_VALUE", "ANSWER_SECRET", "NEARBY_SECRET", "person@example.com", "98765 43210", "CANDIDATE_SENTINEL"]) {
    assert.doesNotMatch(serialized, new RegExp(secret, "i"), secret);
  }
  assert.match(serialized, /\[redacted-email\]/);
  assert.match(serialized, /\[redacted-phone\]/);
  assert.match(serialized, /\[redacted-token\]/);
});

test("hidden controls are omitted without inspecting their values", async () => {
  const ApplyOS = await pureRuntime();
  assert.equal(ApplyOS.Diagnostics.describeField({ tag: "input", type: "hidden", label: "csrf", value: "SECRET" }), null);
  assert.equal(ApplyOS.Diagnostics.describeField({ tag: "textarea", hidden: true, label: "Notes", value: "SECRET" }), null);
});

test("submission scoring accepts strong confirmation only after recent trusted intent", async () => {
  const ApplyOS = await pureRuntime();
  assert.ok(ApplyOS.Submission.confirmationSelectors("workday").includes("[data-automation-id='confirmationPage']"));
  assert.ok(ApplyOS.Submission.confirmationSelectors("greenhouse").includes("#application_confirmation"));
  const positive = ApplyOS.Submission.scoreConfirmation({
    heading: "Application successfully submitted",
    pageText: "We have received your application.",
    title: "Application received",
    url: "https://jobs.example.com/application/confirmation?candidate=secret",
    submitIntentAgeMs: 1200,
    formPresent: false
  });
  assert.equal(positive.likely, true);
  assert.ok(positive.score >= 70);
  const noIntent = ApplyOS.Submission.scoreConfirmation({
    heading: "Thank you for applying",
    url: "https://jobs.example.com/thank-you",
    submitIntentAgeMs: Number.POSITIVE_INFINITY
  });
  assert.equal(noIntent.likely, false);
});

test("misleading job-page language and navigation buttons never count as submission", async () => {
  const ApplyOS = await pureRuntime();
  const misleading = ApplyOS.Submission.scoreConfirmation({
    heading: "Application questions",
    pageText: "Thank you for reviewing the job description. Review and submit your application when ready.",
    title: "Apply",
    url: "https://jobs.example.com/apply",
    submitIntentAgeMs: 500,
    strongSelector: false,
    formPresent: true
  });
  assert.equal(misleading.likely, false);
  assert.equal(ApplyOS.Submission.isSubmitIntentLabel("Save and Continue"), false);
  assert.equal(ApplyOS.Submission.isSubmitIntentLabel("Next"), false);
  assert.equal(ApplyOS.Submission.isSubmitIntentLabel("Apply now"), false);
  assert.equal(ApplyOS.Submission.isSubmitIntentLabel("Submit application"), true);
});

test("manifest loads diagnostics and submission helpers before the content script", async () => {
  const manifest = JSON.parse(await readFile(resolve("manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf("shared/diagnostics.js") < scripts.indexOf("content.js"));
  assert.ok(scripts.indexOf("shared/submission.js") < scripts.indexOf("content.js"));
  const background = await readFile(resolve("background.js"), "utf8");
  const popup = await readFile(resolve("popup.js"), "utf8");
  const content = await readFile(resolve("content.js"), "utf8");
  assert.match(background, /APPLYOS_RUNTIME_PING/);
  assert.match(background, /APPLYOS_SESSION_UPDATED/);
  assert.match(background, /frameId: 0/);
  assert.match(popup, /Saved to your dashboard/);
  assert.match(popup, /trackingReloadNotice\(resultMessage\)/);
  assert.match(content, /checkbox\.checked = false/);
  assert.doesNotMatch(content, /blockedTypes = new Set\(\[[^\]]*"file"/);
});
