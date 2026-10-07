/* Shared disclosure header and state controller for Player Tools sections. */
(() => {
  "use strict";
  const pt = (source, ...values) => globalThis.SCPlayerToolsText?.t(source, ...values) ?? source.replace(/\$(\d+)/g, (match, index) => values[index - 1] ?? match);
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
      toggle.setAttribute("aria-label", `${isCollapsed ? pt("Expand") : pt("Collapse")} ${section.getAttribute("aria-label") || "section"}`);
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
    document.addEventListener("scdl:extension-assets-ready", () => sync(false));
    sync(false);
    return Object.freeze({ setCollapsed, isCollapsed: () => isCollapsed });
  }

  // Move the existing sections only on drop, preserving controls, canvases and
  // audio state. Pointer gestures stay separate from disclosure/button clicks.
  function reorder({ layout, storageKey, onChange = () => {} }) {
    const columns = [...layout.children];
    const sections = columns.flatMap(column => [...column.children]);
    const byId = new Map(sections.map(section => [section.id, section]));
    let order = [...sections].sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order)).map(section => section.id);
    const valid = ids => Array.isArray(ids) && ids.length === sections.length && new Set(ids).size === sections.length && ids.every(id => byId.has(id));
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.columns?.length === columns.length && saved.columns.every(Array.isArray) && valid(saved.columns.flat()) && valid(saved.order)) {
        saved.columns.forEach((ids, index) => ids.forEach(id => columns[index].append(byId.get(id))));
        order = saved.order;
      }
    } catch {}
    const syncOrder = () => order.forEach((id, index) => byId.get(id).style.setProperty("--section-order", index));
    syncOrder();
    layout.classList.add("is-sortable");
    const marker = document.createElement("div");
    marker.className = "section-drop-marker";
    marker.setAttribute("aria-hidden", "true");
    let gesture = null, suppressClick = false, clickTimer;
    const grid = () => getComputedStyle(columns[0]).display === "flex";
    function destination(x, y) {
      const bounds = layout.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top - 10 || y > bounds.bottom + 10) return null;
      const column = grid() ? columns.reduce((nearest, candidate) => {
        const rect = candidate.getBoundingClientRect(), previous = nearest.getBoundingClientRect();
        return Math.abs(x - (rect.left + rect.right) / 2) < Math.abs(x - (previous.left + previous.right) / 2) ? candidate : nearest;
      }) : null;
      const candidates = (column ? [...column.children] : order.map(id => byId.get(id))).filter(section => section !== gesture.section);
      const before = candidates.find(section => {
        const rect = section.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      const last = candidates.at(-1);
      const anchor = (before || last || column || layout).getBoundingClientRect();
      marker.style.left = `${anchor.left - bounds.left}px`;
      marker.style.top = `${(before ? anchor.top - 2 : last ? anchor.bottom + 2 : anchor.top) - bounds.top}px`;
      marker.style.width = `${anchor.width}px`;
      return { column, before };
    }
    function move(event) {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
      if (!gesture.active) {
        gesture.active = true;
        gesture.toggle.setPointerCapture(event.pointerId);
        gesture.section.classList.add("is-reordering");
        layout.classList.add("is-reordering");
        layout.append(marker);
      }
      event.preventDefault();
      gesture.target = destination(event.clientX, event.clientY);
      marker.hidden = !gesture.target;
    }
    function finish(commit) {
      if (!gesture) return;
      const current = gesture;
      gesture = null;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      current.section.classList.remove("is-reordering");
      layout.classList.remove("is-reordering");
      marker.remove();
      if (current.active) {
        suppressClick = true;
        clickTimer = setTimeout(() => { suppressClick = false; }, 400);
      }
      if (current.toggle.hasPointerCapture(current.id)) current.toggle.releasePointerCapture(current.id);
      if (!commit || !current.active || !current.target) return;
      const { column, before } = current.target;
      order = order.filter(id => id !== current.section.id);
      let index = before ? order.indexOf(before.id) : order.length;
      if (column && !before) {
        const last = [...column.children].filter(section => section !== current.section).at(-1);
        if (last) index = order.indexOf(last.id) + 1;
      }
      order.splice(index, 0, current.section.id);
      if (column) column.insertBefore(current.section, before || null);
      else {
        // In one column CSS order spans both groups; also preserve the relative
        // order of each group for the next switch to the two-column layout.
        columns.forEach(group => order.forEach(id => {
          const section = byId.get(id);
          if (section.parentElement === group) group.append(section);
        }));
      }
      syncOrder();
      try { localStorage.setItem(storageKey, JSON.stringify({ order, columns: columns.map(group => [...group.children].map(section => section.id)) })); } catch {}
      current.toggle.focus({ preventScroll: true });
      onChange();
    }
    function up(event) {
      if (event.pointerId !== gesture?.id) return;
      if (gesture.active) { gesture.target = destination(event.clientX, event.clientY); event.preventDefault(); }
      finish(true);
    }
    function cancel() { finish(false); }
    function keydown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
    }
    layout.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary || gesture) return;
      clearTimeout(clickTimer); suppressClick = false;
      const toggle = event.target.closest(".tool-section-toggle");
      const section = toggle?.closest("section");
      if (!section || !sections.includes(section)) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, toggle, section, active: false, target: null };
      window.addEventListener("pointermove", move, { capture: true, passive: false });
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("keydown", keydown, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("resize", cancel);
    });
    layout.addEventListener("click", event => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    layout.addEventListener("dragstart", event => { if (event.target.closest(".tool-section-toggle")) event.preventDefault(); });
  }

  globalThis.SCPlayerToolsCollapsible = Object.freeze({ header, mount, reorder, styles });
})();
