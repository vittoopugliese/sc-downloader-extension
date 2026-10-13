import { normalizeDrumSlice, scheduleDrumEnvelope } from './stem-sampler.mjs';

export const DRUM_KEYS = 'ASDFGHJK';
export const STEPS_PER_BAR = 16;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function normalizeSequence(value, duration) {
  return {
    version: 1,
    bpm: Number.isFinite(value?.bpm) ? clamp(value.bpm, 20, 300) : 120,
    bars: [1, 2, 4].includes(value?.bars) ? value.bars : 1,
    start: Number.isFinite(value?.start) ? clamp(value.start, 0, duration) : 0,
    enabled: value?.enabled === true,
    // FL-style transport: PAT loops the pattern bars; SONG plays the whole track and
    // repeats the pattern inside a playlist clip, in grid bars from the first beat.
    song: value?.song === true,
    clip: { from: Number.isInteger(value?.clip?.from) ? value.clip.from : null, to: Number.isInteger(value?.clip?.to) ? value.clip.to : null },
    // Keep the other bars when shortening a pattern; changing length is reversible.
    steps: Array.from({ length: 8 }, (_, row) => Array.from({ length: 64 }, (_, step) => {
      const velocity = value?.steps?.[row]?.[step];
      return Number.isFinite(velocity) ? clamp(velocity, 0, 1) : 0;
    })),
  };
}

export function sequenceRange(state, buffer) {
  const start = Math.round(state.start * buffer.sampleRate);
  const frames = Math.round(state.bars * 240 / state.bpm * buffer.sampleRate);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(frames) || start < 0 || frames < 1 ||
      start + frames > Math.round(buffer.duration * buffer.sampleRate)) return null;
  return { startMs: start / buffer.sampleRate * 1000, endMs: (start + frames) / buffer.sampleRate * 1000,
    durationMs: buffer.duration * 1000 };
}

// Clip edges snap to grid bars; bars may start before the first beat, and a missing
// edge reaches that end of the audio. Seconds are clamped to the audio.
export function songClip(state, duration) {
  const bar = 240 / state.bpm, first = -Math.ceil(state.start / bar), last = Math.max(first + 1, Math.ceil((duration - state.start) / bar));
  const from = clamp(state.clip?.from ?? 0, first, last - 1), to = clamp(state.clip?.to ?? last, from + 1, last);
  return { from, to, first, last, start: clamp(state.start + from * bar, 0, duration), end: clamp(state.start + to * bar, 0, duration) };
}

// Position inside the pattern cycle as 0..1, or -1 where the pattern is silent.
export function patternPhase(state, buffer, position) {
  const range = sequenceRange(state, buffer);
  if (!range) return -1;
  const length = (range.endMs - range.startMs) / 1000;
  if (!state.song) return position * 1000 < range.startMs || position * 1000 >= range.endMs ? -1 : (position - range.startMs / 1000) / length;
  const clip = songClip(state, buffer.duration);
  return position < clip.start || position >= clip.end ? -1 : (((position - state.start) / length) % 1 + 1) % 1;
}

export function sequenceStep(state, buffer, position) {
  const phase = patternPhase(state, buffer, position);
  return phase < 0 ? -1 : Math.min(state.bars * 16 - 1, Math.floor(phase * state.bars * 16));
}

// SONG mode writes one full-length lane: the stem as recorded outside the clip and
// the pattern tiled on the grid inside it (replacing, or layered on, the stem).
// The pattern opens in 1.5 ms so a downbeat keeps its attack; the stem crossfades in 10 ms.
export function arrangeChannels(outputs, sources, pattern, { offset, from, to, layer = false, attack, fade }) {
  outputs.forEach((out, channel) => {
    const source = sources[channel], tile = pattern[Math.min(channel, pattern.length - 1)], n = tile.length;
    out.set(source);
    for (let i = Math.max(0, from), end = Math.min(out.length, to); i < end; i++) {
      const head = i - from, tail = to - i;
      const wet = Math.min(1, (head + 1) / attack, tail / fade), dry = layer ? 1 : 1 - Math.min(1, (head + 1) / fade, tail / fade);
      out[i] = source[i] * dry + tile[((i - offset) % n + n) % n] * wet;
    }
  });
}

export function arrangeSong(source, pattern, state, layer = false) {
  const rate = source.sampleRate, clip = songClip(state, source.duration);
  const result = new AudioBuffer({ numberOfChannels: source.numberOfChannels, length: source.length, sampleRate: rate });
  const channels = buffer => Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  arrangeChannels(channels(result), channels(source), channels(pattern), { offset: Math.round(state.start * rate),
    from: Math.round(clip.start * rate), to: Math.round(clip.end * rate), layer, attack: Math.round(.0015 * rate), fade: Math.round(.01 * rate) });
  return result;
}

// Render two cycles and retain the second so sample tails wrap across the seam.
// Each lane retriggers at its next hit, keeping polyphony and render memory bounded.
// The result loops on the same audio clock and rate as the other stems, even when
// browser timers are throttled. Editing replaces this small derived buffer only.
export async function renderDrumPattern(state, slices, buffer) {
  const range = sequenceRange(state, buffer);
  if (!range) throw new RangeError('The pattern does not fit in the source audio.');
  const count = state.bars * 16;
  const frames = Math.round((range.endMs - range.startMs) / 1000 * buffer.sampleRate);
  const length = frames / buffer.sampleRate;
  const renderer = new OfflineAudioContext(buffer.numberOfChannels, frames * 2, buffer.sampleRate);
  for (let row = 0; row < 8; row++) {
    const slice = normalizeDrumSlice(slices[row], buffer);
    if (!slice) continue;
    const hits = state.steps[row].slice(0, count).flatMap((velocity, step) => velocity > 0 ? [{ step, velocity }] : []);
    for (let index = 0; index < hits.length; index++) {
      const hit = hits[index], next = hits[(index + 1) % hits.length];
      const gap = ((next.step - hit.step + count) % count || count) / count * length;
      const cropped = normalizeDrumSlice({ ...slice, end: slice.start + Math.min(slice.end - slice.start, gap) }, buffer);
      for (let cycle = 0; cycle < 2; cycle++) {
        const source = renderer.createBufferSource(), envelope = renderer.createGain(), gain = renderer.createGain();
        const when = cycle * length + hit.step / count * length;
        source.buffer = buffer; gain.gain.value = hit.velocity;
        scheduleDrumEnvelope(envelope.gain, cropped, when);
        source.connect(envelope).connect(gain).connect(renderer.destination);
        source.start(when, cropped.start, cropped.end - cropped.start);
      }
    }
  }
  const rendered = await renderer.startRendering();
  const result = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: frames, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    result.copyToChannel(rendered.getChannelData(channel).subarray(frames), channel);
  }
  return result;
}
