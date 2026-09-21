(() => {
  "use strict";

  const SHOW_DELAY_MS = 100;
  const tooltip = document.createElement("div");
  tooltip.id = "scdl-fast-tooltip";
  tooltip.setAttribute("role", "tooltip");
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "2147483647",
    boxSizing: "border-box",
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
    visibility: "hidden",
  });

  let activeButton = null;
  let savedTitle = null;
  let showTimer = null;

  function mount() {
    // Content scripts run at document_start, before <html> exists.
    if (document.documentElement && !tooltip.isConnected) document.documentElement.append(tooltip);
  }

  function buttonFromEvent(event) {
    return event.composedPath().find((node) => node?.tagName === "BUTTON") || null;
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
    if (!button || button.disabled || button.hidden) return;
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

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "touch") show(buttonFromEvent(event));
  }, true);
  document.addEventListener("pointerout", (event) => {
    const button = buttonFromEvent(event);
    if (button && button === activeButton && !button.contains(event.relatedTarget)) hide();
  }, true);
  document.addEventListener("focusin", (event) => show(buttonFromEvent(event)), true);
  document.addEventListener("focusout", (event) => {
    if (buttonFromEvent(event) === activeButton) hide();
  }, true);
  document.addEventListener("scroll", () => {
    if (activeButton && tooltip.style.visibility === "visible") position();
  }, true);
  window.addEventListener("resize", () => {
    if (activeButton && tooltip.style.visibility === "visible") position();
  });
  mount();
})();
