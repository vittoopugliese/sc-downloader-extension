import test from 'node:test';
import assert from 'node:assert/strict';
import { audibleClips, clipEnvelope, clipsInWindow, clipsInRange, crossfadeClips, needsStretch, slipClip, splitClip, stretchKey, trackAudible, transportWindows } from './stem-playlist-core.mjs';
import { stretchChannels } from './stem-playlist-stretch.mjs';
import createSignalsmith from './vendor/signalsmith/wasm-factory.mjs';

const clip = (at, seconds, extra = {}) => ({ id: `c${at}`, asset: 'a', track: 't', at, in: 0, out: seconds, pitch: 0, speed: 1, keepLength: true, gain: 1, ...extra });

test('time ranges retain silent offsets, crop source windows at playback rate and exclude other lanes', () => {
  const snare = clip(.5, .1), other = clip(.75, .1, { track: 'other' });
  assert.deepEqual(clipsInRange([snare, other], { start: 0, end: 2, tracks: ['t'] }).map(c => [c.at, c.in, c.out]), [[.5, 0, .1]]);
  assert.deepEqual(clipsInRange([snare], { start: 1, end: 2, tracks: ['t'] }), [], 'A wholly silent range is valid');
  const source = clip(2, 10, { in: 2, speed: 2, fadeIn: .2, fadeOut: .3 });
  for (const reverse of [false, true]) {
    const [cropped] = clipsInRange([{ ...source, reverse }], { start: 2.5, end: 4, tracks: ['t'] });
    assert.deepEqual([cropped.at, cropped.in, cropped.out, cropped.fadeIn, cropped.fadeOut], reverse ? [2.5, 6, 9, 0, 0] : [2.5, 3, 6, 0, 0]);
  }
  const [resampled] = clipsInRange([clip(0, 8, { pitch: 12, keepLength: false })], { start: 1, end: 2, tracks: ['t'] });
  assert.deepEqual([resampled.at, resampled.in, resampled.out], [1, 2, 4]);
  assert.deepEqual([source.at, source.in, source.out, source.fadeIn, source.fadeOut], [2, 2, 10, .2, .3], 'Copy never edits the original');
});

test('transport windows cover the span once, wrap inside the loop and stop without one', () => {
  const pick = windows => windows.map(w => [w.from, w.to, w.zero, w.end, w.entry]);
  assert.deepEqual(pick(transportWindows(0, 1.5, 2, 10, null)), [[2, 3.5, -2, Infinity, true]]);
  assert.deepEqual(pick(transportWindows(7, 9, 2, 10, null)), [[9, 10, -2, Infinity, false]]);
  assert.deepEqual(transportWindows(9, 10, 2, 10, null), []);
  // A–B loop 4..6 entered at 5: one second to B, then whole passes from A.
  assert.deepEqual(pick(transportWindows(0, 3.5, 5, 10, { start: 4, end: 6 })),
    [[5, 6, -5, 6, true], [4, 6, -3, 6, true], [4, 4.5, -1, 6, true]]);
  // A tick boundary on a seam still marks the entry, so long clips restart mid-clip at A.
  assert.deepEqual(pick(transportWindows(3, 4, 5, 10, { start: 4, end: 6 })), [[4, 5, -1, 6, true]]);
  assert.deepEqual(pick(transportWindows(3.5, 4, 5, 10, { start: 4, end: 6 })), [[4.5, 5, -1, 6, false]]);
  assert.deepEqual(transportWindows(0, 1, 0, 10, { start: 3, end: 3 }), []);
});

test('clip edits: slip keeps edges, reverse splits from the end, fades and crossfades shape the envelope', () => {
  // Slip moves the source window inside the asset, clamped to its bounds.
  assert.deepEqual([slipClip(clip(0, 4, { in: 1, out: 3 }), .5, 4)].map(c => [c.at, c.in, c.out]), [[0, 1.5, 3.5]]);
  assert.deepEqual([slipClip(clip(0, 4, { in: 1, out: 3 }), 5, 4)].map(c => [c.in, c.out]), [[2, 4]]);
  assert.deepEqual([slipClip(clip(0, 4, { in: 1, out: 3 }), -5, 4)].map(c => [c.in, c.out]), [[0, 2]]);
  // A reversed clip plays out→in, so the first half keeps the end of the source.
  const [head, tail] = splitClip(clip(0, 4, { reverse: true, fadeIn: 1, fadeOut: 1 }), 1);
  assert.deepEqual([head.in, head.out, head.fadeIn, head.fadeOut], [3, 4, 1, 0]);
  assert.deepEqual([tail.at, tail.in, tail.out, tail.fadeIn, tail.fadeOut], [1, 0, 3, 0, 1]);
  const faded = clip(0, 4, { fadeIn: 1, fadeOut: 2 });
  assert.deepEqual([0, .5, 1, 2, 3, 4].map(at => clipEnvelope(faded, at)), [0, .5, 1, 1, .5, 0]);
  // Overlapping clips on one track fade across the overlap; muted clips are skipped and silent.
  const a = clip(0, 4), b = clip(3, 4), muted = clip(2, 4, { id: 'm', mute: true });
  crossfadeClips([b, muted, a]);
  assert.deepEqual([a.fadeOut, b.fadeIn, muted.fadeIn], [1, 1, undefined]);
  const state = { tracks: [{ id: 't', mute: false }], clips: [a, muted] };
  assert.deepEqual(audibleClips(state).map(c => c.id), ['c0']);
});

