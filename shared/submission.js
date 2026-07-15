(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const Submission = ApplyOS.Submission = ApplyOS.Submission || {};

  const POSITIVE = [
    /\bapplication (?:has been )?(?:successfully )?submitted\b/i,
    /\bthank you for (?:your )?(?:application|applying)\b/i,
    /\b(?:we(?:'ve| have) )?received your application\b/i,
    /\byour application (?:is|was) complete\b/i,
    /\bsuccessfully applied\b/i,
    /\bapplication received\b/i
  ];
  const MISLEADING = [
    /\bthank you for (?:reviewing|visiting|your interest in)\b/i,
    /\bbefore you submit\b/i,
    /\breview (?:and|before you) submit\b/i,
    /\bsubmit your application\b/i,
    /\bapplication questions?\b/i,
    /\bconfirm your application\b/i,
    /\bstart (?:your )?application\b/i
  ];
  const CONFIRMATION_PATH = /(?:^|\/)(?:confirmation|thank-you|thank_you|submitted|application-complete)(?:\/|$)/i;
  const CONFIRMATION_SELECTORS = {
    generic: ["#application_confirmation", ".application--confirmation", ".application-confirmation", "[data-testid*='application-confirmation' i]", "[data-testid*='application-success' i]"],
    workday: ["[data-automation-id='confirmationPage']", "[data-automation-id='applicationSubmitted']"],
    greenhouse: ["#application_confirmation", ".application--confirmation"],
    lever: [".application-confirmation", ".application-success"],
    ashby: ["[data-testid*='application-confirmation' i]", "[data-testid*='application-success' i]"],
    icims: [".iCIMS_Confirmation", "[data-testid='application-confirmation']"],
    smartrecruiters: ["[data-test='application-success']", "[data-testid='application-submitted']"],
    oracle: ["[id*='submissionConfirmation']", "[data-automation-id='submissionConfirmation']"],
    northstarz: ["[data-testid='application-success']", "[class*='application-success' i]"]
  };

  Submission.confirmationSelectors = function confirmationSelectors(platform) {
    return [...CONFIRMATION_SELECTORS.generic, ...(CONFIRMATION_SELECTORS[String(platform || "").toLowerCase()] || [])];
  };

  Submission.isSubmitIntentLabel = function isSubmitIntentLabel(value) {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    if (!label || /\b(?:next|continue|save|review|back|cancel|preview)\b/i.test(label)) return false;
    return /^(?:submit(?: application)?|send application|finish application|complete application)$/i.test(label);
  };

  Submission.scoreConfirmation = function scoreConfirmation(input = {}) {
    const heading = String(input.heading || "").slice(0, 1600);
    const title = String(input.title || "").slice(0, 400);
    const pageText = String(input.pageText || "").slice(0, 4000);
    const combined = `${heading}\n${title}\n${pageText}`;
    const positiveMatches = POSITIVE.filter((pattern) => pattern.test(combined)).length;
    const misleadingMatches = MISLEADING.filter((pattern) => pattern.test(combined)).length;
    let score = Math.min(positiveMatches * 64, 90);
    if (POSITIVE.some((pattern) => pattern.test(heading))) score += 18;
    if (POSITIVE.some((pattern) => pattern.test(title))) score += 12;
    if (input.strongSelector) score += 55;
    try { if (CONFIRMATION_PATH.test(new URL(String(input.url || "")).pathname)) score += 24; } catch { /* Invalid URLs are not confirmation evidence. */ }
    if (input.formPresent) score -= 28;
    score -= misleadingMatches * 65;
    score = Math.max(0, Math.min(100, score));
    const intentAge = Number(input.submitIntentAgeMs);
    const recentTrustedIntent = Number.isFinite(intentAge) && intentAge >= 0 && intentAge <= 30 * 60 * 1000;
    return {
      score,
      likely: recentTrustedIntent && score >= 70 && positiveMatches > 0 && misleadingMatches === 0,
      reasons: { positiveMatches, misleadingMatches, strongSelector: Boolean(input.strongSelector), recentTrustedIntent }
    };
  };

  Submission.sessionKey = function sessionKey(tabId) {
    return `tab_${Number(tabId)}`;
  };
})(globalThis);
