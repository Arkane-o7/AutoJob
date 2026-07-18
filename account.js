const $ = (selector) => document.querySelector(selector);

const ui = {
  status: null,
  authState: "loading",
  email: ""
};
let handoffScheduled = false;

function maybeContinue(status) {
  if (handoffScheduled || !status?.workspaceReady || status?.migrationRequired || status?.legacyWorkspaceAvailable) return;
  const params = new URLSearchParams(location.search);
  const firstRun = params.get("firstRun") === "1";
  const requested = params.get("returnTo") || "";
  if (!firstRun && !requested) return;
  const allowed = /^(?:dashboard|options|onboarding)\.html(?:[?#].*)?$/.test(requested) ? requested : "";
  const target = firstRun ? "onboarding.html?start=1" : (allowed || "dashboard.html");
  handoffScheduled = true;
  setStatus("#identity-result", firstRun ? "Account ready. Opening your guided setup…" : "Workspace ready. Returning to Scout…", "success");
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
  if (conflict.entityType === "profile") return String(payload.profileName || payload.name || "Profile");
  if (conflict.entityType === "interview") return String(payload.title || payload.type || "Interview");
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function versionTime(primary, payload = {}) {
  return primary || payload.updated_at || payload.updatedAt || null;
}

function renderLegacySummary(summary = {}) {
  const labels = { applications: "Applications", profiles: "Profiles", answers: "Saved answers", contacts: "Contacts", interviews: "Interviews", reminders: "Reminders", resumeVersions: "Resume versions", settings: "Settings" };
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
    text("#identity-copy", "Choose Google, email, or LinkedIn to securely access your application workspace.");
  }

  for (const button of [$("#google-sign-in"), $("#linkedin-sign-in")]) if (button) button.disabled = !configured;
  $("#auth-email").disabled = !configured;
  $("#email-request-form button[type='submit']").disabled = !configured;

  const view = syncView(status || {});
  text("#sync-state", view.label);
  $("#sync-state").className = `state-pill ${view.tone}`;
  text("#last-synced", formatTime(status?.sync?.lastSyncedAt));
  text("#pending-count", Number(status?.sync?.pendingCount || 0));
  text("#connection-state", status?.offline ? "Offline" : (signedIn ? "Online" : "Sign in required"));
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
    maybeContinue(response.status);
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
  const prompt = keepingLocal
    ? "Use this device’s reviewed version and replace the conflicting cloud record?"
    : "Discard this device’s conflicting edit and use the cloud record?";
  if (!window.confirm(prompt)) return;
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
  if (!window.confirm("Permanently discard the existing pre-account browser workspace? This cannot be undone unless you exported a backup.")) return;
  if (window.prompt("Type DISCARD LEGACY WORKSPACE to confirm") !== "DISCARD LEGACY WORKSPACE") return;
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

$("#replay-tour").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?tour=1") }));

$("#delete-account").addEventListener("click", async () => {
  if (!window.confirm("Permanently delete your Scout account, cloud records, uploaded resumes, active sessions, and this account’s local cache?")) return;
  if (window.prompt("Type DELETE MY SCOUT ACCOUNT to confirm") !== "DELETE MY SCOUT ACCOUNT") return;
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
