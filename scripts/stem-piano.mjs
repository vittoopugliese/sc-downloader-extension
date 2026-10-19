import { MAX_BARS, MAX_NOTES, PAD_KEYS, STEPS_PER_BAR, clamp, instrumentSample, noteName } from './stem-pattern-core.mjs';
import { PLUGIN_ICONS, pluginShell } from './stem-channel-rack.mjs';
import { patternControls } from './stem-instruments.mjs';
import { createNoteTake } from './stem-note-recording.mjs';

const ROW = 22;
const iconMarkup = name => globalThis.SCIcons.html(name, "icon");

// FL Studio's piano roll for the focused track and pattern: one pad of the track,
// pitched from its root note. Tempo and length come from the project and the pattern.
export function mountPianoRoll({ container, instruments, audioContext, output, report }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const shell = pluginShell({ container, id: 'stem-piano-roll', title: pt('Piano roll'), icon: PLUGIN_ICONS.piano, className: 'stem-piano-roll' });
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const button = (className, title, html, action) => {
    const node = element('button', className); node.type = 'button'; node.dataset.scdlTooltip = title; node.setAttribute('aria-label', title);
    node.innerHTML = html; node.addEventListener('click', action); return node;
  };
  const select = (className, title, values, action) => {
    const node = element('select', className); node.dataset.scdlTooltip = title; node.setAttribute('aria-label', title);
    for (const [value, label] of values) node.add(new Option(label, String(value)));
    node.addEventListener('change', action); return node;
  };
  const field = (title, control) => { const node = element('label', 'plugin-field', title); node.append(control); return node; };
  const piano = mutate => instruments.editInstrument(instrument => mutate(instrument.piano));

  const toolbar = element('div', 'plugin-toolbar'), editing = element('div', 'plugin-toolbar piano-editing');
  const play = button('plugin-play', pt('Play pattern'), iconMarkup(PLUGIN_ICONS.play), () => take || preparing ? finishTake() : instruments.playing() ? instruments.stop() : instruments.play());
  const focus = patternControls(instruments);
  const sample = select('piano-sample', pt('Piano sample'), [...PAD_KEYS].map((key, i) => [i, key]), () => { stopVoices(); piano(value => { value.pad = Number(sample.value); }); });
  const root = select('piano-root', pt('Root note'), Array.from({ length: 73 }, (_, i) => [i + 24, noteName(i + 24)]), () => { stopVoices(); piano(value => { value.root = Number(root.value); }); });
  const keyboardMode = button('piano-keyboard', pt('Typing keyboard to piano'), iconMarkup('piano'), () => {
    keyboardEnabled = !keyboardEnabled; if (!keyboardEnabled) { finishTake(); stopVoices(); } renderKeyboard(); grid.focus({ preventScroll: true });
  });
  const record = button('piano-record', pt('Record notes'), iconMarkup('record'), () => { if (take || preparing) finishTake(); else startTake(); });
  const recordingMode = select('piano-record-mode', pt('Recording mode'), [['loop', pt('Loop overdub')], ['extend', pt('Extend recording')]], () => {});
  const backing = select('piano-backing', pt('Backing loop'), [['song', pt('Playlist')], ['pattern', pt('Pattern')]], () => {});
  toolbar.append(play, record, keyboardMode, recordingMode, backing, focus.element, field(pt('Piano sample'), sample), field(pt('Root note'), root));
  const snap = select('piano-snap', pt('Snap notes'), [[4, '1/4'], [2, '1/8'], [1, '1/16'], [.5, '1/32']], () => piano(value => { value.snap = Number(snap.value); }));
  const octave = select('piano-octave', pt('Keyboard range'), [1, 2, 3, 4, 5].map(value => [value, `C${value}–C${Math.min(7, value + 4)}`]), () => piano(value => { value.octave = Number(octave.value); }));
  const sustain = element('input', 'piano-sustain'); sustain.type = 'checkbox';
  sustain.onchange = () => { stopVoices(); piano(value => { value.sustain = sustain.checked; }); };
  const undoButton = button('piano-undo', pt('Undo notes'), iconMarkup('undo'), () => history(undo, redo));
  const redoButton = button('piano-redo', pt('Redo notes'), iconMarkup('redo'), () => history(redo, undo));
  const clear = button('piano-clear', pt('Clear piano notes'), iconMarkup(PLUGIN_ICONS.clear), () => commit([]));
  const trim = button('piano-trim', pt('Trim pattern to notes'), iconMarkup('cut'), () => {
    const end = Math.max(1, ...notes().map(note => note.start + note.length));
    commit(structuredClone(notes()), snapshot(), Math.ceil(end / STEPS_PER_BAR));
  });
  editing.append(field(pt('Snap notes'), snap), octave, field(pt('Loop sample during notes'), sustain), undoButton, redoButton, clear, trim);
  const scroll = element('div', 'piano-scroll');
  const sheet = element('div', 'piano-sheet'), corner = element('span', 'piano-corner');
  corner.append(globalThis.SCIcons.create('music'));
  const ruler = element('div', 'piano-ruler'), keyboard = element('div', 'piano-keys'), grid = element('div', 'piano-grid');
  grid.tabIndex = 0; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('Piano notes'));
  const noteLayer = element('div', 'piano-notes'), cursor = element('span', 'piano-cursor'); cursor.setAttribute('aria-hidden', 'true');
  grid.append(noteLayer, cursor); sheet.append(corner, ruler, keyboard, grid); scroll.append(sheet);
  const hint = element('p', 'plugin-hint'); hint.setAttribute('role', 'status');
  const instructions = element('p', 'plugin-instructions', pt('Click to add a note with the length and velocity of the last note you clicked. Drag to move, drag the right edge to resize, Alt + drag up or down for velocity. Right-click deletes; Ctrl+D duplicates.'));
  const keyHelp = element('p', 'plugin-instructions', pt('Piano keyboard: Z–M and Q–U play white notes; the rows above play sharps. Recording follows Snap.'));
  const empty = element('p', 'plugin-empty', pt('Separate or import audio to start.'));
  shell.body.append(toolbar, editing, scroll, hint, instructions, keyHelp, empty);

  let selected = -1, drag = null, renderedGrid = '', renderedOctave = null, frame = 0, owner = null;
  // The next note copies the last clicked or edited note, as in FL Studio.
  let template = { length: 1, velocity: .8 };
  const undo = [], redo = [], held = new Map();
  let keyboardEnabled = false, take = null, preparing = null, captureFrame = 0, disposed = false, liveKey = null, voiceGeneration = 0;
  const current = () => instruments.focused();
  const settings = () => current().instrument?.piano;
  const notes = () => take?.notes ?? current().pattern?.notes ?? [];
  const count = () => (take?.bars ?? current().pattern?.bars ?? 1) * STEPS_PER_BAR;
  const low = () => (settings().octave + 1) * 12, high = () => Math.min(96, low() + 48);
  const slice = () => instrumentSample(current().instrument, current().track?.buffer);
  const snapshot = () => ({ notes: structuredClone(notes()), bars: current().pattern?.bars ?? 1 });
  function commit(next, before = snapshot(), bars = current().pattern?.bars ?? 1) {
    if (!current().key || take) return;
    undo.push(Array.isArray(before) ? { notes: structuredClone(before), bars } : structuredClone(before));
    if (undo.length > 50) undo.shift(); redo.length = 0;
    instruments.editPattern(pattern => { pattern.notes = next; pattern.bars = bars; });
  }
  function history(from, to) {
    if (!from.length || take) return;
    to.push(snapshot()); const next = from.pop(); selected = -1;
    instruments.editPattern(pattern => { pattern.notes = next.notes; pattern.bars = next.bars; });
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
  function renderKeyboard() {
    keyboardMode.setAttribute('aria-pressed', String(keyboardEnabled && shell.active()));
    for (const key of keyboard.querySelectorAll('.piano-key')) key.classList.toggle('is-active', [...held.values()].some(value => value.pitch === Number(key.dataset.pitch)));
  }
  function takeTime() { return take ? Math.max(0, (take.clock.context.currentTime - take.clock.zero) * take.bpm * take.speed / 15) : 0; }
  function release(code) {
    const key = held.get(code); if (!key) return;
    held.delete(code); key.voice?.release();
    if (take) {
      const before = take.notes.length, at = takeTime();
      take.up(code, at);
      if (take.loop) for (let i = before; i < take.notes.length; i++) {
        const start = take.notes[i].start;
        take.replay.set(i, start + (Math.floor((at - start) / count()) + 1) * count());
      }
      renderGrid(); renderNotes();
    }
    renderKeyboard();
  }
  function stopVoices() {
    voiceGeneration++;
    for (const code of [...held.keys()]) release(code);
    if (liveKey) instruments.voices(liveKey).stop();
  }
  function trigger(code, pitch, velocity = .8) {
    const { key, track, instrument } = current(), sampleSlice = slice();
    if (held.has(code) || !track?.buffer || !sampleSlice) return;
    const pending = { pitch, voice: null }, generation = voiceGeneration;
    held.set(code, pending); renderKeyboard(); liveKey = key;
    const y = (high() - pitch) * ROW + 24;
    if (y < scroll.scrollTop + 24) scroll.scrollTop = Math.max(0, y - 24);
    else if (y + ROW > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW - scroll.clientHeight;
    if (take) take.down(code, pitch, takeTime(), velocity);
    try {
      const context = audioContext();
      context.resume().then(() => {
        if (disposed || generation !== voiceGeneration || held.get(code) !== pending || !shell.active() || current().key !== key) return;
        pending.voice = instruments.voices(key).trigger(context, output(key), track.buffer, sampleSlice, instrument, { pitch, velocity });
      }).catch(report);
    } catch (error) { held.delete(code); report(error); }
  }
  function preview(pitch, velocity = .8) {
    const { key, track, instrument } = current(), sampleSlice = slice(), generation = voiceGeneration;
    if (!track?.buffer || !sampleSlice) return;
    liveKey = key;
    try {
      const context = audioContext();
      context.resume().then(() => {
        if (disposed || generation !== voiceGeneration || !shell.active() || current().key !== key) return;
        instruments.voices(key).trigger(context, output(key), track.buffer, sampleSlice, instrument, { pitch, velocity }, .6);
      }).catch(report);
    } catch (error) { report(error); }
  }
  async function startTake() {
    if (!slice() || preparing || take) return;
    if (!current().pattern && !instruments.createPattern()) return;
    stopVoices(); keyboardEnabled = true;
    const token = preparing = { key: current().key, pattern: current().pattern.id };
    render(); grid.focus({ preventScroll: true });
    try {
      const clock = await instruments.recordingClock(backing.value, () => preparing === token && !disposed && shell.active());
      if (preparing !== token || disposed || !shell.active() || current().key !== token.key || current().pattern?.id !== token.pattern) { clock?.stop(); return; }
      preparing = null;
      if (!clock) { render(); return; }
      take = Object.assign(createNoteTake(current().pattern, recordingMode.value, settings().snap), { clock, key: token.key, pattern: token.pattern, bpm: instruments.tempo(), speed: instruments.speed(), replay: new Map() });
      render(); renderTransport();
      const tick = () => {
        if (!take) return;
        if (!shell.active() || !take.clock.active() || take.bpm !== instruments.tempo() || take.speed !== instruments.speed()) { finishTake(); return; }
        const previousCount = count(), at = takeTime();
        take.advance(at);
        if (take.full) { finishTake(); hint.textContent = pt('Recording limit reached: $1 notes or $2 bars.', MAX_NOTES, MAX_BARS); hint.hidden = false; return; }
        renderGrid(); if (previousCount !== count()) renderNotes();
        // Overdubbed notes join the following passes immediately, without rendering
        // a growing AudioBuffer or restarting the accompaniment on every keyup.
        const secondsPerStep = 15 / take.bpm / take.speed;
        for (const [index, scheduled] of take.replay) {
          let next = scheduled;
          while (next < at - .05 / secondsPerStep) next += count();
          if (next <= at + .1 / secondsPerStep) {
            const { key, track, instrument } = current();
            instruments.voices(key).trigger(clock.context, output(key), track.buffer, slice(), instrument, take.notes[index],
              take.notes[index].length * secondsPerStep, Math.max(clock.context.currentTime, clock.zero + next * secondsPerStep));
            liveKey = key; next += count();
          }
          take.replay.set(index, next);
        }
        const position = take.loop ? at % count() : at;
        cursor.hidden = false; cursor.style.left = `${position / count() * 100}%`;
        const x = 46 + position / count() * grid.offsetWidth;
        if (x > scroll.scrollLeft + scroll.clientWidth - 30 || x < scroll.scrollLeft + 46) scroll.scrollLeft = Math.max(0, x - 70);
        captureFrame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) { preparing = null; render(); report(error); }
  }
  function finishTake() {
    if (preparing) { preparing = null; instruments.stop(); }
    if (take) {
      for (const code of [...held.keys()]) release(code);
      const captured = take; take = null; cancelAnimationFrame(captureFrame);
      captured.clock.stop(); stopVoices();
      if (current().key === captured.key && current().pattern?.id === captured.pattern && JSON.stringify(captured.notes) !== JSON.stringify(captured.before.notes)) {
        commit(captured.notes, captured.before, captured.bars);
      }
    }
    render(); renderTransport();
  }
  function renderGrid() {
    const key = `${settings().octave}/${count()}/${settings().snap}`;
    if (key === renderedGrid) return;
    renderedGrid = key;
    sheet.style.setProperty('--piano-steps', String(count()));
    sheet.style.setProperty('--piano-height', `${(high() - low() + 1) * ROW}px`);
    grid.style.setProperty('--piano-snap', String(settings().snap));
    ruler.replaceChildren(...Array.from({ length: count() / 4 }, (_, i) => element('span', '', `${Math.floor(i / 4) + 1}.${i % 4 + 1}`)));
    // Extending a take must keep the on-screen keys and their pointer captures.
    if (renderedOctave === settings().octave) return;
    renderedOctave = settings().octave;
    keyboard.replaceChildren(); grid.querySelectorAll('.piano-pitch-row').forEach(node => node.remove());
    for (let pitch = high(); pitch >= low(); pitch--) {
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      const key = button(`piano-key${black ? ' is-black' : ''}`, `${pt('Preview note')} ${noteName(pitch)}`, noteName(pitch), event => { if (event.detail === 0) preview(pitch); });
      key.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); key.setPointerCapture(event.pointerId); trigger(`pointer:${event.pointerId}`, pitch); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) key.addEventListener(type, event => release(`pointer:${event.pointerId}`));
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
      node.setAttribute('aria-pressed', String(selected === index)); node.dataset.scdlTooltip = node.getAttribute('aria-label');
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
    empty.hidden = available; for (const node of [toolbar, editing, scroll, hint, instructions, keyHelp]) node.hidden = !available;
    // History and the selection belong to one pattern.
    const id = `${key}/${pattern?.id}`;
    if (owner !== id) {
      // Drawing the first note creates the pattern; that note stays undoable.
      if (owner !== `${key}/undefined`) { undo.length = redo.length = 0; selected = -1; }
      owner = id;
    }
    focus.render();
    renderKeyboard();
    const recording = !!(take || preparing);
    record.setAttribute('aria-pressed', String(recording)); record.disabled = !track?.buffer || !slice();
    record.dataset.scdlTooltip = pt(recording ? 'Stop recording' : 'Record notes'); record.setAttribute('aria-label', record.dataset.scdlTooltip);
    for (const control of [...focus.element.querySelectorAll('button,input,select'), sample, root, octave, snap, sustain, recordingMode, backing]) control.disabled ||= recording;
    if (!recording) for (const control of [sample, root, octave, snap, sustain, recordingMode, backing]) control.disabled = false;
    if (!instrument) return;
    const value = instrument.piano;
    [...sample.options].forEach((option, i) => { option.textContent = instrument.slices[i] ? PAD_KEYS[i] : `${PAD_KEYS[i]} · ${pt('empty')}`; });
    sample.value = String(value.pad); root.value = String(value.root); snap.value = String(value.snap);
    sample.parentElement.hidden = instrument.mode === 'oneShot';
    sustain.parentElement.hidden = instrument.mode === 'oneShot';
    octave.value = String(value.octave); sustain.checked = value.sustain;
    clear.disabled = recording || !notes().length; trim.disabled = recording || !notes().length; undoButton.disabled = recording || !undo.length; redoButton.disabled = recording || !redo.length;
    play.disabled = !recording && !pattern && !instruments.playing();
    hint.textContent = !track?.buffer ? '' : !slice() ? pt('Pad $1 has no sample. Choose one in the channel rack, or pick another pad.', PAD_KEYS[value.pad]) :
      notes().length >= MAX_NOTES ? pt('Piano note limit reached (512).') : '';
    hint.hidden = !hint.textContent;
    renderGrid(); renderNotes(); renderKeyboard();
  }
  function renderTransport() {
    const playing = !!take || instruments.playing();
    play.innerHTML = iconMarkup(PLUGIN_ICONS[playing ? 'pause' : 'play']); play.setAttribute('aria-pressed', String(playing));
    play.dataset.scdlTooltip = pt(playing ? 'Pause' : 'Play pattern'); play.setAttribute('aria-label', play.dataset.scdlTooltip);
    cancelAnimationFrame(frame);
    const step = () => {
      if (take) return;
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
    if (take || preparing || event.button !== 0 || !current().key) return;
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
    const note = event.target.closest('.piano-note'); if (!note || take || preparing) return;
    event.preventDefault(); selected = Number(note.dataset.index); deleteNote();
  });
  shell.body.addEventListener('keydown', event => {
    if (event.target.closest('input,select,textarea') || event.target.isContentEditable || event.altKey) return;
    if ((take || preparing) && event.code !== 'Space') return;
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
  const blocked = event => event.target.closest?.('input,select,textarea,[contenteditable],.pl-menu,.row-menu-list,dialog,[aria-modal=true]') || document.querySelector('dialog[open],.pl-menu,.row-menu-list:popover-open');
  function keydown(event) {
    if (!keyboardEnabled || !shell.active() || blocked(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    const pitch = globalThis.SCSamplerCore.midiForEvent(event);
    if (pitch === null) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) trigger(event.code || event.key, pitch);
  }
  function keyup(event) {
    const code = event.code || event.key;
    if (!held.has(code)) return;
    event.preventDefault(); event.stopImmediatePropagation(); release(code);
  }
  function suspend() { finishTake(); stopVoices(); }
  function visibility() { if (document.hidden) suspend(); }
  const observer = new MutationObserver(() => { if (!shell.active()) suspend(); renderKeyboard(); });
  observer.observe(shell.section, { attributes: true, attributeFilter: ['hidden', 'class'] });
  observer.observe(shell.body, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', keydown, true); document.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', suspend); document.addEventListener('visibilitychange', visibility);
  const unsubscribe = instruments.on(kind => {
    if (kind.startsWith('before')) { if (take || preparing) finishTake(); if (kind !== 'beforepattern') stopVoices(); return; }
    if (take && (current().key !== take.key || current().pattern?.id !== take.pattern)) {
      // Focus changes are finalized before switching by the instruments controller.
      finishTake();
    }
    if (kind === 'transport') renderTransport(); else if (!drag) render();
  });
  render(); renderTransport();
  return {
    ...shell,
    dispose() {
      suspend(); disposed = true; observer.disconnect(); unsubscribe(); cancelAnimationFrame(frame); cancelAnimationFrame(captureFrame);
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', suspend); document.removeEventListener('visibilitychange', visibility); shell.section.remove();
    },
  };
}
