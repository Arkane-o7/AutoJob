(function installScoutControls(root) {
  "use strict";

  const states = new WeakMap();
  const controllers = new Set();
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const indexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  let activeController = null;
  let sequence = 0;
  let typeahead = "";
  let typeaheadTimer = 0;

  function optionLabel(option) {
    return String(option.label || option.textContent || option.value || "").trim();
  }

  function accessibleName(select) {
    const explicit = select.getAttribute("aria-label");
    if (explicit) return explicit;
    const label = [...(select.labels || [])][0];
    if (!label) return select.name || "Choose an option";
    const clone = label.cloneNode(true);
    clone.querySelectorAll("select, .scout-select").forEach((node) => node.remove());
    return clone.textContent.trim() || select.name || "Choose an option";
  }

  function isCompact(select) {
    return Boolean(select.closest(".scout-header__profile, .profile-strip, .record-controls, .toolbar, .action-filters"));
  }

  function setObservedProperty(select, name, descriptor, sync) {
    if (!descriptor?.get || !descriptor?.set || Object.hasOwn(select, name)) return;
    Object.defineProperty(select, name, {
      configurable: true,
      get() { return descriptor.get.call(select); },
      set(value) {
        descriptor.set.call(select, value);
        queueMicrotask(sync);
      }
    });
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || select.multiple || states.has(select)) return states.get(select) || null;

    if (!select.id) select.id = `scout-select-${++sequence}`;

    const wrapper = document.createElement("span");
    wrapper.className = "scout-select";
    wrapper.dataset.scoutSelectFor = select.id;

    const trigger = document.createElement("div");
    trigger.className = "scout-select__trigger";
    trigger.tabIndex = select.disabled ? -1 : 0;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", accessibleName(select));
    if (select.hasAttribute("aria-describedby")) trigger.setAttribute("aria-describedby", select.getAttribute("aria-describedby"));

    const value = document.createElement("span");
    value.className = "scout-select__value";
    const chevron = document.createElement("span");
    chevron.className = "scout-select__chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(value, chevron);

    const menu = document.createElement("div");
    menu.id = `${select.id}-scout-menu`;
    menu.className = `scout-select__menu${isCompact(select) ? " is-compact" : ""}`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", accessibleName(select));
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);

    select.before(wrapper);
    wrapper.append(select, trigger);
    (select.closest("dialog") || document.body).append(menu);
    select.classList.add("scout-select__native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    let activeIndex = -1;
    let optionNodes = [];
    let optionObserver;

    function options() {
      return [...select.options];
    }

    function selectedIndex() {
      const list = options();
      const current = indexDescriptor.get.call(select);
      return current >= 0 && !list[current]?.disabled ? current : list.findIndex((option) => !option.disabled);
    }

    function renderOptions() {
      const fragment = document.createDocumentFragment();
      optionNodes = [];
      let lastGroup = null;
      options().forEach((option, index) => {
        const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "";
        if (group && group !== lastGroup) {
          const heading = document.createElement("div");
          heading.className = "scout-select__group";
          heading.textContent = group;
          fragment.append(heading);
        }
        lastGroup = group;
        const row = document.createElement("div");
        row.id = `${menu.id}-option-${index}`;
        row.className = "scout-select__option";
        row.dataset.optionIndex = String(index);
        row.setAttribute("role", "option");
        row.setAttribute("aria-disabled", String(option.disabled || option.parentElement?.disabled || false));
        row.textContent = optionLabel(option);
        optionNodes.push(row);
        fragment.append(row);
      });
      menu.replaceChildren(fragment);
      sync();
    }

    function sync() {
      const list = options();
      const current = indexDescriptor.get.call(select);
      const selected = list[current] || list.find((option) => option.selected) || null;
      value.textContent = selected ? optionLabel(selected) : "Choose…";
      wrapper.dataset.disabled = String(select.disabled);
      wrapper.hidden = select.hidden || select.classList.contains("hidden");
      trigger.tabIndex = select.disabled ? -1 : 0;
      trigger.setAttribute("aria-disabled", String(select.disabled));
      trigger.setAttribute("aria-label", accessibleName(select));
      optionNodes.forEach((node, index) => {
        node.setAttribute("aria-selected", String(index === current));
        node.dataset.active = String(index === activeIndex);
      });
      if (activeIndex >= 0 && optionNodes[activeIndex]) trigger.setAttribute("aria-activedescendant", optionNodes[activeIndex].id);
      else trigger.removeAttribute("aria-activedescendant");
      if (select.disabled && wrapper.dataset.open === "true") close();
    }

    function positionMenu() {
      if (menu.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const gap = 7;
      const width = Math.min(Math.max(rect.width, 150), Math.max(150, viewportWidth - 16));
      const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
      const below = Math.max(0, viewportHeight - rect.bottom - gap - 8);
      const above = Math.max(0, rect.top - gap - 8);
      const placeAbove = below < 150 && above > below;
      const available = placeAbove ? above : below;
      const maxHeight = Math.max(96, Math.min(272, available));
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${maxHeight}px`;
      menu.style.left = `${left}px`;
      menu.dataset.placement = placeAbove ? "top" : "bottom";
      const menuHeight = Math.min(menu.scrollHeight, maxHeight);
      menu.style.top = `${placeAbove ? Math.max(8, rect.top - gap - menuHeight) : rect.bottom + gap}px`;
    }

    function setActive(index, scroll = true) {
      const list = options();
      if (!list.length) return;
      let next = Math.max(0, Math.min(index, list.length - 1));
      const direction = next >= activeIndex ? 1 : -1;
      while (list[next] && (list[next].disabled || list[next].parentElement?.disabled)) {
        next += direction;
        if (next < 0 || next >= list.length) return;
      }
      activeIndex = next;
      sync();
      if (scroll) optionNodes[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function open() {
      if (select.disabled || wrapper.dataset.open === "true") return;
      activeController?.close();
      renderOptions();
      activeIndex = selectedIndex();
      wrapper.dataset.open = "true";
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      activeController = controller;
      sync();
      positionMenu();
      optionNodes[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function close() {
      if (wrapper.dataset.open !== "true") return;
      wrapper.dataset.open = "false";
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      menu.hidden = true;
      activeIndex = -1;
      if (activeController === controller) activeController = null;
    }

    function choose(index) {
      const option = options()[index];
      if (!option || option.disabled || option.parentElement?.disabled) return;
      valueDescriptor.set.call(select, option.value);
      sync();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      trigger.focus();
    }

    function move(direction) {
      if (wrapper.dataset.open !== "true") open();
      const start = activeIndex < 0 ? selectedIndex() : activeIndex;
      setActive(start + direction);
    }

    function onTriggerClick(event) {
      event.preventDefault();
      event.stopPropagation();
      trigger.focus();
      if (wrapper.dataset.open === "true") close();
      else open();
    }

    function onTriggerKeydown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (wrapper.dataset.open !== "true") open();
        setActive(event.key === "Home" ? 0 : options().length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (wrapper.dataset.open === "true" && activeIndex >= 0) choose(activeIndex);
        else open();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        typeahead += event.key.toLocaleLowerCase();
        clearTimeout(typeaheadTimer);
        typeaheadTimer = setTimeout(() => { typeahead = ""; }, 650);
        const index = options().findIndex((option) => !option.disabled && optionLabel(option).toLocaleLowerCase().startsWith(typeahead));
        if (index >= 0) {
          event.preventDefault();
          if (wrapper.dataset.open !== "true") open();
          setActive(index);
        }
      }
    }

    function onMenuClick(event) {
      const option = event.target.closest("[data-option-index]");
      if (!option) return;
      event.preventDefault();
      choose(Number(option.dataset.optionIndex));
    }

    function onMenuPointerMove(event) {
      const option = event.target.closest("[data-option-index]");
      if (option) setActive(Number(option.dataset.optionIndex), false);
    }

    function onSelectFocus() {
      trigger.focus();
    }

    const labelListeners = [...(select.labels || [])].map((label) => {
      const listener = (event) => {
        if (event.target.closest?.(".scout-select")) return;
        event.preventDefault();
        trigger.focus();
        open();
      };
      label.addEventListener("click", listener);
      return [label, listener];
    });

    const controller = {
      select, wrapper, trigger, menu, close, open, sync, renderOptions, positionMenu,
      destroy() {
        close();
        optionObserver.disconnect();
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKeydown);
        menu.removeEventListener("click", onMenuClick);
        menu.removeEventListener("pointermove", onMenuPointerMove);
        select.removeEventListener("change", sync);
        select.removeEventListener("focus", onSelectFocus);
        labelListeners.forEach(([label, listener]) => label.removeEventListener("click", listener));
        menu.remove();
        controllers.delete(controller);
        states.delete(select);
      }
    };

    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKeydown);
    menu.addEventListener("pointerdown", (event) => event.preventDefault());
    menu.addEventListener("click", onMenuClick);
    menu.addEventListener("pointermove", onMenuPointerMove);
    select.addEventListener("change", sync);
    select.addEventListener("focus", onSelectFocus);

    optionObserver = new MutationObserver(renderOptions);
    optionObserver.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden", "label", "selected", "class"] });
    setObservedProperty(select, "value", valueDescriptor, sync);
    setObservedProperty(select, "selectedIndex", indexDescriptor, sync);

    states.set(select, controller);
    controllers.add(controller);
    renderOptions();
    return controller;
  }

  function enhanceAll(scope = document) {
    if (scope instanceof HTMLSelectElement) enhance(scope);
    scope.querySelectorAll?.("select:not([multiple])").forEach(enhance);
  }

  function cleanDetached() {
    controllers.forEach((controller) => {
      if (!controller.select.isConnected) controller.destroy();
    });
  }

  function init() {
    enhanceAll();
    const observer = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceAll(node);
      }));
      cleanDetached();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!activeController) return;
    if (activeController.trigger.contains(event.target) || activeController.menu.contains(event.target)) return;
    activeController.close();
  }, true);
  document.addEventListener("reset", (event) => setTimeout(() => enhanceAll(event.target), 0), true);
  window.addEventListener("resize", () => activeController?.positionMenu());
  window.addEventListener("scroll", () => activeController?.positionMenu(), true);
  window.addEventListener("blur", () => activeController?.close());

  root.ScoutSelect = Object.freeze({
    enhance,
    enhanceAll,
    refresh(select) { states.get(select)?.renderOptions(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(globalThis);
