(() => {
  const delay = 100;
  const tip = document.createElement("div");
  tip.id = "scdl-fast-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.style.cssText = "position:fixed;z-index:2147483647;padding:3px 5px;border-radius:4px;color:#fff;background:#222;font:10px/1.2 system-ui,sans-serif;pointer-events:none;visibility:hidden;transform:translate(-50%,-100%)";
  document.documentElement.append(tip);

  let active, timer;
  const button = (event) => event.composedPath().find((node) => node?.tagName === "BUTTON");
  const restore = () => {
    if (active && !active.hasAttribute("title")) active.title = active.dataset.scdlTooltip;
    active?.removeAttribute("data-scdl-tooltip");
  };
  const hide = () => {
    clearTimeout(timer);
    tip.style.visibility = "hidden";
    restore();
    active = null;
  };
  const show = (target) => {
    if (!target || target === active) return;
    hide();
    const text = target.title;
    if (!text) return;
    active = target;
    target.dataset.scdlTooltip = text;
    target.removeAttribute("title");
    timer = setTimeout(() => {
      if (target !== active || !target.isConnected) return;
      const rect = target.getBoundingClientRect();
      tip.textContent = text;
      tip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 8), innerWidth - 8)}px`;
      tip.style.top = `${rect.top - 4}px`;
      tip.style.visibility = "visible";
    }, delay);
  };

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "touch") show(button(event));
  }, true);
  document.addEventListener("pointerout", (event) => {
    const target = button(event);
    if (target && target === active && !target.contains(event.relatedTarget)) hide();
  }, true);
})();
