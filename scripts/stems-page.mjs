import { SAMPLE_RATE, MAX_SECONDS, STEMS, encodeWav } from './stem-audio.mjs';
import { MODEL } from './stem-model.mjs';

const es = (globalThis.chrome?.i18n?.getUILanguage() || navigator.language).startsWith('es');
const words = {
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
  $('play').textContent = text('play');
}
function applyMix() {
  const solo = states.some(state => state.solo);
  nodes.forEach(({ gain }, index) => {
    const state = states[index - 1];
    const value = index === 0 ? Number(mode === 'original') :
      mode === 'mix' && !state.muted && (!solo || state.solo) ? state.gain : 0;
    gain.gain.setTargetAtTime(value, context.currentTime, 0.008);
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
  playing = true; applyMix(); $('play').textContent = text('stop');
}
function disposeResults() {
  pause(); buffers = []; outputs = [];
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
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
    const name = document.createElement('h2'); name.textContent = text(stem);
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
    const label = document.createElement('label'); label.textContent = `${text('volume')} ${text(stem)}`;
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.value = '100';
    input.setAttribute('aria-label', `${text('volume')} ${text(stem)}`);
    const level = document.createElement('output'); level.textContent = '100%';
    input.oninput = () => { states[index].gain = Number(input.value) / 100; level.textContent = `${input.value}%`; mode = 'mix'; applyMix(); };
    label.append(input);
    const link = document.createElement('a'); link.className = 'download';
    const url = URL.createObjectURL(new Blob([encodeWav(outputs[index])], { type: 'audio/wav' })); urls.push(url);
    link.href = url; link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}_${stem}.wav`;
    link.textContent = 'WAV'; link.setAttribute('aria-label', `${text('download')} ${text(stem)}`);
    row.append(name, ...controls, label, level, link); $('stems').append(row);
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
        $('seek').max = String(original.duration); $('audition').hidden = false;
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
$('seek').oninput = () => { const resume = playing; pause(); position = Number($('seek').value); if (resume) play().catch(error => status(error.message, true)); };
setInterval(() => {
  if (!original) return;
  const current = Math.max(0, offset());
  if (playing && !$('repeat').checked && current >= original.duration) { pause(); position = 0; }
  $('seek').value = String(current); $('time').textContent = `${current.toFixed(1)} / ${original.duration.toFixed(1)} s`;
}, 100);
window.addEventListener('pagehide', () => {
  worker?.terminate(); pause(); context?.close(); urls.forEach(url => URL.revokeObjectURL(url));
  chrome.runtime.sendMessage({ type: 'STEM_LOOP_CANCEL', jobId }).catch(() => {});
});
try {
  const info = await message('STEM_LOOP_INFO');
  title = info.title; $('track').textContent = title;
  $('range').textContent = `A ${(info.trimRange.startMs / 1000).toFixed(2)} s → B ${(info.trimRange.endMs / 1000).toFixed(2)} s · ${((info.trimRange.endMs - info.trimRange.startMs) / 1000).toFixed(2)} s`;
  initialized = true; setBusy(false); status(text('ready'));
} catch (error) { status(error.message, true); }
