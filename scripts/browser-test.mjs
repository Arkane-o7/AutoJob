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

async function sendFill(worker) {
  return worker.evaluate(() => new Promise((resolveMessage, rejectMessage) => {
    let attempts = 0;
    const trySend = () => chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return rejectMessage(new Error("No active fixture tab"));
      chrome.tabs.sendMessage(tab.id, { type: "APPLYKIT_FILL" }, (response) => {
        const error = chrome.runtime.lastError;
        if (error && /Receiving end does not exist/i.test(error.message) && attempts++ < 50) {
          setTimeout(trySend, 100);
        } else if (error) rejectMessage(new Error(`${error.message} (active tab: ${tab.url || "unknown"})`));
        else resolveMessage(response);
      });
    });
    trySend();
  }));
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
    submitClickCount: window.__fixture.submitClickCount
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
    await waitForExtensionInitialization(worker);
    await worker.evaluate(async (fakeProfile) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        profile: { ...fakeProfile, firstName: "Stale", address: "", city: "", state: "", postalCode: "" },
        profilesIndex: {
          activeId: "browser_test",
          profiles: [{ id: "browser_test", name: "Browser test", targetRole: "", color: "#b7ff3c", createdAt: Date.now() }]
        },
        profile_browser_test: fakeProfile
      });
    }, profile);

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
      }
      console.log(`PASS ${testCase.id.padEnd(15)} values, events, resume, privacy and no-navigation invariants`);
    }

    await page.bringToFront();
    const reportResponse = await activeTabMessage(worker, { type: "APPLYOS_REPORT_BROKEN" });
    assert.equal(reportResponse?.ok, true, "broken-field review should open through the content message path");
    const review = page.locator(".applyos-review-dialog");
    await review.waitFor({ state: "visible" });
    const githubReport = review.locator(".applyos-review-report");
    assert.equal(await githubReport.isDisabled(), true, "GitHub reporting requires an explicit field selection");
    assert.equal(await review.locator("input[type='checkbox']:checked").count(), 0, "diagnostic fields require explicit selection");
    assert.deepEqual(JSON.parse(await review.locator("textarea").inputValue()).fields, [], "unreviewed diagnostics contain no fields");
    for (const label of ["Email address", "Upload CV/Resume"]) {
      await review.locator("label", { hasText: label }).locator("input[type='checkbox']").check();
    }
    const reviewedPayload = await review.locator("textarea").inputValue();
    assert.match(reviewedPayload, /Email address/);
    assert.match(reviewedPayload, /Upload CV\/Resume/);
    for (const privateValue of ["existing@example.test", resumeName, "+44 20 7946 0958"]) {
      assert.equal(reviewedPayload.includes(privateValue), false, `diagnostic preview excludes ${privateValue}`);
    }
    assert.equal(await githubReport.isEnabled(), true, "reviewed fields enable the manual GitHub report action");
    const githubUrl = await githubReport.getAttribute("data-report-url");
    assert.match(githubUrl, /^https:\/\/github\.com\/Arkane-o7\/AutoJob\/issues\/new\?/);
    for (const privateValue of ["existing@example.test", resumeName, "+44 20 7946 0958"]) {
      assert.equal(githubUrl.includes(privateValue), false, `prefilled GitHub report excludes ${privateValue}`);
    }
    await review.locator(".applyos-review-close").click();
    console.log("PASS reviewed-report value-free preview and manual GitHub issue handoff");

    const extensionId = new URL(worker.url()).host;
    const popupProbe = await context.newPage();
    await popupProbe.setViewportSize({ width: 420, height: 600 });
    await popupProbe.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
    await popupProbe.waitForTimeout(250);
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

    const helper = await context.newPage();
    const dashboardMessages = [];
    helper.on("console", (message) => { if (["warning", "error"].includes(message.type())) dashboardMessages.push(message.text()); });
    await helper.goto(`chrome-extension://${extensionId}/dashboard.html`, { waitUntil: "domcontentloaded" });
    const runtime = await helper.evaluate(() => chrome.runtime.sendMessage({ type: "APPLYOS_RUNTIME_PING" }));
    assert.equal(runtime?.ok, true, "the popup runtime handshake should reach the service worker");
    assert.equal(runtime?.features?.applicationTracking, true, "the service worker should advertise application tracking");
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
    assert.match(download.suggestedFilename(), /^applyos-backup-\d{4}-\d{2}-\d{2}\.applyos$/, "encrypted export uses the ApplyOS backup extension");
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
