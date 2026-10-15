// Arrangement times are seconds. BPM changes the editing grid, never the source audio.
export const LIMITS = Object.freeze({ tracks: 16, clips: 256, seconds: 300, pcmBytes: 256 * 1024 * 1024 });
export const MONITORS = Object.freeze(['mix', 'original']);
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const uid = () => crypto.randomUUID();
export const clipRate = clip => clip.speed * (clip.keepLength ? 1 : 2 ** (clip.pitch / 12));
export const clipDuration = clip => (clip.out - clip.in) / clipRate(clip);
export const arrangementEnd = state => Math.max(0, ...state.clips.map(c => c.at + clipDuration(c)));
export const snapTime = (seconds, bpm, division) => division ? Math.round(seconds / (60 / bpm * division)) * 60 / bpm * division : seconds;
export function emptyArrangement() {
  return { version: 1, bpm: 120, monitor: 'mix', tracks: Array.from({ length: 4 }, (_, i) => ({ id: uid(), name: `Track ${i + 1}`, gain: 1, mute: false, solo: false })), clips: [] };
}
export function newClip(asset, track, at = 0) {
  return { id: uid(), asset: asset.id, track, at, in: 0, out: asset.buffer.duration, pitch: 0, speed: 1, keepLength: true, gain: 1 };
}
export function validateArrangement(state, assets) {
  if (state?.version !== 1 || !Number.isFinite(state.bpm) || state.bpm < 20 || state.bpm > 300 || !MONITORS.includes(state.monitor ?? 'mix') ||
      !Array.isArray(state.tracks) || !state.tracks.length || state.tracks.length > LIMITS.tracks ||
      !Array.isArray(state.clips) || state.clips.length > LIMITS.clips) throw new Error('Invalid playlist.');
  const tracks = new Set(), clips = new Set();
  for (const track of state.tracks) {
    if (typeof track.id !== 'string' || tracks.has(track.id) || typeof track.name !== 'string' || track.name.length > 160 ||
        (track.stem !== undefined && typeof track.stem !== 'string') ||
        !Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2 || typeof track.mute !== 'boolean' || typeof track.solo !== 'boolean') throw new Error('Invalid track.');
    tracks.add(track.id);
  }
  for (const clip of state.clips) {
    const asset = assets.get(clip.asset);
    if (!asset || !tracks.has(clip.track) || typeof clip.id !== 'string' || clips.has(clip.id) ||
        !['at', 'in', 'out', 'pitch', 'speed', 'gain'].every(key => Number.isFinite(clip[key])) ||
        clip.at < 0 || clip.in < 0 || clip.out <= clip.in || clip.out > asset.buffer.duration + 1e-6 ||
        Math.abs(clip.pitch) > 24 || clip.speed < .25 || clip.speed > 4 || clip.gain < 0 || clip.gain > 2 ||
        typeof clip.keepLength !== 'boolean' || clip.at + clipDuration(clip) > LIMITS.seconds + 1e-6) throw new Error('Invalid clip or playlist exceeds 5 minutes.');
    clips.add(clip.id);
  }
  return state;
}
export function splitClip(clip, seconds) {
  if (seconds <= clip.at + .01 || seconds >= clip.at + clipDuration(clip) - .01) return null;
  const cut = clip.in + (seconds - clip.at) * clipRate(clip);
  return [{ ...clip, out: cut }, { ...clip, id: uid(), at: seconds, in: cut }];
}

// Stretch mode with a pitch or speed change needs the time-stretcher; everything
// else plays straight from the source buffer through playbackRate. The asset
// version changes when a channel's audio is replaced (pattern or melody lanes).
export const needsStretch = clip => clip.keepLength && (clip.pitch !== 0 || clip.speed !== 1);
export const stretchKey = (clip, version = 0) => `${clip.asset}#${version}|${clip.pitch}|${clip.speed}`;

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

// Monitor "original" compares against the source: stem channels fall silent.
// Monitor "mix" silences the original channel. Other tracks follow mute and solo.
export function trackAudible(state, track) {
  if (!track || track.mute) return false;
  if (state.monitor === 'original' ? track.stem && track.stem !== 'original' : track.stem === 'original') return false;
  const solo = state.tracks.some(item => item.solo);
  return !solo || !!track.solo;
}

export function audibleClips(state) {
  return state.clips.filter(clip => trackAudible(state, state.tracks.find(t => t.id === clip.track)));
}
