import { LIMITS, uid, clamp, emptyArrangement, newClip, clipDuration, clipRate, clipPitch, clipEnvelope, slipClip, crossfadeClips, arrangementEnd, splitClip, clipsInRange, validateArrangement, needsStretch, trackAudible, loopSegments, retimePatternClips } from './stem-playlist-core.mjs';
import { createPlaylistEngine, createStretchCache, prefetchStretches, renderArrangement } from './stem-playlist-audio.mjs';
import { encodeWav } from './stem-audio.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';
import { mountSampleBrowser } from './stem-sample-browser.mjs';
import { createButton } from './ui-button.mjs';
import { createMetronome } from './stem-metronome.mjs';
import { createKnob } from './ui-knob.mjs';
import { toast, dismissToast } from './ui-toast.mjs';

const MIN_ZOOM = 8, MAX_ZOOM = 600;
// The workspace header's stem palette; user tracks continue in warm tints.
export const CHANNEL_COLORS = Object.freeze({ original: '#c8c2ba', drums: '#ff8a4c', bass: '#ffb98f', other: '#8c8c8c', vocals: '#ff5500' });
const EXTRA_COLORS = ['#ffd2b3', '#c56a3a', '#e9a27a', '#a39a90', '#ff7a2f', '#d9cfc4'];
// Semantic names from the shared icon catalog.
const ICONS = Object.freeze({"pencil": "draw", "select": "select", "undo": "undo", "redo": "redo", "export": "export", "tapTempo": "tap-tempo", "metronome": "metronome", "separate": "layers", "browser": "browser", "addTrack": "add-track", "zoomOut": "zoom-out", "zoomIn": "zoom-in", "fit": "fit", "mute": "mute", "reverse": "reverse", "crossfade": "crossfade", "duplicate": "copy", "slice": "slice", "split": "cut", "trash": "trash", "check": "check", "keepLength": "keep-length", "resample": "resample", "moveTool": "move", "slipTool": "slip", "stretchTool": "stretch", "import": "upload"});

