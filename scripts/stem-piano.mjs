import { MAX_NOTES, PAD_KEYS, STEPS_PER_BAR, clamp, noteName, schedulePianoNote } from './stem-pattern-core.mjs';
import { PLUGIN_ICONS, pluginShell } from './stem-channel-rack.mjs';
import { patternControls } from './stem-instruments.mjs';

const ROW = 22;
const svg = paths => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

// FL Studio's piano roll for the focused track and pattern: one pad of the track,
// pitched from its root note. Tempo and length come from the project and the pattern.
export function mountPianoRoll({ container, instruments, audioContext, output, report }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const shell = pluginShell({ container, id: 'stem-piano-roll', title: pt('Piano roll'), icon: PLUGIN_ICONS.piano, className: 'stem-piano-roll' });
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const button = (className, title, html, action) => {
    const node = element('button', className); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
    node.innerHTML = html; node.addEventListener('click', action); return node;
  };
  const select = (className, title, values, action) => {
    const node = element('select', className); node.title = title; node.setAttribute('aria-label', title);
    for (const [value, label] of values) node.add(new Option(label, String(value)));
    node.addEventListener('change', action); return node;
  };
  const field = (title, control) => { const node = element('label', 'plugin-field', title); node.append(control); return node; };
  const piano = mutate => instruments.editInstrument(instrument => mutate(instrument.piano));

  const toolbar = element('div', 'plugin-toolbar'), editing = element('div', 'plugin-toolbar piano-editing');
  const play = button('plugin-play', pt('Play pattern'), svg(PLUGIN_ICONS.play), () => instruments.playing() ? instruments.stop() : instruments.play());
  const focus = patternControls(instruments);
  const sample = select('piano-sample', pt('Piano sample'), [...PAD_KEYS].map((key, i) => [i, key]), () => { stopVoices(); piano(value => { value.pad = Number(sample.value); }); });
  const root = select('piano-root', pt('Root note'), Array.from({ length: 73 }, (_, i) => [i + 24, noteName(i + 24)]), () => { stopVoices(); piano(value => { value.root = Number(root.value); }); });
  toolbar.append(play, focus.element, field(pt('Piano sample'), sample), field(pt('Root note'), root));
  const snap = select('piano-snap', pt('Snap notes'), [[4, '1/4'], [2, '1/8'], [1, '1/16'], [.5, '1/32']], () => piano(value => { value.snap = Number(snap.value); }));
  const octave = select('piano-octave', pt('Keyboard range'), [1, 2, 3, 4, 5].map(value => [value, `C${value}–C${value + 2}`]), () => piano(value => { value.octave = Number(octave.value); }));
  const sustain = element('input', 'piano-sustain'); sustain.type = 'checkbox';
  sustain.onchange = () => { stopVoices(); piano(value => { value.sustain = sustain.checked; }); };
  const undoButton = button('piano-undo', pt('Undo notes'), '↶', () => history(undo, redo));
  const redoButton = button('piano-redo', pt('Redo notes'), '↷', () => history(redo, undo));
  const clear = button('piano-clear', pt('Clear piano notes'), svg(PLUGIN_ICONS.clear), () => commit([]));
  editing.append(field(pt('Snap notes'), snap), octave, field(pt('Loop sample during notes'), sustain), undoButton, redoButton, clear);
  const scroll = element('div', 'piano-scroll');
  const sheet = element('div', 'piano-sheet'), corner = element('span', 'piano-corner', '♪');
  const ruler = element('div', 'piano-ruler'), keyboard = element('div', 'piano-keys'), grid = element('div', 'piano-grid');
  grid.tabIndex = 0; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Piano notes'));
  const noteLayer = element('div', 'piano-notes'), cursor = element('span', 'piano-cursor'); cursor.setAttribute('aria-hidden', 'true');
  grid.append(noteLayer, cursor); sheet.append(corner, ruler, keyboard, grid); scroll.append(sheet);
  const hint = element('p', 'plugin-hint'); hint.setAttribute('role', 'status');
  const instructions = element('p', 'plugin-instructions', pt('Click to add a note with the length and velocity of the last note you clicked. Drag to move, drag the right edge to resize, Alt + drag up or down for velocity. Right-click deletes; Ctrl+D duplicates.'));
  const empty = element('p', 'plugin-empty', pt('Separate or import audio to start.'));
  shell.body.append(toolbar, editing, scroll, hint, instructions, empty);

  let selected = -1, drag = null, renderedGrid = '', previewBus = null, frame = 0, owner = null;
  // The next note copies the last clicked or edited note, as in FL Studio.
  let template = { length: 1, velocity: .8 };
  const voices = new Set(), undo = [], redo = [];
  const current = () => instruments.focused();
  const settings = () => current().instrument?.piano;
  const notes = () => current().pattern?.notes ?? [];
  const count = () => (current().pattern?.bars ?? 1) * STEPS_PER_BAR;
  const low = () => (settings().octave + 1) * 12, high = () => low() + 24;
  const slice = () => current().instrument?.slices[settings().pad] || null;
  function commit(next, before = notes()) {
    if (!current().key) return;
    undo.push(structuredClone(before)); if (undo.length > 50) undo.shift(); redo.length = 0;
    instruments.editPattern(pattern => { pattern.notes = next; });
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(structuredClone(notes())); const next = from.pop(); selected = -1;
    instruments.editPattern(pattern => { pattern.notes = next; });
  }
  function deleteNote() {
    if (!notes()[selected]) return;
    const next = structuredClone(notes()); next.splice(selected, 1); selected = -1; commit(next); grid.focus({ preventScroll: true });
  }
  function duplicateNote() {
    const note = notes()[selected]; if (!note || notes().length >= MAX_NOTES) return;
    const start = note.start + note.length; if (start >= count()) return;
    commit([...structuredClone(notes()), { ...note, start }]); selected = notes().length - 1; focusNote();
  }
  function stopVoices() { for (const voice of voices) voice.stop(); }
  function preview(pitch, velocity = .8) {
    const { track, instrument } = current();
    if (!track?.buffer || !slice()) return;
    try {
      const context = audioContext();
      context.resume().then(() => {
        if (!shell.active()) return;
        if (voices.size >= 16) voices.values().next().value.stop();
        if (!previewBus || previewBus.context !== context) { previewBus = context.createGain(); previewBus.connect(output()); }
        const voice = schedulePianoNote(context, previewBus, track.buffer, slice(), instrument.piano, { pitch, velocity }, context.currentTime, .6);
        if (!voice) return;
        voices.add(voice); voice.source.onended = () => { voice.cleanup(); voices.delete(voice); };
      }, report);
    } catch (error) { report(error); }
  }
  function renderGrid() {
    const key = `${settings().octave}/${count()}/${settings().snap}`;
    if (key === renderedGrid) return;
    renderedGrid = key;
    sheet.style.setProperty('--piano-steps', String(count()));
    grid.style.setProperty('--piano-snap', String(settings().snap));
    ruler.replaceChildren(...Array.from({ length: count() / 4 }, (_, i) => element('span', '', `${Math.floor(i / 4) + 1}.${i % 4 + 1}`)));
    keyboard.replaceChildren(); grid.querySelectorAll('.piano-pitch-row').forEach(node => node.remove());
    for (let pitch = high(); pitch >= low(); pitch--) {
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      const key = button(`piano-key${black ? ' is-black' : ''}`, `${pt('Preview note')} ${noteName(pitch)}`, noteName(pitch), () => preview(pitch));
      key.dataset.pitch = String(pitch); keyboard.append(key);
      const line = element('div', `piano-pitch-row${black ? ' is-black' : ''}`); line.style.top = `${(high() - pitch) * ROW}px`;
      line.dataset.pitch = String(pitch); grid.prepend(line);
    }
  }
  function renderNotes(list = drag?.notes ?? notes()) {
    const active = document.activeElement?.closest('.piano-note');
    noteLayer.replaceChildren();
    list.forEach((note, index) => {
      if (note.start >= count() || note.pitch < low() || note.pitch > high()) return;
      const percent = `${Math.round(note.velocity * 100)}%`;
      const node = element('button', `piano-note${selected === index ? ' is-selected' : ''}`, noteName(note.pitch)); node.type = 'button';
      node.dataset.index = String(index); node.dataset.pitch = String(note.pitch); node.dataset.start = String(note.start);
      node.dataset.length = String(note.length); node.dataset.velocity = String(note.velocity);
      if (drag?.kind === 'velocity' && drag.index === index) { node.classList.add('is-velocity'); node.dataset.tip = percent; }
      node.setAttribute('aria-label', `${noteName(note.pitch)} · ${pt('Step $1', note.start + 1)} · ${note.length} · ${percent}`);
      node.setAttribute('aria-pressed', String(selected === index)); node.title = node.getAttribute('aria-label');
      node.style.left = `${note.start / count() * 100}%`; node.style.width = `${Math.min(note.length, count() - note.start) / count() * 100}%`;
      node.style.top = `${(high() - note.pitch) * ROW + 1}px`; node.style.setProperty('--note-velocity', String(note.velocity));
      const edge = element('span', 'piano-note-end'); edge.setAttribute('aria-hidden', 'true'); node.append(edge);
      noteLayer.append(node);
    });
    if (active && !drag) focusNote();
  }
  function focusNote() { noteLayer.querySelector(`[data-index="${selected}"]`)?.focus({ preventScroll: true }); }
  function render() {
    const { key, pattern, instrument, track } = current(), available = instruments.tracks().some(item => item.buffer);
    empty.hidden = available; for (const node of [toolbar, editing, scroll, hint, instructions]) node.hidden = !available;
    // History and the selection belong to one pattern.
    const id = `${key}/${pattern?.id}`;
    if (owner !== id) {
      // Drawing the first note creates the pattern; that note stays undoable.
      if (owner !== `${key}/undefined`) { undo.length = redo.length = 0; selected = -1; }
      owner = id;
    }
    focus.render();
    if (!instrument) return;
    const value = instrument.piano;
    [...sample.options].forEach((option, i) => { option.textContent = instrument.slices[i] ? PAD_KEYS[i] : `${PAD_KEYS[i]} · ${pt('empty')}`; });
    sample.value = String(value.pad); root.value = String(value.root); snap.value = String(value.snap);
    octave.value = String(value.octave); sustain.checked = value.sustain;
    clear.disabled = !notes().length; undoButton.disabled = !undo.length; redoButton.disabled = !redo.length;
    play.disabled = !pattern && !instruments.playing();
    hint.textContent = !track?.buffer ? '' : !slice() ? pt('Pad $1 has no sample. Choose one in the channel rack, or pick another pad.', PAD_KEYS[value.pad]) :
      notes().length >= MAX_NOTES ? pt('Piano note limit reached (512).') : '';
    hint.hidden = !hint.textContent;
    renderGrid(); renderNotes();
  }
  function renderTransport() {
    const playing = instruments.playing();
    play.innerHTML = svg(PLUGIN_ICONS[playing ? 'pause' : 'play']); play.setAttribute('aria-pressed', String(playing));
    play.title = pt(playing ? 'Pause' : 'Play pattern'); play.setAttribute('aria-label', play.title);
    cancelAnimationFrame(frame);
    const step = () => {
      const phase = instruments.previewing(current().pattern?.id) ? instruments.phase() : -1;
      cursor.hidden = phase < 0; cursor.style.left = `${Math.max(0, phase) * 100}%`;
      if (instruments.playing()) frame = requestAnimationFrame(step);
    };
    step();
  }
  function point(event, rect) {
    const step = settings().snap;
    return { start: clamp(Math.floor((event.clientX - rect.left) / rect.width * count() / step) * step, 0, count() - step),
      pitch: clamp(high() - Math.floor((event.clientY - rect.top) / ROW), low(), high()) };
  }
  grid.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !current().key) return;
    if (!slice()) { hint.hidden = false; return; }
    event.preventDefault();
    const node = event.target.closest('.piano-note'), rect = grid.getBoundingClientRect();
    const draft = structuredClone(notes());
    if (!node && draft.length >= MAX_NOTES) return;
    let index, kind = 'move';
    if (node) {
      index = Number(node.dataset.index);
      template = { length: draft[index].length, velocity: draft[index].velocity };
      kind = event.altKey ? 'velocity' : event.target.closest('.piano-note-end') ? 'resize' : 'move';
    } else {
      const at = point(event, rect);
      draft.push({ ...at, length: Math.min(template.length, count() - at.start), velocity: template.velocity });
      index = draft.length - 1;
    }
    selected = index;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, index, kind, notes: draft, note: { ...draft[index] },
      before: notes(), changed: !node };
    grid.setPointerCapture(event.pointerId); grid.focus({ preventScroll: true }); renderNotes();
    if (kind !== 'velocity') preview(draft[index].pitch, draft[index].velocity);
  });
  grid.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const step = settings().snap, note = drag.notes[drag.index];
    const dx = Math.round((event.clientX - drag.x) / drag.rect.width * count() / step) * step, dy = Math.round((drag.y - event.clientY) / ROW);
    if (drag.kind === 'velocity') {
      note.velocity = Math.round(clamp(drag.note.velocity + (drag.y - event.clientY) / 120, .01, 1) * 100) / 100;
      template.velocity = note.velocity; drag.changed ||= note.velocity !== drag.note.velocity;
    } else if (drag.kind === 'resize') {
      note.length = clamp(drag.note.length + dx, step, count() - note.start);
      template.length = note.length; drag.changed ||= dx !== 0;
    } else {
      note.start = clamp(drag.note.start + dx, 0, count() - Math.min(note.length, count()));
      const pitch = clamp(drag.note.pitch + dy, 24, 96);
      if (pitch !== note.pitch) preview(pitch, note.velocity);
      note.pitch = pitch; drag.changed ||= dx !== 0 || dy !== 0;
    }
    renderNotes();
  });
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    const gesture = drag; drag = null;
    if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointercancel' && gesture.changed) commit(gesture.notes, gesture.before);
    else render();
    focusNote();
  }
  for (const type of ['pointerup', 'pointercancel']) grid.addEventListener(type, finish);
  grid.addEventListener('contextmenu', event => {
    const note = event.target.closest('.piano-note'); if (!note) return;
    event.preventDefault(); selected = Number(note.dataset.index); deleteNote();
  });
  shell.body.addEventListener('keydown', event => {
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
    const note = notes()[selected];
    if (!note || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = structuredClone(notes()), moved = next[selected], step = settings().snap;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * step;
      if (event.shiftKey) moved.length = clamp(moved.length + delta, step, count() - moved.start);
      else moved.start = clamp(moved.start + delta, 0, count() - Math.min(moved.length, count()));
    } else moved.pitch = clamp(moved.pitch + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1), 24, 96);
    commit(next); focusNote();
  });
  window.addEventListener('blur', stopVoices);
  instruments.on(kind => { if (kind === 'transport') renderTransport(); else if (!drag) render(); });
  render(); renderTransport();
  return {
    ...shell,
    dispose() { cancelAnimationFrame(frame); stopVoices(); previewBus?.disconnect(); window.removeEventListener('blur', stopVoices); shell.section.remove(); },
  };
}
