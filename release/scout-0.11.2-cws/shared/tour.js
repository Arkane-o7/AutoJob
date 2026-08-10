(function (root) {
  "use strict";

  const STORAGE_KEY = "applyos_tour_progress";
  const VERSION = 2;
  const GAP = 16;
  const EDGE = 12;
  let active = null;

  function blankProgress() {
    return { version: VERSION, setupCompletedAt: null, flows: {} };
  }

  async function readProgress() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    if (!value || value.version !== VERSION || typeof value.flows !== "object") return blankProgress();
    return { ...blankProgress(), ...value, flows: { ...(value.flows || {}) } };
  }

  async function writeProgress(progress) {
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...progress, version: VERSION } });
  }

  async function patchFlow(id, patch) {
    const progress = await readProgress();
    const previous = progress.flows[id] || {};
    progress.flows[id] = { ...previous, ...patch, updatedAt: new Date().toISOString() };
    await writeProgress(progress);
    return progress.flows[id];
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function resolveTarget(step) {
    const value = typeof step.target === "function" ? step.target() : step.target;
    if (value instanceof Element) return value;
    return typeof value === "string" ? document.querySelector(value) : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function buildCard(instance) {
    const card = document.createElement("section");
    card.className = "scout-tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "scout-tour-title");
    card.innerHTML = `
      <p class="scout-tour-kicker"><span></span><span></span></p>
      <h2 id="scout-tour-title"></h2>
      <p class="scout-tour-copy"></p>
      <div class="scout-tour-actions">
        <button class="scout-tour-back" type="button">← Back</button>
        <button class="scout-tour-skip" type="button">Skip tour</button>
        <button class="scout-tour-next" type="button">Next →</button>
      </div>`;
    card.querySelector(".scout-tour-back").addEventListener("click", () => instance.back());
    card.querySelector(".scout-tour-skip").addEventListener("click", () => instance.skip());
    card.querySelector(".scout-tour-next").addEventListener("click", () => instance.next());
    return card;
  }

  function place(instance) {
    if (!instance.target?.isConnected) return;
    const rect = instance.target.getBoundingClientRect();
    const padding = Number(instance.step.padding ?? 7);
    const spot = instance.spotlight;
    spot.style.left = `${Math.max(EDGE, rect.left - padding)}px`;
    spot.style.top = `${Math.max(EDGE, rect.top - padding)}px`;
    spot.style.width = `${Math.min(innerWidth - EDGE * 2, rect.width + padding * 2)}px`;
    spot.style.height = `${Math.min(innerHeight - EDGE * 2, rect.height + padding * 2)}px`;

    const cardRect = instance.card.getBoundingClientRect();
    const preferred = instance.step.placement || "bottom";
    const spaces = {
      bottom: innerHeight - rect.bottom,
      top: rect.top,
      right: innerWidth - rect.right,
      left: rect.left
    };
    const needs = { bottom: cardRect.height + GAP, top: cardRect.height + GAP, right: cardRect.width + GAP, left: cardRect.width + GAP };
    const placement = spaces[preferred] >= needs[preferred]
      ? preferred
      : ["bottom", "top", "right", "left"].sort((a, b) => spaces[b] - spaces[a])[0];
    let top;
    let left;
    if (placement === "bottom" || placement === "top") {
      top = placement === "bottom" ? rect.bottom + GAP : rect.top - cardRect.height - GAP;
      left = clamp(rect.left + rect.width / 2 - cardRect.width / 2, EDGE, innerWidth - cardRect.width - EDGE);
      instance.card.style.setProperty("--scout-tour-arrow", `${clamp(rect.left + rect.width / 2 - left - 10, 16, cardRect.width - 30)}px`);
    } else {
      left = placement === "right" ? rect.right + GAP : rect.left - cardRect.width - GAP;
      top = clamp(rect.top + rect.height / 2 - cardRect.height / 2, EDGE, innerHeight - cardRect.height - EDGE);
      instance.card.style.setProperty("--scout-tour-arrow", `${clamp(rect.top + rect.height / 2 - top - 10, 16, cardRect.height - 30)}px`);
    }
    instance.card.dataset.placement = placement;
    instance.card.style.left = `${clamp(left, EDGE, innerWidth - cardRect.width - EDGE)}px`;
    instance.card.style.top = `${clamp(top, EDGE, innerHeight - cardRect.height - EDGE)}px`;
  }

  class Tour {
    constructor(config, flow) {
      this.config = config;
      this.flow = flow;
      this.index = Math.min(Math.max(0, Number(flow.step || 0)), config.steps.length - 1);
      this.spotlight = document.createElement("div");
      this.spotlight.className = "scout-tour-spotlight";
      this.spotlight.setAttribute("aria-hidden", "true");
      this.card = buildCard(this);
      this.live = document.createElement("div");
      this.live.className = "scout-tour-live";
      this.live.setAttribute("aria-live", "polite");
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.onViewport = () => place(this);
      this.onKeydown = (event) => {
        if (event.key === "Escape") this.skip();
        if (event.key === "ArrowRight" && !event.metaKey && !event.ctrlKey) this.next();
        if (event.key === "ArrowLeft" && !event.metaKey && !event.ctrlKey) this.back();
        if (event.key === "Tab") {
          const controls = [...this.card.querySelectorAll("button:not(:disabled)")];
          if (!controls.length) return;
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
    }

    async mount() {
      document.body.append(this.spotlight, this.card, this.live);
      addEventListener("resize", this.onViewport);
      addEventListener("scroll", this.onViewport, true);
      document.addEventListener("keydown", this.onKeydown, true);
      await this.show(this.index);
    }

    async show(index) {
      const step = this.config.steps[index];
      if (!step) return this.finish();
      if (typeof step.prepare === "function") await step.prepare();
      const target = resolveTarget(step);
      if (!isVisible(target)) {
        if (index < this.config.steps.length - 1) return this.show(index + 1);
        return this.finish();
      }
      this.index = index;
      this.step = step;
      this.target = target;
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      this.card.querySelector(".scout-tour-kicker span:first-child").textContent = step.eyebrow || "QUICK TOUR";
      this.card.querySelector(".scout-tour-kicker span:last-child").textContent = `${index + 1}/${this.config.steps.length}`;
      this.card.querySelector("h2").textContent = step.title;
      this.card.querySelector(".scout-tour-copy").textContent = step.body;
      const back = this.card.querySelector(".scout-tour-back");
      back.disabled = index === 0;
      this.card.querySelector(".scout-tour-next").textContent = step.nextLabel || (index === this.config.steps.length - 1 ? (this.config.finishLabel || "Finish →") : "Next →");
      this.live.textContent = `${step.title}. ${step.body}`;
      await patchFlow(this.config.id, { surface: this.config.surface, step: index, startedAt: this.flow.startedAt || new Date().toISOString(), completedAt: null, dismissedAt: null });
      place(this);
      this.card.querySelector(".scout-tour-next").focus({ preventScroll: true });
    }

    async next() {
      if (this.busy) return;
      this.busy = true;
      try {
        if (typeof this.step.onNext === "function") {
          const handled = await this.step.onNext(this);
          if (handled === false) return;
        }
        if (this.index >= this.config.steps.length - 1) return await this.finish();
        await this.show(this.index + 1);
      } finally { this.busy = false; }
    }

    async back() {
      if (this.busy || this.index <= 0) return;
      this.busy = true;
      try { await this.show(this.index - 1); }
      finally { this.busy = false; }
    }

    async skip() {
      if (this.busy) return;
      this.busy = true;
      await patchFlow(this.config.id, { surface: this.config.surface, step: this.index, dismissedAt: new Date().toISOString(), completedAt: null });
      this.destroy();
      if (typeof this.config.onSkip === "function") await this.config.onSkip();
    }

    async finish() {
      await patchFlow(this.config.id, { surface: this.config.surface, step: this.config.steps.length - 1, completedAt: new Date().toISOString(), dismissedAt: null });
      this.destroy();
      if (typeof this.config.onFinish === "function") await this.config.onFinish();
    }

    destroy() {
      removeEventListener("resize", this.onViewport);
      removeEventListener("scroll", this.onViewport, true);
      document.removeEventListener("keydown", this.onKeydown, true);
      this.spotlight.remove();
      this.card.remove();
      this.live.remove();
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
      if (active === this) active = null;
    }
  }

  async function start(config) {
    if (!config?.id || !config.surface || !Array.isArray(config.steps) || !config.steps.length) return null;
    if (active) active.destroy();
    const progress = await readProgress();
    const forced = config.force === true;
    let flow = progress.flows[config.id] || {};
    if (forced) {
      flow = { surface: config.surface, step: 0, startedAt: new Date().toISOString(), completedAt: null, dismissedAt: null };
      await patchFlow(config.id, flow);
    }
    const shouldStart = forced
      || (config.autoStart === true && !flow.completedAt && !flow.dismissedAt && (!flow.surface || flow.surface === config.surface))
      || (!flow.completedAt && !flow.dismissedAt && flow.surface === config.surface);
    if (!shouldStart) return null;
    active = new Tour(config, flow);
    await active.mount();
    return active;
  }

  async function handoff(id, surface) {
    await patchFlow(id, { surface, step: 0, completedAt: null, dismissedAt: null });
  }

  async function prepareFirstRun() {
    const progress = await readProgress();
    progress.setupCompletedAt = new Date().toISOString();
    progress.flows.main = { surface: "dashboard", step: 0, startedAt: null, completedAt: null, dismissedAt: null, updatedAt: new Date().toISOString() };
    await writeProgress(progress);
  }

  root.ScoutTour = Object.freeze({ VERSION, STORAGE_KEY, start, handoff, prepareFirstRun, readProgress, patchFlow });
})(globalThis);
