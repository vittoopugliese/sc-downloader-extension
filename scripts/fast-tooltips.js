(() => {
  "use strict";

  const SHOW_DELAY_MS = 372;
  const STORAGE_KEY = "scdl.tooltips.enabled";
  const ENABLED_ATTRIBUTE = "data-scdl-tooltips-enabled";
  function readEnabled() {
    const value = document.documentElement?.getAttribute(ENABLED_ATTRIBUTE);
    if (value !== null && value !== undefined) return value !== "false";
    try { return localStorage.getItem(STORAGE_KEY) !== "false"; } catch { return true; }
  }
  let enabled = readEnabled();
  const suppressedTitles = new Map();
  const observedRoots = new Set();
  const tooltip = document.createElement("div");
  tooltip.id = "scdl-fast-tooltip";
  tooltip.setAttribute("role", "tooltip");
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "2147483647",
    boxSizing: "border-box",
    width: "max-content",
    maxWidth: "min(280px, calc(100vw - 16px))",
    padding: "6px 8px",
    border: "1px solid rgba(255, 255, 255, .2)",
    borderRadius: "6px",
    color: "#fff",
    background: "rgba(20, 20, 22, .96)",
    boxShadow: "0 3px 12px rgba(0, 0, 0, .35)",
    font: "500 12px/1.25 system-ui, -apple-system, sans-serif",
    letterSpacing: "normal",
    textAlign: "center",
    whiteSpace: "normal",
    pointerEvents: "none",
    transform: "translateX(-50%)",
    visibility: "hidden",
  });

  let activeButton = null;
  let savedTitle = null;
  let showTimer = null;
  const listenedRoots = new WeakSet();

  function suppressTitle(element) {
    if (!element.isConnected) return;
    const title = element.getAttribute?.("title");
    if (!title) return;
    suppressedTitles.set(element, title);
    // Empty titles also prevent native tooltips inherited from ancestors.
    element.setAttribute("title", "");
  }

  function suppressTitles(root) {
    suppressTitle(root);
    root.querySelectorAll?.("[title]").forEach(suppressTitle);
  }

  function applyEnabled() {
    enabled = readEnabled();
    hide();
    if (!enabled) {
      tooltip.style.setProperty("display", "none", "important");
      observedRoots.forEach(suppressTitles);
    } else {
      tooltip.style.removeProperty("display");
      for (const [element, title] of suppressedTitles) {
        if (element.getAttribute("title") === "") element.setAttribute("title", title);
      }
      suppressedTitles.clear();
    }
  }

  function mount() {
    // Content scripts run at document_start, before <html> exists.
    if (document.body && !tooltip.isConnected) document.documentElement.append(tooltip);
  }

  function buttonFromEvent(event) {
    const path = event.composedPath();
    path.filter((node) => node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host).forEach(listen);
    return path.find((node) =>
      node?.tagName === "BUTTON" ||
      node?.hasAttribute?.("data-scdl-tooltip") ||
      (node?.tagName === "SELECT" && node.classList.contains("popup-control-btn")) ||
      (node?.tagName === "INPUT" && node.classList.contains("popup-control-input"))
    ) || null;
  }

  function position() {
    if (!activeButton || !activeButton.isConnected) {
      hide();
      return;
    }
    const rect = activeButton.getBoundingClientRect();
    const gap = 6;
    const above = rect.top >= tooltip.offsetHeight + gap + 8;
    const center = rect.left + rect.width / 2;
    const halfWidth = tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.max(halfWidth + 8, Math.min(center, innerWidth - halfWidth - 8))}px`;
    tooltip.style.top = `${above ? rect.top - gap - tooltip.offsetHeight : rect.bottom + gap}px`;
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    tooltip.style.visibility = "hidden";
    if (activeButton && savedTitle !== null && !activeButton.hasAttribute("title")) {
      activeButton.setAttribute("title", savedTitle);
    }
    activeButton = null;
    savedTitle = null;
  }

  function show(button) {
    if (!enabled) return;
    if (button === activeButton) return;
    hide();
    if (!button || button.hidden) return;
    const title = button.getAttribute("title");
    const label = button.getAttribute("data-scdl-tooltip") || title || button.getAttribute("aria-label") || button.textContent?.trim();
    if (!label) return;
    activeButton = button;
    savedTitle = title;
    if (title !== null) button.removeAttribute("title");
    showTimer = setTimeout(() => {
      if (!enabled || activeButton !== button || !button.isConnected) return;
      mount();
      tooltip.style.maxWidth = button.hasAttribute("data-scdl-tooltip")
        ? "min(440px, calc(100vw - 16px))" : "min(280px, calc(100vw - 16px))";
      tooltip.textContent = button.getAttribute("data-scdl-tooltip") || label;
      position();
      tooltip.style.visibility = "visible";
    }, SHOW_DELAY_MS);
  }

  function onPointerOver(event) {
    if (event.pointerType !== "touch") show(buttonFromEvent(event));
  }

  function onPointerMove(event) {
    if (event.pointerType !== "touch") show(buttonFromEvent(event));
  }

  function onPointerOut(event) {
    const button = buttonFromEvent(event);
    if (button && button === activeButton && !button.contains(event.relatedTarget)) hide();
  }

  function onFocusIn(event) {
    show(buttonFromEvent(event));
  }

  function onFocusOut(event) {
    if (buttonFromEvent(event) === activeButton) hide();
  }

  function listen(root) {
    if (!observedRoots.has(root) && !enabled) suppressTitles(root);
    observedRoots.add(root);
    if (listenedRoots.has(root)) return;
    listenedRoots.add(root);
    new MutationObserver((records) => {
      mount();
      for (const record of records) {
        if (record.type === "attributes") {
          if (!enabled) suppressTitle(record.target);
        } else {
          record.addedNodes.forEach((node) => {
            if (!enabled) suppressTitles(node);
            discoverShadowRoots(node);
          });
        }
      }
      // Release detached controls instead of retaining old tracks indefinitely.
      for (const [element, title] of suppressedTitles) {
        if (!element.isConnected) {
          if (element.getAttribute("title") === "") element.setAttribute("title", title);
          suppressedTitles.delete(element);
        }
      }
      for (const observed of observedRoots) {
        if (observed.host && !observed.host.isConnected) observedRoots.delete(observed);
      }
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
    root.addEventListener("pointerover", onPointerOver, true);
    root.addEventListener("pointermove", onPointerMove, true);
    root.addEventListener("pointerout", onPointerOut, true);
    root.addEventListener("focusin", onFocusIn, true);
    root.addEventListener("focusout", onFocusOut, true);
    root.addEventListener("scroll", onScroll, true);
  }

  function onScroll() {
    if (activeButton && tooltip.style.visibility === "visible") position();
  }

  function discoverShadowRoots(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.shadowRoot) {
      listen(node.shadowRoot);
      for (const child of node.shadowRoot.children) discoverShadowRoots(child);
    }
    node.querySelectorAll?.("*").forEach((element) => {
      if (element.shadowRoot) {
        listen(element.shadowRoot);
        for (const child of element.shadowRoot.children) discoverShadowRoots(child);
      }
    });
  }

  listen(document);
  discoverShadowRoots(document.documentElement);
  document.addEventListener("scdl:tooltips-changed", applyEnabled);
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    document.documentElement?.removeAttribute(ENABLED_ATTRIBUTE);
    applyEnabled();
  });
  applyEnabled();
  window.addEventListener("resize", () => {
    if (activeButton && tooltip.style.visibility === "visible") position();
  });
  mount();
})();
