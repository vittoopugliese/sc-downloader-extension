const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((_req, res) => res.end('<!doctype html><title>Waveform test</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const file of ['spectral-waveform.js', 'spectral-waveform-stream.js', 'download-core.js']) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const result = await page.evaluate(async () => {
      // A valid MPEG-1 Layer III silence frame: 48 kHz, stereo, 128 kbps.
      // 60,000 frames x 1,152 samples = exactly 24 min, generated on demand.
      const frameBytes = 384, frameCount = 60000;
      let readBytes = 0, closed = false, largestChunk = 0, fullDecodes = 0;
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        decodeAudioData(...args) { fullDecodes++; return super.decodeAudioData(...args); }
      };
      window.fetch = async () => ({ ok: true, body: { getReader: () => ({
        async read() {
          if (readBytes >= frameBytes * frameCount) return { done: true };
          const length = Math.min(32749, frameBytes * frameCount - readBytes);
          const bytes = new Uint8Array(length);
          for (let i = 0; i < length; i++) {
            const pos = (readBytes + i) % frameBytes;
            bytes[i] = pos < 4 ? [255, 251, 148, 0][pos] : 0;
          }
          readBytes += length;
          largestChunk = Math.max(largestChunk, length);
          return { done: false, value: bytes };
        },
        async cancel() { closed = true; }, releaseLock() {},
      }) } });
      const started = performance.now();
      const result = await SCDownload.buildTrackBlob('https://example.test/24min.mp3', {
        durationMs: 1440000, streamProtocol: 'progressive', streamMimeType: 'audio/mpeg',
      }, null, null, null, null, null, false, true);
      return { success: result.success, durationMs: result.waveform.durationMs,
        bins: result.waveform.peaks.length, silent: result.waveform.bands.every(value => value === 0),
        fullDecodes, largestChunk, closed, seconds: (performance.now() - started) / 1000 };
    });
    assert.equal(result.success, true);
    assert.equal(result.durationMs, 1440000);
    assert.ok(result.bins > 60000 && result.bins <= 65536);
    assert.equal(result.silent, true);
    assert.equal(result.fullDecodes, 0, 'Long audio must never enter decodeAudioData');
    assert.ok(result.largestChunk <= 32749);
    assert.equal(result.closed, true);
    console.log('24-minute real MP3 decode passed:', result);
    const edgeCases = await page.evaluate(async () => {
      const pcmFrames = new Uint8Array(384 * 100);
      for (let i = 0; i < 100; i++) pcmFrames.set([255, 251, 148, 0], i * 384);
      const metadata = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
      const first = new Uint8Array(metadata.length + 384 * 50);
      first.set(metadata); first.set(pcmFrames.subarray(0, 384 * 50), metadata.length);
      const second = new Uint8Array(384 * 50 + 128);
      second.set(pcmFrames.subarray(384 * 50)); second.set([84, 65, 71], 384 * 50);
      let liveReaders = 0, maxReaders = 0, released = 0;
      window.fetch = async url => {
        const bytes = String(url).endsWith('.m3u8')
          ? new TextEncoder().encode('#EXTM3U\n#EXTINF:1.2,\nfirst.mp3\n#EXTINF:1.2,\nsecond.mp3\n#EXT-X-ENDLIST')
          : String(url).endsWith('first.mp3') ? first : second;
        return { ok: true, body: { getReader() {
          liveReaders++; maxReaders = Math.max(maxReaders, liveReaders);
          let offset = 0;
          return {
            async read() {
              if (offset >= bytes.length) return { done: true };
              const value = bytes.slice(offset, offset + 113); offset += value.length;
              return { done: false, value };
            },
            async cancel() {}, releaseLock() { liveReaders--; released++; },
          };
        } } };
      };
      const hls = await SCDownload.buildTrackBlob('https://example.test/audio.m3u8', {
        durationMs: 1440000, streamProtocol: 'hls', streamMimeType: 'audio/mpeg',
      }, null, null, null, null, null, false, true);

      const abort = new AbortController();
      let sourceClosed = false;
      async function* cancelledSource() {
        try { yield pcmFrames.subarray(0, 384); abort.abort(); yield pcmFrames; }
        finally { sourceClosed = true; }
      }
      let cancellation;
      try { await SCSpectralWaveformStream.analyze(cancelledSource(), 1440000, abort.signal); }
      catch (error) { cancellation = error.name; }
      let truncated;
      async function* partialSource() { yield pcmFrames.subarray(0, pcmFrames.length - 1); }
      try { await SCSpectralWaveformStream.analyze(partialSource(), 1440000); }
      catch (error) { truncated = error.message; }
      return { hlsDuration: hls.waveform.durationMs, maxReaders, released, liveReaders,
        cancellation, sourceClosed, truncated };
    });
    assert.equal(edgeCases.hlsDuration, 2400, 'HLS metadata and segment boundaries must not add audio gaps');
    assert.equal(edgeCases.maxReaders, 1, 'Only one HLS segment may be retained at a time');
    assert.equal(edgeCases.released, 3);
    assert.equal(edgeCases.liveReaders, 0);
    assert.equal(edgeCases.cancellation, 'AbortError');
    assert.equal(edgeCases.sourceClosed, true);
    assert.match(edgeCases.truncated, /Incomplete/);
    console.log('Long HLS, ID3 metadata, split frames, cancellation and truncated input passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
