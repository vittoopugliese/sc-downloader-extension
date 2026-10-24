// Automation times use playlist seconds; point times are local to their clip.
// A point's curve describes the segment leaving it. Clips own [at, at + duration),
// and the underlying knob value resumes outside them. Overlaps use the latest
// clip start (the last array entry breaks a tie), independently of visual lanes.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPSILON = 1e-8;
const parameter = (label, min, max, value, supported = true, unit = '%') => Object.freeze({ label, min, max, default: value, supported, unit });
export const AUTOMATION_PARAMETERS = Object.freeze({
  gain: parameter('Volume', 0, 2, 1, true, ''),
  'fx.reverb': parameter('Reverb · Mix', 0, 100, 0),
  'fx.delay': parameter('Echo · Mix', 0, 100, 0),
  'fx.flanger': parameter('Flanger · Mix', 0, 100, 0),
  'fx.phaser': parameter('Phaser · Mix', 0, 100, 0),
  'fx.saturation': parameter('Saturation · Mix', 0, 100, 0),
  'fx.bitcrusher': parameter('Bitcrusher · Mix', 0, 100, 0),
  'fx.reverbSize': parameter('Reverb · Size', 0, 100, 55, false),
  'fx.reverbDecay': parameter('Reverb · Decay', .2, 12, 2.4, false, 's'),
  'fx.reverbPreDelay': parameter('Reverb · Pre-delay', 0, 200, 20, false, 'ms'),
  'fx.reverbTone': parameter('Reverb · Tone', 0, 100, 70, false),
  'fx.delayTime': parameter('Echo · Time', 60, 800, 250, false, 'ms'),
  'fx.delayFeedback': parameter('Echo · Feedback', 0, 100, 25, false),
  'fx.delayTone': parameter('Echo · Tone', 0, 100, 70, false),
  'fx.flangerRate': parameter('Flanger · Rate', .05, 5, .25, false, 'Hz'),
  'fx.flangerDepth': parameter('Flanger · Depth', 0, 100, 50, false),
  'fx.flangerFeedback': parameter('Flanger · Feedback', 0, 100, 15, false),
  'fx.phaserRate': parameter('Phaser · Rate', .05, 5, .2, false, 'Hz'),
  'fx.phaserDepth': parameter('Phaser · Depth', 0, 100, 50, false),
  'fx.phaserFeedback': parameter('Phaser · Feedback', 0, 100, 10, false),
  'fx.saturationDrive': parameter('Saturation · Drive', 0, 100, 25, false),
  'fx.saturationTone': parameter('Saturation · Tone', 0, 100, 60, false),
  'fx.bitDepth': parameter('Bitcrusher · Bits', 2, 16, 12, false, ''),
  'fx.sampleRateReduction': parameter('Bitcrusher · Downsample', 0, 100, 25, false),
});

function descriptor(target) {
  const result = AUTOMATION_PARAMETERS[target?.param];
  if (!result?.supported || typeof target?.track !== 'string' || !target.track) throw new Error('Invalid automation target.');
  return result;
}

export function newAutomationClip({ id = globalThis.crypto.randomUUID(), track, target, at = 0, duration = 4, value }) {
  const spec = descriptor(target);
  return normalizeAutomationClip({ id, track, target: { ...target }, at, duration,
    points: [{ at: 0, value: value ?? spec.default, curve: 'linear' }, { at: duration, value: value ?? spec.default, curve: 'linear' }] });
}

// Used for editor gestures, not to silently repair imported project data. Loading
// calls validateAutomation first, so corrupt/unknown targets cannot become inert clips.
export function normalizeAutomationClip(clip) {
  const spec = descriptor(clip.target), duration = Math.max(.01, Number.isFinite(clip.duration) ? clip.duration : 4);
  const points = new Map();
  for (const point of clip.points || []) {
    if (!Number.isFinite(point.at) || !Number.isFinite(point.value)) continue;
    const at = clamp(point.at, 0, duration);
    points.set(at, { at, value: clamp(point.value, spec.min, spec.max), curve: point.curve === 'hold' ? 'hold' : 'linear' });
  }
  const ordered = [...points.values()].sort((a, b) => a.at - b.at);
  if (!ordered.length) ordered.push({ at: 0, value: spec.default, curve: 'linear' });
  if (ordered[0].at > 0) ordered.unshift({ ...ordered[0], at: 0 });
  if (ordered.at(-1).at < duration) ordered.push({ ...ordered.at(-1), at: duration });
  return { ...clip, target: { ...clip.target }, at: Math.max(0, Number.isFinite(clip.at) ? clip.at : 0), duration, points: ordered };
}

