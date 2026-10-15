import { MAX_PATTERNS, migrateLegacy, normalizeInstrument, normalizePattern, normalizeProject, renderPattern, silentPattern } from './stem-pattern-core.mjs';

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
  const patternsOf = key => patterns.filter(pattern => pattern.track === key);
  const bufferId = buffer => { if (!buffer) return 0; if (!bufferIds.has(buffer)) bufferIds.set(buffer, ++buffers); return bufferIds.get(buffer); };

  // Slices are bounded by the track's audio; a new source re-bounds them.
  function instrument(key) {
    if (!key) return null;
    const buffer = track(key)?.buffer || null;
    if (!instruments[key] || (buffer && bound.get(key) !== buffer)) {
      instruments[key] = normalizeInstrument(instruments[key], buffer);
      if (buffer) bound.set(key, buffer);
    }
    return instruments[key];
  }
  function focused() {
    const key = focus.track;
    return { key, track: track(key), instrument: instrument(key), pattern: patterns.find(item => item.id === focus.pattern && item.track === key) || null };
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
  function editPattern(mutate) {
    const pattern = focused().pattern || createPattern();
    if (!pattern) return null;
    mutate(pattern); schedule(); persist(); emit('pattern');
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
  const contentKey = pattern => JSON.stringify([pattern.bars, pattern.steps.map(row => row.slice(0, pattern.bars * 16)), pattern.notes,
    instrument(pattern.track), bufferId(track(pattern.track)?.buffer), playlist.bpm()]);
  function placeholder(pattern) {
    const key = `${pattern.bars}/${playlist.bpm()}`, cached = placeholders.get(pattern.id);
    if (cached?.key === key) return cached.buffer;
    const buffer = silentPattern(pattern, playlist.bpm()); placeholders.set(pattern.id, { key, buffer }); return buffer;
  }
  const nameOf = pattern => `${track(pattern.track)?.name || pattern.track} · ${pattern.name}`;
  function publish() {
    playlist.setPatterns(patterns.map(pattern => ({ id: assetId(pattern.id), name: nameOf(pattern), buffer: rendered.get(pattern.id)?.buffer || placeholder(pattern) })));
  }
  async function bufferOf(pattern) {
    const key = contentKey(pattern), cached = rendered.get(pattern.id);
    if (cached?.key === key) return cached.buffer;
    const buffer = await renderPattern(pattern, instrument(pattern.track), track(pattern.track)?.buffer, playlist.bpm());
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
    const pattern = focused().pattern;
    if (!pattern) return;
    stopPreview(); playlist.pause();
    const token = preview = { id: pattern.id };
    emit('transport');
    try {
      const [io, buffer] = await Promise.all([audio(), bufferOf(pattern)]);
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
    focusPattern(id) { const pattern = patterns.find(item => item.id === id); if (pattern && pattern.id !== focus.pattern) setFocus(pattern.track, id); },
    createPattern: () => createPattern(),
    duplicatePattern: () => { const pattern = focused().pattern; return pattern && createPattern(pattern); },
    deletePattern, editPattern, editInstrument,
    place() { const pattern = focused().pattern; return !!pattern && playlist.place(assetId(pattern.id)); },
    play, stop: stopPreview, playing: () => !!preview, previewing: id => preview?.id === id, phase,
    rateChanged() { swap(); },
    // The playlist changed: tempo re-renders every pattern; new names or sources follow.
    sync() {
      const key = JSON.stringify(tracks().map(item => [item.key, item.name, bufferId(item.buffer)]));
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

// Track and pattern selectors shared by both plugins. `manage` adds new, duplicate
// and delete; length belongs to the pattern, so both plugins show it.
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
  const patternSelect = select('plugin-pattern', 'Pattern', () => {
    if (patternSelect.value === '+') { instruments.createPattern(); return; }
    instruments.focus(instruments.focused().key, patternSelect.value);
  });
  const bars = select('plugin-bars', 'Pattern length', () => instruments.editPattern(pattern => { pattern.bars = Number(bars.value); }));
  for (const value of [1, 2, 4]) bars.add(new Option(`${value} × 4/4`, String(value)));
  wrap.append(trackSelect, patternSelect);
  let add, copy, remove;
  if (manage) {
    add = button('plugin-new', 'New pattern', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', () => instruments.createPattern());
    copy = button('plugin-duplicate', 'Duplicate pattern', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></svg>', () => instruments.duplicatePattern());
    remove = button('plugin-delete', 'Delete pattern', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/></svg>', () => instruments.deletePattern());
    wrap.append(add, copy, remove);
  }
  wrap.append(bars);
  function render() {
    const { key, pattern } = instruments.focused(), list = instruments.tracks().filter(item => item.buffer);
    const tracks = list.map(item => `${item.key}:${item.name}`).join('|');
    if (trackSelect.dataset.options !== tracks) {
      trackSelect.replaceChildren(...list.map(item => new Option(item.name, item.key))); trackSelect.dataset.options = tracks;
    }
    trackSelect.value = key ?? ''; trackSelect.disabled = !list.length;
    const patterns = instruments.patternsOf(key);
    patternSelect.replaceChildren(...patterns.map(item => new Option(item.name, item.id)));
    if (!pattern) patternSelect.prepend(new Option(pt('New pattern'), ''));
    patternSelect.add(new Option(`+ ${pt('New pattern')}`, '+'));
    patternSelect.value = pattern?.id ?? ''; patternSelect.disabled = !key;
    bars.value = String(pattern?.bars ?? 1); bars.disabled = !key;
    if (manage) { add.disabled = !key; copy.disabled = remove.disabled = !pattern; }
  }
  return { element: wrap, render };
}
