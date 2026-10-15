import { mountDrumSampler } from './stem-sampler.mjs';
import { patternPhase, sequenceRange } from './stem-sequencer-core.mjs';
import { clamp, MAX_PIANO_NOTES, normalizePiano, noteName, renderPianoPattern, schedulePianoNote } from './stem-piano-core.mjs';

// A melodic lane has its own sample and notes, but no independent transport or
// tempo. getGrid/setGrid are the same grid used by the existing pad sequencer.
export function mountStemPiano({ row, actions, waveform, buffer, timeline, saved, getGrid, setGrid,
  audioContext, output, level, rate, setRate, changed, togglePlayback, locale, report, id = 'other' }) {
  const pt = globalThis.SCPlayerToolsText.t, controller = new AbortController();
  const options = { signal: controller.signal };
  let state = normalizePiano(saved, buffer), selected = -1, disposed = false, drag = null;
  let playing = false, position = 0, cache = null, cacheKey = '', pending = null, previewRevision = 0;
  let renderedGrid = '', lastRate = rate(), previewBus = null;
  const voices = new Set(), undo = [], redo = [];
  const range = () => sequenceRange(getGrid(), buffer);
  const count = () => getGrid().bars * 16;
  const low = () => (state.octave + 1) * 12, high = () => low() + 24;
  const round = value => Math.round(value / state.snap) * state.snap;
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(className, title, content, action) {
    const node = element('button', className); node.type = 'button';
    node.title = pt(title); node.setAttribute('aria-label', pt(title));
    node.innerHTML = content; node.addEventListener('click', action, options); return node;
  }
  const svg = paths => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const pianoIcon = svg('<path d="M3 4h18v16H3zM7 4v9h3V4m4 0v9h3V4M9 13v7m6-7v7"/>');
  const playIcon = svg('<path d="m8 5 11 7-11 7z"/>'), pauseIcon = svg('<path d="M8 5v14M16 5v14"/>');
  const toggle = button('stem-piano-toggle', 'Piano roll', pianoIcon, () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden && !state.sample) sampler.editPad(0);
    if (panel.hidden) stopPreview();
    render();
  });
  toggle.setAttribute('aria-controls', `piano-${id}`); toggle.setAttribute('aria-expanded', String(state.mode !== 'off'));
  actions.insertBefore(toggle, actions.querySelector('.download'));
  const panel = element('section', 'stem-piano'); panel.id = `piano-${id}`; panel.hidden = state.mode === 'off';
  panel.setAttribute('aria-label', pt('Piano roll'));
  const sampler = mountDrumSampler({ row, actions, waveform, buffer, timeline, audioContext, output, level,
    locale, report, saved: [state.sample], keys: '♪', id: `piano-${id}`, keyboard: false,
    defaultLength: .5, title: 'Select piano sample', changed() {
      state.sample = sampler.snapshot()[0]; stopPreview(); emit();
    } });
  const controls = element('div', 'piano-controls');
  const play = button('piano-play', 'Play pattern', playIcon, () => {
    if (!playing) {
      if (!state.sample || !range()) { sampler.editPad(0); return; }
      if (state.mode === 'off') state.mode = 'layer';
      emit(true);
    }
    togglePlayback();
  });
  const sample = button('piano-sample', 'Select piano sample', svg('<path d="M3 3v18M21 3v18M5 12h3l2-6 4 12 2-6h3"/>'), () => sampler.assignPad(0));
  function select(className, title, values, action) {
    const node = element('select', className); node.title = pt(title); node.setAttribute('aria-label', pt(title));
    for (const [value, label] of values) node.add(new Option(label, String(value)));
    node.addEventListener('change', action, options); return node;
  }
  const root = select('piano-root', 'Root note', Array.from({ length: 73 }, (_, i) => [i + 24, noteName(i + 24)]), () => {
    state.root = Number(root.value); stopPreview(); emit();
  });
  const mode = select('piano-mode', 'Piano playback', [ ['off', pt('Original audio')], ['layer', pt('Layer piano')], ['replace', pt('Replace audio')] ], () => {
    state.mode = mode.value; emit(state.mode !== 'off');
  });
  const bpm = element('input', 'piano-bpm'); bpm.type = 'number'; bpm.min = '1'; bpm.max = '900'; bpm.step = '.1';
  bpm.title = pt('Tempo (BPM) · uses the speed slider; Keep Tone keeps the pitch'); bpm.setAttribute('aria-label', bpm.title);
  bpm.onchange = () => { const value = Number(bpm.value); if (value > 0 && Number.isFinite(value)) setRate(value / getGrid().bpm); render(); };
  const bars = select('piano-bars', 'Bars', [1, 2, 4].map(value => [value, `${value} × 4/4`]), () => setGrid({ bars: Number(bars.value) }));
  const fit = button('piano-fit', 'Fit the grid to the A–B loop', svg('<path d="M8 4H4v16h4M16 4h4v16h-4M8 12h8"/>'), () => {
    const loop = timeline.range(), seconds = (loop.endMs - loop.startMs) / 1000;
    const length = [getGrid().bars, 1, 2, 4].find(value => value * 240 / seconds >= 20 && value * 240 / seconds <= 300);
    if (length) setGrid({ bpm: length * 240 / seconds, bars: length, start: loop.startMs / 1000 });
  });
  const half = button('piano-half', 'Half grid tempo', '÷2', () => setGrid({ bpm: getGrid().bpm / 2 }));
  const double = button('piano-double', 'Double grid tempo', '×2', () => setGrid({ bpm: getGrid().bpm * 2 }));
  const align = button('piano-align', 'Use loop start as first beat', svg('<path d="M6 21V3h11l-3 4 3 4H6"/>'), () => setGrid({ start: timeline.range().startMs / 1000 }));
  const snap = select('piano-snap', 'Snap notes', [[4, '1/4'], [2, '1/8'], [1, '1/16'], [.5, '1/32']], () => { state.snap = Number(snap.value); render(); persist(); });
  const octave = select('piano-octave', 'Keyboard range', [1, 2, 3, 4, 5].map(value => [value, `C${value}–C${value + 2}`]), () => {
    state.octave = Number(octave.value); render(); persist();
  });
  const sustain = element('input', 'piano-sustain'); sustain.type = 'checkbox';
  sustain.setAttribute('aria-label', pt('Loop sample during notes'));
  sustain.onchange = () => { state.sustain = sustain.checked; stopPreview(); emit(); };
  function field(title, control) { const node = element('label', 'piano-field', pt(title)); node.append(control); return node; }
  const undoButton = button('piano-undo', 'Undo notes', '↶', () => history(undo, redo));
  const redoButton = button('piano-redo', 'Redo notes', '↷', () => history(redo, undo));
  const duplicate = button('piano-duplicate', 'Duplicate note', svg('<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>'), duplicateNote);
  const remove = button('piano-delete', 'Delete note', '×', deleteNote);
  const clear = button('piano-clear', 'Clear piano notes', svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/>'), () => {
    remember(); state.notes = []; selected = -1; emit();
  });
  const velocity = element('input', 'piano-velocity'); velocity.type = 'range'; velocity.min = '1'; velocity.max = '100';
  velocity.setAttribute('aria-label', pt('Note velocity'));
  velocity.oninput = () => {
    if (!state.notes[selected]) return;
    remember(); state.notes[selected].velocity = Number(velocity.value) / 100; emit();
  };
  controls.append(play, mode, sample, field('Root note', root), field('BPM', bpm), bars, fit, half, double, align);
  const editing = element('div', 'piano-controls piano-editing');
  editing.append(field('Snap notes', snap), octave, field('Loop sample during notes', sustain), undoButton, redoButton,
    duplicate, remove, clear, field('Note velocity', velocity));
  const scroll = element('div', 'piano-scroll');
  const sheet = element('div', 'piano-sheet'), corner = element('span', 'piano-corner', '♪');
  const ruler = element('div', 'piano-ruler'), keyboard = element('div', 'piano-keys'), grid = element('div', 'piano-grid');
  grid.tabIndex = 0; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Piano notes'));
  const noteLayer = element('div', 'piano-notes'), cursor = element('span', 'piano-cursor'); cursor.setAttribute('aria-hidden', 'true');
  grid.append(noteLayer, cursor); sheet.append(corner, ruler, keyboard, grid); scroll.append(sheet);
  const hint = element('p', 'piano-hint'); hint.setAttribute('role', 'status');
  const instructions = element('p', 'piano-instructions', pt('Click to draw notes; drag to move, drag the right edge to resize. Delete removes; arrows move; Shift + Left/Right resizes.'));
  panel.append(controls, editing, scroll, hint, instructions); row.append(panel);

  function persist() { Promise.resolve(changed({ loop: false, audio: false })).catch(report); }
  function emit(loop = false) {
    if (disposed) return;
    if (!range()) state.mode = 'off';
    render(); Promise.resolve(changed({ loop, audio: true })).catch(report);
  }
  function remember() {
    undo.push(structuredClone(state.notes)); if (undo.length > 50) undo.shift(); redo.length = 0;
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(structuredClone(state.notes)); state.notes = from.pop(); selected = -1; emit();
  }
  function deleteNote() {
    if (!state.notes[selected]) return;
    remember(); state.notes.splice(selected, 1); selected = -1; emit(); grid.focus({ preventScroll: true });
  }
  function duplicateNote() {
    const note = state.notes[selected]; if (!note || state.notes.length >= MAX_PIANO_NOTES) return;
    const start = note.start + note.length; if (start >= count()) return;
    remember(); state.notes.push({ ...note, start }); selected = state.notes.length - 1; emit(); focusNote();
  }
  function stopPreview() { previewRevision++; for (const voice of voices) voice.stop(); }
  async function preview(pitch) {
    if (!state.sample) return;
    const version = ++previewRevision;
    try {
      const context = audioContext(); await context.resume();
      if (disposed || panel.hidden || row.classList.contains('is-collapsed') || version !== previewRevision) return;
      if (voices.size >= 16) voices.values().next().value.stop();
      if (!previewBus) { previewBus = context.createGain(); previewBus.connect(output()); }
      previewBus.gain.value = level();
      const voice = schedulePianoNote(context, previewBus, buffer, state, { pitch, velocity: .8 }, context.currentTime, .6);
      if (!voice) return;
      voices.add(voice); voice.source.onended = () => { voice.cleanup(); voices.delete(voice); };
    } catch (error) { report(error); }
  }
  function renderGrid() {
    const key = `${state.octave}/${count()}/${state.snap}`;
    if (key === renderedGrid) return;
    renderedGrid = key;
    sheet.style.setProperty('--piano-steps', String(count()));
    grid.style.setProperty('--piano-snap', String(state.snap));
    ruler.replaceChildren(...Array.from({ length: count() / 4 }, (_, i) => element('span', '', `${Math.floor(i / 4) + 1}.${i % 4 + 1}`)));
    keyboard.replaceChildren(); grid.querySelectorAll('.piano-pitch-row').forEach(node => node.remove());
    for (let pitch = high(); pitch >= low(); pitch--) {
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      const key = button(`piano-key${black ? ' is-black' : ''}`, 'Preview note', noteName(pitch), () => preview(pitch));
      key.title = key.getAttribute('aria-label') + ' ' + noteName(pitch); key.setAttribute('aria-label', key.title);
      key.dataset.pitch = String(pitch); keyboard.append(key);
      const line = element('div', `piano-pitch-row${black ? ' is-black' : ''}`); line.style.top = `${(high() - pitch) * 22}px`;
      line.dataset.pitch = String(pitch); grid.prepend(line);
    }
  }
  function renderNotes() {
    const active = document.activeElement?.closest('.piano-note');
    noteLayer.replaceChildren();
    state.notes.forEach((note, index) => {
      if (note.start >= count() || note.pitch < low() || note.pitch > high()) return;
      const node = element('button', `piano-note${selected === index ? ' is-selected' : ''}`, noteName(note.pitch)); node.type = 'button';
      node.dataset.index = String(index); node.dataset.pitch = String(note.pitch); node.dataset.start = String(note.start);
      node.dataset.length = String(note.length); node.dataset.velocity = String(note.velocity);
      node.setAttribute('aria-label', `${noteName(note.pitch)} · ${pt('Step $1', note.start + 1)} · ${note.length} · ${Math.round(note.velocity * 100)}%`);
      node.setAttribute('aria-pressed', String(selected === index)); node.title = node.getAttribute('aria-label');
      node.style.left = `${note.start / count() * 100}%`; node.style.width = `${Math.min(note.length, count() - note.start) / count() * 100}%`;
      node.style.top = `${(high() - note.pitch) * 22 + 1}px`; node.style.setProperty('--note-velocity', String(note.velocity));
      const edge = element('span', 'piano-note-end'); edge.setAttribute('aria-hidden', 'true'); node.append(edge);
      noteLayer.append(node);
    });
    if (active && !drag) focusNote();
  }
  function focusNote() { noteLayer.querySelector(`[data-index="${selected}"]`)?.focus({ preventScroll: true }); }
  function render() {
    if (disposed) return;
    mode.value = state.mode; root.value = String(state.root); bars.value = String(getGrid().bars);
    snap.value = String(state.snap); octave.value = String(state.octave); sustain.checked = state.sustain;
    if (document.activeElement !== bpm) bpm.value = String(Math.round(getGrid().bpm * rate() * 10) / 10);
    mode.disabled = !state.sample || !range(); play.disabled = !playing && (!state.sample || !range());
    const note = state.notes[selected]; velocity.disabled = !note; velocity.value = String(Math.round((note?.velocity ?? .8) * 100));
    duplicate.disabled = !note || state.notes.length >= MAX_PIANO_NOTES; remove.disabled = !note;
    clear.disabled = !state.notes.length; undoButton.disabled = !undo.length; redoButton.disabled = !redo.length;
    sample.classList.toggle('is-assigned', !!state.sample);
    sample.title = `${pt('Select piano sample')}${state.sample ? ` · ${state.sample.start.toFixed(3)}–${state.sample.end.toFixed(3)} s` : ''}`;
    hint.textContent = !state.sample ? pt('Choose a sample from this track, assign its root note, then draw your melody.') :
      !range() ? pt('The pattern exceeds the audio. Move the first beat, use fewer bars or raise the BPM.') :
        state.notes.length >= MAX_PIANO_NOTES ? pt('Piano note limit reached (512).') : '';
    hint.hidden = !hint.textContent;
    renderGrid(); renderNotes(); updateCursor();
  }
  function updateCursor() {
    const fraction = patternPhase(getGrid(), buffer, position);
    cursor.hidden = !playing || fraction < 0 || fraction >= 1;
    cursor.style.left = `${fraction * 100}%`;
    if (play.dataset.playing !== String(playing)) {
      play.dataset.playing = String(playing); play.innerHTML = playing ? pauseIcon : playIcon;
      play.title = pt(playing ? 'Pause' : 'Play pattern'); play.setAttribute('aria-label', play.title);
    }
  }
  function point(event, rect) {
    return { start: clamp(Math.floor((event.clientX - rect.left) / rect.width * count() / state.snap) * state.snap, 0, count() - state.snap),
      pitch: clamp(high() - Math.floor((event.clientY - rect.top) / 22), low(), high()) };
  }
  grid.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !state.sample) return;
    event.preventDefault();
    const node = event.target.closest('.piano-note'), rect = grid.getBoundingClientRect(), at = point(event, rect);
    if (!node && state.notes.length >= MAX_PIANO_NOTES) return;
    const before = structuredClone(state.notes); let created = false;
    if (node) selected = Number(node.dataset.index);
    else { state.notes.push({ ...at, length: state.snap, velocity: .8 }); selected = state.notes.length - 1; created = true; }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, note: { ...state.notes[selected] }, before,
      kind: created || event.target.closest('.piano-note-end') ? 'resize' : 'move', created, changed: created };
    grid.setPointerCapture(event.pointerId); grid.focus({ preventScroll: true }); render(); preview(state.notes[selected].pitch);
  }, options);
  grid.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = round((event.clientX - drag.x) / drag.rect.width * count()), dy = Math.round((drag.y - event.clientY) / 22);
    const note = state.notes[selected];
    if (drag.kind === 'resize') note.length = clamp(drag.note.length + dx, state.snap, count() - note.start);
    else { note.start = clamp(drag.note.start + dx, 0, count() - Math.min(note.length, count())); note.pitch = clamp(drag.note.pitch + dy, 24, 96); }
    drag.changed ||= dx !== 0 || dy !== 0; renderNotes();
  }, options);
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    const gesture = drag; drag = null;
    if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel') { state.notes = gesture.before; selected = -1; render(); return; }
    if (gesture.changed) {
      undo.push(gesture.before); if (undo.length > 50) undo.shift(); redo.length = 0;
      if (gesture.created && state.mode === 'off' && range()) { state.mode = 'layer'; emit(true); } else emit();
    } else render();
    focusNote();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grid.addEventListener(type, finish, options);
  grid.addEventListener('contextmenu', event => {
    const note = event.target.closest('.piano-note'); if (!note) return;
    event.preventDefault(); selected = Number(note.dataset.index); deleteNote();
  }, options);
  panel.addEventListener('keydown', event => {
    if (event.target.closest('input,select,textarea') || event.altKey) return;
    const index = event.target.closest('.piano-note')?.dataset.index;
    if (index !== undefined) selected = Number(index);
    const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (command) {
      if (!['z', 'y', 'd'].includes(key)) return;
      event.preventDefault(); event.stopPropagation();
      if (key === 'd') duplicateNote(); else if (key === 'y' || event.shiftKey) history(redo, undo); else history(undo, redo);
      return;
    }
    if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) play.click(); return; }
    if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteNote(); return; }
    const note = state.notes[selected];
    if (!note || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); remember();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * state.snap;
      if (event.shiftKey) note.length = clamp(note.length + delta, state.snap, count() - note.start);
      else note.start = clamp(note.start + delta, 0, count() - Math.min(note.length, count()));
    } else note.pitch = clamp(note.pitch + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1), 24, 96);
    emit(); focusNote();
  }, options);
  window.addEventListener('blur', stopPreview, options);
  const key = () => JSON.stringify([state.sample, state.root, state.sustain, state.notes, getGrid().bpm, getGrid().bars]);
  render();
  return {
    range, sampler, snapshot: () => normalizePiano({ ...state, sample: sampler.snapshot()[0] }, buffer),
    enabled: () => state.mode !== 'off' && !!state.sample && !!range(), replaces: () => state.mode === 'replace',
    deactivate() { state.mode = 'off'; stopPreview(); emit(); },
    updateGain() { sampler.updateGain(); if (previewBus) previewBus.gain.setTargetAtTime(level(), previewBus.context.currentTime, .008); },
    gridChanged() { if (!range()) state.mode = 'off'; render(); },
    updateTransport(at, active, speed) {
      position = at;
      if (lastRate !== speed) { lastRate = speed; if (document.activeElement !== bpm) bpm.value = String(Math.round(getGrid().bpm * speed * 10) / 10); }
      if (playing !== active) { playing = active; play.disabled = !playing && (!state.sample || !range()); }
      if (!panel.hidden) updateCursor();
    },
    async prepare() {
      while (!disposed && state.mode !== 'off' && state.sample && range()) {
        const currentKey = key(); if (cache && cacheKey === currentKey) return cache;
        if (pending) { await pending; continue; }
        pending = renderPianoPattern(state, getGrid(), buffer).then(result => {
          if (!disposed && currentKey === key()) { cache = result; cacheKey = currentKey; }
        });
        try { await pending; } finally { pending = null; }
      }
      return null;
    },
    dispose() {
      disposed = true; previewRevision++; controller.abort();
      for (const voice of voices) { voice.source.stop(); voice.cleanup(); } voices.clear();
      previewBus?.disconnect();
      sampler.dispose(); cache = null; panel.remove(); toggle.remove();
    },
  };
}
