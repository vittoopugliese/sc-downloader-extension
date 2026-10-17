(() => {
  "use strict";

  // The one tooltip of the extension: Player Tools and Likes Explorer on SoundCloud, the
  // popup and the Stem Extractor. Any element with a title or data-scdl-tooltip, and icon
  // buttons with an aria-label, show this tooltip instead of the browser's.
  //
  // Cost: while tooltips are on, the script only listens to pointer and focus events and
  // watches the hovered control's tooltip text. While off, it blanks every title so the
  // browser shows none, and watches the DOM for new ones. A press hides the tooltip; on
  // release it comes back with the current text (a knob's new value).
  // A title set while hovered stays in the DOM: pages that rewrite text under the pointer
  // (knobs, pads) use data-scdl-tooltip, which the browser never shows.
  //
  // On/off is the localStorage key below, or the attribute on <html> set by a page script
  // in another JS world (Player Tools); `scdl:tooltips-changed` on document re-reads it.
  // Pages in the same world can use globalThis.SCTooltips.
  if (globalThis.SCTooltips) return;

  const SHOW_DELAY_MS = 372;
  const STORAGE_KEY = "scdl.tooltips.enabled";
  const ENABLED_ATTRIBUTE = "data-scdl-tooltips-enabled";
  const supportsPopover = typeof HTMLElement.prototype.showPopover === "function";
  function readEnabled() {
    const value = document.documentElement?.getAttribute(ENABLED_ATTRIBUTE);
    if (value !== null && value !== undefined) return value !== "false";
    try { return localStorage.getItem(STORAGE_KEY) !== "false"; } catch { return true; }
  }
  let enabled = readEnabled();

  const tooltip = document.createElement("div");
  tooltip.id = "scdl-fast-tooltip";
  tooltip.setAttribute("role", "tooltip");
  // A manual popover sits in the top layer, so it also shows over modal dialogs.
  if (supportsPopover) tooltip.popover = "manual";
  Object.assign(tooltip.style, {
    position: "fixed",
    inset: "auto",
    margin: "0",
    zIndex: "2147483647",
    boxSizing: "border-box",
    width: "max-content",
    height: "auto",
    maxWidth: "min(280px, calc(100vw - 16px))",
    overflow: "visible",
    padding: "6px 8px",
    border: "1px solid rgba(255, 255, 255, .2)",
    borderRadius: "6px",
    color: "#fff",
    background: "rgba(20, 20, 22, .96)",
    boxShadow: "0 3px 12px rgba(0, 0, 0, .35)",
    font: "500 12px/1.25 system-ui, -apple-system, sans-serif",
    letterSpacing: "normal",
    textAlign: "center",
    whiteSpace: "pre-line",
    pointerEvents: "none",
    transform: "translateX(-50%)",
    visibility: "hidden",
  });

  let active = null;      // the element whose tooltip is pending or shown
  let savedTitle = null;  // its title, removed while active so the browser shows none
  let showTimer = null;
  let muted = false;      // pressed: hidden until release
  let anchor = null;      // pointer position when a hover started
  let lastTarget = null;
  const pointer = { x: 0, y: 0 };

  const isControl = (node) => node.tagName === "BUTTON" ||
    (node.tagName === "SELECT" && node.classList.contains("popup-control-btn")) ||
    (node.tagName === "INPUT" && node.classList.contains("popup-control-input"));

  // The text an element shows: its custom tooltip, its title, or the aria-label of a
  // control whose visible text does not already say it.
  function labelFor(node, title = node.getAttribute("title")) {
    const custom = node.getAttribute("data-scdl-tooltip");
    if (custom) return custom;
    if (title) return title;
    if (title === "" || !isControl(node)) return "";
    const label = node.getAttribute("aria-label")?.trim();
    return label && label !== node.textContent.trim() ? label : "";
  }

  function targetFrom(event) {
    const path = event.composedPath();
    for (const node of path) if (node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host) listen(node);
    for (const node of path) {
      if (node?.nodeType !== Node.ELEMENT_NODE) continue;
      if (node === active || labelFor(node)) return node;
      // An empty title deliberately hides the titles of the elements around it.
      if (node.getAttribute("title") === "") return null;
    }
    return null;
  }

  // Follows the hovered control's text while it changes.
  const titleWatch = new MutationObserver(() => {
    if (!active) return;
    const title = active.getAttribute("title");
    if (title) savedTitle = title;
    if (tooltip.style.visibility !== "visible") return;
    const label = labelFor(active, savedTitle);
    if (label) { tooltip.textContent = label; position(); } else conceal();
  });

  function mount() {
    if (document.body && !tooltip.isConnected) document.documentElement.append(tooltip);
  }

  function position() {
    if (!active || !active.isConnected) {
      hide();
      return;
    }
    let rect = active.getBoundingClientRect();
    // Big areas (a ruler, a lane) anchor at the pointer, like native titles.
    if (anchor && (rect.width > 320 || rect.height > 120)) {
      rect = { left: anchor.x, width: 0, top: anchor.y - 4, bottom: anchor.y + 20 };
    }
    const gap = 6;
    const above = rect.top >= tooltip.offsetHeight + gap + 8;
    const center = rect.left + rect.width / 2;
    const halfWidth = tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.max(halfWidth + 8, Math.min(center, innerWidth - halfWidth - 8))}px`;
    tooltip.style.top = `${above ? rect.top - gap - tooltip.offsetHeight : rect.bottom + gap}px`;
  }

  function conceal() {
    tooltip.style.visibility = "hidden";
    if (supportsPopover && tooltip.matches(":popover-open")) tooltip.hidePopover();
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    titleWatch.disconnect();
    conceal();
    if (active && savedTitle !== null && !active.hasAttribute("title")) active.setAttribute("title", savedTitle);
    active = null;
    savedTitle = null;
    muted = false;
  }

  function show(target, fromPointer) {
    if (!enabled || target === active) return;
    hide();
    if (!target || target.hidden || !labelFor(target)) return;
    const title = target.getAttribute("title");
    active = target;
    savedTitle = title;
    anchor = fromPointer ? { x: pointer.x, y: pointer.y } : null;
    if (title !== null) target.removeAttribute("title");
    if (fromPointer) titleWatch.observe(target, { attributes: true, attributeFilter: ["title", "data-scdl-tooltip"] });
    schedule(target);
  }

  function schedule(target) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = null;
      if (!enabled || muted || active !== target || !target.isConnected) return;
      const label = labelFor(target, savedTitle);
      if (!label) return;
      mount();
      tooltip.style.maxWidth = target.hasAttribute("data-scdl-tooltip")
        ? "min(440px, calc(100vw - 16px))" : "min(280px, calc(100vw - 16px))";
      tooltip.textContent = label;
      if (supportsPopover) {
        // Showing again moves it above a dialog opened since.
        if (tooltip.matches(":popover-open")) tooltip.hidePopover();
        tooltip.showPopover();
      }
      position();
      tooltip.style.visibility = "visible";
    }, SHOW_DELAY_MS);
  }

  function onPointerOver(event) {
    if (!enabled || event.pointerType === "touch") return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    lastTarget = event.target;
    show(targetFrom(event), true);
  }

  function onPointerMove(event) {
    if (!enabled || event.pointerType === "touch") return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (event.target === lastTarget) return;
    lastTarget = event.target;
    show(targetFrom(event), true);
  }

  function onPointerOut(event) {
    lastTarget = null;
    if (!active) return;
    if (targetFrom(event) === active && !active.contains(event.relatedTarget)) hide();
  }

  function onPointerDown() {
    if (!active) return;
    clearTimeout(showTimer);
    showTimer = null;
    muted = true;
    conceal();
  }

  function onPointerUp() {
    if (!active || !muted) return;
    muted = false;
    schedule(active);
  }

  function onFocusIn(event) {
    if (enabled) show(targetFrom(event), false);
  }

  function onFocusOut(event) {
    if (active && targetFrom(event) === active) hide();
  }

  function onScroll() {
    if (active && tooltip.style.visibility === "visible") position();
  }

  // --- Off: titles are blanked so the browser shows none ---------------------------
  const suppressedTitles = new Map();
  const roots = new Set();          // document and the shadow roots seen
  const listenedRoots = new WeakSet();
  const observers = new Map();      // root -> MutationObserver, only while off

  function suppressTitle(element) {
    if (!element.isConnected) return;
    const title = element.getAttribute?.("title");
    if (!title) return;
    suppressedTitles.set(element, title);
    // Empty titles also prevent native tooltips inherited from ancestors.
    element.setAttribute("title", "");
  }

  function suppressTitles(root) {
    if (root.nodeType === Node.ELEMENT_NODE) suppressTitle(root);
    root.querySelectorAll?.("[title]").forEach(suppressTitle);
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === "attributes") suppressTitle(record.target);
      else record.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        suppressTitles(node);
        discoverShadowRoots(node);
      });
    }
    // Release detached controls instead of retaining old tracks indefinitely.
    for (const [element, title] of suppressedTitles) {
      if (!element.isConnected) {
        if (element.getAttribute("title") === "") element.setAttribute("title", title);
        suppressedTitles.delete(element);
      }
    }
    for (const root of roots) if (root.host && !root.host.isConnected) roots.delete(root);
  }

  function watch(root) {
    if (observers.has(root)) return;
    const observer = new MutationObserver(onMutations);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
    observers.set(root, observer);
  }

  function listen(root) {
    const known = roots.has(root);
    roots.add(root);
    if (!enabled) {
      if (!known) suppressTitles(root);
      watch(root);
    }
    if (listenedRoots.has(root)) return;
    listenedRoots.add(root);
    root.addEventListener("pointerover", onPointerOver, true);
    root.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    root.addEventListener("pointerout", onPointerOut, true);
    root.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    root.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
    root.addEventListener("focusin", onFocusIn, true);
    root.addEventListener("focusout", onFocusOut, true);
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  }

  // While on, shadow roots are found lazily from event paths; turning off needs them all.
  function discoverShadowRoots(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    for (const element of [node, ...node.querySelectorAll("*")]) {
      if (!element.shadowRoot) continue;
      listen(element.shadowRoot);
      for (const child of element.shadowRoot.children) discoverShadowRoots(child);
    }
  }

  function applyEnabled() {
    enabled = readEnabled();
    hide();
    if (!enabled) {
      tooltip.style.setProperty("display", "none", "important");
      discoverShadowRoots(document.documentElement);
      roots.forEach((root) => { suppressTitles(root); watch(root); });
    } else {
      tooltip.style.removeProperty("display");
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
      for (const [element, title] of suppressedTitles) {
        if (element.getAttribute("title") === "") element.setAttribute("title", title);
      }
      suppressedTitles.clear();
      for (const root of roots) if (root.host && !root.host.isConnected) roots.delete(root);
    }
  }

  globalThis.SCTooltips = {
    isEnabled: () => enabled,
    setEnabled(value) {
      try { localStorage.setItem(STORAGE_KEY, String(!!value)); } catch {}
      document.documentElement?.setAttribute(ENABLED_ATTRIBUTE, String(!!value));
      document.dispatchEvent(new Event("scdl:tooltips-changed"));
    },
  };

  listen(document);
  document.addEventListener("scdl:tooltips-changed", applyEnabled);
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    document.documentElement?.removeAttribute(ENABLED_ATTRIBUTE);
    applyEnabled();
  });
  applyEnabled();
  window.addEventListener("resize", onScroll, { passive: true });
  // Content scripts run at document_start, before <body> exists.
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
