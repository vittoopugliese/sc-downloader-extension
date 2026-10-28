import { contextMenu } from './stem-playlist.mjs';
import { PAD_KEYS, STEPS_PER_BAR, clamp, instrumentSample, noteName, stepNotes } from './stem-pattern-core.mjs';

// All loaded sources share the selected pattern. The chops editor and piano roll
// edit a lane of that same pattern; changing selection never changes patterns.
// As in FL Studio, a channel with piano roll notes shows them in place of its steps;
// clicking them opens the piano roll.
export function mountRackOverview({ container, instruments, audioContext, output, report, openChops, openPiano = () => {} }) {
  const pt = globalThis.SCPlayerToolsText.t, rows = new Map(), voices = new Map();
  const grid = document.createElement('div'); grid.className = 'rack-overview';
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('All samples'));
  container.append(grid);
  let template = .8, gesture = null, disposed = false;
  const node = (tag, className, text) => { const n = document.createElement(tag); n.className = className; if (text) n.textContent = text; return n; };
  const button = (className, label, action) => { const n = node('button', className, label); n.type = 'button'; n.addEventListener('click', action); return n; };
  function stop(key) { for (const voice of voices.get(key) || []) voice.stop(); voices.delete(key); }
  function preview(key) {
    const track = instruments.tracks().find(item => item.key === key), instrument = instruments.instrument(key);
    const sample = instrumentSample(instrument, track?.buffer);
    if (!sample || !track?.buffer) return;
    if (instrument.cutSelf) stop(key);
    const group = voices.get(key) || new Set(), token = { stop() {} }; group.add(token); voices.set(key, group);
    try {
      const context = audioContext();
      context.resume().then(() => {
        if (disposed || voices.get(key) !== group || !group.has(token)) return;
        const voice = instruments.voices(key).trigger(context, output(key), track.buffer, sample, instrument,
          { pitch: instrument.piano.root, velocity: .8 }, sample.end - sample.start);
        if (!voice) { group.delete(token); return; }
        token.stop = voice.stop;
        voice.source.addEventListener('ended', () => { group.delete(token); if (!group.size && voices.get(key) === group) voices.delete(key); }, { once: true });
      }).catch(report);
    } catch (error) { voices.delete(key); report(error); }
  }
  const count = () => (instruments.focused().pattern?.bars || 1) * STEPS_PER_BAR;
  function values(key) {
    const pattern = instruments.channel(key), instrument = instruments.instrument(key);
    return instrument.mode === 'oneShot' ? pattern?.hits : pattern?.steps[instrument.piano.pad];
  }
  function edit(key, step, value) {
    instruments.editPattern(pattern => {
      const instrument = instruments.instrument(key);
      (instrument.mode === 'oneShot' ? pattern.hits : pattern.steps[instrument.piano.pad])[step] = value;
    }, key);
  }
  function create(track) {
    const row = node('div', 'rack-channel'); row.dataset.channel = track.key;
    const heading = node('div', 'rack-channel-controls');
    const play = button('rack-channel-play', '', () => preview(track.key));
    play.append(globalThis.SCIcons.create('play'));
    const name = button('rack-channel-name', track.name, () => instruments.focus(track.key));
    name.addEventListener('dblclick', () => openChops(track.key));
    const modes = node('div', 'rack-channel-modes');
    modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', pt('Sample mode'));
    const oneShot = button('rack-channel-one-shot', '', () => {
      if (instruments.focused().key !== track.key) instruments.focus(track.key);
      if (instruments.instrument(track.key).mode !== 'oneShot') instruments.editInstrument(value => { value.mode = 'oneShot'; }, track.key);
    });
    oneShot.append(globalThis.SCIcons.create('waveform'));
    oneShot.dataset.scdlTooltip = 'One-shot'; oneShot.setAttribute('aria-label', 'One-shot');
    const root = node('select', 'rack-channel-root');
    for (let i = 24; i <= 96; i++) root.add(new Option(noteName(i), String(i)));
    root.dataset.scdlTooltip = pt('Root note'); root.setAttribute('aria-label', pt('Root note'));
    root.onchange = () => { stop(track.key); instruments.editInstrument(value => { value.piano.root = Number(root.value); }, track.key); };
    const chops = button('rack-channel-chops', '', () => openChops(track.key));
    chops.append(globalThis.SCIcons.create('slice'));
    chops.dataset.scdlTooltip = pt('Edit chops'); chops.setAttribute('aria-label', pt('Edit chops'));
    modes.append(oneShot, chops);
    const piano = button('rack-channel-piano', '', () => openPiano(track.key));
    piano.append(globalThis.SCIcons.create('piano'));
    piano.dataset.scdlTooltip = pt('Piano roll'); piano.setAttribute('aria-label', pt('Piano roll'));
    const notes = node('button', 'rack-channel-notes'); notes.type = 'button'; notes.hidden = true;
    notes.addEventListener('click', () => openPiano(track.key));
    heading.append(play, name, root, modes, piano); row.append(heading, notes);
    heading.addEventListener('contextmenu', event => contextMenu(event, [
      { heading: track.name },
      { label: pt('Piano roll'), icon: 'piano', action: () => openPiano(track.key) },
      '-',
      // The fill replaces the channel's notes too: steps and notes are one list.
      ...[2, 4, 8].map(interval => ({ label: pt('Fill every $1 steps', interval), action: () => {
        instruments.editPattern(pattern => {
          const instrument = instruments.instrument(track.key);
          const lane = instrument.mode === 'oneShot' ? pattern.hits : pattern.steps[instrument.piano.pad];
          for (let i = 0; i < pattern.bars * STEPS_PER_BAR; i++) lane[i] = i % interval ? 0 : template;
          pattern.notes = [];
        }, track.key);
      } })),
      '-',
      { label: pt('Cut itself'), checked: instruments.instrument(track.key).cutSelf, action: () => {
        stop(track.key); instruments.voices(track.key).stop();
        instruments.editInstrument(value => { value.cutSelf = !value.cutSelf; }, track.key);
      } },
    ]));
    grid.append(row); return { row, name, play, oneShot, chops, root, notes, steps: [] };
  }
  function buildSteps(row, key) {
    if (row.steps.length === count()) return;
    for (const step of row.steps) step.remove();
    row.row.style.setProperty('--rack-steps', String(count()));
    row.steps = Array.from({ length: count() }, (_, column) => {
      const cell = button(`rack-step${column % 4 === 0 ? ' is-beat' : ''}${column % 16 === 0 ? ' is-bar' : ''}`, '', () => {});
      cell.dataset.channel = key; cell.dataset.column = String(column); row.row.append(cell); return cell;
    });
  }
  grid.addEventListener('pointerdown', event => {
    const cell = event.target.closest('.rack-step');
    if (!cell || cell.disabled || event.button !== 0) return;
    event.preventDefault(); cell.focus({ preventScroll: true });
    const key = cell.dataset.channel, step = Number(cell.dataset.column), velocity = values(key)?.[step] || 0;
    if (velocity) template = velocity;
    gesture = { id: event.pointerId, cell, key, step, velocity, y: event.clientY, dragged: false };
    cell.setPointerCapture(event.pointerId);
  });
  grid.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId || !gesture.velocity) return;
    const dy = gesture.y - event.clientY;
    if (!gesture.dragged && Math.abs(dy) < 3) return;
    gesture.dragged = true; template = Math.round(clamp(gesture.velocity + dy / 120, .01, 1) * 100) / 100;
    edit(gesture.key, gesture.step, template);
  });
  for (const type of ['pointerup', 'pointercancel']) grid.addEventListener(type, event => {
    if (gesture?.id !== event.pointerId) return;
    const current = gesture; gesture = null;
    if (current.cell.hasPointerCapture(event.pointerId)) current.cell.releasePointerCapture(event.pointerId);
    if (type === 'pointerup' && !current.dragged) edit(current.key, current.step, current.velocity ? 0 : template);
  });
  grid.addEventListener('contextmenu', event => {
    const cell = event.target.closest('.rack-step'); if (!cell) return;
    event.preventDefault(); edit(cell.dataset.channel, Number(cell.dataset.column), 0);
  });
  grid.addEventListener('keydown', event => {
    const cell = event.target.closest('.rack-step'); if (!cell || cell.disabled) return;
    const key = cell.dataset.channel, column = Number(cell.dataset.column), step = column;
    if (['Enter', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); edit(key, step, event.key === 'Enter' && !values(key)?.[step] ? template : 0); return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const velocity = values(key)?.[step]; if (velocity) edit(key, step, clamp(Math.round((velocity + (event.key === 'ArrowUp' ? .1 : -.1)) * 100) / 100, .01, 1));
      return;
    }
    const keys = [...rows.keys()], next = clamp(keys.indexOf(key) + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0), 0, keys.length - 1);
    const target = rows.get(keys[next]);
    if (target && !target.notes.hidden) target.notes.focus();
    else target?.steps[clamp(column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), 0, count() - 1)].focus();
  });
  // A small piano roll of the channel: its notes, and any steps it still has.
  function renderNotes(row, track, instrument) {
    const lane = instruments.channel(track.key), own = lane?.notes || [];
    row.notes.hidden = !own.length;
    for (const cell of row.steps) cell.hidden = !!own.length;
    if (!own.length) { row.drawn = ''; return; }
    const list = [...own, ...stepNotes(lane, instrument, track.buffer, instruments.tempo())], total = count();
    const revision = JSON.stringify([list, total]);
    const label = `${track.name} · ${pt('Piano roll')} · ${list.length}`;
    row.notes.dataset.scdlTooltip = label; row.notes.setAttribute('aria-label', label);
    if (row.drawn === revision) return;
    row.drawn = revision;
    const pitches = list.map(note => note.pitch), low = Math.min(...pitches), span = Math.max(...pitches) - low + 1;
    row.notes.replaceChildren(...list.filter(note => note.start < total).map(note => {
      const bar = node('span', 'rack-channel-note');
      bar.style.left = `${note.start / total * 100}%`; bar.style.width = `${Math.min(note.length, total - note.start) / total * 100}%`;
      bar.style.top = `${(low + span - 1 - note.pitch) / span * 100}%`; bar.style.height = `${100 / span}%`;
      bar.style.opacity = String(.45 + note.velocity * .55);
      return bar;
    }));
  }
  return {
    element: grid,
    render() {
      const tracks = instruments.tracks().filter(item => item.buffer), keys = new Set(tracks.map(item => item.key));
      for (const [key, row] of rows) if (!keys.has(key)) { stop(key); row.row.remove(); rows.delete(key); }
      for (const track of tracks) {
        if (!rows.has(track.key)) rows.set(track.key, create(track));
        const row = rows.get(track.key), instrument = instruments.instrument(track.key), selected = instruments.focused().key === track.key;
        const revision = JSON.stringify([instrument.mode, instrument.piano, instrument.slices, instrument.cutSelf]);
        if (row.revision !== revision || row.buffer !== track.buffer) { stop(track.key); instruments.voices(track.key).stop(); }
        row.revision = revision; row.buffer = track.buffer;
        buildSteps(row, track.key);
        row.name.textContent = track.name; row.name.dataset.scdlTooltip = track.name;
        row.name.setAttribute('aria-pressed', String(selected)); row.row.classList.toggle('is-selected', selected);
        row.play.setAttribute('aria-label', `${pt('Preview note')} · ${track.name}`);
        row.oneShot.setAttribute('aria-pressed', String(instrument.mode === 'oneShot'));
        row.chops.setAttribute('aria-pressed', String(instrument.mode === 'slices'));
        row.root.value = String(instrument.piano.root);
        const sample = instrumentSample(instrument, track.buffer); row.play.disabled = !sample;
        renderNotes(row, track, instrument);
        row.steps.forEach((cell, column) => {
          const velocity = values(track.key)?.[column] || 0;
          cell.disabled = !sample; cell.dataset.velocity = String(velocity); cell.dataset.step = String(column);
          cell.classList.toggle('is-on', velocity > 0); cell.setAttribute('aria-pressed', String(velocity > 0));
          cell.style.setProperty('--velocity', String(velocity));
          cell.dataset.scdlTooltip = `${track.name}${instrument.mode === 'slices' ? ` · ${PAD_KEYS[instrument.piano.pad]}` : ''} · ${pt('Step $1', column + 1)} · ${Math.round(velocity * 100)}%`;
          cell.setAttribute('aria-label', cell.dataset.scdlTooltip);
        });
      }
    },
    transport(step) {
      for (const row of rows.values()) {
        row.steps.forEach((cell, column) => cell.classList.toggle('is-current', step === column));
        row.notes.style.setProperty('--rack-cursor', step < 0 ? '-1' : String(step / count()));
      }
    },
    stop() { for (const key of voices.keys()) stop(key); },
    dispose() { disposed = true; for (const key of voices.keys()) stop(key); grid.remove(); },
  };
}