test('the original and stem channels follow mute and solo alike', () => {
  const state = { tracks: [{ id: 'o', stem: 'original', mute: true }, { id: 'd', stem: 'drums', mute: false }, { id: 'u', mute: false }] };
  assert.deepEqual(state.tracks.map(track => trackAudible(state, track)), [false, true, true]);
  state.tracks[0].mute = false; state.tracks[1].mute = true;
  assert.deepEqual(state.tracks.map(track => trackAudible(state, track)), [true, false, true]);
  state.tracks[2].solo = true;
  assert.deepEqual(state.tracks.map(track => trackAudible(state, track)), [false, false, true]);
});

test('clips enter at their start, or mid-clip only for the first window of a session', () => {
  const clips = [clip(0, 4), clip(2, 1), clip(5, 1)];
  assert.deepEqual(clipsInWindow(clips, 1, 3).map(item => [item.clip.at, item.at, item.offset]), [[2, 2, 0]]);
  assert.deepEqual(clipsInWindow(clips, 1, 3, true).map(item => [item.clip.at, item.at, item.offset]), [[0, 1, 1], [2, 2, 0]]);
  // A clip ending exactly at `from` is not sounding.
  assert.deepEqual(clipsInWindow(clips, 4, 5, true).map(item => item.clip.at), []);
  // Resample doubles the rate: a 4 s source at +12 st lasts 2 s.
  assert.deepEqual(clipsInWindow([clip(0, 4, { pitch: 12, keepLength: false })], 1.5, 3, true).map(item => item.offset), [1.5]);
});

test('only stretch-mode pitch or speed changes use the stretcher, keyed independently of trims', () => {
  assert.equal(needsStretch(clip(0, 1)), false);
  assert.equal(needsStretch(clip(0, 1, { pitch: 3 })), true);
  assert.equal(needsStretch(clip(0, 1, { speed: 2 })), true);
  assert.equal(needsStretch(clip(0, 1, { pitch: 3, keepLength: false })), false);
  assert.equal(stretchKey(clip(0, 1, { pitch: 3 })), stretchKey({ ...clip(9, 1, { pitch: 3 }), in: .5, out: .8 }));
});

// Zero crossings per second estimate the fundamental of a pure tone.
function frequency(samples, rate, from, to) {
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings / ((to - from) / rate);
}

test('Signalsmith stretch shifts pitch while keeping length, and changes length at fixed pitch', async () => {
  const rate = 44100, tone = Float32Array.from({ length: rate * 2 }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / rate));
  const up = stretchChannels(await createSignalsmith(), [tone, tone], rate, { pitch: 12, speed: 1 });
  assert.equal(up.length, 2);
  assert.equal(up[0].length, tone.length);
  assert.ok(Math.abs(frequency(up[0], rate, rate / 2, rate * 1.5) - 880) < 15, 'one octave up');
  const slow = stretchChannels(await createSignalsmith(), [tone], rate, { pitch: 0, speed: .5 });
  assert.equal(slow.length, 1);
  assert.equal(slow[0].length, tone.length * 2);
  assert.ok(Math.abs(frequency(slow[0], rate, rate, rate * 3) - 440) < 10, 'pitch kept at half speed');
});

test('engine edits replace only the edited clip; untouched clips keep sounding', async () => {
  const { createPlaylistEngine } = await import('./stem-playlist-audio.mjs');
  globalThis.AudioContext ||= class {};
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelAndHoldAtTime() {}, cancelScheduledValues() {} });
  const starts = [], stops = [];
  const context = Object.assign(Object.create(AudioContext.prototype), {
    currentTime: 1,
    createGain: () => ({ gain: param(), connect: node => node, disconnect() {} }),
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, connect: node => node, disconnect() {}, addEventListener() {},
        start: (when, offset) => starts.push({ buffer: source.buffer, when, offset }), stop: at => stops.push({ buffer: source.buffer, at }) };
      return source;
    },
  });
  const buffer = name => ({ name, duration: 8, sampleRate: 44100, length: 8 * 44100, numberOfChannels: 1 });
  const assets = new Map([['a', { id: 'a', buffer: buffer('a'), version: 0 }], ['b', { id: 'b', buffer: buffer('b'), version: 0 }]]);
  const engine = createPlaylistEngine({ context, output: {}, cache: { has: () => true, lookup: () => null, request: async () => {} }, assets: () => assets });
  const state = { version: 1, bpm: 120, tracks: [{ id: 't1', gain: 1 }, { id: 't2', gain: 1 }],
    clips: [clip(0, 8, { id: 'x', asset: 'a', track: 't1' }), clip(0, 8, { id: 'y', asset: 'b', track: 't2' })] };
  const transport = { rate: 1, loop: { start: 0, end: 8 } };
  engine.play(state, 0, transport);
  try {
  assert.equal(starts.length, 2);
  context.currentTime = 2;
  // Ten trims of clip x while both play: only x is replaced.
  for (let i = 1; i <= 10; i++) { state.clips[0] = { ...state.clips[0], out: 7.9 - i * .01 }; engine.update(state, transport); }
  assert.equal(starts.filter(s => s.buffer.name === 'b').length, 1, 'Clip y never restarts');
  assert.equal(stops.filter(s => s.buffer.name === 'b').length, 1, 'Clip y only has its natural end');
  assert.equal(starts.filter(s => s.buffer.name === 'a').length, 11);
  // The replacement starts where the transport is (playback began at 1.03), not at the clip start.
  assert.ok(Math.abs(starts.at(-1).offset - .975) < .01, `offset ${starts.at(-1).offset}`);
  // Track gain only: nothing restarts. Speed: a full restart.
  state.tracks[1] = { ...state.tracks[1], gain: .5 }; engine.update(state, transport);
  assert.equal(starts.length, 12);
  engine.update(state, { ...transport, rate: 1.5 });
  assert.equal(starts.length, 14);
  } finally { engine.stop(); }
});
