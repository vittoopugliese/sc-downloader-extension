// Arrangement times are seconds. BPM changes the editing grid, never the source audio.
export const LIMITS = Object.freeze({ tracks: 16, clips: 256, seconds: 300, pcmBytes: 256 * 1024 * 1024 });
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const uid = () => crypto.randomUUID();
export const clipPitch = clip => clip.pitch + (clip.cents || 0) / 100;
export const clipRate = clip => clip.speed * (clip.keepLength ? 1 : 2 ** (clipPitch(clip) / 12));
export const clipDuration = clip => (clip.out - clip.in) / clipRate(clip);
export const arrangementEnd = state => Math.max(0, ...state.clips.map(c => c.at + clipDuration(c)));
export const snapTime = (seconds, bpm, division) => division ? Math.round(seconds / (60 / bpm * division)) * 60 / bpm * division : seconds;
export function emptyArrangement() {
  return { version: 1, bpm: 120, tracks: Array.from({ length: 4 }, (_, i) => ({ id: uid(), name: `Track ${i + 1}`, gain: 1, mute: false, solo: false })), clips: [] };
}
export function newClip(asset, track, at = 0) {
  return { id: uid(), asset: asset.id, track, at, in: 0, out: asset.buffer.duration, pitch: 0, cents: 0, speed: 1, keepLength: true, gain: 1, mute: false, reverse: false, fadeIn: 0, fadeOut: 0 };
}
export function validateArrangement(state, assets) {
  if (state?.version !== 1 || !Number.isFinite(state.bpm) || state.bpm < 20 || state.bpm > 300 ||
      !Array.isArray(state.tracks) || !state.tracks.length || state.tracks.length > LIMITS.tracks ||
      !Array.isArray(state.clips) || state.clips.length > LIMITS.clips) throw new Error('Invalid playlist.');
  const tracks = new Set(), clips = new Set();
  for (const track of state.tracks) {
    if (typeof track.id !== 'string' || tracks.has(track.id) || typeof track.name !== 'string' || track.name.length > 160 ||
        (track.stem !== undefined && typeof track.stem !== 'string') ||
        !Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2 || typeof track.mute !== 'boolean' || typeof track.solo !== 'boolean' ||
        (track.eq != null && (typeof track.eq !== 'object' || !Array.isArray(track.eq.bands)))) throw new Error('Invalid track.');
    tracks.add(track.id);
  }
  for (const clip of state.clips) {
    const asset = assets.get(clip.asset);
    if (!asset || !tracks.has(clip.track) || typeof clip.id !== 'string' || clips.has(clip.id) ||
        !['at', 'in', 'out', 'pitch', 'speed', 'gain'].every(key => Number.isFinite(clip[key])) ||
        clip.at < 0 || clip.in < 0 || clip.out <= clip.in || (!asset.loop && clip.out > asset.buffer.duration + 1e-6) ||
        Math.abs(clip.pitch) > 24 || clip.speed < .25 || clip.speed > 4 || clip.gain < 0 || clip.gain > 2 ||
        typeof clip.keepLength !== 'boolean' || clip.at + clipDuration(clip) > LIMITS.seconds + 1e-6) throw new Error('Invalid clip or playlist exceeds 5 minutes.');
    for (const key of ['mute', 'reverse']) if (clip[key] !== undefined && typeof clip[key] !== 'boolean') throw new Error('Invalid clip flag.');
    if (!Number.isFinite(clip.cents ?? 0) || Math.abs(clip.cents ?? 0) > 100) throw new Error('Invalid fine pitch.');
    for (const key of ['fadeIn', 'fadeOut']) if (!Number.isFinite(clip[key] ?? 0) || (clip[key] ?? 0) < 0 || (clip[key] ?? 0) > LIMITS.seconds) throw new Error('Invalid fade.');
    clips.add(clip.id);
  }
  return state;
}
// Looping assets (patterns) repeat when a clip runs past their length, as FL Studio
// pattern clips do. Playback and export see one plain clip per pass, in timeline order;
// the clip's fades apply to its first and last pass.
export function loopSegments(clip, length) {
  if (!(length > 0) || clip.out <= length + 1e-6) return [clip];
  const rate = clipRate(clip), pieces = [];
  for (let from = clip.in; from < clip.out - 1e-6;) {
    const cycle = Math.floor(from / length + 1e-9), to = Math.min(clip.out, (cycle + 1) * length);
    if (to - from > 1e-4) pieces.push({ ...clip, id: `${clip.id}#${pieces.length}`, at: clip.at + (clip.reverse ? clip.out - to : from - clip.in) / rate,
      in: from - cycle * length, out: Math.min(length, to - cycle * length), fadeIn: 0, fadeOut: 0 });
    from = to;
  }
  if (!pieces.length) return [clip];
  pieces.sort((a, b) => a.at - b.at);
  pieces[0].fadeIn = clip.fadeIn || 0; pieces.at(-1).fadeOut = clip.fadeOut || 0;
  return pieces;
}
// Patterns follow the project tempo: their clips keep their position in beats.
export function retimePatternClips(state, bpm, isPattern) {
  const factor = state.bpm / bpm;
  for (const clip of state.clips) if (isPattern(clip)) {
    clip.at *= factor; clip.in *= factor; clip.out *= factor;
    clip.fadeIn = (clip.fadeIn || 0) * factor; clip.fadeOut = (clip.fadeOut || 0) * factor;
  }
  state.bpm = bpm;
}
export function splitClip(clip, seconds) {
  if (seconds <= clip.at + .01 || seconds >= clip.at + clipDuration(clip) - .01) return null;
  const cut = clip.in + (seconds - clip.at) * clipRate(clip);
  if (clip.reverse) {
    const reverseCut = clip.out - (seconds - clip.at) * clipRate(clip);
    return [{ ...clip, in: reverseCut, fadeOut: 0 }, { ...clip, id: uid(), at: seconds, out: reverseCut, fadeIn: 0 }];
  }
  return [{ ...clip, out: cut, fadeOut: 0 }, { ...clip, id: uid(), at: seconds, in: cut, fadeIn: 0 }];
}

