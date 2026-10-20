// A whole number you drag, like FL Studio's tempo display: press it, then drag up to raise it
// and down to lower it (Shift for fine). The wheel and the arrows step by 1, PageUp/PageDown
// by 10, Home/End jump to the limits. Styles live in assets/ui-drag-number.css.
// The shown number counts to each new value (220 ms, smootherstep), like the Player Tools
// speed readout. onInput runs on every change; onEnd once a drag, wheel spin or key run ends.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smootherstep = p => p * p * p * (p * (p * 6 - 15) + 10);
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const DURATION_MS = 220, PX_PER_STEP = 4, FINE_PX_PER_STEP = 16, WHEEL_PX_PER_STEP = 30, IDLE_MS = 700;

export function createDragNumber({ label, min, max, value, hint = '', className = '', onInput, onEnd }) {
  const wrap = document.createElement('span'), caption = document.createElement('span'), display = document.createElement('span');
  wrap.className = `ui-drag-number ${className}`.trim();
  caption.className = 'ui-drag-number-label'; caption.textContent = label; caption.setAttribute('aria-hidden', 'true');
  display.className = 'ui-drag-number-value'; display.tabIndex = 0; display.setAttribute('role', 'spinbutton'); display.setAttribute('aria-label', label);
  display.setAttribute('aria-valuemin', String(min)); display.setAttribute('aria-valuemax', String(max));
  display.style.setProperty('--digits', String(String(max).length));
  let current = NaN, shown = NaN, frame = 0, drag = null, idle = 0, wheelRest = 0;

  function paint(next) { shown = next; display.textContent = String(Math.round(next)); }
  // Shows `next` without calling onInput: for changes made elsewhere (undo, tap tempo, a load).
  function show(next, { animate = true } = {}) {
    next = clamp(Math.round(next), min, max);
    if (next === current && (frame || Math.round(shown) === next)) return;
    current = next; display.setAttribute('aria-valuenow', String(next));
    if (hint) wrap.dataset.scdlTooltip = display.dataset.scdlTooltip = `${label}: ${next} · ${hint}`;
    cancelAnimationFrame(frame); frame = 0;
    if (!animate || !Number.isFinite(shown) || reducedMotion()) { paint(next); return; }
    const origin = shown, start = performance.now();
    const step = now => {
      const progress = Math.min((now - start) / DURATION_MS, 1);
      if (progress < 1) { paint(origin + (next - origin) * smootherstep(progress)); frame = requestAnimationFrame(step); }
      else { frame = 0; paint(next); }
    };
    frame = requestAnimationFrame(step);
  }
  function change(next) {
    next = clamp(Math.round(next), min, max);
    if (next !== current) { show(next); onInput?.(next); }
  }
  // Wheel and key runs end after a short pause, so a run is one undo step.
  function touch() { clearTimeout(idle); idle = setTimeout(() => { idle = 0; onEnd?.(); }, IDLE_MS); }

  display.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    display.setPointerCapture(event.pointerId); display.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, rest: 0 };
    document.documentElement.classList.add('ui-drag-number-dragging'); display.classList.add('is-dragging');
  };
  display.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    drag.rest += (drag.y - event.clientY) / (event.shiftKey ? FINE_PX_PER_STEP : PX_PER_STEP); drag.y = event.clientY;
    const steps = Math.trunc(drag.rest);
    if (steps) { drag.rest -= steps; change(current + steps); }
  };
  display.onpointerup = display.onpointercancel = event => {
    if (drag?.id !== event.pointerId) return;
    drag = null; document.documentElement.classList.remove('ui-drag-number-dragging'); display.classList.remove('is-dragging');
    onEnd?.();
  };
  display.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    // A mouse notch is one step; a trackpad's small deltas add up to one step per 30 px.
    event.preventDefault(); touch();
    wheelRest = event.deltaMode ? -Math.sign(event.deltaY) : clamp(wheelRest - event.deltaY / WHEEL_PX_PER_STEP, -1, 1);
    const steps = Math.trunc(wheelRest);
    if (steps) { wheelRest = 0; change(current + steps); }
  }, { passive: false });
  display.onkeydown = event => {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation();
    change(event.key === 'Home' ? min : event.key === 'End' ? max : current + steps[event.key]); touch();
  };
  show(value, { animate: false }); wrap.append(caption, display);
  return { wrap, display, show, value: () => current };
}
