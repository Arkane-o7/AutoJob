/*
 * ApplyOS compatibility layer derived in part from Offlyn Apply.
 * Offlyn Apply is Copyright (c) 2026 Offlyn and licensed under the MIT License.
 * See THIRD_PARTY_NOTICES.md and licenses/OFFLYN_APPLY_MIT.txt.
 */
(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const OfflynCore = /** @type {any} */ (ApplyOS.OfflynCore = ApplyOS.OfflynCore || {});

  const PLATFORM_DOMAINS = {
    workday: ["workday.com", "myworkdayjobs.com", "myworkdaysite.com"],
    greenhouse: ["greenhouse.io"],
    lever: ["lever.co"],
    ashby: ["ashbyhq.com"],
    smartrecruiters: ["smartrecruiters.com"],
    icims: ["icims.com"],
    taleo: ["taleo.net"],
    successfactors: ["successfactors.com", "successfactors.eu"],
    jobvite: ["jobvite.com"],
    bamboohr: ["bamboohr.com"],
    workable: ["workable.com"],
    breezy: ["breezy.hr"],
    rippling: ["rippling.com"],
    oracle: ["oraclecloud.com"],
    dayforce: ["dayforce.com", "ceridian.com"],
    adp: ["adp.com"],
    paycom: ["paycom.com", "paycomonline.net"],
    paylocity: ["paylocity.com"],
    ukg: ["ultipro.com"],
    recruitee: ["recruitee.com"],
    personio: ["personio.com", "personio.de"],
    teamtailor: ["teamtailor.com"],
    microsoft: ["apply.careers.microsoft.com"],
    eightfold: ["eightfold.ai"],
    avature: ["avature.net"],
    freshteam: ["freshteam.com"],
    darwinbox: ["darwinbox.com"],
    jazzhr: ["jazz.co", "jazzhr.com"],
    fountain: ["fountain.com"],
    phenom: ["phenom.com"],
    pageup: ["pageuppeople.com"],
    linkedin: ["linkedin.com"],
    indeed: ["indeed.com"],
    wellfound: ["wellfound.com", "angel.co"]
  };

  const JOB_PATHS = [
    /\/jobs?\/[^/]+/i,
    /\/positions?\/[^/]+/i,
    /\/openings?\/[^/]+/i,
    /\/apply\b/i,
    /\/application\b/i,
    /\/careers?\/[^/]+\/[^/]+/i,
    /\/(?:join-us|work-with-us|vacancies|opportunities)\/[^/]+/i
  ];

  const SENSITIVE = /social security|\bssn\b|national id|aadhaar|passport number|date of birth|birth date|bank|credit.?card|card.?number|\bcvc\b|\bcvv\b|security.?code|payment.?method/i;
  const SELF_ID = /\bgender\b|\bsex\b|\brace\b|ethnic|veteran|disability|sexual orientation|lgbtq|religion|caste|marital status/i;
  const CONSENT = /consent|i agree|agree to|terms of|privacy policy|accept cookies|marketing communication|promotional communication/i;
  const JUNK = /^(?:select\.{0,3}|type to search|search|filter|attach|upload|choose\.{0,3}|browse|button|submit|reset|captcha|close|cancel|clear|next|back|continue|open|add|file|no file chosen)$/i;

  /** @type {Array<[string, string, RegExp, RegExp?]>} */
  const CLASSIFICATION_RULES = [
    ["firstName", "profile_field", /first name|firstname|given name|\bfname\b/i],
    ["lastName", "profile_field", /last name|lastname|surname|family name|\blname\b/i],
    ["middleName", "profile_field", /middle name|middlename/i],
    ["preferredName", "profile_field", /preferred name|goes by|nickname/i],
    ["email", "profile_field", /e-?mail(?: address)?/i],
    ["phoneCountryCode", "profile_field", /phone country|country calling code|dial(?:ing)? code/i],
    ["phone", "profile_field", /\bphone\b|\bmobile\b|\bcell\b|\btelephone\b|\btel\b/i, /country|code|extension/i],
    ["fullName", "profile_field", /full name|your name|applicant name|candidate name|legal name/i, /company|school|university|first|last|email/i],
    ["address2", "profile_field", /address line 2|address2|apartment|\bapt\b|suite|unit/i],
    ["address", "profile_field", /street address|address line 1|address1|mailing address|\baddress\b/i, /e-?mail|web|url|ip address/i],
    ["currentLocation", "profile_field", /current location|present location|where are you (?:currently )?(?:located|based)/i],
    ["city", "profile_field", /\bcity\b|\btown\b|locality|municipality/i],
    ["state", "enum_state", /\bstate\b|province|region/i, /statement|status|visa/i],
    ["postalCode", "profile_field", /postal code|postcode|zip code|zipcode|pin code/i],
    ["country", "enum_country", /country(?: of residence)?|nation of residence/i, /code|authorized|permitted|eligible|right to work|work authori[sz]ation/i],
    ["linkedin", "profile_field", /linkedin|linked-in/i],
    ["github", "profile_field", /github|git hub/i],
    ["portfolio", "profile_field", /portfolio|personal website|personal site|homepage/i],
    ["currentTitle", "profile_field", /current (?:job )?(?:role|title|position)|most recent (?:role|title|position)/i],
    ["currentCompany", "profile_field", /current (?:company|employer|organization)|most recent (?:company|employer)/i],
    ["yearsExperience", "profile_field", /years of experience|years experience|total experience/i],
    ["school", "profile_field", /university|college|school|institution/i, /currently|interested/i],
    ["degree", "profile_field", /\bdegree\b|level of education|highest education|qualification/i],
    ["fieldOfStudy", "profile_field", /major|field of study|area of study|concentration|discipline/i],
    ["graduationYear", "date_field", /graduation year|year of graduation|expected graduation/i],
    ["gpa", "profile_field", /\bgpa\b|grade point/i],
    ["visaSponsorship", "enum_auth", /(?:require|need).{0,25}sponsor|visa sponsor|sponsorship now or in the future/i],
    ["workAuthorization", "enum_auth", /legally (?:authorized|permitted)|work authori[sz]ation|eligible to work|right to work/i],
    ["employmentEligibility", "enum_auth", /employment eligibility|immigration status|work eligibility status|visa status|visa type/i],
    ["securityClearance", "enum_auth", /security clearance|clearance level/i],
    ["desiredStartDate", "date_field", /desired start date|preferred start date|when can you start|available to start/i],
    ["noticePeriod", "date_field", /notice period|notice required|required notice|availability/i],
    ["desiredSalary", "salary_field", /desired salary|salary expectation|expected salary|compensation expectation|salary requirement|desired compensation/i],
    ["currentSalary", "salary_field", /current salary|current compensation|present salary/i, /expected|desired/i],
    ["coverLetter", "long_form_company", /cover letter|covering letter|motivation letter/i],
    ["whyCompany", "long_form_company", /why .{0,30}(?:company|work (?:here|with us)|join us)|what excites you about/i],
    ["whyRole", "long_form_company", /why this (?:role|position|job|opportunity)|interested in this role/i],
    ["aboutYourself", "long_form_generic", /tell us about yourself|about yourself|describe yourself|personal statement|brief introduction/i],
    ["willingToRelocate", "enum_yes_no", /willing to relocate|open to relocation/i],
    ["travelWillingness", "enum_yes_no", /willing to travel|travel required|travel percentage/i],
    ["remotePreference", "enum_yes_no", /remote preference|work from home|hybrid|work model/i],
    ["previouslyWorkedForCompany", "enum_yes_no", /previously worked|worked here before|former employee|prior employee|ever worked for/i],
    ["jobSource", "free_text_short", /how did you hear about us|referral source|source of application/i]
  ];

  function normalize(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function domainMatches(hostname, domain) {
    const host = String(hostname || "").toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }

  OfflynCore.platformForHost = function platformForHost(hostname) {
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      if (domains.some((domain) => domainMatches(hostname, domain))) return platform;
    }
    return "company_careers";
  };

  OfflynCore.isKnownATS = function isKnownATS(hostname) {
    return OfflynCore.platformForHost(hostname) !== "company_careers";
  };

  OfflynCore.isJobUrl = function isJobUrl(value) {
    try {
      const url = new URL(value);
      const params = new URLSearchParams(url.search);
      return OfflynCore.isKnownATS(url.hostname) || JOB_PATHS.some((pattern) => pattern.test(url.pathname)) || ["gh_jid", "gh_src", "lever_origin", "lever_source", "ashby_jid"].some((key) => params.has(key));
    } catch {
      return false;
    }
  };

  OfflynCore.classifyField = function classifyField(label, inputType = "", fieldName = "") {
    const text = `${label || ""} ${fieldName || ""}`.trim();
    const type = String(inputType || "").toLowerCase();
    if (!text || JUNK.test(text) || ["hidden", "submit", "button", "reset", "image"].includes(type)) {
      return { canonicalField: null, promptType: "junk", confidence: 1, shouldAutofill: false, shouldPersist: false, reason: "junk_field" };
    }
    if (SENSITIVE.test(text) || SELF_ID.test(text) || CONSENT.test(text)) {
      return { canonicalField: null, promptType: SELF_ID.test(text) ? "enum_self_id" : "junk", confidence: 1, shouldAutofill: false, shouldPersist: false, reason: "manual_review_required" };
    }
    for (const [canonicalField, promptType, pattern, exclude] of CLASSIFICATION_RULES) {
      if (pattern.test(text) && (!exclude || !exclude.test(text))) {
        return { canonicalField, promptType, confidence: 0.94, shouldAutofill: true, shouldPersist: true, reason: "deterministic" };
      }
    }
    return { canonicalField: null, promptType: type === "textarea" ? "long_form_generic" : "free_text_short", confidence: 0.3, shouldAutofill: true, shouldPersist: false, reason: "unknown" };
  };

  OfflynCore.isTypeCompatible = function isTypeCompatible(value, promptType) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    const enumValue = new Set(["yes", "no", "true", "false", "1", "0", "n/a", "none", "other", "prefer not to say", "not applicable"]).has(lower) || lower.length <= 2;
    if (promptType === "date_field") return !enumValue && /\d|today|immediate|week|month|day/i.test(raw);
    if (promptType === "salary_field") return !enumValue && /\d|negotiable|market|competitive/i.test(raw);
    if (["enum_yes_no", "enum_auth", "enum_country", "enum_state", "enum_self_id"].includes(promptType)) return raw.length <= 120;
    if (["long_form_company", "long_form_generic"].includes(promptType)) return !enumValue;
    return true;
  };

  OfflynCore.normalizeValue = function normalizeValue(value, canonicalField, promptType) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    if (["enum_yes_no", "enum_auth"].includes(promptType)) {
      if (["yes", "true", "1", "y", "yep"].includes(raw.toLowerCase())) return "Yes";
      if (["no", "false", "0", "n", "nope"].includes(raw.toLowerCase())) return "No";
    }
    if (canonicalField === "linkedin") {
      if (/^https?:\/\/(?:www\.)?linkedin\.com\/in\//i.test(raw)) return raw.replace(/^http:/i, "https:").replace(/\/+$/, "");
      const match = raw.match(/(?:linkedin\.com\/in\/)?([A-Za-z0-9\-_%]+)/i);
      if (match) return `https://linkedin.com/in/${match[1]}`;
    }
    if (["linkedin", "github", "portfolio"].includes(canonicalField) && !/^https?:\/\//i.test(raw) && raw.includes(".")) return `https://${raw}`;
    return raw;
  };

  OfflynCore.validateFieldData = function validateFieldData(label, value, options = []) {
    const text = normalize(label);
    const raw = String(value || "").trim();
    if (!raw) return { isValid: false, reason: "empty_value" };
    if (SENSITIVE.test(text) || SELF_ID.test(text) || CONSENT.test(text)) return { isValid: false, reason: "manual_review_required" };
    if (/linkedin|github|portfolio|website|\burl\b/.test(text) && !/^https?:\/\//i.test(raw)) return { isValid: false, reason: "invalid_url" };
    if (/\bwhy\b|tell us about yourself|cover letter/.test(text) && raw.length < 20) return { isValid: false, reason: "long_answer_too_short" };
    if (options.length) {
      const normalizedValue = normalize(raw);
      const match = options.find((option) => {
        const normalizedOption = normalize(option);
        return normalizedOption === normalizedValue || normalizedOption.includes(normalizedValue) || normalizedValue.includes(normalizedOption);
      });
      if (!match) return { isValid: false, reason: "option_not_found" };
    }
    return { isValid: true };
  };

  OfflynCore.fieldFingerprint = function fieldFingerprint({ label, type, name, site, canonicalField }) {
    return [site, canonicalField || "unknown", type || "text", normalize(name), normalize(label)].join("|").slice(0, 900);
  };

  OfflynCore.bestLearnedAnswer = function bestLearnedAnswer(question, items = [], context = {}) {
    const normalizedQuestion = normalize(question);
    if (!normalizedQuestion || SENSITIVE.test(normalizedQuestion) || SELF_ID.test(normalizedQuestion) || CONSENT.test(normalizedQuestion)) return null;
    const left = new Set(normalizedQuestion.split(" ").filter((token) => token.length > 1));
    let best = null;
    for (const item of items) {
      if (!item?.answer || !item?.normalized_question) continue;
      const right = new Set(normalize(item.normalized_question).split(" ").filter((token) => token.length > 1));
      if (!right.size) continue;
      const overlap = [...left].filter((token) => right.has(token)).length / Math.max(left.size, right.size);
      const siteBonus = item.site && context.site && item.site === context.site ? 0.16 : 0;
      const typeBonus = item.field_type && context.fieldType && item.field_type === context.fieldType ? 0.08 : 0;
      const score = Math.min(1, overlap + siteBonus + typeBonus + Math.min(Number(item.use_count || 0), 5) * 0.01);
      if (!best || score > best.score) best = { ...item, score };
    }
    return best?.score >= 0.68 ? best : null;
  };

  OfflynCore.atsDomains = Object.freeze(Object.values(PLATFORM_DOMAINS).flat());
})(globalThis);
