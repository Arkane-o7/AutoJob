/**
 * Mechanical compatibility port for Offlyn Apply's MIT-licensed Workday handler.
 *
 * Usage:
 *   node scripts/port-offlyn-workday.mjs /path/to/offlyn-apply
 *
 * The generated browser script keeps Offlyn's Workday section, inline-form,
 * controlled-input, autocomplete, date, dropdown, and multi-entry logic. It
 * deliberately removes automatic Save-and-Continue navigation and wraps the
 * handler in ApplyOS's review-first API.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const repo = process.argv[2];
if (!repo) throw new Error("Pass the path to an Offlyn Apply checkout.");
const input = resolve(repo, "apps/extension-chrome/src/shared/workday-handler.ts");
const output = resolve(process.cwd(), "shared/workday.js");
let source = await readFile(input, "utf8");

source = source
  .replace(/^import[^;]+;\s*$/gm, "")
  .replace(/export type WorkdayStep\s*=\s*[\s\S]*?;\n/, "")
  .replace(/export\s+(?=(?:async\s+)?function)/g, "");

const autoAdvance = source.indexOf("  // Auto-advance:");
const clickNavigation = source.indexOf("/**\n * Click Workday", autoAdvance);
if (autoAdvance < 0 || clickNavigation < 0) throw new Error("Offlyn Workday source layout changed; review the safety patch before porting.");
source = `${source.slice(0, autoAdvance)}  return { step, reviewRequired: true, manualStep: false };\n}\n\n`;

const prelude = `/*
 * ApplyOS Workday compatibility handler.
 * Mechanically adapted from Offlyn Apply's workday-handler.ts (MIT License).
 * Automatic step navigation was removed. Inline Add/Save actions only manage
 * editable experience records; ApplyOS never clicks Save and Continue or Submit.
 */
(function (root) {
  "use strict";
  const ApplyOS = root.ApplyOS = root.ApplyOS || {};

  function setReactInputValue(element, rawValue) {
    if (!element || rawValue == null) return false;
    const value = String(rawValue);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    element.focus();
    if (setter) setter.call(element, value); else element.value = value;
    element._valueTracker?.setValue?.(value === "" ? "__applyos_reset__" : "");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    return String(element.value || "") === value || Boolean(String(element.value || "").trim());
  }

  function showWarning(title, message, duration = 10000) {
    if (window !== window.top) return;
    document.querySelector(".applyos-workday-warning")?.remove();
    const warning = document.createElement("div");
    warning.className = "applykit-toast applyos-workday-warning";
    warning.setAttribute("role", "status");
    warning.textContent = title + ": " + message;
    document.documentElement.append(warning);
    window.setTimeout(() => warning.remove(), duration);
  }

  function normalizeProfile(profile = {}) {
    const work = Array.isArray(profile.work) && profile.work.length ? profile.work : Array.isArray(profile.employment) && profile.employment.length
      ? profile.employment.map((entry) => ({ ...entry, current: entry.current ?? !entry.endDate }))
      : (profile.currentCompany || profile.currentTitle) ? [{ company: profile.currentCompany || "", title: profile.currentTitle || "", startDate: profile.employmentStartDate || "", endDate: profile.employmentEndDate || "", current: !profile.employmentEndDate, description: profile.jobDescription || "" }] : [];
    const education = Array.isArray(profile.education) && profile.education.length
      ? profile.education.map((entry) => ({ ...entry, field: entry.field || entry.fieldOfStudy || "", graduationYear: entry.graduationYear || String(entry.graduationDate || "").match(/\\b(?:19|20)\\d{2}\\b/)?.[0] || "" }))
      : profile.school ? [{ school: profile.school, degree: profile.degree || "", field: profile.fieldOfStudy || "", graduationYear: String(profile.graduationDate || "").match(/\\b(?:19|20)\\d{2}\\b/)?.[0] || "" }] : [];
    const skills = Array.isArray(profile.skills) ? profile.skills : String(profile.skills || "").split(/[,;\\n]/).map((item) => item.trim()).filter(Boolean);
    return { ...profile, work, education, skills };
  }

  function completedFieldCount() {
    return Array.from(document.querySelectorAll("input, textarea, select")).filter((element) => {
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked;
      return Boolean(String(element.value || "").trim());
    }).length;
  }
`;

const postlude = `
  const MANUAL_WORKDAY_STEPS = new Set(["Voluntary Disclosures", "Self Identify", "Review"]);
  ApplyOS.Workday = {
    isPage: isWorkdayPage,
    detectStep() {
      const name = detectWorkdayStep();
      return { name, manual: MANUAL_WORKDAY_STEPS.has(name) };
    },
    async fillVisibleStep(profile = {}) {
      const step = detectWorkdayStep();
      const before = completedFieldCount();
      if (MANUAL_WORKDAY_STEPS.has(step)) {
        if (step !== "Review") showWarning("Manual input needed", "Please complete " + step + " yourself, then review before continuing.", 15000);
        return { site: "Workday", step, filled: 0, fields: [], manualStep: true, reviewRequired: true };
      }
      await runWorkdaySpecialHandlers(normalizeProfile(profile));
      const filled = Math.max(0, completedFieldCount() - before);
      return { site: "Workday", step, filled, fields: filled ? ["Workday experience sections"] : [], manualStep: false, reviewRequired: true };
    }
  };
})(globalThis);
`;

const transpiled = ts.transpileModule(`${prelude}\n${source}\n${postlude}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: false }
}).outputText;
await writeFile(output, transpiled);
console.log(`Ported ${input} -> ${output} (${transpiled.split("\n").length} lines)`);
