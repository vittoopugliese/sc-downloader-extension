import { SAMPLE_RATE, MAX_SECONDS, STEMS, encodeWav } from './stem-audio.mjs';
import { MODEL } from './stem-model.mjs';

const es = (globalThis.chrome?.i18n?.getUILanguage() || navigator.language).startsWith('es');
const words = {
  workspace: ['Your loop, layer by layer.', 'Tu loop, capa por capa.'], selected: ['SELECTED LOOP', 'LOOP SELECCIONADO'],
  extract: ['Unpack your sound.', 'Separá tu sonido.'], listen: ['Find your mix.', 'Encontrá tu mezcla.'], local: ['On-device', 'En tu equipo'],
  lows: ['Lows', 'Graves'], mids: ['Mids', 'Medios'], highs: ['Highs', 'Agudos'],
  experimental: ['Experimental', 'Experimental'], title: ["Hear what's inside your loop.", 'Escuchá qué hay dentro de tu loop.'],
  intro: ['Separate vocals, drums, bass and other instruments locally. Your audio stays in Chrome.', 'Separá voz, batería, bajo y otros instrumentos localmente. Tu audio se queda en Chrome.'],
  details: ['First use downloads a 166 MB model. Processing can take a few minutes and uses substantial memory. Up to 30 seconds, at original speed without effects.', 'El primer uso descarga un modelo de 166 MB. El proceso puede tardar unos minutos y consume bastante memoria. Hasta 30 segundos, a velocidad original y sin efectos.'],
  separate: ['Separate loop', 'Separar loop'], cancel: ['Cancel', 'Cancelar'], clearCache: ['Remove cached model', 'Eliminar modelo de la caché'],
  play: ['Play', 'Reproducir'], stop: ['Pause', 'Pausar'], repeat: ['Repeat loop', 'Repetir loop'], original: ['Original', 'Original'], mix: ['Stem mix', 'Mezcla de stems'],
  position: ['Position', 'Posición'], quality: ['Some bleed and artifacts are normal. Compare with the original. Downloads are stereo 44.1 kHz float WAV files.', 'Puede haber filtraciones y artefactos. Compará con el original. Las descargas son WAV estéreo de 44,1 kHz en coma flotante.'],
  footer: ['Audio stays on this device. Keep this tab open to retain your results.', 'El audio permanece en este equipo. Mantené esta pestaña abierta para conservar los resultados.'],
  ready: ['Ready. Separate this loop to compare the four stems.', 'Listo. Separá este loop para comparar los cuatro stems.'],
  preparing: ['Preparing the selected loop…', 'Preparando el loop seleccionado…'], downloading: ['Downloading model', 'Descargando modelo'],
  cache: ['Reading cached model', 'Leyendo modelo de la caché'], verify: ['Verifying model…', 'Verificando modelo…'], load: ['Loading separation model…', 'Cargando modelo de separación…'],
  running: ['Separating segment', 'Separando fragmento'], cancelled: ['Cancelled. You can try again.', 'Cancelado. Podés volver a intentarlo.'],
  cleared: ['Cached model removed.', 'Modelo eliminado de la caché.'], complete: ['Stems ready. Inference time:', 'Stems listos. Tiempo de inferencia:'],
  drums: ['Drums', 'Batería'], bass: ['Bass', 'Bajo'], other: ['Other', 'Otros'], vocals: ['Vocals', 'Voz'],
  mute: ['Mute', 'Mute'], solo: ['Solo', 'Solo'], volume: ['Volume', 'Volumen'], download: ['Download', 'Descargar'],
  another: ['Another tab is separating audio. Wait for it to finish or cancel it first.', 'Otra pestaña está separando audio. Esperá a que termine o cancelala primero.'],
  failed: ['Separation failed. Retry, or try a shorter loop and close other heavy tabs.', 'No se pudo separar. Reintentá o probá un loop más corto y cerrá otras pestañas pesadas.'],
};
const text = key => words[key]?.[es ? 1 : 0] || key;
const $ = id => document.getElementById(id);
document.documentElement.lang = es ? 'es' : 'en';
document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = text(node.dataset.copy); });
// Local inline icons keep the extension page self-contained.
const iconPaths = {
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  sliders: '<path d="M4 4v6m0 4v6M12 4v10m0 4v2M20 4v2m0 4v10M1 10h6m2 4h6m2-8h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  drums: '<ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v8c0 5 18 5 18 0V9M7 13v6m10-6v6M5 2l6 4m8-4-5 4"/>',
  bass: '<path d="M5 12v2m4-7v12m4-16v18m4-15v12m4-9v6"/>',
  other: '<path d="M3 4h18v16H3zM7 4v9h3V4m4 0v9h3V4M9 13v7m6-7v7"/>',
  vocals: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true');
  node.classList.add('icon'); node.innerHTML = iconPaths[name] || iconPaths.music;
  return node;
}
document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
function playLabel(active) { $('play').replaceChildren(icon(active ? 'pause' : 'play'), document.createTextNode(text(active ? 'stop' : 'play'))); }
const waveforms = new Set();
function seekTo(value) {
  const resume = playing; pause(); position = Math.max(0, Math.min(original.duration, value));
  updatePlayheads();
  if (resume) play().catch(error => status(error.message, true));
}
function updatePlayheads() {
  if (!original) return;
  const percent = Math.max(0, offset()) / original.duration * 100;
  for (const view of waveforms) {
    view.playhead.style.left = `${Math.min(100, percent)}%`;
    view.element.setAttribute('aria-valuenow', offset().toFixed(1));
  }
}
function mountWaveform(parent, buffer, label) {
  const element = document.createElement('div'); element.className = 'waveform';
  element.tabIndex = 0; element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', label); element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', String(buffer.duration)); element.setAttribute('aria-valuenow', '0');
  element.addEventListener('keydown', event => {
    const steps = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1 };
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    seekTo(event.key === 'Home' ? 0 : event.key === 'End' ? original.duration : offset() + steps[event.key]);
  });
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
  const playhead = document.createElement('span'); playhead.className = 'waveform-playhead'; playhead.setAttribute('aria-hidden', 'true');
  element.append(canvas, playhead); parent.append(element);
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width * original.duration);
  });
  const controller = new AbortController();
  const view = { element, playhead, draw: () => drawWaveform(), dispose() { controller.abort(); observer.disconnect(); waveforms.delete(view); element.remove(); } };
  waveforms.add(view);
  const ui = { waveformCanvas: canvas, panel: $('audition') };
  const waveformCollapsed = false, waveformSamples = [], waveformDrawPreview = null;
  let waveformSpectrum, waveformStaticKey = '', waveformRevision = 0;
  const loopState = { durationMs: buffer.duration * 1000 };
  const visibleWaveformWindow = () => ({ startMs: 0, endMs: loopState.durationMs });
  const loopPercentInWindow = (time, range) => (time - range.startMs) / (range.endMs - range.startMs) * 100;
  // Copied from tempo-control-main.js: same physical-pixel peak aggregation,
  // RGB energy mapping and normalization as the Player Tools looper.
  function drawWaveform() {
    if (!ui?.waveformCanvas || waveformCollapsed || ui.panel.hidden || document.hidden) return;
    const canvas = ui.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const windowRange = visibleWaveformWindow();
    const displayedRange = waveformDrawPreview || loopState;
    const drawKey = JSON.stringify([waveformRevision, width, height, scale,
      loopState.durationMs, windowRange?.startMs, windowRange?.endMs,
      displayedRange.startMs, displayedRange.endMs, loopState.active]);
    if (drawKey === waveformStaticKey) return;
    waveformStaticKey = drawKey;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0e1216";
    context.fillRect(0, 0, width, height);
    if (!windowRange) return;
    const durationMs = loopState.durationMs;
    const samples = waveformSpectrum?.peaks || waveformSamples;
    const complete = Number.isFinite(displayedRange.startMs) && Number.isFinite(displayedRange.endMs);
    const start = complete ? loopPercentInWindow(displayedRange.startMs, windowRange) : -1;
    const end = complete ? loopPercentInWindow(displayedRange.endMs, windowRange) : -1;
    // One column per physical pixel; peak aggregation preserves short transients.
    let maximum = 0;
    for (const sample of samples) maximum = Math.max(maximum, Math.abs(Number(sample) || 0));
    if (!samples.length || !maximum) return;
    const bands = waveformSpectrum?.bands;
    const sourceDuration = waveformSpectrum?.durationMs || durationMs;
    for (let x = 0; x < width; x += 1) {
      const from = (windowRange.startMs + x / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      const to = (windowRange.startMs + (x + 1) / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      let peak = 0, low = 0, mid = 0, high = 0;
      for (let i = Math.max(0, Math.floor(from)); i < Math.min(samples.length, Math.max(Math.floor(from) + 1, Math.ceil(to))); i += 1) {
        peak = Math.max(peak, Math.abs(Number(samples[i]) || 0));
        if (bands) { low += bands[i * 3]; mid += bands[i * 3 + 1]; high += bands[i * 3 + 2]; }
      }
      const energy = Math.max(low, mid, high);
      context.fillStyle = bands && energy > 0
        ? 'rgb(' + [low, mid, high].map(value => Math.round(55 + 190 * Math.sqrt(value / energy))).join(',') + ')'
        : '#858d96';
      const percent = x / width * 100;
      context.globalAlpha = complete && (percent < start || percent > end) ? .58 : .96;
      const barHeight = peak / maximum * height * .88;
      context.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }
    context.globalAlpha = 1;
  }


  const observer = new ResizeObserver(drawWaveform); observer.observe(canvas);
  globalThis.SCSpectralWaveform.analyze(buffer, controller.signal).then(spectrum => {
    if (controller.signal.aborted) return;
    waveformSpectrum = spectrum; waveformRevision++; drawWaveform(); updatePlayheads();
  }).catch(error => { if (error.name !== 'AbortError') console.error('[Stems waveform]', error); });
  return view;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const view of waveforms) view.draw();
});
const jobId = new URL(location.href).searchParams.get('job');
let original, buffers = [], context, nodes = [], outputs = [], urls = [];
let mode = 'original', playing = false, position = 0, startedAt = 0;
let busy = false, revision = 0, worker, rejectWorker, title = 'Loop', initialized = false;
let states = STEMS.map(() => ({ muted: false, solo: false, gain: 1 }));

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function message(type) {
  const result = await chrome.runtime.sendMessage({ type, jobId });
  if (!result?.success) throw new Error(result?.error || 'The extension could not prepare this loop.');
  return result;
}
function setBusy(value) {
  busy = value;
  $('separate').disabled = value || !initialized;
  $('cancel').hidden = !value;
  $('clear-cache').disabled = value;
  $('progress').hidden = !value;
}
function audioBuffer(channels) {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: channels[0].length, sampleRate: SAMPLE_RATE });
  channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
  return buffer;
}
function offset() {
  if (!playing) return position;
  const value = Math.max(0, position + context.currentTime - startedAt);
  return $('repeat').checked ? value % original.duration : Math.min(value, original.duration);
}
function pause() {
  position = offset(); playing = false;
  for (const { source, gain } of nodes) { source.stop(); source.disconnect(); gain.disconnect(); }
  nodes = [];
  playLabel(false); updatePlayheads();
}
function applyMix() {
  const solo = states.some(state => state.solo);
  nodes.forEach(({ gain }, index) => {
    const state = states[index - 1];
    const value = index === 0 ? Number(mode === 'original') :
      mode === 'mix' && !state.muted && (!solo || state.solo) ? state.gain : 0;
    gain.gain.setTargetAtTime(value, context.currentTime, 0.008);
  });
  document.querySelectorAll('.stem').forEach((row, index) => {
    const state = states[index];
    row.classList.toggle('is-silent', mode === 'original' || state.muted || (solo && !state.solo) || state.gain === 0);
  });
  $('original').setAttribute('aria-pressed', String(mode === 'original'));
  $('mix').setAttribute('aria-pressed', String(mode === 'mix'));
}
async function play() {
  if (!original || playing) return;
  context ||= new AudioContext({ sampleRate: SAMPLE_RATE });
  await context.resume();
  if (playing) return;
  if (position >= original.duration) position = 0;
  startedAt = context.currentTime + 0.03;
  nodes = [original, ...buffers].map(buffer => {
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = $('repeat').checked;
    gain.gain.value = 0; source.connect(gain).connect(context.destination);
    source.start(startedAt, position);
    return { source, gain };
  });
  playing = true; applyMix(); playLabel(true);
}
function disposeResults() {
  pause(); buffers = []; outputs = [];
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  for (const view of waveforms) if ($('stems').contains(view.element)) view.dispose();
  $('stems').replaceChildren(); $('mix').disabled = true; $('quality-note').hidden = true;
  mode = 'original'; applyMix();
}
function showResults(result) {
  disposeResults(); position = 0;
  outputs = result.outputs;
  buffers = outputs.map(audioBuffer);
  states = STEMS.map(() => ({ muted: false, solo: false, gain: 1 }));
  STEMS.forEach((stem, index) => {
    const row = document.createElement('div'); row.className = 'stem';
    const name = document.createElement('h2'); name.append(icon(stem), document.createTextNode(text(stem)));
    const controls = ['mute', 'solo'].map(kind => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text(kind);
      button.setAttribute('aria-label', `${text(kind)} ${text(stem)}`); button.setAttribute('aria-pressed', 'false');
      button.onclick = () => {
        const key = kind === 'mute' ? 'muted' : 'solo';
        states[index][key] = !states[index][key];
        button.setAttribute('aria-pressed', String(states[index][key])); mode = 'mix'; applyMix();
      };
      return button;
    });
    const volume = document.createElement('div'); volume.className = 'stem-volume';
    const caption = document.createElement('span'); caption.textContent = text('volume');
    const knob = document.createElement('button'); knob.type = 'button'; knob.className = 'pad-knob';
    knob.setAttribute('role', 'slider'); knob.setAttribute('aria-label', `${text('volume')} ${text(stem)}`);
    knob.setAttribute('aria-valuemin', '0'); knob.setAttribute('aria-valuemax', '100'); knob.setAttribute('aria-orientation', 'vertical');
    const level = document.createElement('output');
    const renderVolume = () => {
      const value = Math.round(states[index].gain * 100);
      knob.style.setProperty('--knob-angle', `${-135 + value * 2.7}deg`);
      knob.setAttribute('aria-valuenow', String(value)); knob.setAttribute('aria-valuetext', `${value}%`);
      knob.title = `${text('volume')}: ${value}% · ${es ? 'Doble clic para restablecer' : 'Double-click to reset'}`;
      level.textContent = `${value}%`;
    };
    const updateVolume = value => { states[index].gain = Math.round(Math.max(0, Math.min(100, value))) / 100; renderVolume(); mode = 'mix'; applyMix(); };
    let drag;
    knob.onpointerdown = event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, y: event.clientY, value: states[index].gain * 100 };
      knob.setPointerCapture(event.pointerId); knob.focus(); event.preventDefault();
    };
    knob.onpointermove = event => { if (drag?.id === event.pointerId) updateVolume(drag.value + (drag.y - event.clientY) * 100 / 140); };
    for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) knob.addEventListener(kind, () => { drag = null; });
    knob.ondblclick = () => updateVolume(100);
    knob.onkeydown = event => {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      updateVolume(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : states[index].gain * 100 +
        (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 10 : 1));
    };
    renderVolume(); volume.append(caption, knob, level);
    const link = document.createElement('a'); link.className = 'download';
    const url = URL.createObjectURL(new Blob([encodeWav(outputs[index])], { type: 'audio/wav' })); urls.push(url);
    link.href = url; link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}_${stem}.wav`;
    link.append(icon('download'), document.createTextNode('WAV')); link.setAttribute('aria-label', `${text('download')} ${text(stem)}`);
    const actions = document.createElement('div'); actions.className = 'stem-actions'; actions.append(...controls, link, volume);
    row.append(name, actions); $('stems').append(row);
    mountWaveform(row, buffers[index], `${text(stem)} · ${text('position')}`);
  });
  outputs = [];
  $('mix').disabled = false; $('quality-note').hidden = false; mode = 'mix'; applyMix();
  status(`${text('complete')} ${result.seconds.toFixed(1)} s.`);
}

function runWorker(channels) {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./stem-worker.mjs', import.meta.url), { type: 'module' });
    rejectWorker = reject;
    const timeout = setTimeout(() => reject(new Error('Separation timed out. Try a shorter loop.')), 20 * 60 * 1000);
    const finish = (fn, value) => { clearTimeout(timeout); rejectWorker = null; fn(value); };
    rejectWorker = error => finish(reject, error);
    worker.onerror = event => finish(reject, new Error(event.message || text('failed')));
    worker.onmessageerror = () => finish(reject, new Error(text('failed')));
    worker.onmessage = ({ data }) => {
      if (data.type === 'complete') return finish(resolve, data);
      if (data.type === 'error') return finish(reject, new Error(data.message));
      if (data.type !== 'progress') return;
      if (data.phase === 'download' || data.phase === 'cache') {
        $('progress').value = data.received / data.total;
        status(`${text(data.phase === 'download' ? 'downloading' : 'cache')}: ${(data.received / 1e6).toFixed(0)} / 166 MB`);
      } else if (data.phase === 'run') {
        $('progress').value = data.completed / data.total;
        status(`${text('running')} ${Math.min(data.completed + 1, data.total)} / ${data.total}…`);
      } else if (data.phase === 'load' || data.phase === 'verify') {
        $('progress').removeAttribute('value'); status(text(data.phase));
      }
    };
    worker.postMessage({ type: 'separate', channels }, channels.map(channel => channel.buffer));
  });
}
async function separate() {
  if (busy) return;
  const version = ++revision;
  setBusy(true); $('progress').removeAttribute('value');
  try {
    await navigator.locks.request('scdl-stem-inference', { ifAvailable: true }, async lock => {
      if (!lock) throw new Error(text('another'));
      if (!original) {
        status(text('preparing'));
        const result = await message('STEM_LOOP_RENDER');
        if (version !== revision) return;
        if (!/^data:audio\/[^;,]+;base64,/.test(result.instrument?.dataUrl || '')) throw new Error('Invalid loop audio.');
        const bytes = await (await fetch(result.instrument.dataUrl)).arrayBuffer();
        const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
        const decoded = await decoder.decodeAudioData(bytes);
        if (version !== revision) return;
        if (!decoded.length || decoded.duration > MAX_SECONDS + 1 / SAMPLE_RATE) throw new Error('The rendered loop exceeds 30 seconds.');
        original = audioBuffer([decoded.getChannelData(0), decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1))]);
        $('audition').hidden = false;
        mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
      }
      if (version !== revision) return;
      const result = await runWorker([original.getChannelData(0).slice(), original.getChannelData(1).slice()]);
      if (version === revision) showResults(result);
    });
  } catch (error) {
    if (version === revision) { console.error('[Stems]', error); status(`${text('failed')} ${error.message}`, true); }
  } finally {
    if (version === revision) { worker?.terminate(); worker = null; rejectWorker = null; setBusy(false); }
  }
}
async function cancel() {
  revision++;
  rejectWorker?.(new DOMException('Cancelled', 'AbortError')); rejectWorker = null;
  worker?.terminate(); worker = null;
  await message('STEM_LOOP_CANCEL').catch(() => {});
  setBusy(false); status(text('cancelled'));
}
$('separate').onclick = separate; $('cancel').onclick = cancel;
$('clear-cache').onclick = async () => {
  try { await caches.delete(MODEL.cache); status(text('cleared')); } catch (error) { status(error.message, true); }
};
$('play').onclick = () => { if (playing) pause(); else play().catch(error => status(error.message, true)); };
$('original').onclick = () => { mode = 'original'; applyMix(); };
$('mix').onclick = () => { mode = 'mix'; applyMix(); };
$('repeat').onchange = () => { const resume = playing; pause(); if (resume) play().catch(error => status(error.message, true)); };
let animationFrame;
function animate() {
  updatePlayheads();
  animationFrame = requestAnimationFrame(animate);
}
animate();
const timeInterval = setInterval(() => {
  if (!original) return;
  const current = Math.max(0, offset());
  if (playing && !$('repeat').checked && current >= original.duration) { pause(); position = 0; }
  $('time').textContent = `${current.toFixed(1)} / ${original.duration.toFixed(1)} s`;
}, 100);
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame); clearInterval(timeInterval);
  for (const view of waveforms) view.dispose();
  worker?.terminate(); pause(); context?.close(); urls.forEach(url => URL.revokeObjectURL(url));
  chrome.runtime.sendMessage({ type: 'STEM_LOOP_CANCEL', jobId }).catch(() => {});
});
try {
  const info = await message('STEM_LOOP_INFO');
  title = info.title; $('track').textContent = title;
  const metadata = [info.artist];
  if (Number.isFinite(info.durationMs) && info.durationMs > 0) {
    const seconds = Math.floor(info.durationMs / 1000);
    metadata.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  }
  $('track-meta').textContent = metadata.filter(Boolean).join(' · ');
  $('track-meta').hidden = !$('track-meta').textContent;
  if (typeof info.artworkUrl === 'string' && /^https:\/\//i.test(info.artworkUrl)) {
    const artwork = $('artwork');
    artwork.onload = () => { artwork.hidden = false; $('artwork-fallback').hidden = true; };
    artwork.onerror = () => { artwork.hidden = true; $('artwork-fallback').hidden = false; };
    artwork.src = info.artworkUrl;
  }
  $('range').textContent = `A ${(info.trimRange.startMs / 1000).toFixed(2)} s → B ${(info.trimRange.endMs / 1000).toFixed(2)} s · ${((info.trimRange.endMs - info.trimRange.startMs) / 1000).toFixed(2)} s`;
  initialized = true; setBusy(false); status(text('ready'));
} catch (error) { status(error.message, true); }
