import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ATS_CASES, fixtureResponse } from "../tests/browser/fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectoryArgument = process.argv.find((argument) => argument.startsWith("--extension-dir="))?.split("=").slice(1).join("=");
const extensionRoot = extensionDirectoryArgument ? resolve(root, extensionDirectoryArgument) : root;
const requiredBrowser = process.env.APPLYOS_REQUIRE_BROWSER === "1";
const resumeName = "ada-lovelace-test-resume.pdf";
const profile = Object.freeze({
  firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace", email: "ada@example.test",
  phone: "+44 20 7946 0958", currentLocation: "London, Greater London, United Kingdom",
  address: "12 Analytical Engine Way", address2: "Flat 3", postalCode: "SW1A 1AA",
  country: "United Kingdom", workAuthorization: "Yes", desiredStartDate: "2026-08-01",
  visaSponsorship: "No",
  currentCompany: "Analytical Engines", currentTitle: "Programmer", employmentStartDate: "2024-01", jobDescription: "Built reliable computing systems.",
  resumeText: "Built React and TypeScript services on AWS with Kubernetes and Docker.",
  resume: {
    name: resumeName, type: "application/pdf", size: 51,
    dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n% ApplyOS browser regression fixture\n%%EOF").toString("base64")}`
  },
  customAnswers: [{ question: "Do you currently have any active academic backlogs?", answer: "No" }]
});

function startFixtureServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://fixture.invalid").pathname;
    const fixture = fixtureResponse(pathname);
    response.writeHead(fixture.status, {
      "content-type": fixture.type, "cache-control": "no-store",
      "content-security-policy": "default-src 'self' 'unsafe-inline'; frame-src 'self'"
    });
    response.end(fixture.body);
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveStart({
        port: address.port,
        close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
      });
    });
  });
}

async function waitForWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent("serviceworker", { timeout: 15000 });
}

async function waitForSignedOutInitialization(worker) {
  await worker.evaluate(async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const title = await chrome.action.getTitle({});
      if (/Sign in required/i.test(title)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error("Scout signed-out initialization timed out");
  });
}

async function waitForExtensionInitialization(worker) {
  await worker.evaluate(async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const stored = await chrome.storage.local.get(["applyos_state", "profilesIndex", "applyos_graph"]);
      if (stored.applyos_state && stored.profilesIndex && stored.applyos_graph) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error("ApplyOS service worker initialization timed out");
  });
}

async function installBrowserAccount(worker) {
  await worker.evaluate(async ({ fakeProfile, userId }) => {
    await chrome.storage.local.clear();
    const bundledCloud = await ApplyOS.getCloudConfig();
    if (!bundledCloud.projectUrl) {
      await ApplyOS.saveCloudConfig({
        projectUrl: "http://127.0.0.1:54321",
        publishableKey: "sb_publishable_browser_regression"
      });
    }
    await ApplyOS.installDevelopmentSession({
      access_token: "browser-regression-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId, email: "ada@example.test", user_metadata: { full_name: "Ada Lovelace" } }
    });
    await chrome.storage.local.set({
      applyos_cache_owner_id: userId,
      applyos_cloud_owner_id: userId,
      applyos_legacy_workspace_decision: { decision: "imported", userId, at: new Date().toISOString() },
      profile: { ...fakeProfile, firstName: "Stale", address: "", city: "", state: "", postalCode: "" },
      profilesIndex: {
        activeId: "browser_test",
        profiles: [{ id: "browser_test", name: "Browser test", targetRole: "", color: "#b7ff3c", createdAt: Date.now() }]
      },
      profile_browser_test: fakeProfile
    });
    await ApplyOS.ensureState();
    await ApplyOS.ensureGraph();
    await ApplyOS.persistActiveUserCache(userId);
  }, { fakeProfile: profile, userId: "11111111-1111-4111-8111-111111111111" });
}

async function sendFill(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active fixture tab");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { return { ok: true, report: await messageAllFrames(tab.id, "APPLYKIT_FILL") }; }
      catch (error) {
        if (!/Receiving end does not exist|No application frame/i.test(error.message) || attempt === 49) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
    throw new Error("Application frames were not ready");
  });
}

async function activeTabMessage(worker, message) {
  return worker.evaluate((payload) => new Promise((resolveMessage, rejectMessage) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return rejectMessage(new Error("No active fixture tab"));
      chrome.tabs.sendMessage(tab.id, payload, { frameId: 0 }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) rejectMessage(new Error(error.message));
        else resolveMessage(response);
      });
    });
  }), message);
}

async function activeFixtureTabId(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
}

async function showConfirmation(page, worker, tabId) {
  await page.locator("#submit-action").click();
  let session = null;
  for (let attempt = 0; attempt < 20 && !session?.submitIntentAt; attempt += 1) {
    await page.waitForTimeout(100);
    session = await worker.evaluate(async (id) => {
      const stored = await chrome.storage.session.get("applyos_application_sessions");
      return stored.applyos_application_sessions?.[`tab_${id}`] || null;
    }, tabId);
  }
  assert.ok(session?.submitIntentAt, "trusted final-submit interaction should be recorded before confirmation detection");
  await page.evaluate(() => {
    document.querySelector("#fixture-form")?.remove();
    document.querySelector("h1").textContent = "Application successfully submitted";
    const confirmation = document.createElement("section");
    confirmation.id = "application_confirmation";
    confirmation.innerHTML = "<h2>Thank you for applying</h2><p>We have received your application.</p>";
    document.body.append(confirmation);
  });
  await page.locator(".applyos-submit-prompt").waitFor({ state: "visible" });
}

async function fixtureTarget(page, testCase) {
  if (!testCase.frame) return page;
  const handle = await page.waitForSelector(`iframe[name="${testCase.frame}"]`);
  const frame = await handle.contentFrame();
  assert.ok(frame, `${testCase.id}: application iframe should be available`);
  await frame.waitForSelector("#fixture-form");
  return frame;
}