export function validateAutomation(clips = [], tracks, { seconds = 300, maxClips = 256, maxPoints = 2048 } = {}) {
  if (!Array.isArray(clips) || clips.length > maxClips) throw new Error('Invalid automation clips.');
  const trackIds = new Set(Array.from(tracks || [], track => typeof track === 'string' ? track : track.id)), ids = new Set();
  const automationTracks = new Set(Array.from(tracks || []).filter(track => track?.kind === 'automation').map(track => track.id));
  for (const clip of clips) {
    const spec = descriptor(clip?.target);
    if (typeof clip.id !== 'string' || !clip.id || ids.has(clip.id) || !trackIds.has(clip.track) ||
        (clip.target.track !== 'master' && (!trackIds.has(clip.target.track) || automationTracks.has(clip.target.track))) ||
        !Number.isFinite(clip.at) || clip.at < 0 || !Number.isFinite(clip.duration) || clip.duration < .01 || clip.at + clip.duration > seconds + EPSILON ||
        (clip.mute !== undefined && typeof clip.mute !== 'boolean') ||
        !Array.isArray(clip.points) || clip.points.length < 2 || clip.points.length > maxPoints) throw new Error('Invalid automation clip.');
    let previous = -Infinity;
    for (const point of clip.points) {
      if (!point || !Number.isFinite(point.at) || point.at < 0 || point.at > clip.duration + EPSILON || point.at <= previous ||
          !Number.isFinite(point.value) || point.value < spec.min || point.value > spec.max || !['linear', 'hold'].includes(point.curve)) throw new Error('Invalid automation point.');
      previous = point.at;
    }
    if (clip.points[0].at !== 0 || Math.abs(clip.points.at(-1).at - clip.duration) > EPSILON) throw new Error('Automation must include both endpoints.');
    ids.add(clip.id);
  }
  return clips;
}

function matches(clip, target) { return !clip.mute && clip.target?.track === target.track && clip.target?.param === target.param; }
function activeClip(clips, target, at) {
  let active = null;
  for (const clip of clips || []) if (matches(clip, target) && clip.at <= at && at < clip.at + clip.duration && (!active || clip.at >= active.at)) active = clip;
  return active;
}
function segment(clip, local) {
  const points = clip.points;
  let left = points[0], right = left;
  for (let index = 1; index < points.length; index++) {
    right = points[index];
    if (local < right.at) return { left, right };
    left = right;
  }
  return { left, right };
}
function clipValue(clip, at) {
  const local = clamp(at - clip.at, 0, clip.duration), { left, right } = segment(clip, local);
  if (left.curve === 'hold' || right.at <= left.at) return left.value;
  return left.value + (right.value - left.value) * clamp((local - left.at) / (right.at - left.at), 0, 1);
}

export function automationValue(clips, target, at, baseline) {
  const clip = activeClip(clips, target, at);
  return clip ? clipValue(clip, at) : baseline;
}

// Produces Web Audio-style events without owning a context. Each window starts
// with a set event, so seek, playback speed changes, loops and offline rendering
// share the same timeline. Linear ramps end at their exact point, with explicit
// anchors after gaps. A hold point jumps instead of ramping at its right edge.
export function automationEvents(clips, target, { from, to, baseline }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from) || !Number.isFinite(baseline)) return [];
  const relevant = (clips || []).filter(clip => matches(clip, target) && clip.at <= to && clip.at + clip.duration >= from);
  const times = new Set([from, to]);
  for (const clip of relevant) {
    for (const at of [clip.at, clip.at + clip.duration, ...clip.points.map(point => clip.at + point.at)]) if (at > from && at < to) times.add(at);
  }
  const bounds = [...times].sort((a, b) => a - b), events = [];
  let value = automationValue(relevant, target, from, baseline);
  const emit = (at, next, curve) => {
    const last = events.at(-1);
    if (last?.at === at && last.value === next && last.curve === curve) return;
    events.push({ at, value: next, curve });
  };
  emit(from, value, 'set');
  for (let index = 0; index < bounds.length - 1; index++) {
    const begin = bounds[index], end = bounds[index + 1], clip = activeClip(relevant, target, begin);
    const part = clip ? segment(clip, begin - clip.at) : null;
    if (clip && part.left.curve === 'linear' && part.right.at > part.left.at) {
      const next = clipValue(clip, end);
      if (Math.abs(next - value) > EPSILON) { emit(begin, value, 'set'); emit(end, next, 'linear'); value = next; }
    }
    const next = automationValue(relevant, target, end, baseline);
    if (Math.abs(next - value) > EPSILON) { emit(end, next, 'set'); value = next; }
  }
  return events;
}

export function scheduleAutomation(audioParam, clips, target, { from, to, when, rate = 1, baseline, scale = 1, cancel = false }) {
  if (!Number.isFinite(when) || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(scale)) throw new Error('Invalid automation schedule.');
  const events = automationEvents(clips, target, { from, to, baseline });
  if (cancel) audioParam.cancelScheduledValues(when);
  for (const event of events) audioParam[event.curve === 'linear' ? 'linearRampToValueAtTime' : 'setValueAtTime'](event.value * scale, when + (event.at - from) / rate);
  return events;
}

// Tempo changes and stretch-resizing both retain the envelope's shape in beats.
// Returns new clips; the caller owns the history transaction and state replacement.
export function retimeAutomation(clips, factor) {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Invalid automation time scale.');
  return (clips || []).map(clip => ({ ...clip, target: { ...clip.target }, at: clip.at * factor, duration: clip.duration * factor,
    points: clip.points.map(point => ({ ...point, at: point.at * factor })) }));
}
