// One A–B range shared by every waveform, using the Player Tools looper rules.
export function createStemLoop({ duration, changed, viewportChanged = () => {} }) {
  const core = globalThis.SCLooperCore;
  let selection = null;
  let zoom = null;
  const viewport = () => zoom || { startMs: 0, endMs: duration() * 1000 };
  const percent = ms => (ms - viewport().startMs) / (viewport().endMs - viewport().startMs) * 100;
  function setZoom(value) { zoom = value; render(); viewportChanged(); }
  function zoomAt(focus, direction) { setZoom(core.zoomWindowAt(zoom, duration() * 1000, focus, direction)); }
  const views = new Set();
  const range = () => selection || { startMs: 0, endMs: duration() * 1000, durationMs: duration() * 1000 };
  function render() {
    const current = range();
    for (const { overlay, start, end } of views) {
      overlay.hidden = !selection;
      overlay.style.left = `${percent(current.startMs)}%`;
      overlay.style.width = `${percent(current.endMs) - percent(current.startMs)}%`;
      overlay.parentElement.dataset.viewportStart = String(viewport().startMs);
      overlay.parentElement.dataset.viewportEnd = String(viewport().endMs);
      for (const [button, value] of [[start, current.startMs], [end, current.endMs]]) {
        button.setAttribute('aria-valuenow', (value / 1000).toFixed(3));
        button.setAttribute('aria-valuemax', String(duration()));
        button.title = `${button.textContent}: ${(value / 1000).toFixed(3)} s`;
      }
    }
  }
  function set(value) { const previous = range(); selection = value; render(); changed(previous); }
  function mount(element, seek, place = () => false) {
    const overlay = document.createElement('div'); overlay.className = 'stem-loop-selection';
    const handles = ['start', 'end'].map((kind, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `stem-loop-${kind}`; button.textContent = index ? 'B' : 'A';
      button.dataset.marker = kind; button.setAttribute('role', 'slider');
      button.setAttribute('aria-label', `Loop ${index ? 'B' : 'A'}`); button.setAttribute('aria-valuemin', '0');
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const current = range();
        set(core.moveMarker(current, kind, event.key === 'Home' ? 0 : event.key === 'End' ? current.durationMs :
          current[`${kind}Ms`] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1000 : 100)));
      });
      return button;
    });
    overlay.append(...handles); element.append(overlay);
    const view = { overlay, start: handles[0], end: handles[1] }; views.add(view); render();
    const controller = new AbortController(), options = { signal: controller.signal };
    let drag;
    const time = event => {
      const rect = element.getBoundingClientRect();
      const window = viewport();
      return Math.max(0, Math.min(duration() * 1000, window.startMs + (event.clientX - rect.left) / rect.width * (window.endMs - window.startMs)));
    };
    element.addEventListener('wheel', event => {
      if (!event.deltaY && !event.deltaX) return;
      event.preventDefault();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const window = viewport(), span = window.endMs - window.startMs;
        const startMs = Math.max(0, Math.min(duration() * 1000 - span, window.startMs + (event.deltaX || event.deltaY) / element.clientWidth * span));
        setZoom({ startMs, endMs: startMs + span });
      } else zoomAt(time(event), event.deltaY);
    }, { ...options, passive: false });
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, anchor: time(event), range: range(),
        kind: event.target.dataset.marker || (event.target === overlay ? 'move' : 'create'), moved: false };
      element.setPointerCapture(event.pointerId);
    }, options);
    element.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x) < 4) return;
      drag.moved = true;
      set(drag.kind === 'create' ? core.createRangeFromSelection(duration() * 1000, drag.anchor, time(event)) :
        drag.kind === 'move' ? core.moveRange(drag.range, time(event) - drag.anchor) : core.moveMarker(drag.range, drag.kind, time(event)));
    }, options);
    element.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && drag.kind !== 'start' && drag.kind !== 'end' && !place(time(event) / 1000)) seek(time(event) / 1000);
      drag = null;
      element.releasePointerCapture(event.pointerId);
    }, options);
    for (const event of ['pointercancel', 'lostpointercapture']) element.addEventListener(event, () => { drag = null; }, options);
    element.addEventListener('dblclick', () => set(null), options);
    return () => { controller.abort(); views.delete(view); overlay.remove(); };
  }
  return { range, mount, viewport, percent, zoomAt, setRange: set,
    focusRange(startMs, endMs) {
      const total = duration() * 1000, span = Math.min(total, Math.max(100, (endMs - startMs) * 1.6));
      const start = Math.max(0, Math.min(total - span, (startMs + endMs - span) / 2));
      setZoom({ startMs: start, endMs: start + span });
    },
    resetZoom() { setZoom(null); },
    reset() { selection = null; zoom = null; render(); viewportChanged(); } };
}
