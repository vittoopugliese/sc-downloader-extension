const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual Stems job -> download/render pipeline. Network and codec
// output are deterministic, while playlist selection, budgets and trimming are real.
(async () => {
  const requests = [], decodedSeconds = [];
  let loopSeconds = 20;
  const playlist = '#EXTM3U\n' + Array.from({ length: 150 }, (_, i) => `#EXTINF:10,\nhttps://audio.test/${i}.mp3`).join('\n') + '\n#EXT-X-ENDLIST';
  const scope = vm.createContext({ console, URL, Blob, ArrayBuffer, DataView, Uint8Array, Float32Array,
    chrome: {}, SCDownloadDestination: { create: () => ({}) }, SCTrackDownloadExecution: { create: () => ({}) },
    AbortController, DOMException, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto,
    fetch: async url => {
      requests.push(String(url));
      return new Response(String(url).endsWith('.m3u8') ? playlist : new Uint8Array([Number(new URL(url).pathname.slice(1).split('.')[0])]), {
        headers: { 'Content-Type': String(url).endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'audio/mpeg' },
      });
    },
    AudioContext: class {
      sampleRate = 48000;
      async decodeAudioData(bytes) {
        const parts = new Uint8Array(bytes), length = parts.length * 10 * this.sampleRate;
        decodedSeconds.push(length / this.sampleRate);
        assert.ok(length / this.sampleRate <= loopSeconds + 20, 'Only the selected HLS window may be decoded');
        return { sampleRate: this.sampleRate, length, numberOfChannels: 2, duration: length / this.sampleRate,
          getChannelData: () => Float32Array.from({ length }, (_, i) => parts[Math.floor(i / (48000 * 10))] / 200) };
      }
      async close() {}
    },
  });
  for (const name of ['format-utils.js', 'loop-audio-renderer.js', 'download-core.js', 'stem-jobs.js',
    'stream-selector.js', 'download-track.js', 'soundcloud-http.js', 'download-source.js', 'bulk-job-manager.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), scope, { filename: name });
  }
  const download = vm.runInContext('SCDownload', scope), storage = {};
  const track = { id: 1, clientId: 'fixture', title: '25 minute set', durationMs: 1500000,
    streamUrl: 'https://api-v2.soundcloud.com/media/progressive', streamProtocol: 'progressive', streamMimeType: 'audio/mpeg' };
  const source = vm.runInContext('SCDownloadSource', scope);
  source.configure({ getOAuthToken: async () => null, request: async url => {
    if (new URL(url).pathname === '/tracks') return Response.json([{ id: 1, title: track.title, duration: track.durationMs,
      media: { transcodings: [{ url: 'https://api-v2.soundcloud.com/media/adaptive', preset: 'abr_sq',
        format: { protocol: 'hls', mime_type: 'audio/mpegurl' } }, ...['progressive', 'hls'].map(protocol => ({
        url: `https://api-v2.soundcloud.com/media/${protocol}`, preset: 'mp3_0_1', format: { protocol, mime_type: 'audio/mpeg' },
      }))] } }]);
    if (new URL(url).pathname === '/media/adaptive') return new Response(null, { status: 404 });
    assert.match(String(url), /\/media\/hls\?/, 'Stems must resolve HLS even when the initial metadata selects progressive MP3');
    return Response.json({ url: 'https://audio.test/set.m3u8' });
  } });
  // Replace browser lifecycle and message transport, retaining the real manager
  // method, source resolver, playlist parser and audio renderer.
  scope.renderOffscreen = async message => {
    assert.equal(message.type, 'OFFSCREEN_INSTRUMENT_RENDER');
    const { blob } = await download.buildTrackBlob(message.streamUrl, message.trackData, undefined, undefined,
      message.trimRange, message.playbackTransform, message.effects, true);
    return { success: true, instrument: { dataUrl: `data:audio/wav;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}` } };
  };
  vm.runInContext(`startKeepalive = stopKeepalive = closeOffscreenDocument = async () => {};
    loadJob = async () => null; sendOffscreenMessage = message => renderOffscreen(message);`, scope);
  const manager = vm.runInContext('BulkJobManager', scope);
  const jobs = scope.SCStemJobs.create({
    chrome: { runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}` },
      storage: { session: { get: async key => ({ [key]: storage[key] }), set: async data => Object.assign(storage, data), remove: async key => { delete storage[key]; } } },
      tabs: { create: async () => ({ id: 2 }), update: async () => {}, remove: async () => {} } },
    authorize: async () => ({ allowed: true }), resolveTrack: async () => track,
    render: (...args) => manager.renderLoopInstrument(...args), cancel: async () => {},
  });
  for (loopSeconds of [20, 120]) {
  requests.length = 0; decodedSeconds.length = 0;
  for (const key of Object.keys(storage)) delete storage[key];
  await jobs.handle({ type: 'OPEN_LOOP_STEMS', trackUrl: 'https://soundcloud.com/v54t/ngsb23', trimRange: { startMs: 1205000, endMs: 1205000 + loopSeconds * 1000 } },
    { id: 'test', url: 'https://soundcloud.com/v54t/ngsb23', tab: { id: 1 } });
  const jobId = Object.values(storage)[0].id;
  const result = await jobs.handle({ type: 'STEM_LOOP_RENDER', jobId }, { id: 'test', url: 'chrome-extension://test/stems.html', tab: { id: 2 } });
  assert.equal(result.success, true, `A ${loopSeconds} second Stems loop from a 25 minute track must prepare`);
  const wav = Buffer.from(result.instrument.dataUrl.split(',')[1], 'base64');
  assert.equal(wav.length, 44 + loopSeconds * 48000 * 2 * 2);
  assert.ok(Math.abs(wav.readInt16LE(44) / 32767 - .6) < .001, 'Selection starts in segment 120, not the start of the track');
  assert.equal(requests.length, 2 + loopSeconds / 10, 'Only the playlist and segments intersecting A–B are fetched');
  assert.ok(decodedSeconds.every(seconds => seconds <= loopSeconds + 20));
  console.log(`Stems preparation: ${loopSeconds} second selection from a 25 minute HLS track uses bounded download/decode and reaches the analyzer.`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
