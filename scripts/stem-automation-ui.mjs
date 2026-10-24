import { AUTOMATION_PARAMETERS, normalizeAutomationClip } from './stem-automation.mjs';

// The playlist owns the outer clip, its title, lane, movement, resize and history.
// This editor owns only the envelope. All callbacks receive fresh clip snapshots;
// onBegin/onCommit bracket one gesture, while onChange previews every adjustment.
export function mountAutomationClip({ element, clip, zoom = 48, height = 44, min, max, snap = value => value,
  onBegin, onChange, onCommit, onCancel, onSelect, onContextMenu }) {
  const doc = element.ownerDocument, win = doc.defaultView, ns = 'http://www.w3.org/2000/svg';
  const es = doc.documentElement.lang === 'es', t = (en, spanish) => es ? spanish : en;
  const spec = AUTOMATION_PARAMETERS[clip.target.param];
  min ??= spec.min; max ??= spec.max;
  let current = normalizeAutomationClip(clip), drag = null, disposed = false, closeMenu = null;
  const svg = doc.createElementNS(ns, 'svg'), fill = doc.createElementNS(ns, 'path'), line = doc.createElementNS(ns, 'path');
  const handles = [];
  svg.classList.add('pl-automation-envelope'); svg.setAttribute('role', 'group'); svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', t('Automation envelope. Double-click to add a point. Select a point and use arrow keys to edit; Delete removes it.', 'Envolvente de automatización. Doble clic para agregar un punto. Seleccioná un punto y usá las flechas para editar; Suprimir lo elimina.'));
  fill.classList.add('pl-automation-fill'); line.classList.add('pl-automation-line'); svg.append(fill, line); element.append(svg);
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const snapshot = () => ({ ...current, target: { ...current.target }, points: current.points.map(point => ({ ...point })) });
  const width = () => Math.max(12, current.duration * zoom), x = at => 5 + at / current.duration * (width() - 10);
  const y = value => 5 + (1 - (value - min) / (max - min)) * Math.max(1, height - 10);
  const format = value => current.target.param === 'gain' ? `${Math.round(value * 100)}%` : `${Math.round(value * 10) / 10}${spec.unit}`;

  function render() {
    svg.setAttribute('viewBox', `0 0 ${width()} ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
    const points = current.points;
    let path = `M ${x(points[0].at)} ${y(points[0].value)}`;
    for (let index = 1; index < points.length; index++) path += points[index - 1].curve === 'hold'
      ? ` H ${x(points[index].at)} V ${y(points[index].value)}` : ` L ${x(points[index].at)} ${y(points[index].value)}`;
    line.setAttribute('d', path);
    fill.setAttribute('d', `${path} L ${x(points.at(-1).at)} ${height} L ${x(points[0].at)} ${height} Z`);
    while (handles.length > points.length) handles.pop().remove();
    points.forEach((point, index) => {
      let handle = handles[index];
      if (!handle) {
        handle = doc.createElementNS(ns, 'circle'); handle.classList.add('pl-automation-point');
        handle.setAttribute('r', '4'); handle.setAttribute('tabindex', '0'); handle.setAttribute('role', 'slider');
        handle.setAttribute('aria-orientation', 'vertical'); handles.push(handle); svg.append(handle);
      }
      handle.dataset.point = String(index); handle.setAttribute('cx', String(x(point.at))); handle.setAttribute('cy', String(y(point.value)));
      handle.setAttribute('aria-label', `${t('Point', 'Punto')} ${index + 1} · ${point.at.toFixed(2)}s · ${point.curve === 'hold' ? t('Hold', 'Escalón') : t('Linear', 'Lineal')}`);
      handle.setAttribute('aria-valuemin', String(min)); handle.setAttribute('aria-valuemax', String(max));
      handle.setAttribute('aria-valuenow', String(point.value)); handle.setAttribute('aria-valuetext', format(point.value));
      handle.classList.toggle('is-hold', point.curve === 'hold');
    });
  }
  function notify() { render(); onChange?.(snapshot()); }
  function edit(action) {
    const before = snapshot(); onSelect?.(current.id); onBegin?.(before);
    action(); current = normalizeAutomationClip(current); notify(); onCommit?.(snapshot(), before);
  }
  function pointIndex(event) {
    const node = event.target.closest?.('[data-point]');
    return node && svg.contains(node) ? Number(node.dataset.point) : -1;
  }
  function position(event) {
    const rect = svg.getBoundingClientRect(), px = (event.clientX - rect.left) / Math.max(1, rect.width) * width();
    const py = (event.clientY - rect.top) / Math.max(1, rect.height) * height;
    const at = (px - 5) / (width() - 10) * current.duration;
    return { at: clamp(event.altKey ? at : snap(at), 0, current.duration), value: clamp(max - (py - 5) / Math.max(1, height - 10) * (max - min), min, max) };
  }
  function setPoint(index, next) {
    const points = current.points, point = points[index];
    const gap = Math.min(.001, current.duration / 10000);
    point.at = index === 0 ? 0 : index === points.length - 1 ? current.duration : clamp(next.at, points[index - 1].at + gap, points[index + 1].at - gap);
    point.value = clamp(next.value, min, max);
  }
  function release(cancelled = false) {
    if (!drag) return;
    const old = drag; drag = null;
    doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true);
    doc.removeEventListener('keydown', escape, true); win?.removeEventListener('blur', cancel);
    svg.classList.remove('is-editing');
    try { svg.releasePointerCapture(old.pointerId); } catch {}
    if (cancelled) { current = old.before; render(); onCancel?.(snapshot()); }
    else onCommit?.(snapshot(), old.before);
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    setPoint(drag.index, position(event)); notify();
  }
  function up(event) { if (drag && event.pointerId === drag.pointerId) { event.preventDefault(); event.stopPropagation(); release(); } }
  function cancel() { release(true); }
  function escape(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } }
  function down(event) {
    const index = pointIndex(event);
    if (index < 0 || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); closeMenu?.();
    onSelect?.(current.id); handles[index].focus({ preventScroll: true });
    drag = { index, pointerId: event.pointerId, before: snapshot() }; onBegin?.(snapshot());
    svg.classList.add('is-editing');
    try { svg.setPointerCapture(event.pointerId); } catch {}
    doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true);
    doc.addEventListener('keydown', escape, true); win?.addEventListener('blur', cancel);
  }
  function add(point) {
    if (current.points.length >= 2048) return;
    let index;
    edit(() => {
      index = current.points.findIndex(item => Math.abs(item.at - point.at) < .001);
      if (index >= 0) current.points[index].value = point.value;
      else { current.points.push({ ...point, curve: 'linear' }); current.points.sort((a, b) => a.at - b.at); index = current.points.findIndex(item => item.at === point.at); }
    });
    handles[index]?.focus({ preventScroll: true });
  }
  function doubleClick(event) {
    event.preventDefault(); event.stopPropagation();
    if (pointIndex(event) < 0) add(position(event));
  }
  function remove(index) {
    if (index <= 0 || index >= current.points.length - 1) return;
    edit(() => current.points.splice(index, 1)); handles[Math.min(index, handles.length - 1)]?.focus({ preventScroll: true });
  }
  function keydown(event) {
    const index = pointIndex(event);
    if (index < 0) {
      if (event.key === 'Enter' || event.key === 'Insert') { event.preventDefault(); event.stopPropagation(); add({ at: snap(current.duration / 2), value: (min + max) / 2 }); }
      return;
    }
    // Point editing keys stay local; transport and undo shortcuts still bubble.
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Backspace', 'h', 'H', 'l', 'L'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (['Delete', 'Backspace'].includes(event.key)) { remove(index); return; }
    edit(() => {
      const point = current.points[index];
      if (['h', 'H', 'l', 'L'].includes(event.key)) { point.curve = event.key.toLowerCase() === 'h' ? 'hold' : 'linear'; return; }
      const next = { ...point }, valueStep = (max - min) * (event.shiftKey ? .001 : .01);
      if (event.key === 'ArrowUp') next.value += valueStep;
      if (event.key === 'ArrowDown') next.value -= valueStep;
      if (event.key === 'Home') next.value = min;
      if (event.key === 'End') next.value = max;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        let step = Math.max(.001, 1 / zoom);
        next.at = snap(point.at + direction * step);
        while (Math.abs(next.at - point.at) < .0001 && step < current.duration) { step *= 2; next.at = snap(point.at + direction * step); }
      }
      setPoint(index, next);
    });
  }
  function context(event) {
    const index = pointIndex(event); if (index < 0) return;
    event.preventDefault(); event.stopPropagation(); closeMenu?.(); onSelect?.(current.id);
    const changeCurve = curve => edit(() => { current.points[index].curve = curve; });
    const items = [
      { label: t('Linear', 'Lineal'), checked: current.points[index].curve === 'linear', action: () => changeCurve('linear') },
      { label: t('Hold / step', 'Escalón'), checked: current.points[index].curve === 'hold', action: () => changeCurve('hold') },
      { label: t('Delete point', 'Eliminar punto'), danger: true, disabled: index === 0 || index === current.points.length - 1, action: () => remove(index) },
    ];
    if (onContextMenu) { onContextMenu(event, items); return; }
    const menu = doc.createElement('div'); menu.className = 'pl-menu pl-automation-menu'; menu.setAttribute('role', 'menu');
    for (const item of items) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'pl-menu-item'; button.textContent = `${item.checked ? '✓ ' : ''}${item.label}`;
      button.disabled = !!item.disabled; button.setAttribute('role', 'menuitem');
      button.onclick = () => { closeMenu(); item.action(); }; menu.append(button);
    }
    doc.body.append(menu);
    const box = menu.getBoundingClientRect(), anchor = handles[index].getBoundingClientRect();
    menu.style.left = `${clamp(event.clientX || anchor.left, 4, Math.max(4, win.innerWidth - box.width - 4))}px`;
    menu.style.top = `${clamp(event.clientY || anchor.bottom, 4, Math.max(4, win.innerHeight - box.height - 4))}px`;
    const outside = pointer => { if (!menu.contains(pointer.target)) closeMenu?.(); };
    const menuKey = key => {
      key.stopPropagation();
      if (key.key === 'Escape' || key.key === 'Tab') { key.preventDefault(); closeMenu?.(); }
      if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
        key.preventDefault(); const options = [...menu.querySelectorAll('button:not(:disabled)')], current = options.indexOf(doc.activeElement);
        options[(current + (key.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
      }
    };
    closeMenu = () => {
      const focused = menu.contains(doc.activeElement); menu.remove(); doc.removeEventListener('pointerdown', outside, true); win.removeEventListener('blur', closeMenu);
      closeMenu = null; if (focused) handles[index]?.focus({ preventScroll: true });
    };
    menu.addEventListener('keydown', menuKey); doc.addEventListener('pointerdown', outside, true); win.addEventListener('blur', closeMenu); menu.querySelector('button')?.focus();
  }
  svg.addEventListener('pointerdown', down); svg.addEventListener('dblclick', doubleClick); svg.addEventListener('keydown', keydown); svg.addEventListener('contextmenu', context);
  render();
  return {
    update(next, dimensions = {}) {
      if (disposed) return;
      zoom = dimensions.zoom ?? zoom; height = dimensions.height ?? height;
      current = normalizeAutomationClip(next); render();
    },
    dispose() {
      if (disposed) return; disposed = true;
      release(true); closeMenu?.();
      svg.removeEventListener('pointerdown', down); svg.removeEventListener('dblclick', doubleClick); svg.removeEventListener('keydown', keydown); svg.removeEventListener('contextmenu', context); svg.remove();
    },
  };
}
