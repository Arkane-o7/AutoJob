(function (/** @type {any} */ root) {
  "use strict";

  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  const fields = ["name", "email", "company", "title", "phone", "linkedin_url", "relationship", "tags"];
  const aliases = {
    name: ["name", "full name", "contact"],
    email: ["email", "email address"],
    company: ["company", "organization"],
    title: ["title", "role", "job title"],
    phone: ["phone", "phone number"],
    linkedin_url: ["linkedin", "linkedin url", "profile url"],
    relationship: ["relationship", "type"],
    tags: ["tags", "labels"]
  };

  function parseMatrix(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(field); field = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field);
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        field = "";
      } else field += char;
    }
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
    if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
    return rows;
  }

  function normalizedWebUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const parsed = new URL(text.includes("://") ? text : `https://${text}`);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch { return ""; }
  }

  function normalizedLinkedIn(value) {
    return normalizedWebUrl(value).replace(/\/$/, "").toLowerCase();
  }

  ApplyOS.CONTACT_IMPORT_FIELDS = Object.freeze(fields);

  ApplyOS.parseContactCSV = function parseContactCSV(text, options = {}) {
    const matrix = parseMatrix(String(text || "").replace(/^\uFEFF/, ""));
    if (matrix.length < 2) throw new Error("The CSV needs a header and at least one contact.");
    const maxRows = Number.isInteger(options.maxRows) ? options.maxRows : 500;
    if (matrix.length - 1 > maxRows) throw new Error(`Import at most ${maxRows} contacts at a time.`);
    const headers = matrix[0].map((value, index) => value.trim() || `Column ${index + 1}`);
    const width = headers.length;
    return {
      headers,
      rows: matrix.slice(1).map((values, index) => ({ rowNumber: index + 2, values: Array.from({ length: width }, (_, column) => String(values[column] || "").trim()) }))
    };
  };

  ApplyOS.inferContactImportMapping = function inferContactImportMapping(headers = []) {
    const normalized = headers.map((value) => String(value).trim().toLowerCase());
    return Object.fromEntries(fields.map((field) => [field, normalized.findIndex((header) => aliases[field].includes(header))]));
  };

  ApplyOS.stageContactImport = function stageContactImport(parsed, mapping = {}, contacts = []) {
    const nameColumn = Number(mapping.name);
    return parsed.rows.map((row) => {
      const value = (field) => Number(mapping[field]) >= 0 ? row.values[Number(mapping[field])] || "" : "";
      const relationshipValue = value("relationship").toLowerCase().replace(/\s+/g, "_");
      const input = {
        name: value("name"),
        email: value("email"),
        company: value("company"),
        title: value("title"),
        phone: value("phone"),
        linkedin_url: value("linkedin_url"),
        relationship: ApplyOS.CONTACT_RELATIONSHIPS.includes(relationshipValue) ? relationshipValue : "other",
        tags: value("tags").split(/[;|]/).map((tag) => tag.trim()).filter(Boolean)
      };
      const errors = [];
      if (!Number.isInteger(nameColumn) || nameColumn < 0) errors.push("Map a name column.");
      else if (!input.name) errors.push("Name is required.");
      if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push("Email is not valid.");
      if (input.linkedin_url && !normalizedWebUrl(input.linkedin_url)) errors.push("LinkedIn URL is not valid.");
      const email = input.email.toLowerCase();
      const linkedin = normalizedLinkedIn(input.linkedin_url);
      const name = input.name.trim().toLowerCase();
      const duplicateCandidates = contacts.map((contact) => {
        const exactEmail = Boolean(email && String(contact.email || "").trim().toLowerCase() === email);
        const exactLinkedIn = Boolean(linkedin && normalizedLinkedIn(contact.linkedin_url) === linkedin);
        const sameName = Boolean(name && String(contact.name || "").trim().toLowerCase() === name);
        return { contactId: contact.id, name: contact.name, exact: exactEmail || exactLinkedIn, reason: exactEmail ? "email" : exactLinkedIn ? "linkedin" : sameName ? "name" : "" };
      }).filter((candidate) => candidate.reason);
      const exact = duplicateCandidates.find((candidate) => candidate.exact);
      const decision = errors.length ? "skip" : exact ? "merge" : duplicateCandidates.length ? "skip" : "create";
      return { rowNumber: row.rowNumber, input, errors, duplicateCandidates, decision, mergeTargetId: exact?.contactId || null };
    });
  };
})(globalThis);
