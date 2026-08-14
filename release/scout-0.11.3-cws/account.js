const $ = (selector) => document.querySelector(selector);
const pageParams = new URLSearchParams(location.search);
document.body.classList.toggle("first-run-auth", pageParams.get("firstRun") === "1" || pageParams.get("reason") === "sign-in-required");

const ui = {
  status: null,
  authState: "loading",
  email: ""
};
let handoffScheduled = false;
let pendingRestore = null;

function setSettingsView(view, updateUrl = true) {
  const active = ["account", "reminders", "integrations", "privacy", "advanced"].includes(view) ? view : "account";
  document.querySelectorAll("[data-settings-group]").forEach((section) => section.classList.toggle("settings-section-active", section.getAttribute("data-settings-group") === active));
  document.querySelectorAll("[data-settings-view]").forEach((button) => button.setAttribute("aria-selected", String(button.getAttribute("data-settings-view") === active)));
  if (updateUrl) history.replaceState(null, "", `${location.pathname}#${active}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function maybeContinue(status) {
  // The dashboard requires a configured cloud build before it will open. Keep
  // the account page on the same side of that boundary so stale session data
  // cannot bounce the tab between account.html and dashboard.html.
  const workspaceCanOpen = status?.configured === true
    && status?.workspaceReady === true
    && status?.migrationRequired !== true
    && status?.legacyWorkspaceAvailable !== true;
  if (handoffScheduled || !workspaceCanOpen) return;
  const params = new URLSearchParams(location.search);
  const firstRun = params.get("firstRun") === "1";
  const requested = params.get("returnTo") || "";
  if (!firstRun && !requested) return;
  const allowed = /^(?:dashboard|options|onboarding)\.html(?:[?#].*)?$/.test(requested) ? requested : "";
  const profile = await ApplyOS.getActiveProfile();
  const needsOnboarding = !ApplyOS.isOnboardingComplete(profile);
  const target = needsOnboarding ? "onboarding.html?start=1" : (allowed || "dashboard.html");
  handoffScheduled = true;
  setStatus("#identity-result", needsOnboarding ? "Account ready. Opening your guided setup…" : "Workspace ready. Returning to Scout…", "success");
  setTimeout(() => location.replace(chrome.runtime.getURL(target)), 650);
}

function text(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value == null ? "" : String(value);
}

function visible(selector, show) {
  $(selector)?.classList.toggle("hidden", !show);
}

function setStatus(selector, message = "", tone = "") {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.className = `inline-status ${tone}`.trim();
}

function shouldDisable(button) {
  const id = button?.id || "";
  const configured = ui.status?.configured !== false;
  const signedIn = Boolean(ui.status?.signedIn);
  const migrationRequired = signedIn && Boolean(ui.status?.migrationRequired || ui.status?.legacyWorkspaceAvailable);
  if (["google-sign-in", "linkedin-sign-in"].includes(id) || button?.closest("#email-request-form") || button?.closest("#email-verify-form")) return !configured;
  if (id === "sign-out") return !signedIn;
  if (id === "sync-now") return !signedIn || Boolean(ui.status?.offline) || Boolean(ui.status?.workspaceOwnerMismatch) || migrationRequired;
  if (["download-cloud", "delete-account"].includes(id)) return !signedIn || migrationRequired;
  if (["import-legacy", "discard-legacy"].includes(id)) return !migrationRequired;
  return false;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.innerHTML;
  button.disabled = busy || shouldDisable(button);
  button.setAttribute("aria-busy", String(busy));
  button.innerHTML = busy ? `<span>${label || "Working…"}</span><span class="mini-spinner" aria-hidden="true"></span>` : button.dataset.label;
}

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || "Scout could not complete that request.");
  return response;
}

function workspaceToolsAvailable(status = ui.status) {
  return status?.migrationRequired !== true
    && status?.legacyWorkspaceAvailable !== true
    && (status?.workspaceReady === true || status?.offlineAuthorized === true);
}

function setBackupStatus(message, tone = "") {
  const status = $("#backup-status");
  status.textContent = message;
  status.className = tone;
}

function setCalendarOperation(message = "", tone = "") {
  const element = $("#calendar-operation-status");
  element.textContent = message;
  element.className = `calendar-operation-status${tone ? ` ${tone}` : ""}`;
}

async function sendCalendarMessage(type, details = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...details }); }
  catch (error) { return { ok: false, error: error.message }; }
}

async function refreshCalendarStatus(existingState = null) {
  const [response, state] = await Promise.all([
    sendCalendarMessage("APPLYOS_CALENDAR_STATUS"),
    existingState ? Promise.resolve(existingState) : ApplyOS.getState()
  ]);
  const connected = response?.ok && response.status?.connected === true;
  const badge = $("#calendar-connection-state");
  badge.textContent = connected ? "CONNECTED" : "DISCONNECTED";
  badge.classList.toggle("connected", connected);
  text("#calendar-connection-label", connected ? "Google Calendar connected" : "Google Calendar disconnected");
  text("#calendar-connection-detail", connected ? "Scout will use the primary calendar only." : "Connect only when you want Scout to manage calendar events.");
  visible("#calendar-connect", !connected);
  visible("#calendar-disconnect", connected);
  $("#calendar-connect").disabled = false;
  $("#calendar-disconnect").disabled = false;
  $("#calendar-sync-all").disabled = !connected;
  $("#calendar-auto-sync").checked = state.settings.calendar_auto_sync === true;
  $("#calendar-auto-sync").disabled = !connected;
  return connected;
}

function setWorkspaceToolsAvailability(status) {
  const available = workspaceToolsAvailable(status);
  for (const control of document.querySelectorAll("#backup input, #backup button")) control.toggleAttribute("disabled", !available);
  $("#restore-backup").disabled = !available || !pendingRestore || $("#restore-confirmation").value !== "RESTORE";
  $("#undo-restore").disabled = !available;
  if (!available) {
    for (const control of document.querySelectorAll("#calendar input, #calendar button")) control.toggleAttribute("disabled", true);
    text("#calendar-connection-state", "SIGN IN");
    $("#calendar-connection-state").classList.remove("connected");
    text("#calendar-connection-label", "Workspace access required");
    text("#calendar-connection-detail", "Sign in to manage Google Calendar delivery.");
    setBackupStatus("Sign in to access workspace backups.");
  }
  return available;
}

async function refreshWorkspaceTools(status) {
  if (!setWorkspaceToolsAvailability(status)) return;
  try {
    const state = await ApplyOS.getState();
    await refreshCalendarStatus(state);
    $("#enable-notifications").checked = state.settings.notification_enabled !== false;
    $("#follow-up-offsets").value = (state.settings.follow_up_offsets_days || [7, 14]).join(", ");
    $("#notification-digest-time").value = state.settings.notification_digest_time || "09:00";
    const desktopGranted = await chrome.permissions?.contains?.({ permissions: ["notifications"] }).catch(() => false);
    $("#desktop-notification-status").textContent = desktopGranted && state.settings.desktop_notifications_enabled ? "Enabled" : desktopGranted ? "Permission granted · currently off" : "Not enabled";
    $("#enable-desktop-notifications").textContent = desktopGranted && state.settings.desktop_notifications_enabled ? "Disable" : "Enable";
    const config = await ApplyOS.getAIConfig();
    $("#ai-endpoint").value = config.endpoint;
    $("#ai-model").value = config.chatModel;
    $("#embedding-model").value = config.embeddingModel;
    if (config.enabled) { $("#ai-result").textContent = `Connected · ${config.chatModel}`; $("#ai-result").className = "success"; }
    visible("#undo-restore", await ApplyOS.hasRestoreCheckpoint());
    if (!$("#backup-status").className) setBackupStatus("No backup operation running.");
  } catch (error) {
    setCalendarOperation(`Calendar status unavailable: ${error.message}`, "error");
    setBackupStatus(`Backup status unavailable: ${error.message}`, "error");
  }
}

function downloadTextFile(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backupSummaryText(summary) {
  const created = new Date(summary.created_at);
  const date = Number.isNaN(created.getTime()) ? summary.created_at : created.toLocaleString();
  return `${summary.profiles} profiles · ${summary.applications} applications · ${summary.contacts} contacts · ${summary.actions || 0} open actions · ${summary.activities || 0} interactions · ${summary.interviews} interviews · ${summary.answers} remembered answers · Created ${date} with Scout ${summary.extension_version}`;
}

function formatTime(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

function conflictRecordName(conflict = {}) {
  const payload = { ...(conflict.serverPayload || {}), ...(conflict.localPayload || {}) };
  const type = String(conflict.entityType || "record").replace(/_/g, " ");
  if (conflict.entityType === "application") {
    const role = String(payload.role || "").trim();
    const company = String(payload.company || "").trim();
    if (role && company) return `${role} at ${company}`;
    if (role || company) return role || company;
  }
  if (conflict.entityType === "contact") return String(payload.name || [payload.first_name, payload.last_name].filter(Boolean).join(" ") || "Contact");
  if (conflict.entityType === "contact_activity") return "Contact activity";
  if (conflict.entityType === "company") return String(payload.name || "Company");
  if (conflict.entityType === "waiting_item") return String(payload.what || "Waiting item");
  if (conflict.entityType === "profile") return String(payload.profileName || payload.name || "Profile");
  if (conflict.entityType === "interview") return String(payload.title || payload.type || "Interview");
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function versionTime(primary, payload = {}) {
  return primary || payload.updated_at || payload.updatedAt || null;
}

function renderLegacySummary(summary = {}) {
  const labels = { applications: "Applications", profiles: "Profiles", answers: "Saved answers", contacts: "Contacts", companies: "Companies", waiting: "Waiting", interviews: "Interviews", reminders: "Reminders", resumeVersions: "Resume versions", settings: "Settings" };
  const entries = Object.entries(summary || {}).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0);
  $("#migration-summary").replaceChildren(...entries.map(([key, value]) => {
    const item = document.createElement("div");
    const count = document.createElement("b");
    const label = document.createElement("span");
    count.textContent = String(value);
    label.textContent = labels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2");
    item.append(count, label);
    return item;
  }));
  if (!entries.length) {
    const item = document.createElement("div");
    item.className = "wide-record";
    item.textContent = "Scout found an existing browser workspace. Detailed counts are not available in this version.";
    $("#migration-summary").append(item);
  }
}

function syncView(status) {
  if (!status?.configured) return { label: "UNAVAILABLE", tone: "error", detail: "This Scout build is missing its production cloud configuration. Please reinstall or contact Scout support." };
  if (!status.signedIn) return { label: "SIGN IN", tone: "neutral", detail: "Sign in to connect your private workspace." };
  if (status.workspaceOwnerMismatch) return { label: "LOCKED", tone: "error", detail: "This browser contains a cached workspace for another account. Scout stopped syncing to prevent data from mixing." };
  if (status.offline || status.sync?.status === "offline") return { label: "OFFLINE", tone: "warning", detail: "You are offline. Saved changes stay queued for this account and will sync after you reconnect." };
  if (status.sync?.error || status.sync?.status === "error") return { label: "ACTION REQUIRED", tone: "error", detail: status.sync.error || "Scout could not sync this workspace. Try again." };
  if (status.sync?.conflict) return { label: "REVIEW", tone: "warning", detail: "A sync conflict needs review. Scout has not silently replaced either copy." };
  if (Number(status.sync?.pendingCount || 0) > 0 || status.sync?.status === "pending") return { label: "PENDING", tone: "warning", detail: `${Number(status.sync?.pendingCount || 0)} change${Number(status.sync?.pendingCount || 0) === 1 ? "" : "s"} waiting to sync.` };
  if (status.sync?.status === "syncing") return { label: "SYNCING", tone: "neutral", detail: "Securely syncing your latest changes…" };
  return { label: "SYNCED", tone: "success", detail: "Your private workspace is up to date." };
}

function render(status) {
  ui.status = status || {};
  const signedIn = Boolean(status?.signedIn);
  const configured = status?.configured !== false;
  const loading = ui.authState === "loading";
  const migrationRequired = signedIn && Boolean(status?.migrationRequired || status?.legacyWorkspaceAvailable);

  visible("#auth-loading", loading);
  visible("#signed-out-actions", !loading && !signedIn);
  visible("#signed-in-actions", !loading && signedIn);

  if (loading) {
    text("#identity-title", "Checking your session…");
    text("#identity-copy", "Connecting this browser to your Scout workspace.");
  } else if (!configured) {
    text("#identity-title", "Scout needs an update");
    text("#identity-copy", "This build is missing its cloud connection. Reinstall the latest production build or contact support.");
  } else if (signedIn) {
    const user = status.user || {};
    text("#identity-title", user.name ? `Welcome, ${user.name.split(/\s+/)[0]}` : "Your account is connected");
    text("#identity-copy", "This browser is connected to your private Scout workspace.");
    text("#user-name", user.name || "Scout member");
    text("#user-email", user.email || "");
    text("#user-avatar", (user.name || user.email || "A").trim().charAt(0).toUpperCase());
  } else {
    text("#identity-title", "Sign in to Scout");
    text("#identity-copy", "Continue with Google, LinkedIn, or email.");
  }

  for (const button of [$("#google-sign-in"), $("#linkedin-sign-in")]) if (button) button.disabled = !configured;
  $("#auth-email").disabled = !configured;
  $("#email-request-form button[type='submit']").disabled = !configured;

  const view = syncView(status || {});
  text("#sync-state", view.label);
  $("#sync-state").className = `state-pill ${view.tone}`;
  text("#last-synced", formatTime(status?.sync?.lastSyncedAt));
  text("#pending-count", Number(status?.sync?.pendingCount || 0));
  text("#connection-state", !configured ? "Unavailable" : status?.offline ? "Offline" : (signedIn ? "Online" : "Sign in required"));
  text("#sync-detail", view.detail);
  $("#sync-now").disabled = !signedIn || Boolean(status?.offline) || Boolean(status?.workspaceOwnerMismatch);
  $("#sync-notice").classList.toggle("hidden", signedIn);

  visible("#migration-section", migrationRequired);
  for (const element of document.querySelectorAll(".workspace-control")) element.classList.toggle("hidden", migrationRequired);
  $("#sync-section").classList.toggle("migration-blocked", migrationRequired);
  if (migrationRequired) {
    renderLegacySummary(status?.legacySummary || {});
    $("#sync-now").disabled = true;
    text("#sync-detail", "Review the existing browser workspace before normal syncing can begin.");
  }

  for (const element of [$("#download-cloud"), $("#delete-account")]) element.disabled = !signedIn;
  setWorkspaceToolsAvailability(status);
}

function renderConflict(conflict = null) {
  visible("#conflict-panel", Boolean(conflict));
  if (!conflict) {
    for (const selector of ["#conflict-local-card", "#conflict-server-card"]) $(selector)?.classList.remove("newest");
    text("#conflict-local-badge", "");
    text("#conflict-server-badge", "");
    setStatus("#conflict-status", "");
    return;
  }
  const recordName = conflictRecordName(conflict);
  const localTimeValue = versionTime(conflict.localUpdatedAt, conflict.localPayload);
  const serverTimeValue = versionTime(conflict.serverUpdatedAt, conflict.serverPayload);
  const localTime = timestamp(localTimeValue);
  const serverTime = timestamp(serverTimeValue);
  const latest = localTime !== null && serverTime !== null
    ? (localTime > serverTime ? "local" : serverTime > localTime ? "server" : "same")
    : localTime !== null
      ? "local"
      : serverTime !== null
        ? "server"
        : "unknown";
  const localDevice = String(conflict.localDeviceLabel || "This Chrome device");
  const sameDevice = conflict.localDeviceId && conflict.serverDeviceId && conflict.localDeviceId === conflict.serverDeviceId;
  const serverDevice = sameDevice ? `${localDevice} (earlier sync)` : String(conflict.serverDeviceLabel || "Another Chrome device");

  text("#conflict-copy", `${recordName} was changed in two places. Scout paused syncing so you can choose which version to keep.`);
  text("#conflict-local-title", "Current browser");
  text("#conflict-server-title", "Synced version");
  text("#conflict-local-time", localTimeValue ? formatTime(localTimeValue) : "Time unavailable");
  text("#conflict-server-time", serverTimeValue ? formatTime(serverTimeValue) : "Time unavailable");
  text("#conflict-local-device", localDevice);
  text("#conflict-server-device", serverDevice);
  $("#conflict-local-card").classList.toggle("newest", latest === "local");
  $("#conflict-server-card").classList.toggle("newest", latest === "server");
  text("#conflict-local-badge", latest === "local" ? "NEWEST" : latest === "same" ? "SAME TIME" : "");
  text("#conflict-server-badge", latest === "server" ? "NEWEST" : latest === "same" ? "SAME TIME" : "");

  if (latest === "local") text("#conflict-recommendation", `Newest: this browser’s version, changed ${formatTime(localTimeValue)} on ${localDevice}. Choose it if that is the change you want to keep.`);
  else if (latest === "server") text("#conflict-recommendation", `Newest: the synced version, saved ${formatTime(serverTimeValue)} from ${serverDevice}. Choose it if that is the change you want to keep.`);
  else if (latest === "same") text("#conflict-recommendation", "Both versions have the same recorded time. Choose the device whose changes you recognize.");
  else text("#conflict-recommendation", "Scout could not recover the edit times for this older conflict. Choose the device whose changes you recognize.");
}

async function loadConflict(status) {
  if (!status?.sync?.conflict) { renderConflict(null); return; }
  const response = await send("APPLYOS_CLOUD_CONFLICT_GET");
  renderConflict(response.conflict || null);
}

async function refresh() {
  ui.authState = "loading";
  render(ui.status);
  try {
    const response = await send("APPLYOS_CLOUD_STATUS");
    ui.authState = response.status?.signedIn ? "signed-in" : "signed-out";
    render(response.status);
    await refreshWorkspaceTools(response.status);
    await maybeContinue(response.status);
    if (response.status?.signedIn) await loadConflict(response.status).catch((error) => setStatus("#conflict-status", error.message, "error"));
    else renderConflict(null);
  } catch (error) {
    ui.authState = "signed-out";
    render({ configured: false, signedIn: false, sync: { status: "error", error: error.message } });
    setStatus("#identity-result", error.message, "error");
  }
}

function requireAccountDataConsent() {
  const control = $("#account-data-consent");
  if (control?.checked) return true;
  setStatus("#identity-result", "Review and accept the private workspace disclosure before signing in.", "error");
  control?.focus();
  return false;
}

async function oauth(provider, button) {
  if (!requireAccountDataConsent()) return;
  setStatus("#identity-result", "");
  setBusy(button, true, provider === "google" ? "Opening Google…" : "Opening LinkedIn…");
  try {
    const response = await send("APPLYOS_AUTH_SIGN_IN_OAUTH", { provider });
    ui.authState = "signed-in";
    render(response.status);
    setStatus("#identity-result", "Signed in. Your private workspace is connecting now.", "success");
    await refresh();
  } catch (error) {
    setStatus("#identity-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

$("#google-sign-in").addEventListener("click", () => oauth("google", $("#google-sign-in")));
$("#linkedin-sign-in").addEventListener("click", () => oauth("linkedin_oidc", $("#linkedin-sign-in")));

$("#email-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAccountDataConsent()) return;
  const button = event.submitter || $("#email-request-form button[type='submit']");
  const email = $("#auth-email").value.trim().toLowerCase();
  setStatus("#identity-result", "");
  setBusy(button, true, "Sending…");
  try {
    await send("APPLYOS_AUTH_EMAIL_REQUEST", { email });
    ui.email = email;
    text("#code-destination", email);
    visible("#email-request-form", false);
    visible("#email-verify-form", true);
    $("#auth-code").focus();
    setStatus("#identity-result", "Check your email for the Scout verification code.", "success");
  } catch (error) {
    setStatus("#identity-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

$("#email-verify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter || $("#email-verify-form button[type='submit']");
  const token = $("#auth-code").value.trim();
  setStatus("#identity-result", "");
  setBusy(button, true, "Verifying…");
  try {
    const response = await send("APPLYOS_AUTH_EMAIL_VERIFY", { email: ui.email, token });
    ui.authState = "signed-in";
    render(response.status);
    setStatus("#identity-result", "Email verified. Your private workspace is connecting now.", "success");
    await refresh();
  } catch (error) {
    setStatus("#identity-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

$("#change-email").addEventListener("click", () => {
  ui.email = "";
  $("#auth-code").value = "";
  visible("#email-verify-form", false);
  visible("#email-request-form", true);
  $("#auth-email").focus();
  setStatus("#identity-result", "");
});

$("#sign-out").addEventListener("click", async () => {
  const button = $("#sign-out");
  setBusy(button, true, "Signing out…");
  setStatus("#identity-result", "");
  try {
    await send("APPLYOS_CLOUD_SIGN_OUT");
    ui.authState = "signed-out";
    render({ configured: true, signedIn: false, sync: { status: "off" } });
    setStatus("#identity-result", "Signed out. This account’s cached workspace is no longer available on this browser.", "success");
  } catch (error) {
    setStatus("#identity-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

$("#sync-now").addEventListener("click", async () => {
  const button = $("#sync-now");
  setBusy(button, true, "Syncing…");
  text("#sync-detail", "Securely syncing your workspace…");
  try {
    const response = await send("APPLYOS_CLOUD_SYNC", { force: true });
    const conflict = response.result?.status === "conflict";
    text("#sync-detail", conflict ? "A sync conflict needs review. Scout did not silently replace either copy." : "Your private workspace is up to date.");
    await refresh();
  } catch (error) {
    text("#sync-detail", error.message);
  } finally {
    setBusy(button, false);
  }
});

async function resolveConflict(strategy, button) {
  const keepingLocal = strategy === "retry_local";
  const message = keepingLocal
    ? "Use this device’s reviewed version and replace the conflicting cloud record?"
    : "Discard this device’s conflicting edit and use the cloud record?";
  if (!await ScoutDialog.confirm({ eyebrow: "SYNC CONFLICT", title: keepingLocal ? "Keep this device’s version?" : "Use the synced version?", message, consequences: [keepingLocal ? "The conflicting cloud copy will be replaced." : "This device’s conflicting edit will be discarded."], confirmLabel: keepingLocal ? "Keep this version" : "Use synced version", cancelLabel: "Review again" })) return;
  setBusy(button, true, "Resolving…");
  setStatus("#conflict-status", "Resolving and syncing this record…");
  try {
    await send("APPLYOS_CLOUD_CONFLICT_RESOLVE", { strategy });
    setStatus("#conflict-status", "Conflict resolved. Your workspace is syncing now.", "success");
    await refresh();
  } catch (error) {
    setStatus("#conflict-status", error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

$("#conflict-retry").addEventListener("click", () => resolveConflict("retry_local", $("#conflict-retry")));
$("#conflict-server-use").addEventListener("click", () => resolveConflict("use_server", $("#conflict-server-use")));

$("#import-legacy").addEventListener("click", async () => {
  const button = $("#import-legacy");
  setBusy(button, true, "Importing…");
  $("#discard-legacy").disabled = true;
  setStatus("#migration-status", "Uploading and verifying your existing workspace. Keep this page open…");
  try {
    const response = await send("APPLYOS_LEGACY_IMPORT");
    const imported = response.result?.importedSummary || response.result?.verifiedSummary;
    const total = imported && Object.values(imported).reduce((sum, value) => sum + (Number(value) || 0), 0);
    setStatus("#migration-status", total ? `Import verified: ${total} existing records are now connected to this account.` : "Import verified. Your existing workspace is now connected to this account.", "success");
    await refresh();
  } catch (error) {
    setStatus("#migration-status", `${error.message} Your browser copy was kept and you can safely try again.`, "error");
  } finally {
    setBusy(button, false);
    $("#discard-legacy").disabled = false;
  }
});

$("#discard-legacy").addEventListener("click", async () => {
  if (!await ScoutDialog.confirm({ eyebrow: "PERMANENT ACTION", title: "Discard this browser workspace?", message: "This cannot be undone unless you exported a backup.", consequences: ["The existing pre-account applications, profiles, answers, contacts, interviews, and reminders in this browser will be removed."], fields: [{ name: "confirmation", label: "Type DISCARD LEGACY WORKSPACE to continue", confirmationText: "DISCARD LEGACY WORKSPACE", placeholder: "DISCARD LEGACY WORKSPACE" }], tone: "danger", confirmLabel: "Discard workspace", cancelLabel: "Keep workspace" })) return;
  const button = $("#discard-legacy");
  setBusy(button, true, "Discarding…");
  $("#import-legacy").disabled = true;
  setStatus("#migration-status", "");
  try {
    await send("APPLYOS_LEGACY_DISCARD");
    setStatus("#migration-status", "The legacy browser workspace was discarded. Your account workspace is ready.", "success");
    await refresh();
  } catch (error) {
    setStatus("#migration-status", error.message, "error");
  } finally {
    setBusy(button, false);
    $("#import-legacy").disabled = false;
  }
});

$("#calendar-connect").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Opening Google authorization…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_CONNECT");
  button.disabled = false;
  if (!response?.ok) {
    const cancelled = response?.status?.reason === "cancelled";
    setCalendarOperation(cancelled ? "Connection cancelled. Scout reminders were not changed." : response?.error || "Google Calendar could not be connected.", cancelled ? "" : "error");
    await refreshCalendarStatus();
    return;
  }
  setCalendarOperation(response.status?.already_authorized ? "Google Calendar was already authorized." : "Google Calendar connected. Existing reminders remain unsynced until you choose Sync all.", "success");
  await refreshCalendarStatus();
});

$("#calendar-auto-sync").addEventListener("change", async (event) => {
  await ApplyOS.updateSettings({ calendar_auto_sync: event.target.checked });
  setCalendarOperation(event.target.checked ? "New open reminders will sync automatically." : "Automatic synchronization is off.", "success");
});

$("#calendar-sync-all").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Synchronizing open reminders…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_SYNC_ALL");
  button.disabled = false;
  const result = response?.result;
  if (!response?.ok) setCalendarOperation(response?.error || "Some reminders could not be synchronized.", "error");
  else setCalendarOperation(`${result.synced} open reminder${result.synced === 1 ? "" : "s"} synchronized.`, "success");
});

$("#calendar-disconnect").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setCalendarOperation("Disconnecting Google Calendar…");
  const response = await sendCalendarMessage("APPLYOS_CALENDAR_DISCONNECT");
  button.disabled = false;
  if (!response?.ok) setCalendarOperation(response?.error || "Google Calendar could not be disconnected.", "error");
  else setCalendarOperation("Disconnected. Existing Google events were left in place.", "success");
  await refreshCalendarStatus();
});

$("#export-backup").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const password = $("#backup-password").value;
  const confirmation = $("#backup-confirm").value;
  if (password !== confirmation) { setBackupStatus("Backup passwords do not match.", "error"); return; }
  button.disabled = true;
  setBackupStatus("Encrypting locally…");
  try {
    const result = await ApplyOS.exportEncryptedBackup(password, chrome.runtime.getManifest().version);
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(result.serialized, `scout-backup-${date}.scout`);
    setBackupStatus(`Encrypted backup downloaded · ${backupSummaryText(result.summary)}`, "success");
    $("#backup-password").value = "";
    $("#backup-confirm").value = "";
  } catch (error) {
    setBackupStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#preview-backup").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const file = $("#backup-file").files?.[0];
  if (!file) { setBackupStatus("Choose an encrypted Scout backup first.", "error"); return; }
  if (file.size > 64 * 1024 * 1024) { setBackupStatus("This backup is larger than the 64 MB restore limit.", "error"); return; }
  button.disabled = true;
  pendingRestore = null;
  setBackupStatus("Decrypting locally…");
  try {
    pendingRestore = await ApplyOS.decryptBackup(await file.text(), $("#restore-password").value);
    const summary = ApplyOS.backupSummary(pendingRestore);
    text("#backup-summary-title", `Scout ${summary.extension_version} backup`);
    text("#backup-summary", backupSummaryText(summary));
    $("#restore-confirmation").value = "";
    $("#restore-backup").disabled = true;
    visible("#backup-preview", true);
    setBackupStatus("Backup decrypted. Review the counts before restoring.", "success");
  } catch (error) {
    visible("#backup-preview", false);
    setBackupStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#restore-confirmation").addEventListener("input", (event) => {
  $("#restore-backup").disabled = !pendingRestore || event.target.value !== "RESTORE";
});

$("#restore-backup").addEventListener("click", async (event) => {
  if (!pendingRestore || $("#restore-confirmation").value !== "RESTORE") return;
  if (!await ScoutDialog.confirm({ eyebrow: "RESTORE CHECKPOINT", title: "Replace this browser’s Scout data?", message: "You already reviewed and unlocked this encrypted backup.", consequences: ["Current browser workspace data will be replaced.", "Scout will keep a one-step local undo checkpoint."], tone: "danger", confirmLabel: "Restore backup", cancelLabel: "Keep current data" })) return;
  const button = event.currentTarget;
  button.disabled = true;
  setBackupStatus("Restoring and validating workspace data…");
  try {
    const summary = await ApplyOS.restoreBackup(pendingRestore);
    setBackupStatus(`Restore complete · ${backupSummaryText(summary)} · Reloading…`, "success");
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) {
    setBackupStatus(`Restore failed and previous data was recovered: ${error.message}`, "error");
    button.disabled = false;
  }
});

$("#undo-restore").addEventListener("click", async (event) => {
  if (!await ScoutDialog.confirm({ eyebrow: "UNDO RESTORE", title: "Return to the previous workspace?", message: "Scout will use the local checkpoint created before your last successful restore.", confirmLabel: "Undo restore", cancelLabel: "Keep restored data" })) return;
  const button = event.currentTarget;
  button.disabled = true;
  setBackupStatus("Recovering the pre-restore checkpoint…");
  try {
    await ApplyOS.undoLastRestore();
    setBackupStatus("Previous workspace state recovered. Reloading…", "success");
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) {
    setBackupStatus(error.message, "error");
    button.disabled = false;
  }
});

$("#download-cloud").addEventListener("click", async () => {
  const button = $("#download-cloud");
  setBusy(button, true, "Preparing…");
  setStatus("#account-result", "");
  try {
    const response = await send("APPLYOS_CLOUD_SNAPSHOT");
    if (!response.snapshot) throw new Error("Your export is not available yet.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(response.snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scout-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("#account-result", "Your Scout data export was downloaded.", "success");
  } catch (error) {
    setStatus("#account-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

async function saveReminderSettings() {
  const offsets = $("#follow-up-offsets").value.split(",").map((item) => Number(item.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 60).slice(0, 4);
  if (!offsets.length) { setStatus("#reminder-status", "Add at least one day between 1 and 60.", "error"); return; }
  await ApplyOS.updateSettings({ final_follow_up_enabled: offsets.includes(14), notification_enabled: $("#enable-notifications").checked, follow_up_offsets_days: offsets, notification_digest_time: $("#notification-digest-time").value || "09:00" });
  setStatus("#reminder-status", "Reminder defaults saved.", "success");
}

[$("#follow-up-offsets"), $("#enable-notifications"), $("#notification-digest-time")].forEach((control) => control.addEventListener("change", () => saveReminderSettings().catch((error) => setStatus("#reminder-status", error.message, "error"))));

$("#enable-desktop-notifications").addEventListener("click", async () => {
  const current = await chrome.permissions.contains({ permissions: ["notifications"] });
  const state = await ApplyOS.getState();
  if (current && state.settings.desktop_notifications_enabled) {
    await ApplyOS.updateSettings({ desktop_notifications_enabled: false });
    $("#desktop-notification-status").textContent = "Disabled";
    $("#enable-desktop-notifications").textContent = "Enable";
    return;
  }
  const granted = current || await chrome.permissions.request({ permissions: ["notifications"] });
  await ApplyOS.updateSettings({ desktop_notifications_enabled: granted });
  $("#desktop-notification-status").textContent = granted ? "Enabled" : "Permission not granted";
  $("#enable-desktop-notifications").textContent = granted ? "Disable" : "Enable";
});

$("#test-ai").addEventListener("click", async (event) => {
  const button = event.currentTarget; const result = $("#ai-result"); button.disabled = true; result.className = ""; result.textContent = "Checking…";
  const endpoint = $("#ai-endpoint").value.trim();
  try {
    const origin = new URL(endpoint).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Localhost access was not granted.");
    await ApplyOS.saveAIConfig({ endpoint, chatModel: $("#ai-model").value.trim(), embeddingModel: $("#embedding-model").value.trim() });
    const status = await ApplyOS.testAIConnection(); result.className = status.success ? "success" : "error"; result.textContent = status.success ? `Connected · ${status.config.chatModel}` : status.error;
  } catch (error) { result.className = "error"; result.textContent = error.message; }
  button.disabled = false;
});

$("#replay-tour").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?start=1") }));

document.querySelectorAll("[data-settings-view]").forEach((button) => button.addEventListener("click", () => setSettingsView(button.getAttribute("data-settings-view"))));
setSettingsView(location.hash.replace("#", "") || "account", false);

$("#delete-account").addEventListener("click", async () => {
  if (!await ScoutDialog.confirm({ eyebrow: "PERMANENT ACTION", title: "Delete your Scout account?", message: "This removes the account rather than only signing you out.", consequences: ["Cloud workspace records and uploaded resume files will be deleted.", "Active sessions will end and this account’s local cache will be removed."], fields: [{ name: "confirmation", label: "Type DELETE MY SCOUT ACCOUNT to continue", confirmationText: "DELETE MY SCOUT ACCOUNT", placeholder: "DELETE MY SCOUT ACCOUNT" }], tone: "danger", confirmLabel: "Delete account", cancelLabel: "Keep my account" })) return;
  const button = $("#delete-account");
  setBusy(button, true, "Deleting…");
  setStatus("#account-result", "");
  try {
    await send("APPLYOS_CLOUD_DELETE_ACCOUNT");
    ui.authState = "signed-out";
    render({ configured: true, signedIn: false, sync: { status: "off" } });
    setStatus("#account-result", "Your Scout account and this account’s cached workspace were deleted.", "success");
  } catch (error) {
    setStatus("#account-result", error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

window.addEventListener("online", refresh);
window.addEventListener("offline", () => render({ ...ui.status, offline: true }));
refresh();
