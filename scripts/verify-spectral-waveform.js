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
main().catch(error => { console.error(error); process.exitCode = 1; });
