import { PAD_KEYS, STEPS_PER_BAR, clamp } from './stem-pattern-core.mjs';
import { mountPadSampler } from './stem-sampler.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';
import { patternControls } from './stem-instruments.mjs';
import { mountRackOverview } from './stem-rack-overview.mjs';
import { BROWSER_DRAG_TYPE } from './stem-sample-browser.mjs';

const iconMarkup = name => globalThis.SCIcons.html(name, "icon");
export const PLUGIN_ICONS = Object.freeze({"rack": "rack", "piano": "piano", "play": "play", "pause": "pause", "place": "place", "slice": "auto-slice", "clear": "clear", "clearSlices": "clear-slices", "restore": "undo"});

// One collapsible plugin shell, shared with the piano roll: header, body, visibility.
export function pluginShell({ container, id, title, icon, className }) {
  const collapsible = globalThis.SCPlayerToolsCollapsible;
  if (!document.getElementById('stem-plugin-styles')) {
    const style = document.createElement('style'); style.id = 'stem-plugin-styles'; style.textContent = collapsible.styles; document.head.append(style);
  }
  const section = document.createElement('section');
  section.className = `stem-plugin ${className}`; section.id = id; section.setAttribute('aria-label', title); section.hidden = true;
  section.innerHTML = collapsible.header({ title, bodyId: `${id}-body`, icon: globalThis.SCIcons.html(icon, "tool-section-icon") });
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
export function mountChannelRack({ container, instruments, audioContext, output, locale, report, importSamples, openPianoRoll = () => {} }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const shell = pluginShell({ container, id: 'stem-rack', title: pt('Channel rack'), icon: PLUGIN_ICONS.rack, className: 'stem-rack' });
  const acceptsDrop = event => importSamples && [BROWSER_DRAG_TYPE, 'Files', 'application/x-stem-sample'].some(type => event.dataTransfer?.types.includes(type));
  shell.section.addEventListener('dragover', event => {
    if (!acceptsDrop(event)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    shell.section.classList.add('is-sample-drop');
  });
  shell.section.addEventListener('dragleave', event => {
    if (!shell.section.contains(event.relatedTarget)) shell.section.classList.remove('is-sample-drop');
  });
  shell.section.addEventListener('drop', async event => {
    shell.section.classList.remove('is-sample-drop');
    if (!acceptsDrop(event)) return;
    event.preventDefault(); event.stopPropagation();
    try { await importSamples(event.dataTransfer); } catch (error) { report(error); }
  });
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const button = (className, title, html, action) => {
    const node = element('button', className); node.type = 'button'; node.dataset.scdlTooltip = title; node.setAttribute('aria-label', title);
    node.innerHTML = html; node.addEventListener('click', action); return node;
  };
  const toolbar = element('div', 'plugin-toolbar');
  let rackView = 'channels';
  const viewTabs = element('div', 'rack-view-tabs'); viewTabs.setAttribute('role', 'group'); viewTabs.setAttribute('aria-label', pt('Rack view'));
  const channelsTab = button('rack-view-channels', pt('All samples'), pt('Channel rack'), () => setRackView('channels'));
  const chopsTab = button('rack-view-chops', pt('Edit chops'), pt('Chops'), () => setRackView('chops'));
  viewTabs.append(channelsTab, chopsTab);
  const mode = element('select', 'rack-source-mode'); mode.setAttribute('aria-label', pt('Sample mode'));
  mode.add(new Option('One-shot', 'oneShot')); mode.add(new Option(pt('Chops'), 'slices'));
  mode.onchange = () => instruments.editInstrument(instrument => { instrument.mode = mode.value; });
  function setRackView(value) { rackView = value; overview.stop(); render(); requestAnimationFrame(drawWave); }
  const play = button('plugin-play', pt('Play pattern'), iconMarkup(PLUGIN_ICONS.play), () => instruments.playing() ? instruments.stop() : instruments.play());
  const focus = patternControls(instruments, { manage: true });
  const place = button('rack-place', pt('Add to playlist'), `${iconMarkup(PLUGIN_ICONS.place)}<span>${pt('Playlist')}</span>`, () => instruments.place());
  const slice = button('rack-slice', pt('Auto-slice the visible audio into the eight pads'), iconMarkup(PLUGIN_ICONS.slice), () => { sampler?.autoSlice(true); });
  // Clear All empties the eight pads (steps and notes stay); a second click restores them.
  let cleared = null;
  const clearSlices = button('rack-clear-slices', pt('Clear all slices'), iconMarkup(PLUGIN_ICONS.clearSlices), () => {
    const { key } = instruments.focused();
    if (cleared?.key === key && sampler && !sampler.state().slices.some(Boolean)) { const { slices } = cleared; cleared = null; sampler.restore(slices); renderClear(); return; }
    const before = sampler?.snapshot();
    if (sampler?.clearAll()) { cleared = { key, slices: before }; renderClear(); }
  });
  function renderClear() {
    const { key } = instruments.focused(), empty = !sampler?.state().slices.some(Boolean), undo = cleared?.key === key && empty;
    const label = undo ? pt('Restore cleared slices') : pt('Clear all slices');
    clearSlices.dataset.scdlTooltip = label; clearSlices.setAttribute('aria-label', label); clearSlices.setAttribute('aria-pressed', String(undo));
    clearSlices.innerHTML = iconMarkup(undo ? PLUGIN_ICONS.restore : PLUGIN_ICONS.clearSlices);
    clearSlices.disabled = !sampler || (empty && !undo);
  }
  // In the channel list the steps and the piano roll notes are one list, as in FL Studio.
  const clear = button('rack-clear', pt('Clear steps'), iconMarkup(PLUGIN_ICONS.clear), () => instruments.editPattern(pattern => {
    const rows = rackView === 'channels' && instruments.focused().instrument?.mode === 'oneShot' ? [pattern.hits] : pattern.steps;
    for (const row of rows) row.fill(0, 0, count());
    if (rackView === 'channels') pattern.notes = pattern.notes.filter(note => note.start >= count());
  }));
  toolbar.append(viewTabs, play, focus.element, mode, place, slice, clearSlices, clear);
  const wave = element('div', 'waveform rack-wave');
  const canvas = element('canvas', 'rack-wave-canvas'); canvas.setAttribute('aria-hidden', 'true'); wave.append(canvas);
  const grid = element('div', 'rack-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Pattern steps'));
  const beats = [];
  const pads = [], cells = [];
  const hint = element('p', 'plugin-hint'); hint.setAttribute('role', 'status');
  const empty = element('p', 'plugin-empty', pt('Separate or import audio to start.'));
  shell.body.append(toolbar, wave, grid, hint, empty);

  let sampler = null, mounted = null, view = null, template = .8, gesture = null, frame = 0, drawn = '';
  const overview = mountRackOverview({ container: shell.body, instruments, audioContext, output, report,
    openChops(key) { rackView = 'chops'; instruments.focus(key); instruments.editInstrument(value => { value.mode = 'slices'; }, key); },
    openPiano(key) { instruments.focus(key); openPianoRoll(key); } });
  shell.body.insertBefore(overview.element, hint);
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
  const waveObserver = new ResizeObserver(() => { drawn = ''; drawWave(); sampler?.render(); }); waveObserver.observe(wave);

  for (let row = 0; row < PAD_KEYS.length; row++) {
    const pad = button('rack-pad', PAD_KEYS[row], `<span>${PAD_KEYS[row]}</span>`, event => {
      if (!sampler) return;
      const assigned = sampler.state().slices[row];
      if (!assigned || event.shiftKey) sampler.arm(row); else sampler.select(row);
      sampler.trigger(row);
    });
    pad.addEventListener('contextmenu', event => { event.preventDefault(); sampler?.arm(row); });
    pads.push(pad);
    cells.push([]);
  }
  function buildSteps() {
    if (beats.length === count()) return;
    beats.length = 0; grid.replaceChildren(element('span', 'rack-corner'));
    grid.style.setProperty('--rack-steps', String(count()));
    for (let i = 0; i < count(); i++) beats.push(element('span', 'rack-beat', i % 4 ? '' : `${Math.floor(i / 16) + 1}.${i % 16 / 4 + 1}`));
    grid.append(...beats);
    for (let row = 0; row < PAD_KEYS.length; row++) {
      grid.append(pads[row]);
      const line = cells[row]; line.length = 0;
      for (let column = 0; column < count(); column++) {
        const cell = element('button', `rack-step${column % 4 === 0 ? ' is-beat' : ''}${column % 16 === 0 ? ' is-bar' : ''}`); cell.type = 'button';
        cell.dataset.row = String(row); cell.dataset.column = String(column);
        line.push(cell); grid.append(cell);
      }
    }
  }
  const stepOf = cell => Number(cell.dataset.column);
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
    const nextColumn = clamp(column + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0), 0, count() - 1);
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
      keyboardActive: event => !document.querySelector('.piano-keyboard[aria-pressed=true]') && shell.active() && rackView === 'chops' && instruments.focused().instrument?.mode === 'slices' && !event.target.closest?.('.pl-ui,.stem-piano-roll,.rack-overview'),
      changed: (slices, { auto = false } = {}) => {
        instruments.editInstrument(instrument => { instrument.slices = slices; instrument.sliced = true; }, key, { auto });
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
      pad.dataset.scdlTooltip = slice ? `${PAD_KEYS[row]} · ${pt('Click to play · right-click to choose another sample')}` : `${PAD_KEYS[row]} · ${pt('Assign a sample')}`;
      pad.setAttribute('aria-label', pad.dataset.scdlTooltip);
    });
    const armed = state?.armed;
    hint.textContent = rackView === 'channels' ? pt('Each row is a sample in this pattern. Choose One-shot for the full sound, or Chops to sequence its selected pad.') : armed !== null && armed !== undefined
      ? pt('Pad $1: click or drag on the waveform to choose its sample. Esc cancels.', PAD_KEYS[armed])
      : pt('A S D F G H J K play the pads. Drag on the waveform to re-cut the selected pad; wheel zooms. Click a step to add a hit, drag it up or down for velocity.');
    renderSteps(state);
  }
  function renderSteps(state = sampler?.state()) {
    const { pattern } = instruments.focused();
    buildSteps();
    cells.forEach((line, row) => line.forEach((cell, column) => {
      const step = column, velocity = pattern?.steps[row][step] ?? 0;
      cell.disabled = !state?.slices[row]; cell.dataset.step = String(step); cell.dataset.velocity = String(velocity);
      cell.classList.toggle('is-on', velocity > 0); cell.setAttribute('aria-pressed', String(velocity > 0));
      cell.style.setProperty('--velocity', String(velocity));
      cell.dataset.scdlTooltip = `${PAD_KEYS[row]} · ${pt('Bar $1', Math.floor(column / 16) + 1)} · ${pt('Step $1', column % 16 + 1)}${velocity ? ` · ${Math.round(velocity * 100)}%` : ''}`;
      cell.setAttribute('aria-label', cell.dataset.scdlTooltip);
    }));
  }
  function renderTransport() {
    const playing = instruments.playing();
    play.innerHTML = iconMarkup(PLUGIN_ICONS[playing ? 'pause' : 'play']); play.setAttribute('aria-pressed', String(playing));
    play.dataset.scdlTooltip = pt(playing ? 'Pause' : 'Play pattern'); play.setAttribute('aria-label', play.dataset.scdlTooltip);
    cancelAnimationFrame(frame);
    const step = () => {
      const phase = instruments.phase(), current = phase < 0 ? -1 : Math.floor(phase * count());
      beats.forEach((beat, column) => {
        const active = current === column;
        beat.classList.toggle('is-current', active);
        for (const line of cells) line[column].classList.toggle('is-current', active);
      });
      overview.transport(current);
      if (instruments.playing()) frame = requestAnimationFrame(step);
    };
    step();
  }
  function render() {
    const { key, pattern, track } = instruments.focused(), available = instruments.tracks().some(item => item.buffer);
    empty.hidden = available; for (const node of [toolbar, wave, grid, hint]) node.hidden = !available;
    mount(); focus.render(); renderPads();
    overview.element.hidden = !available || rackView !== 'channels';
    wave.hidden = grid.hidden = !available || rackView !== 'chops';
    slice.hidden = clearSlices.hidden = rackView !== 'chops';
    channelsTab.setAttribute('aria-pressed', String(rackView === 'channels'));
    chopsTab.setAttribute('aria-pressed', String(rackView === 'chops'));
    mode.value = instruments.focused().instrument?.mode || 'slices'; mode.disabled = !track?.buffer;
    // Chops remain editable while the channel is playing its full sample. They become
    // audible when the user selects Chops mode; viewing never destroys either sequence.
    overview.render();
    place.disabled = !pattern; clear.disabled = !pattern; slice.disabled = !track?.buffer;
    play.disabled = !pattern && !instruments.playing();
  }
  instruments.on(kind => { if (kind.startsWith('before')) return; if (kind === 'transport') renderTransport(); else render(); });
  render(); renderTransport();
  return {
    ...shell,
    showChannels() { setRackView('channels'); },
    open() { shell.open(); requestAnimationFrame(() => { drawn = ''; drawWave(); sampler?.render(); }); },
    dispose() { cancelAnimationFrame(frame); waveObserver.disconnect(); overview.dispose(); sampler?.dispose(); shell.section.remove(); },
  };
}
