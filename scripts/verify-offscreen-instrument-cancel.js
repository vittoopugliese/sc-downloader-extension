const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let listener;
let builds = 0;
const context = vm.createContext({
  console,
  AbortController,
  Blob,
  setInterval,
  clearInterval,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  chrome: { runtime: {
    id: "test-extension",
    getURL: (file) => `chrome-extension://test-extension/${file}`,
    onMessage: { addListener(callback) { listener = callback; } },
    sendMessage: async () => {},
  } },
  SCDownload: {
    buildTrackBlob(_url, _track, _progress, signal) {
      builds += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {
          name: "AbortError", code: "instrument_cancelled",
        })), { once: true });
      });
    },
  },
  SCDownloadDirectory: {},
});

vm.runInContext(fs.readFileSync(path.join(__dirname, "offscreen.js"), "utf8"), context);
const sender = { id: "test-extension", url: "chrome-extension://test-extension/scripts/background.js" };
function send(message) {
  return new Promise((resolve, reject) => {
    try {
      assert.equal(listener(message, sender, resolve), true);
    } catch (error) {
      reject(error);
    }
  });
}

(async () => {
  const operationId = "instrument_cancel_active_001";
  const render = send({
    type: "OFFSCREEN_INSTRUMENT_RENDER",
    operationId,
    buildId: `track_${operationId}`,
    streamUrl: "https://cdn.test/audio",
    trackData: { id: 1 },
    trimRange: { startMs: 0, endMs: 1000, durationMs: 1000 },
    playbackTransform: { rate: 1, preservePitch: false },
    effects: {},
  });
  assert.equal(builds, 1);
  const cancelled = await send({ type: "OFFSCREEN_INSTRUMENT_CANCEL", operationId });
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.cancelled, true);
  assert.equal((await render).code, "instrument_cancelled");

  const queuedId = "instrument_cancel_before_001";
  assert.equal((await send({ type: "OFFSCREEN_INSTRUMENT_CANCEL", operationId: queuedId })).success, true);
  const skipped = await send({
    type: "OFFSCREEN_INSTRUMENT_RENDER",
    operationId: queuedId,
    buildId: `track_${queuedId}`,
    streamUrl: "https://cdn.test/audio",
    trackData: { id: 1 },
    trimRange: { startMs: 0, endMs: 1000, durationMs: 1000 },
    playbackTransform: { rate: 1, preservePitch: false },
    effects: {},
  });
  assert.equal(skipped.code, "instrument_cancelled");
  assert.equal(builds, 1, "a cancelled queued operation must not start rendering");
  const payload = Buffer.alloc(2 * 1024 * 1024 + 17, 73);
  context.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result = `data:audio/wav;base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      }).catch((error) => { this.error = error; this.onerror(); });
    }
  };
  context.SCDownload.buildTrackBlob = async (_url, _track, _progress, _signal, trimRange) => {
    assert.equal(trimRange, null, 'editable instruments prepare the full source');
    return { blob: new Blob([payload], { type: 'audio/wav' }) };
  };
  const transferId = 'instrument_transfer_full_001';
  const prepared = await send({ type: 'OFFSCREEN_INSTRUMENT_RENDER', operationId: transferId, fullTrack: true });
  assert.equal(prepared.instrument.byteLength, payload.length);
  assert.equal(prepared.instrument.dataUrl, undefined, 'large audio is not sent in one runtime message');
  assert.equal((await send({ type: 'OFFSCREEN_INSTRUMENT_READ', operationId: transferId, offset: 10 })).success, false);
  const chunks = [];
  for (let offset = 0; offset < payload.length;) {
    const part = await send({ type: 'OFFSCREEN_INSTRUMENT_READ', operationId: transferId, offset });
    assert.equal(part.success, true, part.error);
    assert.ok(part.chunk.byteLength <= 1024 * 1024);
    chunks.push(Buffer.from(part.chunk.dataUrl.split(',')[1], 'base64'));
    offset += part.chunk.byteLength;
  }
  assert.deepEqual(Buffer.concat(chunks), payload);
  assert.equal((await send({ type: 'OFFSCREEN_INSTRUMENT_READ', operationId: transferId, offset: 0 })).success, false, 'completed transfer frees its audio');
  await send({ type: 'OFFSCREEN_INSTRUMENT_RENDER', operationId: 'instrument_transfer_cancel_001', fullTrack: true });
  await send({ type: 'OFFSCREEN_INSTRUMENT_CANCEL', operationId: 'instrument_transfer_cancel_001' });
  assert.equal((await send({ type: 'OFFSCREEN_INSTRUMENT_READ', operationId: 'instrument_transfer_cancel_001', offset: 0 })).success, false);
  console.log("Offscreen instrument cancellation verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
