(function (root) {
  "use strict";

  const queue = [];
  let active = null;
  let dialog = null;
  let suspendedModals = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = element("dialog", "scout-system-dialog");
    dialog.setAttribute("aria-labelledby", "scout-dialog-title");
    dialog.setAttribute("aria-describedby", "scout-dialog-message");
    dialog.innerHTML = `
      <form class="scout-system-dialog__form">
        <header class="scout-system-dialog__header">
          <div><p id="scout-dialog-eyebrow" class="scout-system-dialog__eyebrow"></p><h2 id="scout-dialog-title"></h2></div>
          <button class="scout-system-dialog__close" type="button" aria-label="Close dialog">×</button>
        </header>
        <p id="scout-dialog-message" class="scout-system-dialog__message"></p>
        <ul class="scout-system-dialog__consequences"></ul>
        <div class="scout-system-dialog__fields"></div>
        <p class="scout-system-dialog__error" role="alert"></p>
        <footer class="scout-system-dialog__actions"><button class="scout-system-dialog__cancel" type="button"></button><button class="scout-system-dialog__confirm" type="submit"></button></footer>
      </form>`;
    document.body.append(dialog);
    dialog.querySelector(".scout-system-dialog__close").addEventListener("click", () => finish(null));
    dialog.querySelector(".scout-system-dialog__cancel").addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
    dialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!active) return;
      const result = collectValues(true);
      if (!result.valid) return;
      finish(active.options.mode === "confirm" || active.options.mode === "alert" ? true : result.values);
    });
    return dialog;
  }

  function fieldError(field, value) {
    if (field.required && !String(value).trim()) return `${field.label} is required.`;
    if (field.confirmationText && value !== field.confirmationText) return `Type ${field.confirmationText} exactly to continue.`;
    if (typeof field.validate === "function") return field.validate(value) || "";
    return "";
  }

  function collectValues(showError = false) {
    const values = {};
    let error = "";
    for (const input of dialog.querySelectorAll("[data-scout-dialog-field]")) {
      const field = active.options.fields.find((item) => item.name === input.dataset.scoutDialogField);
      values[field.name] = input.value;
      error ||= fieldError(field, input.value);
    }
    const errorNode = dialog.querySelector(".scout-system-dialog__error");
    errorNode.textContent = showError ? error : "";
    const locked = active.options.fields.some((field) => field.confirmationText && values[field.name] !== field.confirmationText);
    dialog.querySelector(".scout-system-dialog__confirm").disabled = locked;
    return { valid: !error, values };
  }

  function suspendOtherModals() {
    suspendedModals = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((node) => node !== dialog);
    for (const node of suspendedModals) node.setAttribute("aria-modal", "false");
  }

  function restoreOtherModals() {
    for (const node of suspendedModals) if (node.isConnected && node.dataset.state !== "closed") node.setAttribute("aria-modal", "true");
    suspendedModals = [];
  }

  function render(options) {
    const modal = ensureDialog();
    modal.className = `scout-system-dialog tone-${options.tone}`;
    modal.querySelector("#scout-dialog-eyebrow").textContent = options.eyebrow;
    modal.querySelector("#scout-dialog-title").textContent = options.title;
    modal.querySelector("#scout-dialog-message").textContent = options.message;
    modal.querySelector("#scout-dialog-message").classList.toggle("is-empty", !options.message);

    const consequences = modal.querySelector(".scout-system-dialog__consequences");
    consequences.replaceChildren(...options.consequences.map((item) => element("li", "", item)));
    consequences.classList.toggle("is-empty", !options.consequences.length);

    const fields = modal.querySelector(".scout-system-dialog__fields");
    fields.replaceChildren(...options.fields.map((field) => {
      const label = element("label", "scout-system-dialog__field");
      const caption = element("span", "", field.label);
      const input = element("input");
      input.type = field.type || "text";
      input.value = field.value || "";
      input.placeholder = field.placeholder || "";
      input.autocomplete = field.autocomplete || "off";
      input.dataset.scoutDialogField = field.name;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.confirmationText) {
        input.spellcheck = false;
        input.autocapitalize = "characters";
      }
      input.addEventListener("input", () => collectValues(false));
      label.append(caption, input);
      return label;
    }));

    modal.querySelector(".scout-system-dialog__error").textContent = "";
    const cancel = modal.querySelector(".scout-system-dialog__cancel");
    cancel.textContent = options.cancelLabel;
    cancel.classList.toggle("is-hidden", options.mode === "alert");
    const confirm = modal.querySelector(".scout-system-dialog__confirm");
    confirm.textContent = options.confirmLabel;
    confirm.classList.toggle("is-danger", options.tone === "danger");
    confirm.disabled = false;
    collectValues(false);
  }

  function advance() {
    if (active || !queue.length) return;
    active = queue.shift();
    render(active.options);
    suspendOtherModals();
    dialog.showModal();
    requestAnimationFrame(() => {
      const firstField = dialog.querySelector("[data-scout-dialog-field]");
      (firstField || dialog.querySelector(".scout-system-dialog__confirm"))?.focus();
      if (firstField) firstField.select();
    });
  }

  function finish(value) {
    if (!active) return;
    const current = active;
    active = null;
    if (dialog.open) dialog.close();
    restoreOtherModals();
    current.resolve(value);
    queueMicrotask(advance);
  }

  function request(options = {}) {
    const normalized = {
      mode: options.mode || "confirm",
      tone: options.tone || "neutral",
      eyebrow: options.eyebrow || (options.tone === "danger" ? "PLEASE CONFIRM" : "SCOUT CHECKPOINT"),
      title: options.title || "Continue?",
      message: options.message || "",
      consequences: Array.isArray(options.consequences) ? options.consequences.filter(Boolean) : [],
      fields: Array.isArray(options.fields) ? options.fields.map((field, index) => ({ name: field.name || `field_${index}`, label: field.label || "Value", ...field })) : [],
      confirmLabel: options.confirmLabel || "Continue",
      cancelLabel: options.cancelLabel || "Not now"
    };
    return new Promise((resolve) => { queue.push({ options: normalized, resolve }); advance(); });
  }

  root.ScoutDialog = Object.freeze({
    confirm(options) { return request({ ...options, mode: "confirm" }).then(Boolean); },
    alert(options) { return request({ ...options, mode: "alert", confirmLabel: options?.confirmLabel || "Got it" }).then(() => undefined); },
    form(options) { return request({ ...options, mode: "form" }); },
    async prompt(options) {
      const result = await request({ ...options, mode: "form", fields: [{ name: "value", label: options.label || "Value", value: options.value || "", placeholder: options.placeholder || "", required: options.required !== false, maxLength: options.maxLength }] });
      return result ? result.value : null;
    }
  });
})(globalThis);
