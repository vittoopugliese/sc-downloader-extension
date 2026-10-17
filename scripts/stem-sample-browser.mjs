import { createSamplePreview } from './stem-sample-preview.mjs';
import { chooseRoot, createFolderCache, readPermission, savedRoot } from './stem-sample-library.mjs';
import { spectrumColor, spectrumNow, spectrumOf } from './stem-spectrum.mjs';
import { mountModuleWindow } from './stem-module-window.mjs';

// Sample browser, like FL Studio's: pick a root folder, walk it, click a file to preview it
// and drag it onto a Playlist track or the channel rack. It is a tool window like the
// others (stem-module-window.mjs): floating and not modal, or docked under the Playlist.
// Files are only read when previewed or imported. `importSamples` and `importToRack`
// receive { name, read() } items; read() resolves to { buffer } or { file }.
export const BROWSER_DRAG_TYPE = 'application/x-stem-browser';
const ROW = 26, VOLUME_KEY = 'stem-sample-browser-volume';
const ICONS = Object.freeze({"browser": "browser", "folder": "folder", "audio": "audio", "choose": "folder-add", "up": "up", "refresh": "refresh", "play": "play", "stop": "stop", "add": "add", "rack": "rack", "volume": "volume"});
const iconMarkup = name => globalThis.SCIcons.html(name, "icon");
const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };
let instances = 0;

