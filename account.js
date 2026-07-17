const $ = (selector) => document.querySelector(selector);
let latest = null;

function show(message, tone = "") { $("#result").textContent = message; $("#result").className = `result ${tone}`.trim(); }
async function send(type, extra = {}) { const response = await chrome.runtime.sendMessage({ type, ...extra }); if (!response?.ok) throw new Error(response?.error || "ApplyOS Cloud request failed."); return response; }
function csv(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }

async function requestCloudOrigin(configuredValue = "") {
  const value = String(configuredValue || $("#project-url").value).trim();
  const origin = new URL(value).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) throw new Error("Cloud access was not granted. Local-only mode remains available.");
}

function render(status) {
  latest = status;
  const signed = status.signedIn;
  $("#identity-title").textContent = signed ? (status.user?.name || status.user?.email || "Signed in") : "Continue locally";
  $("#identity-copy").textContent = signed ? `LinkedIn sign-in connected${status.user?.email ? ` · ${status.user.email}` : ""}. No LinkedIn network data is imported.` : "Cloud is optional. Autofill, CRM, Smart Tools, and encrypted backup continue to work without an account.";
  $("#sign-in").classList.toggle("hidden", signed);
  $("#sign-out").classList.toggle("hidden", !signed);
  $("#sync-state").textContent = String(status.sync?.status || "off").toUpperCase();
  $("#sync-consent").checked = Boolean(status.sync?.enabled);
  $("#resume-consent").checked = Boolean(status.sync?.resumeFilesEnabled);
  $("#sync-detail").textContent = status.sync?.lastSyncedAt ? `Last synced ${new Date(status.sync.lastSyncedAt).toLocaleString()} · server version ${status.sync.serverVersion}` : status.sync?.conflict ? "A cloud conflict needs review. No local data was overwritten." : "No cloud sync has run.";
  if (status.workspaceOwnerMismatch) $("#sync-detail").textContent = "Account safety stop: this browser workspace belongs to a different ApplyOS account. No data was synced.";
  for (const element of [$("#sync-now"), $("#restore-cloud"), $("#undo-cloud"), $("#download-cloud"), $("#save-publication"), $("#delete-account")]) element.disabled = !signed;
  for (const element of [$("#sync-now"), $("#restore-cloud"), $("#undo-cloud"), $("#download-cloud")]) if (status.workspaceOwnerMismatch) element.disabled = true;
  $("#use-local").disabled = !signed || !status.sync?.conflict || status.workspaceOwnerMismatch;
  $("#sign-in").disabled = !status.configured;
  $("#developer-config").classList.toggle("hidden", status.configured);
  $("#developer-config").open = !status.configured;
}

async function refresh() {
  const config = await chrome.storage.local.get("applyos_cloud_config");
  $("#project-url").value = config.applyos_cloud_config?.projectUrl || "";
  $("#publishable-key").value = config.applyos_cloud_config?.publishableKey || "";
  const response = await send("APPLYOS_CLOUD_STATUS");
  render(response.status);
  if (!$("#project-url").value) $("#project-url").value = response.status.projectUrl || "";
  if (response.status.signedIn) {
    const publication = await send("APPLYOS_PUBLICATION_GET").catch(() => ({ publication: null }));
    const item = publication.publication || {};
    $("#pub-headline").value = item.headline || "";
    $("#pub-roles").value = (item.target_roles || []).join(", ");
    $("#pub-location").value = item.location || "";
    $("#pub-skills").value = (item.skills || []).join(", ");
    $("#pub-summary").value = item.experience_summary || "";
    $("#pub-portfolio").value = item.portfolio_url || "";
    $("#pub-linkedin").value = item.linkedin_url || "";
    $("#publish-consent").checked = item.visibility === "recruiters";
  }
}

