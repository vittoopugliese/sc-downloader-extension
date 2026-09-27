const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('./spectral-waveform.js');
require('./spectral-waveform-stream.js');

async function main() {
  const pcm = Float32Array.from({ length: 48000 }, (_, i) => .7 * Math.sin(i * .31) + .2 * Math.sin(i * .007));
  pcm[11999] = 1;
  const channels = [pcm, pcm.map(value => -value)];
  const reference = await SCSpectralWaveform.analyze({ sampleRate: 48000, length: pcm.length,
    numberOfChannels: 2, getChannelData: index => channels[index] });
  const accumulator = SCSpectralWaveformStream.createAccumulator(48000, 1000);
  for (let offset = 0; offset < pcm.length; offset += 137) {
    accumulator.push(channels.map(channel => channel.subarray(offset, offset + 137)));
  }
  const streamedPcm = accumulator.finish();
  assert.deepEqual(streamedPcm.peaks, reference.peaks, 'Chunk boundaries must not change peaks');
  assert.equal(streamedPcm.durationMs, reference.durationMs);
  reference.bands.forEach((value, i) => assert.ok(Math.abs(value - streamedPcm.bands[i]) <= Math.max(1e-7, Math.abs(value) * 2e-7),
    'Continuous filters must match whole-buffer band energy'));
  assert.equal(SCSpectralWaveform.needsStreaming(24 * 60 * 1000), true);
  assert.equal(SCSpectralWaveform.needsStreaming(10 * 60 * 1000), false);

  let streamed = 0;
  const scope = vm.createContext({
    URL, ArrayBuffer, Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout,
    SCSpectralWaveform,
    SCSpectralWaveformStream: { async analyze(chunks, durationMs) {
      for await (const chunk of chunks) streamed += chunk.length;
      return { peaks: [.8], bands: [1, 0, 0], durationMs };
    } },
    AudioContext: class { constructor() { throw new Error('Long tracks must not decode into one AudioBuffer'); } },
    fetch: async () => ({ ok: true, body: { getReader() { let sent = false; return {
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: new Uint8Array([255, 251, 144, 0]) }; },
      releaseLock() {}, async cancel() {},
    }; } } }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'download-core.js'), 'utf8'), scope);
  const download = vm.runInContext('SCDownload', scope);
  const result = await download.buildTrackBlob('https://example.test/long.mp3',
    { streamProtocol: 'progressive', streamMimeType: 'audio/mpeg', durationMs: 24 * 60 * 1000 },
    null, null, null, null, null, false, true);
  assert.equal(result.success, true);
  assert.equal(result.waveform.durationMs, 1440000);
  assert.equal(streamed, 4);
  console.log('Long waveform routes through bounded decoding instead of the full-track PCM budget.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
