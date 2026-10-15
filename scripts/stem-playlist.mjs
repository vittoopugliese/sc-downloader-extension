import { LIMITS, uid, clamp, emptyArrangement, newClip, clipDuration, clipRate, clipPitch, clipEnvelope, slipClip, crossfadeClips, arrangementEnd, snapTime, splitClip, validateArrangement, needsStretch, trackAudible } from './stem-playlist-core.mjs';
import { createPlaylistEngine, createStretchCache, prefetchStretches, renderArrangement } from './stem-playlist-audio.mjs';
import { encodeWav } from './stem-audio.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';

const MIN_ZOOM = 8, MAX_ZOOM = 600;
// The workspace header's stem palette; user tracks continue in warm tints.
export const CHANNEL_COLORS = Object.freeze({ original: '#c8c2ba', drums: '#ff8a4c', bass: '#ffb98f', other: '#8c8c8c', vocals: '#ff5500' });
const EXTRA_COLORS = ['#ffd2b3', '#c56a3a', '#e9a27a', '#a39a90', '#ff7a2f', '#d9cfc4'];

// Rotary control: vertical drag (Shift for fine), arrows (Shift for coarse), Home/End,
// double-click resets. onInput runs while dragging; onCommit once with the previous value.
export function createKnob({ label, min, max, step, coarse, value, reset, format, log = false, hint = '', onInput, onCommit }) {
  const wrap = document.createElement('div'), dial = document.createElement('button'), caption = document.createElement('span'), output = document.createElement('output');
  wrap.className = 'pl-knob'; caption.className = 'pl-knob-label'; caption.textContent = label; output.className = 'pl-knob-value';
  dial.type = 'button'; dial.className = 'pad-knob'; dial.setAttribute('role', 'slider'); dial.setAttribute('aria-label', label);
  dial.setAttribute('aria-valuemin', String(min)); dial.setAttribute('aria-valuemax', String(max)); dial.setAttribute('aria-orientation', 'vertical');
  const unit = v => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const snapValue = v => clamp(Number((Math.round(v / step) * step).toFixed(4)), min, max);
  const fromUnit = u => snapValue(log ? min * (max / min) ** clamp(u, 0, 1) : min + clamp(u, 0, 1) * (max - min));
  let current = value, drag = null;
  function show(next) {
    current = next; const text = format(next);
    dial.style.setProperty('--knob-angle', `${-135 + clamp(unit(next), 0, 1) * 270}deg`);
    dial.setAttribute('aria-valuenow', String(next)); dial.setAttribute('aria-valuetext', text);
    dial.title = hint ? `${label}: ${text} · ${hint}` : `${label}: ${text}`; output.textContent = text;
  }
  const finish = (next, previous) => { if (next !== previous) onCommit(next, previous); };
  dial.onpointerdown = event => {
    if (event.button !== 0 || dial.disabled) return;
    event.preventDefault(); event.stopPropagation(); dial.setPointerCapture(event.pointerId); dial.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, unit: unit(current), start: current };
  };
  dial.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    const next = fromUnit(drag.unit + (drag.y - event.clientY) / (event.shiftKey ? 1200 : 150));
    if (next !== current) { show(next); onInput?.(next); }
  };
  dial.onpointerup = dial.onpointercancel = event => {
    if (drag?.id !== event.pointerId) return;
    const start = drag.start; drag = null; finish(current, start);
  };
  dial.ondblclick = () => { const previous = current; show(reset); finish(reset, previous); };
  dial.onkeydown = event => {
    const keys = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation();
    const previous = current;
    show(event.key === 'Home' ? min : event.key === 'End' ? max : snapValue(current + keys[event.key] * (event.shiftKey ? coarse : step)));
    finish(current, previous);
  };
  show(value); wrap.append(caption, dial, output);
  return { wrap, dial, show, value: () => current };
}

