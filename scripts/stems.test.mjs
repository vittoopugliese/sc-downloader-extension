import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { separateAudio, encodeWav, validateAudio } from './stem-audio.mjs';
import './stem-jobs.js';
import { normalizeDrumSlice, editDrumSlice, detectDrumSlices } from './stem-sampler.mjs';
import { MAX_NOTES, migrateLegacy, noteName, normalizeInstrument, normalizePattern, normalizeProject, patternSeconds, pitchRatio } from './stem-pattern-core.mjs';
import { loopSegments, retimeClips, validateArrangement } from './stem-playlist-core.mjs';
import { createNoteTake, recordedNotes } from './stem-note-recording.mjs';

test('recording quantizes gates, splits loop seams, preserves chords and extends beyond four bars', () => {
  assert.deepEqual(recordedNotes({ pitch: 60, start: 15.8, end: 17.1, snap: .5, steps: 16, loop: true }),
    [{ pitch: 60, velocity: .8, start: 0, length: 1 }]);
  assert.deepEqual(recordedNotes({ pitch: 61, start: 15, end: 18, snap: 1, steps: 16, loop: true }),
    [{ pitch: 61, velocity: .8, start: 15, length: 1 }, { pitch: 61, velocity: .8, start: 0, length: 2 }]);
  const pattern = normalizePattern({ id: 'take', track: 'bass', bars: 1 });
  const take = createNoteTake(pattern, 'extend', .5);
  take.down('q', 72, 64.1); take.down('q', 72, 64.2); take.down('e', 76, 64.1);
  take.up('q', 66.2); take.up('e', 66.2);
  assert.equal(take.bars, 5); assert.equal(take.notes.length, 2);
  assert.deepEqual(take.notes.map(n => [n.start, n.length]), [[64, 2], [64, 2]]);
  assert.deepEqual(pattern.notes, []);
  assert.equal(normalizePattern({ ...pattern, bars: take.bars, notes: take.notes }).notes.length, 2);
  const loop = createNoteTake(pattern, 'loop', 1);
  loop.down('z', 60, 5000); loop.up('z', 5002);
  assert.deepEqual(loop.notes, [{ pitch: 60, velocity: .8, start: 8, length: 2 }], 'Loop recording keeps gates after many passes');
  const full = createNoteTake({ ...pattern, notes: Array.from({ length: MAX_NOTES }, () => ({ pitch: 60, start: 0, length: 1, velocity: .8 })) }, 'loop', 1);
  full.down('q', 72, 1); assert.equal(full.full, true); assert.equal(full.notes.length, MAX_NOTES);
});

test('patterns normalize malformed notes and steps, keep hidden bars and do not mutate input', () => {
  const value = { id: 'p1', track: 'bass', name: '  Groove  ', bars: 3, steps: [[1.5, -1, .5]],
    notes: [{ pitch: 60, start: 40, length: 8, velocity: .5 }, { pitch: NaN, start: 0, length: 1 },
      { pitch: 100, start: 63.5, length: 500, velocity: -2 }, { pitch: 60, start: 64, length: 1 }] };
  const pattern = normalizePattern(value);
  assert.equal(pattern.name, 'Groove'); assert.equal(pattern.bars, 3, 'Any whole bar count supports extended takes');
  assert.deepEqual(pattern.steps[0].slice(0, 3), [1, 0, .5]); assert.equal(pattern.steps.length, 8); assert.equal(pattern.steps[7].length, 64);
  assert.deepEqual(pattern.notes, [{ pitch: 60, start: 40, length: 8, velocity: .5 }, { pitch: 96, start: 63.5, length: 500, velocity: .01 }, { pitch: 60, start: 64, length: 1, velocity: .8 }]);
  assert.equal(value.notes.length, 4); assert.equal(value.steps[0][0], 1.5);
  assert.equal(normalizePattern({ ...value, notes: Array(10000).fill({ pitch: 60, start: 0, length: 1 }) }).notes.length, MAX_NOTES);
  for (const bad of [null, {}, { id: 'p', track: '../x' }, { id: '', track: 'bass' }]) assert.equal(normalizePattern(bad), null);
  const project = normalizeProject({ instruments: { bass: { piano: { pad: 12, root: 200, snap: 3 } }, 'x y': {} }, patterns: [value, value, null] });
  assert.deepEqual(Object.keys(project.instruments), ['bass']);
  assert.deepEqual(project.instruments.bass.piano, { pad: 7, root: 96, sustain: false, octave: 3, snap: 1 });
  assert.equal(project.patterns.length, 1, 'Duplicate pattern IDs are dropped');
  const bounded = normalizeInstrument({ slices: [{ start: 1, end: 20 }, { start: 5 }] }, { duration: 3, sampleRate: 44100 });
  assert.equal(bounded.slices[0].end, 3); assert.equal(bounded.slices[1], null);
  assert.equal(patternSeconds({ bars: 2 }, 120), 4);
  assert.equal(pitchRatio(72, 60), 2); assert.equal(pitchRatio(48, 60), .5);
  assert.equal(noteName(60), 'C4'); assert.equal(noteName(69), 'A4');
});

