import { PAD_KEYS, STEPS_PER_BAR, clamp, instrumentSample, noteName, schedulePianoNote } from './stem-pattern-core.mjs';

// All loaded sources share the selected pattern. The chops editor and piano roll
// edit a lane of that same pattern; changing selection never changes patterns.
export function mountRackOverview({ container, instruments, audioContext, output, report, bar, openChops }) {
  const pt = globalThis.SCPlayerToolsText.t, rows = new Map(), voices = new Map();
  const grid = document.createElement('div'); grid.className = 'rack-overview';
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', pt('All samples'));
  container.append(grid);
  let template = .8, gesture = null, disposed = false;
  const node = (tag, className, text) => { const n = document.createElement(tag); n.className = className; if (text) n.textContent = text; return n; };
  const button = (className, label, action) => { const n = node('button', className, label); n.type = 'button'; n.addEventListener('click', action); return n; };
  function stop(key) { const voice = voices.get(key); voice?.stop(); voices.delete(key); }
  function preview(key) {
    const track = instruments.tracks().find(item => item.key === key), instrument = instruments.instrument(key);
    const sample = instrumentSample(instrument, track?.buffer);
    if (!sample || !track?.buffer) return;
    stop(key);
    const token = { stop() {} }; voices.set(key, token);
    try {
      const context = audioContext();
      context.resume().then(() => {
        if (disposed || voices.get(key) !== token) return;
        const voice = schedulePianoNote(context, output(key), track.buffer, sample, instrument.piano,
          { pitch: instrument.piano.root, velocity: .8 }, context.currentTime, sample.end - sample.start, instrument.mode === 'oneShot');
        if (!voice) return;
        voices.set(key, voice);
        voice.source.onended = () => { voice.cleanup(); if (voices.get(key) === voice) voices.delete(key); };
      }, report);
    } catch (error) { voices.delete(key); report(error); }
  }
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
    const play = button('rack-channel-play', '▶', () => preview(track.key));
    const name = button('rack-channel-name', track.name, () => instruments.focus(track.key));
    name.addEventListener('dblclick', () => openChops(track.key));
    const mode = node('select', 'rack-channel-mode');
    mode.add(new Option('One-shot', 'oneShot')); mode.add(new Option(pt('Chops'), 'slices'));
    mode.setAttribute('aria-label', pt('Sample mode'));
    mode.onchange = () => { stop(track.key); instruments.editInstrument(value => { value.mode = mode.value; }, track.key); };
    const root = node('select', 'rack-channel-root');
    for (let i = 24; i <= 96; i++) root.add(new Option(noteName(i), String(i)));
    root.title = pt('Root note'); root.setAttribute('aria-label', pt('Root note'));
    root.onchange = () => { stop(track.key); instruments.editInstrument(value => { value.piano.root = Number(root.value); }, track.key); };
    const chops = button('rack-channel-chops', '✂', () => openChops(track.key));
    chops.title = pt('Edit chops'); chops.setAttribute('aria-label', pt('Edit chops'));
    heading.append(play, name, mode, root, chops); row.append(heading);
    const steps = Array.from({ length: STEPS_PER_BAR }, (_, column) => {
      const cell = button(`rack-step${column % 4 === 0 ? ' is-beat' : ''}`, '', () => {});
      cell.dataset.channel = track.key; cell.dataset.column = String(column); row.append(cell); return cell;
    });
    grid.append(row); return { row, name, play, mode, root, steps };
  }
  grid.addEventListener('pointerdown', event => {
    const cell = event.target.closest('.rack-step');
    if (!cell || cell.disabled || event.button !== 0) return;
    event.preventDefault(); cell.focus({ preventScroll: true });
    const key = cell.dataset.channel, step = bar() * STEPS_PER_BAR + Number(cell.dataset.column), velocity = values(key)?.[step] || 0;
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
    event.preventDefault(); edit(cell.dataset.channel, bar() * STEPS_PER_BAR + Number(cell.dataset.column), 0);
  });
  grid.addEventListener('keydown', event => {
    const cell = event.target.closest('.rack-step'); if (!cell || cell.disabled) return;
    const key = cell.dataset.channel, column = Number(cell.dataset.column), step = bar() * STEPS_PER_BAR + column;
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
    rows.get(keys[next])?.steps[clamp(column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), 0, 15)].focus();
  });
  return {
    element: grid,
    render() {
      const tracks = instruments.tracks().filter(item => item.buffer), keys = new Set(tracks.map(item => item.key));
      for (const [key, row] of rows) if (!keys.has(key)) { stop(key); row.row.remove(); rows.delete(key); }
      for (const track of tracks) {
        if (!rows.has(track.key)) rows.set(track.key, create(track));
        const row = rows.get(track.key), instrument = instruments.instrument(track.key), selected = instruments.focused().key === track.key;
        const revision = JSON.stringify([instrument.mode, instrument.piano, instrument.slices]);
        if (row.revision !== revision || row.buffer !== track.buffer) stop(track.key);
        row.revision = revision; row.buffer = track.buffer;
        row.name.textContent = track.name; row.name.title = track.name;
        row.name.setAttribute('aria-pressed', String(selected)); row.row.classList.toggle('is-selected', selected);
        row.play.setAttribute('aria-label', `${pt('Preview note')} · ${track.name}`);
        row.mode.value = instrument.mode; row.root.value = String(instrument.piano.root);
        const sample = instrumentSample(instrument, track.buffer); row.play.disabled = !sample;
        row.steps.forEach((cell, column) => {
          const velocity = values(track.key)?.[bar() * STEPS_PER_BAR + column] || 0;
          cell.disabled = !sample; cell.dataset.velocity = String(velocity); cell.dataset.step = String(bar() * STEPS_PER_BAR + column);
          cell.classList.toggle('is-on', velocity > 0); cell.setAttribute('aria-pressed', String(velocity > 0));
          cell.style.setProperty('--velocity', String(velocity));
          cell.title = `${track.name}${instrument.mode === 'slices' ? ` · ${PAD_KEYS[instrument.piano.pad]}` : ''} · ${pt('Step $1', column + 1)} · ${Math.round(velocity * 100)}%`;
          cell.setAttribute('aria-label', cell.title);
        });
      }
    },
    transport(step) { for (const row of rows.values()) row.steps.forEach((cell, column) => cell.classList.toggle('is-current', step === bar() * 16 + column)); },
    stop() { for (const key of voices.keys()) stop(key); },
    dispose() { disposed = true; for (const key of voices.keys()) stop(key); grid.remove(); },
  };
}
