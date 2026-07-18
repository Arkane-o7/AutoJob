const ui = Object.fromEntries(["role", "company", "score", "site-label", "confidence", "record-controls", "status", "follow-up", "save", "fill", "agent", "applied", "report", "result", "profile-select", "onboarding", "ai-status"].map((id) => [id, document.getElementById(id)]));
let activeTab = null;
let profile = {};
let detectedJob = null;
let application = null;
let aiConfig = null;
let trackingRuntimeReady = true;
document.body.inert = true;

function accountGateUrl(reason) {
  const url = new URL(chrome.runtime.getURL("account.html"));
  url.searchParams.set("reason", reason);
  url.searchParams.set("returnTo", "popup");
  return url.href;
}

async function requireWorkspaceAccess() {
  let response;
  try { response = await chrome.runtime.sendMessage({ type: "APPLYOS_CLOUD_STATUS" }); }
  catch { response = null; }
  const status = response?.ok ? response.status : null;
  const ready = status?.configured === true
    && status?.migrationRequired !== true
    && (status?.workspaceReady === true || status?.offlineAuthorized === true);
  if (!ready) {
    const reason = !response?.ok ? "status-unavailable" : status?.configured !== true ? "configuration-required" : status?.migrationRequired === true ? "migration-required" : "sign-in-required";
    try {
      await chrome.tabs.create({ url: accountGateUrl(reason) });
      window.close();
    } catch {
      document.body.inert = false;
      say("Sign in to your Scout account before using autofill.", "error");
    }
    return null;
  }
  document.body.inert = false;
  return status;
}

function hasCoreProfile(value) {
  return Boolean(value?.firstName && value?.lastName && value?.email && value?.phone);
}

function say(message, tone = "") {
  ui.result.className = `result ${tone}`.trim();
  ui.result.textContent = message;
}

function dateLabel(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function populateStatuses() {
  ui.status.replaceChildren(...ApplyOS.APPLICATION_STATUSES.map((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = ApplyOS.STATUS_META[status].label;
    return option;
  }));
}

function renderRecord() {
  ui["record-controls"].classList.toggle("hidden", !application);
  if (!application) return;
  ui.status.value = application.status;
  ui["follow-up"].textContent = dateLabel(application.follow_up_date);
  ui.save.firstElementChild.textContent = "Update saved job";
  ui.applied.disabled = !hasCoreProfile(profile) || ["applied", "follow_up_due"].includes(application.status);
}

function renderDetection(job) {
  detectedJob = job;
  ui.role.value = job.role || "";
  ui.company.value = job.company || "";
  ui["site-label"].textContent = `${String(job.platform || "career page").replaceAll("_", " ")} · ${job.source}`;
  const match = ApplyOS.calculateMatch(job.description, profile);
  ui.score.querySelector("strong").textContent = job.description ? `${match.score}%` : "-";
  const confidence = Math.round((job.confidence?.overall || 0) * 100);
  const warnings = job.warnings?.join(" · ");
  ui.confidence.textContent = warnings || `${confidence}% extraction confidence. Review the editable title and company before saving.`;
  ui.confidence.classList.toggle("low", confidence < 70 || Boolean(warnings));
  ui.save.disabled = false;
  ui.fill.disabled = !hasCoreProfile(profile);
  ui.applied.disabled = !hasCoreProfile(profile);
}

function fallbackJobFromTab(tab, reason) {
  let source = "unknown";
  try { source = new URL(tab.url).hostname.replace(/^www\./, ""); } catch { /* Keep unknown source. */ }
  const rawTitle = String(tab.title || "").trim();
  const genericTitle = /^(?:northstarz(?:\.ai)?|linkedin|workday|greenhouse|lever|ashby|wellfound|job application|apply)$/i.test(rawTitle);
  return {
    company: "",
    role: genericTitle ? "" : rawTitle,
    url: ApplyOS.canonicalizeUrl(tab.url),
    source,
    platform: source.includes("northstarz") ? "northstarz" : "career_page",
    description: "",
    location: "",
    deadline: null,
    skills: [],
    keywords: [],
    confidence: { company: 0, role: genericTitle ? 0 : 0.35, description: 0, location: 0, deadline: 0, overall: 0 },
    warnings: [reason || "Automatic page detection was unavailable", "Enter or review the company and role before saving"],
    captured_at: ApplyOS.nowISO()
  };
}

async function restoreSavedRecord(job) {
  application = await ApplyOS.getApplicationByUrl(job.url);
  if (application) {
    if (job.description && job.description !== application.description) {
      application = await ApplyOS.upsertApplication({ ...job, company: application.company, role: application.role }, profile);
    } else {
      const refreshed = await ApplyOS.refreshApplicationMatches(profile, { applicationId: application.id });
      application = refreshed.applications[0] || application;
    }
    ui.role.value = application.role;
    ui.company.value = application.company;
    ui.score.querySelector("strong").textContent = application.description?.trim() ? `${application.match_score || 0}%` : "-";
  }
  renderRecord();
}

function currentJob() {
  return { ...detectedJob, company: ui.company.value.trim(), role: ui.role.value.trim() };
}

async function saveCurrent() {
  if (!ui.company.value.trim() || !ui.role.value.trim()) throw new Error("Review and enter both the company and role before saving.");
  application = await ApplyOS.upsertApplication(currentJob(), profile);
  renderRecord();
  return application;
}

async function startApplicationSession() {
  if (!application?.id || !activeTab?.id) return { ok: false, error: "A saved application and active job tab are required." };
  try {
    const response = await chrome.runtime.sendMessage({
      type: "APPLYOS_SESSION_START",
      tabId: activeTab.id,
      application: { id: application.id, company: application.company, role: application.role },
      platform: detectedJob?.platform || "generic",
      url: activeTab.url
    });
    if (!response?.ok) return { ok: false, error: response?.error || "The tracking worker needs to be reloaded." };
    trackingRuntimeReady = true;
    return { ok: true, session: response.session };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkTrackingRuntime() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "APPLYOS_RUNTIME_PING" });
    trackingRuntimeReady = Boolean(response?.ok && response.features?.applicationTracking);
  } catch { trackingRuntimeReady = false; }
  return trackingRuntimeReady;
}

