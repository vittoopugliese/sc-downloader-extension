import { LIMITS, uid, clamp, emptyArrangement, newClip, clipDuration, clipRate, clipPitch, clipEnvelope, slipClip, resizeClips, crossfadeClips, arrangementEnd, snapTime, splitClip, clipsInRange, validateArrangement, needsStretch, trackAudible, loopSegments, retimeClips } from './stem-playlist-core.mjs';
import { createPlaylistEngine, createStretchCache, prefetchStretches, renderArrangement } from './stem-playlist-audio.mjs';
import { encodeWav } from './stem-audio.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';
import { mountSampleBrowser } from './stem-sample-browser.mjs';
import { wasOpen } from './stem-module-window.mjs';
import { createButton, setButtonContent } from './ui-button.mjs';
import { createMetronome } from './stem-metronome.mjs';
import { createKnob } from './ui-knob.mjs';
import { createDragNumber } from './ui-drag-number.mjs';
import { toast, dismissToast } from './ui-toast.mjs';
import { mountActionDialog } from './stem-action-dialog.mjs';
import { normalizationGain } from './stem-clip-processing.mjs';
import { AUTOMATION_PARAMETERS, newAutomationClip } from './stem-automation.mjs';
import { mountAutomationClip } from './stem-automation-ui.mjs';

