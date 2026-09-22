(() => {
  "use strict";

  const SHOW_DELAY_MS = 372;
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

  function mount() {
    // Content scripts run at document_start, before <html> exists.
    if (document.body && !tooltip.isConnected) document.documentElement.append(tooltip);
  }

  function buttonFromEvent(event) {
    const path = event.composedPath();
    path.filter((node) => node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host).forEach(listen);
    return path.find((node) =>
      node?.tagName === "BUTTON" ||
      (node?.tagName === "SELECT" && node.classList.contains("popup-control-btn"))
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
    if (button === activeButton) return;
    hide();
    if (!button || button.hidden) return;
    const title = button.getAttribute("title");
    const label = title || button.getAttribute("aria-label") || button.textContent?.trim();
    if (!label) return;
    activeButton = button;
    savedTitle = title;
    if (title !== null) button.removeAttribute("title");
    showTimer = setTimeout(() => {
      if (activeButton !== button || !button.isConnected) return;
      mount();
      tooltip.textContent = label;
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
    if (listenedRoots.has(root)) return;
    listenedRoots.add(root);
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
    if (node.shadowRoot) listen(node.shadowRoot);
    node.querySelectorAll?.("*").forEach((element) => {
      if (element.shadowRoot) listen(element.shadowRoot);
    });
  }

  listen(document);
  discoverShadowRoots(document.documentElement);
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(discoverShadowRoots);
    }
  }).observe(document, { childList: true, subtree: true });
  window.addEventListener("resize", () => {
    if (activeButton && tooltip.style.visibility === "visible") position();
  });
  mount();
})();