function trackingReloadNotice(prefix) {
  return `${prefix} Application tracking needs one extension reload: open chrome://extensions, find Scout, and click Reload.`;
}

function clearApplicationSession() {
  if (!activeTab?.id) return Promise.resolve();
  return chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_CLEAR", tabId: activeTab.id }).catch(() => {});
}

async function startPopupTour() {
  if (!detectedJob) return;
  await ScoutTour.start({
    id: "popup",
    surface: "popup",
    autoStart: true,
    steps: [
      {
        target: '[data-tour-target="save-job"]',
        eyebrow: "STEP 1 · CAPTURE",
        title: "Save the opportunity.",
        body: "Review the detected company and role above, then save the job to your private application pipeline.",
        placement: "top"
      },
      {
        target: '[data-tour-target="autofill"]',
        eyebrow: "STEP 2 · AUTOFILL",
        title: "Fill what Scout knows.",
        body: "Scout fills confident empty fields and attaches your saved resume when the site allows it. You review every result.",
        placement: "top"
      },
      {
        target: '[data-tour-target="mark-applied"]',
        eyebrow: "STEP 3 · TRACK",
        title: "Confirm after you submit.",
        body: "Once you submit the application yourself, mark it applied. Scout then creates editable follow-up reminders.",
        placement: "top"
      },
      {
        target: '[data-tour-target="report-problem"]',
        eyebrow: "WHEN A SITE BREAKS",
        title: "Report the structure—not your answers.",
        body: "Review a privacy-safe field report so Scout can improve support for that site. Entered values and resume contents are excluded.",
        placement: "top",
        nextLabel: "Got it →"
      }
    ]
  });
}

async function initialize() {
  const access = await requireWorkspaceAccess();
  if (!access) return;
  populateStatuses();
  const [profilesIndex, activeProfile, config, tabs] = await Promise.all([
    ApplyOS.getProfilesIndex(), ApplyOS.getActiveProfile(), ApplyOS.getAIConfig(), chrome.tabs.query({ active: true, currentWindow: true }), checkTrackingRuntime()
  ]);
  profile = activeProfile; aiConfig = config; [activeTab] = tabs;
  ui.onboarding.textContent = ApplyOS.isOnboardingComplete(profile) ? "Edit profile" : "Finish setup";
  ui["profile-select"].replaceChildren(...profilesIndex.profiles.map((meta) => {
    const option = document.createElement("option"); option.value = meta.id; option.textContent = meta.targetRole ? `${meta.name} · ${meta.targetRole}` : meta.name; return option;
  }));
  ui["profile-select"].value = profilesIndex.activeId;
  ui["ai-status"].textContent = aiConfig.enabled ? "AI + SMART" : "SMART READY";
  ui["ai-status"].classList.add("on");
  ui.agent.classList.toggle("hidden", !aiConfig.enabled);
  ui.agent.disabled = !aiConfig.enabled || !hasCoreProfile(profile);
  await ApplyOS.ensureState();
  if (!activeTab?.id) {
    ui.confidence.textContent = "Open a job posting or application page to capture it.";
    ui.report.disabled = true;
    return;
  }
  ui.fill.disabled = !hasCoreProfile(profile);
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "APPLYOS_DETECT_JOB" }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error || "Page detection failed");
    // Chrome intentionally withholds a tab's URL when the extension does not
    // request broad tab access. The content script is already running on the
    // page, so its canonical capture is the authoritative URL for this action.
    activeTab.url = response.job?.url || activeTab.url || "";
    renderDetection(response.job);
    await restoreSavedRecord(response.job);
    if (!hasCoreProfile(profile)) say("Set up your profile before autofilling. You can still save this job.");
    else if (!trackingRuntimeReady) say(trackingReloadNotice("Scout was updated."), "error");
  } catch (error) {
    const reason = error.message.includes("Receiving end does not exist") || error.message === "Page detection failed"
      ? "This tab needs one refresh for automatic detection"
      : "Automatic page detection was unavailable";
    const fallback = fallbackJobFromTab(activeTab, reason);
    renderDetection(fallback);
    await restoreSavedRecord(fallback);
    say("Autofill is still available. Refresh this job tab once to restore automatic company and role detection.");
  }
  await startPopupTour();
}

