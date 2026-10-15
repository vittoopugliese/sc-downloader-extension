import { normalizeDrumSlice, scheduleDrumEnvelope } from './stem-sampler.mjs';

// FL-style patterns: a track is an instrument (eight pads cut from its audio, one of
// them also played by the piano roll); a pattern belongs to one instrument and holds
// its steps and notes. Patterns render to playlist clips at the project tempo.
export const PAD_KEYS = 'ASDFGHJK';
export const STEPS_PER_BAR = 16;
export const MAX_STEPS = 64;
export const MAX_NOTES = 512;
export const MAX_PATTERNS = 32;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const noteName = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchRatio = (midi, root) => 2 ** ((midi - root) / 12);
export const patternSeconds = (pattern, bpm) => pattern.bars * 240 / bpm;
const validId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);

export function normalizePiano(value) {
  return {
    pad: Number.isInteger(value?.pad) ? clamp(value.pad, 0, 7) : 0,
    root: Number.isFinite(value?.root) ? clamp(Math.round(value.root), 24, 96) : 60,
    sustain: value?.sustain === true,
    octave: Number.isInteger(value?.octave) ? clamp(value.octave, 1, 5) : 3,
    snap: [.5, 1, 2, 4].includes(value?.snap) ? value.snap : 1,
  };
}

// Without a buffer the slices stay as saved; they are bounded once the track's audio is known.
export function normalizeInstrument(value, buffer = null) {
  return {
    slices: Array.from({ length: 8 }, (_, i) => {
      const slice = value?.slices?.[i];
      if (buffer) return normalizeDrumSlice(slice, buffer);
      return Number.isFinite(slice?.start) ? { ...slice } : null;
    }),
    piano: normalizePiano(value?.piano),
  };
}

export function normalizeNotes(notes) {
  return (Array.isArray(notes) ? notes : []).filter(note => Number.isFinite(note?.pitch) && Number.isFinite(note?.start) &&
    Number.isFinite(note?.length) && note.start >= 0 && note.start < MAX_STEPS && note.length > 0)
    .slice(0, MAX_NOTES).map(note => ({
      pitch: clamp(Math.round(note.pitch), 24, 96),
      start: Math.round(note.start * 2) / 2,
      length: clamp(Math.round(note.length * 2) / 2, .5, MAX_STEPS),
      velocity: Number.isFinite(note.velocity) ? clamp(note.velocity, .01, 1) : .8,
    })).filter(note => note.start < MAX_STEPS);
}

export function normalizePattern(value) {
  if (!validId(value?.id) || !validId(value?.track)) return null;
  return {
    id: value.id, track: value.track,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Pat',
    bars: [1, 2, 4].includes(value.bars) ? value.bars : 1,
    // Shortening a pattern keeps the hidden bars; changing length is reversible.
    steps: Array.from({ length: 8 }, (_, row) => Array.from({ length: MAX_STEPS }, (_, step) => {
      const velocity = value.steps?.[row]?.[step];
      return Number.isFinite(velocity) ? clamp(velocity, 0, 1) : 0;
    })),
    notes: normalizeNotes(value.notes),
  };
}

export function normalizeProject(value) {
  const instruments = {};
  for (const [key, instrument] of Object.entries(value?.instruments || {})) if (validId(key)) instruments[key] = normalizeInstrument(instrument);
  const seen = new Set(), patterns = [];
  for (const item of Array.isArray(value?.patterns) ? value.patterns : []) {
    const pattern = normalizePattern(item);
    if (pattern && !seen.has(pattern.id) && patterns.length < MAX_PATTERNS) { seen.add(pattern.id); patterns.push(pattern); }
  }
  return { instruments, patterns };
}

// Presets from the per-track editors: pads, the rack's steps and the piano's notes
// become one instrument and one pattern per track. The piano's own sample moves to
// a free pad. Patterns are not placed: the old lanes replaced the stems in place.
export function migrateLegacy(settings, uid = () => crypto.randomUUID()) {
  const editors = settings?.trackEditors || {
    drums: { slices: settings?.drumSlices ?? settings?.drumStarts, sequence: settings?.drumSequence },
    other: { piano: settings?.piano },
  };
  const instruments = {}, patterns = [];
  for (const [key, editor] of Object.entries(editors)) {
    if (!validId(key) || !editor) continue;
    const slices = Array.from({ length: 8 }, (_, i) => {
      const slice = editor.slices?.[i];
      return typeof slice === 'number' ? { start: slice } : Number.isFinite(slice?.start) ? { ...slice } : null;
    });
    const piano = { ...editor.piano };
    if (Number.isFinite(editor.piano?.sample?.start)) {
      const free = slices.findIndex(slice => !slice);
      piano.pad = free < 0 ? 7 : free; slices[piano.pad] = { ...editor.piano.sample };
    }
    const bars = [1, 2, 4].includes(editor.sequence?.bars) ? editor.sequence.bars : 1;
    const steps = editor.sequence?.steps, notes = normalizeNotes(editor.piano?.notes);
    const hasSteps = Array.isArray(steps) && steps.some(row => Array.isArray(row) && row.some(value => value > 0));
    if (!slices.some(Boolean) && !hasSteps && !notes.length) continue;
    instruments[key] = normalizeInstrument({ slices, piano });
    if (hasSteps || notes.length) patterns.push(normalizePattern({ id: uid(), track: key, name: 'Pat 1', bars, steps, notes }));
  }
  return { instruments, patterns };
}