export function mountSampleBrowser({ t, home, importSamples, importToRack, onToggle }) {
  const id = `sb-${++instances}`;
  const previewer = createSamplePreview({ onState: renderPlaying });
  const folders = createFolderCache();
  let root = null, access = 'unknown', stack = [], entries = [], active = -1, current = null;
  let listing = null, ticket = 0, loaded = false, dragging = null, back = null, rowFrame = 0, headFrame = 0, arrowTimer = 0, statusTimer = 0, frame = null;

  const node = (tag, className = '', text = '') => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };
  const iconButton = (icon, label, action) => {
    const b = node('button', 'sb-icon'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    b.innerHTML = iconMarkup(icon); b.onclick = action; return b;
  };
  // Same title bar as the other tool windows: a Player Tools disclosure header.
  const collapsible = globalThis.SCPlayerToolsCollapsible;
  if (!document.getElementById('stem-plugin-styles')) {
    const style = document.createElement('style'); style.id = 'stem-plugin-styles'; style.textContent = collapsible.styles; document.head.append(style);
  }
  const win = node('section', 'sb-window'); win.id = 'stem-browser'; win.hidden = true;
  win.setAttribute('aria-label', 'Browser');
  win.innerHTML = collapsible.header({ title: 'Browser', bodyId: `${id}-body`, icon: globalThis.SCIcons.html(ICONS.browser, 'tool-section-icon'), actions: ' ', actionsClass: 'sb-actions pl-ui' });
  const head = win.querySelector('.tool-section-header');
  const rootLabel = node('span', 'sb-root');
  const chooseButton = iconButton(ICONS.choose, t('Choose samples folder', 'Elegir carpeta de samples'), () => choose());
  const refreshButton = iconButton(ICONS.refresh, t('Refresh folder', 'Actualizar carpeta'), () => refresh());
  head.querySelector('.tool-section-actions').replaceChildren(rootLabel, chooseButton, refreshButton);
  const pathRow = node('div', 'sb-path');
  const upButton = iconButton(ICONS.up, t('Parent folder (Backspace)', 'Carpeta superior (Retroceso)'), () => parent());
  const crumb = node('span', 'sb-crumb'); pathRow.append(upButton, crumb);
  const list = node('div', 'sb-list'); list.tabIndex = 0;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('Folders and samples', 'Carpetas y samples'));
  list.title = t('Click a file to preview it · drag it onto a track · Enter adds it at the playhead · Space plays or stops · Backspace goes up', 'Clic en un archivo para escucharlo · arrastralo a una pista · Enter lo agrega en el cursor · Espacio reproduce o detiene · Retroceso sube de carpeta');
  const rows = node('div', 'sb-rows'); list.append(rows);
  const empty = node('div', 'sb-empty'), emptyText = node('p'), emptyAction = node('button', 'sb-action');
  emptyAction.type = 'button'; empty.append(emptyText, emptyAction);
  const viewer = node('div', 'sb-viewer');
  const wave = node('div', 'sb-wave'), canvas = node('canvas'), line = node('div', 'sb-line');
  wave.title = t('Click: play from the start · right-click: play from that point', 'Clic: reproduce desde el inicio · clic derecho: reproduce desde ese punto');
  wave.append(canvas, line); line.hidden = true;
  const controls = node('div', 'sb-controls');
  const playButton = iconButton(ICONS.play, t('Play preview (Space)', 'Escuchar (Espacio)'), () => togglePreview());
  playButton.setAttribute('aria-pressed', 'false');
  const sampleName = node('strong', 'sb-name'), duration = node('output', 'sb-duration');
  const volumeLabel = node('label', 'sb-volume'), volume = node('input');
  volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1';
  volume.setAttribute('aria-label', t('Preview volume', 'Volumen de preview'));
  volumeLabel.title = t('Preview volume; it does not reach the mix, export or recorder', 'Volumen de preview; no pasa por la mezcla, la exportación ni el grabador');
  volumeLabel.innerHTML = iconMarkup(ICONS.volume); volumeLabel.append(volume);
  const savedVolume = read(VOLUME_KEY);
  volume.value = String(Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 80);
  previewer.setVolume(Number(volume.value) / 100);
  volume.oninput = () => { previewer.setVolume(Number(volume.value) / 100); write(VOLUME_KEY, Number(volume.value)); };
  const addButton = iconButton(ICONS.add, t('Add to playlist at the playhead (Enter)', 'Agregar a la playlist en el cursor (Enter)'), () => current && importEntry(current.entry, current.path));
  const rackButton = iconButton(ICONS.rack, t('Add to channel rack only', 'Agregar solo al channel rack'), () => current && importEntry(current.entry, current.path, true));
  rackButton.hidden = !importToRack;
  controls.append(playButton, sampleName, duration, volumeLabel, addButton, rackButton);
  viewer.append(wave, controls);
  const status = node('p', 'sb-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const body = node('div', 'sb-body pl-ui'); body.id = `${id}-body`;
  body.append(pathRow, list, empty, viewer, status); win.append(body);
  (home || document.body).append(win);
  collapsible.mount({ section: win, toggle: head.querySelector('.tool-section-toggle'), body });

  function setStatus(text, sticky = false) {
    status.textContent = text; clearTimeout(statusTimer);
    if (text && !sticky) statusTimer = setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 8000);
  }
  const pathOf = (name = '') => [...stack.slice(1).map(item => item.name), name].filter(Boolean).join('/');
  function errorText(error) {
    if (error?.message === 'too-large') return t('Files must be smaller than 64 MiB.', 'Los archivos deben pesar menos de 64 MiB.');
    if (error?.name === 'EncodingError') return t('This file cannot be decoded.', 'Este archivo no se puede decodificar.');
    if (error?.name === 'NotFoundError') return t('File not found. Refresh the folder.', 'No se encontró el archivo. Actualizá la carpeta.');
    if (error?.name === 'NotReadableError') return t('The file cannot be read right now.', 'No se puede leer el archivo en este momento.');
    return error?.message || String(error);
  }
  // Access lost: offer to reconnect with a new click.
  function accessLost(error) {
    if (error?.name !== 'NotAllowedError' && error?.name !== 'SecurityError') return false;
    access = 'prompt'; renderAccess(); return true;
  }

  const sizeObserver = new ResizeObserver(() => { scheduleRows(); drawWave(); });
  sizeObserver.observe(win);

  function renderAccess() {
    const ready = access === 'granted';
    list.hidden = !ready; pathRow.hidden = !ready; empty.hidden = ready;
    refreshButton.disabled = !ready;
    rootLabel.textContent = root ? root.name : '';
    if (access === 'unknown') { emptyText.textContent = t('Opening the samples folder…', 'Abriendo la carpeta de samples…'); emptyAction.hidden = true; return; }
    if (access === 'unsupported') {
      emptyText.textContent = t('This browser cannot open local folders.', 'Este navegador no puede abrir carpetas locales.');
      emptyAction.hidden = true; chooseButton.disabled = true; return;
    }
    emptyAction.hidden = false;
    if (access === 'prompt' && root) {
      emptyText.textContent = t(`Allow reading «${root.name}» again to keep browsing it.`, `Volvé a permitir la lectura de «${root.name}» para seguir explorándola.`);
      emptyAction.textContent = t('Reconnect folder', 'Reconectar carpeta'); emptyAction.onclick = () => reconnect();
    } else {
      emptyText.textContent = t('Choose a folder with your samples. Click a file to hear it and drag it onto a Playlist track.', 'Elegí una carpeta con tus samples. Hacé clic en un archivo para escucharlo y arrastralo a una pista de la Playlist.');
      emptyAction.textContent = t('Choose folder', 'Elegir carpeta'); emptyAction.onclick = () => choose();
    }
  }
  async function connectSaved() {
    if (typeof window.showDirectoryPicker !== 'function') { access = 'unsupported'; renderAccess(); return; }
    root = await savedRoot();
    if (!root) { access = 'none'; renderAccess(); return; }
    try { access = await readPermission(root) === 'granted' ? 'granted' : 'prompt'; } catch { access = 'prompt'; }
    stack = [{ name: root.name, handle: root }]; renderAccess();
    if (access === 'granted') await showFolder();
  }
  async function choose() {
    let handle;
    try { handle = await chooseRoot(); }
    catch (error) { if (error.name !== 'AbortError') setStatus(errorText(error)); return; }
    stopPreview(); previewer.clear(); folders.clear(); current = null; renderViewer();
    root = handle; stack = [{ name: handle.name, handle }]; access = 'granted'; renderAccess();
    await showFolder(); list.focus({ preventScroll: true });
  }
  async function reconnect() {
    let state = 'denied';
    try { state = await readPermission(root, true); } catch (error) { setStatus(errorText(error)); }
    if (state !== 'granted') { setStatus(t('Permission was not granted.', 'No se concedió el permiso.')); return; }
    access = 'granted'; renderAccess(); await showFolder(); list.focus({ preventScroll: true });
  }

  // Lists the folder at the top of the stack; `select` names the entry to highlight.
  async function showFolder(select = null) {
    listing?.abort();
    const controller = listing = new AbortController(), folder = stack.at(-1), key = pathOf() || '/';
    crumb.textContent = `/${pathOf()}`; crumb.title = `${root.name}/${pathOf()}`;
    upButton.disabled = stack.length < 2;
    entries = []; active = -1; list.scrollTop = 0; scheduleRows();
    const slow = setTimeout(() => setStatus(t('Reading folder…', 'Leyendo carpeta…'), true), 150);
    try {
      const result = await folders.list(key, folder.handle, { signal: controller.signal, onChunk(partial) {
        if (listing !== controller) return;
        entries = partial; scheduleRows(); setStatus(`${t('Reading folder…', 'Leyendo carpeta…')} ${partial.length}`, true);
      } });
      if (listing !== controller) return;
      entries = result;
      const index = select ? entries.findIndex(entry => entry.name === select) : -1;
      setActive(index >= 0 ? index : entries.length ? 0 : -1);
      setStatus(entries.length ? '' : t('No folders or audio files here.', 'No hay carpetas ni archivos de audio acá.'), !entries.length);
    } catch (error) {
      if (error.name === 'AbortError' || listing !== controller) return;
      setStatus('');
      if (accessLost(error)) return;
      if (error.name === 'NotFoundError' && stack.length > 1) {
        const gone = stack.pop(); folders.forget(pathOf() || '/');
        await showFolder();
        setStatus(t(`«${gone.name}» no longer exists.`, `«${gone.name}» ya no existe.`));
        return;
      }
      if (error.name === 'NotFoundError') { access = 'none'; root = null; stack = []; renderAccess(); }
      setStatus(errorText(error));
    } finally { clearTimeout(slow); if (listing === controller) listing = null; }
  }
  function openFolder(entry) { stack.push({ name: entry.name, handle: entry.handle }); showFolder(); }
  function parent() { if (stack.length < 2) return; const child = stack.pop(); showFolder(child.name); }
  function refresh() { if (access !== 'granted' || !stack.length) return; folders.forget(pathOf() || '/'); showFolder(entries[active]?.name); }

  // Only the visible rows exist; folders with thousands of files stay light.
  function scheduleRows() { rowFrame ||= requestAnimationFrame(renderRows); }
  function renderRows() {
    cancelAnimationFrame(rowFrame); rowFrame = 0;
    rows.style.height = `${entries.length * ROW}px`;
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 4);
    const last = Math.min(entries.length, Math.ceil((list.scrollTop + (list.clientHeight || 400)) / ROW) + 4);
    const shown = [];
    for (let i = first; i < last; i++) {
      const entry = entries[i], row = node('div', `sb-row is-${entry.kind}`);
      row.id = `${id}-row-${i}`; row.dataset.index = String(i); row.style.top = `${i * ROW}px`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === active));
      row.setAttribute('aria-setsize', String(entries.length)); row.setAttribute('aria-posinset', String(i + 1));
      row.classList.toggle('is-current', entry.kind === 'file' && current?.entry === entry);
      row.innerHTML = iconMarkup(entry.kind === 'directory' ? ICONS.folder : ICONS.audio);
      const label = node('span', '', entry.name); row.title = entry.name; row.append(label);
      if (entry.kind === 'file') row.draggable = true;
      shown.push(row);
    }
    rows.replaceChildren(...shown);
    if (active >= first && active < last) list.setAttribute('aria-activedescendant', `${id}-row-${active}`);
    else list.removeAttribute('aria-activedescendant');
  }
  function setActive(index, { reveal = true } = {}) {
    active = entries.length ? Math.max(0, Math.min(entries.length - 1, index)) : -1;
    if (reveal && active >= 0) {
      const top = active * ROW;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW - list.clientHeight;
    }
    renderRows();
  }
  list.addEventListener('scroll', scheduleRows, { passive: true });
  const rowOf = event => { const row = event.target.closest('.sb-row'); return row ? Number(row.dataset.index) : -1; };
  rows.addEventListener('click', event => {
    const index = rowOf(event); if (index < 0) return;
    const entry = entries[index]; setActive(index, { reveal: false }); list.focus({ preventScroll: true });
    if (entry.kind === 'directory') openFolder(entry); else previewEntry(entry);
  });
  rows.addEventListener('dragstart', event => {
    const entry = entries[rowOf(event)];
    if (entry?.kind !== 'file') { event.preventDefault(); return; }
    dragging = { entry, path: pathOf(entry.name) };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(BROWSER_DRAG_TYPE, entry.name);
    event.dataTransfer.setData('text/plain', entry.name);
  });
  rows.addEventListener('dragend', () => { dragging = null; });
  list.addEventListener('keydown', event => {
    const page = Math.max(1, Math.floor(list.clientHeight / ROW) - 1), entry = entries[active];
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (event.key in moves || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : active + moves[event.key]);
      // Holding an arrow only previews where it stops.
      clearTimeout(arrowTimer);
      const next = entries[active];
      if (next?.kind === 'file') arrowTimer = setTimeout(() => { if (entries[active] === next) previewEntry(next); }, 120);
    } else if ((event.key === 'Enter' || event.key === 'ArrowRight') && entry?.kind === 'directory') { event.preventDefault(); openFolder(entry); }
    else if (event.key === 'Enter' && entry?.kind === 'file') { event.preventDefault(); if (!event.repeat) importEntry(entry, pathOf(entry.name)); }
    else if (event.key === 'Backspace' || event.key === 'ArrowLeft') { event.preventDefault(); parent(); }
    else if (event.key === ' ') {
      event.preventDefault(); if (event.repeat) return;
      if (previewer.playing()) stopPreview(); else if (entry?.kind === 'file') previewEntry(entry);
    }
  });
  // The panel owns its keys: Space, pad letters and Playlist hotkeys do not leak out.
  win.addEventListener('keydown', event => {
    const typing = event.target.closest('input:not([type=range]),textarea,select');
    if ((event.key === 'Escape' && !frame?.isDocked()) || (!typing && event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey && !event.altKey)) { event.preventDefault(); close(); }
    else if (event.key === ' ' && event.target !== list && !event.target.closest('button')) { event.preventDefault(); togglePreview(); }
    event.stopPropagation();
  });

  async function previewEntry(entry, play = true) {
    const mine = ++ticket, path = pathOf(entry.name);
    previewer.stop();
    current = { entry, path, sample: null, loading: true, error: '' }; renderViewer(); renderRows();
    try {
      const file = await entry.handle.getFile();
      if (mine !== ticket) return;
      const sample = await previewer.load(path, file);
      if (mine !== ticket) return;
      Object.assign(current, { sample, loading: false }); renderViewer();
      if (play) await previewer.play(sample, () => mine === ticket);
    } catch (error) {
      if (mine !== ticket) return;
      Object.assign(current, { loading: false, error: errorText(error) }); renderViewer();
      if (!accessLost(error)) setStatus(current.error);
    }
  }
  function stopPreview() { ticket++; previewer.stop(); }
  function togglePreview() {
    if (previewer.playing()) { stopPreview(); return; }
    if (current?.sample) { const mine = ++ticket; previewer.play(current.sample, () => mine === ticket).catch(error => setStatus(errorText(error))); }
    else if (current && !current.loading) previewEntry(current.entry);
  }
  // Click plays the whole sample once; right-click plays from the clicked point.
  function playFrom(offset) {
    if (!current?.sample) return;
    stopPreview();
    const mine = ++ticket;
    previewer.play(current.sample, () => mine === ticket, offset).catch(error => setStatus(errorText(error)));
  }
  wave.onclick = () => playFrom(0);
  wave.oncontextmenu = event => {
    event.preventDefault();
    if (!current?.sample) return;
    const box = wave.getBoundingClientRect();
    playFrom(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * current.sample.buffer.duration);
  };
  // What the Playlist imports: the preview buffer when it is still the same file, else the file.
  const itemFor = (entry, path) => ({ name: entry.name, async read() {
    stopPreview();
    let file;
    try { file = await entry.handle.getFile(); }
    catch (error) { if (accessLost(error)) throw new Error(t('Reconnect the samples folder in the browser.', 'Reconectá la carpeta de samples en el browser.')); throw new Error(errorText(error)); }
    const buffer = previewer.take(path, file); previewer.clear();
    return buffer ? { buffer } : { file };
  } });
  async function importEntry(entry, path, rack = false) {
    try {
      if (await (rack ? importToRack : importSamples)([itemFor(entry, path)])) setStatus(rack
        ? t(`«${entry.name}» added to the channel rack.`, `«${entry.name}» agregado al channel rack.`)
        : t(`«${entry.name}» added to the playlist.`, `«${entry.name}» agregado a la playlist.`));
    } catch (error) { setStatus(errorText(error)); }
  }

  function renderViewer() {
    const sample = current?.sample;
    sampleName.textContent = current ? current.entry.name : t('No sample selected', 'Ningún sample seleccionado');
    sampleName.title = current?.path || '';
    duration.textContent = sample ? clock(sample.buffer.duration) : current?.loading ? '…' : '';
    playButton.disabled = !current || !!current.error; rackButton.disabled = addButton.disabled = !current || current.entry.kind !== 'file';
    viewer.classList.toggle('is-error', !!current?.error);
    drawWave();
  }
  // Peaks are drawn once per file and size; only the playhead line moves while playing.
  function drawWave() {
    const scale = Math.min(2, devicePixelRatio || 1), width = Math.max(1, Math.round(wave.clientWidth * scale)), height = Math.max(1, Math.round(wave.clientHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
    const peaks = current?.sample?.peaks;
    if (!peaks) {
      ctx.fillStyle = '#3b3936'; ctx.fillRect(0, Math.floor(height / 2), width, Math.max(1, scale));
      if (current?.error || current?.loading) {
        ctx.fillStyle = current.error ? '#ff8f8f' : '#8f8a84'; ctx.font = `${11 * scale}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(current.error || t('Loading…', 'Cargando…'), width / 2, height / 2 - 10 * scale, width - 16);
      }
      return;
    }
    // Frequency colors, as in every other waveform of the app: bass red, mids green, treble blue.
    const buffer = current.sample.buffer, spectrum = spectrumNow(buffer);
    if (!spectrum) spectrumOf(buffer).then(() => { if (current?.sample?.buffer === buffer) drawWave(); }, () => {});
    const bins = spectrum?.peaks.length || 0;
    for (let x = 0; x < width; x++) {
      const from = Math.floor(x / width * peaks.length), to = Math.max(from + 1, Math.floor((x + 1) / width * peaks.length));
      let peak = 0; for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i]);
      if (spectrum) {
        const first = Math.floor(x / width * bins), last = Math.min(bins, Math.max(first + 1, Math.floor((x + 1) / width * bins)));
        let low = 0, mid = 0, high = 0;
        for (let i = first; i < last; i++) { low += spectrum.bands[i * 3]; mid += spectrum.bands[i * 3 + 1]; high += spectrum.bands[i * 3 + 2]; }
        ctx.fillStyle = spectrumColor(low, mid, high);
      } else ctx.fillStyle = '#858d96';
      const bar = Math.max(scale, Math.min(1, peak) * height * .9);
      ctx.fillRect(x, (height - bar) / 2, 1, bar);
    }
  }
  function renderPlaying(sample) {
    const on = !!sample;
    playButton.setAttribute('aria-pressed', String(on)); playButton.innerHTML = iconMarkup(on ? ICONS.stop : ICONS.play);
    const label = on ? t('Stop preview (Space)', 'Detener (Espacio)') : t('Play preview (Space)', 'Escuchar (Espacio)');
    playButton.title = label; playButton.setAttribute('aria-label', label);
    line.hidden = !on; cancelAnimationFrame(headFrame); headFrame = 0;
    if (on) headFrame = requestAnimationFrame(function follow() {
      const at = previewer.position();
      if (at === null) return;
      line.style.transform = `translateX(${at / sample.buffer.duration * wave.clientWidth}px)`;
      headFrame = requestAnimationFrame(follow);
    });
  }

  const focusInside = () => (access === 'granted' ? list : emptyAction.hidden ? win.querySelector('.module-control:last-child') : emptyAction)?.focus({ preventScroll: true });
  // The window frame calls this when it opens or closes.
  function setVisible(value) {
    onToggle?.(value);
    if (!value) {
      stopPreview(); clearTimeout(arrowTimer);
      if (back?.isConnected) back.focus({ preventScroll: true });
      back = null; return;
    }
    renderViewer(); scheduleRows();
    if (!loaded) { loaded = true; renderAccess(); connectSaved().then(() => { if (!win.hidden) focusInside(); }, error => setStatus(errorText(error))); }
  }
  function open(from = document.activeElement) {
    if (!frame.isOpen()) back = from instanceof HTMLElement && !win.contains(from) ? from : null;
    frame.reveal(); focusInside();
  }
  function close() { frame.close(); }
  renderAccess(); renderViewer();
  frame = mountModuleWindow({ id: 'browser', section: win, header: head, home: home || document.body, t,
    size: { width: 360, height: 480, right: 24, top: 96 }, setVisible, onShow() { scheduleRows(); drawWave(); } });
  return {
    open, close,
    // A browser hidden behind another window comes to the front first.
    toggle(from) { if (!frame.isOpen()) open(from); else frame.toggle(); },
    isOpen: () => frame.isOpen(),
    // Items for a drop on the Playlist or rack, or null if the drag did not start here.
    resolveDrop(dataTransfer) {
      if (!dragging || !dataTransfer?.types?.includes(BROWSER_DRAG_TYPE)) return null;
      const { entry, path } = dragging; dragging = null;
      return [itemFor(entry, path)];
    },
    // Preview audio held in memory; the Playlist adds it to its budget.
    reservedBytes: () => previewer.bytes(),
    dispose() {
      listing?.abort(); previewer.dispose(); sizeObserver.disconnect(); frame.dispose();
      cancelAnimationFrame(rowFrame); cancelAnimationFrame(headFrame); clearTimeout(arrowTimer); clearTimeout(statusTimer);
      win.remove();
    },
  };
}
