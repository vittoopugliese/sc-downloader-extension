import { PAD_KEYS, STEPS_PER_BAR, clamp } from './stem-pattern-core.mjs';
import { mountPadSampler } from './stem-sampler.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';
import { patternControls } from './stem-instruments.mjs';

const svg = paths => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const PLUGIN_ICONS = Object.freeze({
  rack: '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M5 3v4m8 3v4m5 3v4" stroke-width="4"/>',
  piano: '<path d="M3 4h18v16H3zM7 4v9h3V4m4 0v9h3V4M9 13v7m6-7v7"/>',
  play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  place: '<path d="M3 6h11M3 12h7M3 18h7m7-9v12m-6-6h12"/>',
  slice: '<path d="M3 21 15 9M14 4v3M19 9h3M17.5 5.5l2-2M10 6.5 8 4.5M17.5 12.5l2 2"/>',
  clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/>',
  // Eight pads with a line through them: Clear All, apart from the trash cans.
  clearSlices: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6zM2 22 22 2"/>',
  restore: '<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
});

// One collapsible plugin shell, shared with the piano roll: header, body, visibility.
export function pluginShell({ container, id, title, icon, className }) {
  const collapsible = globalThis.SCPlayerToolsCollapsible;
  if (!document.getElementById('stem-plugin-styles')) {
    const style = document.createElement('style'); style.id = 'stem-plugin-styles'; style.textContent = collapsible.styles; document.head.append(style);
  }
  const section = document.createElement('section');
  section.className = `stem-plugin ${className}`; section.id = id; section.setAttribute('aria-label', title); section.hidden = true;
  section.innerHTML = collapsible.header({ title, bodyId: `${id}-body`, icon: `<svg class="tool-section-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` });
  const body = document.createElement('div'); body.className = 'stem-plugin-body'; body.id = `${id}-body`; section.append(body);
  container.append(section);
  const disclosure = collapsible.mount({ section, toggle: section.querySelector('.tool-section-toggle'), body });
  return {
    section, body,
    collapsed: disclosure.isCollapsed,
    open() {
      section.hidden = false; disclosure.setCollapsed(false);
      // A floating window is already in view.
      if (!section.classList.contains('is-floating')) requestAnimationFrame(() => section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    },
    setVisible(value) { section.hidden = !value; },
    setCollapsed: disclosure.setCollapsed,
    active: () => !section.hidden && !disclosure.isCollapsed(),
  };
}

// FL Studio's channel rack for the focused track: its audio cut into eight pads
// (A–K) on a waveform of that track, and the steps of the focused pattern.
export function mountChannelRack({ container, instruments, audioContext, output, locale, report }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const shell = pluginShell({ container, id: 'stem-rack', title: pt('Channel rack'), icon: PLUGIN_ICONS.rack, className: 'stem-rack' });
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const button = (className, title, html, action) => {
    const node = element('button', className); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
    node.innerHTML = html; node.addEventListener('click', action); return node;
  };
  const toolbar = element('div', 'plugin-toolbar');
  const play = button('plugin-play', pt('Play pattern'), svg(PLUGIN_ICONS.play), () => instruments.playing() ? instruments.stop() : instruments.play());
  const focus = patternControls(instruments, { manage: true });
  const place = button('rack-place', pt('Add to playlist'), `${svg(PLUGIN_ICONS.place)}<span>${pt('Playlist')}</span>`, () => instruments.place());
  const slice = button('rack-slice', pt('Auto-slice the visible audio into the eight pads'), svg(PLUGIN_ICONS.slice), () => { sampler?.autoSlice(true); });
  // Clear All empties the eight pads (steps and notes stay); a second click restores them.
  let cleared = null;
  const clearSlices = button('rack-clear-slices', pt('Clear all slices'), svg(PLUGIN_ICONS.clearSlices), () => {
    const { key } = instruments.focused();
    if (cleared?.key === key && sampler && !sampler.state().slices.some(Boolean)) { const { slices } = cleared; cleared = null; sampler.restore(slices); renderClear(); return; }
    const before = sampler?.snapshot();
    if (sampler?.clearAll()) { cleared = { key, slices: before }; renderClear(); }
  });
  function renderClear() {
    const { key } = instruments.focused(), empty = !sampler?.state().slices.some(Boolean), undo = cleared?.key === key && empty;
    const label = undo ? pt('Restore cleared slices') : pt('Clear all slices');
    clearSlices.title = label; clearSlices.setAttribute('aria-label', label); clearSlices.setAttribute('aria-pressed', String(undo));
    clearSlices.innerHTML = svg(undo ? PLUGIN_ICONS.restore : PLUGIN_ICONS.clearSlices);
    clearSlices.disabled = !sampler || (empty && !undo);
  }
  const clear = button('rack-clear', pt('Clear steps'), svg(PLUGIN_ICONS.clear), () => instruments.editPattern(pattern => {
    for (const row of pattern.steps) row.fill(0, bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR);
  }));
  toolbar.append(play, focus.element, place, slice, clearSlices, clear);
  const wave = element('div', 'waveform rack-wave');
  const canvas = element('canvas', 'rack-wave-canvas'); canvas.setAttribute('aria-hidden', 'true'); wave.append(canvas);
  const tabs = element('div', 'rack-bars');
  const barButtons = [0, 1, 2, 3].map(index => {
    const tab = button('rack-bar', pt('Bar $1', index + 1), String(index + 1), () => { bar = index; render(); });
    tabs.append(tab); return tab;
  });
  const grid = element('div', 'rack-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Pattern steps'));
  grid.append(element('span', 'rack-corner'));
  const beats = Array.from({ length: STEPS_PER_BAR }, (_, i) => element('span', 'rack-beat', i % 4 ? '' : String(i / 4 + 1)));
  grid.append(...beats);
  const pads = [], cells = [];
  const hint = element('p', 'plugin-hint'); hint.setAttribute('role', 'status');
  const empty = element('p', 'plugin-empty', pt('Separate or import audio to start.'));
  shell.body.append(toolbar, wave, tabs, grid, hint, empty);

  let bar = 0, sampler = null, mounted = null, view = null, template = .8, gesture = null, frame = 0, drawn = '';
  const count = () => (instruments.focused().pattern?.bars ?? 1) * STEPS_PER_BAR;
  // The waveform of the focused track, with its own zoom (wheel) and pan (Shift + wheel).
  const timeline = {
    viewport: () => view || { startMs: 0, endMs: 1 },
    percent: ms => { const { startMs, endMs } = timeline.viewport(); return (ms - startMs) / (endMs - startMs) * 100; },
    range: () => ({ startMs: 0, endMs: (mounted?.buffer.duration ?? 0) * 1000 }),
    focusRange(startMs, endMs) {
      const total = mounted.buffer.duration * 1000, span = Math.min(total, Math.max(50, (endMs - startMs) * 1.6));
      const start = clamp((startMs + endMs - span) / 2, 0, total - span);
      setView({ startMs: start, endMs: start + span });
    },
  };
  function setView(next) { view = next; drawn = ''; drawWave(); sampler?.render(); }
  wave.addEventListener('wheel', event => {
    if (!mounted || (!event.deltaY && !event.deltaX)) return;
    event.preventDefault();
    const total = mounted.buffer.duration * 1000, { startMs, endMs } = timeline.viewport(), span = endMs - startMs;
    const rect = wave.getBoundingClientRect(), at = startMs + (event.clientX - rect.left) / rect.width * span;
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const start = clamp(startMs + (event.deltaX || event.deltaY) / rect.width * span, 0, total - span);
      setView({ startMs: start, endMs: start + span }); return;
    }
    const next = clamp(span * Math.exp(clamp(event.deltaY, -200, 200) * .002), 20, total), start = clamp(at - (at - startMs) / span * next, 0, total - next);
    setView({ startMs: start, endMs: start + next });
  }, { passive: false });
  wave.addEventListener('dblclick', () => mounted && setView({ startMs: 0, endMs: mounted.buffer.duration * 1000 }));
  function drawWave() {
    if (!mounted || !canvas.getClientRects().length) return;
    const buffer = mounted.buffer, rect = canvas.getBoundingClientRect(), scale = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.round(rect.height * scale));
    const { startMs, endMs } = timeline.viewport(), spectrum = spectrumNow(buffer);
    const key = JSON.stringify([width, height, startMs, endMs, !!spectrum]);
    if (key === drawn) return;
    drawn = key;
    if (!spectrum) spectrumOf(buffer).then(() => { drawn = ''; drawWave(); }, () => {});
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d');
    context.fillStyle = '#0e1216'; context.fillRect(0, 0, width, height);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const bins = spectrum?.peaks.length, binMs = spectrum ? spectrum.durationMs / bins : 0;
    for (let x = 0; x < width; x++) {
      const from = startMs + x / width * (endMs - startMs), to = startMs + (x + 1) / width * (endMs - startMs);
      const first = Math.floor(from / 1000 * buffer.sampleRate), last = Math.min(buffer.length, Math.max(first + 1, Math.ceil(to / 1000 * buffer.sampleRate)));
      const stride = Math.max(1, Math.floor((last - first) / 256));
      let peak = 0;
      for (const data of channels) for (let i = first; i < last; i += stride) peak = Math.max(peak, Math.abs(data[i]));
      if (spectrum) {
        let low = 0, mid = 0, high = 0;
        for (let i = Math.floor(from / binMs), end = Math.min(bins, Math.max(i + 1, Math.ceil(to / binMs))); i < end; i++) {
          low += spectrum.bands[i * 3]; mid += spectrum.bands[i * 3 + 1]; high += spectrum.bands[i * 3 + 2];
        }
        context.fillStyle = spectrumColor(low, mid, high);
      } else context.fillStyle = '#858d96';
      const bar = Math.min(1, peak) * height * .9;
      context.fillRect(x, (height - bar) / 2, 1, Math.max(1, bar));
    }
  }
  new ResizeObserver(() => { drawn = ''; drawWave(); sampler?.render(); }).observe(wave);

  for (let row = 0; row < PAD_KEYS.length; row++) {
    const pad = button('rack-pad', PAD_KEYS[row], `<span>${PAD_KEYS[row]}</span>`, event => {
      if (!sampler) return;
      const assigned = sampler.state().slices[row];
      if (!assigned || event.shiftKey) sampler.arm(row); else sampler.select(row);
      sampler.trigger(row);
    });
    pad.addEventListener('contextmenu', event => { event.preventDefault(); sampler?.arm(row); });
    pads.push(pad); grid.append(pad);
    const line = [];
    for (let column = 0; column < STEPS_PER_BAR; column++) {
      const cell = element('button', `rack-step${column % 4 === 0 ? ' is-beat' : ''}`); cell.type = 'button';
      cell.dataset.row = String(row); cell.dataset.column = String(column);
      line.push(cell); grid.append(cell);
    }
    cells.push(line);
  }
  const stepOf = cell => bar * STEPS_PER_BAR + Number(cell.dataset.column);
  const value = (row, step) => instruments.focused().pattern?.steps[row][step] ?? 0;
  // Click toggles a hit with the velocity of the last hit touched; dragging a hit up or
  // down changes its velocity, shown by the fill. Right-click removes, as in FL.
  grid.addEventListener('pointerdown', event => {
    const cell = event.target.closest('.rack-step');
    if (!cell || event.button !== 0 || cell.disabled) return;
    event.preventDefault(); cell.focus({ preventScroll: true });
    const row = Number(cell.dataset.row), step = stepOf(cell), velocity = value(row, step);
    if (velocity) template = velocity;
    gesture = { id: event.pointerId, cell, row, step, y: event.clientY, velocity, dragged: false };
    cell.setPointerCapture(event.pointerId);
  });
  grid.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId || !gesture.velocity) return;
    const dy = gesture.y - event.clientY;
    if (!gesture.dragged && Math.abs(dy) < 3) return;
    gesture.dragged = true;
    const next = Math.round(clamp(gesture.velocity + dy / 120, .01, 1) * 100) / 100;
    template = next;
    instruments.editPattern(pattern => { pattern.steps[gesture.row][gesture.step] = next; });
    gesture.cell.dataset.tip = `${Math.round(next * 100)}%`;
  });
  const finish = event => {
    if (gesture?.id !== event.pointerId) return;
    const { cell, row, step, velocity, dragged } = gesture; gesture = null;
    if (cell.hasPointerCapture(event.pointerId)) cell.releasePointerCapture(event.pointerId);
    delete cell.dataset.tip;
    if (event.type === 'pointerup' && !dragged) instruments.editPattern(pattern => { pattern.steps[row][step] = velocity ? 0 : template; });
    else render();
  };
  for (const type of ['pointerup', 'pointercancel']) grid.addEventListener(type, finish);
  grid.addEventListener('contextmenu', event => {
    const cell = event.target.closest('.rack-step'); if (!cell) return;
    event.preventDefault();
    if (value(Number(cell.dataset.row), stepOf(cell))) instruments.editPattern(pattern => { pattern.steps[Number(cell.dataset.row)][stepOf(cell)] = 0; });
  });
  grid.addEventListener('keydown', event => {
    const cell = event.target.closest('.rack-step'); if (!cell) return;
    const row = Number(cell.dataset.row), column = Number(cell.dataset.column), step = stepOf(cell);
    if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); instruments.editPattern(pattern => { pattern.steps[row][step] = 0; }); return; }
    if (event.key === 'Enter') { event.preventDefault(); instruments.editPattern(pattern => { pattern.steps[row][step] = pattern.steps[row][step] ? 0 : template; }); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      if (value(row, step)) instruments.editPattern(pattern => { pattern.steps[row][step] = clamp(Math.round((pattern.steps[row][step] + (event.key === 'ArrowUp' ? .1 : -.1)) * 100) / 100, .01, 1); });
      return;
    }
    const nextRow = clamp(row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0), 0, 7);
    const nextColumn = clamp(column + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0), 0, STEPS_PER_BAR - 1);
    cells[nextRow][nextColumn].focus();
  });
  // Space previews the pattern while the rack has focus; the playlist keeps Space elsewhere.
  shell.section.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.target.closest('input,select,textarea')) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) play.click();
  });

  // A track's sampler mounts on focus; an untouched track is sliced at once, so its
  // pads play right away (A S D F G H J K) and can be drawn in the steps.
  function mount() {
    const { key, track } = instruments.focused(), buffer = track?.buffer || null;
    if (mounted?.key === key && mounted.buffer === buffer) return;
    sampler?.dispose(); sampler = null; mounted = null;
    if (!buffer) { renderClear(); return; }
    mounted = { key, buffer }; view = { startMs: 0, endMs: buffer.duration * 1000 }; drawn = '';
    // Pads play through this track's EQ.
    sampler = mountPadSampler({ waveform: wave, buffer, timeline, audioContext, output: () => output(key), locale, report,
      saved: instruments.instrument(key).slices,
      keyboardActive: event => shell.active() && !event.target.closest?.('.pl-ui,.stem-piano-roll'),
      changed: slices => {
        instruments.editInstrument(instrument => { instrument.slices = slices; instrument.sliced = true; }, key);
        if (slices.some(Boolean) && cleared?.key === key) cleared = null;
      },
      onRender: state => { renderPads(state); renderClear(); } });
    // Only a track that was never set up is auto-sliced; a cleared one stays empty.
    if (!instruments.instrument(key).sliced) requestAnimationFrame(() => setTimeout(() => {
      if (sampler && mounted?.key === key && !instruments.instrument(key).sliced) sampler.autoSlice();
    }));
    drawWave(); renderClear();
  }
  function renderPads(state = sampler?.state()) {
    pads.forEach((pad, row) => {
      const slice = state?.slices[row];
      pad.classList.toggle('is-assigned', !!slice); pad.classList.toggle('is-selected', state?.selected === row);
      pad.classList.toggle('is-armed', state?.armed === row); pad.classList.toggle('is-active', !!state?.playing.has(row));
      pad.title = slice ? `${PAD_KEYS[row]} · ${pt('Click to play · right-click to choose another sample')}` : `${PAD_KEYS[row]} · ${pt('Assign a sample')}`;
      pad.setAttribute('aria-label', pad.title);
    });
    const armed = state?.armed;
    hint.textContent = armed !== null && armed !== undefined
      ? pt('Pad $1: click or drag on the waveform to choose its sample. Esc cancels.', PAD_KEYS[armed])
      : pt('A S D F G H J K play the pads. Drag on the waveform to re-cut the selected pad; wheel zooms. Click a step to add a hit, drag it up or down for velocity.');
    renderSteps(state);
  }
  function renderSteps(state = sampler?.state()) {
    const { pattern } = instruments.focused(), bars = pattern?.bars ?? 1;
    bar = Math.min(bar, bars - 1);
    tabs.hidden = bars < 2;
    barButtons.forEach((tab, i) => { tab.hidden = i >= bars; tab.setAttribute('aria-pressed', String(i === bar)); });
    cells.forEach((line, row) => line.forEach((cell, column) => {
      const step = bar * STEPS_PER_BAR + column, velocity = pattern?.steps[row][step] ?? 0;
      cell.disabled = !state?.slices[row]; cell.dataset.step = String(step); cell.dataset.velocity = String(velocity);
      cell.classList.toggle('is-on', velocity > 0); cell.setAttribute('aria-pressed', String(velocity > 0));
      cell.style.setProperty('--velocity', String(velocity));
      cell.title = `${PAD_KEYS[row]} · ${pt('Bar $1', bar + 1)} · ${pt('Step $1', column + 1)}${velocity ? ` · ${Math.round(velocity * 100)}%` : ''}`;
      cell.setAttribute('aria-label', cell.title);
    }));
  }
  function renderTransport() {
    const playing = instruments.playing();
    play.innerHTML = svg(PLUGIN_ICONS[playing ? 'pause' : 'play']); play.setAttribute('aria-pressed', String(playing));
    play.title = pt(playing ? 'Pause' : 'Play pattern'); play.setAttribute('aria-label', play.title);
    cancelAnimationFrame(frame);
    const step = () => {
      const phase = instruments.phase(), current = phase < 0 ? -1 : Math.floor(phase * count());
      beats.forEach((beat, column) => {
        const active = current === bar * STEPS_PER_BAR + column;
        beat.classList.toggle('is-current', active);
        for (const line of cells) line[column].classList.toggle('is-current', active);
      });
      if (instruments.playing()) frame = requestAnimationFrame(step);
    };
    step();
  }
  function render() {
    const { key, pattern, track } = instruments.focused(), available = instruments.tracks().some(item => item.buffer);
    empty.hidden = available; for (const node of [toolbar, wave, grid, hint]) node.hidden = !available;
    mount(); focus.render(); renderPads();
    place.disabled = !pattern; clear.disabled = !pattern; slice.disabled = !track?.buffer;
    play.disabled = !pattern && !instruments.playing();
    if (!key) tabs.hidden = true;
  }
  instruments.on(kind => { if (kind === 'transport') renderTransport(); else render(); });
  render(); renderTransport();
  return {
    ...shell,
    open() { shell.open(); requestAnimationFrame(() => { drawn = ''; drawWave(); sampler?.render(); }); },
    dispose() { cancelAnimationFrame(frame); sampler?.dispose(); shell.section.remove(); },
  };
}