// The arrangement and the only transport of the Stem Extractor. The host page adds
// its channels (original and stems) with setSession and supplies persistent header
// and editor elements for them through `channel(track)`.
export function mountPlaylist({ container, audio, channel, onChange, onTransport, onViewChange, onLoopChange }) {
  const es = document.documentElement.lang === 'es', t = (en, spanish) => es ? spanish : en;
  let state = emptyArrangement(), assets = new Map(), selected = null, zoom = 48, snap = .25;
  let history = [], future = [], position = 0, ownContext, engine = null, engineIO = null, exporting = null;
  let drag = null, frame, operating = false, liveBefore = null, loopRange = null, rate = 1, rateTimer = 0;
  const rowViews = new Map(), clipViews = new Map(), analyzing = new WeakSet();
  let paintFrame = 0, shelfKey = '', editMode = 'move';
  // Channel header width comes from CSS (--pl-head), narrower on phones.
  let TRACK_HEAD = 236;
  const node = (tag, className = '', text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };
  const button = (text, title, action) => { const e = node('button', '', text); e.type = 'button'; e.title = title; e.setAttribute('aria-label', title); e.onclick = action; return e; };
  const report = value => { message.textContent = value instanceof Error ? value.message : value; };
  const safe = fn => async (...args) => { try { await fn(...args); } catch (error) { if (error.name !== 'AbortError') report(error); } };
  const picked = () => state.clips.find(c => c.id === selected);
  const copy = () => structuredClone(state);
  const trackOf = id => state.tracks.find(track => track.id === id);
  const color = track => CHANNEL_COLORS[track?.stem] || EXTRA_COLORS[Math.max(0, state.tracks.filter(item => !item.stem).indexOf(track)) % EXTRA_COLORS.length];
  const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  const now = () => engine?.now() ?? position;
  const playing = () => !!engine?.playing();
  const transport = () => ({ rate, loop: loopRange || (loop.checked && arrangementEnd(state) ? { start: 0, end: arrangementEnd(state) } : null) });
  // Stretched clips render in a worker; their clips show a striped overlay until ready.
  const stretchStatus = t('Stretching clips…', 'Estirando clips…');
  const stretching = clip => needsStretch(clip) && !cache.has(clip, assets.get(clip.asset));
  const cache = createStretchCache({ onChange() {
    for (const item of grid.querySelectorAll('.pl-clip')) {
      const clip = state.clips.find(c => c.id === item.dataset.clip);
      item.classList.toggle('is-stretching', !!clip && stretching(clip));
    }
    if (cache.busy()) report(stretchStatus); else if (message.textContent === stretchStatus) report('');
  } });
  function renderPlay(active) { play.textContent = active ? 'Ⅱ' : '▶'; play.setAttribute('aria-pressed', String(active)); }
  function stop(reset = false) {
    const was = playing(), at = engine?.stop();
    position = reset ? loopRange?.start ?? 0 : at ?? position;
    renderPlay(false); if (was) onTransport?.(false);
  }
  // Edits apply to the running schedule and warm the stretch cache; playback never stops.
  function changed() {
    engine?.update(state, transport());
    prefetchStretches(state, assets, cache, report);
    onChange?.();
  }
  function commit(action, before = copy()) {
    try { action(); validateArrangement(state, assets); }
    catch (error) { state = before; report(error); draw(); return false; }
    history.push(before); if (history.length > 50) history.shift(); future = [];
    changed(); draw(); return true;
  }
  const toolbar = node('div', 'pl-toolbar');
  const play = button('▶', t('Play / pause (Space)', 'Reproducir / pausar (Espacio)'), safe(toggle)); play.className = 'pl-play'; play.setAttribute('aria-pressed', 'false');
  const stopButton = button('■', t('Stop and rewind', 'Detener y volver al inicio'), () => stop(true));
  const time = node('output', 'pl-time', '0:00.00');
  const loopLabel = node('label', 'pl-field'), loop = node('input'); loop.type = 'checkbox'; loop.checked = true;
  loopLabel.title = t('Loop the arrangement when no A–B loop is set', 'Repetir el arreglo cuando no hay loop A–B');
  loopLabel.append(loop, document.createTextNode('Loop'));
  loop.onchange = () => engine?.update(state, transport());
  function field(text, type, value, min, max, step) {
    const label = node('label', 'pl-field', text), input = node('input'); input.type = type; input.value = String(value);
    input.setAttribute('aria-label', text); if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step;
    label.append(input); return { label, input };
  }
  const tempo = field('BPM', 'number', 120, 20, 300, 1); tempo.input.title = t('Grid tempo; audio speed is set per clip', 'Tempo de la grilla; la velocidad se cambia por clip');
  const loopA = field('A', 'number', 0, 0, LIMITS.seconds, .1), loopB = field('B', 'number', 0, 0, LIMITS.seconds, .1);
  loopA.input.setAttribute('aria-label', 'Loop A'); loopB.input.setAttribute('aria-label', 'Loop B');
  function changeLoop(range) {
    loopRange = range; engine?.update(state, transport()); renderLoopBand();
    onLoopChange?.(range);
  }
  for (const input of [loopA.input, loopB.input]) input.onchange = () => {
    const start = Number(loopA.input.value), end = Number(loopB.input.value);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= LIMITS.seconds) changeLoop({ start, end });
    else renderLoopBand();
  };
  const clearLoop = button('× A–B', t('Clear A–B loop', 'Quitar loop A–B'), () => changeLoop(null));
  tempo.input.onchange = () => commit(() => { state.bpm = Number(tempo.input.value); });
  const snapLabel = node('label', 'pl-field', 'Snap'), snapSelect = node('select'); snapSelect.setAttribute('aria-label', 'Snap');
  for (const [value, label] of [[0, 'Off'], [.25, '1/16'], [.5, '1/8'], [1, '1/4'], [4, t('Bar', 'Compás')]]) snapSelect.add(new Option(label, value));
  snapSelect.value = snap; snapSelect.onchange = () => { snap = Number(snapSelect.value); }; snapLabel.append(snapSelect);
  const undo = button('↶', t('Undo (Ctrl+Z)', 'Deshacer (Ctrl+Z)'), () => travel(false));
  const redo = button('↷', t('Redo (Ctrl+Shift+Z)', 'Rehacer (Ctrl+Shift+Z)'), () => travel(true));
  const fileInput = node('input'); fileInput.type = 'file'; fileInput.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.ogg'; fileInput.multiple = true; fileInput.hidden = true;
  fileInput.onchange = safe(async () => { const files = [...fileInput.files]; fileInput.value = ''; await importFiles(files); });
  const importButton = button(t('+ Samples', '+ Samples'), t('Import audio files', 'Importar archivos de audio'), () => fileInput.click());
  const addTrack = button(t('+ Track', '+ Pista'), t('Add track', 'Agregar pista'), () => commit(() => state.tracks.push({ id: uid(), name: `${t('Track', 'Pista')} ${state.tracks.filter(item => !item.stem).length + 1}`, gain: 1, mute: false, solo: false })));
  const exportButton = button('↓ WAV', t('Export playlist mix as WAV', 'Exportar mezcla de la playlist como WAV'), safe(exportMix));
  toolbar.append(play, stopButton, time, loopLabel, loopA.label, loopB.label, clearLoop, tempo.label, snapLabel, undo, redo, node('span', 'pl-spacer'), importButton, addTrack, exportButton, fileInput);
  const shelf = node('div', 'pl-shelf'); shelf.setAttribute('aria-label', t('Sample library', 'Biblioteca de samples'));
  const scroll = node('div', 'pl-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', t('Playlist timeline', 'Línea de tiempo de la playlist'));
  const grid = node('div', 'pl-grid'); scroll.append(grid);
  const waveCanvas = node('canvas', 'pl-wave-layer'); waveCanvas.setAttribute('aria-hidden', 'true'); grid.append(waveCanvas);
  const playhead = node('div', 'pl-playhead'); playhead.setAttribute('aria-hidden', 'true'); grid.append(playhead);
  const rulerRow = node('div', 'pl-grid-row pl-ruler-row'), corner = node('div', 'pl-track-head', t('CHANNELS', 'CANALES')), ruler = node('div', 'pl-ruler');
  rulerRow.append(corner, ruler); grid.prepend(rulerRow);
  let loopDrag;
  const rulerTime = event => clamp((event.clientX - ruler.getBoundingClientRect().left) / zoom, 0, LIMITS.seconds);
  ruler.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); loopDrag = { id: event.pointerId, x: event.clientX, at: rulerTime(event), before: loopRange }; ruler.setPointerCapture(event.pointerId); };
  ruler.onpointermove = event => {
    if (loopDrag?.id !== event.pointerId || Math.abs(event.clientX - loopDrag.x) < 4) return;
    const at = snapAt(rulerTime(event), event.altKey), from = snapAt(loopDrag.at, event.altKey);
    if (Math.abs(at - from) >= .01) { loopDrag.moved = true; changeLoop({ start: Math.min(at, from), end: Math.max(at, from) }); }
  };
  ruler.onpointerup = event => { if (loopDrag?.id !== event.pointerId) return; if (!loopDrag.moved) seek(rulerTime(event)); loopDrag = null; ruler.releasePointerCapture(event.pointerId); };
  ruler.onpointercancel = () => { if (loopDrag) changeLoop(loopDrag.before); loopDrag = null; };
  ruler.ondblclick = () => changeLoop(null);
  scroll.addEventListener('scroll', () => { paintSoon(); onViewChange?.(); });
  window.addEventListener('scroll', paintSoon, { passive: true });
  const viewObserver = new ResizeObserver(() => {
    scroll.style.setProperty('--pl-view', `${scroll.clientWidth}px`);
    if ((parseFloat(getComputedStyle(container).getPropertyValue('--pl-head')) || 236) !== TRACK_HEAD) draw();
    paintSoon();
  });
  viewObserver.observe(scroll);
  viewObserver.observe(grid);
  const inspector = node('div', 'pl-inspector');
  const selectionLabel = node('strong', 'pl-selected', t('Select a clip', 'Seleccioná un clip'));
  const modeLabel = node('label', 'pl-field', t('Pitch mode', 'Modo de pitch')), mode = node('select'); mode.setAttribute('aria-label', modeLabel.textContent);
  mode.add(new Option(t('Stretch · keep length', 'Stretch · conservar duración'), 'stretch'));
  mode.add(new Option(t('Resample · pitch + speed', 'Resample · pitch + velocidad'), 'resample')); modeLabel.append(mode);
  mode.onchange = () => commit(() => { if (picked()) picked().keepLength = mode.value === 'stretch'; });
  const setClip = (key, value) => commit(() => { if (picked()) picked()[key] = value; });
  const signed = v => `${v > 0 ? '+' : ''}${Number(v.toFixed(2))}`;
  const resetHint = t('drag, or double-click to reset', 'arrastrá, o doble clic para resetear');
  const pitch = createKnob({ label: 'Pitch', min: -24, max: 24, step: 1, coarse: 12, value: 0, reset: 0, hint: resetHint, format: v => `${signed(v)} st`, onCommit: v => setClip('pitch', v) });
  const fine = createKnob({ label: t('Fine pitch', 'Pitch fino'), min: -100, max: 100, step: 1, coarse: 10, value: 0, reset: 0, hint: resetHint, format: v => `${signed(v)} ct`, onCommit: v => setClip('cents', v) });
  const speed = createKnob({ label: t('Speed', 'Velocidad'), min: .25, max: 4, step: .01, coarse: .25, value: 1, reset: 1, log: true, hint: resetHint, format: v => `${v.toFixed(2)}×`, onCommit: v => setClip('speed', v) });
  const gain = createKnob({ label: t('Gain', 'Volumen'), min: 0, max: 200, step: 1, coarse: 10, value: 100, reset: 100, hint: resetHint, format: v => `${v}%`, onCommit: v => setClip('gain', v / 100) });
  const fades = ['fadeIn', 'fadeOut'].map((key, i) => createKnob({ label: i ? 'Fade out' : 'Fade in', min: 0, max: 10, step: .01, coarse: .1, value: 0, reset: 0, format: v => `${v.toFixed(2)} s`, onCommit: v => setClip(key, v) }));
  const muteClip = button(t('Mute clip', 'Silenciar clip'), t('Mute selected clip', 'Silenciar clip seleccionado'), () => setClip('mute', !picked()?.mute));
  const reverseClip = button(t('Reverse', 'Invertir'), t('Reverse selected clip', 'Invertir clip seleccionado'), () => setClip('reverse', !picked()?.reverse));
  const crossfade = button(t('Crossfade overlaps', 'Fundir superposiciones'), t('Apply fades to overlapping clips on each track', 'Aplicar fundidos a clips superpuestos en cada pista'), () => commit(() => crossfadeClips(state.clips)));
  const tool = node('select'); tool.setAttribute('aria-label', t('Edit tool', 'Herramienta de edición'));
  for (const [value, label] of [['move', t('Move / trim', 'Mover / recortar')], ['slip', t('Slip content', 'Deslizar contenido')], ['stretch', t('Stretch edge', 'Estirar borde')]]) tool.add(new Option(label, value));
  tool.onchange = () => { editMode = tool.value; };
  const duplicate = button(t('Duplicate', 'Duplicar'), 'Ctrl+D', () => commit(() => { const clip = picked(); if (clip) { const next = { ...clip, id: uid(), at: clip.at + clipDuration(clip) }; state.clips.push(next); selected = next.id; } }));
  const split = button(t('Split at cursor', 'Cortar en cursor'), t('Split selected clip at playhead (S)', 'Cortar el clip seleccionado en el cursor (S)'), () => commit(() => {
    const clip = picked(), pieces = clip && splitClip(clip, now()); if (pieces) state.clips.splice(state.clips.indexOf(clip), 1, ...pieces);
  }));
  const remove = button(t('Delete', 'Eliminar'), 'Delete', () => commit(() => { state.clips = state.clips.filter(c => c.id !== selected); selected = null; }));
  inspector.append(selectionLabel, pitch.wrap, fine.wrap, speed.wrap, gain.wrap, ...fades.map(f => f.wrap), modeLabel, tool, muteClip, reverseClip, crossfade, duplicate, split, remove);
  // Same navigation as the stem waveforms: wheel zooms around the pointer, Shift pans.
  const zoomTools = node('div', 'pl-zoom');
  const fit = () => { scroll.scrollLeft = 0; zoomAround(0, (scroll.clientWidth - TRACK_HEAD - 12) / Math.max(1, arrangementEnd(state) || 16) / zoom); };
  for (const [label, title, action] of [
    ['−', t('Zoom out', 'Alejar'), () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1 / 1.5)],
    ['+', t('Zoom in', 'Acercar'), () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1.5)],
    ['↔', t('Show the whole arrangement', 'Ver todo el arreglo'), fit],
  ]) zoomTools.append(button(label, title, action));
  zoomTools.append(node('span', '', t('Wheel: zoom · Shift + wheel: pan', 'Rueda: zoom · Shift + rueda: desplazar')));
  let zoomFrame = 0, zoomTarget = null, zoomAnchor = null;
  function zoomAround(x, factor) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    x = Math.max(0, x);
    zoomAnchor ||= { at: (scroll.scrollLeft + x) / zoom };
    zoomAnchor.x = x; zoomTarget = clamp((zoomTarget ?? zoom) * factor, MIN_ZOOM, MAX_ZOOM);
    zoomFrame ||= requestAnimationFrame(() => {
      const anchor = zoomAnchor; zoom = zoomTarget; zoomFrame = 0; zoomTarget = zoomAnchor = null;
      draw(); scroll.scrollLeft = anchor.at * zoom - anchor.x; paintSoon(); onViewChange?.();
    });
  }
  scroll.addEventListener('wheel', event => {
    // Channel editors keep their own waveform zoom.
    if (event.target.closest?.('.pl-drawer') || (!event.deltaY && !event.deltaX)) return;
    event.preventDefault();
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { scroll.scrollLeft += event.deltaX || event.deltaY; return; }
    zoomAround(event.clientX - scroll.getBoundingClientRect().left - TRACK_HEAD, Math.exp(-clamp(event.deltaY, -200, 200) * .002));
  }, { passive: false });
  const hint = node('p', 'pl-hint', t('Drag clips to move · edges to trim · Alt bypasses snap · Space plays · S splits · drop audio files on a track. The A–B loop above loops the playlist. 16 tracks / 5 minutes.', 'Arrastrá clips para mover · bordes para recortar · Alt desactiva snap · Espacio reproduce · S corta · soltá audio en una pista. El loop A–B de arriba repite la playlist. 16 pistas / 5 minutos.'));
  const message = node('p', 'pl-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  container.classList.add('playlist'); container.tabIndex = -1;
  container.append(toolbar, shelf, zoomTools, scroll, inspector, hint, message);

  function travel(forward) {
    const from = forward ? future : history, to = forward ? history : future;
    if (!from.length) return;
    to.push(copy()); state = from.pop(); changed(); draw();
  }
  function checkBudget(next) {
    let bytes = 0; for (const asset of next.values()) bytes += asset.buffer.length * asset.buffer.numberOfChannels * 4;
    if (bytes > LIMITS.pcmBytes || next.size > 64) throw new Error(t('Sample library limit: 256 MiB / 64 samples.', 'Límite de biblioteca: 256 MiB / 64 samples.'));
  }
  const firstUserTrack = () => state.tracks.find(track => !track.stem)?.id || state.tracks[0].id;
  async function importFiles(files, track = firstUserTrack(), at = position) {
    if (operating) return;
    operating = true; report(t('Reading samples…', 'Leyendo samples…'));
    try {
      const next = new Map(assets), additions = [];
      for (const file of files) {
        if (file.size > 64 * 1024 * 1024) throw new Error(t('Each file must be smaller than 64 MiB.', 'Cada archivo debe pesar menos de 64 MiB.'));
        const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
        if (buffer.duration > LIMITS.seconds || buffer.numberOfChannels > 2) throw new Error(t('Use mono/stereo samples up to 5 minutes.', 'Usá samples mono/estéreo de hasta 5 minutos.'));
        const asset = { id: uid(), name: file.name.slice(0, 160), buffer, version: 0 }; next.set(asset.id, asset); additions.push(asset); checkBudget(next);
      }
      assets = next;
      if (commit(() => { for (const asset of additions) { const clip = newClip(asset, track, at); state.clips.push(clip); selected = clip.id; at += clipDuration(clip); } })) report(t('Samples ready.', 'Samples listos.'));
    } finally { operating = false; }
  }
  const snapAt = (seconds, bypass = false) => clamp(bypass ? seconds : snapTime(seconds, state.bpm, snap), 0, LIMITS.seconds);
  // One canvas follows the visible viewport; editors and hit targets persist.
  function paintSoon() {
    paintFrame ||= requestAnimationFrame(() => { paintFrame = 0; paint(); });
  }
  function drawWave(ctx, clip, left, top, width, height) {
    const buffer = assets.get(clip.asset)?.buffer;
    if (!buffer) return;
    const spectrum = spectrumNow(buffer);
    if (!spectrum && !analyzing.has(buffer)) {
      analyzing.add(buffer); spectrumOf(buffer).then(paintSoon, () => {});
    }
    const data = buffer.getChannelData(0), bins = spectrum?.peaks.length;
    const binSeconds = spectrum ? spectrum.durationMs / 1000 / bins : 0;
    const startX = Math.max(TRACK_HEAD, Math.floor(left)), endX = Math.min(scroll.clientWidth, Math.ceil(left + width));
    for (let x = startX; x < endX; x++) {
      const a = clamp((x - left) / width, 0, 1), b = clamp((x + 1 - left) / width, 0, 1), span = clip.out - clip.in;
      const from = clip.reverse ? clip.out - b * span : clip.in + a * span;
      const to = clip.reverse ? clip.out - a * span : clip.in + b * span;
      let peak = 0;
      if (spectrum) {
        let low = 0, mid = 0, high = 0;
        const first = Math.max(0, Math.floor(from / binSeconds)), last = Math.min(bins, Math.max(first + 1, Math.ceil(to / binSeconds)));
        for (let i = first; i < last; i++) { peak = Math.max(peak, spectrum.peaks[i]); low += spectrum.bands[i * 3]; mid += spectrum.bands[i * 3 + 1]; high += spectrum.bands[i * 3 + 2]; }
        ctx.fillStyle = spectrumColor(low, mid, high);
      } else {
        const first = Math.floor(from * buffer.sampleRate), last = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate)), stride = Math.max(1, Math.floor((last - first) / 64));
        for (let i = first; i < last; i += stride) peak = Math.max(peak, Math.abs(data[i]));
        ctx.fillStyle = '#858d96';
      }
      const bar = Math.min(1, peak) * height * .88;
      if (bar > .02) ctx.fillRect(x, top + (height - bar) / 2, 1, Math.max(1, bar));
    }
    if (clip.fadeIn || clip.fadeOut) {
      ctx.strokeStyle = '#fff9'; ctx.beginPath();
      for (let x = startX; x < endX; x++) {
        const y = top + height * (1 - clipEnvelope(clip, (x - left) / zoom));
        if (x === startX) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  function paint() {
    const rect = grid.getBoundingClientRect(), y = Math.max(0, -rect.top);
    const height = Math.max(1, Math.min(rect.height - y, innerHeight - Math.max(0, rect.top)));
    const width = scroll.clientWidth, scale = Math.min(2, devicePixelRatio || 1);
    waveCanvas.style.left = scroll.scrollLeft + 'px'; waveCanvas.style.top = y + 'px';
    waveCanvas.style.width = width + 'px'; waveCanvas.style.height = height + 'px';
    if (waveCanvas.width !== Math.ceil(width * scale)) waveCanvas.width = Math.ceil(width * scale);
    if (waveCanvas.height !== Math.ceil(height * scale)) waveCanvas.height = Math.ceil(height * scale);
    const ctx = waveCanvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
    const visible = new Set();
    for (const clip of state.clips) {
      const view = rowViews.get(clip.track);
      if (!view) continue;
      const left = TRACK_HEAD + clip.at * zoom - scroll.scrollLeft, clipWidth = Math.max(8, clipDuration(clip) * zoom);
      const top = view.lane.getBoundingClientRect().top - rect.top - y + 25;
      const shown = left + clipWidth >= TRACK_HEAD && left < width && top + 44 >= 0 && top < height;
      if (shown || drag?.clip.id === clip.id || clipViews.get(clip.id)?.contains(document.activeElement)) {
        let item = clipViews.get(clip.id);
        if (!item) { item = clipElement(clip); clipViews.set(clip.id, item); }
        if (item.parentElement !== view.lane && drag?.clip.id !== clip.id) view.lane.append(item);
        updateClip(item, clip); visible.add(clip.id);
      }
      if (!shown) continue;
      ctx.globalAlpha = clip.mute || !trackAudible(state, trackOf(clip.track)) ? .35 : 1;
      drawWave(ctx, clip, left + 1, top, clipWidth - 2, 44);
    }
    ctx.globalAlpha = 1;
    for (const [id, item] of clipViews) if (!visible.has(id)) { item.remove(); clipViews.delete(id); }
  }
  function userHead(track, index) {
    const head = node('div', 'pl-track-head');
    const trackId = track.id;
    const name = node('input', 'pl-track-name'); name.value = track.name; name.maxLength = 160; name.setAttribute('aria-label', `${t('Track name', 'Nombre de pista')} ${index + 1}`);
    name.onchange = () => commit(() => { trackOf(trackId).name = name.value.trim() || `Track ${index + 1}`; });
    const controls = node('div', 'pl-track-controls');
    for (const [key, label] of [['mute', 'M'], ['solo', 'S']]) {
      const b = button(label, `${key === 'mute' ? 'Mute' : 'Solo'} ${track.name}`, () => commit(() => { trackOf(trackId)[key] = !trackOf(trackId)[key]; }));
      b.dataset.mix = key; b.setAttribute('aria-pressed', String(track[key])); controls.append(b);
    }
    // Track volume is heard while dragging; one undo step on release.
    const volume = createKnob({ label: `${t('Volume', 'Volumen')} ${track.name}`, min: 0, max: 200, step: 1, coarse: 10, value: Math.round(track.gain * 100), reset: 100,
      hint: resetHint, format: v => `${v}%`, onInput: v => edit(() => { trackOf(trackId).gain = v / 100; }, { live: true }),
      onCommit: v => edit(() => { trackOf(trackId).gain = v / 100; }) });
    head.volume = volume; volume.wrap.classList.add('is-inline'); controls.append(volume.wrap); head.append(name, controls);
    return head;
  }
  function draw() {
    TRACK_HEAD = parseFloat(getComputedStyle(container).getPropertyValue('--pl-head')) || 236;
    tempo.input.value = state.bpm; undo.disabled = !history.length; redo.disabled = !future.length;
    const extent = Math.min(LIMITS.seconds, Math.max(16, arrangementEnd(state) + 8)), width = Math.max(640, extent * zoom);
    grid.style.width = (width + TRACK_HEAD) + 'px'; grid.style.setProperty('--beat', (60 / state.bpm * zoom) + 'px');
    ruler.style.width = width + 'px'; ruler.replaceChildren();
    const barSeconds = 240 / state.bpm, barStep = Math.max(1, Math.ceil(55 / (barSeconds * zoom)));
    for (let bar = 0; bar * barSeconds * zoom < width; bar += barStep) { const mark = node('span', '', String(bar + 1)); mark.style.left = (bar * barSeconds * zoom) + 'px'; ruler.append(mark); }
    const band = node('div', 'pl-loop-band'); ruler.append(band); renderLoopBand(band);
    const rows = [rulerRow];
    state.tracks.forEach((track, index) => {
      const host = track.stem ? channel?.(track) : null;
      let view = rowViews.get(track.id);
      if (!view || view.host !== host) {
        if (view) { view.row.remove(); view.drawer?.remove(); }
        const row = node('div', 'pl-grid-row'), lane = node('div', 'pl-lane');
        const head = host?.head || userHead(track, index);
        head.classList.add('pl-track-head'); lane.dataset.track = track.id; row.append(head, lane);
        lane.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
        lane.ondrop = safe(async event => {
          event.preventDefault(); const at = snapAt((event.clientX - lane.getBoundingClientRect().left) / zoom, event.altKey);
          if (event.dataTransfer.files.length) { await importFiles([...event.dataTransfer.files], track.id, at); return; }
          const asset = assets.get(event.dataTransfer.getData('application/x-stem-sample'));
          if (asset) commit(() => { const clip = newClip(asset, track.id, at); selected = clip.id; state.clips.push(clip); });
        });
        view = { row, lane, head, host }; rowViews.set(track.id, view);
        if (host?.waveform) lane.append(host.waveform);
        if (host?.drawer) { view.drawer = node('div', 'pl-drawer-row'); host.drawer.classList.add('pl-drawer'); view.drawer.append(host.drawer); }
      }
      view.head.style.setProperty('--track-color', color(track));
      view.row.classList.toggle('is-silent', !trackAudible(state, track)); view.lane.style.width = width + 'px';
      if (!host) {
        view.head.querySelector('.pl-track-name').value = track.name;
        for (const key of ['mute', 'solo']) view.head.querySelector('[data-mix=' + key + ']').setAttribute('aria-pressed', String(track[key]));
        view.head.volume.show(Math.round(track.gain * 100));
      }
      rows.push(view.row); if (view.drawer) rows.push(view.drawer);
      if (host?.waveform) {
        const clip = sourceClip(track.stem), wave = host.waveform;
        wave.hidden = !clip;
        if (clip) { wave.style.left = (clip.at * zoom) + 'px'; wave.style.width = (clipDuration(clip) * zoom) + 'px'; }
      }
    });
    for (const [id, view] of rowViews) if (!state.tracks.some(t => t.id === id)) { view.row.remove(); view.drawer?.remove(); rowViews.delete(id); }
    let cursor = grid.firstElementChild;
    for (const row of rows) { if (row === cursor) cursor = cursor.nextElementSibling; else grid.insertBefore(row, cursor); }
    const nextShelf = [...assets.values()].map(a => a.id + ':' + a.name).join('|');
    if (nextShelf !== shelfKey) {
      shelfKey = nextShelf; shelf.replaceChildren();
      for (const asset of assets.values()) {
        const b = button(asset.name, t('Drag onto a track, or click to add at cursor', 'Arrastrá a una pista o hacé clic para agregar en el cursor'), () => commit(() => {
          const clip = newClip(asset, picked()?.track || firstUserTrack(), position); state.clips.push(clip); selected = clip.id;
        }));
        b.draggable = true; b.ondragstart = event => event.dataTransfer.setData('application/x-stem-sample', asset.id); shelf.append(b);
      }
    }
    updateSelection(); paint(); onViewChange?.();
  }
  function updateClip(item, clip) {
    const name = assets.get(clip.asset).name;
    item.setAttribute('aria-label', name + ', ' + clock(clip.at) + ', ' + clipPitch(clip) + ' ' + t('semitones', 'semitonos'));
    item.setAttribute('aria-pressed', String(clip.id === selected));
    item.style.left = (clip.at * zoom) + 'px'; item.style.width = Math.max(8, clipDuration(clip) * zoom) + 'px'; item.style.setProperty('--clip-color', color(trackOf(clip.track)));
    item.classList.toggle('is-stretching', stretching(clip)); item.classList.toggle('is-muted', !!clip.mute);
    item.querySelector('.pl-clip-title').textContent = (clip.reverse ? '↶ ' : '') + name + (clipPitch(clip) ? '  ' + signed(clipPitch(clip)) + ' st' : '') + (clip.speed !== 1 ? '  ' + clip.speed.toFixed(2) + '×' : '');
  }
  function clipElement(initial) {
    const id = initial.id;
    const item = node('div', 'pl-clip'); item.dataset.clip = id; item.tabIndex = 0; item.setAttribute('role', 'button');
    item.append(node('span', 'pl-clip-title'));
    for (const edge of ['left', 'right']) { const handle = node('span', `pl-edge pl-edge-${edge}`); handle.dataset.edge = edge; handle.title = t('Drag to trim', 'Arrastrar para recortar'); item.append(handle); }
    item.onpointerdown = event => beginDrag(event, state.clips.find(c => c.id === id), item);
    item.onkeydown = event => {
      const clip = state.clips.find(c => c.id === id), index = state.tracks.findIndex(t => t.id === clip.track);
      if (event.key === 'Enter') { selected = clip.id; updateSelection(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); selected = clip.id;
      commit(() => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') clip.at = clamp(clip.at + (event.key === 'ArrowLeft' ? -1 : 1) * 60 / state.bpm * (snap || .25), 0, LIMITS.seconds - clipDuration(clip));
        else clip.track = state.tracks[clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, state.tracks.length - 1)].id; });
      grid.querySelector(`.pl-clip[data-clip="${clip.id}"]`)?.focus();
    };
    return item;
  }
  function renderLoopBand(band = grid.querySelector('.pl-loop-band')) {
    loopA.input.value = loopRange?.start ?? 0; loopB.input.value = loopRange?.end ?? arrangementEnd(state);
    if (!band) return;
    band.hidden = !loopRange;
    if (loopRange) { band.style.left = `${loopRange.start * zoom}px`; band.style.width = `${(loopRange.end - loopRange.start) * zoom}px`; }
  }
  function updateSelection() {
    const clip = picked(); selectionLabel.textContent = clip ? assets.get(clip.asset).name : t('Select a clip', 'Seleccioná un clip');
    for (const input of [pitch.dial, fine.dial, speed.dial, gain.dial, ...fades.map(f => f.dial), muteClip, reverseClip, mode, duplicate, split, remove]) input.disabled = !clip;
    fine.show(clip?.cents ?? 0); fades[0].show(clip?.fadeIn ?? 0); fades[1].show(clip?.fadeOut ?? 0);
    muteClip.setAttribute('aria-pressed', String(!!clip?.mute)); reverseClip.setAttribute('aria-pressed', String(!!clip?.reverse));
    pitch.show(clip?.pitch ?? 0); speed.show(clip?.speed ?? 1); gain.show(Math.round((clip?.gain ?? 1) * 100)); mode.value = clip?.keepLength === false ? 'resample' : 'stretch';
    for (const item of grid.querySelectorAll('.pl-clip')) item.setAttribute('aria-pressed', String(item.dataset.clip === selected));
  }
  function beginDrag(event, clip, item) {
    if (event.button !== 0) return;
    event.preventDefault(); selected = clip.id; updateSelection(); item.focus({ preventScroll: true });
    const lanes = [...grid.querySelectorAll('.pl-lane')], home = item.parentElement.getBoundingClientRect().top;
    drag = { id: event.pointerId, x: event.clientX, scroll: scroll.scrollLeft, before: copy(), clip: { ...clip }, edge: event.target.dataset.edge, changed: false };
    item.setPointerCapture(event.pointerId);
    item.onpointermove = move => {
      if (drag?.id !== move.pointerId) return;
      const original = drag.clip, delta = (move.clientX - drag.x + scroll.scrollLeft - drag.scroll) / zoom, speedRate = clipRate(original);
      if (editMode === 'slip' && !drag.edge) {
        Object.assign(clip, slipClip(original, delta * (original.reverse ? -1 : 1), assets.get(clip.asset).buffer.duration));
      } else if (editMode === 'stretch' && drag.edge === 'right') {
        const end = snapAt(original.at + clipDuration(original) + delta, move.altKey);
        const pitchRate = original.keepLength ? 1 : 2 ** (clipPitch(original) / 12);
        clip.speed = clamp((original.out - original.in) / Math.max(.01, end - original.at) / pitchRate, .25, 4);
        if (clip.at + clipDuration(clip) > LIMITS.seconds) clip.speed = (clip.out - clip.in) / (LIMITS.seconds - clip.at) / pitchRate;
      } else if (drag.edge === 'right') {
        const end = snapAt(original.at + clipDuration(original) + delta, move.altKey);
        if (original.reverse) clip.in = clamp(original.out - (end - original.at) * speedRate, Math.max(0, original.out - (LIMITS.seconds - clip.at) * speedRate), original.out - .01 * speedRate);
        else clip.out = clamp(original.in + (end - original.at) * speedRate, original.in + .01 * speedRate, Math.min(assets.get(clip.asset).buffer.duration, original.in + (LIMITS.seconds - clip.at) * speedRate));
      } else if (drag.edge === 'left') {
        const room = original.reverse ? assets.get(clip.asset).buffer.duration - original.out : original.in;
        const next = clamp(snapAt(original.at + delta, move.altKey), Math.max(0, original.at - room / speedRate), original.at + clipDuration(original) - .01);
        clip.at = next;
        if (original.reverse) clip.out = original.out - (next - original.at) * speedRate;
        else clip.in = original.in + (next - original.at) * speedRate;
      } else {
        clip.at = clamp(snapAt(original.at + delta, move.altKey), 0, LIMITS.seconds - clipDuration(clip));
        const lane = lanes.find(e => { const box = e.getBoundingClientRect(); return move.clientY >= box.top && move.clientY < box.bottom; });
        if (lane) { clip.track = lane.dataset.track; item.style.transform = `translateY(${lane.getBoundingClientRect().top - home}px)`; }
      }
      drag.changed = true; item.style.left = `${clip.at * zoom}px`; item.style.width = `${Math.max(8, clipDuration(clip) * zoom)}px`;
      engine?.update(state, transport()); paintSoon();
    };
    const finish = cancel => {
      if (!drag) return;
      const gesture = drag; drag = null;
      item.onpointermove = item.onpointerup = item.onpointercancel = item.onlostpointercapture = null;
      if (item.hasPointerCapture(gesture.id)) item.releasePointerCapture(gesture.id);
      item.style.transform = '';
      if (cancel) { state = gesture.before; changed(); }
      else if (gesture.changed) { history.push(gesture.before); if (history.length > 50) history.shift(); future = []; changed(); }
      draw(); grid.querySelector(`.pl-clip[data-clip="${selected}"]`)?.focus({ preventScroll: true });
    };
    item.onpointerup = () => finish(false); item.onpointercancel = item.onlostpointercapture = () => finish(true);
  }
  // Track edits from the host and the track headers. Live edits are heard at once
  // and become one undo step with the next final edit.
  function edit(action, { live = false } = {}) {
    if (live) { liveBefore ||= copy(); action(state); engine?.update(state, transport()); return true; }
    const before = liveBefore || copy(); liveBefore = null;
    return commit(() => action(state), before);
  }
  async function connect() {
    const io = audio ? await audio() : await (async () => {
      ownContext ||= new AudioContext({ sampleRate: 44100 }); await ownContext.resume();
      return { context: ownContext, output: ownContext.destination };
    })();
    if (engine && engineIO?.context === io.context && engineIO.output === io.output) return;
    engine?.dispose(); engineIO = io;
    engine = createPlaylistEngine({ context: io.context, output: io.output, cache, assets: () => assets, onEnded: () => stop(true), onError: report });
  }
  async function toggle() {
    if (playing()) { stop(); return; }
    if (!arrangementEnd(state)) { report(t('Add a sample to the playlist first.', 'Primero agregá un sample a la playlist.')); return; }
    await connect();
    if (engine.play(state, position, transport())) { renderPlay(true); onTransport?.(true); }
  }
  function seek(seconds) {
    position = clamp(seconds, 0, Math.max(arrangementEnd(state), loopRange?.end ?? 0));
    if (playing()) engine.play(state, position, transport());
  }
  async function exportMix() {
    if (exporting) return;
    exporting = new AbortController(); exportButton.disabled = true;
    try {
      const rendered = await renderArrangement(copy(), new Map(assets), cache, { signal: exporting.signal,
        progress: p => report(`${t('Rendering', 'Renderizando')} ${Math.round(p * 100)}%`) });
      const blob = new Blob([encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], rendered.sampleRate)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'playlist.wav'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(t('WAV exported. Peaks above 0 dB were normalized.', 'WAV exportado. Los picos sobre 0 dB se normalizaron.'));
    } finally { exporting = null; exportButton.disabled = false; }
  }
  // Replace the host's channels (original and stems); user tracks with clips stay.
  // `saved` restores channel mix and clips from a preset; invalid data falls back.
  function setSession({ sources, saved = null, monitor = 'mix' }) {
    stop(true);
    for (const old of assets.values()) if (old.session) cache.forget(old.id);
    const next = new Map([...assets].filter(([, asset]) => !asset.session));
    for (const source of sources) next.set(source.id, { id: source.id, name: source.name, buffer: source.buffer, version: 0, session: true });
    const userClips = state.clips.filter(clip => next.get(clip.asset) && !next.get(clip.asset).session && !trackOf(clip.track)?.stem);
    const userTracks = state.tracks.filter(track => !track.stem && userClips.some(clip => clip.track === track.id));
    userTracks.push(state.tracks.find(track => !track.stem && !userTracks.includes(track)) ||
      { id: uid(), name: `${t('Track', 'Pista')} ${userTracks.length + 1}`, gain: 1, mute: false, solo: false });
    const build = restore => {
      const tracks = sources.map(source => {
        const old = restore && saved?.tracks?.find(item => item?.stem === source.stem);
        return { id: `track-${source.stem}`, name: source.name, stem: source.stem, gain: Number.isFinite(old?.gain) ? clamp(old.gain, 0, 2) : 1,
          mute: old?.mute === true, solo: false };
      });
      const clips = restore && Array.isArray(saved?.clips) ? saved.clips.map(clip => ({ ...clip })) :
        sources.map(source => newClip(next.get(source.id), `track-${source.stem}`, 0));
      return { version: 1, bpm: restore && Number.isFinite(saved?.bpm) ? saved.bpm : state.bpm, monitor, tracks: [...tracks, ...userTracks], clips: [...clips, ...userClips] };
    };
    let candidate = build(!!saved);
    try { validateArrangement(candidate, next); } catch { candidate = build(false); validateArrangement(candidate, next); }
    state = candidate; assets = next; history = []; future = []; selected = null; liveBefore = null; position = loopRange?.start ?? 0;
    changed(); draw(); requestAnimationFrame(fit);
  }
  function sourceClip(stem) {
    const matches = clip => clip.track === `track-${stem}` && clip.asset === `audio-${stem}`;
    return (picked() && matches(picked()) ? picked() : state.clips.find(matches)) || null;
  }
  container.addEventListener('keydown', event => {
    if (event.target.closest('input,select,textarea,.pl-drawer') || event.target.isContentEditable) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) safe(toggle)(); }
    else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey); }
    else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); if (picked()) duplicate.click(); }
    else if (!modifier && event.key.toLowerCase() === 's') { event.preventDefault(); if (picked()) split.click(); }
    else if (['Delete', 'Backspace'].includes(event.key) && picked()) { event.preventDefault(); remove.click(); }
  });
  function animate() {
    const at = now(); time.textContent = clock(at);
    const head = grid.querySelector('.pl-playhead'); if (head) head.style.left = `${TRACK_HEAD + at * zoom}px`;
    frame = requestAnimationFrame(animate);
  }
  draw(); animate();
  return {
    toggle: safe(toggle), pause: () => stop(), seek, now, playing, setSession, edit, draw,
    track: stem => state.tracks.find(track => track.stem === stem),
    audible: track => trackAudible(state, track),
    monitor: () => state.monitor,
    sourceWindow(stem) {
      const clip = sourceClip(stem);
      return clip ? { startMs: (clip.reverse ? clip.out : clip.in) * 1000, endMs: (clip.reverse ? clip.in : clip.out) * 1000 } : { startMs: 0, endMs: 1 };
    },
    focusSource(stem, startMs, endMs) {
      const clip = sourceClip(stem); if (!clip) return;
      const from = clip.at + ((clip.reverse ? clip.out - endMs / 1000 : startMs / 1000 - clip.in) / clipRate(clip));
      const span = Math.max(.1, (endMs - startMs) / 1000 / clipRate(clip));
      zoom = clamp((scroll.clientWidth - TRACK_HEAD) / (span * 1.6), MIN_ZOOM, MAX_ZOOM);
      draw(); scroll.scrollLeft = Math.max(0, (from - span * .3) * zoom); paintSoon();
    },
    sourceSeek(stem, seconds) {
      const clip = sourceClip(stem);
      if (clip) seek(clip.at + (clip.reverse ? clip.out - seconds : seconds - clip.in) / clipRate(clip));
    },
    setMonitor(value) { state.monitor = value; engine?.update(state, transport()); draw(); onChange?.(); },
    // The host's A–B loop in timeline seconds; null loops the whole arrangement.
    setLoopRange(range) {
      loopRange = range && range.end > range.start ? { start: range.start, end: range.end } : null;
      if (!playing() && loopRange && (position < loopRange.start || position >= loopRange.end)) position = loopRange.start;
      engine?.update(state, transport()); renderLoopBand();
    },
    // Global speed. Restarts are coalesced while a slider is dragged.
    setRate(value) {
      rate = value; clearTimeout(rateTimer);
      rateTimer = setTimeout(() => engine?.update(state, transport()), 40);
    },
    // A channel's audio replaced by a rendered pattern or melody lane of the same length.
    setAssetBuffer(id, buffer) {
      const asset = assets.get(id);
      if (!asset || asset.buffer === buffer) return;
      cache.forget(id); asset.buffer = buffer; asset.version++;
      engine?.update(state, transport()); prefetchStretches(state, assets, cache, report); draw();
    },
    // Channel mix is saved by the host; the arrangement saves tempo and clips.
    snapshot: () => ({ bpm: state.bpm,
      clips: state.clips.filter(clip => trackOf(clip.track)?.stem && assets.get(clip.asset)?.session).map(clip => ({ ...clip })) }),
    dispose() {
      exporting?.abort(); engine?.dispose(); cache.dispose(); viewObserver.disconnect();
      cancelAnimationFrame(frame); cancelAnimationFrame(zoomFrame); cancelAnimationFrame(paintFrame); window.removeEventListener('scroll', paintSoon); clearTimeout(rateTimer); ownContext?.close();
    },
  };
}
