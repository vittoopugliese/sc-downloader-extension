import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { separateAudio, encodeWav, validateAudio } from './stem-audio.mjs';
import './stem-jobs.js';
import { normalizeDrumSlice, editDrumSlice } from './stem-sampler.mjs';
import { normalizePiano, pitchRatio, noteName, MAX_PIANO_NOTES } from './stem-piano-core.mjs';

test('piano presets normalize malformed notes, bound metadata and preserve hidden bars without mutating input', () => {
  const buffer = { duration: 3, sampleRate: 44100 };
  const value = { sample: { start: 1, end: 20 }, root: 200, octave: -5, mode: 'replace',
    notes: [{ pitch: 60, start: 40, length: 8, velocity: .5 }, { pitch: NaN, start: 0, length: 1 },
      { pitch: 100, start: 63.5, length: 500, velocity: -2 }, { pitch: 60, start: 64, length: 1 }] };
  const normalized = normalizePiano(value, buffer);
  assert.equal(normalized.root, 96); assert.equal(normalized.sample.end, 3);
  assert.equal(normalized.octave, 1); assert.equal(normalized.mode, 'replace');
  assert.deepEqual(normalized.notes, [{ pitch: 60, start: 40, length: 8, velocity: .5 }, { pitch: 96, start: 63.5, length: 64, velocity: .01 }]);
  assert.equal(value.sample.end, 20); assert.equal(value.notes.length, 4);
  assert.equal(normalizePiano({ notes: Array(10000).fill({ pitch: 60, start: 0, length: 1 }) }, buffer).notes.length, MAX_PIANO_NOTES);
  assert.deepEqual(normalizePiano(undefined, buffer).notes, []);
  assert.equal(normalizePiano({ notes: {} }, buffer).mode, 'off');
  assert.equal(pitchRatio(72, 60), 2); assert.equal(pitchRatio(48, 60), .5);
  assert.equal(noteName(60), 'C4'); assert.equal(noteName(69), 'A4');
});

test('drum slices default to 154 ms and migrate start-only presets without playing the remaining stem', () => {
  const buffer = { duration: 120, sampleRate: 44100 };
  const slice = normalizeDrumSlice(42, buffer);
  assert.ok(Math.abs(slice.end - slice.start - .154) < 1 / 44100);
  assert.equal(slice.fadeIn, .003); assert.equal(slice.fadeOut, .03);
  assert.deepEqual(normalizeDrumSlice(slice, buffer), slice);
  for (const bad of [null, undefined, NaN, Infinity, -1, 120, {}, { start: '1' }]) assert.equal(normalizeDrumSlice(bad, buffer), null);
});

test('sample trim and fades remain bounded at the final PCM frame and after extreme edits', () => {
  const buffer = { duration: 3, sampleRate: 44100 };
  const slice = normalizeDrumSlice({ start: 2.99999, fadeIn: 5, fadeOut: 10 }, buffer);
  assert.ok(slice.end <= buffer.duration && slice.end > slice.start);
  assert.ok(slice.fadeIn > 0 && slice.fadeOut > 0);
  assert.ok(slice.fadeIn + slice.fadeOut <= slice.end - slice.start + 1e-12);
  const normal = normalizeDrumSlice(1, buffer);
  for (const kind of ['start', 'end', 'fadeIn', 'fadeOut']) for (const time of [-100, 0, 1.1, 100]) {
    const edited = editDrumSlice(normal, kind, time, buffer);
    assert.ok(edited.start >= 0 && edited.end <= buffer.duration && edited.start < edited.end);
    assert.ok(edited.fadeIn > 0 && edited.fadeOut > 0 && edited.fadeIn + edited.fadeOut <= edited.end - edited.start + 1e-12);
  }
  assert.deepEqual(normal, normalizeDrumSlice(1, buffer), 'Editing does not mutate saved snapshots');
  assert.ok(Math.abs(normal.end - 1.154) < 1 / 44100);
});

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
    'scripts/stem-loop.mjs', 'scripts/stem-sampler.mjs', 'scripts/local-audio-output.mjs', 'assets/icons/mute.svg',
    'scripts/stem-sequencer-core.mjs', 'scripts/stem-sequencer.mjs',
    'scripts/stem-piano-core.mjs', 'scripts/stem-piano.mjs',
    'scripts/parametric-eq.js', 'scripts/parametric-eq-ui.js', 'scripts/player-tools-collapsible.js',
    'scripts/record-core.js', 'scripts/record-ui.js', 'scripts/record-processor.js',
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