// Shared by preview and offline rendering: MIDI changes sample speed, while the
// note gate stays in transport seconds. start() duration is in *buffer* seconds.
export function schedulePianoNote(context, destination, buffer, slice, piano, note, when, seconds) {
  slice = normalizeDrumSlice(slice, buffer);
  if (!slice || !(seconds > 0)) return null;
  const ratio = pitchRatio(note.pitch, piano.root), sampleLength = slice.end - slice.start;
  const length = piano.sustain ? seconds : Math.min(seconds, sampleLength / ratio);
  const attack = Math.min(slice.fadeIn / ratio, length / 2);
  const release = Math.min(slice.fadeOut / ratio, length / 2);
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = piano.sustain ? loopSample(buffer, slice) : buffer; source.playbackRate.value = ratio;
  source.loop = piano.sustain; source.loopStart = 0; source.loopEnd = source.buffer.duration;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(note.velocity, when + attack);
  gain.gain.setValueAtTime(note.velocity, when + Math.max(attack, length - release));
  gain.gain.linearRampToValueAtTime(0, when + length);
  source.connect(gain).connect(destination);
  const cleanup = () => { source.disconnect(); gain.disconnect(); };
  source.onended = cleanup;
  if (piano.sustain) source.start(when, 0);
  else source.start(when, slice.start, sampleLength);
  source.stop(when + length);
  return { source, gain, cleanup, stop() {
    const now = context.currentTime;
    gain.gain.cancelAndHoldAtTime(now); gain.gain.linearRampToValueAtTime(0, now + .005);
    source.stop(now + .005);
  } };
}

// Short fades at the loop seam avoid clicks on arbitrary cuts. Cache only the
// current slice per source buffer; editing never changes the source PCM.
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

export function silentPattern(pattern, bpm, sampleRate = 44100) {
  return new AudioBuffer({ numberOfChannels: 2, sampleRate, length: Math.max(1, Math.round(patternSeconds(pattern, bpm) * sampleRate)) });
}

// One cycle of the pattern at `bpm`. A pad hit is cut at the same pad's next hit,
// keeping polyphony and memory bounded; anything sounding past the cycle is cut.
export async function renderPattern(pattern, instrument, buffer, bpm) {
  const sampleRate = buffer?.sampleRate || 44100;
  const frames = Math.max(1, Math.round(patternSeconds(pattern, bpm) * sampleRate));
  if (!buffer) return silentPattern(pattern, bpm, sampleRate);
  const length = frames / sampleRate, count = pattern.bars * STEPS_PER_BAR, step = length / count;
  const renderer = new OfflineAudioContext(2, frames, sampleRate);
  for (let row = 0; row < 8; row++) {
    const slice = normalizeDrumSlice(instrument.slices[row], buffer);
    if (!slice) continue;
    const hits = pattern.steps[row].slice(0, count).flatMap((velocity, index) => velocity > 0 ? [{ index, velocity }] : []);
    hits.forEach((hit, i) => {
      const next = hits[i + 1]?.index ?? count;
      const cropped = normalizeDrumSlice({ ...slice, end: slice.start + Math.min(slice.end - slice.start, (next - hit.index) * step) }, buffer);
      const source = renderer.createBufferSource(), envelope = renderer.createGain(), gain = renderer.createGain();
      const when = hit.index * step;
      source.buffer = buffer; gain.gain.value = hit.velocity;
      scheduleDrumEnvelope(envelope.gain, cropped, when);
      source.connect(envelope).connect(gain).connect(renderer.destination);
      source.start(when, cropped.start, cropped.end - cropped.start);
    });
  }
  const sample = instrument.slices[instrument.piano.pad];
  for (const note of pattern.notes) {
    if (note.start >= count) continue;
    schedulePianoNote(renderer, renderer.destination, buffer, sample, instrument.piano, note,
      note.start * step, Math.min(note.length, count - note.start) * step);
  }
  return renderer.startRendering();
}
