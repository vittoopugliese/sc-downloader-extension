/* Shared disclosure header and state controller for Player Tools sections. */
(() => {
  "use strict";
  if (globalThis.SCPlayerToolsCollapsible) return;

  const CHEVRON = `<svg class="tool-section-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>`;
  const styles = `
    .tool-section-header { position:relative; min-height:31px; }
    .tool-section-toggle { display:flex; align-items:center; width:100%; min-height:31px; padding:0 9px; border:0; color:#fff; background:#1b1b1b; font:700 11px/1 system-ui,sans-serif; text-align:left; cursor:pointer; }
    .tool-section-toggle:hover, .tool-section-header:hover > .tool-section-toggle { color:#ff7b38; background:#232323; }
    .tool-section-toggle:focus-visible { outline:2px solid #ff5500; outline-offset:-2px; }
    .tool-section-heading { display:inline-flex; align-items:center; min-width:0; gap:5px; }
    .tool-section-icon { display:block; flex:0 0 auto; width:16px; height:16px; object-fit:contain; color:currentColor; }
    img.tool-section-icon { filter:brightness(0) invert(1); transition:filter 160ms ease; }
    .tool-section-toggle:hover img.tool-section-icon, .tool-section-header:hover > .tool-section-toggle img.tool-section-icon { filter:brightness(0) saturate(100%) invert(56%) sepia(93%) saturate(1985%) hue-rotate(336deg) brightness(104%) contrast(101%); }
    svg.tool-section-icon { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tool-section-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tool-section-chevron { position:absolute; top:50%; right:9px; width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; transform:translateY(-50%); transition:transform 160ms ease; }
    .is-collapsed > .tool-section-header .tool-section-chevron { transform:translateY(-50%) rotate(180deg); }
    .tool-section-actions { position:absolute; z-index:5; top:4px; right:27px; display:flex; align-items:center; gap:4px; }
  `;

  function header({ title, bodyId, toggleClass = "", headerClass = "", actionsClass = "", icon = "", actions = "", expanded = true }) {
    return `<div class="tool-section-header ${headerClass}"><button class="tool-section-toggle ${toggleClass}" type="button" aria-controls="${bodyId}" aria-expanded="${expanded}"><span class="tool-section-heading">${icon}<span class="tool-section-title">${title}</span></span>${CHEVRON}</button>${actions ? `<div class="tool-section-actions ${actionsClass}">${actions}</div>` : ""}</div>`;
  }

  function mount({ section, toggle, body, collapsed = false, onChange }) {
    let isCollapsed = Boolean(collapsed);
    const sync = (notify) => {
      section.classList.toggle("is-collapsed", isCollapsed);
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      toggle.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${section.getAttribute("aria-label") || "section"}`);
      body.hidden = isCollapsed;
      if (notify) onChange?.(isCollapsed);
    };
    const setCollapsed = (value, options = {}) => {
      const next = Boolean(value);
      const changed = next !== isCollapsed;
      isCollapsed = next;
      sync(changed && options.notify !== false);
    };
    toggle.addEventListener("click", () => setCollapsed(!isCollapsed));
    sync(false);
    return Object.freeze({ setCollapsed, isCollapsed: () => isCollapsed });
  }

  globalThis.SCPlayerToolsCollapsible = Object.freeze({ header, mount, styles });
})();
