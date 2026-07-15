(() => {
  "use strict";

  const ApplyOS = globalThis.ApplyOS = globalThis.ApplyOS || {};

  // Greenhouse selector and interaction patterns are adapted from Job App Filler
  // (BSD-3-Clause), revision 6d6062cb98bbe70c2946d9d43b519a01b19da448.
  // See THIRD_PARTY_NOTICES.md and licenses/JOB_APP_FILLER_BSD_3_CLAUSE.txt.
  const ADAPTERS = Object.freeze({
    greenhouse: adapter("Greenhouse", [/(^|\.)greenhouse\.io$/, /(^|\.)greenhouse\.com$/], {
      signatures: ["#grnhse_app", "form[action*='greenhouse']", ".greenhouse-job-board", ".text-input-wrapper", ".file-upload"],
      containers: [".field", ".text-input-wrapper", ".select", ".file-upload", ".application-question"],
      labels: ["label", ".label", "[class*='label']"],
      options: [".select2-results li", ".select2-result", ".select__option", "[class*='select__option']"],
      customControls: [".select2-container", ".select__control", "[class*='select__control']"],
      dropZones: [".drop-zone", ".file-upload", "[class*='file-upload']"]
    }),
    lever: adapter("Lever", [/(^|\.)lever\.co$/], {
      signatures: ["form.application-form", ".lever-job-application", "[data-qa='application-form']"],
      containers: [".application-question", ".application-field", ".field", ".form-group", "[data-qa*='field']"],
      labels: [".application-label", ".field-label", "label", "legend"],
      options: [".select2-results li", ".select2-result", "[role='option']"],
      customControls: [".select2-container"],
      dropZones: [".resume-upload", ".file-upload", "[data-qa*='resume']"]
    }),
    ashby: adapter("Ashby", [/(^|\.)ashbyhq\.com$/], {
      signatures: ["[data-ashby-job-posting]", "form[data-testid*='application']", ".ashby-application-form-field-entry"],
      containers: [".ashby-application-form-field-entry", "[data-testid*='field']", "[class*='FormField']"],
      labels: ["label", "legend", "[class*='Label']", "[data-testid*='label']"],
      options: ["[role='option']", "[data-testid*='option']"],
      dropZones: ["[data-testid*='upload']", "[class*='FileUpload']"]
    }),
    smartrecruiters: adapter("SmartRecruiters", [/(^|\.)smartrecruiters\.com$/], {
      signatures: ["[data-test='application-form']", "[data-testid='application-form']", ".smartrecruiters-application"],
      containers: [".form-group", ".input-container", "[data-test*='field']", "[data-testid*='field']"],
      labels: ["label", "legend", "[data-test*='label']", "[data-testid*='label']"],
      options: ["[role='option']", "[data-test*='option']", "[data-testid*='option']"],
      dropZones: ["[data-test*='upload']", "[data-testid*='upload']"]
    }),
    icims: adapter("iCIMS", [/(^|\.)icims\.com$/], {
      signatures: [".iCIMS_Application", ".iCIMS_MainWrapper", "form[id*='icims']"],
      containers: [".iCIMS_FieldRow", ".iCIMS_TableRow", ".iCIMS_SectionRow", ".field", ".form-group"],
      labels: [".iCIMS_Label", ".iCIMS_Expandable_Text", "label", "legend"],
      options: [".select2-results li", ".ui-menu-item", "[role='option']"],
      customControls: [".select2-container"],
      dropZones: [".iCIMS_FileUpload", "[class*='FileUpload']"]
    }),
    oracle: adapter("Oracle / Taleo", [/(^|\.)taleo\.net$/, /(^|\.)oraclecloud\.com$/], {
      signatures: ["form[id*='requisition']", "[data-automation-id*='candidate']", ".taleo-application"],
      containers: [".form-field", ".input-wrapper", ".field", ".row", "[data-automation-id*='formField']"],
      labels: ["label", "legend", ".field-label", "[data-automation-id*='label']"],
      options: ["[role='option']", ".oj-listbox-result", ".ui-menu-item"],
      dropZones: ["[data-automation-id*='upload']", ".file-upload"]
    }),
    workable: adapter("Workable", [/(^|\.)workable\.com$/], {
      signatures: ["form[data-ui='application-form']", "[data-ui='job-application']", "[data-ui='application']"],
      containers: ["[data-ui='field']", "[data-ui*='question']", ".form-group", ".field"],
      labels: ["label", "legend", "[data-ui='label']", "[data-ui*='label']"],
      options: ["[role='option']", "[data-ui='option']", "[data-ui*='option']"],
      dropZones: ["[data-ui*='upload']", "[data-ui*='dropzone']"]
    }),
    jobvite: adapter("Jobvite", [/(^|\.)jobvite\.com$/], {
      signatures: [".jv-application", "form[id*='jobvite']", "[data-qa='apply-form']"],
      containers: [".jv-form-field", ".form-group", ".field", "[data-qa*='field']"],
      labels: [".jv-form-label", "label", "legend", ".field-label"],
      options: ["[role='option']", ".select2-results li", ".ui-menu-item"],
      customControls: [".select2-container"],
      dropZones: [".jv-file-upload", "[class*='file-upload']"]
    }),
    successfactors: adapter("SAP SuccessFactors", [/(^|\.)successfactors\.(com|eu)$/, /(^|\.)jobs2web\.com$/], {
      signatures: ["[id*='careerSite']", "[data-help-id*='application']", ".jobApplication"],
      containers: [".field", ".form-group", "[data-help-id*='field']", "[class*='FormField']"],
      labels: ["label", "legend", "[class*='Label']", "[data-help-id*='label']"],
      options: ["[role='option']", ".sapMSelectListItem", ".sapMComboBoxBasePicker li"],
      dropZones: ["[class*='FileUploader']", "[class*='Upload']"]
    }),
    bamboohr: adapter("BambooHR", [/(^|\.)bamboohr\.com$/], {
      signatures: [".BambooHR-ATS-board", "form[id*='application']", "[data-bi-id*='application']"],
      containers: [".fieldRow", ".form-group", ".field", "[class*='FormField']"],
      labels: ["label", "legend", ".fieldLabel", "[class*='Label']"],
      options: ["[role='option']", ".select2-results li"],
      customControls: [".select2-container"],
      dropZones: ["[class*='FileUpload']", "[class*='dropzone']"]
    }),
    recruitee: adapter("Recruitee", [/(^|\.)recruitee\.com$/], {
      signatures: ["[data-testid='application-form']", "form[action*='application']"],
      containers: ["[data-testid*='field']", ".form-field", ".field"],
      labels: ["label", "legend", "[data-testid*='label']"],
      options: ["[role='option']", "[data-testid*='option']"],
      dropZones: ["[data-testid*='upload']", "[class*='dropzone']"]
    }),
    teamtailor: adapter("Teamtailor", [/(^|\.)teamtailor\.com$/], {
      signatures: ["[data-controller*='application']", "form[action*='applications']"],
      containers: ["[data-controller*='question']", ".form-group", ".field"],
      labels: ["label", "legend", "[data-question-label]"],
      options: ["[role='option']", "[data-select-target*='option']"],
      dropZones: ["[data-controller*='upload']", "[class*='dropzone']"]
    }),
    personio: adapter("Personio", [/(^|\.)personio\.(de|com)$/], {
      signatures: ["form[data-testid*='application']", "[data-testid='career-page-application']"],
      containers: ["[data-testid*='field']", ".form-field", ".field"],
      labels: ["label", "legend", "[data-testid*='label']"],
      options: ["[role='option']", "[data-testid*='option']"],
      dropZones: ["[data-testid*='upload']", "[class*='dropzone']"]
    })
  });

  const GENERIC_CONTAINERS = [
    "fieldset", "[role='group']", "[role='radiogroup']", ".application-question",
    ".form-group", ".form-field", ".field", "[data-testid*='field']", "[data-automation-id*='formField']"
  ];
  const GENERIC_LABELS = [
    ":scope > label", ":scope > legend", ":scope > [class*='label']",
    ":scope > [data-testid*='label']", ":scope > [data-automation-id*='label']",
    ":scope > [data-automation-id='promptQuestion']", ":scope > [data-automation-id='questionText']"
  ];
  const GENERIC_OPTIONS = [
    "[role='option']", "[role='listbox'] li", "[data-testid*='option']",
    "[data-automation-id='promptOption']", "[data-automation-id='menuItem']"
  ];
  const CUSTOM_CONTROL_SELECTORS = unique(Object.values(ADAPTERS).flatMap((item) => item.customControls));

  function adapter(displayName, hostPatterns, values) {
    return Object.freeze({
      displayName,
      hostPatterns,
      signatures: values.signatures || [],
      containers: values.containers || [],
      labels: values.labels || [],
      options: values.options || [],
      customControls: values.customControls || [],
      dropZones: values.dropZones || []
    });
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[_\-–—/:()[\]{}.,!?*'\"]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function platformForHost(hostname = "") {
    const host = String(hostname).toLowerCase().replace(/^www\./, "");
    return Object.entries(ADAPTERS).find(([, config]) => config.hostPatterns.some((pattern) => pattern.test(host)))?.[0] || "generic";
  }

  function platformForDocument(hostname = "", root = globalThis.document) {
    const hosted = platformForHost(hostname);
    if (hosted !== "generic" || !root?.querySelector) return hosted;
    return Object.entries(ADAPTERS).find(([, config]) => config.signatures.some((selector) => safeQuery(root, selector)))?.[0] || "generic";
  }

  function configFor(platform) {
    return ADAPTERS[platform] || null;
  }

  function activeConfig(root = globalThis.document) {
    return configFor(platformForDocument(globalThis.location?.hostname || "", root));
  }

  function safeQuery(root, selector) {
    try { return root.querySelector(selector); } catch { return null; }
  }

  function safeQueryAll(root, selector) {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function safeClosest(element, selectors) {
    if (!element?.closest || !selectors.length) return null;
    try { return element.closest(selectors.join(",")); } catch { return null; }
  }

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function fieldContext(element) {
    if (!element) return "";
    const config = activeConfig(element.getRootNode?.() || globalThis.document);
    const container = safeClosest(element, unique([...(config?.containers || []), ...GENERIC_CONTAINERS]));
    if (!container) return "";
    const selectors = unique([...(config?.labels || []).map((selector) => selector.startsWith(":scope") ? selector : `:scope > ${selector}`), ...GENERIC_LABELS]);
    const parts = [];
    for (const selector of selectors) {
      const label = safeQuery(container, selector);
      const text = textOf(label);
      if (text && text.length <= 500) parts.push(text);
    }
    if (!parts.length) {
      const text = textOf(container);
      if (text && text.length <= 700) parts.push(text);
    }
    return unique(parts).join(" ");
  }

  function isCustomControl(element) {
    return Boolean(element?.matches && CUSTOM_CONTROL_SELECTORS.some((selector) => {
      try { return element.matches(selector); } catch { return false; }
    }));
  }

  function customControlOwner(element) {
    if (!element?.closest || !CUSTOM_CONTROL_SELECTORS.length) return null;
    return safeClosest(element, CUSTOM_CONTROL_SELECTORS);
  }

  function customValue(element) {
    if (!isCustomControl(element)) return "";
    const selected = safeQuery(element, [
      ".select2-chosen", ".select2-selection__rendered", ".select__single-value",
      ".select__multi-value", "[class*='select__single-value']", "[class*='select__multi-value']"
    ].join(","));
    const value = textOf(selected) || element.getAttribute("data-value") || "";
    return /^(select|choose|please select)\b|^none$/i.test(value.trim()) ? "" : value.trim();
  }

  function optionCandidates(owner, root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    const config = activeConfig(owner?.getRootNode?.() || root);
    const selectors = unique([...(config?.options || []), ...GENERIC_OPTIONS]);
    return unique(selectors.flatMap((selector) => safeQueryAll(root, selector)));
  }

  async function fillCustomControl(element, rawValue, helpers = {}) {
    if (!isCustomControl(element)) return null;
    const trigger = safeQuery(element, "a,button,[role='combobox'],input") || element;
    if (element.matches?.(".select2-container")) {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
    } else {
      trigger.focus?.();
      trigger.click?.();
    }
    await helpers.sleep?.(60);

    const search = safeQuery(globalThis.document, ".select2-drop-active input.select2-input, .select2-search input, .select__menu input, [class*='select__menu'] input");
    if (search && helpers.setValue) {
      await helpers.setValue(search, rawValue);
      await helpers.sleep?.(80);
    }
    const selected = await helpers.chooseOption?.(rawValue, trigger);
    if (!selected && element.getAttribute("aria-expanded") === "true") trigger.click?.();
    return Boolean(selected || customValue(element));
  }

  function notifyFileAttached(input, transfer) {
    const config = activeConfig(input?.getRootNode?.() || globalThis.document);
    if (!input || !transfer || !config?.dropZones.length) return false;
    const target = safeClosest(input, config.dropZones) || safeClosest(input, config.containers)?.querySelector?.(config.dropZones.join(","));
    if (!target) return false;
    try {
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
      }
      return true;
    } catch {
      return false;
    }
  }

  function displayName(hostname = "", root = globalThis.document) {
    const platform = platformForDocument(hostname, root);
    return ADAPTERS[platform]?.displayName || "Generic form";
  }

  ApplyOS.ATSCompat = Object.freeze({
    adapters: ADAPTERS,
    customControlSelector: CUSTOM_CONTROL_SELECTORS.join(","),
    platformForHost,
    platformForDocument,
    configFor,
    displayName,
    fieldContext,
    optionCandidates,
    isCustomControl,
    customControlOwner,
    customValue,
    fillCustomControl,
    notifyFileAttached
  });
})();
