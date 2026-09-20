// Isolated fault injection through the real download pipeline; no external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.SCDL_AUDIT_ROOT || path.resolve(__dirname, '../..');

async function run(failure) {
  let segmentCalls = 0;
  let saved = 0;
  const context = vm.createContext({ console, URL, Blob, Uint8Array, ArrayBuffer, TextEncoder, AbortController, DOMException, setTimeout, clearTimeout,
    fetch: async url => {
      if (String(url).endsWith('.m3u8')) return { ok: true, text: async () => '#EXTM3U\n#EXTINF:1,\npart.mp3\n#EXT-X-ENDLIST' };
      segmentCalls++;
      if (failure && segmentCalls === 1) return { ok: false, status: failure };
      const bytes = new Uint8Array(417); bytes.set([0xff, 0xfb, 0x90, 0x00]);
      return { ok: true, arrayBuffer: async () => bytes.buffer };
    },
  });
  for (const name of ['format-utils.js', 'download-core.js', 'track-download-execution.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'scripts', name), 'utf8'), context, { filename: name });
  const build = vm.runInContext('SCDownload.buildTrackBlob', context);
  const execution = vm.runInContext('SCTrackDownloadExecution.create', context)({
    resolveSource: async trackData => ({ trackData, streamUrl: 'https://cdn.test/audio.m3u8' }),
    buildTrack: async request => {
      try {
        const result = await build(request.streamUrl, request.trackData);
        return { success: true, blobUrl: 'blob:diagnosis', fileName: result.fileName };
      } catch (error) { return { success: false, error: error.message, code: error.code, status: error.status }; }
    },
    saveOutput: async ({ fileName }) => { saved++; return { fileName, destinationName: 'test' }; },
    revokeBlob: async () => {}, abortBuild: async () => {},
  });
  let error = null;
  try { await execution.execute({ trackData: { id: 1, artist: 'Test', title: 'Test', streamProtocol: 'hls', streamPreset: 'mp3_128' } }); }
  catch (value) { error = value.message; }
  return { failure, segmentCalls, saved, error };
}

(async () => {
  const control = await run(null);
  assert.equal(control.saved, 1, 'Control must save audio');
  console.log('CONTROL', JSON.stringify(control));
  const failures = [];
  for (const status of [503, 429, 403]) {
    const result = await run(status);
    console.log('FAULT', JSON.stringify(result));
    if (result.saved !== 1) failures.push(status);
  }
  assert.equal(failures.length, 0, `Recoverable HTTP ${failures.join(', ')}: no file was saved (subsequent request would succeed)`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
