const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'tempo-control-main.js'), 'utf8');
const start = source.indexOf('  function cachePadBuffer(');
const end = source.indexOf('\n  }', start) + 4;
const pads = Array.from({ length: 8 }, () => ({ buffer: null }));
let now = 0;
const scope = vm.createContext({ drumPads: pads, performance: { now: () => ++now } });
vm.runInContext(source.slice(start, end), scope);
const buffer = mib => ({ length: mib * 1024 * 1024 / 8, numberOfChannels: 2 });
const firstVoice = buffer(44);
scope.cachePadBuffer(pads[0], firstVoice);
scope.cachePadBuffer(pads[1], buffer(44));
assert.equal(pads[0].buffer, null);
assert.equal(firstVoice.length, 44 * 1024 * 1024 / 8, 'Eviction does not modify a sounding buffer');
for (const pad of pads) scope.cachePadBuffer(pad, buffer(12));
assert.ok(pads.reduce((sum, pad) => sum + (pad.buffer?.length || 0) * 8, 0) <= 64 * 1024 * 1024);
pads[3].lastUsed = ++now;
scope.cachePadBuffer(pads[0], buffer(12));
assert.ok(pads[3].buffer, 'Recently used audio survives LRU eviction');
assert.equal(pads[4].buffer, null, 'Oldest cached audio is evicted first');
scope.cachePadBuffer(pads[0], buffer(65));
assert.equal(pads[0].buffer, null, 'A single oversized buffer is not retained');
console.log('Sampler PCM cache: aggregate byte budget, LRU and active-buffer preservation passed.');

(async () => {
  const offscreen = fs.readFileSync(path.join(__dirname, 'offscreen.js'), 'utf8');
  const queueSource = offscreen.slice(offscreen.indexOf('let padTimeQueue'), offscreen.indexOf('async function handlePadMessage'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let live = 0, maximum = 0, closed = 0;
  const worker = vm.createContext({
    PAD_MAX_BYTES: 12 * 1024 * 1024, SERVICE_WORKER_KEEPALIVE_MS: 10000,
    chrome: { runtime: { sendMessage: async () => {} } }, setInterval, clearInterval, Blob,
    AudioContext: class {
      constructor() { maximum = Math.max(maximum, ++live); }
      async decodeAudioData() { await gate; return { duration: 1, length: 48000, numberOfChannels: 2 }; }
      async close() { live--; closed++; }
    },
    SCLoopAudioRenderer: { render: async () => ({ length: 96000, sampleRate: 48000 }) },
    SCDownload: { encodeWavSegment: () => new ArrayBuffer(44) },
  });
  vm.runInContext(queueSource, worker);
  const requests = Array.from({ length: 8 }, () => worker.renderPadTime(new Blob(['audio']), 200));
  await assert.rejects(worker.renderPadTime(new Blob(['audio']), 200), /busy/);
  release(); await Promise.all(requests);
  assert.equal(maximum, 1, 'TIME decoders run sequentially');
  assert.equal(closed, 8, 'Every decoder closes');
  await assert.rejects(worker.renderPadTime({ size: 13 * 1024 * 1024 }, 200), /too large/);
  await worker.renderPadTime(new Blob(['audio']), 200);
  assert.equal(live, 0, 'Queue recovers after failure without leaking contexts');
  console.log('TIME queue: bounded backlog, serial decoding, cleanup and recovery passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
