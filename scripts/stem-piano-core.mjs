import { normalizeDrumSlice } from './stem-sampler.mjs';
import { sequenceRange } from './stem-sequencer-core.mjs';

export const MAX_PIANO_NOTES = 512;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const noteName = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchRatio = (midi, root) => 2 ** ((midi - root) / 12);

export function normalizePiano(value, buffer) {
  const notes = Array.isArray(value?.notes) ? value.notes : [];
  return {
    version: 1,
    sample: normalizeDrumSlice(value?.sample, buffer),
    root: Number.isFinite(value?.root) ? clamp(Math.round(value.root), 24, 96) : 60,
    mode: ['layer', 'replace'].includes(value?.mode) ? value.mode : 'off',
    sustain: value?.sustain === true,
    octave: Number.isInteger(value?.octave) ? clamp(value.octave, 1, 5) : 3,
    snap: [0.5, 1, 2, 4].includes(value?.snap) ? value.snap : 1,
    notes: notes.filter(note => Number.isFinite(note?.pitch) && Number.isFinite(note?.start) &&
      Number.isFinite(note?.length) && note.start >= 0 && note.start < 64 && note.length > 0)
      .slice(0, MAX_PIANO_NOTES).map(note => ({
        pitch: clamp(Math.round(note.pitch), 24, 96),
        start: Math.round(note.start * 2) / 2,
        length: clamp(Math.round(note.length * 2) / 2, .5, 64),
        velocity: Number.isFinite(note.velocity) ? clamp(note.velocity, .01, 1) : .8,
      })).filter(note => note.start < 64),
  };
}

// Shared by preview and offline rendering: MIDI changes sample speed, while the
// note gate stays in transport seconds. start() duration is in *buffer* seconds.
export function schedulePianoNote(context, destination, buffer, state, note, when, seconds) {
  const slice = normalizeDrumSlice(state.sample, buffer);
  if (!slice || !(seconds > 0)) return null;
  const ratio = pitchRatio(note.pitch, state.root), sampleLength = slice.end - slice.start;
  const length = state.sustain ? seconds : Math.min(seconds, sampleLength / ratio);
  const attack = Math.min(slice.fadeIn / ratio, length / 2);
  const release = Math.min(slice.fadeOut / ratio, length / 2);
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = state.sustain ? loopSample(buffer, slice) : buffer; source.playbackRate.value = ratio;
  source.loop = state.sustain; source.loopStart = 0; source.loopEnd = source.buffer.duration;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(note.velocity, when + attack);
  gain.gain.setValueAtTime(note.velocity, when + Math.max(attack, length - release));
  gain.gain.linearRampToValueAtTime(0, when + length);
  source.connect(gain).connect(destination);
  const cleanup = () => { source.disconnect(); gain.disconnect(); };
  source.onended = cleanup;
  if (state.sustain) source.start(when, 0);
  else source.start(when, slice.start, sampleLength);
  source.stop(when + length);
  return { source, gain, cleanup, stop() {
    const now = context.currentTime;
    gain.gain.cancelAndHoldAtTime(now); gain.gain.linearRampToValueAtTime(0, now + .005);
    source.stop(now + .005);
  } };
}

// Short fades at the loop seam avoid clicks on arbitrary cuts. Cache only the
// current slice per source buffer; editing never changes the separated PCM.
const loopSamples = new WeakMap();
function loopSample(buffer, slice) {
  const key = `${slice.start}/${slice.end}`, cached = loopSamples.get(buffer);
  if (cached?.key === key) return cached.buffer;
  const first = Math.round(slice.start * buffer.sampleRate), end = Math.round(slice.end * buffer.sampleRate);
  const result = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, length: Math.max(1, end - first) });
  const fade = Math.min(Math.floor(result.length / 2), Math.round(.003 * buffer.sampleRate));
  for (let channel = 0; channel < result.numberOfChannels; channel++) {
    const pcm = result.getChannelData(channel); pcm.set(buffer.getChannelData(channel).subarray(first, end));
    for (let i = 0; i < fade; i++) { const gain = i / fade; pcm[i] *= gain; pcm[pcm.length - i - 1] *= gain; }
  }
  loopSamples.set(buffer, { key, buffer: result }); return result;
}

// No timer scheduler: one small derived loop follows the stems' AudioContext,
// playbackRate and Keep Tone processor. A second cycle includes wrapped tails.
export async function renderPianoPattern(value, grid, buffer) {
  const state = normalizePiano(value, buffer), range = sequenceRange(grid, buffer);
  if (!range) throw new RangeError('The pattern does not fit in the source audio.');
  const frames = Math.round((range.endMs - range.startMs) * buffer.sampleRate / 1000);
  const seconds = frames / buffer.sampleRate, stepSeconds = seconds / (grid.bars * 16);
  const renderer = new OfflineAudioContext(buffer.numberOfChannels, frames * 2, buffer.sampleRate);
  for (const note of state.notes) {
    if (note.start >= grid.bars * 16) continue;
    // Limit a held note to one cycle so the second cycle contains its full tail.
    for (let cycle = 0; cycle < 2; cycle++) schedulePianoNote(renderer, renderer.destination, buffer,
      state, note, cycle * seconds + note.start * stepSeconds, Math.min(note.length * stepSeconds, seconds));
  }
  const rendered = await renderer.startRendering();
  const result = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: frames, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) result.copyToChannel(rendered.getChannelData(channel).subarray(frames), channel);
  return result;
}