ui.save.addEventListener("click", async () => {
  ui.save.disabled = true;
  try {
    await saveCurrent();
    const tracking = await startApplicationSession();
    say(tracking.ok ? "Saved to your Scout dashboard." : trackingReloadNotice("Saved to your dashboard."), tracking.ok ? "success" : "error");
  }
  catch (error) { say(error.message, "error"); }
  finally { ui.save.disabled = false; }
});

ui.agent.addEventListener("click", async () => {
  if (!aiConfig?.enabled) { say("Connect Ollama in Setup before using the local-AI pass."); return; }
  ui.agent.disabled = true; say("Local AI is reviewing empty, non-sensitive fields…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "APPLYOS_AGENT_TAB", tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error || "Local AI pass failed.");
    const report = response.report;
    say(`AI filled ${report.filled} field${report.filled === 1 ? "" : "s"}; ${report.skipped} left for you. Review every answer before continuing.`, report.filled ? "success" : "");
  } catch (error) { say(error.message, "error"); }
  finally { ui.agent.disabled = false; }
});

ui.fill.addEventListener("click", async () => {
  if (!hasCoreProfile(profile)) { chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?quick=1") }); return; }
  say("Reading the visible form…");
  ui.fill.disabled = true;
  try {
    if (!application && ui.company.value.trim() && ui.role.value.trim()) await saveCurrent();
    const tracking = application ? await startApplicationSession() : { ok: true, skipped: true };
    const response = await chrome.runtime.sendMessage({ type: "APPLYOS_FILL_TAB", tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error || "This page could not be filled.");
    const { filled, attached, scanned, unmatchedRequired = 0, missingProfileFields = [], resumeStatus = "not-found", site = "This form" } = response.report;
    const missingProfile = missingProfileFields.length ? ` Add ${missingProfileFields.join(", ")} in Profile & Settings.` : "";
    const resultMessage = resumeStatus === "missing"
      ? `${site}: found the resume upload field, but no resume is saved. Add one in Profile & Settings.`
      : resumeStatus === "failed"
        ? `${site}: found the resume upload field but could not attach the saved file. Attach it manually and review the form.`
        : filled || attached
      ? `${site}: filled ${filled} field${filled === 1 ? "" : "s"}${attached ? ` and attached ${attached} resume` : ""}. Review every answer before submitting.${missingProfile}`
      : `No confident matches among ${scanned} visible fields. ${unmatchedRequired} required field${unmatchedRequired === 1 ? "" : "s"} still need review.${missingProfile}`;
    say(tracking.ok ? resultMessage : trackingReloadNotice(resultMessage), tracking.ok && (filled || attached) ? "success" : resumeStatus === "failed" || resumeStatus === "missing" || !tracking.ok ? "error" : "");
  } catch (error) { say(error.message, "error"); }
  finally { ui.fill.disabled = false; }
});

ui.report.addEventListener("click", async () => {
  if (!activeTab?.id) return;
  ui.report.disabled = true;
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "APPLYOS_REPORT_BROKEN" }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error || "Could not open the report review.");
    say("Select the broken fields and review the sanitized payload. Nothing is shared until you explicitly send the private report.", "success");
  } catch (error) { say(error.message, "error"); }
  finally { ui.report.disabled = false; }
});

ui.applied.addEventListener("click", async () => {
  ui.applied.disabled = true;
  try {
    if (!application) await saveCurrent();
    application = await ApplyOS.markApplicationApplied(application.id);
    await clearApplicationSession();
    renderRecord();
    chrome.runtime.sendMessage({ type: "APPLYOS_REFRESH_DUE" }).catch(() => {});
    say(`Marked applied. First follow-up: ${dateLabel(application.follow_up_date)}.`, "success");
  } catch (error) { say(error.message, "error"); ui.applied.disabled = false; }
});

ui.status.addEventListener("change", async () => {
  if (!application) return;
  application = ui.status.value === "applied" && !application.applied_at
    ? await ApplyOS.markApplicationApplied(application.id)
    : await ApplyOS.updateApplication(application.id, { status: ui.status.value });
  if (ui.status.value === "applied") await clearApplicationSession();
  renderRecord();
  say("Status updated.", "success");
});

ui.onboarding.addEventListener("click", () => {
  if (ApplyOS.isOnboardingComplete(profile)) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?quick=1") });
});
ui["profile-select"].addEventListener("change", async () => { await ApplyOS.setActiveProfile(ui["profile-select"].value); window.location.reload(); });
initialize().catch((error) => say(error.message, "error"));
