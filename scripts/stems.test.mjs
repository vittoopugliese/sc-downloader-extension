import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { separateAudio, encodeWav, validateAudio } from './stem-audio.mjs';
import './stem-jobs.js';

test('overlap/cropping preserves endpoints, stereo alignment and amplitude for short and multi-segment loops', async () => {
  for (const length of [1, 7, 16, 17, 28, 29, 47]) {
    const input = [Float32Array.from({ length }, (_, i) => (i + 1) / 60), Float32Array.from({ length }, (_, i) => -(i + 2) / 60)];
    const result = await separateAudio(input, async chunk => {
      const out = new Float32Array(4 * chunk.length);
      for (let stem = 0; stem < 4; stem++) out.set(chunk.map(value => value * (stem + 1) / 10), stem * chunk.length);
      return out;
    }, () => {}, 16);
    for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) {
      assert.ok(Math.abs(result.reduce((sum, stem) => sum + stem[c][i], 0) - input[c][i]) < 1e-6, `frame ${i}/${length}`);
    }
  }
});
test('invalid input and model output fail explicitly', async () => {
  assert.throws(() => validateAudio([new Float32Array([NaN]), new Float32Array(1)]), /invalid samples/);
  assert.throws(() => validateAudio([new Float32Array(5292001), new Float32Array(5292001)]), /2 minutes/);
  await assert.rejects(separateAudio([new Float32Array(2), new Float32Array(2)], async () => new Float32Array(1), undefined, 8), /shape/);
  await assert.rejects(separateAudio([new Float32Array(2), new Float32Array(2)], async () => new Float32Array(64).fill(Infinity), undefined, 8), /invalid audio/);
});
test('float WAV retains channel order and values above unity', () => {
  const bytes = encodeWav([new Float32Array([1.5, -0.3]), new Float32Array([-1.5, 0.8])]);
  const view = new DataView(bytes);
  assert.equal(view.getUint16(20, true), 3);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 16);
  assert.equal(view.getFloat32(44, true), 1.5);
  assert.equal(view.getFloat32(48, true), -1.5);
});
test('the shipping allow-list contains the analyzer and every local runtime dependency', () => {
  const root = new URL('../', import.meta.url);
  const packaging = fs.readFileSync(new URL('scripts/package-extension.ps1', root), 'utf8');
  const list = packaging.match(/\$packageItems = @\(([\s\S]*?)\n\s*\)/)[1];
  const items = [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const required = ['stems.html', 'assets/stems.css', 'scripts/stems-page.mjs', 'scripts/stem-audio.mjs',
    'scripts/stem-presets.mjs', 'scripts/stem-library-ui.mjs', 'scripts/stem-tone-processor.mjs',
    'scripts/stem-model.mjs', 'scripts/stem-worker.mjs', 'scripts/stem-jobs.js',
    'scripts/vendor/onnxruntime/ort.wasm.min.mjs', 'scripts/vendor/onnxruntime/ort-wasm-simd-threaded.mjs',
    'scripts/vendor/onnxruntime/ort-wasm-simd-threaded.wasm', 'scripts/vendor/onnxruntime/LICENSE'];
  for (const file of required) {
    assert.ok(fs.statSync(new URL(file, root)).size > 0, `Missing ${file}`);
    assert.ok(items.some(item => item === file || file.startsWith(`${item}/`)), `Not packaged: ${file}`);
  }
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.ok(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
});
function jobsFixture() {
  const storage = {}, rendered = [], cancelled = [], created = [];
  let permitted = true;
  const chrome = { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}` },
    storage: { session: { async get(key) { return key ? { [key]: storage[key] } : { ...storage }; }, async set(value) { Object.assign(storage, value); }, async remove(key) { delete storage[key]; } } },
    tabs: { async create(value) { created.push(value); return { id: 23 }; }, async update() {}, async remove() {} } };
  let unblock;
  const jobs = globalThis.SCStemJobs.create({ chrome, authorize: async () => ({ allowed: permitted }),
    resolveTrack: async () => ({ title: 'Fixture' }),
    render: async (...args) => { rendered.push(args); return await new Promise(resolve => { unblock = resolve; }); },
    cancel: async id => { cancelled.push(id); unblock?.({ success: true }); } });
  const source = { id: 'extension', url: 'https://soundcloud.com/artist/track', tab: { id: 7 } };
  const open = { type: 'OPEN_LOOP_STEMS', trackUrl: source.url, trimRange: { startMs: 3200, endMs: 5200 } };
  return { jobs, storage, rendered, cancelled, created, source, open, set permitted(value) { permitted = value; } };
}
test('loop jobs enforce source/ownership/length and preserve the selected range without effects', async () => {
  const f = jobsFixture();
  await assert.rejects(f.jobs.handle(f.open, { ...f.source, url: 'https://evil.example/' }), /SoundCloud/);
  await assert.rejects(f.jobs.handle({ ...f.open, trimRange: { startMs: 0, endMs: 120001 } }, f.source), /2 minutes/);
  f.permitted = false;
  await assert.rejects(f.jobs.handle(f.open, f.source), /Pro/);
  assert.equal(f.created.length, 0);
  f.permitted = true;
  await f.jobs.handle(f.open, f.source);
  const job = Object.values(f.storage)[0];
  const sender = { id: 'extension', url: `chrome-extension://extension/stems.html?job=${job.id}`, tab: { id: 23 } };
  const request = { type: 'STEM_LOOP_RENDER', jobId: job.id };
  await assert.rejects(f.jobs.handle(request, { ...sender, tab: { id: 24 } }), /expired/);
  const pending = f.jobs.handle(request, sender);
  // Wait for authorization to finish and rendering to start.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.rendered[0].slice(1, 4), [{ startMs: 3200, endMs: 5200 }, { rate: 1, preservePitch: false }, {}]);
  await assert.rejects(f.jobs.handle(request, sender), /already/);
  await f.jobs.handle({ ...request, type: 'STEM_LOOP_CANCEL' }, sender);
  await assert.rejects(pending, /cancelled/);
  assert.match(f.cancelled[0], /^instrument_stems_/);
  await f.jobs.removeTab(23);
  assert.equal(Object.keys(f.storage).length, 0);
});

test('two minute audio and selected loop sessions are accepted at the boundary', async () => {
 assert.equal(validateAudio([new Float32Array(5292000), new Float32Array(5292000)]), 5292000);
 const f = jobsFixture();
 await f.jobs.handle({ ...f.open, trimRange: { startMs: 1205000, endMs: 1325000 } }, f.source);
 assert.deepEqual(Object.values(f.storage)[0].trimRange, { startMs: 1205000, endMs: 1325000 });
});

test('two minute separation keeps bounded model inputs and complete output endpoints', async () => {
  const frames = 44100 * 120;
  const channels = [new Float32Array(frames).fill(.2), new Float32Array(frames).fill(-.1)];
  let calls = 0;
  const outputs = await separateAudio(channels, async input => {
    calls++;
    assert.equal(input.length, 343980 * 2);
    const result = new Float32Array(input.length * 4);
    for (let stem = 0; stem < 4; stem++) result.set(input, stem * input.length);
    return result;
  });
  assert.ok(calls > 1);
  for (const stem of outputs) for (let c = 0; c < 2; c++) {
    assert.equal(stem[c].length, frames);
    for (const index of [0, 343980, frames - 1]) assert.ok(Math.abs(stem[c][index] - channels[c][index]) < 1e-6);
  }
});