async function snapshot(target) {
  return target.evaluate(() => ({
    firstName: document.querySelector("#first-name")?.value, lastName: document.querySelector("#last-name")?.value,
    email: document.querySelector("#email")?.value, phone: document.querySelector("#phone")?.value,
    country: document.querySelector("#country")?.value,
    startMonth: document.querySelector("#start-month")?.value, startDay: document.querySelector("#start-day")?.value,
    startYear: document.querySelector("#start-year")?.value,
    microsoftAuth: document.querySelector("#microsoft-auth")?.value,
    microsoftAddress: document.querySelector("#Contact_Information_q_address")?.value,
    microsoftAddress2: document.querySelector("#Contact_Information_q_addressLine2")?.value,
    microsoftCity: document.querySelector("#Contact_Information_q_city")?.value,
    microsoftPostalCode: document.querySelector("#Contact_Information_q_zip")?.value,
    microsoftState: document.querySelector("#microsoft-state")?.value,
    microsoftBacklog: document.querySelector("input[name='microsoft-backlog']:checked")?.value || "",
    microsoftSponsorshipClicks: window.__fixture.microsoftSponsorshipClicks,
    microsoftSponsorshipExpanded: document.querySelector("#microsoft-sponsorship")?.getAttribute("aria-expanded"),
    microsoftStrayOptionClicks: window.__fixture.microsoftStrayOptionClicks,
    ssn: document.querySelector("#ssn")?.value, verificationCode: document.querySelector("#verification-code")?.value,
    gender: document.querySelector("#gender")?.value,
    consent: document.querySelector("#privacy-consent")?.checked,
    resumeName: document.querySelector("#resume")?.files?.[0]?.name || "",
    resumeWidget: document.querySelector("#resume-widget")?.textContent,
    events: { ...window.__fixture.events }, drops: [...window.__fixture.drops],
    submitCount: window.__fixture.submitCount, nextClickCount: window.__fixture.nextClickCount,
    submitClickCount: window.__fixture.submitClickCount, inlineSaveCount: window.__fixture.inlineSaveCount
  }));
}

function assertSafeFill(testCase, response, state) {
  assert.equal(response?.ok, true, `${testCase.id}: APPLYKIT_FILL should succeed`);
  assert.equal(response.report.site, testCase.expectedSite, `${testCase.id}: ATS adapter should be detected`);
  assert.equal(state.firstName, "Ada", `${testCase.id}: first name`);
  assert.equal(state.lastName, "Lovelace", `${testCase.id}: last name`);
  assert.equal(state.phone, "+44 20 7946 0958", `${testCase.id}: phone`);
  assert.equal(state.country, "United Kingdom", `${testCase.id}: native ATS select`);
  assert.equal(state.email, "existing@example.test", `${testCase.id}: existing value must not be overwritten`);
  assert.equal(state.ssn, "", `${testCase.id}: SSN must remain blank`);
  assert.equal(state.verificationCode, "", `${testCase.id}: verification code must remain blank`);
  assert.equal(state.gender, "", `${testCase.id}: demographic data must remain blank`);
  assert.equal(state.consent, false, `${testCase.id}: consent must remain unchecked`);
  if (testCase.existingResume) {
    assert.equal(state.resumeName, "", `${testCase.id}: an already selected resume must not be uploaded again`);
    assert.equal(state.resumeWidget, "Existing resume selected", `${testCase.id}: existing resume selection is preserved`);
    assert.equal(state.events["resume:change"] || 0, 0, `${testCase.id}: existing resume must not emit upload events`);
  } else {
    assert.equal(state.resumeName, resumeName, `${testCase.id}: resume input should contain stored file`);
    assert.equal(state.resumeWidget, resumeName, `${testCase.id}: resume widget should observe attachment`);
  }
  for (const id of ["first-name", "last-name", "phone", ...(testCase.existingResume ? [] : ["resume"])]) {
    assert.ok(state.events[`${id}:input`] >= 1, `${testCase.id}: ${id} input event should fire`);
    assert.ok(state.events[`${id}:change`] >= 1, `${testCase.id}: ${id} change event should fire`);
  }
  assert.ok(state.events["country:change"] >= 1, `${testCase.id}: select change event should fire`);
  if (testCase.id === "workday") {
    assert.deepEqual([state.startMonth, state.startDay, state.startYear], ["8", "1", "2026"], "workday: compound date fields");
    for (const id of ["start-month", "start-day", "start-year"]) assert.ok(state.events[`${id}:change`] >= 1, `workday: ${id} change event`);
    assert.equal(state.inlineSaveCount, 1, "workday: only the scoped inline experience Save button is clicked");
  }
  if (testCase.id === "microsoft") {
    assert.equal(state.microsoftAddress, "12 Analytical Engine Way", "microsoft: street address from profile");
    assert.equal(state.microsoftAddress2, "Flat 3", "microsoft: address line 2 from profile");
    assert.equal(state.microsoftCity, "London", "microsoft: city derived from the current-location label");
    assert.equal(state.microsoftPostalCode, "SW1A 1AA", "microsoft: postal code from profile");
    assert.equal(state.microsoftState, "Greater London", "microsoft: state derived from the current-location label and selected in its own listbox");
    for (const id of ["Contact_Information_q_address", "Contact_Information_q_addressLine2", "Contact_Information_q_city", "Contact_Information_q_zip", "microsoft-state"]) {
      assert.ok(state.events[`${id}:change`] >= 1, `microsoft: ${id} change event should fire`);
    }
    assert.equal(state.microsoftAuth, "Yes", "microsoft: Fluent UI combobox option should be selected through its controlled listbox");
    assert.equal(state.microsoftBacklog, "No", "microsoft: readonly-styled radio group remains interactable");
    assert.ok(state.events["microsoft-auth:change"] >= 1, "microsoft: combobox change event should fire");
    assert.ok(state.events["microsoft-backlog-no:change"] >= 1, "microsoft: radio change event should fire");
    assert.equal(state.microsoftSponsorshipExpanded, "false", "microsoft: an unmatched dropdown must be closed after one bounded attempt");
    assert.equal(state.microsoftStrayOptionClicks, 0, "microsoft: a dropdown must never select an option from a sibling listbox");
  }
  if (testCase.expectedDrops) assert.deepEqual(state.drops, ["dragenter", "dragover", "drop"], `${testCase.id}: ATS dropzone events`);
  assert.equal(state.submitCount, 0, `${testCase.id}: form must not submit`);
  assert.equal(state.nextClickCount, 0, `${testCase.id}: Save and Continue must not be clicked`);
  assert.equal(state.submitClickCount, 0, `${testCase.id}: submit button must not be clicked`);
  if (testCase.frame) assert.ok(response.report.frameCount >= 2, `${testCase.id}: top and application frames should be aggregated`);
}