test('per-track editor presets migrate to instruments and patterns; the piano sample takes a free pad', () => {
  let id = 0;
  const migrated = migrateLegacy({ trackEditors: {
    drums: { slices: [{ start: .1, end: .2 }, null], sequence: { bars: 2, steps: [[0, .8]], enabled: true, song: true } },
    other: { piano: { sample: { start: 1, end: 1.5 }, root: 57, sustain: true, notes: [{ pitch: 60, start: 0, length: 4 }] } },
    vocals: { slices: [], sequence: { steps: [] } },
  } }, () => 'p' + ++id);
  assert.deepEqual(Object.keys(migrated.instruments), ['drums', 'other'], 'Untouched tracks are skipped');
  assert.equal(migrated.patterns.length, 2);
  assert.deepEqual([migrated.patterns[0].track, migrated.patterns[0].bars, migrated.patterns[0].steps[0][1]], ['drums', 2, .8]);
  assert.deepEqual(migrated.instruments.other.slices[0], { start: 1, end: 1.5 });
  assert.deepEqual(migrated.instruments.other.piano, { pad: 0, root: 57, sustain: true, octave: 3, snap: 1 });
  assert.equal(migrated.patterns[1].notes.length, 1);
  // The oldest presets stored drum starts and one piano outside trackEditors.
  const oldest = migrateLegacy({ drumStarts: [.5], piano: { sample: { start: 2 } } }, () => 'x');
  assert.equal(oldest.instruments.drums.slices[0].start, .5); assert.equal(oldest.patterns.length, 0);
  assert.deepEqual(migrateLegacy(null), { instruments: {}, patterns: [] });
});

test('pattern clips repeat past one pass, in timeline order, and keep their position in beats on tempo changes', () => {
  const base = { id: 'c', asset: 'pattern:p', track: 't', at: 1, in: 0, out: 5, pitch: 0, cents: 0, speed: 1, keepLength: true, gain: 1, fadeIn: .5, fadeOut: .25 };
  const pieces = loopSegments(base, 2);
  assert.deepEqual(pieces.map(c => [c.at, c.in, c.out]), [[1, 0, 2], [3, 0, 2], [5, 0, 1]]);
  assert.deepEqual(pieces.map(c => [c.fadeIn, c.fadeOut]), [[.5, 0], [0, 0], [0, .25]]);
  assert.equal(new Set(pieces.map(c => c.id)).size, 3);
  assert.deepEqual(loopSegments({ ...base, in: 1, out: 2 }, 2), [{ ...base, in: 1, out: 2 }], 'One pass stays one clip');
  // Reversed: the end of the source plays first.
  assert.deepEqual(loopSegments({ ...base, reverse: true, in: 0, out: 3 }, 2).map(c => [c.at, c.in, c.out]), [[1, 0, 1], [2, 0, 2]]);
  // Pitch changes the rate, so passes are shorter on the timeline.
  assert.deepEqual(loopSegments({ ...base, pitch: 12, keepLength: false, out: 4 }, 2).map(c => c.at), [1, 2]);
  const asset = { id: 'pattern:p', loop: true, buffer: { duration: 2 } };
  const state = { version: 1, bpm: 120, tracks: [{ id: 't', name: 'T', gain: 1, mute: false, solo: false }], clips: [base, { ...base, id: 'audio', asset: 'a', out: 1 },
    { ...base, id: 'locked', asset: 'a', at: 2, out: 1, tempoLock: true }, { ...base, id: 'resampled', asset: 'a', at: 2, out: 1, pitch: 3, keepLength: false, tempoLock: true }] };
  validateArrangement(state, new Map([['pattern:p', asset], ['a', { buffer: { duration: 1 } }]]));
  assert.throws(() => validateArrangement(state, new Map([['pattern:p', { ...asset, loop: false }], ['a', { buffer: { duration: 1 } }]])));
  retimeClips(state, 60, clip => clip.asset === 'pattern:p');
  assert.equal(state.bpm, 60);
  assert.deepEqual([state.clips[0].at, state.clips[0].out, state.clips[0].fadeIn], [2, 10, 1], 'Half tempo: same bar, twice the seconds');
  assert.deepEqual([state.clips[1].at, state.clips[1].out, state.clips[1].speed], [2, 1, 1], 'Audio clips keep their bar and their speed');
  // Clips stretched to the grid keep their bars: half tempo plays them at half speed.
  assert.deepEqual([state.clips[2].at, state.clips[2].out, state.clips[2].speed, state.clips[2].fadeIn], [4, 1, .5, 1], 'Locked clip: same bar, half speed');
  assert.deepEqual([state.clips[3].at, state.clips[3].speed, state.clips[3].pitch, state.clips[3].keepLength], [4, .5, 3, false], 'Resample keeps its mode and pitch knob');
  // Tempo from an A–B loop keeps unlocked audio in seconds.
  retimeClips(state, 120, clip => clip.asset === 'pattern:p', { moveAudio: false });
  assert.deepEqual([state.clips[1].at, state.clips[2].at, state.clips[2].speed], [2, 2, 1]);
  assert.throws(() => validateArrangement({ ...state, clips: [{ ...state.clips[2], tempoLock: 'yes' }] }, new Map([['a', { buffer: { duration: 1 } }]])));
});

