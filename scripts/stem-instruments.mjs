import { createRowMenu } from './stem-row-menu.mjs';
import { MAX_PATTERNS, migrateLegacy, normalizeHits, normalizeInstrument, normalizePattern, normalizeProject, renderPattern, silentPattern } from './stem-pattern-core.mjs';

// Shared state of the channel rack and the piano roll, as in FL Studio: one focused
// track (instrument) and pattern, edited by both plugins. Patterns render to looping
// playlist assets at the project tempo. The plugins' play button previews the focused
// pattern alone (PAT); the playlist transport plays the song (SONG).
export function createInstruments({ playlist, tracks, audio, rate, changed = () => {}, report = console.error }) {
  let instruments = {}, patterns = [], focus = { track: null, pattern: null }, preview = null;
  let timer = 0, version = 0, bpm = playlist.bpm(), trackKey = '', buffers = 0;
  const listeners = new Set(), rendered = new Map(), bound = new Map(), placeholders = new Map(), bufferIds = new WeakMap();
  const assetId = id => `pattern:${id}`;
  const emit = kind => { for (const listener of listeners) listener(kind); };
  const track = key => tracks().find(item => item.key === key) || null;
  const patternsOf = () => patterns;
  const selectedPattern = () => patterns.find(item => item.id === focus.pattern) || null;
  function lane(pattern, key, create = false) {
    if (!pattern || !key) return null;
    if (pattern.track === key) return pattern;
    if (!pattern.channels[key] && create) pattern.channels[key] = { steps: Array.from({ length: 8 }, () => normalizeHits()), hits: normalizeHits(), notes: [] };
    return pattern.channels[key] || null;
  }
  function channelView(pattern, key) {
    if (!pattern) return null;
    const data = lane(pattern, key) || { steps: Array.from({ length: 8 }, () => normalizeHits()), hits: normalizeHits(), notes: [] };
    return { ...pattern, steps: data.steps, notes: data.notes, hits: data.hits };
  }
  const bufferId = buffer => { if (!buffer) return 0; if (!bufferIds.has(buffer)) bufferIds.set(buffer, ++buffers); return bufferIds.get(buffer); };

  // Slices are bounded by the track's audio; a new source re-bounds them.
  function instrument(key) {
    if (!key) return null;
    const buffer = track(key)?.buffer || null;
    if (!instruments[key] || (buffer && bound.get(key) !== buffer)) {
      instruments[key] = normalizeInstrument(instruments[key] || { mode: track(key)?.imported ? 'oneShot' : 'slices' }, buffer);
      if (buffer) bound.set(key, buffer);
    }
    return instruments[key];
  }
  function focused() {
    const key = focus.track;
    return { key, track: track(key), instrument: instrument(key), pattern: channelView(selectedPattern(), key) };
  }
  function setFocus(key, id = null) {
    const available = tracks().filter(item => item.buffer);
    if (!available.some(item => item.key === key)) key = available.some(item => item.key === focus.track) ? focus.track : available[0]?.key ?? null;
    const list = patternsOf(key);
    const pattern = list.find(item => item.id === id) || list.find(item => item.id === focus.pattern) || list[0] || null;
    if (preview && preview.id !== pattern?.id) stopPreview();
    focus = { track: key, pattern: pattern?.id ?? null };
    emit('focus');
  }
  function persist() { Promise.resolve(changed()).catch(report); }
  function createPattern(from = null, key = focus.track) {
    if (!key || patterns.length >= MAX_PATTERNS) return null;
    const numbers = patternsOf(key).map(item => Number(/^Pat (\d+)$/.exec(item.name)?.[1]) || 0);
    const pattern = normalizePattern({ ...(from && structuredClone(from)), id: crypto.randomUUID(), track: key, name: `Pat ${Math.max(0, ...numbers) + 1}` });
    patterns.push(pattern); focus = { track: key, pattern: pattern.id };
    publish(); schedule(); persist(); emit('patterns');
    return pattern;
  }
  // Editing with no pattern selected starts one, as drawing in an empty FL pattern does.
  function editPattern(mutate, key = focus.track) {
    const pattern = selectedPattern() || createPattern(null, key);
    if (!pattern) return null;
    const data = lane(pattern, key, true), view = channelView(pattern, key);
    mutate(view);
    pattern.bars = view.bars; pattern.name = view.name;
    data.steps = view.steps; data.notes = view.notes; data.hits = view.hits;
    schedule(); persist(); emit('pattern');
    return pattern;
  }
  function editInstrument(mutate, key = focus.track) {
    const value = instrument(key); if (!value) return;
    mutate(value); schedule(); persist(); emit('instrument');
  }
  function deletePattern(id = focus.pattern) {
    const index = patterns.findIndex(item => item.id === id); if (index < 0) return;
    if (preview?.id === id) stopPreview();
    patterns.splice(index, 1); rendered.delete(id);
    if (focus.pattern === id) focus.pattern = patternsOf(focus.track)[0]?.id ?? null;
    publish(); persist(); emit('patterns');
  }

  // Rendering: placeholders of the right length keep clips valid until audio lands.
  const channelKeys = pattern => [pattern.track, ...Object.keys(pattern.channels)];
  const contentKey = pattern => JSON.stringify([pattern, channelKeys(pattern).map(key => [instrument(key), bufferId(track(key)?.buffer),
    Object.keys(pattern.channels).length ? playlist.trackEq?.(key) : null]), playlist.bpm()]);
  function placeholder(pattern) {
    const key = `${pattern.bars}/${playlist.bpm()}`, cached = placeholders.get(pattern.id);
    if (cached?.key === key) return cached.buffer;
    const buffer = silentPattern(pattern, playlist.bpm()); placeholders.set(pattern.id, { key, buffer }); return buffer;
  }
  const nameOf = pattern => Object.keys(pattern.channels).length ? pattern.name : `${track(pattern.track)?.name || pattern.track} · ${pattern.name}`;
  function publish() {
    playlist.setPatterns(patterns.map(pattern => ({ id: assetId(pattern.id), name: nameOf(pattern), buffer: rendered.get(pattern.id)?.buffer || placeholder(pattern) })));
  }
  async function bufferOf(pattern) {
    const key = contentKey(pattern), cached = rendered.get(pattern.id);
    if (cached?.key === key) return cached.buffer;
    let buffer;
    if (!Object.keys(pattern.channels).length) buffer = await renderPattern(pattern, instrument(pattern.track), track(pattern.track)?.buffer, playlist.bpm());
    else {
      const base = placeholder(pattern), renderer = new OfflineAudioContext(2, base.length, base.sampleRate), graphs = [];
      try {
        for (const channel of channelKeys(pattern)) {
          const source = renderer.createBufferSource();
          source.buffer = await renderPattern({ ...lane(pattern, channel), bars: pattern.bars }, instrument(channel), track(channel)?.buffer, playlist.bpm());
          const eq = globalThis.SCParametricEQ?.createGraph(renderer);
          if (eq) { graphs.push(eq); eq.apply(playlist.trackEq?.(channel), false, true); source.connect(eq.input); eq.output.connect(renderer.destination); }
          else source.connect(renderer.destination);
          source.start();
        }
        buffer = await renderer.startRendering();
      } finally { for (const graph of graphs) graph.dispose(); }
    }
    if (patterns.includes(pattern) && contentKey(pattern) === key) rendered.set(pattern.id, { key, buffer });
    return buffer;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => flush().catch(report), 30); }
  async function flush() {
    const current = ++version;
    let dirty = false;
    for (const pattern of [...patterns]) {
      const before = rendered.get(pattern.id)?.buffer, buffer = await bufferOf(pattern);
      if (current !== version) return;
      if (buffer !== before && rendered.get(pattern.id)?.buffer === buffer) {
        dirty = true;
        if (preview?.id === pattern.id && preview.voice) swap(buffer);
      }
    }
    if (dirty) publish();
  }

  // PAT preview: the focused pattern loops on its own, at the global speed.
  function startVoice(token, buffer, phase) {
    const { context, output } = token.io, speed = rate();
    const source = context.createBufferSource(), gain = context.createGain(), when = context.currentTime + .01;
    source.buffer = buffer; source.loop = true; source.playbackRate.value = speed;
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + .005);
    source.connect(gain).connect(output); source.start(when, phase * buffer.duration);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    token.voice = { source, gain, buffer }; token.zero = when - phase * buffer.duration / speed; token.speed = speed;
  }
  function retire(voice, context) {
    const at = context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(at); voice.gain.gain.linearRampToValueAtTime(0, at + .01); voice.source.stop(at + .01);
  }
  function phase() {
    if (!preview?.voice) return -1;
    const elapsed = (preview.io.context.currentTime - preview.zero) * preview.speed;
    return elapsed < 0 ? 0 : elapsed / preview.voice.buffer.duration % 1;
  }
  function swap(buffer = preview?.voice?.buffer) {
    if (!preview?.voice) return;
    const old = preview.voice, at = phase();
    startVoice(preview, buffer, at); retire(old, preview.io.context);
  }
  async function play() {
    const pattern = selectedPattern();
    if (!pattern) return;
    stopPreview(); playlist.pause();
    const token = preview = { id: pattern.id };
    emit('transport');
    try {
      // The preview plays through its track's insert (EQ and fader).
      const [io, buffer] = await Promise.all([audio(Object.keys(pattern.channels).length ? null : pattern.track), bufferOf(pattern)]);
      if (preview !== token) return;
      token.io = io; startVoice(token, buffer, 0); emit('transport');
    } catch (error) { if (preview === token) preview = null; emit('transport'); report(error); }
  }
  function stopPreview() {
    if (!preview) return;
    if (preview.voice) retire(preview.voice, preview.io.context);
    preview = null; emit('transport');
  }

  return {
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    tracks: () => tracks(), focused, focus: setFocus, patternsOf, instrument,
    channel: key => channelView(selectedPattern(), key),
    focusPattern(id) { const pattern = patterns.find(item => item.id === id); if (pattern && pattern.id !== focus.pattern) setFocus(pattern.track, id); },
    createPattern: () => createPattern(),
    duplicatePattern: (id = focus.pattern) => { const pattern = patterns.find(item => item.id === id); return pattern && createPattern(pattern, pattern.track); },
    deletePattern, editPattern, editInstrument,
    place() { const pattern = focused().pattern; return !!pattern && playlist.place(assetId(pattern.id)); },
    play, stop: stopPreview, playing: () => !!preview, previewing: id => preview?.id === id, phase,
    rateChanged() { swap(); },
    // The playlist changed: tempo re-renders every pattern; new names or sources follow.
    sync() {
      const key = JSON.stringify(tracks().map(item => [item.key, item.name, bufferId(item.buffer), playlist.trackEq?.(item.key)]));
      const tempo = playlist.bpm();
      if (key === trackKey && tempo === bpm) return;
      trackKey = key; bpm = tempo;
      if (!track(focus.track)?.buffer) setFocus(focus.track); else emit('tracks');
      publish(); schedule();
    },
    snapshot: () => ({ instruments: Object.fromEntries(Object.entries(instruments).map(([key, value]) => [key, normalizeInstrument(value)])),
      patterns: patterns.map(pattern => structuredClone(pattern)) }),
    // Presets before the playlist patterns stored per-track editors; they migrate here.
    restore(saved = null) {
      stopPreview(); clearTimeout(timer); version++;
      const project = saved?.patterns || saved?.instruments ? normalizeProject(saved) : migrateLegacy(saved);
      instruments = project.instruments; patterns = project.patterns;
      rendered.clear(); bound.clear(); placeholders.clear(); trackKey = ''; bpm = Number.isFinite(saved?.playlist?.bpm) ? saved.playlist.bpm : playlist.bpm();
      focus = { track: null, pattern: null };
      // Placeholders at the saved tempo, so the playlist can validate saved clips.
      playlist.setPatterns(patterns.map(pattern => ({ id: assetId(pattern.id), name: `${pattern.track} · ${pattern.name}`, buffer: silentPattern(pattern, bpm) })));
      emit('patterns');
    },
    dispose() { stopPreview(); clearTimeout(timer); version++; listeners.clear(); },
  };
}

