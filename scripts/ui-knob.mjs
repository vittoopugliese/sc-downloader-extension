// The one rotary knob of the Stem Extractor: clip inspector, track volumes and the FX window.
// Styles live in assets/ui-knob.css. Vertical drag (Shift for fine), arrows (Shift for
// coarse), Home/End, double-click resets. onInput runs while dragging; onCommit once, with
// the previous value. `size` is 'md' (32 px) or 'sm' (24 px); `inline` puts the value beside
// the dial and keeps the label for screen readers only. `short` is a shorter visible label;
// the full `label` stays the accessible name and the tooltip.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createKnob({ label, min, max, step, coarse, value, reset, format, log = false, hint = '', size = 'md', inline = false, short = '', onInput, onCommit }) {
  const wrap = document.createElement('div'), dial = document.createElement('button'), caption = document.createElement('span'), output = document.createElement('output');
  wrap.className = `ui-knob ui-knob--${size}${inline ? ' ui-knob--inline' : ''}`;
  caption.className = 'ui-knob-label'; caption.textContent = short || label; output.className = 'ui-knob-value';
  dial.type = 'button'; dial.className = 'ui-knob-dial'; dial.setAttribute('role', 'slider'); dial.setAttribute('aria-label', label);
  dial.setAttribute('aria-valuemin', String(min)); dial.setAttribute('aria-valuemax', String(max)); dial.setAttribute('aria-orientation', 'vertical');
  const unit = v => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const snapValue = v => clamp(Number((Math.round(v / step) * step).toFixed(4)), min, max);
  const fromUnit = u => snapValue(log ? min * (max / min) ** clamp(u, 0, 1) : min + clamp(u, 0, 1) * (max - min));
  let current = value, drag = null;
  function show(next) {
    current = next; const text = format(next);
    dial.style.setProperty('--knob-angle', `${-135 + clamp(unit(next), 0, 1) * 270}deg`);
    dial.setAttribute('aria-valuenow', String(next)); dial.setAttribute('aria-valuetext', text);
    dial.dataset.scdlTooltip = hint ? `${label}: ${text} · ${hint}` : `${label}: ${text}`; output.textContent = text;
  }
  const finish = (next, previous) => { if (next !== previous) onCommit(next, previous); };
  dial.onpointerdown = event => {
    if (event.button !== 0 || dial.disabled) return;
    event.preventDefault(); event.stopPropagation(); dial.setPointerCapture(event.pointerId); dial.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, unit: unit(current), start: current };
  };
  dial.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    const next = fromUnit(drag.unit + (drag.y - event.clientY) / (event.shiftKey ? 1200 : 150));
    if (next !== current) { show(next); onInput?.(next); }
  };
  dial.onpointerup = dial.onpointercancel = event => {
    if (drag?.id !== event.pointerId) return;
    const start = drag.start; drag = null; finish(current, start);
  };
  dial.ondblclick = () => { const previous = current; show(reset); finish(reset, previous); };
  dial.onkeydown = event => {
    const keys = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation();
    const previous = current;
    show(event.key === 'Home' ? min : event.key === 'End' ? max : snapValue(current + keys[event.key] * (event.shiftKey ? coarse : step)));
    finish(current, previous);
  };
  show(value); wrap.append(caption, dial, output);
  return { wrap, dial, show, value: () => current };
}
