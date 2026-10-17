// FL Studio style tool windows for the Stem Extractor: a module (Channel Rack, Piano Roll,
// EQ, Recorder) opens as a floating window that moves by its title bar, resizes and comes
// to the front on click. The dock button puts it back in its home slot under the Playlist;
// the detach button floats it again; X closes it. The module keeps its own DOM, canvases and
// audio state: only its parent and position change. Open/docked state and the floating
// rectangle are per-viewer conveniences kept in localStorage.
const ICONS = {
  dock: 'M4 5h16v14H4zM4 15h16',
  detach: 'M14 4h6v6m0-6-8 8M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5',
  close: 'M6 6l12 12M18 6 6 18',
};
const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };

// Shared stacking order with the sample browser: the last clicked window is on top.
let topLayer = 900;
export function bringToFront(element) {
  if (Number(element.style.zIndex) !== topLayer) element.style.zIndex = String(++topLayer);
}
export const isOnTop = element => Number(element.style.zIndex) === topLayer;

// Moves `element` by dragging `handle`, keeping at least part of it on screen.
export function dragWindow(element, handle, { ignore = 'button,input,select,textarea,a', onEnd } = {}) {
  const down = event => {
    if (event.button !== 0 || event.target.closest(ignore) || !element.classList.contains('is-floating') && element.dataset.floating !== 'always') return;
    event.preventDefault();
    const box = element.getBoundingClientRect(), dx = event.clientX - box.left, dy = event.clientY - box.top;
    handle.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      element.style.left = `${Math.min(innerWidth - 60, Math.max(60 - box.width, moveEvent.clientX - dx))}px`;
      element.style.top = `${Math.min(innerHeight - 32, Math.max(0, moveEvent.clientY - dy))}px`;
    };
    const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); onEnd?.(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  handle.addEventListener('pointerdown', down);
  return () => handle.removeEventListener('pointerdown', down);
}

// `section` is the module's root; `header` its title bar (a disclosure header whose
// collapse is disabled here); `home` the slot it docks into. `setVisible(open)` lets the
// module pause work while closed; `onShow` runs after it appears (redraws).
export function mountModuleWindow({ id, section, header, home, t, size, setVisible, onShow, onChange }) {
  const key = `stem-module-${id}`;
  const saved = read(key) || {};
  let open = false, docked = saved.docked === true, rect = saved.rect || null;
  const anchor = document.createComment(`${id} home`);
  section.before(anchor);
  section.classList.add('module-window');
  section.dataset.module = id;
  // The header no longer collapses the module: clicks on it are for moving.
  const toggle = header.querySelector('.tool-section-toggle');
  section.addEventListener('click', event => {
    if (toggle && toggle.contains(event.target)) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  if (toggle) { toggle.tabIndex = -1; toggle.removeAttribute('aria-expanded'); toggle.setAttribute('aria-hidden', 'true'); }
  const controls = document.createElement('div'); controls.className = 'module-controls';
  const control = (icon, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'module-control';
    b.innerHTML = svg(icon); b.onclick = event => { event.stopPropagation(); action(); }; return b;
  };
  const dockButton = control(ICONS.dock, () => setDocked(!docked));
  const closeButton = control(ICONS.close, () => close());
  const closeLabel = t('Close', 'Cerrar');
  closeButton.title = closeLabel; closeButton.setAttribute('aria-label', closeLabel);
  controls.append(dockButton, closeButton); header.append(controls);
  const persist = () => write(key, { open, docked, rect });
  const saveRect = () => {
    if (!section.classList.contains('is-floating')) return;
    const box = section.getBoundingClientRect();
    rect = { left: box.left, top: box.top, width: box.width, height: box.height }; persist();
  };
  const stopDrag = dragWindow(section, header, { ignore: 'button:not(.tool-section-toggle),input,select,textarea,a', onEnd: saveRect });
  section.addEventListener('pointerdown', () => { if (!docked) bringToFront(section); }, true);
  let resizeTimer = 0;
  const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); if (open && !docked) resizeTimer = setTimeout(saveRect, 300); });
  observer.observe(section);
  function place() {
    const width = Math.min(innerWidth - 16, Math.max(280, rect?.width || size.width));
    const height = Math.min(innerHeight - 16, Math.max(160, rect?.height || size.height));
    const left = Math.min(innerWidth - width - 8, Math.max(8, rect?.left ?? (innerWidth - width) / 2 + (size.offset || 0)));
    const top = Math.min(innerHeight - 48, Math.max(8, rect?.top ?? 72 + (size.offset || 0)));
    Object.assign(section.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }
  function render() {
    section.hidden = !open;
    section.classList.toggle('is-floating', open && !docked);
    section.classList.toggle('is-docked', docked);
    const label = docked ? t('Detach: float this window', 'Desacoplar: ventana flotante') : t('Dock under the Playlist', 'Acoplar debajo de la Playlist');
    dockButton.innerHTML = svg(docked ? ICONS.detach : ICONS.dock);
    dockButton.title = label; dockButton.setAttribute('aria-label', label);
    if (docked) {
      if (section.parentElement !== home) anchor.after(section);
      for (const prop of ['left', 'top', 'width', 'height', 'zIndex']) section.style[prop] = '';
    } else {
      if (section.parentElement !== document.body) document.body.append(section);
      if (open) { place(); bringToFront(section); }
    }
    section.setAttribute('role', docked ? 'region' : 'dialog');
    if (!docked) section.setAttribute('aria-modal', 'false'); else section.removeAttribute('aria-modal');
  }
  function show() {
    open = true; render(); setVisible?.(true); persist(); onChange?.(open);
    requestAnimationFrame(() => {
      onShow?.();
      if (docked) section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
  function close() {
    if (!open) return;
    saveRect(); open = false; render(); setVisible?.(false); persist(); onChange?.(open);
  }
  function setDocked(value) {
    saveRect(); docked = value; render(); persist();
    requestAnimationFrame(() => onShow?.());
  }
  const onWindowResize = () => { if (open && !docked) { const box = section.getBoundingClientRect(); rect = { left: box.left, top: box.top, width: box.width, height: box.height }; place(); } };
  window.addEventListener('resize', onWindowResize);
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !docked && !event.defaultPrevented && !event.target.closest('input,select,textarea')) { event.preventDefault(); close(); }
  });
  render(); setVisible?.(false);
  if (saved.open) show();
  return {
    open: show, close,
    // Like FL Studio's window keys: a window hidden behind another comes to the front first.
    toggle() { if (!open) show(); else if (!docked && !isOnTop(section)) bringToFront(section); else close(); },
    // Opening an open floating window brings it to the front, like FL Studio.
    reveal() { if (!open) show(); else if (!docked) bringToFront(section); else section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    isOpen: () => open,
    isDocked: () => docked,
    setDocked,
    dispose() { stopDrag(); observer.disconnect(); window.removeEventListener('resize', onWindowResize); clearTimeout(resizeTimer); anchor.remove(); },
  };
}