// Small context menu at the pointer. Items: { label, icon, shortcut, danger, checked,
// disabled, title, action }, '-' for a separator, { heading }, or { choices: [{ label, icon,
// title, checked, action }] } for a row of icon radio buttons. Arrows move, Escape closes.
let openMenu = null;
export function contextMenu(event, items) {
  event.preventDefault(); event.stopPropagation();
  openMenu?.close();
  const back = document.activeElement, menu = document.createElement('div');
  menu.className = 'pl-menu'; menu.setAttribute('role', 'menu');
  // Menu entries use the same semantic icon names as every other control.
  const iconMarkup = name => globalThis.SCIcons.html(name, "icon");
  for (const item of items) {
    if (item === '-') { const line = document.createElement('div'); line.className = 'pl-menu-sep'; line.setAttribute('role', 'separator'); menu.append(line); continue; }
    if (item.heading) { const head = document.createElement('div'); head.className = 'pl-menu-heading'; head.textContent = item.heading; menu.append(head); continue; }
    if (item.choices) {
      const row = document.createElement('div'); row.className = 'pl-menu-choices'; row.setAttribute('role', 'group');
      for (const choice of item.choices) {
        const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'pl-menu-item pl-menu-choice';
        chip.setAttribute('role', 'menuitemradio'); chip.setAttribute('aria-checked', String(!!choice.checked)); chip.setAttribute('aria-label', choice.label);
        chip.title = choice.title ? `${choice.label} — ${choice.title}` : choice.label;
        chip.innerHTML = `${iconMarkup(choice.icon)}${choice.checked ? `<span class="pl-menu-choice-check">${iconMarkup(ICONS.check)}</span>` : ''}`;
        chip.onclick = () => { close(); choice.action?.(); };
        row.append(chip);
      }
      menu.append(row); continue;
    }
    const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'pl-menu-item';
    const checkable = item.checked !== undefined;
    entry.setAttribute('role', checkable ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem');
    if (checkable) entry.setAttribute('aria-checked', String(!!item.checked));
    entry.classList.toggle('is-danger', !!item.danger); entry.disabled = !!item.disabled;
    if (item.title) entry.title = item.title;
    const icon = checkable && !item.icon ? (item.checked ? ICONS.check : '') : item.icon;
    entry.innerHTML = `<span class="pl-menu-icon">${icon ? iconMarkup(icon) : ''}</span><span class="pl-menu-label"></span>${item.shortcut ? '<kbd></kbd>' : ''}`;
    entry.querySelector('.pl-menu-label').textContent = item.label;
    if (item.shortcut) entry.querySelector('kbd').textContent = item.shortcut;
    entry.onclick = () => { close(); item.action?.(); };
    menu.append(entry);
  }
  document.body.append(menu);
  const target = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
  const keyboard = !event.clientX && !event.clientY && target;
  const x = keyboard ? target.left + 8 : event.clientX, y = keyboard ? target.bottom - 4 : event.clientY;
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - box.width - 4))}px`;
  menu.style.top = `${Math.max(4, y + box.height > innerHeight - 4 ? y - box.height : y)}px`;
  const entries = () => [...menu.querySelectorAll('.pl-menu-item:not(:disabled)')];
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const onKey = e => {
    const list = entries(), index = list.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); back?.focus?.({ preventScroll: true }); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(index + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); (e.key === 'Home' ? list[0] : list.at(-1))?.focus(); }
    e.stopPropagation();
  };
  function close() {
    if (openMenu?.menu !== menu) return;
    openMenu = null; menu.remove();
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', close, true);
    window.removeEventListener('blur', close); window.removeEventListener('resize', close);
  }
  menu.addEventListener('keydown', onKey);
  menu.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerdown', outside, true); document.addEventListener('wheel', close, true);
  window.addEventListener('blur', close); window.addEventListener('resize', close);
  openMenu = { menu, close };
  entries()[0]?.focus({ preventScroll: true });
  return openMenu;
}

// The arrangement and the only transport of the Stem Extractor. The host page adds
// its channels (original and stems) with setSession and supplies persistent header
// elements for them through `channel(track, source)`. Patterns arrive as looping
// assets through setPatterns; their clips repeat when stretched past one pass.
// A host with its own play button passes `playButton: false`; `toolbarHost` mounts the
// transport bar elsewhere: `toolbarStart` opens it, `tempoControls` follow the tempo controls and
// `toolbarEnd` sits before the download button;
// `inspectorControls` share the library row. Pattern library entries are owned by
// the host: their Duplicate/Delete go through `onPatternAction(action, assetId)`.
// `onSeparate(clip)` adds "Extract stems…" to the menu of every audio clip; the host
// separates it and hands the result back with `addStemTracks`.
export function mountPlaylist({ container, windows = [], toolbarHost = container, toolbarStart = [], toolbarEnd = [], tempoControls = [], inspectorControls = [], playButton = true, onPatternAction, audio, masterEq, masterFx, channel, onChange, onTransport, onViewChange, onLoopChange, onSelect, onRackSample, onSeparate }) {
  const es = document.documentElement.lang === 'es', t = (en, spanish) => es ? spanish : en;
  let state = emptyArrangement(), assets = new Map(), selected = null, extra = new Set(), zoom = 48;
  let history = [], future = [], position = 0, ownContext, engine = null, engineIO = null, exporting = null;
  let drag = null, frame, operating = false, liveBefore = null, loopRange = null, marker = 0, rate = 1, rateTimer = 0;
  const isPattern = clip => !!assets.get(clip.asset)?.loop;
  // What the engine and the export hear: one plain clip per pass of a looping clip.
  const playbackState = () => ({ ...state, clips: state.clips.flatMap(clip => {
    const asset = assets.get(clip.asset);
    return asset?.loop ? loopSegments(clip, asset.buffer.duration) : [clip];
  }) });
  // Every loaded sample is available to the rack, even without a playlist clip.
  const importedSamples = () => [...assets.values()].filter(asset => !asset.session && !asset.pattern);
  const rowViews = new Map(), clipViews = new Map(), analyzing = new WeakSet();
  let paintFrame = 0, dragAudio = 0, shelfKey = '', editMode = 'move', reported = null, slicing = false, slice = null;
  // Channel header width comes from CSS (--pl-head), narrower on phones.
  let TRACK_HEAD = 165;
  let drawSource = null, timeSelection = null, clipboard = null, activeTrack = null, selecting = false;
  const node = (tag, className = '', text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };
  const button = (text, title, action) => { const e = node('button', '', text); e.type = 'button'; e.title = title; e.setAttribute('aria-label', title); e.onclick = action; return e; };
  // Messages are toasts (ui-toast.mjs): errors in red, notices in yellow, results in green.
  // A loading message (reading samples, rendering) stays until the next one replaces it.
  const report = (value, variant = value instanceof Error ? 'error' : 'warning') => {
    const title = value instanceof Error ? value.message : value;
    if (variant !== 'loading') dismissToast('playlist-task');
    if (title) toast({ title, variant, id: variant === 'loading' ? 'playlist-task' : '' });
  };
  const safe = fn => async (...args) => { try { await fn(...args); } catch (error) { if (error.name !== 'AbortError') report(error); } };
  const picked = () => state.clips.find(c => c.id === selected);
  // `selected` is the clip the inspector shows; Ctrl/Shift+click or a box drag adds `extra` clips.
  const isChosen = id => id === selected || extra.has(id);
  const chosen = () => state.clips.filter(c => isChosen(c.id));
  const pick = id => {
    selected = id; extra.clear(); timeSelection = null;
    const clip = picked();
    if (clip) { drawSource = { ...clip }; activeTrack = clip.track; }
  };
  const copy = () => structuredClone({ ...state, sampleIds: importedSamples().map(asset => asset.id) });
  const trackOf = id => state.tracks.find(track => track.id === id);
  const color = track => CHANNEL_COLORS[track?.stem] || track?.color || EXTRA_COLORS[Math.max(0, state.tracks.filter(item => !item.stem).indexOf(track)) % EXTRA_COLORS.length];
  const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  const now = () => engine?.now() ?? position;
  const playing = () => !!engine?.playing();
  const transport = () => ({ rate, loop: loopRange || (arrangementEnd(state) ? { start: 0, end: arrangementEnd(state) } : null) });
  // Stretched clips render in a worker; their clips show a striped overlay until ready
  // and a spinner in the library row says work is running, without moving the layout.
  const stretchStatus = t('Stretching clips…', 'Estirando clips…');
  const busy = node('span', 'pl-busy'); busy.hidden = true;
  busy.setAttribute('role', 'status'); busy.setAttribute('aria-label', stretchStatus); busy.title = stretchStatus;
  const stretching = clip => needsStretch(clip) && !cache.has(clip, assets.get(clip.asset));
  const cache = createStretchCache({ onChange() {
    for (const item of grid.querySelectorAll('.pl-clip')) {
      const clip = state.clips.find(c => c.id === item.dataset.clip);
      item.classList.toggle('is-stretching', !!clip && stretching(clip));
    }
    busy.hidden = !cache.busy();
  } });
  function renderPlay(active) { if (!play) return; play.replaceChildren(globalThis.SCIcons.create(active ? 'pause' : 'play')); play.setAttribute('aria-pressed', String(active)); }
  function stop(reset = false) {
    const was = playing(), at = engine?.stop(); metronome.stop();
    position = reset ? marker : at ?? position;
    renderPlay(false); if (was) onTransport?.(false);
  }
  // Edits apply to the running schedule and warm the stretch cache; playback never stops.
  function changed() {
    engine?.update(playbackState(), transport());
    prefetchStretches(playbackState(), assets, cache, report);
    onChange?.();
  }
  // A user track keeps the sample its instrument is cut from (`source`): the first sample
  // placed on it. Removing or moving clips never changes it; only deleting the sample from
  // the project, or "Use as track instrument", does.
  function assignSources() {
    for (const track of state.tracks) {
      if (track.stem || (track.source && assets.has(track.source))) continue;
      const clip = state.clips.find(item => item.track === track.id && !isPattern(item) && assets.has(item.asset));
      if (clip) track.source = clip.asset; else delete track.source;
    }
  }
  // Samples deleted from the project stay here while the undo history still needs them.
  const graveyard = new Map();
  function pruneGraveyard() {
    if (!graveyard.size) return;
    const used = new Set();
    for (const snapshot of [...history, ...future]) {
      for (const id of snapshot.sampleIds || []) used.add(id);
      for (const clip of snapshot.clips) used.add(clip.asset);
      for (const track of snapshot.tracks) if (track.source) used.add(track.source);
    }
    for (const id of graveyard.keys()) if (!used.has(id)) graveyard.delete(id);
  }
  function commit(action, before = copy()) {
    try { action(); assignSources(); validateArrangement(state, assets); }
    catch (error) { state = before; report(error); draw(); return false; }
    history.push(before); if (history.length > 50) history.shift(); future = []; pruneGraveyard();
    changed(); draw(); return true;
  }
  const toolbar = node('div', 'pl-toolbar pl-ui');
  // Every toolbar control is the shared button (ui-button.mjs): orange window and export
  // buttons, grey tempo tools, and the 32 × 30 cells of the tool grid.
  const iconButton = (icon, title, action, { variant = 'neutral', size = 'icon' } = {}) => createButton({ icon, title, variant, size, onClick: action });
  // Tool buttons carry a hotkey and a color: a click or the hotkey flashes the button in its
  // color, like FL Studio. The flash animates a pseudo-element's opacity only (compositor-only).
  // `keys` are normalized combos ('m', 'ctrl+d', 'ctrl+shift+z', 'delete'); `repeat` allows key repeat.
  const hotkeys = new Map();
  function flash(control) {
    try { control.animate([{ opacity: .85 }, { opacity: 0 }], { duration: 300, easing: 'ease-out', pseudoElement: '::after' }); } catch { /* no pseudo-element animations */ }
  }
  function toolButton({ icon, name, detail = '', key, keys, color, repeat = false, variant = 'neutral', size = 'tool' }, action) {
    const control = iconButton(icon, name, () => { flash(control); action(); }, { variant, size });
    control.title = `${name} (${key})${detail ? ': ' + detail : ''}`;
    control.setAttribute('aria-keyshortcuts', key.replace('Ctrl', 'Control').replace('Del', 'Delete').replace('Supr', 'Delete'));
    control.classList.add('pl-key'); control.style.setProperty('--key-color', color);
    for (const combo of keys) hotkeys.set(combo, { control, repeat });
    return control;
  }
  const play = playButton ? button('', t('Play / pause (Space)', 'Reproducir / pausar (Espacio)'), safe(toggle)) : null;
  if (play) { play.append(globalThis.SCIcons.create('play')); play.className = 'pl-play'; play.setAttribute('aria-pressed', 'false'); }
  const time = node('output', 'pl-time', '0:00.00'); time.title = t('Playhead position (minutes:seconds)', 'Posición del cursor (minutos:segundos)');
  function field(text, type, value, min, max, step) {
    const label = node('label', 'pl-field', text), input = node('input'); input.type = type; input.value = String(value);
    input.setAttribute('aria-label', text); if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step;
    label.append(input); return { label, input };
  }
  const tempo = field('BPM', 'number', 120, 20, 300, .01); tempo.label.title = tempo.input.title = t('Project tempo (20–300 BPM): grid, channel rack and piano roll. It does not change the audio speed; the speed slider next to it does.', 'Tempo del proyecto (20–300 BPM): grilla, channel rack y piano roll. No cambia la velocidad del audio; para eso está el slider de velocidad al lado.');
  function changeLoop(range) {
    loopRange = range; if (range) marker = range.start;
    engine?.update(playbackState(), transport()); renderLoopBand();
    onLoopChange?.(range);
  }
  tempo.input.onchange = () => { const bpm = Number(tempo.input.value); if (bpm >= 20 && bpm <= 300) commit(() => retimePatternClips(state, bpm, isPattern)); else draw(); };
  // Tap tempo like FL Studio's tapper: BPM is the average of every interval since the first tap;
  // a pause longer than two beats (3 s minimum) starts over. One tap session is one undo step.
  let taps = [], tapTimer = 0, tapUndo = null;
  const tapButton = iconButton(ICONS.tapTempo, t('Tap tempo (T): tap along with the beat and the BPM follows the average; pause to start over', 'Tap tempo (T): tocá al ritmo y el BPM sigue el promedio; una pausa reinicia'), () => {});
  tapButton.classList.add('pl-tap');
  const tapInterval = () => taps.length > 1 ? (taps.at(-1) - taps[0]) / (taps.length - 1) : 0;
  const tapWait = () => Math.max(3000, tapInterval() * 2);
  function tapTempo() {
    const at = performance.now();
    if (!taps.length || at - taps.at(-1) > tapWait()) { taps = []; tapUndo = null; }
    taps.push(at); if (taps.length > 16) taps.shift();
    const wait = tapWait();
    tapButton.style.setProperty('--tap-wait', wait + 'ms');
    tapButton.classList.remove('is-waiting'); void tapButton.offsetWidth; tapButton.classList.add('is-waiting');
    clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = []; tapUndo = null; tapButton.classList.remove('is-waiting'); }, wait);
    if (taps.length < 2) return;
    const bpm = clamp(Math.round(60000 / tapInterval()), 20, 300);
    if (bpm === state.bpm) return;
    if (tapUndo && history.at(-1) === tapUndo) { retimePatternClips(state, bpm, isPattern); changed(); draw(); }
    else if (commit(() => retimePatternClips(state, bpm, isPattern))) tapUndo = history.at(-1);
  }
  tapButton.onpointerdown = event => { if (event.button === 0) { event.preventDefault(); tapTempo(); } };
  tapButton.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) tapTempo(); } };
  // The A–B loop is 1, 2, 4 or 8 bars; the tempo closest to 120 BPM wins.
  const fitTempo = createButton({ label: 'A–B', variant: 'neutral', title: t('Tempo from loop: drag a loop on the ruler first; the BPM is set so it lasts 1, 2, 4 or 8 bars', 'Tempo desde el loop: primero arrastrá un loop en la regla; el BPM se ajusta para que dure 1, 2, 4 u 8 compases'), onClick: () => {
    if (!loopRange) { report(t('Select a loop on the ruler first.', 'Primero seleccioná un loop en la regla.')); return; }
    const seconds = loopRange.end - loopRange.start;
    const bpm = [1, 2, 4, 8].map(bars => bars * 240 / seconds).filter(value => value >= 20 && value <= 300)
      .sort((a, b) => Math.abs(a - 120) - Math.abs(b - 120))[0];
    if (!bpm) { report(t('The loop is outside the 20–300 BPM range.', 'El loop queda fuera del rango 20–300 BPM.')); return; }
    commit(() => retimePatternClips(state, Math.round(bpm * 100) / 100, isPattern));
  } });
  fitTempo.classList.add('pl-fit-tempo');
  // Metronome, like FL Studio's (Ctrl+M): a click on every beat while the playlist plays,
  // higher on the first beat of each bar. It is not part of the mix or the WAV export.
  const metronome = createMetronome();
  const metronomeButton = toolButton({ icon: ICONS.metronome, name: t('Metronome', 'Metrónomo'), key: 'Ctrl+M', keys: ['ctrl+m'], color: '#ffd166', variant: 'neutral', size: 'icon',
    detail: t('a click on every beat while the playlist plays, accented on each bar; it is not recorded or exported', 'un clic en cada tiempo mientras suena la playlist, acentuado en cada compás; no se graba ni se exporta') }, () => {
    metronome.setEnabled(!metronome.enabled());
    metronomeButton.setAttribute('aria-pressed', String(metronome.enabled()));
    if (playing()) startMetronome();
  });
  metronomeButton.setAttribute('aria-pressed', 'false');
  function startMetronome() {
    if (engineIO) metronome.start({ context: engineIO.context, position: () => engine?.now() ?? null, bpm: () => state.bpm, rate: () => rate, loop: () => transport().loop });
  }
  const undo = toolButton({ icon: ICONS.undo, name: t('Undo', 'Deshacer'), detail: t('the last playlist edit', 'la última edición de la playlist'), key: 'Ctrl+Z', keys: ['ctrl+z'], color: '#5aa9ff', repeat: true }, () => travel(false));
  const redo = toolButton({ icon: ICONS.redo, name: t('Redo', 'Rehacer'), key: 'Ctrl+Y', keys: ['ctrl+y', 'ctrl+shift+z'], color: '#5aa9ff', repeat: true }, () => travel(true));
  const fileInput = node('input'); fileInput.type = 'file'; fileInput.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.ogg'; fileInput.multiple = true; fileInput.hidden = true;
  fileInput.onchange = safe(async () => { const files = [...fileInput.files]; fileInput.value = ''; await importSamples(files); });
  const importButton = toolButton({ icon: ICONS.import, name: t('Import audio files', 'Importar archivos de audio'), key: 'I', keys: ['i'], color: '#ff7a2f',
    detail: t('WAV, MP3, FLAC, M4A or OGG land at the playhead on the first free track. You can also drop them on a track.', 'WAV, MP3, FLAC, M4A u OGG se agregan en el cursor, en la primera pista libre. También podés soltarlos sobre una pista.') }, () => fileInput.click());
  // Floating sample browser (F8, or B on the Playlist): created on first use; its drops go
  // through importSamples. It leads the orange window buttons of the transport bar; the host
  // adds the others with `windows`.
  let sampleBrowser = null;
  const windowKeys = new Map(), windowButtons = new Map();
  function windowButton({ id, icon, name, detail, key, keys, color, toggle }) {
    const control = toolButton({ icon, name, detail, key, keys, color, variant: 'accent', size: 'icon' }, () => toggle(control));
    control.classList.add('pl-window-tool'); control.setAttribute('aria-pressed', 'false');
    for (const combo of keys) if (/^f\d+$/.test(combo)) windowKeys.set(combo, control);
    windowButtons.set(id, control);
    return control;
  }
  const browserButton = windowButton({ id: 'browser', icon: ICONS.browser, name: t('Sample browser', 'Browser de samples'), key: 'F8', keys: ['f8', 'b'], color: '#3dd6c6',
    detail: t('a floating window for a samples folder: click a file to preview it, drag it onto a track · B also opens it from the Playlist', 'una ventana flotante para una carpeta de samples: hacé clic en un archivo para escucharlo y arrastralo a una pista · B también lo abre desde la Playlist'),
    toggle(control) {
      sampleBrowser ||= mountSampleBrowser({ t, onToggle: open => control.setAttribute('aria-pressed', String(open)),
        importToRack: items => importSamples(items, null),
        async importSamples(items) { try { return await importSamples(items); } catch (error) { report(error); return false; } } });
      sampleBrowser.toggle(control);
    } });
  const windowTools = [browserButton, ...windows.map(windowButton)];
  const windowGroup = node('span', 'pl-windows'); windowGroup.setAttribute('role', 'group'); windowGroup.setAttribute('aria-label', t('Windows', 'Ventanas')); windowGroup.append(...windowTools);
  // Window keys work anywhere on the page, like FL Studio's F6–F9.
  const onWindowKey = event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const control = windowKeys.get(event.key.toLowerCase());
    if (!control || control.disabled) return;
    event.preventDefault(); if (!event.repeat) control.click();
  };
  document.addEventListener('keydown', onWindowKey);
  const addTrack = toolButton({ icon: ICONS.addTrack, name: t('Add track', 'Agregar pista'), key: 'N', keys: ['n'], color: '#ffd166',
    detail: t('an empty lane for samples and patterns (up to 16 tracks)', 'un carril vacío para samples y patrones (hasta 16 pistas)') },
  () => commit(() => state.tracks.push({ id: uid(), name: `${t('Track', 'Pista')} ${state.tracks.filter(item => !item.stem).length + 1}`, gain: 1, mute: false, solo: false })));
  const exportButton = iconButton(ICONS.export, t('Export WAV', 'Exportar WAV'), safe(exportMix), { variant: 'accent' });
  exportButton.classList.add('pl-export');
  exportButton.title = t('Export WAV: renders the whole playlist (or the A–B loop) with mute, solo, volume, FXs and EQ into a stereo WAV file', 'Exportar WAV: renderiza toda la playlist (o el loop A–B) con mute, solo, volumen, FXs y EQ en un WAV estéreo');
  // Slice tool, like FL Studio's: a click cuts the clip under the mouse; dragging up or down
  // cuts every lane the line crosses.
  const sliceButton = toolButton({ icon: ICONS.slice, name: t('Slice tool', 'Herramienta de corte'), key: 'C', keys: ['c'], color: '#ff5d8f',
    detail: t('click a clip to cut it at the mouse; drag up or down to cut several tracks at once · Esc exits', 'hacé clic en un clip para cortarlo donde está el mouse; arrastrá hacia arriba o abajo para cortar varias pistas a la vez · Esc sale') }, () => setSlicing(!slicing));
  sliceButton.setAttribute('aria-pressed', 'false');
  const pencilButton = toolButton({ icon: ICONS.pencil, name: t('Draw tool', 'Lápiz'), key: 'P', keys: ['p'], color: '#ffad80',
    detail: t('select a sample or clip, then click empty grid space to place it; drag to select a time range', 'seleccioná un sample o clip y hacé clic en la grilla vacía para colocarlo; arrastrá para seleccionar un rango') }, () => setTool('draw'));
  const selectButton = toolButton({ icon: ICONS.select, name: t('Time selection tool', 'Seleccionar rango'), key: 'Q', keys: ['q'], color: '#ffd166',
    detail: t('drag across tracks to select time, including silence; Ctrl+C/V copies/pastes, Ctrl+D repeats the whole range', 'arrastrá sobre las pistas para seleccionar tiempo, incluido el silencio; Ctrl+C/V copia/pega, Ctrl+D repite el rango completo') }, () => setTool('select'));
  function setTool(tool) {
    selecting = tool === 'select'; setSlicing(tool === 'slice');
  }
  function setSlicing(on) {
    if (on) selecting = false;
    slicing = on; slice = null; sliceLine.hidden = true;
    sliceButton.setAttribute('aria-pressed', String(on)); container.classList.toggle('is-slicing', on);
    pencilButton.setAttribute('aria-pressed', String(!on && !selecting)); selectButton.setAttribute('aria-pressed', String(selecting));
    container.classList.toggle('is-drawing', !on && !selecting); container.classList.toggle('is-selecting', selecting);
  }
  const help = iconButton('help', t('Playlist shortcuts', 'Atajos de la playlist'), () => showHint());
  toolbar.append(...toolbarStart, ...[play, time].filter(Boolean), tempo.label, tapButton, metronomeButton, fitTempo, ...tempoControls, node('span', 'pl-spacer'), help, ...toolbarEnd, windowGroup, exportButton, fileInput);
  const shelf = node('div', 'pl-shelf'); shelf.setAttribute('aria-label', t('Sample library', 'Biblioteca de samples'));
  shelf.title = t('Library: click to select for drawing, double-click to add at the cursor, drag onto a track. Right-click for more.', 'Biblioteca: clic para elegir qué dibujar, doble clic para agregar en el cursor, arrastrá a una pista. Clic derecho para más.');
  shelf.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || shelf.scrollWidth <= shelf.clientWidth) return;
    event.preventDefault(); shelf.scrollLeft += event.deltaY;
  }, { passive: false });
  const library = node('div', 'pl-library');
  const scroll = node('div', 'pl-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', t('Playlist timeline', 'Línea de tiempo de la playlist'));
  const grid = node('div', 'pl-grid'); scroll.append(grid);
  const waveCanvas = node('canvas', 'pl-wave-layer'); waveCanvas.setAttribute('aria-hidden', 'true'); grid.append(waveCanvas);
  const playhead = node('div', 'pl-playhead'); playhead.setAttribute('aria-hidden', 'true'); grid.append(playhead);
  const sliceLine = node('div', 'pl-slice-line'); sliceLine.hidden = true; sliceLine.setAttribute('aria-hidden', 'true'); grid.append(sliceLine);
  const rangeBox = node('div', 'pl-marquee'); rangeBox.hidden = true; rangeBox.setAttribute('aria-hidden', 'true'); grid.append(rangeBox);
  setTool('draw');
  const rulerRow = node('div', 'pl-grid-row pl-ruler-row'), corner = node('div', 'pl-track-head', t('CHANNELS', 'CANALES')), ruler = node('div', 'pl-ruler');
  const rulerMarks = node('div', 'pl-ruler-marks'), loopBand = node('div', 'pl-loop-band'), markerLine = node('div', 'pl-marker');
  let rulerKey = '', rulerWidth = 0;
  ruler.title = t('Drag on the ruler to create a loop · drag inside the selection to move it · drag its edges to resize · double-click to clear (without a loop: play from the start) · click to seek.', 'Arrastrá en la regla para crear un loop · arrastrá dentro de la selección para moverla · arrastrá sus bordes para ajustar · doble clic para eliminar (sin loop: reproduce desde el inicio) · clic para mover el cursor.');
  ruler.setAttribute('aria-label', ruler.title);
  rulerRow.append(corner, ruler); grid.prepend(rulerRow);
  let loopDrag;
  const rulerTime = event => clamp((event.clientX - ruler.getBoundingClientRect().left) / zoom, 0, LIMITS.seconds);
  const loopHit = event => {
    if (!loopRange) return 'create';
    const at = rulerTime(event), a = Math.abs(at - loopRange.start) * zoom, b = Math.abs(at - loopRange.end) * zoom;
    if (Math.min(a, b) <= 7) return a <= b ? 'start' : 'end';
    return at > loopRange.start && at < loopRange.end ? 'move' : 'create';
  };
  ruler.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); loopDrag = { id: event.pointerId, x: event.clientX, at: rulerTime(event), before: loopRange, kind: loopHit(event) }; ruler.setPointerCapture(event.pointerId); };
  ruler.onpointermove = event => {
    const kind = loopDrag?.kind || loopHit(event);
    ruler.style.cursor = kind === 'create' ? 'crosshair' : kind === 'move' ? (loopDrag ? 'grabbing' : 'grab') : 'ew-resize';
    if (loopDrag?.id !== event.pointerId || (!loopDrag.moved && Math.abs(event.clientX - loopDrag.x) < 4)) return;
    const at = timeAt(rulerTime(event)), from = timeAt(loopDrag.at);
    const before = loopDrag.before;
    loopDrag.moved = true;
    if (kind === 'move') {
      const span = before.end - before.start, start = clamp(timeAt(before.start + rulerTime(event) - loopDrag.at), 0, LIMITS.seconds - span);
      changeLoop({ start, end: start + span });
    } else if (kind === 'start') changeLoop({ start: clamp(at, 0, before.end - .01), end: before.end });
    else if (kind === 'end') changeLoop({ start: before.start, end: clamp(at, before.start + .01, LIMITS.seconds) });
    else if (Math.abs(at - from) >= .01) changeLoop({ start: Math.min(at, from), end: Math.max(at, from) });
  };
  ruler.onpointerup = event => { if (loopDrag?.id !== event.pointerId) return; if (!loopDrag.moved) { seek(rulerTime(event)); marker = position; renderLoopBand(); } loopDrag = null; ruler.releasePointerCapture(event.pointerId); };
  ruler.onpointercancel = () => { if (loopDrag) changeLoop(loopDrag.before); loopDrag = null; };
  // Double-click clears the loop; without one it clears the marker and plays from the top.
  ruler.ondblclick = () => {
    if (loopRange) { changeLoop(null); return; }
    marker = 0; renderLoopBand(); seek(0);
    if (!playing()) safe(toggle)();
  };
  const lanes = () => [...grid.querySelectorAll('.pl-lane')];
  const laneIndex = (y, nearest) => {
    const list = lanes(), index = list.findIndex(lane => { const box = lane.getBoundingClientRect(); return y >= box.top && y < box.bottom; });
    if (index >= 0 || !nearest || !list.length) return index;
    return y < list[0].getBoundingClientRect().top ? 0 : list.length - 1;
  };
  const sliceTime = event => timeAt((event.clientX - lanes()[0].getBoundingClientRect().left) / zoom);
  function showSlice(at, from, to) {
    const list = lanes(), origin = grid.getBoundingClientRect();
    const top = list[Math.min(from, to)].getBoundingClientRect().top, bottom = list[Math.max(from, to)].getBoundingClientRect().bottom;
    Object.assign(sliceLine.style, { left: `${TRACK_HEAD + at * zoom}px`, top: `${top - origin.top}px`, height: `${bottom - top}px` });
    sliceLine.hidden = false;
  }
  grid.addEventListener('pointerdown', event => {
    if (selecting && event.button === 0 && !event.target.closest('.pl-track-head, .pl-ruler-row')) {
      const lane = event.target.closest('.pl-lane');
      if (lane) { event.stopPropagation(); beginMarquee(event, lane); }
      return;
    }
    if (!slicing || event.button !== 0 || event.target.closest('.pl-track-head, .pl-ruler-row')) return;
    const lane = laneIndex(event.clientY); if (lane < 0) return;
    event.preventDefault(); event.stopPropagation(); scroll.focus({ preventScroll: true });
    slice = { id: event.pointerId, at: sliceTime(event), from: lane, to: lane };
    grid.setPointerCapture(event.pointerId); showSlice(slice.at, lane, lane);
  }, true);
  grid.addEventListener('pointermove', event => {
    if (!slicing) return;
    if (slice?.id === event.pointerId) { slice.at = sliceTime(event); slice.to = laneIndex(event.clientY, true); showSlice(slice.at, slice.from, slice.to); return; }
    const lane = laneIndex(event.clientY);
    if (slice || lane < 0 || event.target.closest('.pl-track-head')) { if (!slice) sliceLine.hidden = true; return; }
    showSlice(sliceTime(event), lane, lane);
  });
  grid.addEventListener('pointerleave', () => { if (!slice) sliceLine.hidden = true; });
  grid.addEventListener('pointerup', event => {
    if (slice?.id !== event.pointerId) return;
    const { at, from, to } = slice; slice = null; sliceLine.hidden = true;
    const tracks = new Set(lanes().slice(Math.min(from, to), Math.max(from, to) + 1).map(lane => lane.dataset.track));
    cutClips(state.clips.filter(clip => tracks.has(clip.track)), at);
  });
  grid.addEventListener('pointercancel', () => { slice = null; sliceLine.hidden = true; });
  scroll.addEventListener('scroll', () => { paintSoon(); onViewChange?.(); });
  window.addEventListener('scroll', paintSoon, { passive: true });
  let viewportWidth = 0;
  const viewObserver = new ResizeObserver(() => {
    scroll.style.setProperty('--pl-view', `${scroll.clientWidth}px`);
    if (viewportWidth !== scroll.clientWidth || (parseFloat(getComputedStyle(container).getPropertyValue('--pl-head')) || 165) !== TRACK_HEAD) {
      viewportWidth = scroll.clientWidth; draw();
    }
    paintSoon();
  });
  viewObserver.observe(scroll);
  viewObserver.observe(grid);
  const inspector = node('div', 'pl-inspector');
  const selectionLabel = node('strong', 'pl-selected', t('Select a clip', 'Seleccioná un clip'));
  const setClip = (key, value) => commit(() => { for (const clip of chosen()) clip[key] = value; });
  const signed = v => `${v > 0 ? '+' : ''}${Number(v.toFixed(2))}`;
  const resetHint = t('drag, or double-click to reset', 'arrastrá, o doble clic para resetear');
  const pitch = createKnob({ label: 'Pitch', min: -24, max: 24, step: 1, coarse: 12, value: 0, reset: 0, hint: `${t('transposes the clip in semitones', 'transpone el clip en semitonos')} · ${resetHint}`, format: v => `${signed(v)} st`, onCommit: v => setClip('pitch', v) });
  const fine = createKnob({ label: t('Fine pitch', 'Pitch fino'), min: -100, max: 100, step: 1, coarse: 10, value: 0, reset: 0, hint: `${t('fine tuning in cents (100 = 1 semitone)', 'afinación fina en cents (100 = 1 semitono)')} · ${resetHint}`, format: v => `${signed(v)} ct`, onCommit: v => setClip('cents', v) });
  const speed = createKnob({ label: t('Speed', 'Velocidad'), min: .25, max: 4, step: .01, coarse: .25, value: 1, reset: 1, log: true, hint: `${t('speed of this clip only', 'velocidad solo de este clip')} · ${resetHint}`, format: v => `${v.toFixed(2)}×`, onCommit: v => setClip('speed', v) });
  const fades = ['fadeIn', 'fadeOut'].map((key, i) => createKnob({ label: i ? 'Fade out' : 'Fade in', min: 0, max: 10, step: .01, coarse: .1, value: 0, reset: 0, hint: `${i ? t('fades the end of the clip out', 'baja el volumen al final del clip') : t('fades the start of the clip in', 'sube el volumen al inicio del clip')} · ${resetHint}`, format: v => `${v.toFixed(2)} s`, onCommit: v => setClip(key, v) }));
  const muteClip = toolButton({ icon: ICONS.mute, name: t('Mute clip', 'Silenciar clip'), key: 'M', keys: ['m'], color: '#9aa3ad', detail: t('silences only the selected clips; the track keeps playing', 'calla solo los clips seleccionados; la pista sigue sonando') }, () => setClip('mute', !picked()?.mute));
  const reverseClip = toolButton({ icon: ICONS.reverse, name: t('Reverse', 'Invertir'), key: 'R', keys: ['r'], color: '#b48cff', detail: t('plays the selected clips backwards', 'reproduce los clips seleccionados al revés') }, () => setClip('reverse', !picked()?.reverse));
  const crossfade = toolButton({ icon: ICONS.crossfade, name: t('Crossfade overlaps', 'Fundir superposiciones'), key: 'X', keys: ['x'], color: '#4fc3f7', detail: t('fades clips that overlap on the same track so the joins do not click', 'aplica fundidos a los clips que se pisan en la misma pista para que los cortes no hagan clic') }, () => commit(() => crossfadeClips(state.clips)));
  const duplicate = toolButton({ icon: ICONS.duplicate, name: t('Duplicate', 'Duplicar'), key: 'Ctrl+D', keys: ['ctrl+d'], color: '#66d17a', detail: t('repeats selected clips or the whole time range, including silence', 'repite los clips o el rango completo seleccionado, incluido el silencio') }, () => {
    const selection = captureSelection(); if (selection) pasteSelection(selection, selection.end);
  });
  const split = toolButton({ icon: ICONS.split, name: t('Split at cursor', 'Cortar en cursor'), key: 'S', keys: ['s'], color: '#ffb02e', detail: t('cuts every selected clip at the playhead. Ctrl/Shift+click clips, or drag on empty space, to select several.', 'corta todos los clips seleccionados en la posición del cursor. Ctrl/Shift+clic en los clips, o arrastrá en un espacio vacío, para seleccionar varios.') }, () => cutClips(chosen(), now()));
  const remove = toolButton({ icon: ICONS.trash, name: t('Remove from playlist', 'Quitar de la playlist'), key: t('Del', 'Supr'), keys: ['delete', 'backspace'], color: '#ff4d4d', detail: t('removes the selected clips from the song; the sample stays in the library and the track keeps it as its instrument', 'quita los clips seleccionados de la canción; el sample queda en la biblioteca y la pista lo conserva como instrumento') }, () => commit(() => { state.clips = state.clips.filter(c => !isChosen(c.id)); pick(null); }));
  // Cuts every clip in `clips` that crosses `seconds`; both halves of a selected clip stay selected.
  function cutClips(clips, seconds) {
    const targets = clips.filter(clip => splitClip(clip, seconds));
    if (!targets.length) { report(t('No clip crosses that point.', 'Ningún clip cruza ese punto.')); return false; }
    return commit(() => {
      for (const clip of targets) {
        const pieces = splitClip(clip, seconds); state.clips.splice(state.clips.indexOf(clip), 1, ...pieces);
        if (isChosen(clip.id)) extra.add(pieces[1].id);
      }
    });
  }
  library.append(shelf, ...inspectorControls, busy);
  // Right-click menus: clips get their actions plus pitch mode and edit tool; library
  // entries can be duplicated or deleted. Session audio (the stems) stays in the library.
  const MODES = [['stretch', ICONS.keepLength, t('Stretch · keep length', 'Stretch · conservar duración'), t('Changing the pitch keeps the clip length', 'Cambiar el pitch conserva la duración del clip')],
    ['resample', ICONS.resample, t('Resample · pitch + speed', 'Resample · pitch + velocidad'), t('Pitch and speed change together, like a turntable', 'Pitch y velocidad cambian juntos, como un tocadiscos')]];
  const TOOLS = [['move', ICONS.moveTool, t('Move / trim', 'Mover / recortar'), t('Drag clips and their edges', 'Arrastrá clips y sus bordes')],
    ['slip', ICONS.slipTool, t('Slip content', 'Deslizar contenido'), t('Drag to move the audio inside the clip', 'Arrastrá para mover el audio dentro del clip')],
    ['stretch', ICONS.stretchTool, t('Stretch edge', 'Estirar borde'), t('Drag an edge to change the clip speed', 'Arrastrá un borde para cambiar la velocidad del clip')]];
  // The heading names the active choice, since the row itself shows only icons.
  const choiceHeading = (heading, list, value) => `${heading} · ${list.find(([key]) => key === value)[2].split(' · ')[0]}`;
  // FL-style right click on the clip body: removes it, or the whole selection when it is part of it.
  function eraseClip(clip) {
    if (isChosen(clip.id)) { remove.click(); return; }
    commit(() => { state.clips = state.clips.filter(c => c.id !== clip.id); });
  }
  function clipMenu(event, clip) {
    if (!isChosen(clip.id)) pick(clip.id); else if (clip.id !== selected) { extra.delete(clip.id); extra.add(selected); selected = clip.id; }
    updateSelection();
    const mode = clip.keepLength !== false ? 'stretch' : 'resample';
    contextMenu(event, [
      { label: t('Duplicate', 'Duplicar'), icon: ICONS.duplicate, shortcut: 'Ctrl+D', action: () => duplicate.click() },
      { label: t('Split at cursor', 'Cortar en cursor'), icon: ICONS.split, shortcut: 'S', action: () => split.click() },
      { label: t('Mute clip', 'Silenciar clip'), icon: ICONS.mute, shortcut: 'M', checked: !!clip.mute, action: () => muteClip.click() },
      { label: t('Reverse', 'Invertir'), icon: ICONS.reverse, shortcut: 'R', checked: !!clip.reverse, action: () => reverseClip.click() },
      ...(onSeparate && !isPattern(clip) ? [{ label: t('Extract stems…', 'Separar stems…'), icon: ICONS.separate,
        title: t('Split this sample into drums, bass, other and vocals tracks, like FL Studio', 'Separa este sample en pistas de batería, bajo, otros y voz, como en FL Studio'),
        action: () => onSeparate(separable(clip)) }] : []),
      '-', { heading: choiceHeading(t('Pitch mode', 'Modo de pitch'), MODES, mode) },
      { choices: MODES.map(([value, icon, label, title]) => ({ icon, label, title, checked: mode === value,
        action: () => commit(() => { const current = state.clips.find(c => c.id === clip.id); if (current) current.keepLength = value === 'stretch'; }) })) },
      '-', { heading: choiceHeading(t('Edit tool', 'Herramienta'), TOOLS, editMode) },
      { choices: TOOLS.map(([value, icon, label, title]) => ({ icon, label, title, checked: editMode === value, action: () => { editMode = value; } })) },
      ...(!isPattern(clip) && trackOf(clip.track) && !trackOf(clip.track).stem && trackOf(clip.track).source !== clip.asset ? [
        { label: t('Use as track instrument', 'Usar como instrumento de la pista'), icon: ICONS.slice,
          title: t('The channel rack and piano roll of this track cut this sample from now on', 'El channel rack y el piano roll de esta pista cortan este sample desde ahora'),
          action: () => commit(() => { const track = trackOf(clip.track); if (track) track.source = clip.asset; }) }] : []),
      '-',
      { label: t('Remove from playlist', 'Quitar de la playlist'), icon: ICONS.trash, shortcut: t('Del', 'Supr'), danger: true,
        title: t('The sample stays in the library and the track keeps its instrument', 'El sample queda en la biblioteca y la pista conserva su instrumento'), action: () => remove.click() },
    ]);
  }
  // What the host needs to separate a clip: the audio the clip plays, in source seconds.
  function separable(clip) {
    const asset = assets.get(clip.asset), track = trackOf(clip.track);
    return { id: clip.id, name: asset.name, asset: asset.id, session: !!asset.session, stem: track?.stem || null, track: clip.track,
      buffer: asset.buffer, from: Math.min(clip.in, clip.out), to: Math.max(clip.in, clip.out) };
  }
  function uniqueName(name) {
    const base = name.replace(/ \(\d+\)$/, ''), names = new Set([...assets.values()].map(asset => asset.name));
    for (let n = 2; ; n++) if (!names.has(`${base} (${n})`)) return `${base} (${n})`.slice(0, 160);
  }
  function shelfMenu(event, asset) {
    const deleteTitle = asset.session ? t('Separation audio stays in the library', 'El audio de la separación queda siempre en la biblioteca') : '';
    contextMenu(event, [
      ...(onSeparate && !asset.pattern ? [{ label: t('Extract stems…', 'Separar stems…'), icon: ICONS.separate,
        action: () => {
          const sourceTrack = state.clips.find(clip => clip.asset === asset.id)?.track || activeTrack || state.tracks[0]?.id;
          onSeparate({ library: true, asset: asset.id, name: asset.name, buffer: asset.buffer,
            from: 0, to: asset.buffer.duration, track: sourceTrack, at: position,
            original: asset.session && asset.id === 'audio-original' });
        } }] : []),
      { label: t('Duplicate', 'Duplicar'), icon: ICONS.duplicate, action: safe(() => {
        if (asset.pattern) { onPatternAction?.('duplicate', asset.id); return; }
        const next = new Map(assets), copyOf = { id: uid(), name: uniqueName(asset.name), buffer: asset.buffer, version: 0 };
        next.set(copyOf.id, copyOf); checkBudget(next); commit(() => { assets = next; });
      }) },
      { label: asset.pattern ? t('Delete', 'Eliminar') : t('Delete from project', 'Eliminar del proyecto'), icon: ICONS.trash, danger: true, disabled: !!asset.session,
        title: deleteTitle || (asset.pattern ? '' : t('Removes the sample and all its clips; tracks that used it as their instrument let it go. Undo brings the clips back.', 'Quita el sample y todos sus clips; las pistas que lo usaban como instrumento lo sueltan. Deshacer devuelve los clips.')), action: () => {
        if (asset.pattern) { onPatternAction?.('delete', asset.id); return; }
        const removed = commit(() => {
          state.clips = state.clips.filter(clip => clip.asset !== asset.id); if (selected && !picked()) selected = null;
          for (const track of state.tracks) if (track.source === asset.id) delete track.source;
          graveyard.set(asset.id, asset); assets.delete(asset.id); cache.forget(asset.id);
        });
        if (!removed) { assets.set(asset.id, asset); graveyard.delete(asset.id); changed(); draw(); }
      } },
    ]);
  }
  // Same navigation as the stem waveforms: wheel zooms around the pointer, Shift pans.
  const fit = () => { scroll.scrollLeft = 0; zoomAround(0, (scroll.clientWidth - TRACK_HEAD - 12) / Math.max(1, arrangementEnd(state) || 16) / zoom); };
  const wheelHint = t('the mouse wheel zooms over the ruler, Ctrl + wheel zooms anywhere and Shift + wheel pans', 'la rueda hace zoom sobre la regla, Ctrl + rueda hace zoom en cualquier lado y Shift + rueda desplaza');
  const zoomOut = toolButton({ icon: ICONS.zoomOut, name: t('Zoom out', 'Alejar'), detail: wheelHint, key: '-', keys: ['-', '_'], color: '#e6e1da', repeat: true }, () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1 / 1.5));
  const zoomIn = toolButton({ icon: ICONS.zoomIn, name: t('Zoom in', 'Acercar'), detail: wheelHint, key: '+', keys: ['+', '='], color: '#e6e1da', repeat: true }, () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1.5));
  const fitButton = toolButton({ icon: ICONS.fit, name: t('Show the whole arrangement', 'Ver todo el arreglo'), detail: t('fits every clip in view', 'ajusta el zoom para ver todos los clips'), key: 'F', keys: ['f'], color: '#e6e1da' }, fit);
  // Drawing and time selection lead two rows of eight tools.
  const tools = node('div', 'pl-tools');
  tools.append(pencilButton, selectButton, muteClip, reverseClip, crossfade, duplicate, split, sliceButton, remove, undo, redo, zoomOut, zoomIn, fitButton, importButton, addTrack);
  inspector.append(selectionLabel, pitch.wrap, fine.wrap, speed.wrap, ...fades.map(f => f.wrap), tools);
  let zoomFrame = 0, zoomTarget = null, zoomAnchor = null;
  function zoomAround(x, factor) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    x = Math.max(0, x);
    zoomAnchor ||= { at: (scroll.scrollLeft + x) / zoom };
    zoomAnchor.x = x; zoomTarget = clamp((zoomTarget ?? zoom) * factor, MIN_ZOOM, MAX_ZOOM);
    zoomFrame ||= requestAnimationFrame(() => {
      const anchor = zoomAnchor; zoom = zoomTarget; zoomFrame = 0; zoomTarget = zoomAnchor = null;
      draw({ paint: false }); scroll.scrollLeft = anchor.at * zoom - anchor.x; paint(); onViewChange?.();
    });
  }
  scroll.addEventListener('wheel', event => {
    // Channel editors keep their own waveform zoom.
    if (!event.deltaY && !event.deltaX) return;
    // Like FL Studio: the wheel zooms only over the ruler (or with Ctrl anywhere).
    // Over tracks and headers a plain wheel scrolls the page.
    const pan = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!pan && !event.ctrlKey && !event.metaKey && !event.target.closest('.pl-ruler')) return;
    event.preventDefault();
    if (pan) { scroll.scrollLeft += event.deltaX || event.deltaY; return; }
    zoomAround(event.clientX - scroll.getBoundingClientRect().left - TRACK_HEAD, Math.exp(-clamp(event.deltaY, -200, 200) * .002));
  }, { passive: false });
  // Help stays available in the header without automatically covering the timeline.
  const hintText = t('P: pencil · select a sample or clip, then click empty grid space to draw · Q: select time, including silence · Ctrl+C/V: copy/paste at cursor · Ctrl+D: repeat selection · drag clips to move, edges to trim · Space plays · S splits · C slices · B/F8 opens samples · drag on the ruler to loop. 16 tracks / 5 minutes.', 'P: lápiz · elegí un sample o clip y hacé clic en la grilla vacía para dibujar · Q: seleccionar tiempo, incluido el silencio · Ctrl+C/V: copiar/pegar en el cursor · Ctrl+D: repetir selección · arrastrá clips para mover, bordes para recortar · Espacio reproduce · S corta en el cursor · C activa corte · B/F8 abre samples · arrastrá en la regla para crear un loop. 16 pistas / 5 minutos.');
  function showHint() {
    toast({ id: 'playlist-hint', variant: 'info', title: t('Playlist shortcuts', 'Atajos de la playlist'), message: hintText, duration: 12000 });
  }
  container.classList.add('playlist', 'pl-ui'); container.tabIndex = -1;
  // The timeline scrollbar spans only the lanes, not the channel headers.
  const hbarRow = node('div', 'pl-hbar-row'), hbar = node('div', 'pl-hbar'), hbarSize = node('div');
  hbarRow.setAttribute('aria-hidden', 'true'); hbar.append(hbarSize); hbarRow.append(node('div', 'pl-hbar-corner'), hbar);
  hbar.addEventListener('scroll', () => { if (scroll.scrollLeft !== hbar.scrollLeft) scroll.scrollLeft = hbar.scrollLeft; });
  scroll.addEventListener('scroll', () => { if (hbar.scrollLeft !== scroll.scrollLeft) hbar.scrollLeft = scroll.scrollLeft; });
  (toolbarHost === container ? container : toolbarHost).append(toolbar);
  container.append(inspector, library, scroll, hbarRow);

  function travel(forward) {
    const from = forward ? future : history, to = forward ? history : future;
    if (!from.length) return;
    to.push(copy()); state = from.pop(); timeSelection = null;
    if (state.sampleIds) {
      const ids = new Set(state.sampleIds);
      for (const asset of importedSamples()) if (!ids.has(asset.id)) { graveyard.set(asset.id, asset); assets.delete(asset.id); cache.forget(asset.id); }
    }
    // Undo of "Delete from project" brings the sample back from the graveyard.
    for (const id of [...(state.sampleIds || []), ...state.clips.map(clip => clip.asset), ...state.tracks.map(track => track.source)]) {
      if (id && !assets.has(id) && graveyard.has(id)) { assets.set(id, graveyard.get(id)); graveyard.delete(id); }
    }
    state.clips = state.clips.filter(clip => assets.has(clip.asset)); assignSources(); pruneGraveyard(); changed(); draw();
  }
  function checkBudget(next) {
    // Preview audio held by the sample browser counts too.
    let bytes = sampleBrowser?.reservedBytes() || 0;
    for (const asset of next.values()) bytes += asset.buffer.length * asset.buffer.numberOfChannels * 4;
    if (bytes > LIMITS.pcmBytes || next.size > 64) throw new Error(t('Sample library limit: 256 MiB / 64 samples.', 'Límite de biblioteca: 256 MiB / 64 samples.'));
  }
  const firstUserTrack = () => state.tracks.find(track => !track.stem)?.id || state.tracks[0].id;
  // The one importer for the file picker, external drops and the sample browser. Items are
  // Files or { name, read() }, where read() resolves to { file } or an already decoded
  // { buffer }. A null track imports into the project/rack without placing clips.
  // Track and time are fixed when the import starts. Resolves true when added.
  async function importSamples(items, track = firstUserTrack(), at = position) {
    if (operating || !items.length) return false;
    operating = true; report(t('Reading samples…', 'Leyendo samples…'), 'loading');
    try {
      const next = new Map(assets), additions = [];
      for (const item of items) {
        const source = item instanceof Blob ? { file: item } : await item.read();
        let buffer = source.buffer;
        if (!buffer) {
          if (source.file.size > 64 * 1024 * 1024) throw new Error(t('Each file must be smaller than 64 MiB.', 'Cada archivo debe pesar menos de 64 MiB.'));
          buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await source.file.arrayBuffer());
        }
        if (buffer.duration > LIMITS.seconds || buffer.numberOfChannels > 2) throw new Error(t('Use mono/stereo samples up to 5 minutes.', 'Usá samples mono/estéreo de hasta 5 minutos.'));
        const asset = { id: uid(), name: String(item.name || source.file?.name || 'Sample').slice(0, 160), buffer, version: 0 }; next.set(asset.id, asset); additions.push(asset); checkBudget(next);
      }
      const previous = assets;
      const added = commit(() => {
        assets = next;
        if (track !== null) for (const asset of additions) { const clip = newClip(asset, track, at); state.clips.push(clip); pick(clip.id); at += clipDuration(clip); }
      });
      if (!added) { assets = previous; changed(); draw(); }
      else {
        report(t('Samples ready.', 'Samples listos.'), 'success');
        if (track === null) onRackSample?.(`sample-${additions.at(-1).id}`);
      }
      return added;
    } finally { operating = false; dismissToast('playlist-task'); }
  }
  // Placement is free, like FL Studio with snap off: clips, edges, loops and selections
  // land exactly where the mouse is.
  const timeAt = seconds => clamp(seconds, 0, LIMITS.seconds);
  // One canvas follows the visible viewport; editors and hit targets persist.
  function paintSoon() {
    paintFrame ||= requestAnimationFrame(() => { paintFrame = 0; paint(); });
  }
  function drawWave(ctx, clip, left, top, width, height, viewport) {
    const buffer = assets.get(clip.asset)?.buffer;
    if (!buffer) return;
    const spectrum = spectrumNow(buffer);
    if (!spectrum && !analyzing.has(buffer)) {
      analyzing.add(buffer); spectrumOf(buffer).then(paintSoon, () => {});
    }
    const data = buffer.getChannelData(0), bins = spectrum?.peaks.length, loop = assets.get(clip.asset)?.loop ? buffer.duration : 0;
    const binSeconds = spectrum ? spectrum.durationMs / 1000 / bins : 0;
    const startX = Math.max(TRACK_HEAD, Math.floor(left)), endX = Math.min(viewport, Math.ceil(left + width));
    let lastPass = null;
    for (let x = startX; x < endX; x++) {
      const a = clamp((x - left) / width, 0, 1), b = clamp((x + 1 - left) / width, 0, 1), span = clip.out - clip.in;
      let from = clip.reverse ? clip.out - b * span : clip.in + a * span;
      let to = clip.reverse ? clip.out - a * span : clip.in + b * span;
      if (loop) {
        const pass = Math.floor(from / loop + 1e-9);
        // A faint line marks where a pattern clip repeats.
        if (x > startX && pass !== lastPass) { ctx.fillStyle = '#ffffff40'; ctx.fillRect(x, top, 1, height); }
        lastPass = pass; from -= pass * loop; to = Math.min(loop, to - pass * loop);
      }
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
    hbarSize.style.width = Math.max(0, scroll.scrollWidth - TRACK_HEAD) + 'px';
    // The scrollbar row only shows when there are clips and something to scroll to.
    const scrollable = state.clips.length > 0 && scroll.scrollWidth > scroll.clientWidth + 1;
    if (hbarRow.hidden === scrollable) hbarRow.hidden = !scrollable;
    if (hbar.scrollLeft !== scroll.scrollLeft) hbar.scrollLeft = scroll.scrollLeft;
    const rect = grid.getBoundingClientRect(), y = Math.max(0, -rect.top);
    const height = Math.max(1, Math.min(rect.height - y, innerHeight - Math.max(0, rect.top)));
    const width = scroll.clientWidth, scale = Math.min(2, devicePixelRatio || 1);
    waveCanvas.style.left = scroll.scrollLeft + 'px'; waveCanvas.style.top = y + 'px';
    waveCanvas.style.width = width + 'px'; waveCanvas.style.height = height + 'px';
    if (waveCanvas.width !== Math.ceil(width * scale)) waveCanvas.width = Math.ceil(width * scale);
    if (waveCanvas.height !== Math.ceil(height * scale)) waveCanvas.height = Math.ceil(height * scale);
    const ctx = waveCanvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
    renderRuler(); renderTimeSelection();
    // Measure every lane before any clip is written, so layout is read once per paint.
    const laneTops = new Map();
    for (const [id, view] of rowViews) laneTops.set(id, view.lane.getBoundingClientRect().top - rect.top - y + 25);
    const visible = new Set();
    for (const clip of state.clips) {
      const view = rowViews.get(clip.track);
      if (!view) continue;
      const left = TRACK_HEAD + clip.at * zoom - scroll.scrollLeft, clipWidth = Math.max(8, clipDuration(clip) * zoom);
      const top = laneTops.get(clip.track);
      const shown = left + clipWidth >= TRACK_HEAD && left < width && top + 44 >= 0 && top < height;
      if (shown || drag?.clip.id === clip.id || clipViews.get(clip.id)?.contains(document.activeElement)) {
        let item = clipViews.get(clip.id);
        if (!item) { item = clipElement(clip); clipViews.set(clip.id, item); }
        if (item.parentElement !== view.lane && drag?.clip.id !== clip.id) view.lane.append(item);
        updateClip(item, clip); visible.add(clip.id);
      }
      if (!shown) continue;
      ctx.globalAlpha = clip.mute || !trackAudible(state, trackOf(clip.track)) ? .35 : 1;
      drawWave(ctx, clip, left + 1, top, clipWidth - 2, 44, width);
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
      size: 'sm', inline: true, hint: resetHint, format: v => `${v}%`, onInput: v => edit(() => { trackOf(trackId).gain = v / 100; }, { live: true }),
      onCommit: v => edit(() => { trackOf(trackId).gain = v / 100; }) });
    head.volume = volume; controls.append(volume.wrap); head.append(name, controls);
    return head;
  }
  function draw({ paint: paintNow = true } = {}) {
    TRACK_HEAD = parseFloat(getComputedStyle(container).getPropertyValue('--pl-head')) || 165;
    tempo.input.value = String(Math.round(state.bpm * 100) / 100); undo.disabled = !history.length; redo.disabled = !future.length;
    const extent = Math.min(LIMITS.seconds, Math.max(16, arrangementEnd(state) + 8, timeSelection?.end || 0));
    const width = Math.max(scroll.clientWidth - TRACK_HEAD, extent * zoom);
    grid.style.width = (width + TRACK_HEAD) + 'px'; grid.style.setProperty('--beat', (60 / state.bpm * zoom) + 'px');
    ruler.style.width = width + 'px'; rulerWidth = width;
    if (loopBand.parentElement !== ruler) ruler.append(rulerMarks, loopBand, markerLine);
    renderRuler(); renderLoopBand();
    const rows = [rulerRow];
    state.tracks.forEach((track, index) => {
      const host = channel?.(track, trackSource(track.id)) || null;
      let view = rowViews.get(track.id);
      if (!view || view.host !== host) {
        view?.row.remove();
        const row = node('div', 'pl-grid-row'), lane = node('div', 'pl-lane');
        const head = host?.head || userHead(track, index);
        head.classList.add('pl-track-head'); lane.dataset.track = track.id; row.append(head, lane);
        lane.onpointerdown = event => { if (event.target === lane) beginMarquee(event); };
        lane.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
        lane.ondrop = safe(async event => {
          event.preventDefault(); const at = timeAt((event.clientX - lane.getBoundingClientRect().left) / zoom);
          const browsed = sampleBrowser?.resolveDrop(event.dataTransfer);
          if (browsed) { await importSamples(browsed, track.id, at); return; }
          if (event.dataTransfer.files.length) { await importSamples([...event.dataTransfer.files], track.id, at); return; }
          const asset = assets.get(event.dataTransfer.getData('application/x-stem-sample'));
          if (asset) commit(() => { const clip = newClip(asset, track.id, at); state.clips.push(clip); pick(clip.id); });
        });
        view = { row, lane, head, host }; rowViews.set(track.id, view);
      }
      view.head.style.setProperty('--track-color', color(track));
      view.row.classList.toggle('is-silent', !trackAudible(state, track)); view.lane.style.width = width + 'px';
      if (!host) {
        view.head.querySelector('.pl-track-name').value = track.name;
        for (const key of ['mute', 'solo']) view.head.querySelector('[data-mix=' + key + ']').setAttribute('aria-pressed', String(track[key]));
        view.head.volume.show(Math.round(track.gain * 100));
      }
      rows.push(view.row);
    });
    for (const [id, view] of rowViews) if (!state.tracks.some(t => t.id === id)) { view.row.remove(); rowViews.delete(id); }
    let cursor = grid.firstElementChild;
    for (const row of rows) { if (row === cursor) cursor = cursor.nextElementSibling; else grid.insertBefore(row, cursor); }
    const shelfAssets = [...assets.values()];
    const nextShelf = shelfAssets.map(a => a.id + ':' + a.name).join('|');
    if (nextShelf !== shelfKey) {
      shelfKey = nextShelf; shelf.replaceChildren();
      for (const asset of shelfAssets) {
        const b = button(asset.name, t('Click to draw this sample · double-click: add at cursor · drag onto a track', 'Clic para dibujar este sample · doble clic: agregar en el cursor · arrastrá a una pista'), () => {
          pick(null); drawSource = newClip(asset, activeTrack || firstUserTrack()); setTool('draw'); updateSelection(); scroll.focus({ preventScroll: true });
        });
        b.ondblclick = () => placeDrawSource(activeTrack || firstUserTrack(), position);
        b.classList.toggle('is-pattern', !!asset.pattern); b.dataset.asset = asset.id;
        b.draggable = true; b.ondragstart = event => event.dataTransfer.setData('application/x-stem-sample', asset.id);
        b.oncontextmenu = event => shelfMenu(event, asset); shelf.append(b);
      }
    }
    updateSelection(); if (paintNow) paint(); onViewChange?.();
  }
  function updateClip(item, clip) {
    const name = assets.get(clip.asset).name;
    item.setAttribute('aria-label', name + ', ' + clock(clip.at) + ', ' + clipPitch(clip) + ' ' + t('semitones', 'semitonos'));
    item.setAttribute('aria-pressed', String(isChosen(clip.id)));
    item.style.left = (clip.at * zoom) + 'px'; item.style.width = Math.max(8, clipDuration(clip) * zoom) + 'px'; item.style.setProperty('--clip-color', color(trackOf(clip.track)));
    item.classList.toggle('is-stretching', stretching(clip)); item.classList.toggle('is-muted', !!clip.mute); item.classList.toggle('is-pattern', isPattern(clip));
    item.querySelector('.pl-clip-title').replaceChildren(...(clip.reverse ? [globalThis.SCIcons.create('reverse')] : []), document.createTextNode(name + (clipPitch(clip) ? '  ' + signed(clipPitch(clip)) + ' st' : '') + (clip.speed !== 1 ? '  ' + clip.speed.toFixed(2) + '×' : '')));
  }
  function clipElement(initial) {
    const id = initial.id;
    const item = node('div', 'pl-clip'); item.dataset.clip = id; item.tabIndex = 0; item.setAttribute('role', 'button');
    item.append(node('span', 'pl-clip-title'));
    for (const edge of ['left', 'right']) { const handle = node('span', `pl-edge pl-edge-${edge}`); handle.dataset.edge = edge; handle.title = t('Drag to trim', 'Arrastrar para recortar'); item.append(handle); }
    // Remembered for the contextmenu event, which older Chrome versions fire without pointerType.
    item.onpointerdown = event => { item.dataset.pointer = event.pointerType; beginDrag(event, state.clips.find(c => c.id === id), item); };
    // Like FL Studio: right click on the name bar opens the menu, on the waveform removes the clip.
    // The keyboard menu key (no pointer position) and touch long-press always open the menu,
    // so a long press never deletes by accident.
    item.oncontextmenu = event => {
      const clip = state.clips.find(c => c.id === id); if (!clip) return;
      // Measured by height: the trim handles cover the name bar's ends too.
      const keyboard = !event.clientX && !event.clientY, onHeader = event.clientY < item.querySelector('.pl-clip-title').getBoundingClientRect().bottom;
      const touch = ['touch', 'pen'].includes(event.pointerType || item.dataset.pointer);
      if (keyboard || onHeader || touch) { clipMenu(event, clip); return; }
      event.preventDefault(); event.stopPropagation(); eraseClip(clip);
    };
    item.onkeydown = event => {
      const clip = state.clips.find(c => c.id === id), index = state.tracks.findIndex(t => t.id === clip.track);
      if (event.key === 'Enter') { pick(clip.id); updateSelection(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); pick(clip.id);
      commit(() => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') clip.at = clamp(clip.at + (event.key === 'ArrowLeft' ? -1 : 1) * 60 / state.bpm * .25, 0, LIMITS.seconds - clipDuration(clip));
        else clip.track = state.tracks[clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, state.tracks.length - 1)].id; });
      grid.querySelector(`.pl-clip[data-clip="${clip.id}"]`)?.focus();
    };
    return item;
  }
  // Bar numbers exist only around the visible span, so deep zoom stays light.
  function renderRuler() {
    const barSeconds = 240 / state.bpm, barPixels = barSeconds * zoom, barStep = Math.max(1, Math.ceil(55 / barPixels));
    const view = scroll.clientWidth || 1200, from = Math.max(0, scroll.scrollLeft - view), to = Math.min(rulerWidth, scroll.scrollLeft + 2 * view);
    const first = Math.floor(from / (barPixels * barStep)) * barStep, key = [zoom, state.bpm, rulerWidth, first, Math.ceil(to / (barPixels * barStep))].join('|');
    if (key === rulerKey) return;
    rulerKey = key;
    const marks = [];
    for (let bar = first; bar * barPixels < to; bar += barStep) { const mark = node('span', '', String(bar + 1)); mark.style.left = (bar * barPixels) + 'px'; marks.push(mark); }
    rulerMarks.replaceChildren(...marks);
  }
  function renderLoopBand(band = loopBand) {
    if (!band) return;
    band.hidden = !loopRange;
    if (loopRange) { band.style.left = `${loopRange.start * zoom}px`; band.style.width = `${(loopRange.end - loopRange.start) * zoom}px`; }
    markerLine.style.left = `${marker * zoom}px`;
  }
  function updateSelection() {
    for (const id of extra) if (id === selected || !state.clips.some(c => c.id === id)) extra.delete(id);
    if (!picked() && extra.size) { selected = extra.values().next().value; extra.delete(selected); }
    const clip = picked(), count = chosen().length;
    selectionLabel.textContent = count > 1 ? `${count} clips` : clip ? assets.get(clip.asset).name : t('Select a clip', 'Seleccioná un clip');
    for (const input of [pitch.dial, fine.dial, speed.dial, ...fades.map(f => f.dial), muteClip, reverseClip, duplicate, split, remove]) input.disabled = !clip;
    fine.show(clip?.cents ?? 0); fades[0].show(clip?.fadeIn ?? 0); fades[1].show(clip?.fadeOut ?? 0);
    muteClip.setAttribute('aria-pressed', String(!!clip?.mute)); reverseClip.setAttribute('aria-pressed', String(!!clip?.reverse));
    pitch.show(clip?.pitch ?? 0); speed.show(clip?.speed ?? 1);
    for (const item of grid.querySelectorAll('.pl-clip')) item.setAttribute('aria-pressed', String(isChosen(item.dataset.clip)));
    for (const item of shelf.children) item.setAttribute('aria-pressed', String(item.dataset.asset === drawSource?.asset));
    duplicate.disabled = !clip && !timeSelection;
    renderTimeSelection();
    // Reported on change only: redraws must not move the host's focus.
    if (selected !== reported) { reported = selected; onSelect?.(clip && assets.get(clip.asset)); }
  }
  function toggleClip(id) {
    timeSelection = null;
    if (id === selected) { selected = extra.values().next().value ?? null; extra.delete(selected); }
    else if (extra.has(id)) extra.delete(id);
    else { if (selected) extra.add(selected); selected = id; }
    updateSelection();
  }
  function renderTimeSelection() {
    rangeBox.hidden = !timeSelection;
    if (!timeSelection) return;
    const views = timeSelection.tracks.map(id => rowViews.get(id)).filter(Boolean);
    if (!views.length) { rangeBox.hidden = true; return; }
    const origin = grid.getBoundingClientRect(), first = views[0].lane.getBoundingClientRect(), last = views.at(-1).lane.getBoundingClientRect();
    Object.assign(rangeBox.style, { left: `${TRACK_HEAD + timeSelection.start * zoom}px`, top: `${first.top - origin.top}px`,
      width: `${(timeSelection.end - timeSelection.start) * zoom}px`, height: `${last.bottom - first.top}px` });
  }
  function placeDrawSource(track, at) {
    const source = picked() || drawSource;
    if (!source || !assets.has(source.asset)) return;
    commit(() => {
      const clip = { ...source, id: uid(), track, at };
      state.clips.push(clip); pick(clip.id);
    });
  }
  function captureSelection() {
    const clips = timeSelection ? clipsInRange(state.clips, timeSelection) : chosen();
    if (!timeSelection && !clips.length) return null;
    const start = timeSelection?.start ?? Math.min(...clips.map(c => c.at));
    const end = timeSelection?.end ?? Math.max(...clips.map(c => c.at + clipDuration(c)));
    const tracks = timeSelection?.tracks || state.tracks.filter(track => clips.some(c => c.track === track.id)).map(track => track.id);
    return { start, end, tracks: [...tracks], range: !!timeSelection, clips: clips.map(c => ({ ...c })) };
  }
  function pasteSelection(selection, at, targetTrack = null) {
    const startIndex = state.tracks.findIndex(track => track.id === selection.tracks[0]);
    const targetIndex = targetTrack ? state.tracks.findIndex(track => track.id === targetTrack) : startIndex;
    const mapTrack = id => state.tracks[state.tracks.findIndex(track => track.id === id) + targetIndex - startIndex]?.id;
    const tracks = selection.tracks.map(mapTrack);
    if (startIndex < 0 || targetIndex < 0 || tracks.some(id => !id) || selection.clips.some(c => !assets.has(c.asset))) {
      report(t('The copied samples or tracks are no longer available here.', 'Los samples o pistas copiados ya no están disponibles acá.')); return;
    }
    const end = at + selection.end - selection.start;
    if (end > LIMITS.seconds + 1e-6) { report(t('The selection exceeds 5 minutes.', 'La selección supera los 5 minutos.')); return; }
    const previousRange = timeSelection, previousSelected = selected, previousExtra = new Set(extra);
    if (!commit(() => {
      const clips = selection.clips.map(c => ({ ...c, id: uid(), track: mapTrack(c.track), at: at + c.at - selection.start }));
      state.clips.push(...clips); selected = clips[0]?.id ?? null; extra = new Set(clips.slice(1).map(c => c.id));
      timeSelection = selection.range ? { start: at, end, tracks } : null;
    })) { timeSelection = previousRange; selected = previousSelected; extra = previousExtra; updateSelection(); }
  }
  // A click draws; a drag selects time and entire lanes, retaining the empty space.
  // Ctrl/Shift dragging retains the additive clip-only marquee behavior.
  function beginMarquee(event, lane = event.currentTarget) {
    if (event.button !== 0) return;
    event.preventDefault(); scroll.focus({ preventScroll: true });
    const add = event.ctrlKey || event.metaKey || event.shiftKey;
    const base = add ? chosen().map(c => c.id) : [];
    const previous = { range: timeSelection, selected, extra: new Set(extra) };
    const start = grid.getBoundingClientRect(), x0 = event.clientX - start.left, y0 = event.clientY - start.top;
    let moved = false;
    activeTrack = lane.dataset.track;
    lane.setPointerCapture(event.pointerId);
    lane.onpointermove = move => {
      const origin = grid.getBoundingClientRect(), x1 = move.clientX - origin.left, y1 = move.clientY - origin.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
      const from = timeAt((left - TRACK_HEAD) / zoom), to = timeAt((right - TRACK_HEAD) / zoom);
      const tracks = new Set(state.tracks.filter(track => { const r = rowViews.get(track.id).lane.getBoundingClientRect(); return r.top - origin.top <= bottom && r.bottom - origin.top >= top; }).map(track => track.id));
      timeSelection = !add && to > from ? { start: from, end: to, tracks: [...tracks] } : null;
      const ids = [...new Set([...base, ...state.clips.filter(c => tracks.has(c.track) && c.at < to && c.at + clipDuration(c) > from).map(c => c.id)])];
      selected = ids.includes(selected) ? selected : ids[0] ?? null; extra = new Set(ids.filter(id => id !== selected));
      updateSelection();
    };
    const finish = cancel => {
      lane.onpointermove = lane.onpointerup = lane.onpointercancel = lane.onlostpointercapture = null;
      if (lane.hasPointerCapture(event.pointerId)) lane.releasePointerCapture(event.pointerId);
      if (cancel) { timeSelection = previous.range; selected = previous.selected; extra = previous.extra; updateSelection(); return; }
      if (!moved && !add) {
        const at = timeAt((x0 - TRACK_HEAD) / zoom);
        if (!selecting && drawSource && assets.has(drawSource.asset)) placeDrawSource(lane.dataset.track, at);
        else { pick(null); seek(at); updateSelection(); }
      }
      if (timeSelection) activeTrack = timeSelection.tracks[0];
    };
    lane.onpointerup = () => finish(false); lane.onpointercancel = lane.onlostpointercapture = () => finish(true);
  }
  function beginDrag(event, clip, item) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey) { toggleClip(clip.id); item.focus({ preventScroll: true }); return; }
    pick(clip.id); updateSelection(); item.focus({ preventScroll: true });
    const lanes = [...grid.querySelectorAll('.pl-lane')], home = item.parentElement.getBoundingClientRect().top;
    drag = { id: event.pointerId, x: event.clientX, scroll: scroll.scrollLeft, before: copy(), clip: { ...clip }, edge: event.target.dataset.edge, changed: false };
    item.setPointerCapture(event.pointerId);
    item.onpointermove = move => {
      if (drag?.id !== move.pointerId) return;
      const original = drag.clip, delta = (move.clientX - drag.x + scroll.scrollLeft - drag.scroll) / zoom, speedRate = clipRate(original);
      // Pattern clips have no source end: stretching them repeats the pattern.
      const length = isPattern(clip) ? Infinity : assets.get(clip.asset).buffer.duration;
      if (editMode === 'slip' && !drag.edge) {
        Object.assign(clip, slipClip(original, delta * (original.reverse ? -1 : 1), length));
      } else if (editMode === 'stretch' && drag.edge === 'right') {
        const end = timeAt(original.at + clipDuration(original) + delta);
        const pitchRate = original.keepLength ? 1 : 2 ** (clipPitch(original) / 12);
        clip.speed = clamp((original.out - original.in) / Math.max(.01, end - original.at) / pitchRate, .25, 4);
        if (clip.at + clipDuration(clip) > LIMITS.seconds) clip.speed = (clip.out - clip.in) / (LIMITS.seconds - clip.at) / pitchRate;
      } else if (drag.edge === 'right') {
        const end = timeAt(original.at + clipDuration(original) + delta);
        if (original.reverse) clip.in = clamp(original.out - (end - original.at) * speedRate, Math.max(0, original.out - (LIMITS.seconds - clip.at) * speedRate), original.out - .01 * speedRate);
        else clip.out = clamp(original.in + (end - original.at) * speedRate, original.in + .01 * speedRate, Math.min(length, original.in + (LIMITS.seconds - clip.at) * speedRate));
      } else if (drag.edge === 'left') {
        const room = original.reverse ? length - original.out : original.in;
        const next = clamp(timeAt(original.at + delta), Math.max(0, original.at - room / speedRate), original.at + clipDuration(original) - .01);
        clip.at = next;
        if (original.reverse) clip.out = original.out - (next - original.at) * speedRate;
        else clip.in = original.in + (next - original.at) * speedRate;
      } else {
        clip.at = clamp(timeAt(original.at + delta), 0, LIMITS.seconds - clipDuration(clip));
        const lane = lanes.find(e => { const box = e.getBoundingClientRect(); return move.clientY >= box.top && move.clientY < box.bottom; });
        if (lane) { clip.track = lane.dataset.track; item.style.transform = `translateY(${lane.getBoundingClientRect().top - home}px)`; }
      }
      drag.changed = true; item.style.left = `${clip.at * zoom}px`; item.style.width = `${Math.max(8, clipDuration(clip) * zoom)}px`;
      // One engine update per frame; a stretch-edge drag would queue a render per move,
      // so its new speed is heard on release.
      if (!(editMode === 'stretch' && drag.edge === 'right')) dragAudio ||= requestAnimationFrame(() => { dragAudio = 0; engine?.update(playbackState(), transport()); });
      paintSoon();
    };
    const finish = cancel => {
      if (!drag) return;
      const gesture = drag; drag = null;
      cancelAnimationFrame(dragAudio); dragAudio = 0;
      item.onpointermove = item.onpointerup = item.onpointercancel = item.onlostpointercapture = null;
      if (item.hasPointerCapture(gesture.id)) item.releasePointerCapture(gesture.id);
      item.style.transform = '';
      if (cancel) { state = gesture.before; changed(); }
      else if (gesture.changed) { assignSources(); history.push(gesture.before); if (history.length > 50) history.shift(); future = []; changed(); }
      draw(); grid.querySelector(`.pl-clip[data-clip="${selected}"]`)?.focus({ preventScroll: true });
    };
    item.onpointerup = () => finish(false); item.onpointercancel = item.onlostpointercapture = () => finish(true);
  }
  // Track edits from the host and the track headers. Live edits are heard at once
  // and become one undo step with the next final edit.
  function edit(action, { live = false } = {}) {
    if (live) { liveBefore ||= copy(); action(state); engine?.update(playbackState(), transport()); return true; }
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
    if (engine.play(playbackState(), position, transport())) { renderPlay(true); startMetronome(); onTransport?.(true); }
  }
  // A second Space within 350 ms rewinds to the marker and plays, like FL Studio. The marker is
  // the last ruler click; making or moving a loop puts it on the loop start.
  let lastSpace = 0;
  function space() {
    const at = performance.now(), twice = at - lastSpace < 350;
    lastSpace = twice ? 0 : at;
    if (!twice) return toggle();
    stop(true); return toggle();
  }
  function seek(seconds) {
    position = clamp(seconds, 0, LIMITS.seconds);
    if (playing()) { engine.play(playbackState(), position, transport()); startMetronome(); }
  }
  async function exportMix() {
    if (exporting) return;
    exporting = new AbortController(); exportButton.disabled = true;
    try {
      const rendered = await renderArrangement(structuredClone(playbackState()), new Map(assets), cache, { signal: exporting.signal, masterEq: structuredClone(masterEq?.() ?? null), masterFx: structuredClone(masterFx?.() ?? null),
        progress: p => toast({ id: 'playlist-task', variant: 'loading', title: `${t('Rendering WAV', 'Renderizando WAV')} ${Math.round(p * 100)}%`, progress: p }) });
      const blob = new Blob([encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], rendered.sampleRate)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'playlist.wav'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(t('WAV exported. Peaks above 0 dB were normalized.', 'WAV exportado. Los picos sobre 0 dB se normalizaron.'), 'success');
    } finally { exporting = null; exportButton.disabled = false; dismissToast('playlist-task'); }
  }
  // Replace the host's channels (original and stems); user tracks with clips stay.
  // `saved` restores channel mix and clips from a preset; invalid data falls back.
  // `samples` are the imported samples a preset stored: [{ id, name, buffer }].
  function setSession({ sources, saved = null, samples = [] }) {
    stop(true);
    for (const old of assets.values()) if (old.session) cache.forget(old.id);
    const next = new Map([...assets].filter(([, asset]) => !asset.session));
    for (const source of sources) next.set(source.id, { id: source.id, name: source.name, buffer: source.buffer, version: 0, session: true });
    for (const sample of samples) if (!next.has(sample.id)) next.set(sample.id, { id: sample.id, name: String(sample.name || 'Sample').slice(0, 160), buffer: sample.buffer, version: 0 });
    const userClips = state.clips.filter(clip => next.get(clip.asset) && !next.get(clip.asset).session && !trackOf(clip.track)?.stem);
    const userTracks = state.tracks.filter(track => !track.stem && userClips.some(clip => clip.track === track.id));
    userTracks.push(state.tracks.find(track => !track.stem && !userTracks.includes(track)) ||
      { id: uid(), name: `${t('Track', 'Pista')} ${userTracks.length + 1}`, gain: 1, mute: false, solo: false });
    const build = restore => {
      const tracks = sources.map(source => {
        const old = restore && saved?.tracks?.find(item => item?.stem === source.stem);
        return { id: `track-${source.stem}`, name: source.name, stem: source.stem, gain: Number.isFinite(old?.gain) ? clamp(old.gain, 0, 2) : 1,
          mute: old ? old.mute === true : source.mute === true, solo: false };
      });
      // A clip whose audio did not come back (a sample that failed to load) is left out.
      const clips = restore && Array.isArray(saved?.clips) ? saved.clips.filter(clip => next.has(clip?.asset)).map(clip => ({ ...clip })) :
        sources.map(source => newClip(next.get(source.id), `track-${source.stem}`, 0));
      const restoredUsers = restore && Array.isArray(saved?.userTracks) ? saved.userTracks.filter(track => !track.stem) : [];
      const users = [...restoredUsers, ...userTracks.filter(track => !restoredUsers.some(saved => saved.id === track.id) && (!restoredUsers.length || userClips.some(clip => clip.track === track.id)))];
      return { version: 1, bpm: restore && Number.isFinite(saved?.bpm) ? saved.bpm : state.bpm, tracks: [...tracks, ...users], clips: [...clips, ...userClips] };
    };
    let candidate = build(!!saved);
    // A saved track may name a sample that is not in this session.
    for (const track of candidate.tracks) if (track.source && !next.has(track.source)) delete track.source;
    // Stem channels get their saved EQ back; user tracks carry theirs.
    if (saved?.trackEq && typeof saved.trackEq === 'object') for (const track of candidate.tracks) {
      const eq = saved.trackEq[track.id];
      if (track.stem && eq && typeof eq === 'object' && Array.isArray(eq.bands)) track.eq = structuredClone(eq);
    }
    try { validateArrangement(candidate, next); } catch { candidate = build(false); validateArrangement(candidate, next); }
    state = candidate; assets = next; assignSources(); history = []; future = []; graveyard.clear(); pick(null); drawSource = clipboard = activeTrack = null; liveBefore = null; position = marker = loopRange?.start ?? 0;
    changed(); draw(); requestAnimationFrame(fit);
  }
  // The audio a track's instrument is cut from: the stem, or the first non-pattern clip.
  function trackSource(id) {
    const track = state.tracks.find(item => item.id === id || item.stem === id);
    if (!track) return null;
    const asset = assets.get(track.stem ? `audio-${track.stem}` : track.source);
    return asset ? { id: asset.id, name: asset.name, buffer: asset.buffer } : null;
  }
  for (const root of new Set([container, toolbar])) root.addEventListener('keydown', event => {
    if (event.target.closest('input,select,textarea') || event.target.isContentEditable) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) safe(space)(); return; }
    const combo = (modifier ? 'ctrl+' : '') + (modifier && event.shiftKey ? 'shift+' : '') + event.key.toLowerCase(), tool = windowKeys.has(combo) ? null : hotkeys.get(combo);
    if (tool) { event.preventDefault(); if ((!event.repeat || tool.repeat) && !tool.control.disabled) tool.control.click(); }
    else if (event.key === 'Escape') { event.preventDefault(); setTool('draw'); pick(null); updateSelection(); }
    // An empty selection keeps the previous copy, like FL Studio.
    else if (combo === 'ctrl+c') { event.preventDefault(); clipboard = captureSelection() || clipboard; }
    else if (combo === 'ctrl+v') { event.preventDefault(); if (clipboard) pasteSelection(clipboard, timeAt(position), activeTrack); }
    else if (combo === 'ctrl+a') { event.preventDefault(); timeSelection = null; selected = state.clips[0]?.id ?? null; extra = new Set(state.clips.slice(1).map(c => c.id)); updateSelection(); }
    else if (combo === 't') { event.preventDefault(); if (!event.repeat) tapTempo(); }
  });
  function animate() {
    const at = now(); time.textContent = clock(at);
    const head = grid.querySelector('.pl-playhead'); if (head) head.style.left = `${TRACK_HEAD + at * zoom}px`;
    frame = requestAnimationFrame(animate);
  }
  draw(); animate();
  return {
    toggle: safe(toggle), space: safe(space), pause: () => stop(), seek, now, playing, setSession, edit, draw,
    async importRackDrop(dataTransfer) {
      // Capture files/items before awaiting: browser drag data is only readable during drop.
      const browsed = sampleBrowser?.resolveDrop(dataTransfer);
      if (browsed) return importSamples(browsed, null);
      if (dataTransfer.files.length) return importSamples([...dataTransfer.files], null);
      const asset = assets.get(dataTransfer.getData('application/x-stem-sample'));
      if (!asset || asset.pattern) return false;
      const track = state.tracks.find(track => trackSource(track.id)?.id === asset.id);
      onRackSample?.(track ? track.stem || track.id : `sample-${asset.id}`);
      return true;
    },
    track: stem => state.tracks.find(track => track.id === stem || track.stem === stem),
    tracks: () => state.tracks,
    instrumentSources() {
      const used = new Set();
      const channels = state.tracks.map(track => {
        const source = trackSource(track.id); if (source) used.add(source.id);
        return { key: track.stem || track.id, name: source && !track.stem ? source.name : track.name,
          buffer: source?.buffer || null, imported: !!source && !track.stem };
      });
      for (const asset of importedSamples()) if (!used.has(asset.id)) channels.push({ key: `sample-${asset.id}`, name: asset.name, buffer: asset.buffer, imported: true });
      return channels;
    },
    duration: () => arrangementEnd(state),
    trackSource,
    // Per-channel EQ, like a mixer insert. Edits apply at once and reach onChange for saving.
    trackEq: key => structuredClone(state.tracks.find(track => track.id === key || track.stem === key)?.eq ?? null),
    setTrackEq(key, eq) {
      const track = state.tracks.find(item => item.id === key || item.stem === key);
      if (!track) return false;
      track.eq = structuredClone(eq); engine?.mix(state); onChange?.();
      return true;
    },
    // The track's insert on the playlist context, for its instruments (PAT preview).
    async trackAudio(key) {
      const track = state.tracks.find(item => item.id === key || item.stem === key);
      await connect(); engine.mix(state);
      return { context: engineIO.context, output: track ? engine.trackInput(track.id) : engineIO.output };
    },
    trackGraph(key) {
      const track = state.tracks.find(item => item.id === key || item.stem === key);
      return track ? engine?.trackGraph(track.id) || null : null;
    },
    // Peak level of a track (by id or stem) while the playlist plays; 0 when stopped.
    trackLevel(key) {
      const track = state.tracks.find(item => item.id === key || item.stem === key);
      return track && engine?.playing() ? engine.trackLevel(track.id) : 0;
    },
    // The toolbar button of a window ('browser' or a host window id).
    windowButton: id => windowButtons.get(id),
    audible: track => trackAudible(state, track),
    // The host's A–B loop in timeline seconds; null loops the whole arrangement.
    setLoopRange(range) {
      loopRange = range && range.end > range.start ? { start: range.start, end: range.end } : null;
      if (loopRange) marker = loopRange.start;
      if (!playing() && loopRange && (position < loopRange.start || position >= loopRange.end)) position = loopRange.start;
      engine?.update(playbackState(), transport()); renderLoopBand();
    },
    // Global speed. Restarts are coalesced while a slider is dragged.
    setRate(value) {
      rate = value; clearTimeout(rateTimer);
      rateTimer = setTimeout(() => engine?.update(playbackState(), transport()), 40);
    },
    bpm: () => state.bpm,
    // Looping assets for patterns, [{ id, name, buffer }]. Missing ones are removed with their clips.
    setPatterns(list) {
      const ids = new Set(list.map(item => item.id));
      for (const [id, asset] of assets) if (asset.pattern && !ids.has(id)) { assets.delete(id); cache.forget(id); }
      state.clips = state.clips.filter(clip => assets.has(clip.asset));
      if (selected && !picked()) selected = null;
      for (const item of list) {
        const asset = assets.get(item.id);
        if (!asset) assets.set(item.id, { id: item.id, name: item.name, buffer: item.buffer, version: 0, pattern: true, loop: true });
        else {
          asset.name = item.name;
          if (asset.buffer !== item.buffer) { cache.forget(item.id); asset.buffer = item.buffer; asset.version++; }
        }
      }
      engine?.update(playbackState(), transport()); prefetchStretches(playbackState(), assets, cache, report); draw();
    },
    // Adds a clip at the bar under the playhead, on the first user track free there.
    place(id) {
      const asset = assets.get(id); if (!asset) return false;
      const bar = 240 / state.bpm, at = Math.floor(now() / bar + 1e-6) * bar, end = at + asset.buffer.duration;
      return commit(() => {
        const free = state.tracks.find(track => !track.stem && !state.clips.some(clip => clip.track === track.id && clip.at < end && clip.at + clipDuration(clip) > at));
        let track = free;
        if (!track && state.tracks.length < LIMITS.tracks) {
          track = { id: uid(), name: `${t('Track', 'Pista')} ${state.tracks.filter(item => !item.stem).length + 1}`, gain: 1, mute: false, solo: false };
          state.tracks.push(track);
        }
        const clip = newClip(asset, (track || state.tracks.find(item => !item.stem) || state.tracks[0]).id, at);
        state.clips.push(clip); pick(clip.id);
      });
    },
    // Channel mix is saved by the host; the arrangement saves tempo and clips.
    // Imported samples are listed by ID and name; the host stores their audio (`samples()`).
    snapshot: () => ({ bpm: state.bpm,
      trackEq: Object.fromEntries(state.tracks.filter(track => track.stem && track.eq).map(track => [track.id, structuredClone(track.eq)])),
      samples: importedSamples().map(asset => ({ id: asset.id, name: asset.name })),
      userTracks: state.tracks.filter(track => !track.stem).map(track => structuredClone(track)),
      clips: state.clips.map(clip => ({ ...clip })) }),
    samples: () => importedSamples().map(asset => ({ id: asset.id, name: asset.name, buffer: asset.buffer })),
    // Stems of a separated clip: one new track per stem, each with a clip in the same place
    // and with the same pitch, speed, fades and direction. The stems are project samples, so
    // they are saved with the separation and undo removes them. `group` puts the tracks
    // under the source track; `muteSource` mutes the separated clip. One undo step.
    addStemTracks({ clip: clipId, sample: sampleId, track: trackId, at: position = 0, stems, group = true, muteSource = true }) {
      const sample = sampleId && assets.get(sampleId);
      const source = sample ? newClip(sample, trackOf(trackId)?.id || state.tracks[0].id, position) : state.clips.find(clip => clip.id === clipId);
      if (!source) throw new Error(t('The separated clip is no longer in the playlist.', 'El clip separado ya no está en la playlist.'));
      if (state.tracks.length + stems.length > LIMITS.tracks) throw new Error(t('Not enough room: the playlist holds up to 16 tracks.', 'No hay lugar: la playlist admite hasta 16 pistas.'));
      const next = new Map(assets), added = stems.map(stem => ({ id: uid(), name: stem.name.slice(0, 160), buffer: stem.buffer, version: 0 }));
      for (const asset of added) next.set(asset.id, asset);
      checkBudget(next);
      const previous = assets;
      const done = commit(() => {
        assets = next;
        const tracks = added.map((asset, index) => ({ id: uid(), name: stems[index].track.slice(0, 160), gain: 1, mute: false, solo: false, color: stems[index].color }));
        const at = group ? state.tracks.findIndex(track => track.id === source.track) + 1 : state.tracks.length;
        state.tracks.splice(at || state.tracks.length, 0, ...tracks);
        const length = source.out - source.in;
        added.forEach((asset, index) => {
          state.clips.push({ ...source, id: uid(), asset: asset.id, track: tracks[index].id, in: 0, out: Math.min(length, asset.buffer.duration), mute: false });
        });
        if (muteSource) for (const clip of state.clips) {
          if (sampleId ? clip.asset === sampleId : clip.id === clipId) clip.mute = true;
        }
      });
      if (!done) { assets = previous; changed(); draw(); }
      return done;
    },
    dispose() {
      exporting?.abort(); metronome.stop(); engine?.dispose(); cache.dispose(); viewObserver.disconnect(); sampleBrowser?.dispose();
      document.removeEventListener('keydown', onWindowKey); cancelAnimationFrame(frame); cancelAnimationFrame(zoomFrame); cancelAnimationFrame(paintFrame); window.removeEventListener('scroll', paintSoon); clearTimeout(rateTimer); ownContext?.close();
    },
  };
}