// Slip changes the source window, retaining the clip's timeline edges.
export function slipClip(clip, delta, duration) {
  const shift = clamp(delta * clipRate(clip), -clip.in, duration - clip.out);
  return { ...clip, in: clip.in + shift, out: clip.out + shift };
}
export function crossfadeClips(clips) {
  const ordered = [...clips].filter(clip => !clip.mute).sort((a, b) => a.at - b.at);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i], b = ordered[j], end = a.at + clipDuration(a);
    if (a.track !== b.track || b.at <= a.at || b.at >= end || b.at + clipDuration(b) < end) continue;
    a.fadeOut = b.fadeIn = Math.min(end - b.at, clipDuration(a), clipDuration(b));
  }
}
export function clipEnvelope(clip, offset) {
  const duration = clipDuration(clip), fadeIn = Math.min(clip.fadeIn || 0, duration), fadeOut = Math.min(clip.fadeOut || 0, duration);
  return Math.max(0, Math.min(1, fadeIn ? offset / fadeIn : 1, fadeOut ? (duration - offset) / fadeOut : 1));
}

// Stretch mode with a pitch or speed change needs the time-stretcher; everything
// else plays straight from the source buffer through playbackRate. The asset
// version changes when a channel's audio is replaced (pattern or melody lanes).
export const needsStretch = clip => clip.keepLength && (clipPitch(clip) !== 0 || clip.speed !== 1);
export const stretchKey = (clip, version = 0) => `${clip.asset}#${version}|${clipPitch(clip)}|${clip.speed}`;

// Transport seconds [a, b) after playback began at timeline `from`, as timeline
// windows. Without a loop, playback ends at `length`. With loop {start, end}, it
// wraps from end to start. `zero` is the transport time of timeline 0 in that
// pass; `end` caps clips at the pass end; `entry` marks where playback jumps in,
// so clips already sounding there start mid-clip.
export function transportWindows(a, b, from, length, loop) {
  const windows = [];
  if (!(b > a)) return windows;
  if (!loop) {
    const lo = from + a, hi = Math.min(from + b, length);
    if (hi > lo) windows.push({ from: lo, to: hi, zero: -from, end: Infinity, entry: a === 0 });
    return windows;
  }
  const span = loop.end - loop.start, first = loop.end - from;
  if (!(span > 0) || !(first > 0)) return windows;
  let begin = 0, origin = from, passEnd = first;
  if (a >= first) {
    begin = first + Math.floor((a - first) / span) * span; origin = loop.start; passEnd = begin + span;
    if (passEnd <= a) { begin = passEnd; passEnd += span; }
  }
  for (let t = a; t < b;) {
    const to = Math.min(b, passEnd), zero = begin - origin;
    if (to > t) windows.push({ from: t - zero, to: to - zero, zero, end: loop.end, entry: Math.abs(t - begin) < 1e-7 });
    t = to;
    if (t >= passEnd) { begin = passEnd; origin = loop.start; passEnd = begin + span; }
  }
  return windows;
}

// Clips that start inside timeline window [from, to). With `active`, clips already
// sounding at `from` are included too, entering `offset` seconds into the clip.
export function clipsInWindow(clips, from, to, active = false) {
  const result = [];
  for (const clip of clips) {
    if (clip.at >= from && clip.at < to) result.push({ clip, at: clip.at, offset: 0 });
    else if (active && clip.at < from && clip.at + clipDuration(clip) > from) result.push({ clip, at: from, offset: from - clip.at });
  }
  return result;
}

// Every track, the original included, follows mute and solo.
export function trackAudible(state, track) {
  if (!track || track.mute) return false;
  const solo = state.tracks.some(item => item.solo);
  return !solo || !!track.solo;
}

export function audibleClips(state) {
  return state.clips.filter(clip => !clip.mute && trackAudible(state, state.tracks.find(t => t.id === clip.track)));
}
