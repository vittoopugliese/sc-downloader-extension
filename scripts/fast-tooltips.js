(() => {
  "use strict";

  const SHOW_DELAY_MS = 100;
  const tooltip = document.createElement("div");
  tooltip.id = "scdl-fast-tooltip";
  tooltip.setAttribute("role", "tooltip");
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "2147483647",
    maxWidth: "min(280px, calc(100vw - 16px))",
    padding: "6px 8px",
    border: "1px solid rgba(255, 255, 255, .2)",
    borderRadius: "6px",
    color: "#fff",
    background: "rgba(20, 20, 22, .96)",
    boxShadow: "0 3px 12px rgba(0, 0, 0, .35)",
    font: "500 12px/1.25 system-ui, -apple-system, sans-serif",
    letterSpacing: "normal",
    pointerEvents: "none",
    opacity: "0",
    transform: "translate(-50%, -4px)",
    transition: "opacity 80ms ease, transform 80ms ease",
    visibility: "hidden",
  });
  document.documentElement.append(tooltip);

  let activeButton = null;
  let activeTitle = "";
  let showTimer = null;

  function buttonFromEvent(event) {
    return event.composedPath().find((node) => node instanceof HTMLButtonElement) || null;
  }

  function restoreTitle(button) {
    if (button && !button.hasAttribute("title") && button.dataset.scdlTooltipTitle) {
      button.title = button.dataset.scdlTooltipTitle;
    }
    button?.removeAttribute("data-scdl-tooltip-title");
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    tooltip.style.opacity = "0";
    tooltip.style.transform = "translate(-50%, -4px)";
    tooltip.style.visibility = "hidden";
    restoreTitle(activeButton);
    activeButton = null;
    activeTitle = "";
  }

  function position(button) {
    const rect = button.getBoundingClientRect();
    const top = rect.top > 42 ? rect.top - 8 : rect.bottom + 8;
    tooltip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 8), window.innerWidth - 8)}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = rect.top > 42 ? "translate(-50%, -100%)" : "translate(-50%, 4px)";
  }

  function show(button) {
    if (activeButton === button) return;
    hide();
    const title = button.getAttribute("title");
    if (!title) return;
    activeButton = button;
    activeTitle = title;
    button.dataset.scdlTooltipTitle = title;
    button.removeAttribute("title");
    showTimer = setTimeout(() => {
      if (activeButton !== button || !button.isConnected) return;
      tooltip.textContent = activeTitle;
      tooltip.style.visibility = "visible";
      position(button);
      tooltip.style.opacity = "1";
    }, SHOW_DELAY_MS);
  }

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "touch") show(buttonFromEvent(event));
  }, true);
  document.addEventListener("pointerout", (event) => {
    const button = buttonFromEvent(event);
    if (button === activeButton && !button.contains(event.relatedTarget)) hide();
  }, true);
  document.addEventListener("focusin", (event) => show(buttonFromEvent(event)), true);
  document.addEventListener("focusout", (event) => {
    if (buttonFromEvent(event) === activeButton) hide();
  }, true);
  document.addEventListener("scroll", () => activeButton && position(activeButton), true);
  window.addEventListener("resize", () => activeButton && position(activeButton));
})();
