/* Multi-profile compatibility layer adapted from Offlyn Apply's MIT-licensed profile model. */
(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const INDEX_KEY = "profilesIndex";
  const PROFILE_PREFIX = "profile_";
  const COLORS = ["#b7ff3c", "#5c7cff", "#ff5c35", "#9f7aea", "#17b897", "#e6ad19", "#e6538c", "#667085"];

  function profileKey(id) {
    return `${PROFILE_PREFIX}${id}`;
  }

  function defaultIndex() {
    return {
      activeId: "default",
      profiles: [{ id: "default", name: "Primary", targetRole: "", color: COLORS[0], createdAt: Date.now() }]
    };
  }

  function slug(value) {
    return String(value || "profile").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "profile";
  }

  ApplyOS.ensureProfiles = async function ensureProfiles() {
    const stored = await chrome.storage.local.get([INDEX_KEY, ApplyOS.PROFILE_KEY]);
    if (stored[INDEX_KEY]?.profiles?.length) return stored[INDEX_KEY];
    const index = defaultIndex();
    const values = { [INDEX_KEY]: index };
    if (stored[ApplyOS.PROFILE_KEY]) values[profileKey("default")] = stored[ApplyOS.PROFILE_KEY];
    await chrome.storage.local.set(values);
    return index;
  };

  ApplyOS.getProfilesIndex = async function getProfilesIndex() {
    return ApplyOS.ensureProfiles();
  };

  ApplyOS.getActiveProfile = async function getActiveProfile() {
    const index = await ApplyOS.ensureProfiles();
    const stored = await chrome.storage.local.get([profileKey(index.activeId), ApplyOS.PROFILE_KEY]);
    return stored[profileKey(index.activeId)] || stored[ApplyOS.PROFILE_KEY] || {};
  };

  ApplyOS.saveActiveProfile = async function saveActiveProfile(profile) {
    const index = await ApplyOS.ensureProfiles();
    const value = { ...profile, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({
      [profileKey(index.activeId)]: value,
      [ApplyOS.PROFILE_KEY]: value
    });
    return value;
  };

  ApplyOS.getProfileById = async function getProfileById(id) {
    const stored = await chrome.storage.local.get(profileKey(id));
    return stored[profileKey(id)] || null;
  };

  ApplyOS.createProfile = async function createProfile(name, targetRole = "", cloneFromId = null) {
    const index = await ApplyOS.ensureProfiles();
    const id = `${slug(name)}_${Date.now().toString(36)}`;
    const meta = { id, name: String(name || "New profile").trim(), targetRole: String(targetRole || "").trim(), color: COLORS[index.profiles.length % COLORS.length], createdAt: Date.now() };
    let profile = {};
    if (cloneFromId) profile = await ApplyOS.getProfileById(cloneFromId) || {};
    index.profiles.push(meta);
    index.activeId = id;
    await chrome.storage.local.set({ [INDEX_KEY]: index, [profileKey(id)]: profile, [ApplyOS.PROFILE_KEY]: profile });
    return meta;
  };

  ApplyOS.setActiveProfile = async function setActiveProfile(id) {
    const index = await ApplyOS.ensureProfiles();
    if (!index.profiles.some((item) => item.id === id)) throw new Error("Profile not found");
    index.activeId = id;
    const profile = await ApplyOS.getProfileById(id) || {};
    await chrome.storage.local.set({ [INDEX_KEY]: index, [ApplyOS.PROFILE_KEY]: profile });
    return profile;
  };

  ApplyOS.updateProfileMeta = async function updateProfileMeta(id, patch) {
    const index = await ApplyOS.ensureProfiles();
    const meta = index.profiles.find((item) => item.id === id);
    if (!meta) throw new Error("Profile not found");
    Object.assign(meta, Object.fromEntries(Object.entries(patch || {}).filter(([key]) => ["name", "targetRole", "color"].includes(key))));
    await chrome.storage.local.set({ [INDEX_KEY]: index });
    return meta;
  };

  ApplyOS.deleteProfile = async function deleteProfile(id) {
    const index = await ApplyOS.ensureProfiles();
    if (index.profiles.length <= 1) throw new Error("The final profile cannot be deleted");
    index.profiles = index.profiles.filter((item) => item.id !== id);
    if (index.activeId === id) index.activeId = index.profiles[0].id;
    const active = await ApplyOS.getProfileById(index.activeId) || {};
    await chrome.storage.local.remove(profileKey(id));
    await chrome.storage.local.set({ [INDEX_KEY]: index, [ApplyOS.PROFILE_KEY]: active });
    return index;
  };

  ApplyOS.profileCompleteness = function profileCompleteness(profile = {}) {
    const fields = [
      ["First name", profile.firstName], ["Last name", profile.lastName], ["Email", profile.email], ["Phone", profile.phone],
      ["Location", profile.currentLocation || profile.city], ["LinkedIn", profile.linkedin], ["Current role", profile.currentTitle],
      ["Experience", profile.jobDescription], ["Education", profile.school], ["Resume", profile.resume?.name || profile.resumeText]
    ];
    const missing = fields.filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
    return { percentage: Math.round(((fields.length - missing.length) / fields.length) * 100), missing, complete: missing.length === 0 };
  };

  ApplyOS.profileResumeText = function profileResumeText(profile = {}) {
    if (String(profile.resumeText || "").trim()) return String(profile.resumeText).trim();
    const sections = [
      `${profile.fullName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim()}\n${[profile.email, profile.phone, profile.currentLocation].filter(Boolean).join(" · ")}`,
      profile.coverLetter ? `SUMMARY\n${profile.coverLetter}` : "",
      [profile.currentTitle, profile.currentCompany].filter(Boolean).length ? `EXPERIENCE\n${[profile.currentTitle, profile.currentCompany].filter(Boolean).join(" — ")}\n${profile.jobDescription || ""}` : "",
      profile.school ? `EDUCATION\n${[profile.degree, profile.fieldOfStudy, profile.school, profile.graduationDate].filter(Boolean).join(" · ")}` : "",
      profile.skills ? `SKILLS\n${Array.isArray(profile.skills) ? profile.skills.join(", ") : profile.skills}` : "",
      [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join("\n")
    ];
    return sections.filter(Boolean).join("\n\n").trim();
  };
})(globalThis);
