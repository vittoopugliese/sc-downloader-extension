const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('./spectral-waveform.js');
const sampleRate = 48000;
function audio(frequency, stereo = false) {
  const pcm = Float32Array.from({ length: sampleRate }, (_, i) => .8 * Math.sin(2 * Math.PI * frequency * i / sampleRate));
  return { sampleRate, length: pcm.length, numberOfChannels: stereo ? 2 : 1,
    getChannelData: channel => channel ? pcm.map(value => -value) : pcm };
}
async function main() {
  await verifyLoading();
  for (const [frequency, band] of [[60, 0], [1000, 1], [10000, 2]]) {
    const result = await SCSpectralWaveform.analyze(audio(frequency));
    const energies = [0, 0, 0];
    result.bands.forEach((value, i) => { energies[i % 3] += value; });
    assert.equal(energies.indexOf(Math.max(...energies)), band, `${frequency} Hz must dominate its color band`);
    assert.equal(result.peaks.length, 200);
    assert.equal(result.durationMs, 1000);
    const stereo = await SCSpectralWaveform.analyze(audio(frequency, true));
    assert.deepEqual(stereo.peaks, result.peaks, 'Out-of-phase stereo must retain its peaks');
    assert.ok(stereo.bands[30 + band] >= result.bands[30 + band] * 1.99);
  }
  const silence = await SCSpectralWaveform.analyze(audio(0));
  assert.ok(silence.peaks.every(value => value === 0));
  assert.ok(silence.bands.every(value => value === 0));
  const impulse = audio(0); impulse.getChannelData()[47999] = 1;
  const peaks = await SCSpectralWaveform.analyze(impulse);
  assert.equal(peaks.peaks.at(-1), 1, 'Final transient must survive downsampling');
  await assert.rejects(SCSpectralWaveform.analyze(audio(60), { aborted: true }), { name: 'AbortError' });

  // Exercise the real acquisition/decode entry point, without WAV export or FX.
  let closed = 0;
  const scope = vm.createContext({ console, URL, Blob, ArrayBuffer, Uint8Array, TextDecoder,
    AbortController, setTimeout, clearTimeout, SCSpectralWaveform,
    AudioContext: class { sampleRate = 48000; async decodeAudioData() { return audio(60); } async close() { closed++; } },
    fetch: async () => ({ ok: true, body: { getReader() { let sent = false; return {
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: new Uint8Array(4) }; },
      releaseLock() {}, async cancel() {},
    }; } } }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'download-core.js'), 'utf8'), scope);
  const download = vm.runInContext('SCDownload', scope);
  const result = await download.buildTrackBlob('https://example.test/audio.mp3',
    { streamProtocol: 'progressive', durationMs: 1000 }, null, null, null, null, null, false, true);
  assert.equal(result.success, true);
  assert.equal(result.waveform.peaks.length, 200);
  assert.equal(closed, 1);
  console.log('Spectral waveform: frequency bands, stereo, silence, transients, cancellation and decode passed.');
}
async function verifyLoading() {
  const source = fs.readFileSync(path.join(__dirname, 'tempo-control-main.js'), 'utf8');
  const loading = source.slice(source.indexOf('  async function loadPlayerWaveform()'), source.indexOf('  function commitLoopRender()'));
  const pending = new Map();
  let requests = 0;
  let descriptor;
  const scope = vm.createContext({
    document: { documentElement: { getAttribute: () => JSON.stringify(descriptor) } },
    requestPad: (_action, { trackUrl }) => new Promise((resolve, reject) => {
      requests++;
      pending.set(trackUrl, { resolve, reject });
    }),
    renderLoop() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'player-tools-i18n.js'), 'utf8'), scope);
  scope.pt = scope.SCPlayerToolsText.t;
  vm.runInContext(`
    let waveformCollapsed = false, waveformSamples = [], waveformSpectrum = null;
    let waveformTrackUrl = null, waveformSourceUrl = null, waveformZoom = null;
    let waveformRevision = 0, waveformLoadId = 0, waveformAnalysisCache = null;
    const PLAYER_WAVEFORM_ATTRIBUTE = 'waveform';
    const ui = { waveformCanvas: {}, panel: { hidden: false } };
    ${loading}
  `, scope);
  const load = () => vm.runInContext('loadPlayerWaveform()', scope);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const data = { peaks: [.8], bands: [1, 0, 0], durationMs: 1000 };
  descriptor = { trackUrl: 'a', waveformUrl: null };
  await load();
  await load();
  assert.equal(requests, 1, 'Repeated updates must share the pending analysis');
  descriptor = { trackUrl: 'a' };
  await load();
  assert.equal(requests, 1, 'Missing and null waveform URLs identify the same source');
  descriptor = { trackUrl: 'b', waveformUrl: null };
  await load();
  pending.get('a').resolve({ waveform: data });
  await flush();
  assert.equal(vm.runInContext('waveformSpectrum', scope), null, 'Stale track analysis must be ignored');
  pending.get('b').resolve({ waveform: data });
  await flush();
  assert.equal(vm.runInContext('waveformSpectrum', scope), data);
  descriptor = { trackUrl: 'c', waveformUrl: null };
  await load();
  assert.equal(vm.runInContext('waveformSpectrum', scope), null, 'Track switch clears previous colors immediately');
  pending.get('c').reject(new Error('Unavailable'));
  await flush();
  assert.match(vm.runInContext('ui.waveformCanvas.title', scope), /unavailable/);
  // Reopening the same track after a transient analysis failure must recover.
  pending.delete('c');
  await load();
  assert.equal(pending.has('c'), true, 'Blank waveform must retry the same track after a failed load');
  pending.get('c').resolve({ waveform: data });
  await flush();
  assert.equal(vm.runInContext('waveformSpectrum', scope), data, 'Retry restores visible waveform data');
  const completedRequests = requests;
  await load();
  assert.equal(requests, completedRequests, 'Loaded analysis must not be fetched again');
  vm.runInContext('ui.panel.hidden = true', scope);
  descriptor = { trackUrl: 'd', waveformUrl: null };
  await load();
  assert.equal(pending.has('d'), false, 'Hidden panel must not start audio analysis');
  vm.runInContext('ui.panel.hidden = false', scope);
  await load();
  vm.runInContext('waveformCollapsed = true; waveformLoadId++', scope);
  pending.get('d').resolve({ waveform: data });
  await flush();
  assert.equal(vm.runInContext('waveformSpectrum', scope), null, 'Collapsing must invalidate pending results');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
