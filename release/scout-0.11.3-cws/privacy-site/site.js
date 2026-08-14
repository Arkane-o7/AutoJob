(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const demo = document.querySelector("[data-product-demo]");
  const fields = demo ? Array.from(demo.querySelectorAll("[data-demo-field]")) : [];
  const inlineFillStatus = demo?.querySelector("[data-inline-fill-status]");
  const incomingCard = demo?.querySelector("[data-incoming-card]");
  let runTimer = 0;
  let stepTimers = [];

  const clearDemoTimers = () => {
    window.clearTimeout(runTimer);
    stepTimers.forEach(window.clearTimeout);
    stepTimers = [];
  };

  const showFinishedDemo = () => {
    fields.forEach((field) => field.classList.add("is-filled"));
    inlineFillStatus?.classList.add("is-complete");
    incomingCard?.classList.add("is-visible");
  };

  const resetDemo = () => {
    fields.forEach((field, index) => field.classList.toggle("is-filled", index === 0));
    inlineFillStatus?.classList.remove("is-complete");
    incomingCard?.classList.remove("is-visible");
  };

  const runDemo = () => {
    clearDemoTimers();
    resetDemo();

    fields.slice(1).forEach((field, index) => {
      stepTimers.push(window.setTimeout(() => {
        field.classList.add("is-filled");
      }, 450 + index * 240));
    });

    stepTimers.push(window.setTimeout(() => inlineFillStatus?.classList.add("is-complete"), 1700));
    stepTimers.push(window.setTimeout(() => {
      incomingCard?.classList.add("is-visible");
    }, 2300));
    runTimer = window.setTimeout(runDemo, 6200);
  };

  if (demo) {
    if (reducedMotion.matches) {
      showFinishedDemo();
    } else {
      const demoObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) runDemo();
        else clearDemoTimers();
      }, { threshold: 0.18 });
      demoObserver.observe(demo);
    }
  }

  reducedMotion.addEventListener("change", (event) => {
    clearDemoTimers();
    if (event.matches) showFinishedDemo();
    else runDemo();
  });

  const reveals = document.querySelectorAll(".reveal");
  if (reducedMotion.matches) {
    reveals.forEach((item) => item.classList.add("is-revealed"));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    reveals.forEach((item) => revealObserver.observe(item));
  }

  document.querySelectorAll("[data-year]").forEach((node) => {
    node.textContent = new Date().getFullYear().toString();
  });
})();
