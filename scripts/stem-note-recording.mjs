import { MAX_BARS, MAX_NOTES, STEPS_PER_BAR, clamp } from './stem-pattern-core.mjs';

// Quantize both ends on the same musical clock. Split a held note at the loop seam,
// so the next pass contains its tail instead of silently discarding it.
export function recordedNotes({ pitch, velocity = .8, start, end, snap, steps, loop }) {
  const first = Math.max(0, Math.round(start / snap) * snap);
  const length = Math.max(snap, Math.round(end / snap) * snap - first);
  if (!loop) return [{ pitch, velocity, start: first, length }];
  const at = first % steps, duration = Math.min(length, steps), head = Math.min(duration, steps - at);
  const result = [{ pitch, velocity, start: at, length: head }];
  if (head < duration) result.push({ pitch, velocity, start: 0, length: duration - head });
  return result;
}

export function createNoteTake(pattern, mode, snap) {
  const before = { notes: structuredClone(pattern.notes), bars: pattern.bars };
  const notes = structuredClone(before.notes), held = new Map(), steps = before.bars * STEPS_PER_BAR;
  let bars = before.bars, full = false;
  const loop = mode === 'loop';
  function grow(at) {
    if (!loop) bars = clamp(Math.max(bars, Math.floor(at / STEPS_PER_BAR) + 1), 1, MAX_BARS);
    if (at >= MAX_BARS * STEPS_PER_BAR && !loop) full = true;
  }
  return {
    before, notes, held, loop,
    get bars() { return bars; },
    get full() { return full; },
    advance: grow,
    down(key, pitch, at, velocity = .8) {
      if (held.has(key) || full) return;
      if (notes.length + held.size >= MAX_NOTES) { full = true; return; }
      held.set(key, { pitch, velocity, start: at }); grow(at);
    },
    up(key, at) {
      const note = held.get(key); if (!note) return;
      held.delete(key);
      const end = loop ? at : Math.min(at, MAX_BARS * STEPS_PER_BAR);
      const captured = recordedNotes({ ...note, end, snap, steps, loop }).filter(n => n.start < MAX_BARS * STEPS_PER_BAR)
        .map(n => ({ ...n, length: Math.min(n.length, MAX_BARS * STEPS_PER_BAR - n.start) }));
      notes.push(...captured.slice(0, MAX_NOTES - notes.length));
      if (!loop && captured.length) bars = Math.max(bars, Math.ceil(Math.max(...captured.map(n => n.start + n.length)) / STEPS_PER_BAR));
      full ||= notes.length >= MAX_NOTES;
    },
  };
}
