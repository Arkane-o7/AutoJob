(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS || {};
  const header = document.querySelector("[data-scout-header]");
  if (!header) return;

  const page = document.body.dataset.scoutPage || "";
  const profileSelect = header.querySelector("[data-scout-profile-select]");
  const statusNode = header.querySelector("[data-scout-account-state]");
  const statusText = statusNode?.querySelector("span");

  function setStatus(text, state = "online") {
    if (!statusNode || !statusText) return;
    statusNode.dataset.state = state;
    statusText.textContent = text;
  }

  function setActiveNavigation(section = "") {
    const active = section || (page === "dashboard" ? "applications" : page);
    header.querySelectorAll("[data-scout-nav]").forEach((link) => {
      const selected = link.dataset.scoutNav === active;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  async function readCloudStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "APPLYOS_CLOUD_STATUS" });
      return response?.ok ? response.status : null;
    } catch {
      return null;
    }
  }

  async function populateProfiles(status) {
    if (!profileSelect) return;
    if (!status?.workspaceReady && !status?.offlineAuthorized) {
      const option = document.createElement("option");
      option.textContent = "Sign in required";
      profileSelect.replaceChildren(option);
      profileSelect.disabled = true;
      return;
    }
    if (!chrome.storage?.local) {
      const option = document.createElement("option");
      option.textContent = "Primary";
      profileSelect.replaceChildren(option);
      profileSelect.disabled = true;
      return;
    }
    try {
      // Header rendering is intentionally read-only. Calling ensureProfiles here
      // can race first-run account migration and manufacture a default profile.
      const stored = await chrome.storage.local.get("profilesIndex");
      const index = stored.profilesIndex;
      if (!index?.profiles?.length) throw new Error("Profile index is not ready");
      const options = index.profiles.map((profile) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.targetRole ? `${profile.name} · ${profile.targetRole}` : profile.name;
        return option;
      });
      profileSelect.replaceChildren(...options);
      profileSelect.value = index.activeId;
      profileSelect.disabled = options.length < 2;
    } catch {
      const option = document.createElement("option");
      option.textContent = "Profile unavailable";
      profileSelect.replaceChildren(option);
      profileSelect.disabled = true;
    }
  }

  profileSelect?.addEventListener("change", async (event) => {
    if (typeof ApplyOS.setActiveProfile !== "function") return;
    profileSelect.disabled = true;
    try {
      await ApplyOS.setActiveProfile(event.target.value);
      location.reload();
    } catch {
      profileSelect.disabled = false;
      setStatus("Profile switch failed", "unavailable");
    }
  });

  root.ScoutHeader = Object.freeze({ setActiveNavigation, setStatus });
  setActiveNavigation(page === "dashboard" ? new URLSearchParams(location.search).get("section") || "applications" : page);

  readCloudStatus().then(async (status) => {
    if (!status?.configured) setStatus("Service unavailable", "unavailable");
    else if (status.offlineAuthorized) setStatus("Offline · cached", "offline");
    else if (!status.workspaceReady) setStatus("Sign in required", "signed-out");
    else setStatus("Private account", "online");
    await populateProfiles(status);
  });
})(globalThis);
