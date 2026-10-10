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

export function sequenceStep(state, range, position) {
  if (!range || position * 1000 < range.startMs || position * 1000 >= range.endMs) return -1;
  return Math.min(state.bars * 16 - 1, Math.floor((position * 1000 - range.startMs) / (range.endMs - range.startMs) * state.bars * 16));
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
