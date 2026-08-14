import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  customAnswers: [
    { question: "Do you currently have any active academic backlogs?", answer: "No" },
    { question: "Reg No.", answer: "24BDS0129", source: "application" },
    { question: "College email id", answer: "ada@university.example", source: "application" },
    { question: "10th %", answer: "95", source: "application" },
    { question: "12th %", answer: "89", source: "application" },
    { question: "Degree & specialization", answer: "CSE (Data Science)", source: "application" }
  ]
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
    if (bundledCloud.allowRuntimeConfig === true) {
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
        profiles: [{ id: "browser_test", name: "Product design", targetRole: "", color: "#b7ff3c", createdAt: Date.now() }]
      },
      profile_browser_test: fakeProfile
    });
    await ApplyOS.ensureState();
    await ApplyOS.ensureGraph();
    for (const question of ["Reg No.", "Name", "College email id", "10th %", "12th %", "Degree & specialization"]) {
      await ApplyOS.rememberCorrection({
        fingerprint: `docs.google.com|stale|text|${question}`,
        question,
        answer: fakeProfile.phone,
        field_type: "text",
        site: "docs.google.com"
      });
    }
    await ApplyOS.persistActiveUserCache(userId);
  }, { fakeProfile: profile, userId: "11111111-1111-4111-8111-111111111111" });
}