$("#save-config").addEventListener("click", async () => {
  try { await requestCloudOrigin(); await send("APPLYOS_CLOUD_CONFIGURE", { config: { projectUrl: $("#project-url").value, publishableKey: $("#publishable-key").value } }); show("Cloud client configuration saved. Provider secrets remain server-side.", "success"); await refresh(); } catch (error) { show(error.message, "error"); }
});
$("#sign-in").addEventListener("click", async () => { try { await requestCloudOrigin(latest?.projectUrl); show("Opening LinkedIn sign-in…"); const response = await send("APPLYOS_CLOUD_SIGN_IN"); render(response.status); show("Signed in. Cloud sync remains off until you explicitly enable it.", "success"); await refresh(); } catch (error) { show(error.message, "error"); } });
$("#sign-out").addEventListener("click", async () => { try { const response = await send("APPLYOS_CLOUD_SIGN_OUT"); render(response.status); show("Signed out. Local data was not changed.", "success"); } catch (error) { show(error.message, "error"); } });
$("#save-sync").addEventListener("click", async () => {
  try {
    if (!latest?.signedIn && $("#sync-consent").checked) throw new Error("Sign in before enabling sync.");
    if (latest?.workspaceOwnerMismatch && $("#sync-consent").checked) throw new Error("This local workspace belongs to a different ApplyOS account. Use that account or a separate Chrome profile.");
    await send("APPLYOS_CLOUD_PREFERENCES", { enabled: $("#sync-consent").checked, includeResumes: $("#resume-consent").checked });
    show($("#sync-consent").checked ? "Private cloud sync enabled. Running the first reviewed upload…" : "Cloud sync disabled. Local data remains here.", "success");
    if ($("#sync-consent").checked) await send("APPLYOS_CLOUD_SYNC", { force: true });
    await refresh();
  } catch (error) { show(error.message, "error"); }
});
$("#sync-now").addEventListener("click", async () => { try { show("Syncing private workspace…"); const response = await send("APPLYOS_CLOUD_SYNC"); show(response.result.status === "conflict" ? "Sync paused: the cloud copy changed. Local data was not overwritten." : "Private workspace synced.", response.result.status === "conflict" ? "error" : "success"); await refresh(); } catch (error) { show(error.message, "error"); } });
$("#restore-cloud").addEventListener("click", async () => { if (!window.confirm("Replace matching local workspace records with the cloud copy? Export an encrypted backup first if you need a rollback.")) return; const confirmation = window.prompt("Type USE CLOUD COPY to confirm"); if (confirmation !== "USE CLOUD COPY") return; try { const response = await send("APPLYOS_CLOUD_RESTORE"); show(`Cloud copy restored (${response.result.restoredKeys} local data groups). Reloading…`, "success"); setTimeout(() => location.reload(), 700); } catch (error) { show(error.message, "error"); } });
$("#use-local").addEventListener("click", async () => { if (!window.confirm("Replace the conflicting cloud copy with the workspace currently in this browser?")) return; const confirmation = window.prompt("Type USE LOCAL COPY to confirm"); if (confirmation !== "USE LOCAL COPY") return; try { const response = await send("APPLYOS_CLOUD_RESOLVE_LOCAL"); show(response.result.status === "conflict" ? "The cloud changed again. Review the conflict before choosing a copy." : "The reviewed local workspace replaced the cloud copy.", response.result.status === "conflict" ? "error" : "success"); await refresh(); } catch (error) { show(error.message, "error"); } });
$("#undo-cloud").addEventListener("click", async () => { if (!window.confirm("Restore the local checkpoint created immediately before the last cloud restore?")) return; try { const response = await send("APPLYOS_CLOUD_UNDO_RESTORE"); show(`Local checkpoint restored (${response.result.restoredKeys} data groups). Reloading…`, "success"); setTimeout(() => location.reload(), 700); } catch (error) { show(error.message, "error"); } });
$("#save-publication").addEventListener("click", async () => {
  try {
    const publication = { visibility: $("#publish-consent").checked ? "recruiters" : "private", headline: $("#pub-headline").value, target_roles: csv($("#pub-roles").value), location: $("#pub-location").value, skills: csv($("#pub-skills").value), experience_summary: $("#pub-summary").value, portfolio_url: $("#pub-portfolio").value, linkedin_url: $("#pub-linkedin").value };
    await send("APPLYOS_PUBLICATION_SAVE", { publication });
    $("#publication-status").textContent = publication.visibility === "recruiters" ? "Eligible: only this reviewed card can enter the future recruiter product after it launches." : "Private: this card is excluded from future recruiter discovery.";
    show("Candidate publication saved.", "success");
  } catch (error) { show(error.message, "error"); }
});
$("#open-backup").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#backup") }));
$("#download-cloud").addEventListener("click", async () => { try { const response = await send("APPLYOS_CLOUD_SNAPSHOT"); if (!response.snapshot) throw new Error("No cloud copy is available."); const url = URL.createObjectURL(new Blob([JSON.stringify(response.snapshot, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `applyos-cloud-export-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); show("Cloud JSON exported locally.", "success"); } catch (error) { show(error.message, "error"); } });
$("#replay-tour").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html?tour=1&start=1") }));
$("#delete-account").addEventListener("click", async () => { if (!window.confirm("Permanently delete the cloud account and cloud data? Local browser data will remain.")) return; const confirmation = window.prompt("Type DELETE CLOUD ACCOUNT to confirm"); if (confirmation !== "DELETE CLOUD ACCOUNT") return; try { await send("APPLYOS_CLOUD_DELETE_ACCOUNT"); show("Cloud account deleted. Local data remains available.", "success"); await refresh(); } catch (error) { show(error.message, "error"); } });

refresh().catch((error) => show(error.message, "error"));