async function main() {
  const executable = chromium.executablePath();
  try {
    await access(executable);
  } catch {
    const message = `SKIP browser regression: Playwright Chromium is not installed at ${executable}. Run \"npx playwright install chromium\".`;
    if (requiredBrowser) throw new Error(message);
    console.log(message);
    return;
  }

  const server = await startFixtureServer();
  const userDataDir = await mkdtemp(resolve(tmpdir(), "applyos-playwright-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: process.env.APPLYOS_HEADFUL !== "1",
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`, "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost"]
    });
    const worker = await waitForWorker(context);
    assert.match(worker.url(), /^chrome-extension:\/\//, "unpacked MV3 service worker should run");
    await waitForSignedOutInitialization(worker);
    await installBrowserAccount(worker);
    await waitForExtensionInitialization(worker);

    const page = await context.newPage();
    await Promise.all(context.pages().filter((candidate) => candidate !== page).map((candidate) => candidate.close().catch(() => {})));
    page.on("dialog", (dialog) => dialog.dismiss());
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") console.error(`fixture console ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => console.error(`fixture page error: ${error.message}`));
    for (const testCase of ATS_CASES) {
      const url = `http://${testCase.host}:${server.port}${testCase.path}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      const target = await fixtureTarget(page, testCase);
      await target.waitForSelector("#first-name");
      if (testCase.expectedCapture) {
        const captured = await activeTabMessage(worker, { type: "APPLYOS_DETECT_JOB" });
        assert.equal(captured?.ok, true, `${testCase.id}: job capture should succeed`);
        for (const [field, value] of Object.entries(testCase.expectedCapture)) {
          assert.equal(captured.job?.[field], value, `${testCase.id}: captured ${field}`);
        }
      }
      const response = await sendFill(worker);
      assert.equal(response?.ok, true, `${testCase.id}: response failed (${response?.error || "unknown error"})`);
      if (!testCase.existingResume) await target.waitForFunction((name) => document.querySelector("#resume")?.files?.[0]?.name === name, resumeName);
      const firstState = await snapshot(target);
      assertSafeFill(testCase, response, firstState);
      assert.equal(page.url(), url, `${testCase.id}: autofill must not navigate`);

      const secondResponse = await sendFill(worker);
      assert.equal(secondResponse?.ok, true, `${testCase.id}: repeat fill should succeed`);
      const repeated = await snapshot(target);
      assert.equal(repeated.events["resume:change"] || 0, testCase.existingResume ? 0 : 1, `${testCase.id}: resume must not attach twice`);
      assert.equal(repeated.resumeName, testCase.existingResume ? "" : resumeName, `${testCase.id}: repeat fill preserves attachment state`);

      if (testCase.id === "microsoft") {
        const clickBaseline = repeated.microsoftSponsorshipClicks;
        assert.ok(clickBaseline > 0, "microsoft: unmatched controlled dropdown is attempted during explicit autofill");
        await target.evaluate(() => window.bumpMicrosoftControlledField());
        await target.waitForTimeout(1800);
        const afterRerender = await snapshot(target);
        assert.equal(afterRerender.microsoftSponsorshipClicks, clickBaseline, "microsoft: controlled rerenders must not restart a settled dropdown attempt");
        assert.equal(afterRerender.microsoftStrayOptionClicks, 0, "microsoft: controlled rerenders never borrow sibling options");
      }

      if (testCase.dynamic) {
        await target.evaluate(() => window.addDynamicPhone());
        await target.waitForFunction((phone) => document.querySelector("#dynamic-phone")?.value === phone, profile.phone, { timeout: 5000 });
        const events = await target.evaluate(() => ({ ...window.__fixture.events }));
        assert.ok(events["dynamic-phone:input"] >= 1, `${testCase.id}: assist mode fills late-rendered field`);
        assert.ok(events["dynamic-phone:change"] >= 1, `${testCase.id}: late field change event fires`);
        await target.evaluate(() => history.pushState({}, "", "/not-an-application"));
        await target.waitForTimeout(1000);
        await target.evaluate(() => {
          const container = document.createElement("div");
          container.innerHTML = '<label for="post-route-phone">Phone number</label><input id="post-route-phone" type="tel">';
          document.querySelector("#fixture-form").append(container);
        });
        await target.waitForTimeout(1500);
        assert.equal(await target.locator("#post-route-phone").inputValue(), "", `${testCase.id}: assist mode stops when an SPA changes route`);
      }
      console.log(`PASS ${testCase.id.padEnd(15)} values, events, resume, privacy and no-navigation invariants`);
    }

    const promptUrl = `http://apply.careers.microsoft.com:${server.port}/microsoft`;
    await page.goto(promptUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    const pagePrompt = page.locator(".scout-page-prompt");
    await pagePrompt.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await pagePrompt.locator("h2").textContent(), /autofill/i, "known ATS form should offer review-gated autofill");
    await pagePrompt.locator(".scout-page-primary").click();
    await pagePrompt.waitFor({ state: "detached" });
    assert.equal(await page.locator("#Contact_Information_q_address").inputValue(), profile.address, "page prompt invokes the same safe autofill path");
    assert.equal(await page.evaluate(() => window.__fixture.submitCount), 0, "page prompt never submits the application");
    const promptedApplication = await worker.evaluate(async (url) => ApplyOS.getApplicationByUrl(url), promptUrl);
    assert.equal(promptedApplication?.company, "Microsoft", "page prompt saves the detected job before autofill");
    assert.ok(promptedApplication?.match_score >= 80, "saved job match uses the active profile's extracted resume text");
    assert.ok(promptedApplication?.matched_skills?.includes("typescript"), "saved job records resume-text skill overlap");
    await page.locator(".applykit-toast").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".scout-notification-stack > .applykit-toast").count(), 1, "save-and-autofill reports its result once");
    await sendFill(worker);
    await page.waitForFunction(() => document.querySelectorAll(".scout-notification-stack > .applykit-toast").length >= 2);
    const toastLayout = await page.locator(".scout-notification-stack > .applykit-toast").evaluateAll((items) => items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    assert.ok(toastLayout.every((item, index) => index === 0 || toastLayout[index - 1].bottom < item.top), "simultaneous page notifications stack vertically without overlap");
    console.log("PASS detected ATS page offers explicit save-and-autofill without submission");

    await page.goto(`http://apply.example.test:${server.port}/react-dropzone`, { waitUntil: "domcontentloaded" });
    await sendFill(worker);
    await page.bringToFront();
    const reportResponse = await activeTabMessage(worker, { type: "APPLYOS_REPORT_BROKEN" });
    assert.equal(reportResponse?.ok, true, "broken-field review should open through the content message path");
    const review = page.locator(".applyos-review-dialog");
    await review.waitFor({ state: "visible" });
    const privateReport = review.locator(".applyos-review-report");
    assert.equal(await privateReport.isDisabled(), true, "private reporting requires reviewed fields and a description");
    assert.equal(await review.locator("input[type='checkbox']:checked").count(), 0, "diagnostic fields require explicit selection");
    assert.deepEqual(JSON.parse(await review.locator(".applyos-review-preview textarea").inputValue()).fields, [], "unreviewed diagnostics contain no fields");
    for (const label of ["Email address", "Upload CV/Resume"]) {
      await review.locator("label", { hasText: label }).locator("input[type='checkbox']").check();
    }
    const reviewedPayload = await review.locator(".applyos-review-preview textarea").inputValue();
    assert.match(reviewedPayload, /Email address/);
    assert.match(reviewedPayload, /Upload CV\/Resume/);
    for (const privateValue of ["existing@example.test", resumeName, "+44 20 7946 0958"]) {
      assert.equal(reviewedPayload.includes(privateValue), false, `diagnostic preview excludes ${privateValue}`);
    }
    assert.equal(await privateReport.isDisabled(), true, "selected fields alone do not send a report without user context");
    await review.locator(".applyos-review-details textarea").first().fill("The reviewed email and resume fields were not filled.");
    assert.equal(await privateReport.isEnabled(), true, "reviewed fields plus description enable private submission");
    assert.equal(await privateReport.getAttribute("data-report-url"), null, "private reports expose no repository URL");
    await privateReport.click();
    await page.waitForFunction(() => /unavailable|unreachable|temporarily|try again|copy|download|reference/i.test(document.querySelector(".applyos-review-dialog footer > span")?.textContent || ""));
    assert.match(await review.locator("footer > span").textContent(), /unavailable|unreachable|temporarily|try again|copy|download|reference/i, "support failures retain a review-safe fallback without exposing a repository");
    await review.locator(".applyos-review-close").click();
    console.log("PASS reviewed-report value-free preview and private support fallback");

    const extensionId = new URL(worker.url()).host;
    const popupProbe = await context.newPage();
    await popupProbe.setViewportSize({ width: 420, height: 600 });
    await popupProbe.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
    await popupProbe.waitForFunction(() => document.querySelector("#score strong")?.textContent.trim() === "-");
    const popupMetrics = await popupProbe.evaluate(() => {
      document.querySelector("#record-controls")?.classList.remove("hidden");
      document.querySelector("#agent")?.classList.remove("hidden");
      const confidence = document.querySelector("#confidence");
      if (confidence) confidence.textContent = "96% extraction confidence. Review the editable title and company before saving.";
      const result = document.querySelector("#result");
      if (result) result.textContent = "Microsoft Careers: found the resume upload field but could not attach the saved file. Attach it manually and review the form. Application tracking needs one extension reload: open chrome://extensions, find ApplyOS, and click Reload.";
      const main = document.querySelector("main");
      return {
        documentHeight: document.documentElement.scrollHeight,
        bodyHeight: document.body.scrollHeight,
        mainHeight: main?.clientHeight || 0,
        mainContentHeight: main?.scrollHeight || 0,
        mainOverflow: main ? getComputedStyle(main).overflowY : "missing"
      };
    });
    assert.equal(popupMetrics.documentHeight, 600, "popup document should remain at Chrome's 600px maximum");
    assert.equal(popupMetrics.bodyHeight, 600, "popup body should not create an outer scroll surface");
    assert.equal(popupMetrics.mainOverflow, "hidden", "popup must not expose a native scrollbar");
    assert.ok(popupMetrics.mainContentHeight <= popupMetrics.mainHeight, `popup content must fit without clipping (${popupMetrics.mainContentHeight}/${popupMetrics.mainHeight})`);
    await popupProbe.close();
    console.log("PASS popup fits the 420x600 Chrome surface without a scroll container");

    const conflictFixture = await worker.evaluate(async () => {
      const userId = "11111111-1111-4111-8111-111111111111";
      const keys = ApplyOS.cloudRepositoryKeys(userId);
      const mutationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await chrome.storage.local.set({
        [keys.cache]: {},
        [keys.outbox]: [{ mutationId, entityType: "application", entityId: "job_conflict", operation: "upsert", baseVersion: 4, payload: { id: "job_conflict", role: "Research Scientist", company: "Northstar Labs", notes: "private local notes" }, createdAt: "2026-07-18T13:23:33.568Z", attempts: 1 }],
        [keys.meta]: {
          cursor: 4,
          status: "conflict",
          conflict: {
            mutationId,
            entityType: "application",
            entityId: "job_conflict",
            localPayload: { id: "job_conflict", role: "Research Scientist", company: "Northstar Labs", notes: "private local notes" },
            serverPayload: { id: "job_conflict", role: "Research Scientist", company: "Northstar Labs", notes: "private server notes" },
            serverVersion: 5,
            localDeviceId: "device_browser_test",
            localDeviceLabel: "Chrome on macOS",
            localUpdatedAt: "2026-07-18T13:23:33.568Z",
            serverDeviceId: "device_windows_test",
            serverDeviceLabel: "Chrome on Windows",
            serverUpdatedAt: "2026-07-18T12:00:00.000Z",
            detectedAt: "2026-07-18T13:24:00.000Z"
          }
        }
      });
      return ApplyOS.getCloudRepositoryState();
    });
    assert.equal(conflictFixture.meta?.status, "conflict", "browser fixture installs a pending sync conflict");

    const accountProbe = await context.newPage();
    const accountMessages = [];
    accountProbe.on("console", (message) => { if (["warning", "error"].includes(message.type())) accountMessages.push(message.text()); });
    await accountProbe.goto(`chrome-extension://${extensionId}/account.html`, { waitUntil: "domcontentloaded" });
    await accountProbe.locator("#identity-title").waitFor({ state: "visible" });
    await accountProbe.waitForFunction(() => !document.querySelector("#signed-in-actions")?.classList.contains("hidden"));
    assert.match(await accountProbe.locator("#identity-title").textContent(), /account|connected|welcome/i, "account page recognizes the authenticated workspace");
    assert.equal(await accountProbe.locator("#deployment-config").count(), 0, "customer UI never exposes deployment configuration");
    assert.equal(await accountProbe.getByText("Continue locally").count(), 0, "account-required builds expose no local-only bypass");
    assert.equal(await accountProbe.locator("#google-sign-in").count(), 1, "Google is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#linkedin-sign-in").count(), 1, "LinkedIn is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#email-request-form").count(), 1, "email code login is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#publication-section").count(), 0, "unreleased recruiter search has no customer-facing controls");
    await accountProbe.evaluate((conflict) => renderConflict(conflict), conflictFixture.meta.conflict);
    await accountProbe.locator("#conflict-panel").waitFor({ state: "visible" });
    assert.equal(await accountProbe.locator("#conflict-panel textarea").count(), 0, "conflict review never exposes raw JSON editors");
    assert.equal(await accountProbe.locator("#conflict-panel .conflict-version__badge", { hasText: "NEWEST" }).count(), 1, "conflict review identifies exactly one newest version");
    assert.match(await accountProbe.locator("#conflict-local-device").textContent(), /Chrome on macOS/);
    assert.match(await accountProbe.locator("#conflict-server-device").textContent(), /Chrome on Windows/);
    assert.match(await accountProbe.locator("#conflict-recommendation").textContent(), /Newest: this browser/i);
    assert.equal((await accountProbe.locator("#conflict-panel").innerText()).includes("private local notes"), false, "conflict review hides private payload values");
    assert.match(await accountProbe.locator("body").innerText(), /account|required|offline|cache/i, "account page explains cloud authority and the user-specific offline cache");
    assert.equal((await accountProbe.locator("body").innerText()).includes("github.com/Arkane-o7"), false, "account and support surfaces never expose the source repository");
    assert.deepEqual(accountMessages, [], `account page should not emit console warnings or errors: ${accountMessages.join(" | ")}`);
    await accountProbe.close();
    await worker.evaluate(async () => {
      const keys = ApplyOS.cloudRepositoryKeys("11111111-1111-4111-8111-111111111111");
      const stored = await chrome.storage.local.get([keys.meta, keys.outbox]);
      await chrome.storage.local.set({ [keys.meta]: { ...(stored[keys.meta] || {}), status: "synced", conflict: null }, [keys.outbox]: [] });
    });
    console.log("PASS account page shows a readable newest-version conflict choice without raw JSON");

    const starterProbe = await context.newPage();
    await starterProbe.goto(`chrome-extension://${extensionId}/onboarding.html?start=1`, { waitUntil: "domcontentloaded" });
    await starterProbe.waitForFunction(() => document.querySelector("[data-panel='0']")?.classList.contains("active"));
    assert.equal(await starterProbe.locator("[data-panel]").count(), 2, "first-run onboarding stays focused on two screens");
    assert.match(await starterProbe.locator("[data-panel='0'] h2").textContent(), /show you the rest in context/i);
    await starterProbe.locator("#next").click();
    await starterProbe.waitForFunction(() => document.querySelector("[data-panel='1']")?.classList.contains("active"));
    assert.equal(await starterProbe.locator("[data-panel='1'] input[required]").count(), 4, "starter profile asks only for core autofill identity fields");
    assert.match(await starterProbe.locator("#next").textContent(), /Save & show me around/);
    await starterProbe.locator("#next").click();
    await starterProbe.waitForURL(`chrome-extension://${extensionId}/dashboard.html?tour=1`);
    await starterProbe.locator(".scout-tour-card", { hasText: "Know what needs attention." }).waitFor({ state: "visible" });
    await starterProbe.close();
    console.log("PASS two-screen starter setup hands off to the real dashboard tour");

    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("profile_browser_test");
      const value = { ...stored.profile_browser_test, structuredFutureField: { preserved: true } };
      await chrome.storage.local.set({ profile_browser_test: value, profile: value });
    });
    const profileProbe = await context.newPage();
    await profileProbe.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    await profileProbe.locator("#profile-form").waitFor({ state: "visible" });
    assert.equal(await profileProbe.getByText("Run setup again").count(), 0, "the full profile editor must not expose a competing setup editor");
    await profileProbe.locator("button[type='submit']").click();
    await profileProbe.waitForFunction(() => document.querySelector("#save-status")?.textContent === "Saved just now");
    const savedProfileState = await worker.evaluate(async () => {
      const profile = await ApplyOS.getActiveProfile();
      const state = await ApplyOS.getState();
      return { profile, resume: state.resume_versions.find((item) => item.id === profile.currentResumeVersionId) };
    });
    assert.equal(savedProfileState.profile.structuredFutureField.preserved, true, "profile form saves preserve fields owned by future or imported schema versions");
    assert.ok(savedProfileState.profile.onboardingCompletedAt, "saving the canonical profile completes first-run setup");
    assert.match(savedProfileState.resume?.sha256 || "", /^[a-f0-9]{64}$/, "saved resume versions retain a content hash");
    await worker.evaluate(async () => chrome.storage.local.set({ applyos_tour_progress: { version: 2, setupCompletedAt: new Date().toISOString(), flows: { main: { surface: "options", step: 4, completedAt: new Date().toISOString(), dismissedAt: null } } } }));
    const onboardingProbe = await context.newPage();
    await onboardingProbe.goto(`chrome-extension://${extensionId}/onboarding.html`, { waitUntil: "domcontentloaded" });
    await onboardingProbe.waitForURL(`chrome-extension://${extensionId}/options.html`);
    await onboardingProbe.close();
    const stateBeforeTour = await worker.evaluate(async () => {
      const value = await ApplyOS.getState();
      return { revision: value.revision, applications: value.applications.length, contacts: value.contacts.length };
    });
    const tourProbe = await context.newPage();
    await tourProbe.goto(`chrome-extension://${extensionId}/dashboard.html?tour=1`, { waitUntil: "domcontentloaded" });
    await tourProbe.locator(".scout-tour-card").waitFor({ state: "visible" });
    await tourProbe.waitForFunction(() => document.querySelector(".scout-tour-card h2")?.textContent === "Know what needs attention.");
    assert.match(await tourProbe.locator(".scout-tour-kicker").textContent(), /1\s*\/\s*5/, "dashboard coach marks start on the first real control");
    for (const expectedTitle of ["Your next move stays visible.", "This is your working pipeline.", "Map the people behind each role.", "Complete your application profile."]) {
      await tourProbe.locator(".scout-tour-next").click();
      await tourProbe.waitForFunction((title) => document.querySelector(".scout-tour-card h2")?.textContent === title, expectedTitle);
    }
    assert.match(await tourProbe.locator(".scout-tour-card").textContent(), /Complete your application profile/, "dashboard tour reaches the profile handoff");
    await tourProbe.locator(".scout-tour-next").click();
    await tourProbe.waitForURL(`chrome-extension://${extensionId}/options.html?tour=1`);
    await tourProbe.locator(".scout-tour-card").waitFor({ state: "visible" });
    await tourProbe.waitForFunction(() => document.querySelector(".scout-tour-card h2")?.textContent === "Keep more than one version of you.");
    assert.match(await tourProbe.locator(".scout-tour-kicker").textContent(), /1\s*\/\s*5/, "profile coach marks resume on the next real surface");
    for (const expectedTitle of ["Your application source of truth.", "Save the file and the evidence.", "Teach Scout repeated questions.", "Review, then save your profile."]) {
      await tourProbe.locator(".scout-tour-next").click();
      await tourProbe.waitForFunction((title) => document.querySelector(".scout-tour-card h2")?.textContent === title, expectedTitle);
    }
    await tourProbe.locator(".scout-tour-next").click();
    await tourProbe.locator(".scout-tour-card").waitFor({ state: "detached" });
    const stateAfterTour = await worker.evaluate(async () => {
      const value = await ApplyOS.getState();
      const stored = await chrome.storage.local.get("applyos_tour_progress");
      return { revision: value.revision, applications: value.applications.length, contacts: value.contacts.length, tour: stored.applyos_tour_progress };
    });
    assert.deepEqual({ revision: stateAfterTour.revision, applications: stateAfterTour.applications, contacts: stateAfterTour.contacts }, stateBeforeTour, "coach marks do not mutate profile or CRM data");
    assert.ok(stateAfterTour.tour.flows.main.completedAt, "cross-page tour completion is persisted");
    await tourProbe.close();
    await profileProbe.close();
    console.log("PASS canonical profile round-trip and contextual read-only product tour");

    const helper = await context.newPage();
    const dashboardMessages = [];
    helper.on("console", (message) => { if (["warning", "error"].includes(message.type())) dashboardMessages.push(message.text()); });
    await helper.goto(`chrome-extension://${extensionId}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await helper.locator("[data-scout-header]").waitFor({ state: "visible" });
    const headerSnapshot = (target) => target.evaluate(() => {
      const header = document.querySelector("[data-scout-header]");
      const rect = header.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        brand: header.querySelector(".scout-header__wordmark")?.alt || "",
        brandLoaded: Boolean(header.querySelector(".scout-header__wordmark")?.complete && header.querySelector(".scout-header__wordmark")?.naturalWidth),
        nav: [...header.querySelectorAll(".scout-header__nav a")].map((item) => item.textContent.trim()),
        actions: [...header.querySelectorAll(".scout-header__action")].map((item) => item.textContent.trim()),
        active: header.querySelector("[aria-current='page']")?.dataset.scoutNav || "",
        profile: header.querySelector("[data-scout-profile-select]")?.value || ""
      };
    });
    const headerSamples = [{ page: "dashboard", ...(await headerSnapshot(helper)) }];
    for (const [name, path] of [["account", "account.html"], ["profile", "options.html"], ["setup", "onboarding.html?start=1"]]) {
      const surface = await context.newPage();
      await surface.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: "domcontentloaded" });
      await surface.locator("[data-scout-header]").waitFor({ state: "visible" });
      headerSamples.push({ page: name, ...(await headerSnapshot(surface)) });
      await surface.close();
    }
    for (const sample of headerSamples) {
      assert.equal(sample.height, 68, `${sample.page} uses the shared 68px header geometry`);
      assert.equal(sample.brand, "Scout", `${sample.page} uses the supplied Scout wordmark`);
      assert.equal(sample.brandLoaded, true, `${sample.page} loads the supplied Scout wordmark asset`);
      assert.deepEqual(sample.nav, ["Applications", "Contacts"], `${sample.page} uses the shared primary navigation`);
      assert.deepEqual(sample.actions, ["Profile & answers", "Account & sync"], `${sample.page} uses the shared account actions`);
      assert.equal(sample.profile, "browser_test", `${sample.page} uses the active workspace profile`);
    }
    assert.equal(headerSamples.find((sample) => sample.page === "dashboard").active, "applications");
    assert.equal(headerSamples.find((sample) => sample.page === "account").active, "account");
    assert.equal(headerSamples.find((sample) => sample.page === "profile").active, "profile");
    console.log("PASS shared Scout header geometry, navigation, account state and profile controls");
    const runtime = await helper.evaluate(() => chrome.runtime.sendMessage({ type: "APPLYOS_RUNTIME_PING" }));
    assert.equal(runtime?.ok, true, "the popup runtime handshake should reach the service worker");
    assert.equal(runtime?.features?.applicationTracking, true, "the service worker should advertise application tracking");
    await worker.evaluate(async () => ApplyOS.updateSettings({ final_follow_up_enabled: true }));
    const startSession = async () => {
      await page.goto(`http://apply.example.test:${server.port}/react-dropzone`, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      await page.waitForTimeout(250);
      const tabId = await activeFixtureTabId(worker);
      assert.ok(Number.isInteger(tabId), "fixture tab should be discoverable for the application session");
      const result = await helper.evaluate(async ({ tabId: targetTabId, url }) => {
        const application = await ApplyOS.upsertApplication({ company: "Fixture Labs", role: "Test Engineer", url, source: "fixture", description: "Browser test" });
        const response = await chrome.runtime.sendMessage({
          type: "APPLYOS_SESSION_START",
          tabId: targetTabId,
          application: { id: application.id, company: application.company, role: application.role },
          platform: "generic",
          url
        });
        return { application, response };
      }, { tabId, url: page.url() });
      assert.equal(result.response?.ok, true, "application session should start through the background message path");
      await page.bringToFront();
      const delivered = await activeTabMessage(worker, { type: "APPLYOS_SESSION_UPDATED", session: result.response.session });
      assert.equal(delivered?.ok, true, "the loaded top frame should receive the application session");
      return { applicationId: result.application.id, tabId };
    };

    let sessionFixture = await startSession();
    let { applicationId } = sessionFixture;
    await showConfirmation(page, worker, sessionFixture.tabId);
    let applicationState = await worker.evaluate(async (id) => (await ApplyOS.getState()).applications.find((item) => item.id === id), applicationId);
    assert.equal(applicationState.status, "saved", "likely confirmation never changes status silently");
    await page.locator(".applyos-submit-prompt button", { hasText: "Not yet" }).click();
    applicationState = await worker.evaluate(async (id) => (await ApplyOS.getState()).applications.find((item) => item.id === id), applicationId);
    assert.equal(applicationState.status, "saved", "Not yet leaves application status unchanged");

    sessionFixture = await startSession();
    applicationId = sessionFixture.applicationId;
    await showConfirmation(page, worker, sessionFixture.tabId);
    await page.locator(".applyos-submit-prompt button", { hasText: "Yes, mark applied" }).click();
    await page.locator(".applyos-submit-prompt").waitFor({ state: "detached" });
    const confirmedState = await worker.evaluate(async (id) => {
      const state = await ApplyOS.getState();
      return {
        application: state.applications.find((item) => item.id === id),
        reminders: state.reminders.filter((item) => item.application_id === id)
      };
    }, applicationId);
    assert.equal(confirmedState.application.status, "applied", "affirmative review marks the application applied");
    assert.equal(confirmedState.reminders.length, 2, "affirmative review schedules 7/14-day reminders");
    await helper.reload({ waitUntil: "domcontentloaded" });
    const completeReminder = helper.locator(".upcoming-done").first();
    await completeReminder.waitFor({ state: "visible" });
    await completeReminder.click();
    assert.equal(await worker.evaluate(async (id) => (await ApplyOS.getState()).reminders.filter((item) => item.application_id === id && item.completed_at).length, applicationId), 1, "dashboard Done completes a reminder instead of leaving it due forever");
    const applicationCard = helper.locator(`#board .job-card[data-id="${applicationId}"]`);
    await applicationCard.waitFor({ state: "visible" });
    await applicationCard.click();
    const detail = helper.locator("#detail");
    assert.equal(await detail.getAttribute("aria-modal"), "true", "open detail drawer is exposed as the active modal");
    assert.equal(await detail.getAttribute("data-state"), "open", "application drawer reports its open state");
    assert.equal(await helper.evaluate(() => document.activeElement?.id), "detail-role", "detail drawer moves focus to its first editable field");
    await helper.locator("#close-detail").click();
    assert.equal(await detail.getAttribute("aria-modal"), "false", "closed detail drawer is no longer modal");
    assert.equal(await detail.getAttribute("data-state"), "closed", "application drawer reports its closed state");
    assert.equal(await detail.getAttribute("inert"), "", "closed detail drawer is removed from keyboard interaction");
    assert.equal(await helper.evaluate(() => document.activeElement?.classList.contains("job-card")), true, "closing details restores focus to the opening card");

    await helper.locator("[data-section='contacts']").click();
    assert.equal(await helper.locator("[data-scout-nav='contacts']").getAttribute("aria-current"), "page", "contacts navigation becomes active without a reload");
    assert.equal(new URL(helper.url()).searchParams.get("section"), "contacts", "contacts navigation keeps a shareable dashboard URL");
    await helper.locator("#add-contact").click();
    const contactDetail = helper.locator("#contact-detail");
    await contactDetail.waitFor({ state: "visible" });
    await helper.locator("#contact-name").fill("Casey Recruiter");
    await helper.locator("#contact-title").fill("Talent Partner");
    await helper.locator("#contact-company").fill("Fixture Labs");
    await helper.locator("#contact-email").fill("casey@example.test");
    await helper.locator("#contact-relationship").selectOption("recruiter");
    await helper.locator("#contact-application").selectOption(applicationId);
    await helper.locator("#contact-notes").fill("Met during the reviewed browser fixture.");
    await helper.locator("#contact-form button[type='submit']").click();
    await helper.waitForFunction(() => document.querySelector("#contact-detail")?.dataset.state === "closed");
    assert.equal(await contactDetail.getAttribute("inert"), "", "closed contact drawer is removed from keyboard interaction");
    const contactCard = helper.locator(".contact-card", { hasText: "Casey Recruiter" });
    await contactCard.waitFor({ state: "visible" });
    await contactCard.click();
    assert.match(await helper.locator("#contact-gmail").getAttribute("href"), /mail\.google\.com\/mail\/\?.*to=casey%40example\.test/);
    assert.match(await helper.locator("#contact-outlook").getAttribute("href"), /outlook\.office\.com\/mail\/deeplink\/compose\?/);
    assert.match(await helper.locator("#contact-mailto").getAttribute("href"), /^mailto:casey@example\.test\?/);
    await helper.locator("#close-contact").click();

    await helper.locator("[data-section='applications']").click();
    await helper.locator(`#board .job-card[data-id="${applicationId}"]`).click();
    await helper.locator("#linked-contacts", { hasText: "Casey Recruiter" }).waitFor({ state: "visible" });
    const contactId = await helper.locator("#draft-contact option", { hasText: "Casey Recruiter" }).getAttribute("value");
    assert.ok(contactId, "saved contact should be selectable for a reviewed follow-up");
    await helper.locator("#draft-contact").selectOption(contactId);
    await helper.locator("#generate-draft").click();
    assert.match(await helper.locator("#compose-gmail").getAttribute("href"), /to=casey%40example\.test/);

    await helper.locator("#add-interview").click();
    await helper.locator("#interview-type").selectOption("technical");
    await helper.locator("#interview-format").selectOption("video");
    await helper.locator("#interview-scheduled").fill("2026-08-05T10:30");
    await helper.locator("#interview-contact").selectOption(contactId);
    await helper.locator("#interview-research").fill("Review the fixture product and engineering notes.");
    await helper.locator("#interview-prep").fill("Prepare a system-design story.");
    await helper.locator("#interview-questions").fill("Event-driven architecture and observability.");
    await helper.locator("#interview-next-action").fill("Send thank-you note");
    await helper.locator("#interview-next-date").fill("2026-08-06");
    await helper.locator("#interview-form button[type='submit']").click();
    const interviewCard = helper.locator("#interview-list .interview-card", { hasText: "Technical" });
    await interviewCard.waitFor({ state: "visible" });
    await interviewCard.locator("button").click();
    await helper.locator("#generate-thank-you").click();
    assert.match(await helper.locator("#thank-you-body").inputValue(), /Hello Casey/);
    assert.match(await helper.locator("#thank-you-gmail").getAttribute("href"), /to=casey%40example\.test/);
    const crmState = await worker.evaluate(async (id) => {
      const current = await ApplyOS.getState();
      return {
        contact: current.contacts.find((item) => item.application_ids.includes(id)),
        interview: current.interviews.find((item) => item.application_id === id),
        application: current.applications.find((item) => item.id === id)
      };
    }, applicationId);
    assert.equal(crmState.contact.email, "casey@example.test", "contact CRM persists the reviewed recipient");
    assert.equal(crmState.interview.preparation_notes, "Prepare a system-design story.", "interview workspace persists preparation");
    assert.equal(crmState.application.status, "interview", "saving an interview advances an active application to interview");
    await helper.locator("#close-detail").click();

    const backupPassword = "fixture backup password";
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    const encryptedBackup = await optionsPage.evaluate((password) => ApplyOS.exportEncryptedBackup(password, "browser-test"), backupPassword);
    await optionsPage.locator("#backup-password").fill(backupPassword);
    await optionsPage.locator("#backup-confirm").fill(backupPassword);
    const downloadPromise = optionsPage.waitForEvent("download");
    await optionsPage.locator("#export-backup").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^scout-backup-\d{4}-\d{2}-\d{2}\.scout$/, "encrypted export uses the Scout backup extension");
    await optionsPage.locator("#backup-file").setInputFiles({ name: "fixture.applyos", mimeType: "application/json", buffer: Buffer.from(encryptedBackup.serialized) });
    await optionsPage.locator("#restore-password").fill(backupPassword);
    await optionsPage.locator("#preview-backup").click();
    await optionsPage.locator("#backup-preview").waitFor({ state: "visible" });
    const backupSummary = await optionsPage.locator("#backup-summary").textContent();
    assert.match(backupSummary, /applications/);
    assert.match(backupSummary, /contacts/);
    assert.match(backupSummary, /interviews/);
    assert.equal(await optionsPage.locator("#restore-backup").isDisabled(), true, "restore stays locked before the typed confirmation");
    await optionsPage.locator("#restore-confirmation").fill("RESTORE");
    assert.equal(await optionsPage.locator("#restore-backup").isEnabled(), true, "reviewed backup can be explicitly unlocked for restore");
    await optionsPage.close();
    assert.equal(dashboardMessages.some((message) => /aria-hidden|retained focus/i.test(message)), false, "drawer lifecycle must not hide a focused descendant");
    await helper.close();
    console.log("PASS reviewed submission, CRM, interview and encrypted backup lifecycle");
    console.log(`Browser regression complete: ${ATS_CASES.length}/${ATS_CASES.length} ATS fixtures passed using unpacked MV3 at ${extensionRoot}.`);
  } finally {
    await context?.close().catch(() => {});
    await server.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