// Track and pattern selectors shared by both plugins. The pattern menu works like Player
// Tools' presets: each row has its own delete, which never opens the row. `manage` adds
// new and duplicate buttons; length belongs to the pattern, so both plugins show it.
export function patternControls(instruments, { manage = false } = {}) {
  const pt = globalThis.SCPlayerToolsText.t;
  const element = (tag, className) => { const node = document.createElement(tag); node.className = className; return node; };
  const select = (className, title, action) => {
    const node = element('select', className); node.title = pt(title); node.setAttribute('aria-label', pt(title));
    node.addEventListener('change', action); return node;
  };
  const button = (className, title, html, action) => {
    const node = element('button', className); node.type = 'button'; node.title = pt(title); node.setAttribute('aria-label', pt(title));
    node.innerHTML = html; node.addEventListener('click', action); return node;
  };
  const wrap = element('div', 'plugin-focus');
  const trackSelect = select('plugin-track', 'Playlist track', () => instruments.focus(trackSelect.value));
  const patternMenu = createRowMenu({ className: 'plugin-pattern', label: pt('Pattern'), placeholder: pt('New pattern'), empty: pt('No patterns yet'),
    deleteLabel: name => pt('Delete pattern: $1', name),
    onSelect: id => instruments.focus(instruments.focused().key, id),
    onDelete: id => instruments.deletePattern(id),
    footer: { label: `+ ${pt('New pattern')}`, action: () => instruments.createPattern() } });
  const bars = select('plugin-bars', 'Pattern length', () => instruments.editPattern(pattern => { pattern.bars = Number(bars.value); }));
  for (const value of [1, 2, 4]) bars.add(new Option(`${value} × 4/4`, String(value)));
  wrap.append(trackSelect, patternMenu.element);
  let add, copy;
  if (manage) {
    add = button('plugin-new', 'New pattern', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', () => instruments.createPattern());
    copy = button('plugin-duplicate', 'Duplicate pattern', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></svg>', () => instruments.duplicatePattern());
    wrap.append(add, copy);
  }
  wrap.append(bars);
  function render() {
    const { key, pattern } = instruments.focused(), list = instruments.tracks().filter(item => item.buffer);
    const tracks = list.map(item => `${item.key}:${item.name}`).join('|');
    if (trackSelect.dataset.options !== tracks) {
      trackSelect.replaceChildren(...list.map(item => new Option(item.name, item.key))); trackSelect.dataset.options = tracks;
    }
    trackSelect.value = key ?? ''; trackSelect.disabled = !list.length;
    patternMenu.setItems(instruments.patternsOf(key).map(item => ({ id: item.id, name: item.name })));
    patternMenu.setValue(pattern?.id ?? null); patternMenu.setDisabled(!key);
    bars.value = String(pattern?.bars ?? 1); bars.disabled = !key;
    if (manage) { add.disabled = !key; copy.disabled = !pattern; }
  }
  return { element: wrap, render };
}