const MIN_ZOOM = 8, MAX_ZOOM = 600;
// The workspace header's stem palette; user tracks continue in warm tints.
export const CHANNEL_COLORS = Object.freeze({ original: '#c8c2ba', drums: '#ff8a4c', bass: '#ffb98f', other: '#8c8c8c', vocals: '#ff5500' });
const EXTRA_COLORS = ['#ffd2b3', '#c56a3a', '#e9a27a', '#a39a90', '#ff7a2f', '#d9cfc4'];
// Library entries are colored by group: the session's audio keeps the orange, patterns
// share teal, each set of separated stems shares one color and any other sample has its own.
const GROUP_COLORS = ['#b48cff', '#66d17a', '#ffd166', '#5aa9ff', '#ff5d8f', '#e6a15a', '#9ad4c0', '#d98cd0'];
function groupColors(assets) {
  const colors = new Map(), groups = [];
  for (const asset of assets) {
    if (asset.session) continue;
    if (asset.pattern) { colors.set(asset.id, '#6fc3cf'); continue; }
    const key = asset.group || asset.id;
    if (!groups.includes(key)) groups.push(key);
    colors.set(asset.id, GROUP_COLORS[groups.indexOf(key) % GROUP_COLORS.length]);
  }
  return colors;
}
// Semantic names from the shared icon catalog.
const ICONS = Object.freeze({"pencil": "draw", "select": "select", "undo": "undo", "redo": "redo", "export": "export", "tapTempo": "tap-tempo", "metronome": "metronome", "separate": "layers", "browser": "browser", "addTrack": "add-track", "zoomOut": "zoom-out", "zoomIn": "zoom-in", "fit": "fit", "mute": "mute", "reverse": "reverse", "crossfade": "crossfade", "duplicate": "copy", "slice": "slice", "split": "cut", "trash": "trash", "check": "check", "keepLength": "keep-length", "resample": "resample", "moveTool": "move", "slipTool": "slip", "stretchTool": "stretch", "import": "upload", "tempoLoop": "tempo-loop"});

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
        chip.dataset.scdlTooltip = choice.title ? `${choice.label} — ${choice.title}` : choice.label;
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
    if (item.title) entry.dataset.scdlTooltip = item.title;
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
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(index + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); (e.key === 'Home' ? list[0] : list.at(-1))?.focus(); }
    e.stopPropagation();
  };
  function close() {
    if (openMenu?.menu !== menu) return;
    const inside = menu.contains(document.activeElement);
    openMenu = null; menu.remove();
    // Keyboard focus goes back where it was, so hotkeys (Ctrl+Z after a delete) keep working.
    if (inside && back?.isConnected) back.focus?.({ preventScroll: true });
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
// `inspectorHost` mounts the clip knobs and editing tools elsewhere; `inspectorControls`
// share the library row. Pattern library entries are owned by
// the host: their Duplicate/Delete go through `onPatternAction(action, assetId)`.
// `onSeparate(clip)` adds "Extract stems…" to the menu of every audio clip; the host
// separates it and hands the result back with `addStemTracks`.
export function mountPlaylist({ container, windows = [], windowHome = null, toolbarHost = container, inspectorHost = container, toolbarStart = [], toolbarEnd = [], tempoControls = [], inspectorControls = [], playButton = true, onPatternAction, audio, masterEq, masterFx, masterEffects, channel, onChange, onTransport, onViewChange, onLoopChange, onSelect, onRackSample, onSeparate, getUsedSampleIds }) {
  const es = document.documentElement.lang === 'es', t = (en, spanish) => es ? spanish : en;
  let state = emptyArrangement(), assets = new Map(), selected = null, extra = new Set(), zoom = 48, viewBpm = 120, snap = .5;
  let history = [], future = [], position = 0, ownContext, engine = null, engineIO = null, exporting = null;
  let drag = null, ctrlClick = null, frame, operating = false, liveBefore = null, loopRange = null, marker = 0, rate = 1, rateTimer = 0;
  const isPattern = clip => !!assets.get(clip.asset)?.loop;
  // What the engine and the export hear: one plain clip per pass of a looping clip.
  const playbackState = () => ({ ...state, automation: (state.automation || []).filter(clip => !trackOf(clip.track)?.mute), clips: state.clips.flatMap(clip => {
    const asset = assets.get(clip.asset);
    return asset?.loop ? loopSegments(clip, asset.buffer.duration) : [clip];
  }) });
  // Every loaded sample is available to the rack, even without a playlist clip.
  const importedSamples = () => [...assets.values()].filter(asset => !asset.session && !asset.pattern);
  const rowViews = new Map(), clipViews = new Map(), analyzing = new WeakSet();
  const automationViews = new Map(), actionDialog = mountActionDialog();
  let selectedAutomation = null;
  let paintFrame = 0, dragAudio = 0, shelfKey = '', editMode = 'move', reported = null, slicing = false, slice = null;
  // Channel header width comes from CSS (--pl-head), narrower on phones.
  let TRACK_HEAD = 165;
  let drawSource = null, timeSelection = null, clipboard = null, activeTrack = null, selecting = false;
  let showUnusedSamples = false;
  const node = (tag, className = '', text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };
  const button = (text, title, action) => { const e = node('button', '', text); e.type = 'button'; e.dataset.scdlTooltip = title; e.setAttribute('aria-label', title); e.onclick = action; return e; };
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
    selectedAutomation = null;
    selected = id; extra.clear(); timeSelection = null;
    const clip = picked();
    if (clip) { drawSource = { ...clip }; activeTrack = clip.track; }
  };
  const copy = () => structuredClone({ ...state, sampleIds: [...assets.values()].filter(asset => !asset.pattern).map(asset => asset.id) });
  const trackOf = id => state.tracks.find(track => track.id === id);
  const color = track => CHANNEL_COLORS[track?.stem] || track?.color || EXTRA_COLORS[Math.max(0, state.tracks.filter(item => !item.stem).indexOf(track)) % EXTRA_COLORS.length];
  const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  const now = () => engine?.now() ?? position;
  const playing = () => !!engine?.playing();
  const transport = () => ({ rate, loop: loopRange || (arrangementEnd(state) ? { start: 0, end: arrangementEnd(state) } : null) });
  // Stretched clips render in a worker; their clips show a striped overlay until ready
  // and a spinner in the library row says work is running, without moving the layout.
  // The host's tasks (a stem separation) use the same spinner through setTask.
  const stretchStatus = t('Stretching clips…', 'Estirando clips…');
  const busy = node('span', 'pl-busy'); busy.hidden = true; busy.setAttribute('role', 'status');
  let task = '';
  function renderBusy() {
    const label = task || stretchStatus;
    busy.hidden = !task && !cache.busy(); busy.dataset.scdlTooltip = label; busy.setAttribute('aria-label', label);
  }
  const stretching = clip => needsStretch(clip) && !cache.has(clip, assets.get(clip.asset));
  const cache = createStretchCache({ onChange() {
    for (const item of grid.querySelectorAll('.pl-clip')) {
      const clip = state.clips.find(c => c.id === item.dataset.clip);
      item.classList.toggle('is-stretching', !!clip && stretching(clip));
    }
    renderBusy();
  } });
  renderBusy();
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
    control.dataset.scdlTooltip = `${name} (${key})${detail ? ': ' + detail : ''}`;
    control.setAttribute('aria-keyshortcuts', key.replace('Ctrl', 'Control').replace('Del', 'Delete').replace('Supr', 'Delete'));
    control.classList.add('pl-key'); control.style.setProperty('--key-color', color);
    for (const combo of keys) hotkeys.set(combo, { control, repeat });
    return control;
  }
  const play = playButton ? button('', t('Play / pause (Space)', 'Reproducir / pausar (Espacio)'), safe(toggle)) : null;
  if (play) { play.append(globalThis.SCIcons.create('play')); play.className = 'pl-play'; play.setAttribute('aria-pressed', 'false'); }
  const time = node('output', 'pl-time', '0:00.00'); time.dataset.scdlTooltip = t('Playhead position (minutes:seconds)', 'Posición del cursor (minutos:segundos)');
  // BPM is a whole number you drag up or down, like FL Studio's tempo display. The clips follow
  // live while it moves; one drag, wheel spin or key run is one undo step. Like FL Studio,
  // clips, loop, marker and playhead keep their bar, and the grid keeps its size on screen.
  // `keepTime` (tempo from an A–B loop) leaves unlocked audio and the loop in seconds.
  let tempoUndo = null;
  function setTempo(bpm, { keepTime = false } = {}) {
    bpm = clamp(Math.round(bpm), 20, 300);
    if (bpm === state.bpm) return;
    const before = copy(), factor = state.bpm / bpm;
    try { retimeClips(state, bpm, isPattern, { moveAudio: !keepTime }); validateArrangement(state, assets); }
    catch { state = before; report(t('That tempo exceeds the 5-minute arrangement or 0.25–4× clip speed limit.', 'Ese tempo supera el límite de 5 minutos del arreglo o de velocidad de los clips (0,25–4×).')); draw(); return; }
    if (!tempoUndo || history.at(-1) !== tempoUndo) {
      history.push(before); if (history.length > 50) history.shift(); future = []; pruneGraveyard(); tempoUndo = history.at(-1);
    }
    if (!keepTime) followTempo(factor);
    changed(); draw();
  }
  // Timeline marks that live outside the arrangement follow their bar too. While playing,
  // playback continues from the same bar.
  function followTempo(factor) {
    const at = seconds => clamp(seconds * factor, 0, LIMITS.seconds);
    marker = at(marker);
    if (timeSelection) timeSelection = { ...timeSelection, start: at(timeSelection.start), end: at(timeSelection.end) };
    if (loopRange) { loopRange = { start: at(loopRange.start), end: at(loopRange.end) }; onLoopChange?.(loopRange); }
    if (playing()) { position = at(engine.now() ?? position); engine.play(playbackState(), position, transport(), true); startMetronome(); }
    else position = at(position);
  }
  const tempo = createDragNumber({ label: 'BPM', min: 20, max: 300, value: 120, className: 'pl-field',
    hint: t('drag up or down (Shift for fine), or use the wheel or the arrows. Project tempo: grid, channel rack and piano roll. Every clip keeps its bar and the grid keeps its size. Clips stretched to the grid also keep their length, in their pitch mode; other audio keeps its speed. The speed slider next to it changes everything.', 'arrastrá arriba o abajo (Shift para fino), o usá la rueda o las flechas. Tempo del proyecto: grilla, channel rack y piano roll. Cada clip queda en su compás y la grilla mantiene su tamaño. Los clips estirados a la grilla también mantienen su largo, en su modo de pitch; el resto del audio mantiene su velocidad. El slider de velocidad al lado cambia todo.'),
    onInput: setTempo, onEnd: () => { tempoUndo = null; } });
  function changeLoop(range) {
    loopRange = range; if (range) marker = range.start;
    engine?.update(playbackState(), transport()); renderLoopBand();
    onLoopChange?.(range);
  }
  // Tap tempo like FL Studio's tapper: BPM is the average of every interval since the first tap;
  // a pause longer than two beats (3 s minimum) starts over. One tap session is one undo step.
  let taps = [], tapTimer = 0;
  const tapButton = iconButton(ICONS.tapTempo, t('Tap tempo (T): tap along with the beat and the BPM follows the average; pause to start over', 'Tap tempo (T): tocá al ritmo y el BPM sigue el promedio; una pausa reinicia'), () => {});
  tapButton.classList.add('pl-tap');
  const tapInterval = () => taps.length > 1 ? (taps.at(-1) - taps[0]) / (taps.length - 1) : 0;
  const tapWait = () => Math.max(3000, tapInterval() * 2);
  function tapTempo() {
    const at = performance.now();
    if (!taps.length || at - taps.at(-1) > tapWait()) { taps = []; tempoUndo = null; }
    taps.push(at); if (taps.length > 16) taps.shift();
    const wait = tapWait();
    tapButton.style.setProperty('--tap-wait', wait + 'ms');
    tapButton.classList.remove('is-waiting'); void tapButton.offsetWidth; tapButton.classList.add('is-waiting');
    clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = []; tempoUndo = null; tapButton.classList.remove('is-waiting'); }, wait);
    if (taps.length < 2) return;
    setTempo(60000 / tapInterval());
  }
  tapButton.onpointerdown = event => { if (event.button === 0) { event.preventDefault(); tapTempo(); } };
  tapButton.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) tapTempo(); } };
  // The A–B loop is 1, 2, 4 or 8 bars; the tempo closest to 120 BPM wins.
  const fitTempo = createButton({ icon: ICONS.tempoLoop, variant: 'neutral', title: t('Tempo from loop: drag a loop on the ruler first; the BPM is set so it lasts 1, 2, 4 or 8 bars', 'Tempo desde el loop: primero arrastrá un loop en la regla; el BPM se ajusta para que dure 1, 2, 4 u 8 compases'), onClick: () => {
    if (!loopRange) { report(t('Select a loop on the ruler first.', 'Primero seleccioná un loop en la regla.')); return; }
    const seconds = loopRange.end - loopRange.start;
    const bpm = [1, 2, 4, 8].map(bars => bars * 240 / seconds).filter(value => value >= 20 && value <= 300)
      .sort((a, b) => Math.abs(a - 120) - Math.abs(b - 120))[0];
    if (!bpm) { report(t('The loop is outside the 20–300 BPM range.', 'El loop queda fuera del rango 20–300 BPM.')); return; }
    tempoUndo = null; setTempo(bpm, { keepTime: true }); tempoUndo = null;
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
  // Grid, like FL Studio's snap: clips, edges, cuts, selections, drops and the ruler (marker
  // and loop) stick to it. Each click goes 1/8 → 1/16 → off; holding Alt places freely.
  // The icon shows the value: big squares for 1/8, a fine grid for 1/16, a free line for off.
  const GRIDS = [[.5, '1/8', 'grid-coarse'], [.25, '1/16', 'grid-fine'], [0, t('Free', 'Libre'), 'grid-free']];
  const gridButton = toolButton({ icon: '', name: t('Grid', 'Grilla'), key: 'G', keys: ['g'], color: '#9ad4c0' }, () => {
    snap = GRIDS[(GRIDS.findIndex(([value]) => value === snap) + 1) % GRIDS.length][0]; renderGrid(); draw();
  });
  gridButton.classList.add('pl-grid-snap');
  function renderGrid() {
    const [, label, icon] = GRIDS.find(([value]) => value === snap);
    setButtonContent(gridButton, { icon }); gridButton.setAttribute('aria-pressed', String(!!snap));
    gridButton.setAttribute('aria-label', `${t('Grid', 'Grilla')}: ${label}`);
    gridButton.dataset.scdlTooltip = `${t('Grid', 'Grilla')}: ${label} (G): ${t('click to switch 1/8 → 1/16 → free. Clips, edges, cuts, selections and the ruler stick to it; hold Alt while dragging to place freely.', 'clic para alternar 1/8 → 1/16 → libre. Clips, bordes, cortes, selecciones y la regla se pegan a ella; mantené Alt al arrastrar para moverte libre.')}`;
  }
  renderGrid();
  // A tool controls the gesture; the selected clip owns its audio algorithm.
  const slipButton = toolButton({ icon: ICONS.slipTool, name: t('Slip content', 'Deslizar audio'), key: '2', keys: ['2'], color: '#ffd166',
    detail: t('move audio inside its clip, keeping the timeline edges fixed; P returns to move / trim', 'mové el audio dentro del clip sin desplazar sus bordes; P vuelve a mover / recortar') }, () => setTool('slip'));
  slipButton.classList.add('pl-slip-tool');
  const fadeButton = toolButton({ icon: 'fade-in', name: t('Fade tool', 'Editar fades'), key: '6', keys: ['6'], color: '#66d1c1',
    detail: t('drag the start or end inward to fade the selected clips; drag the fade handles to adjust, double-click to reset; Esc cancels a drag', 'arrastrá el inicio o el final hacia adentro para aplicar fades a los clips seleccionados; ajustá con las marcas, doble clic para resetear; Esc cancela el arrastre') }, () => setTool('fade'));
  fadeButton.classList.add('pl-fade-tool');
  const stretchEdgeButton = toolButton({ icon: ICONS.stretchTool, name: t('Stretch edge', 'Estirar borde'), key: '3', keys: ['3', 'e'], color: '#ffd166',
    detail: t('drag either edge to stretch all selected clips with snap, using each clip’s Stretch / Resample setting; enables Follow tempo', 'arrastrá un borde para estirar todos los clips seleccionados con snap y el ajuste Stretch / Resample de cada clip; activa Seguir tempo') }, () => setTool('stretch'));
  stretchEdgeButton.classList.add('pl-stretch-tool');
  const fileInput = node('input'); fileInput.type = 'file'; fileInput.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.ogg'; fileInput.multiple = true; fileInput.hidden = true;
  fileInput.onchange = safe(async () => { const files = [...fileInput.files]; fileInput.value = ''; await importSamples(files); });
  const importButton = toolButton({ icon: ICONS.import, name: t('Import audio files', 'Importar archivos de audio'), key: 'I', keys: ['i'], color: '#ff7a2f',
    detail: t('WAV, MP3, FLAC, M4A or OGG land at the playhead on the first free track. You can also drop them on a track.', 'WAV, MP3, FLAC, M4A u OGG se agregan en el cursor, en la primera pista libre. También podés soltarlos sobre una pista.') }, () => fileInput.click());
  // Sample browser (F8, or B on the Playlist): a tool window that docks into `windowHome`
  // like the others. Created on first use, or on load when it was left open; its drops go
  // through importSamples. It leads the orange window buttons of the transport bar; the host
  // adds the others with `windows`.
  let sampleBrowser = null, disposed = false;
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
    toggle(control) { ensureBrowser().toggle(control); } });
  function ensureBrowser() {
    return sampleBrowser ||= mountSampleBrowser({ t, home: windowHome, onToggle: open => browserButton.setAttribute('aria-pressed', String(open)),
      importToRack: items => importSamples(items, null),
      async importSamples(items) { try { return await importSamples(items); } catch (error) { report(error); return false; } } });
  }
  if (wasOpen('browser')) queueMicrotask(() => { if (!disposed) ensureBrowser(); });
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
  exportButton.dataset.scdlTooltip = t('Export WAV: renders the whole playlist (or the A–B loop) with mute, solo, volume, FXs and EQ into a stereo WAV file', 'Exportar WAV: renderiza toda la playlist (o el loop A–B) con mute, solo, volumen, FXs y EQ en un WAV estéreo');
  // Slice tool, like FL Studio's: a click cuts the clip under the mouse; dragging up or down
  // cuts every lane the line crosses.
  const sliceButton = toolButton({ icon: ICONS.slice, name: t('Slice tool', 'Herramienta de corte'), key: 'C', keys: ['c'], color: '#ff5d8f',
    detail: t('click a clip to cut it at the mouse; drag up or down to cut several tracks at once · cuts follow the grid; Alt cuts freely · Esc exits', 'hacé clic en un clip para cortarlo donde está el mouse; arrastrá hacia arriba o abajo para cortar varias pistas a la vez · los cortes siguen la grilla; Alt corta libre · Esc sale') }, () => setTool(slicing ? 'draw' : 'slice'));
  sliceButton.setAttribute('aria-pressed', 'false');
  const pencilButton = toolButton({ icon: ICONS.pencil, name: t('Draw tool', 'Lápiz'), key: 'P / 1', keys: ['p', '1'], color: '#ffad80',
    detail: t('select a sample or clip, then click empty grid space to place it; drag to select a time range; drag a selected clip or its edges to move or trim the whole group', 'seleccioná un sample o clip y hacé clic en la grilla vacía para colocarlo; arrastrá para seleccionar un rango; arrastrá un clip seleccionado o sus bordes para mover o recortar todo el grupo') }, () => setTool('draw'));
  const selectButton = toolButton({ icon: ICONS.select, name: t('Time selection tool', 'Seleccionar rango'), key: 'Q', keys: ['q'], color: '#ffd166',
    detail: t('drag across tracks to select time, including silence; Ctrl+C/V copies/pastes, Ctrl+D repeats the whole range', 'arrastrá sobre las pistas para seleccionar tiempo, incluido el silencio; Ctrl+C/V copia/pega, Ctrl+D repite el rango completo') }, () => setTool('select'));
  function setTool(tool) {
    drag?.cancel();
    editMode = ['slip', 'stretch', 'fade'].includes(tool) ? tool : 'move';
    selecting = tool === 'select'; setSlicing(tool === 'slice');
  }
  function setSlicing(on) {
    if (on) selecting = false;
    slicing = on; slice = null; sliceLine.hidden = true;
    sliceButton.setAttribute('aria-pressed', String(on)); container.classList.toggle('is-slicing', on);
    pencilButton.setAttribute('aria-pressed', String(!on && !selecting && editMode === 'move')); selectButton.setAttribute('aria-pressed', String(selecting));
    slipButton.setAttribute('aria-pressed', String(!on && !selecting && editMode === 'slip'));
    stretchEdgeButton.setAttribute('aria-pressed', String(!on && !selecting && editMode === 'stretch'));
    fadeButton.setAttribute('aria-pressed', String(!on && !selecting && editMode === 'fade'));
    container.classList.toggle('is-fading', !on && !selecting && editMode === 'fade');
    container.classList.toggle('is-drawing', !on && !selecting && editMode === 'move'); container.classList.toggle('is-selecting', selecting);
    container.classList.toggle('is-slipping', !on && !selecting && editMode === 'slip'); container.classList.toggle('is-stretch-tool', !on && !selecting && editMode === 'stretch');
    paintSoon();
  }
  const help = iconButton('help', t('Playlist shortcuts', 'Atajos de la playlist'), () => showHint(), { variant: 'ghost' });
  toolbar.append(...toolbarStart, ...[play, time].filter(Boolean), tempo.wrap, tapButton, metronomeButton, fitTempo, ...tempoControls, node('span', 'pl-spacer'), help, ...toolbarEnd, windowGroup, exportButton, fileInput);
  const shelf = node('div', 'pl-shelf'); shelf.setAttribute('aria-label', t('Sample library', 'Biblioteca de samples'));
  shelf.dataset.scdlTooltip = t('Library: click to select for drawing, double-click to add at the cursor, drag onto a track. Right-click for more.', 'Biblioteca: clic para elegir qué dibujar, doble clic para agregar en el cursor, arrastrá a una pista. Clic derecho para más.');
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
  ruler.dataset.scdlTooltip = t('Drag on the ruler to create a loop · drag inside the selection to move it · drag its edges to resize · double-click to clear (without a loop: play from the start) · click to seek · follows the grid; hold Alt to place freely.', 'Arrastrá en la regla para crear un loop · arrastrá dentro de la selección para moverla · arrastrá sus bordes para ajustar · doble clic para eliminar (sin loop: reproduce desde el inicio) · clic para mover el cursor · sigue la grilla; mantené Alt para moverte libre.');
  ruler.setAttribute('aria-label', ruler.dataset.scdlTooltip);
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
    const at = snapAt(rulerTime(event), event.altKey), from = snapAt(loopDrag.at, event.altKey);
    const before = loopDrag.before;
    loopDrag.moved = true;
    if (kind === 'move') {
      const span = before.end - before.start, start = clamp(snapAt(before.start + rulerTime(event) - loopDrag.at, event.altKey), 0, LIMITS.seconds - span);
      changeLoop({ start, end: start + span });
    } else if (kind === 'start') changeLoop({ start: clamp(at, 0, before.end - .01), end: before.end });
    else if (kind === 'end') changeLoop({ start: before.start, end: clamp(at, before.start + .01, LIMITS.seconds) });
    else if (Math.abs(at - from) >= .01) changeLoop({ start: Math.min(at, from), end: Math.max(at, from) });
  };
  ruler.onpointerup = event => { if (loopDrag?.id !== event.pointerId) return; if (!loopDrag.moved) { seek(snapAt(rulerTime(event), event.altKey)); marker = position; renderLoopBand(); } loopDrag = null; ruler.releasePointerCapture(event.pointerId); };
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
  const sliceTime = event => snapAt((event.clientX - lanes()[0].getBoundingClientRect().left) / zoom, event.altKey);
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
  const inspector = node('div', 'pl-inspector pl-ui');
  const setClip = (key, value) => commit(() => {
    for (const clip of chosen()) clip[key] = value;
  });
  // One per-clip toggle: on is Stretch, off is Resample. A mixed selection
  // switches to Stretch on the next click. Every change is one undo step.
  const setPitchMode = keepLength => {
    if (chosen().some(clip => clip.keepLength !== keepLength)) setClip('keepLength', keepLength);
  };
  const stretchModeButton = toolButton({ icon: 'clip-stretch', name: 'Stretch', key: 'H', keys: ['h'], color: '#b48cff' },
    () => setPitchMode(!chosen().every(clip => clip.keepLength)));
  stretchModeButton.classList.add('pl-pitch-mode');
  stretchModeButton.setAttribute('aria-keyshortcuts', 'H 4 5');
  for (const [key, keepLength] of [['4', true], ['5', false]]) hotkeys.set(key, { control: stretchModeButton, action: () => setPitchMode(keepLength) });
  function renderPitchMode() {
    const clips = chosen(), mixed = clips.some(clip => clip.keepLength !== clips[0].keepLength);
    const active = !!clips.length && clips.every(clip => clip.keepLength);
    const mode = !clips.length ? t('select a clip', 'seleccioná un clip') : mixed ? t('Mixed — click to enable Stretch for all selected clips', 'Mixto — clic para activar Stretch en todos los clips seleccionados') : active ? t('On — Stretch', 'Activado — Stretch') : t('Off — Resample', 'Desactivado — Resample');
    stretchModeButton.disabled = !clips.length;
    stretchModeButton.dataset.mode = !clips.length ? '' : mixed ? 'mixed' : active ? 'stretch' : 'resample';
    stretchModeButton.setAttribute('aria-pressed', mixed ? 'mixed' : String(active));
    stretchModeButton.dataset.scdlTooltip = `Stretch (H) · ${mode} · ${t('On: pitch and speed stay independent. Off: they change together. Applies to selected clips. 4: on · 5: off.', 'Activado: pitch y velocidad independientes. Desactivado: cambian juntos. Se aplica a los clips seleccionados. 4: activar · 5: desactivar.')}`;
  }
  const signed = v => `${v > 0 ? '+' : ''}${Number(v.toFixed(2))}`;
  const resetHint = t('drag, or double-click to reset', 'arrastrá, o doble clic para resetear');
  // Clip volume sits before the track volume: the track knob is the channel's master.
  const clipVolume = createKnob({ label: t('Volume', 'Volumen'), min: 0, max: 200, step: 1, coarse: 10, value: 100, reset: 100, hint: `${t('volume of this clip only; the track volume still applies on top', 'volumen solo de este clip; el volumen de la pista se aplica encima')} · ${resetHint}`, format: v => `${v}%`, onCommit: v => setClip('gain', v / 100) });
  const pitch = createKnob({ label: 'Pitch', min: -24, max: 24, step: 1, coarse: 12, value: 0, reset: 0, hint: `${t('transposes the clip in semitones', 'transpone el clip en semitonos')} · ${resetHint}`, format: v => `${signed(v)} st`, onCommit: v => setClip('pitch', v) });
  const fine = createKnob({ label: t('Fine pitch', 'Pitch fino'), min: -100, max: 100, step: 1, coarse: 10, value: 0, reset: 0, hint: `${t('fine tuning in cents (100 = 1 semitone)', 'afinación fina en cents (100 = 1 semitono)')} · ${resetHint}`, format: v => `${signed(v)} ct`, onCommit: v => setClip('cents', v) });
  const speed = createKnob({ label: t('Speed', 'Velocidad'), min: .25, max: 4, step: .01, coarse: .25, value: 1, reset: 1, log: true, hint: `${t('speed of this clip only', 'velocidad solo de este clip')} · ${resetHint}`, format: v => `${v.toFixed(2)}×`, onCommit: v => setClip('speed', v) });
  const normalizeButton = iconButton('waveform', t('Normalize audio', 'Normalizar audio'), () => {
    const enable = !chosen().every(clip => clip.normalizationGain !== undefined);
    commit(() => { for (const clip of chosen()) { if (enable) clip.normalizationGain = normalizationGain(assets.get(clip.asset).buffer); else delete clip.normalizationGain; } });
  });
  normalizeButton.classList.add('pl-normalize');
  normalizeButton.dataset.scdlTooltip = t('Normalize: source peak to −1 dBFS, preserving stereo balance. Reversible; volume and effects apply afterwards.', 'Normalizar: pico del sample a −1 dBFS conservando el balance estéreo. Reversible; volumen y efectos se aplican después.');
  const followTempoButton = iconButton('tempo-loop', t('Follow tempo', 'Seguir tempo'), () => setClip('tempoLock', !chosen().every(clip => clip.tempoLock)));
  followTempoButton.classList.add('pl-follow-tempo');
  followTempoButton.dataset.scdlTooltip = t('Follow tempo: anchor this clip to the current BPM and keep its length in beats when BPM changes. Does not detect the sample tempo.', 'Seguir tempo: vincula el clip al BPM actual y conserva su duración en tiempos al cambiar el BPM. No detecta el tempo del sample.');
  const clipOptions = node('div', 'pl-clip-options');
  clipOptions.setAttribute('role', 'group'); clipOptions.setAttribute('aria-label', t('Clip options', 'Opciones del clip'));
  clipOptions.append(stretchModeButton, normalizeButton, followTempoButton);
  const muteClip = toolButton({ icon: ICONS.mute, name: t('Mute clip', 'Silenciar clip'), key: 'M', keys: ['m'], color: '#9aa3ad', detail: t('silences only the selected clips; the track keeps playing', 'calla solo los clips seleccionados; la pista sigue sonando') }, () => setClip('mute', !picked()?.mute));
  const reverseClip = toolButton({ icon: ICONS.reverse, name: t('Reverse', 'Invertir'), key: 'R', keys: ['r'], color: '#b48cff', detail: t('plays the selected clips backwards', 'reproduce los clips seleccionados al revés') }, () => setClip('reverse', !picked()?.reverse));
  const crossfade = toolButton({ icon: ICONS.crossfade, name: t('Crossfade overlaps', 'Fundir superposiciones'), key: 'X', keys: ['x'], color: '#4fc3f7', detail: t('fades clips that overlap on the same track so the joins do not click', 'aplica fundidos a los clips que se pisan en la misma pista para que los cortes no hagan clic') }, () => commit(() => crossfadeClips(state.clips)));
  const duplicate = toolButton({ icon: ICONS.duplicate, name: t('Duplicate', 'Duplicar'), key: 'Ctrl+D', keys: ['ctrl+d'], color: '#66d17a', detail: t('repeats selected clips or the whole time range, including silence', 'repite los clips o el rango completo seleccionado, incluido el silencio') }, () => {
    if (selectedAutomation) { duplicateAutomation(selectedAutomation); return; }
    const selection = captureSelection(); if (selection) pasteSelection(selection, selection.end);
  });
  const split = toolButton({ icon: ICONS.split, name: t('Split at cursor', 'Cortar en cursor'), key: 'S', keys: ['s'], color: '#ffb02e', detail: t('cuts every selected clip at the playhead. Ctrl/Shift+click clips, or drag on empty space, to select several.', 'corta todos los clips seleccionados en la posición del cursor. Ctrl/Shift+clic en los clips, o arrastrá en un espacio vacío, para seleccionar varios.') }, () => cutClips(chosen(), now()));
  const remove = toolButton({ icon: ICONS.trash, name: t('Remove from playlist', 'Quitar de la playlist'), key: t('Del', 'Supr'), keys: ['delete', 'backspace'], color: '#ff4d4d', detail: t('removes the selected clips from the song; the sample stays in the library and the track keeps it as its instrument', 'quita los clips seleccionados de la canción; el sample queda en la biblioteca y la pista lo conserva como instrumento') }, () => commit(() => {
    if (selectedAutomation) state.automation = state.automation.filter(clip => clip.id !== selectedAutomation);
    else state.clips = state.clips.filter(c => !isChosen(c.id)); pick(null);
  }));
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
  // Right-click menus contain clip actions; stretch settings live beside the knobs. Library
  // entries can be duplicated or deleted. Session audio (the stems) stays in the library.
  // FL-style right click on the clip body: removes it, or the whole selection when it is part of it.
  function eraseClip(clip) {
    if (isChosen(clip.id)) { remove.click(); return; }
    commit(() => { state.clips = state.clips.filter(c => c.id !== clip.id); });
  }
  function clipMenu(event, clip) {
    if (!isChosen(clip.id)) pick(clip.id); else if (clip.id !== selected) { extra.delete(clip.id); extra.add(selected); selected = clip.id; }
    updateSelection();
    contextMenu(event, [
      { label: t('Duplicate', 'Duplicar'), icon: ICONS.duplicate, shortcut: 'Ctrl+D', action: () => duplicate.click() },
      { label: t('Split at cursor', 'Cortar en cursor'), icon: ICONS.split, shortcut: 'S', action: () => split.click() },
      { label: t('Mute clip', 'Silenciar clip'), icon: ICONS.mute, shortcut: 'M', checked: !!clip.mute, action: () => muteClip.click() },
      { label: t('Reverse', 'Invertir'), icon: ICONS.reverse, shortcut: 'R', checked: !!clip.reverse, action: () => reverseClip.click() },
      { label: t('Normalize audio', 'Normalizar audio'), icon: 'waveform', checked: clip.normalizationGain !== undefined, action: () => normalizeButton.click() },
      ...(onSeparate && !isPattern(clip) ? [{ label: t('Extract stems…', 'Separar stems…'), icon: ICONS.separate,
        title: t('Split this sample into drums, bass, other and vocals tracks, like FL Studio', 'Separa este sample en pistas de batería, bajo, otros y voz, como en FL Studio'),
        action: () => onSeparate(separable(clip)) }] : []),
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
        const next = new Map(assets), copyOf = { id: uid(), name: uniqueName(asset.name), buffer: asset.buffer, version: 0, ...(asset.group ? { group: asset.group } : {}) };
        next.set(copyOf.id, copyOf); checkBudget(next); commit(() => { assets = next; });
      }) },
      { label: t('Check unused sounds', 'Revisar sonidos sin uso'), icon: ICONS.select, action: () => {
        showUnusedSamples = true;
        const count = refreshSampleUsage();
        report(count ? t(`${count} unused sounds marked in the sample library.`, `${count} sonidos sin uso marcados en la biblioteca de samples.`)
          : t('All sounds are in use.', 'Todos los sonidos están en uso.'), 'success');
      } },
      { label: asset.pattern ? t('Delete', 'Eliminar') : t('Delete from project', 'Eliminar del proyecto'), icon: ICONS.trash, danger: true,
        title: t('Deletes this audio and its clips from the project, including original stems. Asks before deleting.', 'Elimina este audio y sus clips del proyecto, incluidos los stems originales. Pide confirmación.'), action: safe(async () => {
        if (asset.pattern) { onPatternAction?.('delete', asset.id); return; }
        if (await confirmDelete(asset.name)) mutateAssets(() => { removeAsset(asset.id); ensureAudioLane(); pick(null); });
      }) },
    ]);
  }
  function refreshSampleUsage() {
    if (!showUnusedSamples) {
      for (const item of shelf.children) { item.classList.remove('is-unused'); item.removeAttribute('aria-description'); item.querySelector('.pl-unused-label')?.remove(); }
      return 0;
    }
    const used = new Set(getUsedSampleIds?.() || []);
    for (const clip of state.clips) used.add(clip.asset);
    for (const track of state.tracks) { const source = trackSource(track.id); if (source) used.add(source.id); }
    let count = 0;
    for (const item of shelf.children) {
      const asset = assets.get(item.dataset.asset), unused = !!asset && !asset.pattern && !used.has(asset.id);
      item.classList.toggle('is-unused', unused);
      if (unused) item.setAttribute('aria-description', t('Unused sound', 'Sonido sin uso')); else item.removeAttribute('aria-description');
      const badge = item.querySelector('.pl-unused-label');
      if (unused) {
        count++;
        if (!badge) item.append(node('span', 'pl-unused-label', t('Unused', 'Sin uso')));
      } else badge?.remove();
    }
    return count;
  }
  function createAutomation(target, { name, value } = {}) {
    const spec = AUTOMATION_PARAMETERS[target?.param], targetTrack = trackOf(target?.track);
    if (!spec?.supported || target.track !== 'master' && (!targetTrack || targetTrack.kind === 'automation')) return false;
    if (target.track === 'master' && target.param === 'gain') return false;
    const start = timeSelection?.start ?? 0, end = timeSelection?.end ?? Math.max(arrangementEnd(state), 240 / state.bpm);
    const existing = state.automation?.find(clip => clip.target.track === target.track && clip.target.param === target.param);
    const lane = existing && trackOf(existing.track);
    if (!lane && state.tracks.length >= LIMITS.tracks) { report(t('No room for an automation lane (16 channels maximum).', 'No hay lugar para un carril de automatización (máximo 16 canales).')); return false; }
    const parameterName = target.param === 'gain' ? t('Volume', 'Volumen') : spec.label;
    const label = name || `${targetTrack?.name || 'Master'} · ${parameterName}`;
    const baseline = value ?? (target.param === 'gain' ? targetTrack.gain : (target.track === 'master' ? masterFx?.() : targetTrack.fx)?.[target.param.slice(3)]) ?? spec.default;
    const done = commit(() => {
      const track = lane || { id: uid(), kind: 'automation', name: label.slice(0, 160), gain: 1, mute: false, solo: false, color: '#6fc3cf' };
      if (!lane) state.tracks.push(track);
      const clip = newAutomationClip({ track: track.id, target, at: start, duration: Math.max(.01, end - start), value: baseline });
      clip.name = label.slice(0, 160); state.automation ||= []; state.automation.push(clip);
      pick(null); selectedAutomation = clip.id; activeTrack = track.id;
    });
    if (done) { setTool('draw'); rowViews.get(activeTrack)?.lane.scrollIntoView({ block: 'nearest' }); }
    return done;
  }
  function selectAutomation(id) { pick(null); selectedAutomation = id; activeTrack = state.automation.find(clip => clip.id === id)?.track; updateSelection(); }
  function duplicateAutomation(id, at) {
    const source = state.automation.find(clip => clip.id === id); if (!source) return;
    commit(() => {
      const clip = { ...structuredClone(source), id: uid(), at: at ?? source.at + source.duration };
      state.automation.push(clip); selectAutomation(clip.id);
    });
  }
  function automationMenu(event, id) {
    const clip = state.automation.find(clip => clip.id === id); if (!clip) return;
    selectAutomation(id);
    contextMenu(event, [
      { label: t('Duplicate', 'Duplicar'), icon: ICONS.duplicate, shortcut: 'Ctrl+D', action: () => duplicateAutomation(id) },
      { label: t('Mute clip', 'Silenciar clip'), icon: ICONS.mute, checked: !!clip.mute, action: () => commit(() => { clip.mute = !clip.mute; }) },
      { label: t('Delete automation clip', 'Eliminar clip de automatización'), icon: ICONS.trash, danger: true, action: () => remove.click() },
    ]);
  }
  function automationElement(clip) {
    const element = node('div', 'pl-automation-clip'); element.dataset.automation = clip.id;
    element.tabIndex = 0; element.setAttribute('role', 'group');
    const title = node('span', 'pl-automation-title'); element.append(title);
    let before = null;
    const editor = mountAutomationClip({ element, clip, zoom, height: 44,
      snap: seconds => snapAt(seconds), onSelect: () => selectAutomation(clip.id), onContextMenu: contextMenu,
      onBegin: () => { before = copy(); },
      onChange: next => { const index = state.automation.findIndex(item => item.id === clip.id); if (index >= 0) state.automation[index] = next; engine?.update(playbackState(), transport()); },
      onCommit: next => { const original = before; before = null; commit(() => { const index = state.automation.findIndex(item => item.id === clip.id); if (index >= 0) state.automation[index] = next; }, original || copy()); },
      onCancel: () => { if (before) { state = before; before = null; changed(); draw(); } },
    });
    for (const edge of ['left', 'right']) { const handle = node('span', `pl-edge pl-edge-${edge}`); handle.dataset.edge = edge; element.append(handle); }
    element.oncontextmenu = event => { if (!event.defaultPrevented) automationMenu(event, clip.id); };
    element.onpointerdown = event => {
      if (event.button !== 0 || event.target.closest('.pl-automation-envelope')) return;
      const current = state.automation.find(item => item.id === clip.id); if (!current) return;
      event.preventDefault(); event.stopPropagation(); selectAutomation(clip.id); element.focus({ preventScroll: true });
      const snapshot = copy(), initial = structuredClone(current), edge = event.target.dataset.edge;
      const from = event.clientX, initialScroll = scroll.scrollLeft;
      let moved = false;
      element.setPointerCapture(event.pointerId);
      element.onpointermove = move => {
        const delta = (move.clientX - from + scroll.scrollLeft - initialScroll) / zoom;
        if (!moved && Math.abs(delta * zoom) < 2) return;
        moved = true;
        if (edge) {
          const right = initial.at + initial.duration;
          current.at = edge === 'left' ? clamp(snapAt(initial.at + delta, move.altKey), 0, right - .01) : initial.at;
          current.duration = edge === 'right' ? clamp(snapAt(right + delta, move.altKey) - initial.at, .01, LIMITS.seconds - initial.at) : right - current.at;
          current.points = initial.points.map(point => ({ ...point, at: point.at * current.duration / initial.duration }));
        } else current.at = clamp(snapAt(initial.at + delta, move.altKey), 0, LIMITS.seconds - current.duration);
        updateAutomationView({ element, title, editor }, current); engine?.update(playbackState(), transport());
      };
      const finish = cancel => {
        element.onpointermove = element.onpointerup = element.onpointercancel = element.onlostpointercapture = null;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        if (cancel) { state = snapshot; changed(); draw(); }
        else if (moved) commit(() => {}, snapshot);
      };
      element.onpointerup = () => finish(false); element.onpointercancel = element.onlostpointercapture = () => finish(true);
    };
    element.onkeydown = event => {
      if (event.defaultPrevented || event.target !== element) return;
      if (event.key === 'Enter') { selectAutomation(clip.id); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); selectAutomation(clip.id);
      commit(() => { const current = state.automation.find(item => item.id === clip.id); current.at = clamp(current.at + (event.key === 'ArrowLeft' ? -1 : 1) * 60 / state.bpm * (snap || .25), 0, LIMITS.seconds - current.duration); });
    };
    return { element, title, editor };
  }
  function updateAutomationView(view, clip) {
    view.title.textContent = clip.name || `${trackOf(clip.target.track)?.name || 'Master'} · ${AUTOMATION_PARAMETERS[clip.target.param].label}`;
    view.element.setAttribute('aria-label', view.title.textContent);
    view.element.setAttribute('aria-selected', String(clip.id === selectedAutomation));
    view.element.classList.toggle('is-muted', !!clip.mute);
    view.element.style.left = `${clip.at * zoom}px`; view.element.style.width = `${Math.max(12, clip.duration * zoom)}px`;
    view.editor.update(clip, { zoom, height: 44 });
  }
  function mutateAssets(action) {
    const previous = new Map(assets), removed = new Map(graveyard);
    const done = commit(action);
    if (!done) { assets = previous; graveyard.clear(); for (const [id, asset] of removed) graveyard.set(id, asset); changed(); draw(); }
    return done;
  }
  const confirmDelete = name => actionDialog.ask({ heading: t('Delete from project?', '¿Eliminar del proyecto?'),
    detail: t(`Destructive operation: “${name}” and its dependent clips will be removed. Saving also removes that audio from this saved project. External source files stay untouched. You can undo during this session.`, `Operación destructiva: se eliminará «${name}» y sus clips dependientes. Al guardar también se quitará ese audio de la copia guardada del proyecto. Los archivos fuente externos se conservan. Podés deshacer durante esta sesión.`),
    cancel: t('Cancel', 'Cancelar'), choices: [{ value: 'delete', label: t('Delete', 'Eliminar'), danger: true }] });
  function removeChannelState(id) {
    const track = trackOf(id);
    if (track?.stem) state.removedTracks = [...new Set([...(state.removedTracks || []), id])];
    state.tracks = state.tracks.filter(track => track.id !== id);
    state.clips = state.clips.filter(clip => clip.track !== id);
    state.automation = (state.automation || []).filter(clip => clip.track !== id && clip.target.track !== id);
  }
  function ensureAudioLane() {
    state.tracks = state.tracks.filter(track => track.kind !== 'automation' || state.automation?.some(clip => clip.track === track.id));
    if (!state.tracks.some(track => track.kind !== 'automation')) state.tracks.push({ id: uid(), name: t('Track', 'Pista'), gain: 1, mute: false, solo: false });
  }
  function removeAsset(id) {
    const asset = assets.get(id); if (!asset || asset.pattern) return;
    state.clips = state.clips.filter(clip => clip.asset !== id);
    for (const track of [...state.tracks]) {
      if (track.stem && `audio-${track.stem}` === id) removeChannelState(track.id);
      else if (track.source === id) delete track.source;
    }
    if (asset.session) state.deletedSources = [...new Set([...(state.deletedSources || []), id])];
    graveyard.set(id, asset); assets.delete(id); cache.forget(id);
    if (drawSource?.asset === id) drawSource = null;
  }
  async function deleteTrack(key) {
    const track = state.tracks.find(item => item.id === key || item.stem === key); if (!track) return false;
    if (!await confirmDelete(track.name) || !trackOf(track.id)) return false;
    return mutateAssets(() => {
      const ids = new Set(state.clips.filter(clip => clip.track === track.id).map(clip => clip.asset));
      if (track.source) ids.add(track.source);
      if (track.stem) ids.add(`audio-${track.stem}`);
      removeChannelState(track.id);
      for (const id of ids) if (id === `audio-${track.stem}` || !state.clips.some(clip => clip.asset === id) && !state.tracks.some(track => track.source === id)) removeAsset(id);
      ensureAudioLane(); pick(null);
    });
  }
  async function consolidateTrack(key) {
    if (operating || exporting) return false;
    const track = state.tracks.find(item => item.id === key || item.stem === key);
    if (!track || !state.clips.some(clip => clip.track === track.id && !clip.mute)) { report(t('This channel has no audible clips to consolidate.', 'Este canal no tiene clips audibles para consolidar.')); return false; }
    const choice = await actionDialog.ask({ heading: t('Consolidate channel', 'Consolidar canal'),
      detail: t(`Render “${track.name}”, including its clips, gaps, normalization, FX, EQ, volume and automation. Master effects stay on the master. Keep originals adds a new channel and mutes the source. Replace is destructive: it removes the old channel and source audio not used elsewhere, after a successful render.`, `Renderizar «${track.name}», incluidos clips, silencios, normalización, FX, EQ, volumen y automatización. Los efectos master quedan en el master. Conservar originales agrega un canal nuevo y silencia el origen. Reemplazar es destructivo: elimina el canal anterior y los audios que no se usen en otros canales, después de renderizar correctamente.`),
      cancel: t('Cancel', 'Cancelar'), choices: [{ value: 'replace', label: t('Replace originals', 'Reemplazar originales'), danger: true }, { value: 'keep', label: t('Keep originals · new channel', 'Conservar originales · canal nuevo') }] });
    if (!choice || !trackOf(track.id)) return false;
    if (choice === 'keep' && state.tracks.length >= LIMITS.tracks) { report(t('No room for another channel (16 maximum).', 'No hay lugar para otro canal (máximo 16).')); return false; }
    operating = true; const before = copy(); exporting = new AbortController();
    const snapshot = structuredClone(playbackState());
    snapshot.clips = snapshot.clips.filter(clip => clip.track === track.id);
    snapshot.automation = snapshot.automation.filter(clip => clip.target.track === track.id);
    snapshot.tracks.forEach(item => { if (item.kind !== 'automation') item.mute = item.id !== track.id; item.solo = false; });
    try {
      const rendered = await renderArrangement(snapshot, new Map(assets), cache, { signal: exporting.signal, normalize: false,
        progress: p => toast({ id: 'playlist-task', variant: 'loading', title: t('Consolidating channel…', 'Consolidando canal…'), progress: p }) });
      if (JSON.stringify(before) !== JSON.stringify(copy())) throw new Error(t('The project changed during rendering. Consolidate again to include the edits.', 'El proyecto cambió durante el render. Volvé a consolidar para incluir las ediciones.'));
      if (rendered.duration > LIMITS.seconds) throw new Error(t('The consolidated audio including FX tails exceeds 5 minutes.', 'El audio consolidado, incluidas las colas de FX, supera los 5 minutos.'));
      const asset = { id: uid(), name: `${track.name} (${t('consolidated', 'consolidado')})`.slice(0, 160), buffer: rendered, version: 0 };
      const next = new Map(assets); next.set(asset.id, asset); checkBudget(next);
      return mutateAssets(() => {
        const index = state.tracks.findIndex(item => item.id === track.id);
        const ids = new Set([...state.clips.filter(clip => clip.track === track.id).map(clip => clip.asset), track.source, track.stem && `audio-${track.stem}`].filter(Boolean));
        if (choice === 'replace') {
          removeChannelState(track.id);
          for (const id of ids) if (!state.clips.some(clip => clip.asset === id) && !state.tracks.some(item => item.source === id)) removeAsset(id);
        } else { trackOf(track.id).mute = true; trackOf(track.id).solo = false; }
        assets.set(asset.id, asset);
        const consolidated = { id: uid(), name: asset.name, source: asset.id, gain: 1, mute: false, solo: !!track.solo, color: color(track) };
        state.tracks.splice(choice === 'replace' ? index : index + 1, 0, consolidated);
        const clip = newClip(asset, consolidated.id); state.clips.push(clip); pick(clip.id); ensureAudioLane();
      });
    } finally { operating = false; exporting = null; dismissToast('playlist-task'); }
  }
  // Same navigation as the stem waveforms: wheel zooms around the pointer, Shift pans.
  const fit = () => { scroll.scrollLeft = 0; zoomAround(0, (scroll.clientWidth - TRACK_HEAD - 12) / Math.max(1, arrangementEnd(state) || 16) / zoom); };
  const wheelHint = t('the mouse wheel zooms over the ruler, Ctrl + wheel zooms anywhere and Shift + wheel pans', 'la rueda hace zoom sobre la regla, Ctrl + rueda hace zoom en cualquier lado y Shift + rueda desplaza');
  const zoomOut = toolButton({ icon: ICONS.zoomOut, name: t('Zoom out', 'Alejar'), detail: wheelHint, key: '-', keys: ['-', '_'], color: '#e6e1da', repeat: true }, () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1 / 1.5));
  const zoomIn = toolButton({ icon: ICONS.zoomIn, name: t('Zoom in', 'Acercar'), detail: wheelHint, key: '+', keys: ['+', '='], color: '#e6e1da', repeat: true }, () => zoomAround((scroll.clientWidth - TRACK_HEAD) / 2, 1.5));
  const fitButton = toolButton({ icon: ICONS.fit, name: t('Show the whole arrangement', 'Ver todo el arreglo'), detail: t('fits every clip in view', 'ajusta el zoom para ver todos los clips'), key: 'F', keys: ['f'], color: '#e6e1da' }, fit);
  // One row of tools in groups: pointer tools, cut/copy/delete, clip effects, history, zoom, add.
  const tools = node('div', 'pl-tools');
  const toolGroups = [[pencilButton, selectButton, stretchEdgeButton, slipButton, fadeButton, sliceButton], [split, duplicate, remove], [muteClip, reverseClip, crossfade], [undo, redo], [gridButton, zoomOut, zoomIn, fitButton], [importButton, addTrack]];
  for (const group of toolGroups.slice(1)) group[0].classList.add('pl-tool-group');
  tools.append(...toolGroups.flat());
  inspector.append(clipVolume.wrap, pitch.wrap, fine.wrap, speed.wrap, clipOptions, tools);
  let zoomFrame = 0, zoomTarget = null, zoomAnchor = null;
  function zoomAround(x, factor) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    x = Math.max(0, x);
    zoomAnchor ||= { at: (scroll.scrollLeft + x) / zoom };
    zoomAnchor.x = x; zoomTarget = clamp((zoomTarget ?? zoom) * factor, MIN_ZOOM * state.bpm / 120, MAX_ZOOM * state.bpm / 120);
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
  const hintText = t('P / 1: draw, move and trim · 2: slip audio · 3 / E: stretch either edge · 6: drag edges or fade handles to fade in/out; double-click a handle to reset; Esc cancels a drag · Q: select time, including silence · Ctrl+C/V: copy/paste audio · Ctrl+D: duplicate selection · Stretch beside the knobs: on preserves pitch, off resamples (H toggles, 4 on, 5 off) · Normalize, Follow tempo and fine pitch are beside Stretch · Right-click channel volume or FX Mix: create automation · Double-click an envelope to add points; right-click points for Linear/Hold/Delete · G: grid beside zoom · Alt bypasses snap · Space plays · S splits · C slices · B/F8 opens samples · drag on the ruler to loop. 16 lanes / 5 minutes.', 'P / 1: dibujar, mover y recortar · 2: deslizar audio · 3 / E: estirar un borde · 6: arrastrá bordes o marcas para editar fades; doble clic en una marca para resetear; Esc cancela el arrastre · Q: seleccionar tiempo, incluido el silencio · Ctrl+C/V: copiar/pegar audio · Ctrl+D: duplicar selección · Stretch junto a las perillas: activado conserva pitch, desactivado usa Resample (H alterna, 4 activa, 5 desactiva) · Normalizar, Seguir tempo y pitch fino están junto a Stretch · Clic derecho en volumen del canal o Mix de FX: crear automatización · Doble clic en la curva agrega puntos; clic derecho en un punto ofrece Lineal/Escalón/Eliminar · G: grilla junto al zoom · Alt omite snap · Espacio reproduce · S corta · C activa corte · B/F8 abre samples · arrastrá en la regla para crear un loop. 16 carriles / 5 minutos.');
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
  inspectorHost.append(inspector);
  container.append(library, scroll, hbarRow);

  function travel(forward) {
    const from = forward ? future : history, to = forward ? history : future;
    if (!from.length) return;
    const bpm = state.bpm;
    to.push(copy()); state = from.pop(); timeSelection = null;
    if (state.bpm !== bpm) followTempo(bpm / state.bpm);
    if (state.sampleIds) {
      const ids = new Set(state.sampleIds);
      for (const asset of [...assets.values()].filter(asset => !asset.pattern)) if (!ids.has(asset.id)) { graveyard.set(asset.id, asset); assets.delete(asset.id); cache.forget(asset.id); }
    }
    // Undo of "Delete from project" brings the sample back from the graveyard.
    for (const id of [...(state.sampleIds || []), ...state.clips.map(clip => clip.asset), ...state.tracks.map(track => track.source)]) {
      if (id && !assets.has(id) && graveyard.has(id)) { assets.set(id, graveyard.get(id)); graveyard.delete(id); }
    }
    state.clips = state.clips.filter(clip => assets.has(clip.asset)); selectedAutomation = null; assignSources(); pruneGraveyard(); changed(); draw();
  }
  function checkBudget(next) {
    // Preview audio held by the sample browser counts too.
    let bytes = sampleBrowser?.reservedBytes() || 0;
    for (const asset of next.values()) bytes += asset.buffer.length * asset.buffer.numberOfChannels * 4;
    if (bytes > LIMITS.pcmBytes || next.size > 64) throw new Error(t('Sample library limit: 256 MiB / 64 samples.', 'Límite de biblioteca: 256 MiB / 64 samples.'));
  }
  const firstUserTrack = () => state.tracks.find(track => !track.stem && track.kind !== 'automation')?.id || state.tracks.find(track => track.kind !== 'automation')?.id;
  // The one importer for the file picker, external drops and the sample browser. Items are
  // Files or { name, read() }, where read() resolves to { file } or an already decoded
  // { buffer }. A null track imports into the project/rack without placing clips.
  // Track and time are fixed when the import starts. Resolves true when added.
  async function importSamples(items, track = firstUserTrack(), at = position) {
    if (operating || !items.length) return false;
    if (trackOf(track)?.kind === 'automation') { report(t('Drop audio on an audio channel.', 'Soltá el audio en un canal de audio.')); return false; }
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
  // Times stick to the grid unless it is off or Alt is held (`free`).
  const snapAt = (seconds, free = false) => clamp(free || !snap ? seconds : snapTime(seconds, state.bpm, snap), 0, LIMITS.seconds);
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
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
    const bins = spectrum?.peaks.length, loop = assets.get(clip.asset)?.loop ? buffer.duration : 0;
    const gain = clip.gain * (clip.normalizationGain ?? 1), duration = clipDuration(clip);
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
        for (const data of channels) for (let i = first; i < last; i += stride) peak = Math.max(peak, Math.abs(data[i]));
        ctx.fillStyle = '#858d96';
      }
      const bar = Math.min(1, peak * gain * clipEnvelope(clip, (a + b) / 2 * duration)) * height * .88;
      if (bar > .02) ctx.fillRect(x, top + (height - bar) / 2, 1, Math.max(1, bar));
    }
    if (clip.fadeIn || clip.fadeOut) {
      ctx.strokeStyle = '#fff9'; ctx.beginPath();
      for (let x = startX; x < endX; x++) {
        const y = top + height * (1 - clipEnvelope(clip, (x - left) / width * duration));
        if (x === startX) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  function paint() {
    hbarSize.style.width = Math.max(0, scroll.scrollWidth - TRACK_HEAD) + 'px';
    // The scrollbar row only shows when there are clips and something to scroll to.
    const scrollable = state.clips.length + (state.automation?.length || 0) > 0 && scroll.scrollWidth > scroll.clientWidth + 1;
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
      const dragging = drag?.clips.some(item => item.id === clip.id);
      if (shown || dragging || clipViews.get(clip.id)?.contains(document.activeElement)) {
        let item = clipViews.get(clip.id);
        if (!item) { item = clipElement(clip); clipViews.set(clip.id, item); }
        if (!item.parentElement || item.parentElement !== view.lane && !dragging) view.lane.append(item);
        updateClip(item, clip); visible.add(clip.id);
      }
      if (!shown) continue;
      ctx.globalAlpha = clip.mute || !trackAudible(state, trackOf(clip.track)) ? .35 : 1;
      drawWave(ctx, clip, left + 1, top, clipWidth - 2, 44, width);
    }
    ctx.globalAlpha = 1;
    for (const [id, item] of clipViews) if (!visible.has(id)) { keepFocus(item); item.remove(); clipViews.delete(id); }
    const retained = new Set();
    for (const clip of state.automation || []) {
      const lane = rowViews.get(clip.track)?.lane; if (!lane) continue;
      let view = automationViews.get(clip.id);
      if (!view) { view = automationElement(clip); automationViews.set(clip.id, view); }
      if (view.element.parentElement !== lane) lane.append(view.element);
      updateAutomationView(view, clip); retained.add(clip.id);
    }
    for (const [id, view] of automationViews) if (!retained.has(id)) { view.editor.dispose(); view.element.remove(); automationViews.delete(id); }
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
    if (track.kind === 'automation') { head.classList.add('pl-automation-head'); volume.wrap.hidden = true; controls.querySelector('[data-mix=solo]').hidden = true; }
    else volume.dial.oncontextmenu = event => contextMenu(event, [{ label: t('Create automation clip', 'Crear clip de automatización'), icon: 'waveform', action: () => createAutomation({ track: trackId, param: 'gain' }) }]);
    const menu = event => contextMenu(event, [
      ...(track.kind === 'automation' ? [] : [
        { label: t('Channel FXs', 'FXs del canal'), icon: 'plugin', action: () => onPatternAction?.('fx', trackId) },
        { label: t('Automate volume', 'Automatizar volumen'), icon: 'waveform', action: () => createAutomation({ track: trackId, param: 'gain' }) },
        { label: t('Consolidate channel…', 'Consolidar canal…'), icon: 'export', action: safe(() => consolidateTrack(trackId)) },
      ]),
      { label: t('Delete channel…', 'Eliminar canal…'), icon: 'trash', danger: true, action: safe(() => deleteTrack(trackId)) },
    ]);
    const more = iconButton('more', t('Channel options', 'Opciones del canal'), menu); more.classList.add('stem-more'); controls.append(more);
    head.oncontextmenu = event => { if (!event.target.closest('input') && !event.defaultPrevented) menu(event); };
    return head;
  }
  function draw({ paint: paintNow = true } = {}) {
    TRACK_HEAD = parseFloat(getComputedStyle(container).getPropertyValue('--pl-head')) || 165;
    // The view zoom is per beat: a new tempo keeps every bar the same width on screen.
    if (state.bpm !== viewBpm) { zoom *= state.bpm / viewBpm; viewBpm = state.bpm; }
    tempo.show(state.bpm); undo.disabled = !history.length; redo.disabled = !future.length;
    const extent = Math.min(LIMITS.seconds, Math.max(16, arrangementEnd(state) + 8, timeSelection?.end || 0));
    const width = Math.max(scroll.clientWidth - TRACK_HEAD, extent * zoom);
    grid.style.width = (width + TRACK_HEAD) + 'px'; grid.style.setProperty('--beat', (60 / state.bpm * zoom) + 'px');
    const step = snap * 60 / state.bpm * zoom;
    grid.style.setProperty('--grid-step', (step >= 6 ? step : 60 / state.bpm * zoom) + 'px');
    ruler.style.width = width + 'px'; rulerWidth = width;
    if (loopBand.parentElement !== ruler) ruler.append(rulerMarks, loopBand, markerLine);
    renderRuler(); renderLoopBand();
    const rows = [rulerRow];
    state.tracks.forEach((track, index) => {
      const host = track.kind === 'automation' ? null : channel?.(track, trackSource(track.id)) || null;
      let view = rowViews.get(track.id);
      if (!view || view.host !== host) {
        view?.row.remove();
        const row = node('div', 'pl-grid-row'), lane = node('div', 'pl-lane');
        const head = host?.head || userHead(track, index);
        head.classList.add('pl-track-head'); lane.dataset.track = track.id; row.append(head, lane);
        lane.onpointerdown = event => { if (event.target === lane) beginMarquee(event); };
        lane.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
        lane.ondrop = safe(async event => {
          event.preventDefault(); const at = snapAt((event.clientX - lane.getBoundingClientRect().left) / zoom, event.altKey);
          const browsed = sampleBrowser?.resolveDrop(event.dataTransfer);
          if (browsed) { await importSamples(browsed, track.id, at); return; }
          if (event.dataTransfer.files.length) { await importSamples([...event.dataTransfer.files], track.id, at); return; }
          const asset = assets.get(event.dataTransfer.getData('application/x-stem-sample'));
          if (asset && track.kind !== 'automation') commit(() => { const clip = newClip(asset, track.id, at); state.clips.push(clip); pick(clip.id); });
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
    const nextShelf = shelfAssets.map(a => a.id + ':' + a.name + ':' + (a.group || '')).join('|');
    if (nextShelf !== shelfKey) {
      shelfKey = nextShelf; keepFocus(shelf); shelf.replaceChildren();
      const colors = groupColors(shelfAssets);
      for (const asset of shelfAssets) {
        const b = button(asset.name, t('Click to draw this sample · double-click: add at cursor · drag onto a track', 'Clic para dibujar este sample · doble clic: agregar en el cursor · arrastrá a una pista'), () => {
          pick(null); drawSource = newClip(asset, activeTrack || firstUserTrack()); setTool('draw'); updateSelection(); scroll.focus({ preventScroll: true });
        });
        b.ondblclick = () => placeDrawSource(activeTrack || firstUserTrack(), position);
        b.replaceChildren(node('span', 'pl-sample-name', asset.name));
        b.classList.toggle('is-pattern', !!asset.pattern); b.dataset.asset = asset.id;
        if (colors.has(asset.id)) b.style.setProperty('--group-color', colors.get(asset.id));
        b.draggable = true; b.ondragstart = event => event.dataTransfer.setData('application/x-stem-sample', asset.id);
        b.oncontextmenu = event => shelfMenu(event, asset); shelf.append(b);
      }
    }
    refreshSampleUsage(); updateSelection(); if (paintNow) paint(); onViewChange?.();
  }
  function updateClip(item, clip) {
    const name = assets.get(clip.asset).name;
    item.setAttribute('aria-label', name + ', ' + clock(clip.at) + ', ' + clipPitch(clip) + ' ' + t('semitones', 'semitonos'));
    item.setAttribute('aria-pressed', String(isChosen(clip.id)));
    item.style.left = (clip.at * zoom) + 'px'; item.style.width = Math.max(8, clipDuration(clip) * zoom) + 'px'; item.style.setProperty('--clip-color', color(trackOf(clip.track)));
    item.classList.toggle('is-stretching', stretching(clip)); item.classList.toggle('is-muted', !!clip.mute); item.classList.toggle('is-pattern', isPattern(clip));
    item.querySelector('.pl-clip-title').replaceChildren(...(clip.tempoLock ? [globalThis.SCIcons.create('stretch')] : []), ...(clip.reverse ? [globalThis.SCIcons.create('reverse')] : []), document.createTextNode(name + (clipPitch(clip) ? '  ' + signed(clipPitch(clip)) + ' st' : '') + (clip.speed !== 1 ? '  ' + clip.speed.toFixed(2) + '×' : '')));
    const duration = clipDuration(clip);
    for (const handle of item.querySelectorAll('.pl-fade-handle')) {
      const value = Math.min(clip[handle.dataset.fade] || 0, duration);
      const fraction = value / duration;
      handle.style.left = `clamp(6px, ${(handle.dataset.fade === 'fadeIn' ? fraction : 1 - fraction) * 100}%, calc(100% - 6px))`;
      handle.setAttribute('aria-valuemax', String(duration)); handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', `${value.toFixed(2)} s`);
      handle.dataset.scdlTooltip = `${handle.getAttribute('aria-label')}: ${value.toFixed(2)} s · ${resetHint}`;
    }
    for (const edge of item.querySelectorAll('.pl-edge')) edge.dataset.scdlTooltip = editMode === 'fade'
      ? (edge.dataset.edge === 'left' ? 'Fade in' : 'Fade out')
      : editMode === 'stretch' ? t('Drag to stretch', 'Arrastrar para estirar') : t('Drag to trim', 'Arrastrar para recortar');
  }
  function clipElement(initial) {
    const id = initial.id;
    const item = node('div', 'pl-clip'); item.dataset.clip = id; item.tabIndex = 0; item.setAttribute('role', 'button');
    item.append(node('span', 'pl-clip-title'));
    for (const edge of ['left', 'right']) { const handle = node('span', `pl-edge pl-edge-${edge}`); handle.dataset.edge = edge; handle.dataset.scdlTooltip = t('Drag to trim', 'Arrastrar para recortar'); item.append(handle); }
    for (const [key, label] of [['fadeIn', 'Fade in'], ['fadeOut', 'Fade out']]) {
      const handle = node('span', 'pl-fade-handle'); handle.dataset.fade = key; handle.tabIndex = 0;
      handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', label); handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-orientation', 'horizontal'); item.append(handle);
      handle.onkeydown = event => {
        const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
        if (!(event.key in steps) && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (!isChosen(id)) pick(id);
        commit(() => { for (const clip of chosen()) {
          const duration = clipDuration(clip), value = Math.min(clip[key] || 0, duration);
          clip[key] = event.key === 'Home' ? 0 : event.key === 'End' ? duration : clamp(value + steps[event.key] * (event.shiftKey ? .1 : .01), 0, duration);
        } });
      };
    }
    // Pointer capture retargets dblclick to the clip, so the pressed part is remembered.
    let pressed = null;
    item.ondblclick = event => {
      if (editMode !== 'fade') return;
      const target = pressed || event.target;
      const key = target.dataset.fade || (target.dataset.edge === 'left' ? 'fadeIn' : target.dataset.edge === 'right' ? 'fadeOut' : null);
      if (!key) return;
      event.preventDefault(); event.stopPropagation();
      if (!isChosen(id)) pick(id);
      if (chosen().some(clip => clip[key])) setClip(key, 0);
    };
    // Remembered for the contextmenu event, which older Chrome versions fire without pointerType.
    item.onpointerdown = event => {
      item.dataset.pointer = event.pointerType; pressed = event.target;
      // macOS turns Ctrl+click into a right click too: that click toggles the selection only.
      ctrlClick = event.button === 0 && event.ctrlKey ? id : null;
      beginDrag(event, state.clips.find(c => c.id === id), item);
    };
    // Like FL Studio: right click on the name bar opens the menu, on the waveform removes the clip.
    // The keyboard menu key (no pointer position) and touch long-press always open the menu,
    // so a long press never deletes by accident.
    item.oncontextmenu = event => {
      const clip = state.clips.find(c => c.id === id); if (!clip) return;
      if (ctrlClick === id && event.ctrlKey) { event.preventDefault(); ctrlClick = null; return; }
      // Measured by height: the trim handles cover the name bar's ends too.
      const keyboard = !event.clientX && !event.clientY, onHeader = event.clientY < item.querySelector('.pl-clip-title').getBoundingClientRect().bottom;
      const touch = ['touch', 'pen'].includes(event.pointerType || item.dataset.pointer);
      if (keyboard || onHeader || touch) { clipMenu(event, clip); return; }
      event.preventDefault(); event.stopPropagation(); eraseClip(clip);
    };
    item.onkeydown = event => {
      const clip = state.clips.find(c => c.id === id), audioTracks = state.tracks.filter(track => track.kind !== 'automation'), index = audioTracks.findIndex(t => t.id === clip.track);
      if (event.key === 'Enter') { pick(clip.id); updateSelection(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); pick(clip.id);
      commit(() => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') clip.at = clamp(clip.at + (event.key === 'ArrowLeft' ? -1 : 1) * 60 / state.bpm * (snap || .25), 0, LIMITS.seconds - clipDuration(clip));
          else clip.track = audioTracks[clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, audioTracks.length - 1)].id; });
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
    const clip = picked();
    const automation = state.automation?.find(item => item.id === selectedAutomation);
    renderPitchMode();
    for (const input of [clipVolume.dial, pitch.dial, fine.dial, speed.dial, muteClip, reverseClip, duplicate, split, remove]) input.disabled = !clip;
    fine.show(clip?.cents ?? 0);
    muteClip.setAttribute('aria-pressed', String(!!clip?.mute)); reverseClip.setAttribute('aria-pressed', String(!!clip?.reverse));
    clipVolume.show(Math.round((clip?.gain ?? 1) * 100)); pitch.show(clip?.pitch ?? 0); speed.show(clip?.speed ?? 1);
    const clips = chosen();
    for (const [control, enabled] of [[normalizeButton, clip => clip.normalizationGain !== undefined], [followTempoButton, clip => clip.tempoLock]]) {
      const active = clips.filter(enabled).length;
      control.disabled = !clips.length;
      control.setAttribute('aria-pressed', active && active < clips.length ? 'mixed' : String(active > 0));
    }
    for (const item of grid.querySelectorAll('.pl-clip')) item.setAttribute('aria-pressed', String(isChosen(item.dataset.clip)));
    for (const item of shelf.children) item.setAttribute('aria-pressed', String(item.dataset.asset === drawSource?.asset));
    duplicate.disabled = !clip && !timeSelection && !automation; remove.disabled = !clip && !automation;
    for (const [id, view] of automationViews) view.element.setAttribute('aria-selected', String(id === selectedAutomation));
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
    if (!source || !assets.has(source.asset) || trackOf(track)?.kind === 'automation') return;
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
      const from = snapAt((left - TRACK_HEAD) / zoom, move.altKey), to = snapAt((right - TRACK_HEAD) / zoom, move.altKey);
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
        const at = snapAt((x0 - TRACK_HEAD) / zoom, event.altKey);
        if (!selecting && editMode === 'move' && drawSource && assets.has(drawSource.asset)) placeDrawSource(lane.dataset.track, at);
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
    const previousRange = timeSelection;
    if (!isChosen(clip.id)) pick(clip.id);
    else if (selected !== clip.id) { extra.delete(clip.id); extra.add(selected); selected = clip.id; }
    timeSelection = null; selectedAutomation = null; drawSource = { ...clip }; activeTrack = clip.track;
    updateSelection(); item.focus({ preventScroll: true });
    const edge = event.target.dataset.edge;
    const fade = editMode === 'fade' ? event.target.dataset.fade || (edge === 'left' ? 'fadeIn' : edge === 'right' ? 'fadeOut' : null) : null;
    if (editMode === 'fade' && !fade) return;
    const lanes = [...grid.querySelectorAll('.pl-lane')], tracks = state.tracks.filter(track => track.kind !== 'automation');
    const clips = chosen();
    drag = { id: event.pointerId, x: event.clientX, scroll: scroll.scrollLeft, before: copy(), clip: { ...clip },
      clips: clips.map(c => ({ ...c })), range: previousRange, edge, fade, editMode, changed: false };
    item.setPointerCapture(event.pointerId);
    item.onpointermove = move => {
      if (drag?.id !== move.pointerId) return;
      const original = drag.clip, delta = (move.clientX - drag.x + scroll.scrollLeft - drag.scroll) / zoom;
      if (!drag.changed && Math.abs(delta * zoom) < 2 && (drag.edge || Math.abs(move.clientY - event.clientY) < 2)) return;
      let updates;
      if (drag.fade) {
        const shift = delta * (drag.fade === 'fadeIn' ? 1 : -1);
        updates = drag.clips.map(c => ({ ...c, [drag.fade]: clamp(Math.min(c[drag.fade] || 0, clipDuration(c)) + shift, 0, clipDuration(c)) }));
      } else if (drag.editMode === 'slip' && !drag.edge) {
        updates = drag.clips.map(c => slipClip(c, delta * (c.reverse ? -1 : 1), isPattern(c) ? Infinity : assets.get(c.asset).buffer.duration));
      } else if (drag.edge) {
        const anchor = original.at + (drag.edge === 'right' ? clipDuration(original) : 0);
        updates = resizeClips(drag.clips, snapAt(anchor + delta, move.altKey) - anchor, { edge: drag.edge, stretch: drag.editMode === 'stretch', assets });
      } else {
        const shift = clamp(snapAt(original.at + delta, move.altKey) - original.at,
          -Math.min(...drag.clips.map(c => c.at)), Math.min(...drag.clips.map(c => LIMITS.seconds - c.at - clipDuration(c))));
        const lane = lanes.find(e => { const box = e.getBoundingClientRect(); return move.clientY >= box.top && move.clientY < box.bottom; });
        const indices = drag.clips.map(c => tracks.findIndex(track => track.id === c.track));
        const target = tracks.findIndex(track => track.id === lane?.dataset.track), origin = tracks.findIndex(track => track.id === original.track);
        const rows = target < 0 ? tracks.findIndex(track => track.id === clip.track) - origin
          : clamp(target - origin, -Math.min(...indices), tracks.length - 1 - Math.max(...indices));
        updates = drag.clips.map((c, i) => ({ ...c, at: c.at + shift, track: tracks[indices[i] + rows].id }));
      }
      drag.changed = true;
      updates.forEach((next, i) => {
        Object.assign(clips[i], next);
        const view = clipViews.get(next.id);
        if (!view) return;
        view.style.left = `${next.at * zoom}px`; view.style.width = `${Math.max(8, clipDuration(next) * zoom)}px`;
        view.style.transform = `translateY(${rowViews.get(next.track).lane.getBoundingClientRect().top - view.parentElement.getBoundingClientRect().top}px)`;
      });
      // One engine update per frame; a stretch-edge drag would queue a render per move,
      // so its new speed is heard on release.
      if (!(drag.editMode === 'stretch' && drag.edge)) dragAudio ||= requestAnimationFrame(() => { dragAudio = 0; engine?.update(playbackState(), transport()); });
      paintSoon();
    };
    const finish = cancel => {
      if (!drag) return;
      const gesture = drag; drag = null;
      cancelAnimationFrame(dragAudio); dragAudio = 0;
      item.onpointermove = item.onpointerup = item.onpointercancel = item.onlostpointercapture = null;
      if (item.hasPointerCapture(gesture.id)) item.releasePointerCapture(gesture.id);
      for (const c of gesture.clips) { const view = clipViews.get(c.id); if (view) view.style.transform = ''; }
      if (cancel) { state = gesture.before; timeSelection = gesture.range; changed(); }
      else if (gesture.changed) commit(() => {}, gesture.before);
      draw(); grid.querySelector(`.pl-clip[data-clip="${selected}"]`)?.focus({ preventScroll: true });
    };
    item.onpointerup = () => finish(false); item.onpointercancel = item.onlostpointercapture = () => finish(true);
    drag.cancel = () => finish(true);
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
    engine = createPlaylistEngine({ context: io.context, output: io.output, cache, assets: () => assets, masterEffects, onEnded: () => stop(true), onError: report });
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
  // `samples` are the imported samples a preset stored: [{ id, name, group?, buffer }].
  // `keep` carries the user's samples and clips over: only the same project changes its
  // channels (separating its original). Opening or starting a project starts clean, as in
  // FL Studio: what the project did not save is not in it.
  function setSession({ sources, saved = null, samples = [], keep = false }) {
    showUnusedSamples = false;
    stop(true);
    for (const old of assets.values()) if (old.session || (!keep && !old.pattern)) cache.forget(old.id);
    const next = new Map([...assets].filter(([, asset]) => !asset.session && (keep || asset.pattern)));
    sources = sources.filter(source => !saved?.deletedSources?.includes(source.id));
    for (const source of sources) next.set(source.id, { id: source.id, name: source.name, buffer: source.buffer, version: 0, session: true });
    for (const sample of samples) if (!next.has(sample.id)) next.set(sample.id, { id: sample.id, name: String(sample.name || 'Sample').slice(0, 160), buffer: sample.buffer, version: 0,
      ...(typeof sample.group === 'string' && sample.group ? { group: sample.group.slice(0, 64) } : {}) });
    const userClips = keep ? state.clips.filter(clip => next.get(clip.asset) && !next.get(clip.asset).session && !trackOf(clip.track)?.stem) : [];
    const userTracks = keep ? state.tracks.filter(track => !track.stem && userClips.some(clip => clip.track === track.id)) : [];
    userTracks.push((keep && state.tracks.find(track => !track.stem && !userTracks.includes(track))) ||
      { id: uid(), name: `${t('Track', 'Pista')} ${userTracks.length + 1}`, gain: 1, mute: false, solo: false });
    const build = restore => {
      const tracks = sources.filter(source => !saved?.removedTracks?.includes(`track-${source.stem}`)).map(source => {
        const old = restore && saved?.tracks?.find(item => item?.stem === source.stem);
        return { id: `track-${source.stem}`, name: source.name, stem: source.stem, gain: Number.isFinite(old?.gain) ? clamp(old.gain, 0, 2) : 1,
          mute: old ? old.mute === true : source.mute === true, solo: false };
      });
      // A clip whose audio did not come back (a sample that failed to load) is left out.
      const clips = restore && Array.isArray(saved?.clips) ? saved.clips.filter(clip => next.has(clip?.asset)).map(clip => ({ ...clip })) :
        sources.filter(source => tracks.some(track => track.stem === source.stem)).map(source => ({ ...newClip(next.get(source.id), `track-${source.stem}`, 0), tempoLock: true }));
      const restoredUsers = restore && Array.isArray(saved?.userTracks) ? saved.userTracks.filter(track => !track.stem) : [];
      const users = [...restoredUsers, ...userTracks.filter(track => !restoredUsers.some(saved => saved.id === track.id) && (!restoredUsers.length || userClips.some(clip => clip.track === track.id)))];
      return { version: 1, bpm: restore && Number.isFinite(saved?.bpm) ? saved.bpm : state.bpm, tracks: [...tracks, ...users], clips: [...clips, ...userClips],
        automation: restore && Array.isArray(saved?.automation) ? structuredClone(saved.automation) : [],
        deletedSources: [...(saved?.deletedSources || [])], removedTracks: [...(saved?.removedTracks || [])] };
    };
    let candidate = build(!!saved);
    // A saved track may name a sample that is not in this session.
    for (const track of candidate.tracks) if (track.source && !next.has(track.source)) delete track.source;
    // Stem channels get their saved EQ back; user tracks carry theirs.
    if (saved?.trackEq && typeof saved.trackEq === 'object') for (const track of candidate.tracks) {
      const eq = saved.trackEq[track.id];
      if (track.stem && eq && typeof eq === 'object' && Array.isArray(eq.bands)) track.eq = structuredClone(eq);
    }
    if (saved?.trackFx && typeof saved.trackFx === 'object') for (const track of candidate.tracks) {
      if (track.stem && saved.trackFx[track.id] && typeof saved.trackFx[track.id] === 'object') track.fx = structuredClone(saved.trackFx[track.id]);
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
  // Keys reach the playlist while it is the last place the user worked in, even when the
  // focused element went away (a deleted clip, a closed menu): focus then sits on <body>.
  let owned = false;
  const keyRoots = [container, toolbar, inspector].filter((root, i, roots) => !roots.some((other, j) => i !== j && other.contains(root)));
  const owns = target => keyRoots.some(root => root.contains(target));
  const claim = event => {
    const target = event.target;
    // Menus, toasts and tooltips float above everything and do not change the owner.
    if (!(target instanceof Element) || target.closest('.pl-menu,.row-menu-list,.toastify,#scdl-fast-tooltip')) return;
    owned = owns(target);
  };
  document.addEventListener('pointerdown', claim, true); document.addEventListener('focusin', claim, true);
  function keepFocus(element) { if (element.contains(document.activeElement)) scroll.focus({ preventScroll: true }); }
  const onPageKey = event => {
    if (!owned || event.defaultPrevented) return;
    // Alt alone must not move focus to the browser menu while it bypasses the grid.
    if (event.key === 'Alt') { event.preventDefault(); return; }
    if (event.type !== 'keydown' || (event.target !== document.body && event.target !== document.documentElement)) return;
    scroll.focus({ preventScroll: true }); onKey(event);
  };
  document.addEventListener('keydown', onPageKey); document.addEventListener('keyup', onPageKey);
  for (const root of keyRoots) root.addEventListener('keydown', onKey);
  function onKey(event) {
    if (event.target.closest?.('input,select,textarea') || event.target.isContentEditable) return;
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); drag.cancel(); return; }
    const modifier = event.ctrlKey || event.metaKey;
    if (event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) safe(space)(); return; }
    const combo = (modifier ? 'ctrl+' : '') + (modifier && event.shiftKey ? 'shift+' : '') + event.key.toLowerCase(), tool = windowKeys.has(combo) ? null : hotkeys.get(combo);
    if (tool) {
      event.preventDefault();
      if ((!event.repeat || tool.repeat) && !tool.control.disabled) {
        if (tool.action) { flash(tool.control); tool.action(); } else tool.control.click();
      }
    }
    else if (event.key === 'Escape') { event.preventDefault(); setTool('draw'); pick(null); updateSelection(); }
    // An empty selection keeps the previous copy, like FL Studio.
    else if (combo === 'ctrl+c') { event.preventDefault(); clipboard = captureSelection() || clipboard; }
    else if (combo === 'ctrl+v') { event.preventDefault(); if (clipboard) pasteSelection(clipboard, snapAt(position), activeTrack); }
    else if (combo === 'ctrl+a') { event.preventDefault(); timeSelection = null; selected = state.clips[0]?.id ?? null; extra = new Set(state.clips.slice(1).map(c => c.id)); updateSelection(); }
    else if (combo === 't') { event.preventDefault(); if (!event.repeat) tapTempo(); }
  }
  function animate() {
    const at = now(); time.textContent = clock(at);
    const head = grid.querySelector('.pl-playhead'); if (head) head.style.left = `${TRACK_HEAD + at * zoom}px`;
    frame = requestAnimationFrame(animate);
  }
  draw(); animate();
  return {
    toggle: safe(toggle), space: safe(space), pause: () => stop(), seek, now, playing, setSession, edit, draw, refreshSampleUsage,
    createAutomation, deleteTrack: safe(deleteTrack), consolidateTrack: safe(consolidateTrack),
    async startRecordingLoop(active = () => true) {
      stop(); seek(transport().loop?.start || 0); await connect();
      if (!active()) return;
      if (engine.play(playbackState(), position, transport())) { renderPlay(true); startMetronome(); onTransport?.(true); }
    },
    recordingClock: () => engine?.recordingClock(),
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
      const channels = state.tracks.filter(track => track.kind !== 'automation').map(track => {
        const source = trackSource(track.id); if (source) used.add(source.id);
        return { key: track.stem || track.id, name: source && !track.stem ? source.name : track.name,
          buffer: source?.buffer || null, imported: !!source && !track.stem };
      });
      for (const asset of importedSamples()) if (!used.has(asset.id)) channels.push({ key: `sample-${asset.id}`, name: asset.name, buffer: asset.buffer, imported: true });
      return channels;
    },
    duration: () => arrangementEnd(state),
    trackSource,
    trackFx: key => structuredClone(state.tracks.find(track => track.id === key || track.stem === key)?.fx ?? null),
    setTrackFx(key, settings) {
      const track = state.tracks.find(item => item.id === key || item.stem === key);
      if (!track || JSON.stringify(track.fx || null) === JSON.stringify(settings || null)) return false;
      return commit(() => { track.fx = structuredClone(settings); });
    },
    trackEffects(key) { const track = state.tracks.find(item => item.id === key || item.stem === key); return track ? engine?.trackEffects(track.id) || null : null; },
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
      trackFx: Object.fromEntries(state.tracks.filter(track => track.stem && track.fx).map(track => [track.id, structuredClone(track.fx)])),
      automation: structuredClone(state.automation || []), deletedSources: [...(state.deletedSources || [])], removedTracks: [...(state.removedTracks || [])],
      samples: importedSamples().map(asset => ({ id: asset.id, name: asset.name, ...(asset.group ? { group: asset.group } : {}) })),
      userTracks: state.tracks.filter(track => !track.stem).map(track => structuredClone(track)),
      clips: state.clips.map(clip => ({ ...clip })) }),
    // `label` shows the library spinner with that text; '' hides it unless clips are stretching.
    setTask(label = '') { task = String(label || ''); renderBusy(); },
    samples: () => importedSamples().map(asset => ({ id: asset.id, name: asset.name, group: asset.group, buffer: asset.buffer })),
    // Stems of a separated clip: one new track per stem, each with a clip in the same place
    // and with the same pitch, speed, fades and direction. The stems are project samples, so
    // they are saved with the separation and undo removes them. `group` puts the tracks
    // under the source track; `muteSource` mutes the separated clip and `removeSource`
    // deletes it (a library sample leaves the project too). The stems share a group color
    // in the library. One undo step.
    addStemTracks({ clip: clipId, sample: sampleId, track: trackId, at: position = 0, stems, group = true, muteSource = true, removeSource = false }) {
      const sample = sampleId && assets.get(sampleId);
      const source = sample ? newClip(sample, trackOf(trackId)?.id || state.tracks[0].id, position) : state.clips.find(clip => clip.id === clipId);
      if (!source) throw new Error(t('The separated clip is no longer in the playlist.', 'El clip separado ya no está en la playlist.'));
      if (state.tracks.length + stems.length > LIMITS.tracks) throw new Error(t('Not enough room: the playlist holds up to 16 tracks.', 'No hay lugar: la playlist admite hasta 16 pistas.'));
      const family = uid(), next = new Map(assets), added = stems.map(stem => ({ id: uid(), name: stem.name.slice(0, 160), buffer: stem.buffer, version: 0, group: family }));
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
        const isSource = clip => sampleId ? clip.asset === sampleId : clip.id === clipId;
        if (removeSource) {
          state.clips = state.clips.filter(clip => !isSource(clip)); if (selected && !picked()) selected = null;
          if (sample && !sample.session) {
            for (const track of state.tracks) if (track.source === sample.id) delete track.source;
            graveyard.set(sample.id, sample); assets.delete(sample.id); cache.forget(sample.id);
          }
        } else if (muteSource) for (const clip of state.clips) if (isSource(clip)) clip.mute = true;
      });
      if (!done) { assets = previous; if (sample) graveyard.delete(sample.id); changed(); draw(); }
      return done;
    },
    dispose() {
      disposed = true; exporting?.abort(); metronome.stop(); engine?.dispose(); cache.dispose(); viewObserver.disconnect(); sampleBrowser?.dispose();
      actionDialog.dispose(); for (const view of automationViews.values()) view.editor.dispose(); automationViews.clear();
      document.removeEventListener('keydown', onWindowKey); document.removeEventListener('keydown', onPageKey); document.removeEventListener('keyup', onPageKey); document.removeEventListener('pointerdown', claim, true); document.removeEventListener('focusin', claim, true); cancelAnimationFrame(frame); cancelAnimationFrame(zoomFrame); cancelAnimationFrame(paintFrame); window.removeEventListener('scroll', paintSoon); clearTimeout(rateTimer); ownContext?.close();
    },
  };
}
