(() => {
  "use strict";

  const ATSCompat = globalThis.ApplyOS?.ATSCompat;
  const CONTROL_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='combobox']",
    "[role='radio']",
    "[role='checkbox']",
    "button[aria-haspopup='listbox']",
    ATSCompat?.customControlSelector
  ].filter(Boolean).join(",");

  const RULES = [
    rule("phoneCountryCode", ["phone country code", "country calling code", "dialing code", "dial code", "phone code"]),
    rule("firstName", ["first name", "firstname", "given name", "givenname", "forename", "legal first name"], ["last", "family"]),
    rule("middleName", ["middle name", "middlename", "middle initial"]),
    rule("lastName", ["last name", "lastname", "surname", "family name", "familyname", "legal last name"], ["first", "given"]),
    rule("fullName", ["full name", "fullname", "your name", "applicant name", "candidate name", "legal name", "name"], ["first", "last", "preferred", "company", "school", "university"]),
    rule("preferredName", ["preferred name", "nickname", "known as", "chosen name"]),
    rule("email", ["email address", "email", "e mail"]),
    rule("phone", ["phone number", "phone", "mobile number", "mobile", "telephone", "tel"], ["country code", "dial code", "calling code"]),
    rule("address", ["street address", "address line 1", "address1", "home address", "mailing address", "street", "address"], ["email", "web", "url", "address line 2", "address2"]),
    rule("address2", ["address line 2", "address2", "apartment", "apt suite", "suite unit"]),
    rule("currentLocation", ["current location", "present location", "where are you currently located", "where are you based"]),
    rule("city", ["city", "town", "locality", "municipality"]),
    rule("state", ["state province", "state/province", "province", "region", "state", "county"], ["statement"]),
    rule("postalCode", ["postal code", "postcode", "zip code", "zipcode", "zip", "pin code"]),
    rule("country", ["country of residence", "country region", "country", "nation"]),
    rule("linkedin", ["linkedin profile", "linkedin url", "linkedin"]),
    rule("github", ["github profile", "github url", "github"]),
    rule("portfolio", ["portfolio website", "portfolio url", "personal website", "website", "portfolio", "personal url"]),
    rule("currentCompany", ["current company", "current employer", "most recent employer", "employer", "company name", "organization"], ["desired", "hiring company", "school"]),
    rule("currentTitle", ["current job title", "current title", "most recent title", "job title", "position title", "role title"]),
    rule("employmentStartDate", ["employment start date", "job start date", "position start date", "start date", "from date"], ["available", "education", "school"]),
    rule("employmentStartMonth", ["employment start month", "start month", "from month"], ["education", "school"]),
    rule("employmentStartYear", ["employment start year", "start year", "from year"], ["education", "school", "graduation"]),
    rule("employmentEndDate", ["employment end date", "job end date", "position end date", "end date", "to date"], ["education", "school"]),
    rule("employmentEndMonth", ["employment end month", "end month", "to month"], ["education", "school"]),
    rule("employmentEndYear", ["employment end year", "end year", "to year"], ["education", "school", "graduation"]),
    rule("jobDescription", ["role description", "job description", "responsibilities", "description of duties", "position summary"]),
    rule("school", ["school name", "university name", "college name", "institution name", "school", "university", "college"]),
    rule("degree", ["degree type", "degree", "qualification", "education level"]),
    rule("fieldOfStudy", ["field of study", "major", "area of study", "discipline", "specialization", "specialisation"]),
    rule("graduationDate", ["graduation date", "education end date", "completion date"]),
    rule("graduationMonth", ["graduation month", "education end month"]),
    rule("graduationYear", ["graduation year", "year graduated", "education end year", "completion year"]),
    rule("gpa", ["grade point average", "gpa", "grade", "score"]),
    rule("yearsExperience", ["years of experience", "years experience", "total experience", "professional experience"]),
    rule("currentMonthlySalary", ["current monthly salary", "present monthly salary", "current monthly compensation"]),
    rule("currentSalary", ["current salary", "current compensation", "present salary"], ["expected", "desired"]),
    rule("desiredSalary", ["desired salary", "salary expectation", "expected salary", "expected monthly salary", "compensation expectation", "desired compensation", "salary requirements", "expected compensation"]),
    rule("salaryCurrency", ["salary currency", "compensation currency", "currency"]),
    rule("desiredStartDate", ["desired start date", "preferred start date", "when can you start"]),
    rule("noticePeriod", ["notice period", "available to start", "earliest start", "availability"], ["desired start date"]),
    rule("workAuthorization", ["legally authorized", "legally permitted to work", "authorised to work", "authorized to work", "work authorization", "right to work", "eligible to work"]),
    rule("employmentEligibility", ["employment eligibility", "option describing your employment eligibility", "immigration status", "work eligibility status"]),
    rule("visaSponsorship", ["require sponsorship", "need sponsorship", "visa sponsorship", "sponsorship now or in the future", "immigration sponsorship"]),
    rule("willingToRelocate", ["willing to relocate", "open to relocation", "relocate"]),
    rule("willingToWorkOnsite", ["willing to work from the office", "willing to work in office", "work from the office", "onsite availability"]),
    rule("remotePreference", ["remote preference", "workplace preference", "preferred work arrangement", "work model"]),
    rule("travelWillingness", ["willing to travel", "travel requirement", "travel percentage"]),
    rule("securityClearance", ["security clearance", "clearance level", "active clearance"]),
    rule("previouslyWorkedForCompany", ["ever worked for", "previously worked for", "former employee", "worked for this company", "worked for copart"]),
    rule("priorCompanyDetails", ["which copart company", "which company subcontractor or subsidiary", "if yes which company", "previous employer details"]),
    rule("knowsEmployeeAtCompany", ["related to or know anyone", "know anyone that works", "relative employed", "family member works", "employee connection"]),
    rule("employeeConnectionDetails", ["provide the name of the person", "name of the employee", "person you are related to", "referral name"]),
    rule("jobSource", ["how did you hear about us", "how did you hear about this job", "source of application", "job source"]),
    rule("coverLetter", ["cover letter", "letter of motivation", "motivation letter", "additional information", "message to hiring", "tell us about yourself"])
  ];

  const AUTOCOMPLETE_KEYS = {
    "given-name": "firstName",
    "additional-name": "middleName",
    "family-name": "lastName",
    name: "fullName",
    email: "email",
    tel: "phone",
    "tel-country-code": "phoneCountryCode",
    "street-address": "address",
    "address-line1": "address",
    "address-line2": "address2",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "postalCode",
    country: "country",
    "country-name": "country"
  };

  const BLOCKED_CONTEXT = /password|sign[ -]?in|log[ -]?in|search|credit card|card number|cvv|bank|payment|coupon|promo|one.?time.?code|otp|verification code/i;
  const SENSITIVE_CONTEXT = /social security|\bssn\b|national id|aadhaar|passport number|date of birth|birth date|gender|sex assigned|race|ethnicity|disability|veteran|religion|sexual orientation|caste|marital status|political/i;
  const CONSENT_CONTEXT = /consent|i agree|agree to|terms of|privacy policy|receive whatsapp messages|receive marketing|promotional communication/i;
  const FILE_CONTEXT = /resume|résumé|curriculum vitae|\bcv\b/i;
  const RESUME_ACCEPT_CONTEXT = /(?:^|,)\s*(?:application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|\.pdf|\.doc|\.docx)\s*(?:,|$)/i;
  const ASSIST_DURATION_MS = 30 * 60 * 1000;
  const OfflynCore = globalThis.ApplyOS?.OfflynCore;
  const shadowRoots = new Set();
  const recentFills = new WeakMap();
  const correctionTimers = new WeakMap();
  const assistFieldLedger = new Map();
  let assistObserver = null;
  let assistTimer = null;
  let assistProfile = null;
  let assistUntil = 0;
  let fillInProgress = false;

  function isMicrosoftCareers() {
    return ATSCompat?.platformForDocument?.(location.hostname, document) === "microsoft";
  }

  function rule(key, patterns, excludes = []) {
    return { key, patterns, excludes };
  }

  function normalize(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/https?:\/\//g, " ")
      .replace(/[_\-–—/:()[\]{}.,!?*'\"]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function discoverShadowRoots(root = document) {
    for (const element of root.querySelectorAll?.("*") || []) {
      if (element.shadowRoot && !shadowRoots.has(element.shadowRoot)) {
        shadowRoots.add(element.shadowRoot);
        discoverShadowRoots(element.shadowRoot);
      }
    }
  }

  function allRoots() {
    discoverShadowRoots(document);
    return [document, ...shadowRoots];
  }

  function queryAllDeep(selector) {
    const seen = new Set();
    const results = [];
    for (const root of allRoots()) {
      for (const element of root.querySelectorAll(selector)) {
        if (!seen.has(element)) {
          seen.add(element);
          results.push(element);
        }
      }
    }
    return results;
  }

  function visible(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    const type = String(element.type || "").toLowerCase();
    const role = element.getAttribute("role");
    const readonlyInteractive = ["radio", "checkbox"].includes(type) || role === "combobox" || element.getAttribute("aria-haspopup") === "listbox";
    if (element.readOnly && !readonlyInteractive) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function rootQuery(element, selector) {
    const root = element.getRootNode?.() || document;
    return root.querySelector?.(selector) || document.querySelector(selector);
  }

  function nearbyContainer(element) {
    return element.closest([
      "fieldset",
      "[role='group']",
      "[role='radiogroup']",
      ".field",
      ".form-group",
      ".application-question",
      ".jobs-easy-apply-form-element",
      "[data-automation-id*='formField']",
      "[data-testid*='field']"
    ].join(","));
  }

  function labelText(element) {
    const parts = [];
    if (element.labels) parts.push(...Array.from(element.labels, (label) => label.innerText));
    if (element.id) {
      const escaped = window.CSS?.escape ? CSS.escape(element.id) : element.id.replace(/["\\]/g, "\\$&");
      const explicit = rootQuery(element, `label[for="${escaped}"]`);
      if (explicit) parts.push(explicit.innerText);
    }
    const ariaLabelledby = element.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      ariaLabelledby.split(/\s+/).forEach((id) => parts.push(rootQuery(element, `#${window.CSS?.escape ? CSS.escape(id) : id}`)?.innerText || ""));
    }
    if (isMicrosoftCareers() && parts.some((part) => String(part || "").trim())) {
      return parts.filter(Boolean).join(" ");
    }
    const container = nearbyContainer(element);
    const legend = container?.querySelector(":scope > legend");
    if (legend) parts.push(legend.innerText);
    const nearby = container?.querySelector(":scope > label, :scope > [class*='label'], :scope > [data-automation-id*='label'], :scope > [data-testid*='label']");
    if (nearby) parts.push(nearby.innerText);
    const inferred = inferredQuestionText(element);
    if (inferred) parts.push(inferred);
    return parts.filter(Boolean).join(" ");
  }

  function inferredQuestionText(element) {
    let node = element.parentElement;
    for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
      const controlCount = node.querySelectorAll(CONTROL_SELECTOR).length;
      const directPrompt = node.querySelector(":scope > p, :scope > legend, :scope > [data-automation-id='promptQuestion'], :scope > [data-automation-id='questionText']");
      const promptText = String(directPrompt?.innerText || directPrompt?.textContent || "").trim();
      if (promptText && promptText.length <= 500 && controlCount <= 6) return promptText;

      if (["group", "radiogroup"].includes(node.getAttribute("role"))) {
        const groupPrompt = String(node.querySelector("p, legend, [data-automation-id='promptQuestion']")?.innerText || "").trim();
        if (groupPrompt && groupPrompt.length <= 500) return groupPrompt;
      }
    }
    return "";
  }

  function descriptor(element, includeValue = false) {
    const dataset = Object.values(element.dataset || {}).slice(0, 10);
    // Microsoft's closest role=group is an entire form section containing
    // several unrelated questions. Appending that section text makes answers
    // from sibling fields compete with the control's exact aria label.
    const atsContext = isMicrosoftCareers() ? "" : ATSCompat?.fieldContext?.(element);
    const values = [
      labelText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("autocomplete"),
      element.getAttribute("title"),
      element.name,
      element.id,
      ...dataset,
      atsContext,
      includeValue ? element.value : ""
    ];
    return normalize(values.filter(Boolean).join(" "));
  }

  function assistFieldKey(element) {
    const type = String(element.type || element.getAttribute("role") || element.tagName || "control").toLowerCase();
    const group = ["radio", "checkbox"].includes(type) ? element.name || "" : "";
    const stableContext = normalize([
      labelText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("autocomplete"),
      element.name,
      group
    ].filter(Boolean).join(" ")) || normalize(element.id);
    return `${type}:${stableContext}`;
  }

  function settleAssistField(element, status) {
    assistFieldLedger.set(assistFieldKey(element), { status, settledAt: Date.now() });
  }

  function isSettledAssistField(element) {
    return assistFieldLedger.has(assistFieldKey(element));
  }

  function fileInputContext(input) {
    const parts = [descriptor(input), input.getAttribute("accept") || ""];
    let node = input.parentElement;
    for (let depth = 0; depth < 4 && node; depth += 1, node = node.parentElement) {
      const fileInputs = node.querySelectorAll("input[type='file']").length;
      if (fileInputs > 2) break;
      const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 800) parts.push(text);
    }
    return normalize(parts.join(" "));
  }

  function isResumeFileInput(input) {
    const context = fileInputContext(input);
    if (FILE_CONTEXT.test(context)) return true;
    const accept = String(input.getAttribute("accept") || "").toLowerCase();
    const acceptedResumeTypes = accept.split(",").map((value) => value.trim()).filter((value) => RESUME_ACCEPT_CONTEXT.test(value));
    return acceptedResumeTypes.some((value) => value.includes("pdf"))
      && acceptedResumeTypes.some((value) => value.includes("doc"));
  }

  function canonicalLocationPart(value) {
    const trimmed = String(value || "").trim();
    const aliases = new Map([
      ["telengana", "Telangana"]
    ]);
    return aliases.get(normalize(trimmed)) || trimmed;
  }

  function locationParts(value) {
    const parts = String(value || "").split(",").map((part) => canonicalLocationPart(part)).filter(Boolean);
    if (parts.length < 3) return { city: "", state: "", country: "" };
    return {
      city: parts.slice(0, -2).join(", "),
      state: parts.at(-2) || "",
      country: parts.at(-1) || ""
    };
  }

  function flattenProfile(profile) {
    const employment = profile.employment?.[0] || {};
    const education = profile.education?.[0] || {};
    const parsedLocation = locationParts(profile.currentLocation);
    return {
      ...profile,
      address: profile.address || profile.streetAddress || "",
      address2: profile.address2 || profile.addressLine2 || "",
      city: profile.city || parsedLocation.city,
      state: canonicalLocationPart(profile.state || parsedLocation.state),
      postalCode: profile.postalCode || profile.zipCode || profile.zip || "",
      country: profile.country || parsedLocation.country,
      currentLocation: profile.currentLocation || [profile.city, profile.state, profile.country].filter(Boolean).join(", "),
      currentCompany: employment.company || profile.currentCompany,
      currentTitle: employment.title || profile.currentTitle,
      employmentStartDate: employment.startDate || profile.employmentStartDate,
      employmentStartMonth: employment.startMonth || monthFromDate(employment.startDate || profile.employmentStartDate),
      employmentStartYear: employment.startYear || yearFromDate(employment.startDate || profile.employmentStartDate),
      employmentEndDate: employment.endDate || profile.employmentEndDate,
      employmentEndMonth: employment.endMonth || monthFromDate(employment.endDate || profile.employmentEndDate),
      employmentEndYear: employment.endYear || yearFromDate(employment.endDate || profile.employmentEndDate),
      jobDescription: employment.description || profile.jobDescription,
      school: education.school || profile.school,
      degree: education.degree || profile.degree,
      fieldOfStudy: education.fieldOfStudy || profile.fieldOfStudy,
      graduationDate: education.graduationDate || profile.graduationDate,
      graduationMonth: education.graduationMonth || monthFromDate(education.graduationDate || profile.graduationDate),
      graduationYear: education.graduationYear || yearFromDate(education.graduationDate || profile.graduationDate),
      gpa: education.gpa || profile.gpa,
      desiredStartMonth: datePart(profile.desiredStartDate, "month"),
      desiredStartDay: datePart(profile.desiredStartDate, "day"),
      desiredStartYear: datePart(profile.desiredStartDate, "year"),
      priorCompanyDetails: normalize(profile.previouslyWorkedForCompany) === "no" ? "" : profile.priorCompanyDetails,
      employeeConnectionDetails: normalize(profile.knowsEmployeeAtCompany) === "no" ? "" : profile.employeeConnectionDetails
    };
  }

  function missingProfileKey(element, flatProfile) {
    const context = descriptor(element);
    if (!context || BLOCKED_CONTEXT.test(context) || SENSITIVE_CONTEXT.test(context) || CONSENT_CONTEXT.test(context)) return null;
    const autocompleteKey = AUTOCOMPLETE_KEYS[normalize(element.getAttribute("autocomplete"))];
    if (autocompleteKey && !hasAnswer(flatProfile[autocompleteKey])) return autocompleteKey;
    const fieldType = String(element.type || element.getAttribute("role") || element.tagName || "text").toLowerCase();
    const classification = OfflynCore?.classifyField(context, fieldType, element.name || element.id || "");
    if (classification?.shouldAutofill && classification.canonicalField && !hasAnswer(flatProfile[classification.canonicalField])) {
      return classification.canonicalField;
    }
    let best = null;
    for (const entry of RULES) {
      if (hasAnswer(flatProfile[entry.key]) || entry.excludes.some((term) => context.includes(normalize(term)))) continue;
      const score = Math.max(...entry.patterns.map((pattern) => scorePhrase(context, pattern)));
      if (score && (!best || score > best.score)) best = { key: entry.key, score };
    }
    return best?.score >= 58 ? best.key : null;
  }

  function profileFieldLabel(key) {
    return ({ address: "street address", address2: "address line 2", city: "city", state: "state / province", postalCode: "postal code", country: "country" })[key]
      || String(key || "profile details").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }

  function datePart(value, part) {
    const match = String(value || "").match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (!match) return "";
    if (part === "year") return match[1];
    if (part === "month") return String(Number(match[2]));
    return String(Number(match[3]));
  }

  function monthFromDate(value) {
    if (!value) return "";
    const match = String(value).match(/^(?:\d{4})-(\d{1,2})/);
    if (!match) return "";
    return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, Number(match[1]) - 1, 1)));
  }

  function yearFromDate(value) {
    return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
  }

  function scorePhrase(context, phrase) {
    const target = normalize(phrase);
    if (!target || !context) return 0;
    if (context === target) return 140;
    if (context.includes(target)) return 90 + Math.min(target.length, 35);
    const targetTokens = target.split(" ").filter((token) => token.length > 1);
    const contextTokens = new Set(context.split(" "));
    const matches = targetTokens.filter((token) => contextTokens.has(token)).length;
    if (matches === targetTokens.length) return 52 + matches * 8;
    return targetTokens.length > 1 && matches / targetTokens.length >= 0.75 ? 45 + matches * 6 : 0;
  }

  function customScore(context, question) {
    const exactScore = scorePhrase(context, question);
    if (exactScore) return exactScore + 25;
    const ignored = new Set(["a", "an", "and", "are", "do", "for", "have", "in", "is", "of", "or", "the", "to", "will", "you", "your"]);
    const left = new Set(normalize(context).split(" ").filter((token) => token.length > 1 && !ignored.has(token)));
    const right = new Set(normalize(question).split(" ").filter((token) => token.length > 1 && !ignored.has(token)));
    if (!left.size || !right.size) return 0;
    const overlap = [...right].filter((token) => left.has(token)).length;
    return overlap / right.size >= 0.8 ? 70 + overlap * 4 : 0;
  }

  function bestAnswer(element, flatProfile) {
    const context = descriptor(element);
    if (!context || BLOCKED_CONTEXT.test(context) || SENSITIVE_CONTEXT.test(context) || CONSENT_CONTEXT.test(context)) return null;
    const fieldType = String(element.type || element.getAttribute("role") || element.tagName || "text").toLowerCase();
    let classification = OfflynCore?.classifyField(context, fieldType, element.name || element.id || "") || {
      canonicalField: null, promptType: "free_text_short", shouldAutofill: true, shouldPersist: false, confidence: 0.3
    };
    if (!classification.shouldAutofill) return null;

    if (isMicrosoftCareers()) {
      const exactKey = /legally authorized to work/.test(context)
        ? "workAuthorization"
        : /require.{0,80}sponsorship|sponsorship.{0,80}(?:work visa|work permit|immigration)/.test(context)
          ? "visaSponsorship"
          : null;
      if (exactKey && hasAnswer(flatProfile[exactKey])) {
        classification = { ...classification, canonicalField: exactKey, promptType: "enum_auth", shouldAutofill: true, shouldPersist: true, confidence: 1 };
        return prepareAnswer(element, { key: exactKey, value: flatProfile[exactKey], score: 220, context }, classification);
      }
    }

    const learned = OfflynCore?.bestLearnedAnswer(context, flatProfile._learnedAnswers || [], {
      site: location.hostname,
      fieldType
    });
    if (learned) {
      const candidate = prepareAnswer(element, { key: `learned:${learned.id}`, value: learned.answer, score: 190, context }, classification);
      if (candidate) return candidate;
    }

    const automationId = element.getAttribute("data-automation-id") || "";
    if (context.includes("desired start date")) {
      const workdayDateKey = automationId.includes("dateSectionMonth")
        ? "desiredStartMonth"
        : automationId.includes("dateSectionDay")
          ? "desiredStartDay"
          : automationId.includes("dateSectionYear")
            ? "desiredStartYear"
            : null;
      if (workdayDateKey && hasAnswer(flatProfile[workdayDateKey])) {
        const partialDateValue = String(flatProfile[workdayDateKey]).trim();
        if (/^\d{1,4}$/.test(partialDateValue)) {
          return { key: workdayDateKey, value: partialDateValue, score: 200, context, classification };
        }
      }
    }

    const autocomplete = normalize(element.getAttribute("autocomplete"));
    const autocompleteKey = AUTOCOMPLETE_KEYS[autocomplete];
    if (autocompleteKey && hasAnswer(flatProfile[autocompleteKey])) {
      return prepareAnswer(element, { key: autocompleteKey, value: flatProfile[autocompleteKey], score: 180, context }, classification);
    }

    const classifiedValue = classification.canonicalField ? flatProfile[classification.canonicalField] : null;
    if (hasAnswer(classifiedValue)) {
      const candidate = prepareAnswer(element, { key: classification.canonicalField, value: classifiedValue, score: 165, context }, classification);
      if (candidate) return candidate;
    }

    let best = null;
    for (const entry of RULES) {
      const value = flatProfile[entry.key];
      if (!hasAnswer(value)) continue;
      if (entry.excludes.some((term) => context.includes(normalize(term)))) continue;
      const score = Math.max(...entry.patterns.map((pattern) => scorePhrase(context, pattern)));
      if (score && (!best || score > best.score)) best = { key: entry.key, value, score, context };
    }

    for (const custom of flatProfile.customAnswers || []) {
      if (!custom.question?.trim() || !custom.answer?.trim()) continue;
      const score = customScore(context, custom.question);
      if (score && (!best || score > best.score)) best = { key: `custom:${custom.question}`, value: custom.answer, score, context };
    }
    return best && best.score >= 58 ? prepareAnswer(element, best, classification) : null;
  }

  function prepareAnswer(element, answer, classification) {
    const normalizedValue = OfflynCore?.normalizeValue(answer.value, classification.canonicalField || answer.key, classification.promptType) ?? answer.value;
    if (OfflynCore && !OfflynCore.isTypeCompatible(normalizedValue, classification.promptType)) return null;
    const options = element instanceof HTMLSelectElement ? Array.from(element.options, (option) => option.textContent || option.value) : [];
    const validation = OfflynCore?.validateFieldData(answer.context, normalizedValue, options) || { isValid: true };
    if (!validation.isValid && validation.reason !== "option_not_found") return null;
    return { ...answer, value: normalizedValue, classification };
  }

  function hasAnswer(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function hasExistingValue(element) {
    const customOwner = ATSCompat?.customControlOwner?.(element);
    if (customOwner && customOwner !== element && ATSCompat.customValue(customOwner)) return true;
    if (element.matches("[role='radio'], [role='checkbox']")) return element.getAttribute("aria-checked") === "true";
    if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) return element.checked;
    if (element.isContentEditable) return Boolean(element.innerText.trim());
    if (element instanceof HTMLSelectElement) return Boolean(element.value) && element.selectedIndex > 0;
    if ("value" in element) {
      if (isMicrosoftCareers() && element.getAttribute("role") === "combobox" && element.getAttribute("aria-expanded") === "true") {
        return false;
      }
      return Boolean(String(element.value || "").trim());
    }
    if (ATSCompat?.isCustomControl?.(element)) return Boolean(ATSCompat.customValue(element));
    return false;
  }

  function dispatchValueEvents(element) {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  function setNativeValue(element, rawValue) {
    const value = formatValueForElement(element, rawValue);
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    const tracker = element._valueTracker;
    if (tracker?.setValue) tracker.setValue(value === "" ? "__applyos_reset__" : "");
    dispatchValueEvents(element);
    return String(element.value || "") === String(value) || Boolean(String(element.value || "").trim());
  }

  async function setNativeValueWithRetry(element, rawValue, retries = isMicrosoftCareers() ? 2 : 3) {
    const expected = formatValueForElement(element, rawValue);
    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (!element.isConnected) return false;
      setNativeValue(element, rawValue);
      await sleep(attempt ? 120 : 30);
      if (String(element.value || "") === String(expected)) return true;
    }
    return Boolean(String(element.value || "").trim());
  }

  function setContentEditableValue(element, value) {
    element.focus();
    element.textContent = String(value);
    dispatchValueEvents(element);
  }

  function formatValueForElement(element, rawValue) {
    const value = String(rawValue);
    if (element instanceof HTMLInputElement && element.type === "date") {
      const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (iso) return iso[0];
      const monthOnly = value.match(/\b(\d{4})-(\d{2})\b/);
      return monthOnly ? `${monthOnly[0]}-01` : value;
    }
    if (element instanceof HTMLInputElement && element.type === "month") {
      const month = value.match(/\b(\d{4})-(\d{2})\b/);
      return month ? month[0] : value;
    }
    return value;
  }

  function answerAliases(value) {
    const normalized = normalize(value);
    if (["yes", "true", "y", "1"].includes(normalized)) return ["yes", "true", "y", "authorized", "eligible", "i am authorized"];
    if (["no", "false", "n", "0"].includes(normalized)) return ["no", "false", "n", "not authorized", "i am not authorized"];
    if (normalized === "remote") return ["remote", "fully remote", "work from home"];
    if (normalized === "on site") return ["on site", "onsite", "office"];
    return [normalized];
  }

  function optionMatchScore(text, answer) {
    const normalizedText = normalize(text);
    const aliases = answerAliases(answer);
    let score = 0;
    for (const alias of aliases) {
      if (!alias) continue;
      if (normalizedText === alias) score = Math.max(score, 130);
      else if (normalize(normalizedText.replace(/^(select|choose)\s+/, "")) === alias) score = Math.max(score, 120);
      else if (alias.length > 2 && normalizedText.includes(alias)) score = Math.max(score, 82);
      else if (normalizedText.split(" ").includes(alias)) score = Math.max(score, 72);
    }
    return score;
  }

  function selectValue(element, rawValue) {
    let best = null;
    for (const option of element.options) {
      if (option.disabled || !normalize(option.value + option.textContent)) continue;
      const score = Math.max(optionMatchScore(option.value, rawValue), optionMatchScore(option.textContent, rawValue));
      if (score > (best?.score || 0)) best = { value: option.value, score };
    }
    if (!best || best.score < 72) return false;
    setNativeValue(element, best.value);
    return true;
  }

  function directChoiceText(element) {
    const directLabels = element.labels ? Array.from(element.labels, (label) => label.innerText).join(" ") : "";
    const parentText = element.closest("label")?.innerText;
    return normalize(`${directLabels} ${parentText || ""} ${element.getAttribute("aria-label") || ""} ${element.value || ""}`);
  }

  function standardChoiceCandidates(element) {
    const name = element.name;
    return queryAllDeep(`input[type="${element.type}"]`).filter((candidate) => !name || candidate.name === name).filter(visible);
  }

  function fillStandardChoice(element, answer) {
    const candidates = standardChoiceCandidates(element);
    if (element.type === "checkbox" && candidates.length === 1) {
      const wantsChecked = ["yes", "true", "y", "1", "checked"].includes(normalize(answer));
      if (element.checked !== wantsChecked) element.click();
      return element.checked === wantsChecked;
    }
    let best = null;
    for (const candidate of candidates) {
      const score = optionMatchScore(directChoiceText(candidate), answer);
      if (score > (best?.score || 0)) best = { candidate, score };
    }
    if (!best || best.score < 72) return false;
    if (!best.candidate.checked) best.candidate.click();
    return best.candidate.checked;
  }

  function ariaChoiceCandidates(element) {
    const group = element.closest("[role='radiogroup'], [role='group'], fieldset") || element.parentElement;
    const role = element.getAttribute("role");
    return Array.from(group?.querySelectorAll(`[role="${role}"]`) || [element]).filter(visible);
  }

  function fillAriaChoice(element, answer) {
    const candidates = ariaChoiceCandidates(element);
    if (element.getAttribute("role") === "checkbox" && candidates.length === 1) {
      const wantsChecked = ["yes", "true", "y", "1", "checked"].includes(normalize(answer));
      const checked = element.getAttribute("aria-checked") === "true";
      if (checked !== wantsChecked) element.click();
      return element.getAttribute("aria-checked") === String(wantsChecked);
    }
    let best = null;
    for (const candidate of candidates) {
      const score = optionMatchScore(`${candidate.getAttribute("aria-label") || ""} ${candidate.innerText || ""}`, answer);
      if (score > (best?.score || 0)) best = { candidate, score };
    }
    if (!best || best.score < 72) return false;
    if (best.candidate.getAttribute("aria-checked") !== "true") best.candidate.click();
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function chooseOpenOption(rawValue, owner) {
    const maxAttempts = isMicrosoftCareers() ? 3 : 7;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(attempt ? 120 : 70);
      const controlledId = owner?.getAttribute("aria-controls") || owner?.getAttribute("aria-owns");
      const controlled = controlledId ? rootQuery(owner, `#${window.CSS?.escape ? CSS.escape(controlledId) : controlledId}`) : null;
      const selector = [
        "[role='option']",
        "[role='listbox'] li",
        "[data-automation-id='promptOption']",
        "[data-automation-id='menuItem']",
        "[data-testid*='option']"
      ].join(",");
      const standardCandidates = controlled ? Array.from(controlled.querySelectorAll(selector)) : [];
      const adapterCandidates = ATSCompat?.optionCandidates?.(owner) || [];
      // Fluent UI renders several listboxes in portals. Never borrow an option
      // from a sibling Microsoft combobox: wait for the list referenced by this
      // control's aria-controls attribute, or fail this field safely.
      const candidates = isMicrosoftCareers()
        ? (controlledId ? standardCandidates : []).filter(visible)
        : [...new Set([...(standardCandidates.length ? standardCandidates : queryAllDeep(selector)), ...adapterCandidates])].filter(visible);
      let best = null;
      for (const candidate of candidates.slice(0, 250)) {
        const score = optionMatchScore(`${candidate.getAttribute("aria-label") || ""} ${candidate.innerText || candidate.textContent || ""}`, rawValue);
        if (score > (best?.score || 0)) best = { candidate, score };
      }
      if (best?.score >= 82) {
        best.candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
        best.candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
        best.candidate.click();
        await sleep(isMicrosoftCareers() ? 120 : 50);
        if (!isMicrosoftCareers()) return true;
        const selectedValue = String(owner?.value || "").trim();
        const selected = best.candidate.getAttribute("aria-selected") === "true"
          || (owner?.getAttribute("aria-expanded") !== "true" && optionMatchScore(selectedValue, rawValue) >= 72)
          || !owner?.isConnected;
        if (selected) return true;
      }
    }
    return false;
  }

  async function fillCustomCombobox(element, rawValue) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      element.click();
      await sleep(25);
      // Microsoft Careers comboboxes are controlled by React. Writing into the
      // input before selecting an option makes React clear and re-render it,
      // which used to feed the assist observer indefinitely.
      if (!element.readOnly && !isMicrosoftCareers()) await setNativeValueWithRetry(element, rawValue);
      const selected = await chooseOpenOption(rawValue, element);
      if (!selected && isMicrosoftCareers() && element.getAttribute("aria-expanded") === "true") {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true, composed: true }));
        await sleep(40);
        if (element.getAttribute("aria-expanded") === "true") element.click();
      }
      return selected || hasExistingValue(element);
    }
    element.click();
    const selected = await chooseOpenOption(rawValue, element);
    if (!selected) element.click();
    return selected;
  }

  async function attachResume(input, resume) {
    if (!resume?.dataUrl || !resume?.name) return false;
    if (input.files?.length) return false;
    try {
      const response = await fetch(resume.dataUrl);
      if (!response.ok) throw new Error(`Stored resume could not be read (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], resume.name, { type: resume.type || blob.type || "application/pdf" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
      if (filesSetter) filesSetter.call(input, transfer.files);
      else input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      ATSCompat?.notifyFileAttached?.(input, transfer);
      await sleep(80);
      const attached = input.files?.length > 0 && input.files[0]?.name === resume.name;
      if (attached) input.dataset.applyosResumeAttached = resume.name;
      return attached;
    } catch (error) {
      console.warn("ApplyOS could not attach the stored resume", error);
      return false;
    }
  }

  function hasExistingResumeSelection(input) {
    const owner = input.closest("[role='group'], fieldset, section, [class*='form-section']") || input.parentElement;
    if (!owner) return false;
    return Array.from(owner.querySelectorAll("[role='combobox'], select")).some((control) => {
      if (control === input || !FILE_CONTEXT.test(descriptor(control))) return false;
      return control instanceof HTMLSelectElement
        ? Boolean(control.value) && control.selectedIndex >= 0
        : Boolean(String(control.value || control.textContent || "").trim());
    });
  }

  function detectSite() {
    const host = location.hostname.toLowerCase();
    if (host.includes("myworkdayjobs.com") || host.includes("workday.com")) return "Workday";
    if (host.includes("linkedin.com")) return "LinkedIn";
    if (host.includes("indeed.com")) return "Indeed";
    return ATSCompat?.displayName?.(host, document) || "Generic form";
  }

  async function fillElement(element, answer, processedGroups) {
    const type = String(element.type || "").toLowerCase();
    const role = element.getAttribute("role");
    const isCombobox = role === "combobox" || element.getAttribute("aria-haspopup") === "listbox";

    if (ATSCompat?.isCustomControl?.(element)) {
      return ATSCompat.fillCustomControl(element, answer.value, {
        sleep,
        setValue: setNativeValueWithRetry,
        chooseOption: chooseOpenOption
      });
    }

    if (type === "radio" || type === "checkbox") {
      const groupKey = `native:${type}:${element.name || answer.context}`;
      if (processedGroups.has(groupKey)) return false;
      processedGroups.add(groupKey);
      return fillStandardChoice(element, answer.value);
    }
    if (role === "radio" || role === "checkbox") {
      const groupKey = `aria:${role}:${answer.context}`;
      if (processedGroups.has(groupKey)) return false;
      processedGroups.add(groupKey);
      return fillAriaChoice(element, answer.value);
    }
    if (element instanceof HTMLSelectElement) return selectValue(element, answer.value);
    if (isCombobox) return fillCustomCombobox(element, answer.value);
    if (element.isContentEditable) {
      setContentEditableValue(element, answer.value);
      return hasExistingValue(element);
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      await setNativeValueWithRetry(element, answer.value);
      return hasExistingValue(element);
    }
    return false;
  }

  function elementValue(element) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked ? element.value || "Yes" : "No";
    if (element.getAttribute?.("role") === "checkbox" || element.getAttribute?.("role") === "radio") return element.getAttribute("aria-checked") === "true" ? element.getAttribute("data-value") || element.innerText || "Yes" : "No";
    if (element.isContentEditable) return String(element.innerText || element.textContent || "").trim();
    if ("value" in element) return String(element.value || "").trim();
    return "";
  }

  function trackFilledElement(element, answer) {
    if (!OfflynCore || !answer.classification?.shouldPersist) return;
    const fieldType = String(element.type || element.getAttribute("role") || element.tagName || "text").toLowerCase();
    const question = answer.context || descriptor(element);
    recentFills.set(element, {
      question,
      originalAnswer: String(answer.value),
      canonicalField: answer.classification.canonicalField || answer.key || null,
      fieldType,
      site: location.hostname,
      fingerprint: OfflynCore.fieldFingerprint({
        label: question,
        type: fieldType,
        name: element.name || element.id || "",
        site: location.hostname,
        canonicalField: answer.classification.canonicalField || answer.key || null
      })
    });
  }

  function queueCorrectionLearning(event) {
    if (!event.isTrusted) return;
    const element = event.target;
    const metadata = recentFills.get(element);
    if (!metadata) return;
    window.clearTimeout(correctionTimers.get(element));
    const timer = window.setTimeout(() => {
      const answer = elementValue(element);
      if (!answer || normalize(answer) === normalize(metadata.originalAnswer)) return;
      const validation = OfflynCore.validateFieldData(metadata.question, answer);
      if (!validation.isValid) return;
      chrome.runtime.sendMessage({
        type: "APPLYOS_LEARN_CORRECTION",
        correction: {
          fingerprint: metadata.fingerprint,
          question: metadata.question,
          answer,
          canonical_field: metadata.canonicalField,
          field_type: metadata.fieldType,
          site: metadata.site
        }
      }).catch(() => {});
      metadata.originalAnswer = answer;
    }, 700);
    correctionTimers.set(element, timer);
  }

  document.addEventListener("input", queueCorrectionLearning, true);
  document.addEventListener("change", queueCorrectionLearning, true);

  async function fillPage(profile, { quiet = false } = {}) {
    if (fillInProgress) return { scanned: 0, filled: 0, attached: 0, resumeFields: 0, resumeStatus: "not-found", skipped: 0, unmatchedRequired: 0, missingProfileFields: [], fields: [], site: detectSite() };
    fillInProgress = true;
    if (!quiet) assistFieldLedger.clear();
    const flatProfile = flattenProfile(profile);
    const report = { scanned: 0, filled: 0, attached: 0, resumeFields: 0, resumeStatus: "not-found", skipped: 0, unmatchedRequired: 0, missingProfileFields: [], fields: [], site: detectSite() };
    const elements = queryAllDeep(CONTROL_SELECTOR);
    const processedGroups = new Set();

    try {
      for (const element of elements) {
        const type = String(element.type || "").toLowerCase();
        if (type === "file") {
          if (element.disabled) {
            settleAssistField(element, "ignored");
            continue;
          }
          report.scanned += 1;
          if (isResumeFileInput(element)) {
            report.resumeFields += 1;
            if (element.files?.length || hasExistingResumeSelection(element)) {
              report.resumeStatus = "attached";
              settleAssistField(element, "preserved");
              continue;
            }
            if (!flatProfile.resume?.dataUrl || !flatProfile.resume?.name) {
              report.resumeStatus = "missing";
              report.skipped += 1;
              settleAssistField(element, "manual");
              continue;
            }
            const attached = await attachResume(element, flatProfile.resume);
            if (attached) {
              report.attached += 1;
              report.resumeStatus = "attached";
              report.fields.push("Resume");
              settleAssistField(element, "filled");
            } else {
              report.resumeStatus = "failed";
              report.skipped += 1;
              settleAssistField(element, "failed");
            }
          } else {
            settleAssistField(element, "manual");
          }
          continue;
        }

        if (!visible(element)) continue;
        if (quiet && isSettledAssistField(element)) continue;
        report.scanned += 1;
        const isListboxButton = element.getAttribute("role") === "combobox" || element.matches("button[aria-haspopup='listbox']");
        if (["hidden", "password", "submit", "button", "reset", "image"].includes(type) && !isListboxButton) {
          settleAssistField(element, "ignored");
          continue;
        }

        if (hasExistingValue(element)) {
          settleAssistField(element, "preserved");
          continue;
        }
        const answer = bestAnswer(element, flatProfile);
        if (!answer) {
          if (element.required || element.getAttribute("aria-required") === "true") {
            report.unmatchedRequired += 1;
            const missingKey = missingProfileKey(element, flatProfile);
            if (missingKey) report.missingProfileFields.push(profileFieldLabel(missingKey));
          }
          settleAssistField(element, "manual");
          continue;
        }

        settleAssistField(element, "attempting");
        const didFill = await fillElement(element, answer, processedGroups);
        if (didFill) {
          report.filled += 1;
          report.fields.push(answer.key.replace(/^custom:/, "Custom: "));
          element.classList.add("applykit-filled");
          trackFilledElement(element, answer);
          settleAssistField(element, "filled");
        } else {
          report.skipped += 1;
          settleAssistField(element, "failed");
        }
      }
    } finally {
      fillInProgress = false;
    }

    report.missingProfileFields = [...new Set(report.missingProfileFields)];

    window.setTimeout(() => queryAllDeep(".applykit-filled").forEach((element) => element.classList.remove("applykit-filled")), 3500);
    if (!quiet) showResultToast(report);
    return report;
  }

  function observeRoot(root) {
    assistObserver?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "hidden", "aria-hidden"]
    });
  }

  function addedControlCandidates(mutations) {
    const candidates = [];
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof Element) candidates.push(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(CONTROL_SELECTOR)) candidates.push(node);
        candidates.push(...node.querySelectorAll?.(CONTROL_SELECTOR) || []);
        if (node.shadowRoot) candidates.push(...node.shadowRoot.querySelectorAll(CONTROL_SELECTOR));
      }
    }
    return [...new Set(candidates)].some((element) => visible(element) && !isSettledAssistField(element));
  }

  function armAssistMode(profile) {
    assistProfile = profile;
    assistUntil = Date.now() + ASSIST_DURATION_MS;
    assistObserver?.disconnect();
    // The Microsoft application is rendered as one controlled form. Its
    // autosave and Fluent UI portals generate mutations for every interaction,
    // so mutation-assisted refills are unsafe and unnecessary on this site.
    if (isMicrosoftCareers()) return;
    assistObserver = new MutationObserver((mutations) => {
      if (Date.now() > assistUntil) {
        assistObserver.disconnect();
        return;
      }
      if (fillInProgress || !addedControlCandidates(mutations)) return;
      window.clearTimeout(assistTimer);
      assistTimer = window.setTimeout(async () => {
        discoverShadowRoots(document);
        for (const root of allRoots()) observeRoot(root);
        const report = await fillPage(assistProfile, { quiet: true });
        if (report.filled || report.attached) showResultToast(report, true);
      }, 350);
    });
    for (const root of allRoots()) observeRoot(root);
  }

  async function fillFromStorage() {
    const { profile, applyos_state: state, applyos_graph: graph } = await chrome.storage.local.get(["profile", "applyos_state", "applyos_graph"]);
    if (!profile) throw new Error("Profile not configured");
    const remembered = (state?.answer_memory || []).map(({ question, answer }) => ({ question, answer }));
    const mergedProfile = {
      ...profile,
      _learnedAnswers: [
        ...(state?.learned_answers || []),
        ...((graph?.nodes || []).filter((node) => node.type === "answer").map((node) => ({
          id: node.id, fingerprint: node.id, question: node.question, normalized_question: ApplyOS.normalizeQuestion(node.question), answer: node.answer,
          canonical_field: node.canonical_field, field_type: node.prompt_type || "text", site: node.platforms?.[0] || "unknown", use_count: node.use_count || 1, updated_at: node.updated_at
        })))
      ],
      customAnswers: [...(profile.customAnswers || []), ...remembered]
    };
    const report = await fillPage(mergedProfile);
    const workdayReport = globalThis.ApplyOS?.Workday?.isPage?.()
      ? await globalThis.ApplyOS.Workday.fillVisibleStep(mergedProfile)
      : null;
    if (workdayReport?.filled) {
      report.filled += workdayReport.filled;
      report.fields.push(...workdayReport.fields);
      report.workdayStep = workdayReport.step;
    }
    if (workdayReport?.manualStep) report.manualStep = workdayReport.step;
    armAssistMode(mergedProfile);
    return report;
  }

  function collectAgentFields() {
    let sequence = 0;
    return queryAllDeep(CONTROL_SELECTOR).filter((element) => {
      if (!visible(element) || hasExistingValue(element)) return false;
      const type = String(element.type || "").toLowerCase();
      return !["hidden", "password", "submit", "button", "reset", "image", "file"].includes(type);
    }).map((element) => {
      const label = descriptor(element);
      if (!label || BLOCKED_CONTEXT.test(label) || SENSITIVE_CONTEXT.test(label) || CONSENT_CONTEXT.test(label)) return null;
      const fieldId = `field_${Date.now()}_${sequence++}`;
      element.dataset.applyosAgentId = fieldId;
      const options = element instanceof HTMLSelectElement
        ? Array.from(element.options, (option) => option.textContent || option.value).filter(Boolean).slice(0, 40)
        : [];
      return { fieldId, label, type: element.type || element.getAttribute("role") || element.tagName.toLowerCase(), required: Boolean(element.required || element.getAttribute("aria-required") === "true"), options };
    }).filter(Boolean).slice(0, 80);
  }

  async function runAgentAssist() {
    const { profile } = await chrome.storage.local.get("profile");
    if (!profile) throw new Error("Profile not configured");
    const fields = collectAgentFields();
    if (!fields.length) return { scanned: 0, filled: 0, skipped: 0, blockedActions: 0, reviewRequired: true, site: detectSite() };
    const job = window === window.top && globalThis.ApplyOS?.captureJob ? globalThis.ApplyOS.captureJob() : {};
    const plan = await globalThis.ApplyOS.generateAgentPlan(fields, profile, job);
    const report = { scanned: fields.length, filled: 0, skipped: 0, blockedActions: plan.blockedActions, reviewRequired: true, site: detectSite(), notes: plan.notes };
    const processedGroups = new Set();
    for (const action of plan.actions) {
      const element = document.querySelector(`[data-applyos-agent-id="${CSS.escape(action.fieldId)}"]`);
      if (!element || !globalThis.ApplyOS.isSafeAgentAction(action)) { report.skipped += 1; continue; }
      if (action.action === "skip") { report.skipped += 1; continue; }
      const answer = { key: `local-ai:${action.label}`, value: action.value, context: action.label, classification: { shouldPersist: false, canonicalField: null } };
      if (await fillElement(element, answer, processedGroups)) {
        report.filled += 1; element.classList.add("applykit-filled");
      } else report.skipped += 1;
    }
    showResultToast(report);
    return report;
  }

  function showResultToast(report) {
    try {
      if (window !== window.top) return;
    } catch {
      return;
    }
    document.querySelector(".applykit-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "applykit-toast";
    toast.setAttribute("role", "status");
    const missingProfile = report.missingProfileFields?.length
      ? ` Add ${report.missingProfileFields.join(", ")} in Profile & answer memory.`
      : "";
    toast.textContent = report.resumeStatus === "missing"
      ? "ApplyOS found a resume upload field, but no resume file is saved in your profile. Add one in Profile & answer memory."
      : report.resumeStatus === "failed"
        ? "ApplyOS found the resume upload field but could not attach the saved file. Please attach it manually and review the form."
        : report.filled || report.attached
      ? `ApplyOS filled ${report.filled} field${report.filled === 1 ? "" : "s"}${report.attached ? ` + ${report.attached} resume` : ""}. Review the remaining fields.${missingProfile}`
      : `ApplyOS found no confident matches. ${report.unmatchedRequired || 0} required field${report.unmatchedRequired === 1 ? "" : "s"} may need review.${missingProfile}`;
    document.documentElement.append(toast);
    window.setTimeout(() => toast.remove(), 5500);
  }

  function diagnosticRawField(element) {
    const attributes = {};
    for (const name of ["aria-labelledby", "aria-describedby", "aria-required", "aria-haspopup", "aria-expanded", "aria-controls", "data-automation-id", "data-testid", "data-test", "data-ui"]) {
      if (element.hasAttribute?.(name)) attributes[name] = element.getAttribute(name);
    }
    const ancestors = [];
    let parent = element.parentElement;
    for (let depth = 0; depth < 4 && parent; depth += 1, parent = parent.parentElement) {
      ancestors.push({ tag: parent.tagName?.toLowerCase() || "unknown", role: parent.getAttribute?.("role") || "" });
    }
    return {
      label: labelText(element),
      tag: element.tagName?.toLowerCase() || "unknown",
      type: element.type || "",
      role: element.getAttribute?.("role") || "",
      required: Boolean(element.required || element.getAttribute?.("aria-required") === "true"),
      autocomplete: element.getAttribute?.("autocomplete") || "",
      attributes,
      ancestors,
      hidden: !visible(element) || String(element.type || "").toLowerCase() === "hidden"
    };
  }

  function collectDiagnosticFields() {
    const blockedTypes = new Set(["hidden", "password", "submit", "button", "reset", "image"]);
    return queryAllDeep(CONTROL_SELECTOR)
      .filter((element) => !element.closest?.(".applyos-review-overlay, .applyos-submit-prompt") && !blockedTypes.has(String(element.type || "").toLowerCase()))
      .map((element) => globalThis.ApplyOS.Diagnostics?.describeField(diagnosticRawField(element)))
      .filter(Boolean)
      .slice(0, 80);
  }

  function reportPayload(fields) {
    const job = globalThis.ApplyOS?.captureJob?.() || {};
    return globalThis.ApplyOS.Diagnostics.buildReport({
      pageUrl: location.href,
      platform: job.platform || detectSite().toLowerCase(),
      extensionVersion: chrome.runtime.getManifest().version,
      fields
    });
  }

  function downloadDiagnosticReport(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `applyos-broken-fields-${payload.source_domain}-${Date.now()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openDiagnosticReview() {
    if (window !== window.top) return { count: 0 };
    document.querySelector(".applyos-review-overlay")?.remove();
    const fields = collectDiagnosticFields();
    const overlay = document.createElement("div");
    overlay.className = "applyos-review-overlay";
    const dialog = document.createElement("section");
    dialog.className = "applyos-review-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Review broken-field report");

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.textContent = "PRIVACY REVIEW";
    const title = document.createElement("h2");
    title.textContent = "Report broken fields";
    const explanation = document.createElement("p");
    explanation.textContent = "Select only the fields that failed. The preview contains labels and sanitized structure—never entered answers, resume data, or the page URL query. Nothing leaves your browser unless you open the reviewed GitHub report.";
    heading.append(eyebrow, title, explanation);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "applyos-review-close";
    close.setAttribute("aria-label", "Close report review");
    close.textContent = "×";
    header.append(heading, close);

    const list = document.createElement("div");
    list.className = "applyos-review-fields";
    const checkboxes = fields.map((field, index) => {
      const row = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = false;
      checkbox.dataset.index = String(index);
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = field.label;
      const meta = document.createElement("small");
      meta.textContent = `${field.tag}${field.type ? ` · ${field.type}` : ""}${field.required ? " · required" : ""}`;
      copy.append(name, meta);
      row.append(checkbox, copy);
      list.append(row);
      return checkbox;
    });
    if (!fields.length) {
      const empty = document.createElement("p");
      empty.className = "applyos-review-empty";
      empty.textContent = "No visible form fields were found on this page.";
      list.append(empty);
    }

    const previewLabel = document.createElement("label");
    previewLabel.className = "applyos-review-preview";
    const previewTitle = document.createElement("span");
    previewTitle.textContent = "COMPLETE SANITIZED PAYLOAD";
    const preview = document.createElement("textarea");
    preview.readOnly = true;
    preview.spellcheck = false;
    previewLabel.append(previewTitle, preview);

    const actions = document.createElement("footer");
    const privacy = document.createElement("span");
    privacy.textContent = "Public GitHub issue · review and submit manually";
    const buttonGroup = document.createElement("div");
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy JSON";
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "applyos-review-download";
    downloadButton.textContent = "Download JSON";
    const reportButton = document.createElement("button");
    reportButton.type = "button";
    reportButton.className = "applyos-review-report";
    reportButton.textContent = "Open GitHub report";
    reportButton.disabled = true;
    buttonGroup.append(copyButton, downloadButton, reportButton);
    actions.append(privacy, buttonGroup);

    const selectedPayload = () => reportPayload(checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => fields[Number(checkbox.dataset.index)]));
    const refreshPreview = () => {
      const payload = selectedPayload();
      preview.value = JSON.stringify(payload, null, 2);
      reportButton.disabled = payload.fields.length === 0;
      reportButton.dataset.reportUrl = payload.fields.length ? globalThis.ApplyOS.Diagnostics.githubIssueUrl(payload) : "";
    };
    checkboxes.forEach((checkbox) => checkbox.addEventListener("change", refreshPreview));
    close.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    copyButton.addEventListener("click", async () => {
      const json = JSON.stringify(selectedPayload(), null, 2);
      let copied = false;
      try { await navigator.clipboard.writeText(json); copied = true; } catch { /* Fall back to the reviewed preview. */ }
      if (!copied) {
        preview.focus();
        preview.select();
        copied = document.execCommand("copy");
      }
      copyButton.textContent = copied ? "Copied" : "Select and copy preview";
    });
    downloadButton.addEventListener("click", () => downloadDiagnosticReport(selectedPayload()));
    reportButton.addEventListener("click", () => {
      const payload = selectedPayload();
      if (!payload.fields.length) return;
      const reportUrl = globalThis.ApplyOS.Diagnostics.githubIssueUrl(payload);
      window.open(reportUrl, "_blank", "noopener,noreferrer");
    });
    dialog.append(header, list, previewLabel, actions);
    overlay.append(dialog);
    document.documentElement.append(overlay);
    refreshPreview();
    close.focus();
    return { count: fields.length };
  }

  let submissionSession = null;
  let confirmationObserver = null;
  let confirmationTimer = null;
  let observedUrl = location.href;

  function confirmationSignals() {
    const strongSelector = Boolean(document.querySelector(globalThis.ApplyOS.Submission.confirmationSelectors(submissionSession?.platform).join(",")));
    const heading = Array.from(document.querySelectorAll("h1, h2, [role='heading']"))
      .slice(0, 16).map((element) => String(element.textContent || "").trim()).filter(Boolean).join("\n").slice(0, 1600);
    const main = document.querySelector("main, [role='main'], #main, #content");
    const pageText = String(main?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    const formPresent = document.querySelectorAll("form input:not([type='hidden']), form textarea, form select").length >= 3;
    return { strongSelector, heading, pageText, formPresent };
  }

  async function evaluateSubmissionConfirmation() {
    if (window !== window.top || !submissionSession || submissionSession.suppressed || !submissionSession.submitIntentAt) return;
    if (submissionSession.promptedIntentAt === submissionSession.submitIntentAt) return;
    const result = globalThis.ApplyOS.Submission.scoreConfirmation({
      ...confirmationSignals(),
      title: document.title,
      url: location.href,
      submitIntentAgeMs: Date.now() - submissionSession.submitIntentAt
    });
    if (!result.likely) return;
    const marked = await chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_PROMPTED" });
    if (!marked?.ok) return;
    submissionSession = marked.session;
    showSubmissionPrompt(submissionSession);
  }

  function queueConfirmationCheck(delay = 450) {
    window.clearTimeout(confirmationTimer);
    confirmationTimer = window.setTimeout(() => evaluateSubmissionConfirmation().catch(() => {}), delay);
  }

  async function noteTrustedSubmitIntent() {
    const response = await chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_SUBMIT_INTENT", url: location.href });
    if (!response?.ok) return;
    submissionSession = response.session;
    queueConfirmationCheck(250);
  }

  function showSubmissionPrompt(session) {
    if (document.querySelector(".applyos-submit-prompt")) return;
    const prompt = document.createElement("section");
    prompt.className = "applyos-submit-prompt";
    prompt.setAttribute("role", "dialog");
    prompt.setAttribute("aria-label", "Confirm submitted application");
    const eyebrow = document.createElement("p");
    eyebrow.textContent = "APPLICATION CHECK";
    const title = document.createElement("h2");
    title.textContent = "Did you submit this application?";
    const detail = document.createElement("p");
    detail.textContent = [session.role, session.company].filter(Boolean).join(" at ") || "ApplyOS will only update this after you confirm.";
    const actions = document.createElement("div");
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "applyos-submit-yes";
    yes.textContent = "Yes, mark applied";
    const notYet = document.createElement("button");
    notYet.type = "button";
    notYet.textContent = "Not yet";
    const suppress = document.createElement("button");
    suppress.type = "button";
    suppress.className = "applyos-submit-suppress";
    suppress.textContent = "Don’t ask again here";
    actions.append(yes, notYet, suppress);
    prompt.append(eyebrow, title, detail, actions);
    document.documentElement.append(prompt);
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      const response = await chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_CONFIRM_APPLIED" });
      if (!response?.ok) { yes.disabled = false; detail.textContent = response?.error || "Could not update the application."; return; }
      prompt.remove();
      submissionSession = null;
      showResultToast({ filled: 0, attached: 0, unmatchedRequired: 0, resumeStatus: "not-found" });
      const toast = document.querySelector(".applykit-toast");
      if (toast) toast.textContent = "Marked applied. ApplyOS scheduled your reviewed follow-up reminders.";
    });
    notYet.addEventListener("click", async () => {
      const response = await chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_DISMISS", action: "not_yet" });
      if (response?.session) submissionSession = response.session;
      prompt.remove();
    });
    suppress.addEventListener("click", async () => {
      const response = await chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_DISMISS", action: "dont_ask" });
      if (response?.session) submissionSession = response.session;
      prompt.remove();
    });
    yes.focus();
  }

  function initializeSubmissionDetection() {
    document.addEventListener("click", (event) => {
      if (!event.isTrusted || submissionSession?.suppressed) return;
      const control = event.target instanceof Element ? event.target.closest("button, input[type='submit'], [role='button']") : null;
      if (!control || control.closest(".applyos-submit-prompt, .applyos-review-overlay")) return;
      const label = control.getAttribute("aria-label") || control.value || control.textContent || "";
      if (globalThis.ApplyOS.Submission.isSubmitIntentLabel(label)) noteTrustedSubmitIntent().catch(() => {});
    }, true);
    document.addEventListener("submit", (event) => {
      if (event.isTrusted && !submissionSession?.suppressed) noteTrustedSubmitIntent().catch(() => {});
    }, true);
    if (window !== window.top) return;
    chrome.runtime.sendMessage({ type: "APPLYOS_SESSION_GET" }).then((response) => {
      submissionSession = response?.session || null;
      queueConfirmationCheck(150);
    }).catch(() => {});
    confirmationObserver = new MutationObserver(() => queueConfirmationCheck());
    confirmationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.setInterval(() => {
      if (location.href === observedUrl) return;
      observedUrl = location.href;
      queueConfirmationCheck(100);
    }, 750);
  }

  document.addEventListener("keydown", (event) => {
    if (!(event.altKey && event.shiftKey && event.code === "KeyA")) return;
    event.preventDefault();
    fillFromStorage().catch((error) => console.warn("ApplyOS autofill failed", error));
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "APPLYOS_SESSION_UPDATED") {
      if (window === window.top) submissionSession = message.session || null;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "APPLYOS_REPORT_BROKEN") {
      try { sendResponse({ ok: true, ...openDiagnosticReview() }); }
      catch (error) { sendResponse({ ok: false, error: error.message }); }
      return false;
    }
    const task = message?.type === "APPLYKIT_FILL"
      ? fillFromStorage()
      : message?.type === "APPLYOS_AGENT_ASSIST"
        ? runAgentAssist()
        : null;
    if (!task) return false;
    task
      .then((report) => sendResponse({ ok: true, report }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  initializeSubmissionDetection();
})();