test('drum slices default to 154 ms and migrate start-only presets without playing the remaining stem', () => {
  const buffer = { duration: 120, sampleRate: 44100 };
  const slice = normalizeDrumSlice(42, buffer);
  assert.ok(Math.abs(slice.end - slice.start - .154) < 1 / 44100);
  assert.equal(slice.fadeIn, .003); assert.equal(slice.fadeOut, .03);
  assert.deepEqual(normalizeDrumSlice(slice, buffer), slice);
  for (const bad of [null, undefined, NaN, Infinity, -1, 120, {}, { start: '1' }]) assert.equal(normalizeDrumSlice(bad, buffer), null);
});

test('auto-slice finds kick, snare and hat attacks sample-close and cuts at the next hit', () => {
  const sampleRate = 44100, length = sampleRate * 2, data = new Float32Array(length);
  let seed = 7; const noise = () => ((seed = seed * 16807 % 2147483647) / 2147483647) * 2 - 1;
  // Kick (60 Hz), snare (noise + 200 Hz) and hat (bright noise), each with a fast decay.
  const hits = [[.1, 'kick'], [.35, 'hat'], [.6, 'snare'], [.85, 'hat'], [1.1, 'kick'], [1.35, 'hat'], [1.6, 'snare'], [1.85, 'hat']];
  for (const [time, kind] of hits) {
    const at = Math.round(time * sampleRate);
    for (let i = 0; i < sampleRate * .15 && at + i < length; i++) {
      const t = i / sampleRate, decay = Math.exp(-t * (kind === 'hat' ? 60 : 25));
      let previous = 0, value = kind === 'kick' ? Math.sin(2 * Math.PI * 60 * t) : kind === 'snare' ? .5 * noise() + .5 * Math.sin(2 * Math.PI * 200 * t) : noise() - previous;
      previous = value; data[at + i] += .8 * decay * value;
    }
  }
  for (let i = 0; i < length; i++) data[i] += .001 * noise();
  const buffer = { sampleRate, length, duration: length / sampleRate, numberOfChannels: 1, getChannelData: () => data };
  const slices = detectDrumSlices(buffer);
  assert.equal(slices.length, 8);
  slices.forEach((slice, i) => {
    assert.ok(Math.abs(slice.start - hits[i][0]) < .004, `pad ${i} starts at ${slice.start}, hit at ${hits[i][0]}`);
    if (i < 7) assert.ok(Math.abs(slice.end - hits[i + 1][0]) < .004, `pad ${i} ends at ${slice.end}`);
  });
  const looped = detectDrumSlices(buffer, { startMs: 550, endMs: 1150 });
  assert.deepEqual(looped.map(slice => Math.round(slice.start * 20) / 20), [.6, .85, 1.1]);
  assert.ok(looped.at(-1).end <= 1.15 + 1e-9);
  assert.deepEqual(detectDrumSlices({ ...buffer, getChannelData: () => new Float32Array(length) }), []);
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
  const required = ['stems.html', 'assets/stems.css', 'scripts/stems-page.mjs', 'scripts/stem-output-monitor.mjs', 'scripts/stem-audio.mjs',
    'scripts/stem-presets.mjs', 'scripts/stem-library-ui.mjs', 'scripts/stem-tone-processor.mjs',
    'scripts/stem-loop.mjs', 'scripts/stem-sampler.mjs', 'scripts/local-audio-output.mjs', 'scripts/icons.js', 'scripts/icons-client.js',
    'scripts/stem-pattern-core.mjs', 'scripts/stem-note-recording.mjs', 'scripts/stem-instruments.mjs', 'scripts/stem-channel-rack.mjs', 'scripts/stem-piano.mjs',
    'scripts/stem-effects.mjs', 'scripts/stem-module-window.mjs', 'scripts/stem-rack-overview.mjs', 'scripts/stem-row-menu.mjs',
    'scripts/stem-sample-browser.mjs', 'scripts/stem-sample-library.mjs', 'scripts/stem-sample-preview.mjs',
    'scripts/audio-effects-core.js', 'scripts/bitcrusher-processor.js',
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
