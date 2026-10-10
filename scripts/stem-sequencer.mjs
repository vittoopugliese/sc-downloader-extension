import { DRUM_KEYS, normalizeSequence, sequenceRange, sequenceStep, renderDrumPattern } from './stem-sequencer-core.mjs';

export function mountDrumSequencer({ row, actions, waveform, timeline, buffer, sampler, saved, changed, togglePlayback, rate, setRate, report }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const state = normalizeSequence(saved, buffer.duration);
  const controller = new AbortController(), options = { signal: controller.signal };
  let bar = 0, selected = { row: 0, step: 0 }, armed = false, drag = null, disposed = false;
  let cache = null, cacheKey = '', pending = null, playing = false, currentStep = -1, currentRate = rate();
  const range = () => sequenceRange(state, buffer);
  if (!range()) state.enabled = false;
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(className, text, action) {
    const node = element('button', className, text); node.type = 'button';
    node.addEventListener('click', action, options); return node;
  }
  function emit(loop = false) {
    if (disposed) return;
    if (!range()) state.enabled = false;
    render(); Promise.resolve(changed({ loop })).catch(report);
  }
  const svg = (paths, filled = false) => `<svg class="icon${filled ? ' is-filled' : ''}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    sequencer: '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M5 3v4m8 3v4m5 3v4" stroke-width="4"/>',
    play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    tempo: '<path d="M9 3h6l3 18H6zM12 16l5-10M8 16h8"/>',
    fit: '<path d="M8 4H4v16h4M16 4h4v16h-4M8 12h8"/>',
    bars: '<path d="M4 6v12M9 6v12M14 6v12M19 6v12"/>',
    beat: '<path d="M6 21V3h11l-3 4 3 4H6"/>',
    focus: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    velocity: '<path d="M5 20v-3M10 20v-7M15 20v-11M20 20V4"/>',
    clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/>',
    wave: '<path d="M2 12h3l2-6 3 12 3-14 3 16 2-8h4"/>',
  };
  function iconButton(className, icon, title, action, filled = false) {
    const node = button(className, '', action); node.innerHTML = svg(ICONS[icon], filled);
    node.title = title; node.setAttribute('aria-label', title); return node;
  }
  const toggle = iconButton('stem-sequencer-toggle', 'sequencer', pt('Sequencer'), () => {
    panel.hidden = !panel.hidden; armed = false;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) state.enabled = false;
    emit(!panel.hidden);
  });
  toggle.setAttribute('aria-controls', 'sequence-drums'); toggle.setAttribute('aria-expanded', String(state.enabled));
  actions.insertBefore(toggle, actions.querySelector('.download'));
  const panel = element('section', 'stem-sequencer'); panel.id = 'sequence-drums'; panel.hidden = !state.enabled;
  panel.setAttribute('aria-label', pt('Drum sequencer'));
  const controls = element('div', 'seq-controls');
  const play = iconButton('seq-play', 'play', pt('Play pattern'), () => {
    if (!playing && range()) { state.enabled = true; emit(true); }
    Promise.resolve(togglePlayback()).catch(report);
  }, true);
  // One switch: off plays the separated drums, on replaces them with the pattern.
  const mode = button('seq-switch', '', () => { if (state.enabled || range()) { state.enabled = !state.enabled; emit(state.enabled); } });
  mode.setAttribute('role', 'switch'); mode.setAttribute('aria-label', pt('Pattern'));
  mode.innerHTML = `${svg(ICONS.wave)}<span class="seq-switch-track" aria-hidden="true"></span>${svg(ICONS.sequencer)}`;
  // The visible BPM is the playback tempo. It drives the shared speed slider,
  // so Keep Tone decides whether the pitch follows. The grid keeps its source BPM.
  const bpm = element('input', 'seq-bpm'); bpm.type = 'number'; bpm.min = '1'; bpm.max = '900'; bpm.step = '.1';
  bpm.title = pt('Tempo (BPM) · uses the speed slider; Keep Tone keeps the pitch');
  bpm.setAttribute('aria-label', bpm.title);
  const bpmLabel = element('label', 'seq-field'); bpmLabel.innerHTML = svg(ICONS.tempo); bpmLabel.append(bpm); bpmLabel.title = bpm.title;
  bpm.onchange = () => {
    const value = Number(bpm.value);
    if (bpm.value && Number.isFinite(value) && value > 0) setRate(value / state.bpm);
    currentRate = rate(); bpm.value = String(Math.round(state.bpm * currentRate * 10) / 10); render();
  };
  const fit = iconButton('seq-fit', 'fit', pt('Fit the grid to the A–B loop'), () => {
    const loop = timeline.range(), seconds = (loop.endMs - loop.startMs) / 1000;
    if (!(seconds > 0)) return;
    const choices = [state.bars, 1, 2, 4].filter(value => value * 240 / seconds >= 20 && value * 240 / seconds <= 300);
    if (!choices.length) { report(new RangeError('Loop length is outside the BPM range.')); return; }
    state.bars = choices[0]; state.bpm = state.bars * 240 / seconds; state.start = loop.startMs / 1000;
    bar = Math.min(bar, state.bars - 1); emit(true);
  });
  const half = button('seq-half', '÷2', () => { state.bpm = Math.max(20, state.bpm / 2); emit(true); });
  half.title = pt('Half grid tempo'); half.setAttribute('aria-label', half.title);
  const double = button('seq-double', '×2', () => { state.bpm = Math.min(300, state.bpm * 2); emit(true); });
  double.title = pt('Double grid tempo'); double.setAttribute('aria-label', double.title);
  const bars = element('select', 'seq-bars'); bars.title = pt('Bars'); bars.setAttribute('aria-label', pt('Bars'));
  for (const value of [1, 2, 4]) bars.add(new Option(String(value), String(value)));
  bars.onchange = () => { state.bars = Number(bars.value); bar = Math.min(bar, state.bars - 1); emit(true); };
  const barsLabel = element('label', 'seq-field'); barsLabel.innerHTML = svg(ICONS.bars); barsLabel.append(bars); barsLabel.title = bars.title;
  const setStart = iconButton('seq-set-start', 'beat', pt('Set the first beat on the waveform'), () => { armed = !armed; sampler.cancelPlacement(); render(); });
  const focus = iconButton('seq-focus', 'focus', pt('Show pattern loop'), () => {
    const current = range(); if (current) timeline.focusRange(current.startMs, current.endMs);
  });
  const navigation = element('div', 'seq-navigation');
  const tabs = [0, 1, 2, 3].map(index => {
    const tab = button('seq-bar', String(index + 1), () => { bar = index; render(); });
    tab.title = pt('Bar $1', index + 1); tab.setAttribute('aria-label', tab.title); return tab;
  });
  navigation.append(...tabs);
  const velocity = element('input', 'seq-velocity'); velocity.type = 'range'; velocity.min = '1'; velocity.max = '100'; velocity.step = '1';
  velocity.oninput = () => { state.steps[selected.row][selected.step] = Number(velocity.value) / 100; emit(); };
  const velocityLabel = element('label', 'seq-field seq-velocity-label'); velocityLabel.innerHTML = svg(ICONS.velocity); velocityLabel.append(velocity);
  const clear = iconButton('seq-clear', 'clear', pt('Clear bar'), () => {
    for (const line of state.steps) line.fill(0, bar * 16, (bar + 1) * 16); emit();
  });
  const group = (...nodes) => { const node = element('div', 'seq-group'); node.append(...nodes); return node; };
  controls.append(group(play, mode), group(bpmLabel), group(fit, half, double, barsLabel, setStart, focus), navigation,
    group(velocityLabel, clear));
  const scroll = element('div', 'seq-scroll');
  const grid = element('div', 'seq-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Pattern steps'));
  grid.title = pt('Click to add or remove hits. Shift + click selects a hit to edit its velocity.');
  grid.append(element('span', 'seq-corner'));
  const beats = Array.from({ length: 16 }, (_, i) => element('span', 'seq-beat', i % 4 ? '' : String(i / 4 + 1)));
  grid.append(...beats);
  const cells = [], padButtons = [];
  for (let i = 0; i < 8; i++) {
    const pad = button('seq-pad', DRUM_KEYS[i], () => sampler.editPad(i));
    padButtons.push(pad); grid.append(pad);
    const line = [];
    for (let column = 0; column < 16; column++) {
      const cell = button(`seq-step${column % 4 === 0 ? ' is-beat' : ''}`, '', event => {
        const step = bar * 16 + column; selected = { row: i, step };
        if (!event.shiftKey) state.steps[i][step] = state.steps[i][step] ? 0 : .8;
        emit();
      });
      cell.oncontextmenu = event => { event.preventDefault(); selected = { row: i, step: bar * 16 + column }; render(); velocity.focus(); };
      cell.dataset.row = String(i); cell.dataset.column = String(column);
      cell.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (['Delete', 'Backspace'].includes(event.key)) { state.steps[i][bar * 16 + column] = 0; emit(); return; }
        if (event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          selected = { row: i, step: bar * 16 + column };
          state.steps[i][selected.step] = Math.max(.01, Math.min(1, state.steps[i][selected.step] + (event.key === 'ArrowUp' ? .1 : -.1)));
          emit(); return;
        }
        const nextRow = Math.max(0, Math.min(7, i + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
        const nextColumn = Math.max(0, Math.min(15, column + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
        cells[nextRow][nextColumn].focus();
      };
      line.push(cell); grid.append(cell);
    }
    cells.push(line);
  }
  scroll.append(grid);
  const hint = element('p', 'seq-hint'); hint.setAttribute('role', 'status');
  panel.append(controls, scroll, hint); row.append(panel);
  const anchor = button('stem-sequence-anchor', '1', () => {});
  anchor.setAttribute('role', 'slider'); anchor.setAttribute('aria-label', pt('First beat · drag to align the grid')); anchor.setAttribute('aria-valuemin', '0');
  anchor.setAttribute('aria-valuemax', String(buffer.duration)); waveform.append(anchor);
  anchor.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag = { id: event.pointerId, viewport: { ...timeline.viewport() }, rect: waveform.getBoundingClientRect() };
    anchor.setPointerCapture(event.pointerId); anchor.focus({ preventScroll: true });
  };
  anchor.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    state.start = Math.max(0, Math.min(buffer.duration, (drag.viewport.startMs + (event.clientX - drag.rect.left) / drag.rect.width *
      (drag.viewport.endMs - drag.viewport.startMs)) / 1000)); render();
  };
  const finish = event => {
    if (drag?.id !== event.pointerId) return;
    drag = null; if (anchor.hasPointerCapture(event.pointerId)) anchor.releasePointerCapture(event.pointerId); emit(true);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) anchor.addEventListener(type, finish, options);
  anchor.ondblclick = event => event.stopPropagation();
  anchor.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    state.start = event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, buffer.duration - state.bars * 240 / state.bpm) :
      Math.max(0, Math.min(buffer.duration, state.start + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .1 : .001)));
    emit(true);
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && armed) { armed = false; render(); } }, options);

  function renderMarker() {
    const percent = timeline.percent(state.start * 1000);
    anchor.hidden = panel.hidden || percent < 0 || percent > 100;
    anchor.style.left = `${percent}%`; anchor.setAttribute('aria-valuenow', String(state.start));
    anchor.title = pt('First beat · drag to align the grid');
    waveform.classList.toggle('is-placing-beat', armed && !panel.hidden);
  }
  function renderTempo() {
    if (document.activeElement !== bpm) bpm.value = String(Math.round(state.bpm * currentRate * 10) / 10);
    bpmLabel.title = `${bpm.title} · ${pt('Grid')}: ${Math.round(state.bpm * 10) / 10} BPM`;
  }
  function render() {
    if (disposed) return;
    bars.value = String(state.bars); renderTempo();
    mode.setAttribute('aria-checked', String(state.enabled)); mode.disabled = !state.enabled && !range();
    mode.title = state.enabled ? pt('Pattern replaces the drum stem · click for the original drums') : pt('Original drums · click to play the pattern');
    play.disabled = !playing && !range(); focus.disabled = !range();
    setStart.setAttribute('aria-pressed', String(armed));
    const assigned = sampler.snapshot();
    navigation.hidden = state.bars < 2;
    tabs.forEach((tab, i) => { tab.hidden = i >= state.bars; tab.setAttribute('aria-pressed', String(i === bar)); });
    cells.forEach((line, i) => {
      padButtons[i].classList.toggle('is-assigned', !!assigned[i]);
      padButtons[i].title = assigned[i] ? `${DRUM_KEYS[i]} · ${pt('Edit sample')}` : `${DRUM_KEYS[i]} · ${pt('Assign a sample')}`;
      padButtons[i].setAttribute('aria-label', padButtons[i].title);
      line.forEach((cell, column) => {
        const step = bar * 16 + column, value = state.steps[i][step];
        cell.disabled = !assigned[i]; cell.dataset.step = String(step); cell.dataset.velocity = String(value);
        cell.classList.toggle('is-on', value > 0); cell.classList.toggle('is-selected', selected.row === i && selected.step === step);
        cell.setAttribute('aria-pressed', String(value > 0)); cell.style.setProperty('--velocity', String(value));
        cell.setAttribute('aria-label', `${DRUM_KEYS[i]} · ${pt('Bar $1', bar + 1)} · ${pt('Step $1', column + 1)} · ${Math.round(value * 100)}%`);
      });
    });
    const value = state.steps[selected.row][selected.step];
    velocity.disabled = !value || !assigned[selected.row]; velocity.value = String(Math.round(value * 100) || 80);
    velocityLabel.title = `${pt('Hit velocity')} · ${DRUM_KEYS[selected.row]} · ${pt('Bar $1', Math.floor(selected.step / 16) + 1)} · ${pt('Step $1', selected.step % 16 + 1)}${value ? ` · ${Math.round(value * 100)}%` : ''}`;
    velocity.setAttribute('aria-label', velocityLabel.title);
    hint.textContent = !range() ? pt('The pattern exceeds the audio. Move the first beat, use fewer bars or raise the BPM.') :
      armed ? pt('Click the drum waveform to set the first beat. Esc cancels.') :
        !assigned.some(Boolean) ? pt('Choose a row letter, then click the waveform to assign a sample.') : '';
    hint.hidden = !hint.textContent;
    hint.classList.toggle('is-error', !range());
    renderMarker(); renderCursor();
  }
  function renderCursor() {
    for (const [column, beat] of beats.entries()) {
      const active = playing && currentStep === bar * 16 + column;
      beat.classList.toggle('is-current', active);
      for (const line of cells) line[column].classList.toggle('is-current', active);
    }
    play.innerHTML = svg(ICONS[playing ? 'pause' : 'play'], true);
    play.title = playing ? pt('Pause') : pt('Play pattern'); play.setAttribute('aria-label', play.title);
  }
  const key = () => JSON.stringify([state.bpm, state.bars, state.steps, sampler.snapshot()]);
  render();
  return {
    range, renderMarker, enabled: () => state.enabled,
    snapshot: () => normalizeSequence(state, buffer.duration),
    matchesRange: value => { const expected = range(); return expected && Math.abs(value.startMs - expected.startMs) < .01 && Math.abs(value.endMs - expected.endMs) < .01; },
    deactivate() { state.enabled = false; emit(); },
    samplesChanged() { emit(); },
    place(seconds) {
      if (!armed || panel.hidden) return false;
      state.start = Math.max(0, Math.min(buffer.duration, seconds)); armed = false; emit(true); return true;
    },
    updateTransport(position, active, rate) {
      const next = sequenceStep(state, range(), position);
      if (next === currentStep && playing === active && currentRate === rate) return;
      const tempoChanged = currentRate !== rate;
      currentStep = next; playing = active; currentRate = rate;
      play.disabled = !playing && !range();
      if (tempoChanged) renderTempo();
      if (!panel.hidden) renderCursor();
    },
    async prepare() {
      while (!disposed && state.enabled && range()) {
        const currentKey = key();
        if (currentKey === cacheKey && cache) return cache;
        if (pending) { await pending; continue; }
        const data = normalizeSequence(state, buffer.duration), slices = sampler.snapshot();
        pending = renderDrumPattern(data, slices, buffer).then(result => {
          if (!disposed && currentKey === key()) { cache = result; cacheKey = currentKey; }
        });
        try { await pending; } finally { pending = null; }
      }
      return null;
    },
    dispose() { disposed = true; controller.abort(); cache = null; panel.remove(); toggle.remove(); anchor.remove(); waveform.classList.remove('is-placing-beat'); },
  };
}
