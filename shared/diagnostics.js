(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const Diagnostics = ApplyOS.Diagnostics = ApplyOS.Diagnostics || {};
  const SAFE_ATTRIBUTES = new Set([
    "aria-labelledby", "aria-describedby", "aria-required", "aria-haspopup",
    "aria-expanded", "aria-controls", "data-automation-id", "data-testid", "data-test", "data-ui"
  ]);
  const SECRET_KEY = /^(?:value|checked|selected|files?|filename|outerhtml|innerhtml|textcontent|innertext)$/i;

  function sourceDomain(value) {
    try { return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return "unknown"; }
  }

  function redact(value, maxLength = 240) {
    let text = String(value || "")
      .replace(/data:[^\s,;]+(?:;base64)?,[^\s]+/gi, "[redacted-data]")
      .replace(/(?:https?:\/\/|www\.)\S+/gi, "[redacted-url]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/\b(?:[A-Za-z0-9+/_-]{20,}={0,2})\b/g, "[redacted-token]")
      .replace(/(?:\+?\d[\s().-]*){8,}\d/g, "[redacted-phone]")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
    return text;
  }

  function safeAttributes(entries) {
    const result = {};
    for (const [rawName, rawValue] of Object.entries(entries || {})) {
      const name = String(rawName || "").toLowerCase();
      if (!SAFE_ATTRIBUTES.has(name) || SECRET_KEY.test(name)) continue;
      const value = redact(rawValue, 120);
      if (value) result[name] = value;
    }
    return result;
  }

  function ancestorStructure(items) {
    return (Array.isArray(items) ? items : []).slice(0, 4).map((item) => ({
      tag: redact(item?.tag, 24).toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown",
      ...(item?.role ? { role: redact(item.role, 48) } : {})
    }));
  }

  Diagnostics.redact = redact;
  Diagnostics.sourceDomain = sourceDomain;
  Diagnostics.safeAttributes = safeAttributes;
  Diagnostics.ancestorStructure = ancestorStructure;

  Diagnostics.describeField = function describeField(raw = {}) {
    const type = String(raw.type || "").toLowerCase();
    if (raw.hidden || type === "hidden") return null;
    const label = redact(raw.label, 300);
    return {
      label: label || "Unlabelled field",
      tag: redact(raw.tag, 24).toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown",
      type: redact(type, 48),
      role: redact(raw.role, 48),
      required: Boolean(raw.required),
      autocomplete: redact(raw.autocomplete, 80),
      attributes: safeAttributes(raw.attributes),
      ancestors: ancestorStructure(raw.ancestors)
    };
  };

  Diagnostics.buildReport = function buildReport(input = {}) {
    const fields = (Array.isArray(input.fields) ? input.fields : [])
      .map((field) => Diagnostics.describeField(field))
      .filter(Boolean)
      .slice(0, 80);
    return {
      report_version: 1,
      generated_at: new Date(input.generatedAt || Date.now()).toISOString(),
      source_domain: sourceDomain(input.pageUrl),
      platform: redact(input.platform || "generic", 80),
      extension_version: redact(input.extensionVersion || "unknown", 40),
      fields
    };
  };

  Diagnostics.supportEnvelope = function supportEnvelope(report = {}, details = {}) {
    const safe = Diagnostics.buildReport({
      pageUrl: `https://${sourceDomain(`https://${report.source_domain || "unknown"}`)}`,
      platform: report.platform,
      extensionVersion: report.extension_version,
      generatedAt: report.generated_at,
      fields: report.fields
    });
    return {
      description: redact(details.description, 2000),
      expected_behavior: redact(details.expected_behavior, 2000),
      actual_behavior: redact(details.actual_behavior, 2000),
      diagnostic_payload: safe
    };
  };
})(globalThis);