async function installCalendarMock(worker) {
  await worker.evaluate(() => {
    globalThis.__scoutCalendarMock = { token: "", events: {}, calls: [], nextId: 1, identityCalls: [] };
    const mock = globalThis.__scoutCalendarMock;
    const response = (status, body = null) => ({ status, ok: status >= 200 && status < 300, async json() { return body; } });
    const identity = {
      async getAuthToken(details) {
        mock.identityCalls.push({ interactive: details.interactive, scopes: details.scopes });
        if (!mock.token && !details.interactive) throw new Error("OAuth2 not granted.");
        if (!mock.token) mock.token = "mock-google-calendar-token";
        return { token: mock.token };
      },
      async removeCachedAuthToken({ token }) { if (token === mock.token) mock.token = ""; }
    };
    const request = async (url, init = {}) => {
      const parsed = new URL(url);
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) : null;
      mock.calls.push({ url, method, body });
      if (parsed.hostname === "oauth2.googleapis.com") return response(200, {});
      const eventMatch = parsed.pathname.match(/\/calendars\/primary\/events\/([^/]+)$/);
      if (method === "GET") {
        const property = parsed.searchParams.get("privateExtendedProperty") || "";
        const actionId = property.split("=").slice(1).join("=");
        return response(200, { items: Object.values(mock.events).filter((event) => event.extendedProperties?.private?.scout_action_id === actionId) });
      }
      if (method === "POST" && parsed.pathname.endsWith("/calendars/primary/events")) {
        const event = { id: `mock-event-${mock.nextId++}`, ...body };
        mock.events[event.id] = event;
        return response(200, event);
      }
      if (method === "PATCH" && eventMatch) {
        const id = decodeURIComponent(eventMatch[1]);
        if (!mock.events[id]) return response(404, { error: { message: "Event not found" } });
        mock.events[id] = { id, ...body };
        return response(200, mock.events[id]);
      }
      if (method === "DELETE" && eventMatch) {
        const id = decodeURIComponent(eventMatch[1]);
        if (!mock.events[id]) return response(404, { error: { message: "Event not found" } });
        delete mock.events[id];
        return response(204);
      }
      return response(400, { error: { message: "Unexpected mocked Google request" } });
    };
    ApplyOS.configureCalendarSync({ identity, request });
  });
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
    manualAnswer: document.querySelector("#manual-answer")?.value || "",
    registrationNumber: document.querySelector("#registration-number")?.value || "",
    googleFullName: document.querySelector("#google-full-name")?.value || "",
    personalEmail: document.querySelector("#personal-email")?.value || "",
    collegeEmail: document.querySelector("#college-email")?.value || "",
    preservedCollegeEmail: document.querySelector("#preserved-college-email")?.value || "",
    institutionalEmail: document.querySelector("#institutional-email")?.value || "",
    tenthPercentage: document.querySelector("#tenth-percentage")?.value || "",
    twelfthPercentage: document.querySelector("#twelfth-percentage")?.value || "",
    degreeSpecialization: document.querySelector("#degree-specialization")?.value || "",
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
  if (testCase.id === "react-dropzone") {
    assert.equal(state.registrationNumber, "24BDS0129", "answer memory: exact registration-number answer beats stale same-site correction memory");
    assert.equal(state.googleFullName, "Ada Lovelace", "answer memory: exact saved name beats stale same-site correction memory");
    assert.equal(state.personalEmail, "ada@example.test", "answer memory: personal email uses the personal profile identity");
    assert.equal(state.collegeEmail, "ada@university.example", "answer memory: college email stays distinct from the generic profile email");
    assert.equal(state.preservedCollegeEmail, "ada@example.test", "answer memory: a Google-restored draft value is preserved until the user corrects it");
    assert.equal(state.institutionalEmail, "", "answer memory: a generic personal email must not fill an unknown institutional field");
    assert.equal(state.tenthPercentage, "95", "answer memory: exact 10th-percentage answer beats stale phone-number contamination");
    assert.equal(state.twelfthPercentage, "89", "answer memory: exact 12th-percentage answer beats stale phone-number contamination");
    assert.equal(state.degreeSpecialization, "CSE (Data Science)", "answer memory: exact degree answer beats stale same-site correction memory");
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
    const extensionId = new URL(worker.url()).host;
    await waitForSignedOutInitialization(worker);

    const signedOutProbe = await context.newPage();
    await signedOutProbe.setViewportSize({ width: 1440, height: 900 });
    await signedOutProbe.goto(`chrome-extension://${extensionId}/account.html?reason=sign-in-required&returnTo=popup`, { waitUntil: "domcontentloaded" });
    await signedOutProbe.waitForFunction(() => document.body.classList.contains("first-run-auth") && !document.querySelector("#signed-out-actions")?.classList.contains("hidden"));
    const signInLayout = await signedOutProbe.locator("#identity").evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      const heading = document.querySelector(".identity-heading");
      const header = document.querySelector(".scout-header");
      const emailForm = document.querySelector("#email-request-form");
      const consent = document.querySelector(".auth-consent");
      const consentDetails = document.querySelector(".consent-details");
      const bodyStyle = getComputedStyle(document.body);
      return {
        cardCenter: bounds.left + bounds.width / 2,
        viewportCenter: document.documentElement.clientWidth / 2,
        cardWidth: bounds.width,
        headingAlignment: heading ? getComputedStyle(heading).textAlign : "",
        headerDisplay: header ? getComputedStyle(header).display : "",
        identityEyebrowCount: document.querySelectorAll("#identity .identity-heading .eyebrow").length,
        consentAfterEmail: Boolean(emailForm && consent && (emailForm.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING)),
        consentDetailsGap: consent && consentDetails ? consentDetails.getBoundingClientRect().top - consent.getBoundingClientRect().bottom : 0,
        consentBottomBorder: consent ? getComputedStyle(consent).borderBottomWidth : "",
        detailsTopBorder: consentDetails ? getComputedStyle(consentDetails).borderTopWidth : "",
        backgroundImage: bodyStyle.backgroundImage,
        backgroundColor: bodyStyle.backgroundColor
      };
    });
    assert.ok(Math.abs(signInLayout.cardCenter - signInLayout.viewportCenter) <= 8, `first-run sign-in card stays centered within the browser scrollbar tolerance (${JSON.stringify(signInLayout)})`);
    assert.ok(signInLayout.cardWidth >= 620, "first-run sign-in card uses an intentional desktop scale");
    assert.equal(signInLayout.headingAlignment, "center", "first-run sign-in heading follows the centered composition");
    assert.equal(signInLayout.headerDisplay, "none", "first-run sign-in removes the top header bar");
    assert.equal(signInLayout.identityEyebrowCount, 0, "first-run sign-in has no identity eyebrow label");
    assert.equal(signInLayout.consentAfterEmail, true, "first-run sign-in places consent after the login methods");
    assert.ok(signInLayout.consentDetailsGap >= 8, `first-run consent leaves clear space before What this includes (${JSON.stringify(signInLayout)})`);
    assert.equal(signInLayout.consentBottomBorder, "0px", "first-run consent disclosure has no internal horizontal divider");
    assert.equal(signInLayout.detailsTopBorder, "0px", "first-run consent details have no internal horizontal divider");
    assert.equal(signInLayout.backgroundImage, "none", "first-run sign-in keeps its background free of gradients and decorative images");
    assert.equal(signInLayout.backgroundColor, "rgb(227, 241, 201)", "first-run sign-in uses one quiet solid Scout background");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await signedOutProbe.locator(".consent-details").evaluate((details) => { details.open = true; });
      await signedOutProbe.waitForTimeout(300);
      await signedOutProbe.screenshot({ path: resolve(root, "output/playwright/account-sign-in.png"), fullPage: true });
    }
    await signedOutProbe.setViewportSize({ width: 390, height: 844 });
    const mobileSignInLayout = await signedOutProbe.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerHeight: document.querySelector(".scout-header")?.getBoundingClientRect().height || 0,
      cardWidth: document.querySelector("#identity")?.getBoundingClientRect().width || 0
    }));
    assert.ok(mobileSignInLayout.scrollWidth <= mobileSignInLayout.clientWidth, `first-run sign-in avoids horizontal overflow on mobile (${JSON.stringify(mobileSignInLayout)})`);
    assert.equal(mobileSignInLayout.headerHeight, 0, "first-run mobile sign-in keeps the header removed");
    assert.ok(mobileSignInLayout.cardWidth <= mobileSignInLayout.clientWidth - 24, "first-run sign-in card keeps a mobile canvas margin");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await signedOutProbe.waitForTimeout(200);
      await signedOutProbe.screenshot({ path: resolve(root, "output/playwright/account-sign-in-mobile.png"), fullPage: true });
    }
    await signedOutProbe.close();

    await installBrowserAccount(worker);
    await waitForExtensionInitialization(worker);
    await installCalendarMock(worker);

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

      if (testCase.id === "react-dropzone") {
        await target.locator("#preserved-college-email").fill("updated@university.example");
        await target.locator("#preserved-college-email").press("Tab");
        const correctedMemory = await worker.evaluate(async () => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const activeProfile = await ApplyOS.getActiveProfile();
            const corrected = (activeProfile.customAnswers || []).find((item) => item.question === "University email id");
            if (corrected?.answer === "updated@university.example" && activeProfile.collegeEmail === "updated@university.example") {
              return { corrected, collegeEmail: activeProfile.collegeEmail };
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          return null;
        });
        assert.equal(correctedMemory?.corrected?.source, "application", "a corrected restored draft becomes visible, editable Answer Library memory");
        assert.equal(correctedMemory?.collegeEmail, "updated@university.example", "a college-email correction updates the reusable college identity");
        await target.locator("#ssn").fill("000-00-0000");
        await target.locator("#ssn").press("Tab");
        await target.waitForTimeout(400);
        const sensitiveLearned = await worker.evaluate(async () => (await ApplyOS.getActiveProfile()).customAnswers?.some((item) => /social security|ssn/i.test(item.question)) || false);
        assert.equal(sensitiveLearned, false, "sensitive manual fields must never enter custom answer memory");
        await target.locator("#ssn").fill("");
        await target.locator("#ssn").press("Tab");
        await target.locator("#manual-answer").fill("I enjoy building reliable distributed systems.");
        await target.locator("#manual-answer").press("Tab");
        const learnedAnswer = await worker.evaluate(async () => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const activeProfile = await ApplyOS.getActiveProfile();
            const learned = (activeProfile.customAnswers || []).find((item) => item.question === "What kind of systems do you enjoy building?");
            if (learned) return learned;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          return null;
        });
        assert.equal(learnedAnswer?.answer, "I enjoy building reliable distributed systems.", "manual completion should become a reusable custom answer");
        assert.equal(learnedAnswer?.source, "application", "application-learned answers remain identifiable in Profile & Settings");
      }

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

        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.bringToFront();
        const learnedTarget = await fixtureTarget(page, testCase);
        await learnedTarget.waitForSelector("#manual-answer");
        await learnedTarget.evaluate(() => { document.querySelector('label[for="manual-answer"]').textContent = "What kind of software systems do you enjoy building?"; });
        const learnedFill = await sendFill(worker);
        assert.equal(learnedFill?.ok, true, `${testCase.id}: learned-answer refill should succeed`);
        await learnedTarget.waitForFunction(() => Boolean(document.querySelector("#manual-answer")?.value));
        assert.equal(await learnedTarget.locator("#manual-answer").inputValue(), "I enjoy building reliable distributed systems.", `${testCase.id}: a similar future question reuses the reviewed manual answer`);
        assert.equal(await learnedTarget.evaluate(() => window.__fixture.submitCount), 0, `${testCase.id}: learned-answer reuse must not submit`);
      }
      console.log(`PASS ${testCase.id.padEnd(15)} values, events, resume, privacy and no-navigation invariants`);
    }

    const promptUrl = `http://apply.careers.microsoft.com:${server.port}/microsoft`;
    await page.goto(promptUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    const pagePrompt = page.locator(".scout-page-prompt");
    await pagePrompt.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await pagePrompt.locator("h2").textContent(), /autofill/i, "known ATS form should offer review-gated autofill");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: resolve(root, "output/playwright/autofill-review.png") });
    }
    const promptLayout = await pagePrompt.evaluate((prompt) => {
      const card = prompt.getBoundingClientRect();
      const stack = prompt.parentElement;
      const actions = Array.from(prompt.querySelectorAll("button")).map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return {
        card: { left: card.left, right: card.right, width: card.width },
        viewportWidth: document.documentElement.clientWidth,
        stackClientWidth: stack?.clientWidth || 0,
        stackScrollWidth: stack?.scrollWidth || 0,
        actions
      };
    });
    assert.ok(promptLayout.card.left >= 0 && promptLayout.card.right <= promptLayout.viewportWidth, "page prompt stays within the viewport");
    assert.ok(promptLayout.stackScrollWidth <= promptLayout.stackClientWidth, "page prompt stack has no horizontal overflow");
    assert.ok(promptLayout.actions.every((button) => button.left >= promptLayout.card.left && button.right <= promptLayout.card.right), "page prompt actions stay inside the card");
    await pagePrompt.locator(".scout-page-primary").click();
    await pagePrompt.waitFor({ state: "detached" });
    assert.equal(await page.locator("#Contact_Information_q_address").inputValue(), profile.address, "page prompt invokes the same safe autofill path");
    assert.equal(await page.evaluate(() => window.__fixture.submitCount), 0, "page prompt never submits the application");
    const promptedApplication = await worker.evaluate(async (url) => ApplyOS.getApplicationByUrl(url), promptUrl);
    assert.equal(promptedApplication?.company, "Microsoft", "page prompt saves the detected job before autofill");
    assert.ok(promptedApplication?.match_score >= 80, "saved job match uses the active profile's extracted resume text");
    assert.ok(promptedApplication?.matched_skills?.includes("typescript"), "saved job records resume-text skill overlap");
    await page.locator(".applykit-toast").first().waitFor({ state: "visible" });
    if (process.env.SCOUT_CAPTURE_UI === "1") await page.screenshot({ path: resolve(root, "output/playwright/autofill-complete.png") });
    assert.equal(await page.locator(".scout-notification-stack > .applykit-toast").count(), 1, "save-and-autofill reports its result once");
    await sendFill(worker);
    await page.waitForFunction(() => document.querySelectorAll(".scout-notification-stack > .applykit-toast").length >= 2);
    const toastLayout = await page.locator(".scout-notification-stack > .applykit-toast").evaluateAll((items) => items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    assert.ok(toastLayout.every((item, index) => index === 0 || toastLayout[index - 1].bottom < item.top), "simultaneous page notifications stack vertically without overlap");
    console.log("PASS detected ATS page offers explicit save-and-autofill without submission");

    await page.goto(`http://apply.example.test:${server.port}/delayed-job`, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    const delayedPrompt = page.locator(".scout-page-prompt");
    await delayedPrompt.waitFor({ state: "visible", timeout: 6000 });
    assert.match(await delayedPrompt.textContent(), /Platform Engineer at Dynamic Labs/, "late-rendered SPA job details should trigger the autofill prompt");
    await delayedPrompt.getByRole("button", { name: "Not now" }).click();
    await page.evaluate(() => document.querySelector("#app")?.append(document.createElement("span")));
    await page.waitForTimeout(700);
    assert.equal(await page.locator(".scout-page-prompt").count(), 0, "dismissing a job prompt suppresses it for that page session");
    console.log("PASS late-rendered job pages prompt once and respect dismissal");

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

    const popupProbe = await context.newPage();
    await popupProbe.setViewportSize({ width: 420, height: 600 });
    await popupProbe.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
    await popupProbe.waitForFunction(() => document.querySelector("#score strong")?.textContent.trim() === "-");
    await popupProbe.waitForFunction(() => document.querySelectorAll("select:not([multiple])").length === document.querySelectorAll("select.scout-select__native").length);
    assert.equal(await popupProbe.locator(".scout-select__trigger").count(), await popupProbe.locator("select:not([multiple])").count(), "popup replaces every native dropdown presentation with the shared Scout control");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await popupProbe.waitForTimeout(300); await popupProbe.evaluate(() => scrollTo(0, 0)); await popupProbe.locator("main").screenshot({ path: resolve(root, "output/playwright/popup-job.png") }); }
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
        bodyPadding: parseFloat(getComputedStyle(document.body).padding),
        mainHeight: main?.clientHeight || 0,
        mainContentHeight: main?.scrollHeight || 0,
        mainOverflow: main ? getComputedStyle(main).overflowY : "missing"
      };
    });
    assert.ok(popupMetrics.documentHeight <= 600, "popup document should remain within Chrome's 600px maximum");
    assert.ok(popupMetrics.bodyHeight <= 600, "popup body should not create an outer scroll surface");
    assert.ok(popupMetrics.mainHeight <= 600, "popup content surface should remain within Chrome's maximum height");
    assert.equal(popupMetrics.bodyPadding, 0, "popup uses the Chrome-owned surface edge-to-edge without a fake outer gutter");
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
    const accountNativeDialogs = [];
    accountProbe.on("console", (message) => { if (["warning", "error"].includes(message.type())) accountMessages.push(message.text()); });
    accountProbe.on("dialog", async (dialog) => { accountNativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await accountProbe.goto(`chrome-extension://${extensionId}/account.html`, { waitUntil: "domcontentloaded" });
    await accountProbe.locator("#identity-title").waitFor({ state: "visible" });
    await accountProbe.waitForFunction(() => !document.querySelector("#signed-in-actions")?.classList.contains("hidden"));
    assert.match(await accountProbe.locator("#identity-title").textContent(), /account|connected|welcome/i, "account page recognizes the authenticated workspace");
    assert.equal(await accountProbe.locator("#deployment-config").count(), 0, "customer UI never exposes deployment configuration");
    assert.equal(await accountProbe.getByText("Continue locally").count(), 0, "account-required builds expose no local-only bypass");
    assert.equal(await accountProbe.locator("#google-sign-in").count(), 1, "Google is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#linkedin-sign-in").count(), 1, "LinkedIn is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#email-request-form").count(), 1, "email code login is available as a supported sign-in method");
    assert.equal(await accountProbe.locator("#calendar").count(), 1, "Google Calendar belongs to Account & sync");
    assert.equal(await accountProbe.locator("#backup").count(), 1, "encrypted recovery belongs to Account & sync");
    assert.equal(await accountProbe.locator("[data-settings-view='integrations']").count(), 1, "Settings exposes a focused Integrations category");
    assert.equal(await accountProbe.locator("[data-settings-view='privacy']").count(), 1, "Settings exposes a focused Privacy and data category");
    assert.equal(await accountProbe.locator(".scout-side-nav__heading").count(), 1, "Settings uses the shared, labeled sidebar navigation component");
    const settingsNavStyle = await accountProbe.locator(".scout-side-nav").evaluate((nav) => ({ radius: getComputedStyle(nav).borderRadius, activeBackground: getComputedStyle(nav.querySelector("[aria-selected='true']")).backgroundColor }));
    assert.deepEqual(settingsNavStyle, { radius: "12px", activeBackground: "rgb(184, 243, 74)" }, "Settings matches the Profile sidebar surface and selected state");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await accountProbe.waitForTimeout(250);
      await accountProbe.screenshot({ path: resolve(root, "output/playwright/account-sync.png"), fullPage: true });
    }
    assert.doesNotMatch(await accountProbe.locator(".auth-consent").textContent(), /stores personal data you choose to provide/i, "account consent keeps the storage explanation out of the checkbox copy");
    assert.equal(await accountProbe.locator('.auth-consent a[href="privacy-site/terms.html"]').count(), 1, "account consent links the User Agreement");
    assert.equal(await accountProbe.locator('.auth-consent a[href="privacy-site/privacy.html"]').count(), 1, "account consent links the Privacy Policy");
    assert.equal(await accountProbe.locator("details.consent-details").count(), 1, "account consent offers a compact data-category explanation");
    assert.match(await accountProbe.locator("details.consent-details").textContent(), /stores personal data you choose to provide/i, "account consent moves the storage explanation into What this includes");
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
    await accountProbe.locator("[data-settings-view='privacy']").click();
    await accountProbe.locator("#delete-account").click();
    const accountConfirm = accountProbe.locator(".scout-system-dialog");
    await accountConfirm.waitFor({ state: "visible" });
    assert.match(await accountConfirm.locator("#scout-dialog-title").textContent(), /Delete your Scout account/i, "account deletion uses the Scout dialog");
    assert.equal(await accountConfirm.locator('[data-scout-dialog-field="confirmation"]').count(), 1, "permanent account deletion keeps typed confirmation inside the page");
    assert.equal(await accountConfirm.locator(".scout-system-dialog__confirm").isDisabled(), true, "permanent deletion remains locked until the exact phrase is typed");
    await accountConfirm.locator(".scout-system-dialog__cancel").click();
    await accountConfirm.waitFor({ state: "hidden" });
    assert.deepEqual(accountNativeDialogs, [], "account controls never open native browser dialogs");

    await worker.evaluate(async () => ApplyOS.saveCloudConfig({ projectUrl: "", publishableKey: "" }));
    await accountProbe.goto(`chrome-extension://${extensionId}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await accountProbe.waitForURL(/account\.html\?reason=configuration-required&returnTo=dashboard\.html/);
    await accountProbe.locator("#identity-title", { hasText: "Scout needs an update" }).waitFor({ state: "visible" });
    await accountProbe.waitForTimeout(900);
    assert.match(accountProbe.url(), /account\.html\?reason=configuration-required/, "an unconfigured build stays on the account page instead of starting a redirect loop");
    assert.doesNotMatch(await accountProbe.locator("#identity-result").textContent(), /Returning to Scout/i, "an unconfigured build never claims it is returning to Scout");
    assert.equal(await accountProbe.locator("#connection-state").textContent(), "Unavailable", "the configuration gate never presents a contradictory online state");
    await worker.evaluate(async () => ApplyOS.saveCloudConfig({
      projectUrl: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_browser_regression"
    }));
    await accountProbe.close();

    const legalProbe = await context.newPage();
    await legalProbe.goto(`chrome-extension://${extensionId}/privacy-site/privacy.html`, { waitUntil: "domcontentloaded" });
    assert.match(await legalProbe.locator("h1").textContent(), /job search is/i, "packaged Privacy Policy renders");
    assert.equal(await legalProbe.locator('a[href="terms.html"]').count() > 0, true, "Privacy Policy links the User Agreement");
    await legalProbe.goto(`chrome-extension://${extensionId}/privacy-site/terms.html`, { waitUntil: "domcontentloaded" });
    assert.match(await legalProbe.locator("h1").textContent(), /helpful automation/i, "packaged User Agreement renders");
    assert.equal(await legalProbe.locator('a[href="privacy.html"]').count() > 0, true, "User Agreement links the Privacy Policy");
    await legalProbe.close();
    console.log("PASS concise account consent links complete packaged legal disclosures");
    await worker.evaluate(async () => {
      const keys = ApplyOS.cloudRepositoryKeys("11111111-1111-4111-8111-111111111111");
      const stored = await chrome.storage.local.get([keys.meta, keys.outbox]);
      await chrome.storage.local.set({ [keys.meta]: { ...(stored[keys.meta] || {}), status: "synced", conflict: null }, [keys.outbox]: [] });
    });
    console.log("PASS account page shows a readable newest-version conflict choice without raw JSON");
    console.log("PASS stale account sessions cannot create an account/dashboard redirect loop");

    const savedFirstLoginProfile = await worker.evaluate(async () => {
      const index = await ApplyOS.getProfilesIndex();
      const key = `profile_${index.activeId}`;
      const stored = await chrome.storage.local.get([key, ApplyOS.PROFILE_KEY]);
      await chrome.storage.local.set({ [key]: {}, [ApplyOS.PROFILE_KEY]: {} });
      return { key, profile: stored[key] || stored[ApplyOS.PROFILE_KEY] || {} };
    });
    const firstLoginProbe = await context.newPage();
    await firstLoginProbe.goto(`chrome-extension://${extensionId}/account.html?reason=sign-in-required&returnTo=popup`, { waitUntil: "domcontentloaded" });
    await firstLoginProbe.waitForURL(`chrome-extension://${extensionId}/onboarding.html?start=1`);
    await firstLoginProbe.waitForFunction(() => document.querySelector("[data-panel='0']")?.classList.contains("active"));
    await firstLoginProbe.close();
    await worker.evaluate(async ({ key, profile: savedProfile }) => {
      await chrome.storage.local.set({ [key]: savedProfile, [ApplyOS.PROFILE_KEY]: savedProfile });
    }, savedFirstLoginProfile);
    console.log("PASS incomplete first-login profiles enter guided setup from the popup sign-in route");

    const starterProbe = await context.newPage();
    await starterProbe.goto(`chrome-extension://${extensionId}/onboarding.html?start=1`, { waitUntil: "domcontentloaded" });
    await starterProbe.waitForFunction(() => document.querySelector("[data-panel='0']")?.classList.contains("active"));
    if (process.env.SCOUT_CAPTURE_UI === "1") { await starterProbe.waitForTimeout(400); await starterProbe.screenshot({ path: resolve(root, "output/playwright/onboarding-welcome.png"), fullPage: true }); }
    assert.equal(await starterProbe.locator("[data-panel]").count(), 3, "first-run onboarding stays focused on three activation steps");
    assert.match(await starterProbe.locator("[data-panel='0'] h2").textContent(), /Less repetition/i);
    await starterProbe.locator("#next").click();
    await starterProbe.waitForFunction(() => document.querySelector("[data-panel='1']")?.classList.contains("active"));
    assert.equal(await starterProbe.locator("[data-panel='1'] input[required]").count(), 0, "resume import is useful but optional");
    await starterProbe.locator("#next").click();
    await starterProbe.waitForFunction(() => document.querySelector("[data-panel='2']")?.classList.contains("active"));
    assert.equal(await starterProbe.locator("[data-panel='2'] input[required]").count(), 4, "starter profile asks only for core autofill identity fields");
    assert.match(await starterProbe.locator("#next").textContent(), /Open my workspace/);
    await starterProbe.locator("#next").click();
    await starterProbe.waitForURL(`chrome-extension://${extensionId}/dashboard.html?welcome=1`);
    await starterProbe.locator("#actions-workspace").waitFor({ state: "visible" });
    assert.equal(await starterProbe.locator(".scout-tour-card").count(), 0, "setup opens the real Home workspace without a blocking tour");
    await starterProbe.close();
    console.log("PASS activation setup opens the real Home workspace without a forced tour");

    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("profile_browser_test");
      const value = { ...stored.profile_browser_test, structuredFutureField: { preserved: true } };
      await chrome.storage.local.set({ profile_browser_test: value, profile: value });
    });
    const profileProbe = await context.newPage();
    await profileProbe.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    await profileProbe.locator("#profile-form").waitFor({ state: "visible" });
    assert.equal(await profileProbe.getByText("Run setup again").count(), 0, "the full profile editor must not expose a competing setup editor");
    assert.equal(await profileProbe.locator("#calendar, #backup").count(), 0, "profile settings stay focused on profile and answer data");
    await profileProbe.locator("[data-profile-view='basics']").click();
    await profileProbe.locator("[name='preferredName']").fill("Browser Test");
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
    const onboardingProbe = await context.newPage();
    await onboardingProbe.goto(`chrome-extension://${extensionId}/onboarding.html`, { waitUntil: "domcontentloaded" });
    await onboardingProbe.waitForURL(`chrome-extension://${extensionId}/options.html`);
    await onboardingProbe.close();
    await profileProbe.locator("[data-profile-view='overview']").click();
    assert.equal(await profileProbe.locator("[data-profile-view='overview']").getAttribute("aria-selected"), "true", "Profile opens on a useful completion overview");
    assert.equal(await profileProbe.locator(".scout-side-nav__heading").count(), 1, "Profile sections use the shared, labeled sidebar navigation component");
    const activeProfileNavBackground = await profileProbe.locator("[data-profile-view='overview']").evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(activeProfileNavBackground, "rgba(0, 0, 0, 0)", "The active profile section is visually prominent rather than a muted text link");
    assert.match(await profileProbe.locator("#completion-value").textContent(), /\d+%/, "Profile communicates readiness at a glance");
    assert.equal(await profileProbe.locator("#local-ai, #follow-up-offsets").count(), 0, "Profile keeps reminder and advanced configuration in Settings");
    const profileSelectControl = profileProbe.locator('[data-scout-select-for="profile-select"]');
    const profileSelectTrigger = profileSelectControl.locator(".scout-select__trigger");
    await profileSelectTrigger.press("Enter");
    const profileSelectMenu = profileProbe.locator(`#${await profileSelectTrigger.getAttribute("aria-controls")}`);
    await profileSelectMenu.waitFor({ state: "visible" });
    const profileSelectStyle = await profileSelectMenu.evaluate((menu) => ({
      background: getComputedStyle(menu).backgroundColor,
      shadow: getComputedStyle(menu).boxShadow,
      selected: menu.querySelector('[role="option"][aria-selected="true"]')?.textContent.trim() || ""
    }));
    assert.equal(profileSelectStyle.background, "rgb(255, 253, 247)", "open dropdown menus use the Scout paper surface instead of the platform menu");
    assert.notEqual(profileSelectStyle.shadow, "none", "open dropdown menus use the Scout offset surface treatment");
    assert.match(profileSelectStyle.selected, /Product design/i, "the custom dropdown exposes its selected option");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await profileProbe.waitForTimeout(180); await profileProbe.screenshot({ path: resolve(root, "output/playwright/profile-dropdown-open.png"), fullPage: true }); }
    await profileSelectTrigger.press("Escape");
    assert.equal(await profileSelectTrigger.getAttribute("aria-expanded"), "false", "Escape closes the themed dropdown and restores its combobox state");
    await profileProbe.evaluate(() => {
      const select = document.createElement("select");
      select.id = "dynamic-select-regression";
      select.innerHTML = '<option value="remote">Remote</option><option value="hybrid">Hybrid</option>';
      select.addEventListener("change", () => { select.dataset.changeCount = String(Number(select.dataset.changeCount || 0) + 1); });
      document.body.append(select);
    });
    const dynamicTrigger = profileProbe.locator('[data-scout-select-for="dynamic-select-regression"] .scout-select__trigger');
    await dynamicTrigger.waitFor({ state: "visible" });
    await dynamicTrigger.press("ArrowDown");
    await dynamicTrigger.press("Enter");
    assert.deepEqual(await profileProbe.locator("#dynamic-select-regression").evaluate((select) => ({ value: select.value, changes: select.dataset.changeCount })), { value: "hybrid", changes: "1" }, "dynamically added dropdowns preserve native values, keyboard selection, and change events");
    await profileProbe.locator('[data-scout-select-for="dynamic-select-regression"]').evaluate((wrapper) => wrapper.remove());
    if (process.env.SCOUT_CAPTURE_UI === "1") { await profileProbe.waitForTimeout(250); await profileProbe.screenshot({ path: resolve(root, "output/playwright/profile-overview.png"), fullPage: true }); }
    await profileProbe.locator("[data-profile-view='answers']").click();
    const answerRowLayout = await profileProbe.locator(".answer-row").first().evaluate((row) => {
      const question = row.querySelector(".answer-question-field")?.getBoundingClientRect();
      const answer = row.querySelector(".answer-copy-field")?.getBoundingClientRect();
      return { fits: row.scrollWidth <= row.clientWidth, aligned: Math.abs((question?.top || 0) - (answer?.top || 0)) <= 2, radius: parseFloat(getComputedStyle(row).borderRadius) };
    });
    assert.deepEqual(answerRowLayout, { fits: true, aligned: true, radius: 12 }, "answer cards align their primary fields without overflow and use the shared curved surface");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await profileProbe.waitForTimeout(250); await profileProbe.screenshot({ path: resolve(root, "output/playwright/profile-answers.png"), fullPage: true }); }
    await profileProbe.close();
    console.log("PASS canonical profile round-trip and section-based profile overview");

    const helper = await context.newPage();
    await helper.setViewportSize({ width: 1440, height: 900 });
    const dashboardMessages = [];
    const dashboardNativeDialogs = [];
    helper.on("console", (message) => { if (["warning", "error"].includes(message.type())) dashboardMessages.push(message.text()); });
    helper.on("dialog", async (dialog) => { dashboardNativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await helper.goto(`chrome-extension://${extensionId}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await helper.locator("[data-scout-header]").waitFor({ state: "visible" });
    await helper.waitForFunction(() => document.querySelector("[data-scout-profile-select]")?.value === "browser_test");
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
        profile: header.querySelector("[data-scout-profile-select]")?.value || "",
        selectCount: document.querySelectorAll("select:not([multiple])").length,
        themedSelectCount: document.querySelectorAll("select.scout-select__native").length
      };
    });
    const headerSamples = [{ page: "dashboard", ...(await headerSnapshot(helper)) }];
    for (const [name, path] of [["account", "account.html"], ["profile", "options.html"], ["setup", "onboarding.html?start=1"]]) {
      const surface = await context.newPage();
      await surface.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: "domcontentloaded" });
      await surface.locator("[data-scout-header]").waitFor({ state: "visible" });
      if (name !== "setup") await surface.waitForFunction(() => document.querySelector("[data-scout-profile-select]")?.value === "browser_test");
      headerSamples.push({ page: name, ...(await headerSnapshot(surface)) });
      await surface.close();
    }
    for (const sample of headerSamples) {
      assert.equal(sample.height, 68, `${sample.page} uses the shared 68px header geometry`);
      assert.equal(sample.brand, "Scout", `${sample.page} uses the supplied Scout wordmark`);
      assert.equal(sample.brandLoaded, true, `${sample.page} loads the supplied Scout wordmark asset`);
      if (sample.page === "setup") {
        assert.deepEqual(sample.nav, [], "setup removes unrelated product navigation");
        assert.deepEqual(sample.actions, [], "setup keeps attention on activation");
        assert.equal(sample.profile, "", "setup does not expose profile switching");
      } else {
        assert.deepEqual(sample.nav, ["Home", "Pipeline", "Network"], `${sample.page} uses the simplified primary navigation`);
        assert.deepEqual(sample.actions, ["Profile", "Settings"], `${sample.page} uses clear utility actions`);
        assert.equal(sample.profile, "browser_test", `${sample.page} uses the active workspace profile`);
      }
      assert.equal(sample.themedSelectCount, sample.selectCount, `${sample.page} replaces every native dropdown presentation with the shared Scout control`);
    }
    assert.equal(headerSamples.find((sample) => sample.page === "dashboard").active, "home");
    assert.equal(headerSamples.find((sample) => sample.page === "account").active, "settings");
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
    await worker.evaluate(async () => {
      const samples = [
        { company: "Northstar Labs", role: "Product Designer", status: "saved", priority: "high", source: "Greenhouse", description: "Design React product workflows and collaborate with TypeScript engineers." },
        { company: "Orbit Systems", role: "Senior Product Manager", status: "applied", priority: "medium", source: "Workday", description: "Lead an AWS platform roadmap across TypeScript services." },
        { company: "Lantern Health", role: "UX Researcher", status: "interview", priority: "high", source: "Ashby", description: "Research developer tools and Kubernetes workflows." },
        { company: "Papertrail Studio", role: "Design Systems Lead", status: "offer", priority: "medium", source: "Lever", description: "Build a React design system with TypeScript." }
      ];
      const saved = [];
      for (const [index, sample] of samples.entries()) {
        const application = await ApplyOS.upsertApplication({
          ...sample,
          url: `https://jobs.example.test/scout-${index + 1}`,
          deadline: new Date(Date.now() + (index + 2) * 86400000).toISOString()
        });
        saved.push(await ApplyOS.updateApplication(application.id, { status: sample.status, priority: sample.priority }));
      }
      await ApplyOS.upsertAction({ kind: "custom", title: "Review Northstar portfolio notes", due_at: new Date(Date.now() + 3 * 3600000).toISOString(), priority: "high", channel: "other", application_id: saved[0].id, source: "user" });
      await ApplyOS.upsertAction({ kind: "interview_prep", title: "Prepare for Lantern interview", due_at: new Date(Date.now() + 28 * 3600000).toISOString(), priority: "high", channel: "meeting", application_id: saved[2].id, source: "user" });
    });
    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator("[data-section='home']").click();
    const completeReminder = helper.locator(".action-row", { hasText: "Follow up" }).first().locator("[data-action-done]");
    await completeReminder.waitFor({ state: "visible" });
    await completeReminder.click();
    assert.equal(await worker.evaluate(async (id) => (await ApplyOS.getState()).reminders.filter((item) => item.application_id === id && item.completed_at).length, applicationId), 1, "dashboard Done completes a reminder instead of leaving it due forever");
    await helper.locator("[data-section='pipeline']").click();
    const applicationCard = helper.locator(`#board .job-card[data-id="${applicationId}"]`);
    await applicationCard.waitFor({ state: "visible" });
    assert.deepEqual(await helper.locator("#board .column-head > span:first-child").allTextContents(), ["SAVED", "APPLIED", "INTERVIEWING", "OFFER", "ARCHIVED"], "Pipeline groups detailed application states into five understandable stages");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("show")); await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/pipeline-workspace.png"), fullPage: true }); }
    await applicationCard.click();
    const detail = helper.locator("#detail");
    assert.equal(await detail.getAttribute("aria-modal"), "true", "open detail drawer is exposed as the active modal");
    assert.equal(await detail.getAttribute("data-state"), "open", "application drawer reports its open state");
    assert.equal(await helper.evaluate(() => document.activeElement?.id), "detail-role", "detail drawer moves focus to its first editable field");
    assert.equal(await helper.locator("#application-record-details").getAttribute("open"), null, "secondary application fields start collapsed");
    assert.equal(await helper.locator("#application-contacts").getAttribute("open"), null, "application workspaces start collapsed");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await helper.waitForTimeout(250);
      await helper.screenshot({ path: resolve(root, "output/playwright/application-detail.png") });
    }
    await helper.locator("#delete-application").click();
    const deleteApplicationDialog = helper.locator(".scout-system-dialog");
    await deleteApplicationDialog.waitFor({ state: "visible" });
    assert.match(await deleteApplicationDialog.locator("#scout-dialog-title").textContent(), /Remove Test Engineer/i, "application deletion uses the in-page Scout dialog");
    assert.equal(await detail.getAttribute("aria-modal"), "false", "the underlying drawer yields modal authority to the confirmation dialog");
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await helper.waitForTimeout(250);
      await helper.screenshot({ path: resolve(root, "output/playwright/delete-application-dialog.png") });
    }
    await deleteApplicationDialog.locator(".scout-system-dialog__cancel").click();
    await deleteApplicationDialog.waitFor({ state: "hidden" });
    assert.equal(await detail.getAttribute("aria-modal"), "true", "cancelling confirmation restores the application drawer’s modal state");
    assert.deepEqual(dashboardNativeDialogs, [], "dashboard controls never open native browser dialogs");
    await helper.locator("#close-detail").click();
    assert.equal(await detail.getAttribute("aria-modal"), "false", "closed detail drawer is no longer modal");
    assert.equal(await detail.getAttribute("data-state"), "closed", "application drawer reports its closed state");
    assert.equal(await detail.getAttribute("inert"), "", "closed detail drawer is removed from keyboard interaction");
    assert.equal(await helper.evaluate(() => document.activeElement?.classList.contains("job-card")), true, "closing details restores focus to the opening card");

    await helper.locator("[data-section='network']").click();
    assert.equal(await helper.locator("[data-scout-nav='network']").getAttribute("aria-current"), "page", "Network navigation becomes active without a reload");
    assert.equal(new URL(helper.url()).searchParams.get("section"), "network", "Network keeps a shareable dashboard URL");
    await helper.locator("#contact-search").focus();
    const searchFocusStyle = await helper.locator("#contact-search").evaluate((input) => ({
      shadow: getComputedStyle(input.closest(".search")).boxShadow,
      inputOutline: getComputedStyle(input).outlineStyle
    }));
    assert.notEqual(searchFocusStyle.shadow, "none", "search focus highlights the complete rounded search control");
    assert.equal(searchFocusStyle.inputOutline, "none", "search inputs do not draw a misaligned inner focus rectangle");
    await helper.locator("#add-contact").click();
    const contactDetail = helper.locator("#contact-detail");
    await contactDetail.waitFor({ state: "visible" });
    await helper.locator("#contact-name").fill("Casey Recruiter");
    await helper.locator("#contact-title").fill("Talent Partner");
    await helper.locator("#contact-company").fill("Fixture Labs");
    await helper.locator("#contact-email").fill("casey@example.test");
    await helper.locator("#contact-relationship").selectOption("recruiter");
    await helper.locator(`#contact-application input[value="${applicationId}"]`).check();
    assert.equal(await helper.locator("#contact-application select[multiple]").count(), 0, "contact applications avoid the native scrolling multi-select");
    assert.equal(await helper.locator("#contact-application .contact-application-option").count() > 0, true, "contact applications are exposed as readable checkable options");
    await helper.locator("#contact-notes").fill("Met during the reviewed browser fixture.");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/contact-editor.png") }); }
    await helper.locator("#contact-form button[type='submit']").click();
    await helper.waitForFunction(() => document.querySelector("#contact-detail")?.dataset.state === "closed");
    assert.equal(await contactDetail.getAttribute("inert"), "", "closed contact drawer is removed from keyboard interaction");
    const contactCard = helper.locator(".contact-card", { hasText: "Casey Recruiter" });
    await contactCard.waitFor({ state: "visible" });
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForTimeout(300); await helper.screenshot({ path: resolve(root, "output/playwright/people-workspace.png"), fullPage: true }); }
    await contactCard.click();
    await helper.locator("#log-interaction").click();
    await helper.locator("#activity-form").waitFor({ state: "visible" });
    await helper.locator("#activity-type").selectOption("email");
    await helper.locator("#activity-direction").selectOption("outbound");
    await helper.locator("#activity-next-title").fill("Check for Casey's reply");
    await helper.locator("#activity-next-date").fill("2026-08-08T09:00");
    await helper.locator("#activity-form button[type='submit']").click();
    await helper.locator("#contact-timeline", { hasText: "Email" }).waitFor({ state: "visible" });
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await helper.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("show"));
      await helper.waitForTimeout(250);
      await helper.screenshot({ path: resolve(root, "output/playwright/contact-timeline.png"), fullPage: true });
    }
    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator(".contact-card", { hasText: "Casey Recruiter" }).click();
    await helper.locator("#contact-timeline", { hasText: "Email" }).waitFor({ state: "visible" });
    assert.match(await helper.locator("#contact-timeline").textContent(), /Outbound/, "metadata-only relationship activity survives a full dashboard reload");
    const savedActivity = await worker.evaluate(async () => (await ApplyOS.getState()).contact_activities[0]);
    assert.deepEqual({ type: savedActivity.type, direction: savedActivity.direction }, { type: "email", direction: "outbound" }, "relationship history keeps reviewed event metadata");
    for (const key of ["subject", "summary", "outcome"]) assert.equal(key in savedActivity, false, `relationship activity excludes ${key}`);
    await helper.locator("#close-contact").click();
    assert.equal(await contactDetail.getAttribute("data-state"), "closed", "contact timeline drawer closes before navigating to Today");

    await helper.locator("#contacts-csv").setInputFiles({
      name: "reviewed-contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Full Name,Email Address,Organization,Job Title,Type,Labels\nCasey Recruiter,casey@example.test,Fixture Labs,Talent Partner,recruiter,existing\nRowan Referral,rowan@example.test,Fixture Labs,Engineer,referral,warm\n,missing@example.test,Fixture Labs,Recruiter,recruiter,invalid\n")
    });
    const importDialog = helper.locator("#contact-import-dialog");
    await importDialog.waitFor({ state: "visible" });
    assert.equal(await importDialog.locator("#contact-import-rows tr").count(), 3, "CSV import previews every data row before writing");
    assert.match(await importDialog.locator('[data-import-decision="0"]').inputValue(), /^merge:/, "exact email duplicates default to a reviewed merge");
    assert.equal(await importDialog.locator('[data-import-decision="2"]').isDisabled(), true, "invalid rows remain visibly skipped");
    assert.match(await importDialog.locator("#contact-import-submit").textContent(), /Import 2 contacts/);
    await importDialog.locator("#contact-import-submit").click();
    await importDialog.waitFor({ state: "hidden" });
    await helper.locator(".contact-card", { hasText: "Rowan Referral" }).waitFor({ state: "visible" });
    assert.equal(await worker.evaluate(async () => (await ApplyOS.getState()).contacts.filter((item) => item.email === "casey@example.test").length), 1, "approved CSV merge does not create a duplicate contact");
    await worker.evaluate(async () => {
      const applications = (await ApplyOS.getState()).applications;
      const lantern = applications.find((item) => item.company === "Lantern Health");
      const orbit = applications.find((item) => item.company === "Orbit Systems");
      await ApplyOS.upsertContact({ name: "Jordan Lee", title: "Hiring Manager", company: "Lantern Health", relationship: "hiring_manager", application_ids: lantern ? [lantern.id] : [], tags: ["design team"] });
      await ApplyOS.upsertContact({ name: "Sam Patel", title: "Product Lead", company: "Orbit Systems", relationship: "interviewer", application_ids: orbit ? [orbit.id] : [], tags: ["interview"] });
    });
    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator("[data-section='network']").click();
    await helper.locator(".contact-card", { hasText: "Jordan Lee" }).waitFor({ state: "visible" });
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("show")); await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/people-workspace-rich.png"), fullPage: true }); }

    await helper.locator("[data-network-view='companies']").click();
    assert.equal(new URL(helper.url()).searchParams.get("section"), "network", "Companies stays inside the shareable Network URL");
    assert.equal(new URL(helper.url()).searchParams.get("view"), "companies", "Network preserves the selected Companies view");
    const fixtureCompanyCard = helper.locator(".company-card", { hasText: "Fixture Labs" }).first();
    await fixtureCompanyCard.waitFor({ state: "visible" });
    await fixtureCompanyCard.click();
    await helper.locator("#company-domain").fill("fixture.example.test");
    await helper.locator("#company-website").fill("https://fixture.example.test");
    await helper.locator("#company-notes").fill("Browser-verified company context.");
    await helper.locator("#company-form button[type='submit']").click();
    await helper.locator("#company-context", { hasText: "Test Engineer" }).waitFor({ state: "visible" });
    await helper.locator("#company-context", { hasText: "Casey Recruiter" }).waitFor({ state: "visible" });
    assert.equal(await worker.evaluate(async () => (await ApplyOS.getState()).companies.some((item) => item.domain === "fixture.example.test" && item.notes === "Browser-verified company context.")), true, "company edits persist through the real extension store");
    await helper.locator("#close-company").click();
    await helper.locator("#add-company").click();
    await helper.locator("#company-name").fill("Browser Delete Co");
    await helper.locator("#company-domain").fill("delete.example.test");
    await helper.locator("#company-form button[type='submit']").click();
    await helper.locator("#delete-company").click();
    const deleteCompanyDialog = helper.locator(".scout-system-dialog");
    await deleteCompanyDialog.waitFor({ state: "visible" });
    await deleteCompanyDialog.locator(".scout-system-dialog__confirm").click();
    await deleteCompanyDialog.waitFor({ state: "hidden" });
    assert.equal(await worker.evaluate(async () => (await ApplyOS.getState()).companies.some((item) => item.name === "Browser Delete Co")), false, "company deletion removes only the company record");
    assert.equal(await worker.evaluate(async (id) => (await ApplyOS.getState()).applications.some((item) => item.id === id), applicationId), true, "company deletion leaves applications intact");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/companies-workspace.png"), fullPage: true }); }

    await helper.locator("[data-section='pipeline']").click();
    await helper.locator(`#board .job-card[data-id="${applicationId}"]`).click();
    await helper.locator("#mark-application-waiting").click();
    await helper.locator("#waiting-what").fill("Recruiter response on next steps");
    await helper.locator("#waiting-kind").selectOption("recruiter_reply");
    const overdueExpectedDate = await helper.evaluate(() => {
      const date = new Date(Date.now() - 86400000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      return date.toISOString().slice(0, 10);
    });
    await helper.locator("#waiting-expected").fill(overdueExpectedDate);
    await helper.locator("#waiting-notes").fill("Follow up if the promised date passes.");
    await helper.locator("#waiting-form button[type='submit']").click();
    await helper.locator("#close-waiting").click();
    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator(`#board .job-card[data-id="${applicationId}"] .waiting-chip`, { hasText: "WAITING 1" }).waitFor({ state: "visible" });
    await helper.locator("[data-section='home']").click();
    await helper.locator("#view-waiting").click();
    assert.equal(new URL(helper.url()).searchParams.get("section"), "waiting", "Waiting keeps a shareable dashboard URL");
    const overdueWaiting = helper.locator("#waiting-workspace .waiting-row", { hasText: "Recruiter response on next steps" });
    await overdueWaiting.waitFor({ state: "visible" });
    assert.equal(await overdueWaiting.locator("[data-convert-waiting]").isVisible(), true, "overdue waiting items expose follow-up conversion");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/waiting-workspace.png"), fullPage: true }); }
    await overdueWaiting.locator("[data-convert-waiting]").click();
    assert.equal(await worker.evaluate(async () => {
      const current = await ApplyOS.getState();
      return current.waiting_items.some((item) => item.what === "Recruiter response on next steps" && item.status === "resolved")
        && current.reminders.some((item) => item.title === "Follow up: Recruiter response on next steps" && item.status === "open");
    }), true, "overdue waiting conversion resolves the waiting item and creates one open follow-up");

    await helper.locator("[data-section='home']").click();
    assert.equal(await helper.locator("[data-scout-nav='home']").getAttribute("aria-current"), "page", "Home navigation becomes active without a reload");
    assert.equal(new URL(helper.url()).searchParams.has("section"), false, "Home keeps the canonical dashboard URL");
    const relationshipAction = helper.locator(".action-row", { hasText: "Check for Casey's reply" });
    await relationshipAction.waitFor({ state: "visible" });
    const snoozedActionId = await relationshipAction.getAttribute("data-action-id");
    await relationshipAction.locator(".action-row-main").click();
    await helper.locator("#action-due").fill("2026-08-09T09:00");
    await helper.locator("#action-form button[type='submit']").click();
    assert.equal(await worker.evaluate(async (id) => {
      const action = (await ApplyOS.getState()).reminders.find((item) => item.id === id);
      return new Date(action?.due_at).getTime() === new Date("2026-08-09T09:00").getTime();
    }, snoozedActionId), true, "Home reschedules an action from its focused details");
    await relationshipAction.locator("[data-action-snooze]").click();
    const snoozeDialog = helper.locator("#snooze-dialog");
    await snoozeDialog.waitFor({ state: "visible" });
    assert.equal(await snoozeDialog.getAttribute("open"), "", "Snooze uses an in-page modal instead of a browser prompt");
    assert.match(await snoozeDialog.locator("#snooze-copy").textContent(), /Check for Casey's reply/);
    await snoozeDialog.locator('[data-snooze-preset="3"]').click();
    assert.equal(await snoozeDialog.locator("#snooze-days").inputValue(), "3", "Snooze presets update the reviewed delay");
    assert.match(await snoozeDialog.locator("#snooze-preview").textContent(), /Back on your action desk/);
    if (process.env.SCOUT_CAPTURE_UI === "1") {
      await mkdir(resolve(root, "output/playwright"), { recursive: true });
      await helper.screenshot({ path: resolve(root, "output/playwright/snooze-dialog.png") });
    }
    await snoozeDialog.locator("#snooze-submit").click();
    await snoozeDialog.waitFor({ state: "hidden" });
    assert.equal(await worker.evaluate(async (id) => {
      const action = (await ApplyOS.getState()).reminders.find((item) => item.id === id);
      return Boolean(action?.snoozed_until && new Date(action.snoozed_until).getTime() > Date.now() + 2 * 86400000);
    }, snoozedActionId), true, "Snooze modal persists the selected delay");
    if (process.env.SCOUT_CAPTURE_UI === "1") { await helper.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("show")); await helper.waitForTimeout(250); await helper.screenshot({ path: resolve(root, "output/playwright/today-workspace.png") }); }
    await relationshipAction.locator("[data-action-done]").click();
    assert.equal(await worker.evaluate(async () => (await ApplyOS.getState()).reminders.some((item) => item.title === "Check for Casey's reply" && item.status === "done")), true, "Today completes a relationship action persistently");

    await helper.locator("[data-section='pipeline']").click();
    await helper.locator(`#board .job-card[data-id="${applicationId}"]`).click();
    await helper.locator("#application-contacts > summary").click();
    await helper.locator("#linked-contacts", { hasText: "Casey Recruiter" }).waitFor({ state: "visible" });
    const contactId = await worker.evaluate(async (id) => (await ApplyOS.getState()).contacts.find((item) => item.application_ids.includes(id))?.id || null, applicationId);
    assert.ok(contactId, "saved contact should be selectable for interview planning");

    await helper.locator("#application-interviews > summary").click();
    await helper.locator("#add-interview").click();
    await helper.locator("#interview-type").selectOption("technical");
    await helper.locator("#interview-format").selectOption("video");
    await helper.locator("#interview-scheduled").fill("2026-08-05T10:30");
    assert.equal(await helper.locator("#interview-create-prep").isChecked(), true, "interview preparation action is visibly reviewed before save");
    assert.equal(await helper.locator("#interview-create-thanks").isChecked(), true, "interview thank-you action is visibly reviewed before save");
    await helper.locator("#interview-contact").selectOption(contactId);
    await helper.locator("#interview-research").fill("Review the fixture product and engineering notes.");
    await helper.locator("#interview-prep").fill("Prepare a system-design story.");
    await helper.locator("#interview-questions").fill("Event-driven architecture and observability.");
    await helper.locator("#interview-next-action").fill("Send thank-you note");
    await helper.locator("#interview-next-date").fill("2026-08-06T12:00");
    await helper.locator("#interview-form button[type='submit']").click();
    const interviewCard = helper.locator("#interview-list .interview-card", { hasText: "Technical" });
    await interviewCard.waitFor({ state: "attached" });
    if (await helper.locator("#application-interviews").getAttribute("open") === null) {
      await helper.locator("#application-interviews > summary").click();
    }
    await interviewCard.waitFor({ state: "visible" });
    await interviewCard.locator("button").click();
    assert.equal(await helper.locator("#generate-thank-you").count(), 0, "interview workspace exposes actions without message drafting");
    const crmState = await worker.evaluate(async (id) => {
      const current = await ApplyOS.getState();
      return {
        contact: current.contacts.find((item) => item.application_ids.includes(id)),
        activity: current.contact_activities.find((item) => item.application_id === id),
        interview: current.interviews.find((item) => item.application_id === id),
        application: current.applications.find((item) => item.id === id)
      };
    }, applicationId);
    assert.equal(crmState.contact.email, "casey@example.test", "contact CRM persists the reviewed recipient");
    assert.deepEqual({ type: crmState.activity.type, direction: crmState.activity.direction }, { type: "email", direction: "outbound" }, "contact timeline persists metadata-only interaction history");
    for (const key of ["subject", "summary", "outcome"]) assert.equal(key in crmState.activity, false, `contact timeline excludes ${key}`);
    assert.equal(crmState.interview.preparation_notes, "Prepare a system-design story.", "interview workspace persists preparation");
    assert.equal(crmState.application.status, "interview", "saving an interview advances an active application to interview");
    await helper.locator("#close-detail").click();
    await helper.locator("[data-section='home']").click();
    await helper.locator(".action-row.is-agenda", { hasText: "Technical interview" }).waitFor({ state: "visible" });
    assert.equal(await helper.locator("#action-channel-filter").count(), 1, "Today exposes a channel filter");
    assert.equal(await helper.locator("#action-application-filter").count(), 1, "Today exposes an application filter");
    assert.equal(await helper.locator("#action-contact-filter").count(), 1, "Today exposes a contact filter");

    const backupPassword = "fixture backup password";
    const accountToolsPage = await context.newPage();
    const optionsNativeDialogs = [];
    accountToolsPage.on("dialog", async (dialog) => { optionsNativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await accountToolsPage.goto(`chrome-extension://${extensionId}/account.html`, { waitUntil: "domcontentloaded" });
    const calendarActionIds = await worker.evaluate(async () => {
      const primary = await ApplyOS.upsertAction({ kind: "custom", title: "Calendar lifecycle reminder", due_at: "2026-08-20T09:00:00.000Z", priority: "high", channel: "other", notes: "Packaged extension calendar test", source: "user" });
      const exported = await ApplyOS.upsertAction({ kind: "custom", title: "Portable calendar reminder", due_at: "2026-08-21T10:00:00.000Z", priority: "medium", channel: "other", notes: "ICS download test", source: "user" });
      return { primary: primary.id, exported: exported.id };
    });
    await accountToolsPage.locator("[data-settings-view='integrations']").click();
    await accountToolsPage.locator("#calendar-connection-label").waitFor({ state: "visible" });
    assert.match(await accountToolsPage.locator("#calendar-connection-label").textContent(), /disconnected/i, "calendar settings begin disconnected without interactive authorization");
    await accountToolsPage.locator("#calendar-connect").click();
    await accountToolsPage.waitForFunction(() => document.querySelector("#calendar-connection-state")?.textContent === "CONNECTED");
    const connectedCalendar = await worker.evaluate(() => ({ events: Object.keys(globalThis.__scoutCalendarMock.events).length, identityCalls: globalThis.__scoutCalendarMock.identityCalls }));
    assert.equal(connectedCalendar.events, 0, "connecting does not automatically export existing reminders");
    assert.equal(connectedCalendar.identityCalls.filter((call) => call.interactive).length, 1, "connect button starts the only interactive authorization request");

    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator("[data-section='home']").click();
    let calendarRow = helper.locator(".action-row", { hasText: "Calendar lifecycle reminder" });
    await calendarRow.locator(".action-row-main").click();
    await helper.locator("#action-calendar-sync").click();
    await helper.waitForFunction(() => document.querySelector("#action-calendar-status")?.textContent === "Added to Google Calendar");
    const initiallySynced = await worker.evaluate(async (id) => {
      const action = (await ApplyOS.getState()).reminders.find((item) => item.id === id);
      return { action, event: globalThis.__scoutCalendarMock.events[action.google_calendar_event_id] };
    }, calendarActionIds.primary);
    assert.equal(initiallySynced.action.calendar_sync_status, "synced", "individual reminder stores its Google event mapping");
    assert.equal(initiallySynced.event.summary, "[Scout] Calendar lifecycle reminder", "mocked Google API receives the standard Scout event");

    await helper.reload({ waitUntil: "domcontentloaded" });
    await helper.locator("[data-section='home']").click();
    calendarRow = helper.locator(".action-row", { hasText: "Calendar lifecycle reminder" });
    assert.match(await calendarRow.locator(".calendar-inline").textContent(), /calendar/i, "calendar mapping remains visible after extension reload");
    await calendarRow.locator(".action-row-main").click();
    await helper.locator("#action-title").fill("Calendar lifecycle reminder updated");
    await helper.locator("#action-due").fill("2026-08-20T14:45");
    await helper.locator("#action-form button[type='submit']").click();
    const updatedCalendar = await worker.evaluate(async (id) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const action = (await ApplyOS.getState()).reminders.find((item) => item.id === id);
        const event = globalThis.__scoutCalendarMock.events[action.google_calendar_event_id];
        if (event?.summary === "[Scout] Calendar lifecycle reminder updated") return { action, event };
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      throw new Error("Calendar event update did not arrive");
    }, calendarActionIds.primary);
    assert.equal(updatedCalendar.event.summary, "[Scout] Calendar lifecycle reminder updated", "editing a synced action updates the Google event");

    calendarRow = helper.locator(".action-row", { hasText: "Calendar lifecycle reminder updated" });
    await calendarRow.locator("[data-action-done]").click();
    const completedCalendar = await worker.evaluate(async (id) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const action = (await ApplyOS.getState()).reminders.find((item) => item.id === id);
        if (action?.status === "done" && !action.google_calendar_event_id && Object.keys(globalThis.__scoutCalendarMock.events).length === 0) return action;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      throw new Error("Completed action did not remove its calendar event");
    }, calendarActionIds.primary);
    assert.equal(completedCalendar.status, "done", "calendar deletion preserves completed Scout history");

    const exportRow = helper.locator(".action-row", { hasText: "Portable calendar reminder" });
    await exportRow.locator(".action-row-main").click();
    const icsDownloadPromise = helper.waitForEvent("download");
    await helper.locator("#action-calendar-download").click();
    const icsDownload = await icsDownloadPromise;
    assert.equal(icsDownload.suggestedFilename(), "portable-calendar-reminder.ics", "manual calendar export uses an ICS file");
    const icsContents = await readFile(await icsDownload.path(), "utf8");
    assert.match(icsContents, /BEGIN:VCALENDAR[\s\S]*TRIGGER:-PT10M[\s\S]*END:VCALENDAR/, "downloaded ICS includes a ten-minute alarm");
    await helper.reload({ waitUntil: "domcontentloaded" });
    const persistedCalendarState = await worker.evaluate(async (ids) => {
      const state = await ApplyOS.getState();
      return {
        completed: state.reminders.find((item) => item.id === ids.primary),
        exported: state.reminders.find((item) => item.id === ids.exported)
      };
    }, calendarActionIds);
    assert.equal(persistedCalendarState.completed.status, "done", "completed calendar lifecycle survives reload");
    assert.equal(persistedCalendarState.exported.status, "open", "manual ICS export never changes the Scout action");
    console.log("PASS mocked Google Calendar connect, sync, update, delete, reload, and ICS export lifecycle");

    const profileControlsPage = await context.newPage();
    profileControlsPage.on("dialog", async (dialog) => { optionsNativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await profileControlsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await profileControlsPage.locator(".profile-manager__actions button").count(), 3, "profile management exposes three compact actions without a disclosure menu");
    assert.equal(await profileControlsPage.getByRole("button", { name: "Rename active profile" }).count(), 1, "profile action icons keep explicit accessible labels");
    await profileControlsPage.locator("#new-profile").click();
    const profileDialog = profileControlsPage.locator(".scout-system-dialog");
    await profileDialog.waitFor({ state: "visible" });
    assert.equal(await profileDialog.locator("[data-scout-dialog-field]").count(), 2, "profile creation uses one reviewed in-page form instead of sequential prompts");
    await profileDialog.locator(".scout-system-dialog__cancel").click();
    await profileDialog.waitFor({ state: "hidden" });
    await profileControlsPage.close();
    assert.deepEqual(optionsNativeDialogs, [], "profile and backup controls never open native browser dialogs");
    const encryptedBackup = await accountToolsPage.evaluate((password) => ApplyOS.exportEncryptedBackup(password, "browser-test"), backupPassword);
    await accountToolsPage.locator("[data-settings-view='privacy']").click();
    await accountToolsPage.locator("#backup-password").fill(backupPassword);
    await accountToolsPage.locator("#backup-confirm").fill(backupPassword);
    const downloadPromise = accountToolsPage.waitForEvent("download");
    await accountToolsPage.locator("#export-backup").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^scout-backup-\d{4}-\d{2}-\d{2}\.scout$/, "encrypted export uses the Scout backup extension");
    await accountToolsPage.locator("#backup-file").setInputFiles({ name: "fixture.applyos", mimeType: "application/json", buffer: Buffer.from(encryptedBackup.serialized) });
    await accountToolsPage.locator("#restore-password").fill(backupPassword);
    await accountToolsPage.locator("#preview-backup").click();
    await accountToolsPage.locator("#backup-preview").waitFor({ state: "visible" });
    const backupSummary = await accountToolsPage.locator("#backup-summary").textContent();
    assert.match(backupSummary, /applications/);
    assert.match(backupSummary, /contacts/);
    assert.match(backupSummary, /interviews/);
    assert.equal(await accountToolsPage.locator("#restore-backup").isDisabled(), true, "restore stays locked before the typed confirmation");
    await accountToolsPage.locator("#restore-confirmation").fill("RESTORE");
    assert.equal(await accountToolsPage.locator("#restore-backup").isEnabled(), true, "reviewed backup can be explicitly unlocked for restore");
    await accountToolsPage.close();
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
