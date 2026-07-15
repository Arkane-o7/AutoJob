(function (root) {
  "use strict";

  if (window !== window.top) return;

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};

  const SITE_SELECTORS = {
    linkedin: {
      host: /(^|\.)linkedin\.com$/,
      role: ["h1.top-card-layout__title", "h1.t-24", ".job-details-jobs-unified-top-card__job-title h1", "h1"],
      company: [".topcard__org-name-link", ".job-details-jobs-unified-top-card__company-name", ".top-card-layout__card a[data-tracking-control-name*='company']"],
      description: [".show-more-less-html__markup", ".jobs-description__content", "#job-details"],
      location: [".topcard__flavor--bullet", ".job-details-jobs-unified-top-card__primary-description-container"]
    },
    workday: {
      host: /myworkdayjobs\.com$|workday\.com$/,
      role: ["h2[data-automation-id='jobPostingHeader']", "h1[data-automation-id='jobPostingHeader']", "h1"],
      company: ["[data-automation-id='tenantLogo']", "header img[alt]"],
      description: ["[data-automation-id='jobPostingDescription']", "[data-automation-id='jobPostingPage'] main"],
      location: ["[data-automation-id='locations']", "[data-automation-id='location']"],
      deadline: ["[data-automation-id='expirationDate']"]
    },
    greenhouse: {
      host: /greenhouse\.io$|greenhouse\.com$/,
      role: ["h1.app-title", ".job__title h1", "h1"],
      company: [".company-name", "#logo img[alt]", ".job__company"],
      description: ["#content", ".job-post", ".job__description"],
      location: [".location", ".job__location"]
    },
    lever: {
      host: /lever\.co$/,
      role: [".posting-headline h2", "h1"],
      company: [".main-header-logo img[alt]", ".posting-categories .department"],
      description: [".posting-page .content", ".section-wrapper.page-full-width"],
      location: [".posting-categories .location"]
    },
    ashby: {
      host: /ashbyhq\.com$/,
      role: ["h1", "[class*='_jobPostingTitle']"],
      company: ["[class*='_organizationName']", "header img[alt]"],
      description: ["[class*='_jobDescription']", "main"],
      location: ["[class*='_jobPostingLocation']"]
    },
    smartrecruiters: {
      host: /smartrecruiters\.com$/,
      role: ["[data-test='job-title']", "[data-testid='job-title']", ".job-title h1", "h1"],
      company: ["[data-test='company-name']", "[data-testid='company-name']", ".company-name", "header img[alt]"],
      description: ["[data-test='job-description']", "[data-testid='job-description']", ".job-description", "main"],
      location: ["[data-test='job-location']", "[data-testid='job-location']", ".job-location", ".location"]
    },
    icims: {
      host: /icims\.com$/,
      role: [".iCIMS_JobHeader h1", ".iCIMS_Header h1", "[class*='job-title' i]", "h1"],
      company: [".iCIMS_Logo img[alt]", "[class*='company-name' i]", "header img[alt]"],
      description: [".iCIMS_JobContent", ".iCIMS_JobDescription", "#job-description", "[class*='job-description' i]"],
      location: [".iCIMS_JobHeader .location", "[class*='job-location' i]", "[class*='location' i]"]
    },
    oracle: {
      host: /taleo\.net$|oraclecloud\.com$/,
      role: ["[data-automation-id='jobPostingHeader']", "[data-automation-id='job-title']", ".job-title", "h1"],
      company: ["[data-automation-id='companyName']", "[data-automation-id='tenantLogo']", "header img[alt]"],
      description: ["[data-automation-id='jobPostingDescription']", "[data-automation-id='job-details']", ".job-description", "main"],
      location: ["[data-automation-id='locations']", "[data-automation-id='location']", ".job-location"]
    },
    workable: {
      host: /workable\.com$/,
      role: ["[data-ui='job-title']", "[data-testid='job-title']", "h1"],
      company: ["[data-ui='company-name']", "[data-testid='company-name']", "header img[alt]"],
      description: ["[data-ui='job-description']", "[data-testid='job-description']", ".job-description", "main"],
      location: ["[data-ui='job-location']", "[data-testid='job-location']", "[class*='location' i]"]
    },
    jobvite: {
      host: /jobvite\.com$/,
      role: [".jv-header h1", ".jv-job-detail-title", "[data-qa='job-title']", "h1"],
      company: [".jv-header-logo img[alt]", ".jv-company-name", "header img[alt]"],
      description: [".jv-job-detail-description", ".jv-job-detail-content", "[data-qa='job-description']", "main"],
      location: [".jv-job-detail-location", "[data-qa='job-location']", ".location"]
    },
    successfactors: {
      host: /successfactors\.(?:com|eu)$|jobs2web\.com$/,
      role: [".jobTitle", "[data-help-id='jobTitle']", "[class*='job-title' i]", "h1"],
      company: [".companyName", "[data-help-id='companyName']", "header img[alt]"],
      description: [".jobDescription", "[data-help-id='jobDescription']", "[class*='job-description' i]", "main"],
      location: [".jobLocation", "[data-help-id='jobLocation']", "[class*='location' i]"]
    },
    bamboohr: {
      host: /bamboohr\.com$/,
      role: [".BambooHR-ATS-board h2", "[class*='job-title' i]", "h1"],
      company: [".BambooHR-ATS-board img[alt]", "[class*='company-name' i]", "header img[alt]"],
      description: [".ResAts__card-content", "[class*='job-description' i]", "main"],
      location: ["[class*='job-location' i]", "[class*='location' i]"]
    },
    recruitee: {
      host: /recruitee\.com$/,
      role: ["[data-testid='job-title']", "[class*='job-title' i]", "h1"],
      company: ["[data-testid='company-name']", "[class*='company-name' i]", "header img[alt]"],
      description: ["[data-testid='job-description']", "[class*='job-description' i]", "main"],
      location: ["[data-testid='job-location']", "[class*='job-location' i]", "[class*='location' i]"]
    },
    teamtailor: {
      host: /teamtailor\.com$/,
      role: ["[data-section-id='job-title'] h1", "[class*='job-title' i]", "h1"],
      company: ["[data-section-id='company']", "[class*='company-name' i]", "header img[alt]"],
      description: ["[data-section-id='job-description']", "[class*='job-description' i]", "main"],
      location: ["[data-section-id='location']", "[class*='job-location' i]", "[class*='location' i]"]
    },
    personio: {
      host: /personio\.(?:de|com)$/,
      role: ["[data-testid='job-title']", "[class*='job-title' i]", "h1"],
      company: ["[data-testid='company-name']", "[class*='company-name' i]", "header img[alt]"],
      description: ["[data-testid='job-description']", "[class*='job-description' i]", "main"],
      location: ["[data-testid='job-location']", "[class*='job-location' i]", "[class*='location' i]"]
    },
    wellfound: {
      host: /wellfound\.com$/,
      role: ["h1", "[data-test='JobTitle']"],
      company: ["[data-test='StartupName']", "h2 a"],
      description: ["[data-test='JobDescription']", "main"],
      location: ["[data-test='JobLocation']"]
    },
    northstarz: {
      host: /(^|\.)northstarz\.ai$/,
      role: ["p.text-xl.font-semibold", "[class~='text-xl'][class~='font-semibold']"],
      company: [".bg-white.py-6.px-6 p:nth-of-type(2)"],
      description: [".bg-white.shadow-lg"],
      location: [".bg-white.py-6.px-6 p:nth-of-type(3)"]
    }
  };

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function valueFromElement(element) {
    if (!element) return "";
    if (element.tagName === "META") return clean(element.content);
    if (element.tagName === "IMG") return clean(element.alt);
    return clean(element.innerText || element.textContent || element.getAttribute("content") || "");
  }

  function first(selectors = [], rootNode = document) {
    for (const selector of selectors) {
      try {
        const value = valueFromElement(rootNode.querySelector(selector));
        if (value) return value;
      } catch { /* Ignore invalid or unsupported selectors. */ }
    }
    return "";
  }

  function jobPostingJsonLd() {
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const parsed = JSON.parse(script.textContent);
        const candidates = [];
        const visit = (value) => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) return value.forEach(visit);
          candidates.push(value);
          if (Array.isArray(value["@graph"])) value["@graph"].forEach(visit);
        };
        visit(parsed);
        const posting = candidates.find((item) => {
          const type = item?.["@type"];
          return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
        });
        if (posting) return posting;
      } catch { /* Malformed third-party JSON-LD is common. */ }
    }
    return null;
  }

  function jsonLocation(location) {
    const item = Array.isArray(location) ? location[0] : location;
    const address = item?.address || item;
    return clean([address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry].filter(Boolean).join(", "));
  }

  function textDescription(value) {
    if (!value) return "";
    const container = document.createElement("div");
    container.innerHTML = String(value);
    return clean(container.textContent).slice(0, 60000);
  }

  function platformFor(hostname) {
    const configured = Object.entries(SITE_SELECTORS).find(([, config]) => config.host.test(hostname))?.[0];
    if (configured) return configured;
    const adapted = ApplyOS.ATSCompat?.platformForDocument?.(hostname, document);
    if (adapted && adapted !== "generic") return adapted;
    return ApplyOS.OfflynCore?.platformForHost(hostname) || "company_careers";
  }

  function usefulRole(value) {
    const text = clean(value);
    if (!text || text.length > 220) return "";
    if (/^(?:apply|application|application questions|careers?|jobs?|job details|job description|candidate home|my information)$/i.test(text)) return "";
    return text;
  }

  function largestJobTextBlock() {
    if (!ApplyOS.OfflynCore?.isJobUrl(location.href)) return "";
    let best = { text: "", score: 0 };
    for (const element of document.querySelectorAll("main, article, section, [role='main'], #content, #main")) {
      if (element.closest("nav, header, footer")) continue;
      const text = clean(element.innerText || element.textContent || "").slice(0, 60000);
      if (text.length < 250) continue;
      const signals = (text.match(/\b(?:responsibilities|requirements|qualifications|experience|skills|about the role|what you will do|who you are|benefits)\b/gi) || []).length;
      const score = Math.min(text.length, 12000) + signals * 1200;
      if (signals >= 2 && score > best.score) best = { text, score };
    }
    return best.text;
  }

  function genericCompany() {
    const meta = first(["meta[property='og:site_name']", "meta[name='application-name']", "[data-testid*='company' i]", "[class*='company-name' i]", "header img[alt]"]);
    if (meta && !/linkedin|workday|greenhouse|lever|ashby|wellfound|northstarz/i.test(meta)) return meta;
    const title = clean(document.title).split(/\s+[|–—-]\s+/).filter(Boolean);
    return title.length > 1 ? title[title.length - 1] : "";
  }

  function extractDeadline(text) {
    const excerpt = String(text || "").slice(0, 20000);
    const match = excerpt.match(/(?:apply by|application deadline|closing date|deadline)\s*:?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
    if (!match) return null;
    const parsed = new Date(match[1]);
    return Number.isNaN(parsed.getTime()) ? match[1] : parsed.toISOString();
  }

  function confidence(value, strong, fallback) {
    if (!value) return 0;
    return strong ? 0.96 : fallback ? 0.68 : 0.45;
  }

  ApplyOS.captureJob = function captureJob() {
    const json = jobPostingJsonLd();
    const platform = platformFor(location.hostname);
    const config = SITE_SELECTORS[platform] || {};
    const selectorRole = first(config.role);
    const selectorCompany = first(config.company);
    const selectorDescription = first(config.description);
    const selectorLocation = first(config.location);
    const selectorDeadline = first(config.deadline);

    const role = usefulRole(json?.title) || usefulRole(selectorRole) || usefulRole(first(["meta[property='og:title']", "meta[name='twitter:title']", "h1", "h2"]));
    const siteCompany = platform === "northstarz" ? selectorCompany.replace(/^at\s+/i, "") : selectorCompany;
    const company = clean(json?.hiringOrganization?.name) || siteCompany || genericCompany();
    const knownDescription = first([
      "[data-automation-id='jobPostingDescription']", ".job-post-content", "#job_description", ".job__description",
      "[data-qa='job-description']", ".ashby-job-posting-description", "[class*='job-description' i]",
      "[id*='job-description' i]", "[class*='jobDescription']", "main article"
    ]).slice(0, 60000);
    const metaDescription = first(["meta[property='og:description']", "meta[name='description']"]);
    const description = textDescription(json?.description) || selectorDescription || knownDescription
      || (metaDescription.length >= 100 ? metaDescription : "") || largestJobTextBlock();
    const siteLocation = platform === "northstarz" ? selectorLocation.split("|").pop().trim() : selectorLocation;
    const detectedLocation = jsonLocation(json?.jobLocation) || clean(json?.jobLocationType === "TELECOMMUTE" ? "Remote" : "") || siteLocation;
    const deadline = clean(json?.validThrough) || selectorDeadline || extractDeadline(description);
    const source = location.hostname.replace(/^www\./, "");
    const fieldConfidence = {
      company: confidence(company, Boolean(json?.hiringOrganization?.name), Boolean(selectorCompany)),
      role: confidence(role, Boolean(json?.title), Boolean(selectorRole)),
      description: confidence(description, Boolean(json?.description), Boolean(selectorDescription)),
      location: confidence(detectedLocation, Boolean(jsonLocation(json?.jobLocation)), Boolean(selectorLocation)),
      deadline: confidence(deadline, Boolean(json?.validThrough), Boolean(selectorDeadline))
    };
    const essentials = [fieldConfidence.company, fieldConfidence.role, fieldConfidence.description];
    fieldConfidence.overall = Math.round((essentials.reduce((sum, score) => sum + score, 0) / essentials.length) * 100) / 100;

    const warnings = [];
    if (fieldConfidence.company < 0.7) warnings.push("Company needs review");
    if (fieldConfidence.role < 0.7) warnings.push("Role title needs review");
    if (!description) warnings.push("Job description was not found on this page");

    return {
      company: company || "",
      role: role || "",
      url: ApplyOS.canonicalizeUrl(location.href),
      source,
      platform,
      description,
      location: detectedLocation,
      deadline: deadline || null,
      skills: ApplyOS.extractSkills?.(description) || [],
      keywords: ApplyOS.extractKeywords?.(description) || [],
      confidence: fieldConfidence,
      warnings,
      captured_at: ApplyOS.nowISO()
    };
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "APPLYOS_DETECT_JOB") return false;
    try {
      sendResponse({ ok: true, job: ApplyOS.captureJob() });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return false;
  });
})(globalThis);
