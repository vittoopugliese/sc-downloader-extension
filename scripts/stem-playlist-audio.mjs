import { arrangementEnd, audibleClips, clipDuration, clipRate, clipPitch, clipEnvelope, clipsInWindow, needsStretch, stretchKey, trackAudible, transportWindows, validateArrangement } from './stem-playlist-core.mjs';

const LOOKAHEAD = 1.5, TICK_MS = 200, RESTART_FADE = .01, STRETCH_PAD = 1;
const MAX_RENDER_BYTES = 128 * 1024 * 1024;
const reversedBuffers = new WeakMap();
function reversed(buffer) {
  if (!reversedBuffers.has(buffer)) {
    const result = new AudioBuffer({ length: buffer.length, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels });
    for (let c = 0; c < buffer.numberOfChannels; c++) result.copyToChannel(buffer.getChannelData(c).slice().reverse(), c);
    reversedBuffers.set(buffer, result);
  }
  return reversedBuffers.get(buffer);
}

// One clip as a buffer source on any context: the realtime engine and the offline
// export share it, so the exported WAV matches what was heard. `offset` and `limit`
// are timeline seconds; `rate` is the global transport speed. A late start skips
// ahead instead of drifting.
export function startClip(context, destination, clip, asset, stretched, when, offset = 0, { rate = 1, limit = Infinity } = {}) {
  if (clip.mute) return null;
  const late = context instanceof AudioContext ? Math.max(0, context.currentTime + .005 - when) : 0;
  when += late; offset += late * rate;
  const span = Math.min(clipDuration(clip) - offset, limit - (late * rate)), duration = span / rate;
  if (duration <= .002) return null;
  const source = context.createBufferSource(), gain = context.createGain();
  const base = stretched ? 1 : clipRate(clip);
  const buffer = stretched ? stretched.buffer : asset.buffer;
  source.buffer = clip.reverse ? reversed(buffer) : buffer;
  source.playbackRate.value = base * rate;
  // 3 ms ramps at the edges avoid clicks on arbitrary cuts, loop seams and mid-clip entries.
  const fade = Math.min(.003, duration / 2);
  gain.gain.setValueAtTime(0, when);
  const length = clipDuration(clip), fi = Math.min(clip.fadeIn || 0, length), fo = Math.min(clip.fadeOut || 0, length);
  const points = [fade, duration - fade, (fi - offset) / rate, (length - fo - offset) / rate];
  if (fi + fo > length) points.push((length * fi / (fi + fo) - offset) / rate);
  for (const at of [...new Set(points)].filter(at => at >= fade && at <= duration - fade).sort((a, b) => a - b)) {
    gain.gain.linearRampToValueAtTime(clip.gain * clipEnvelope(clip, offset + at * rate), when + at);
  }
  gain.gain.linearRampToValueAtTime(0, when + duration);
  source.connect(gain).connect(destination);
  const first = stretched ? stretched.offset : clip.in;
  const start = clip.reverse ? buffer.duration - first - length * base : first;
  source.start(when, Math.max(0, start + offset * base), span * base);
  source.stop(when + duration);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  return { source, gain };
}

// Stretched renders keyed by asset version, pitch and speed. Each entry covers a
// padded source range, so trims, splits and duplicates of a clip reuse the same
// render. Padding past the sample edges is silence: the stretcher keeps an onset
// sharp after silence, but fades in over ~50 ms when the audio starts at frame 0.
// Jobs run one at a time in a worker; least recently used entries are evicted.
export function createStretchCache({ budget = 192 * 1024 * 1024, onChange = () => {} } = {}) {
  const entries = new Map(), pending = [], replies = new Map();
  let used = 0, bytes = 0, worker = null, nextId = 0, queue = Promise.resolve();
  const covers = (range, clip) => range.from <= clip.in + 1e-6 && range.to >= clip.out - 1e-6;
  const keyOf = (clip, asset) => stretchKey(clip, asset?.version || 0);
  function find(clip, asset) {
    const entry = (entries.get(keyOf(clip, asset)) || []).find(item => covers(item, clip));
    if (entry) entry.used = ++used;
    return entry;
  }
  function spawn() {
    const next = new Worker(new URL('./stem-playlist-worker.mjs', import.meta.url), { type: 'module' });
    next.onmessage = ({ data }) => {
      const reply = replies.get(data.id); replies.delete(data.id);
      if (data.error) reply?.reject(new Error(data.error)); else reply?.resolve(data.channels);
    };
    next.onerror = event => {
      event.preventDefault();
      for (const reply of replies.values()) reply.reject(new Error('The stretch worker stopped.'));
      replies.clear(); next.terminate(); if (worker === next) worker = null;
    };
    return next;
  }
  function stretch(message, transfer) {
    worker ||= spawn();
    return new Promise((resolve, reject) => {
      const id = ++nextId; replies.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }
  function drop(key, entry) {
    const rest = entries.get(key).filter(item => item !== entry);
    if (rest.length) entries.set(key, rest); else entries.delete(key);
    bytes -= entry.bytes;
  }
  function evict() {
    while (bytes > budget) {
      let oldest = null, key = null;
      for (const [name, list] of entries) for (const entry of list) if (!oldest || entry.used < oldest.used) { oldest = entry; key = name; }
      if (!oldest) return;
      drop(key, oldest);
    }
  }
  async function render(key, clip, asset, from, to) {
    if (find(clip, asset)) return;
    const buffer = asset.buffer, rate = buffer.sampleRate, first = Math.floor(from * rate), last = Math.ceil(to * rate);
    const count = Math.min(2, buffer.numberOfChannels);
    if ((last - first) / clip.speed * count * 4 > MAX_RENDER_BYTES) throw new Error('Clip is too large to stretch.');
    const channels = Array.from({ length: count }, (_, c) => {
      const range = new Float32Array(last - first);
      range.set(buffer.getChannelData(c).subarray(Math.max(0, first), Math.min(buffer.length, last)), Math.max(0, -first));
      return range;
    });
    const output = await stretch({ channels, sampleRate: rate, pitch: clipPitch(clip), speed: clip.speed }, channels.map(c => c.buffer));
    const result = new AudioBuffer({ numberOfChannels: output.length, length: output[0].length, sampleRate: rate });
    output.forEach((channel, c) => result.copyToChannel(channel, c));
    const entry = { from: first / rate, to: last / rate, buffer: result, used: ++used, bytes: result.length * result.numberOfChannels * 4 };
    for (const old of entries.get(key) || []) if (old.from >= entry.from && old.to <= entry.to) drop(key, old);
    entries.set(key, [...(entries.get(key) || []), entry]);
    bytes += entry.bytes; evict();
  }
  return {
    lookup(clip, asset) {
      const entry = find(clip, asset);
      return entry ? { buffer: entry.buffer, offset: (clip.in - entry.from) / clip.speed } : null;
    },
    has: (clip, asset) => !!(entries.get(keyOf(clip, asset)) || []).some(item => covers(item, clip)),
    busy: () => pending.length,
    request(clip, asset) {
      if (find(clip, asset)) return Promise.resolve();
      const key = keyOf(clip, asset), queued = pending.find(job => job.key === key && covers(job, clip));
      if (queued) return queued.promise;
      let from = clip.in - STRETCH_PAD, to = clip.out + STRETCH_PAD;
      // Merge with overlapping renders so one entry keeps covering an edited clip.
      for (const range of [...(entries.get(key) || []), ...pending.filter(job => job.key === key)]) {
        if (range.from <= to && range.to >= from) { from = Math.min(from, range.from); to = Math.max(to, range.to); }
      }
      const job = { key, from, to };
      const snapshot = { ...clip }, source = { ...asset };
      job.promise = queue.then(() => render(key, snapshot, source, from, to)).finally(() => {
        pending.splice(pending.indexOf(job), 1); onChange();
      });
      queue = job.promise.catch(() => {});
      pending.push(job); onChange();
      return job.promise;
    },
    // Renders of replaced audio can never be used again.
    forget(assetId) {
      for (const [key, list] of [...entries]) if (key.startsWith(`${assetId}#`)) for (const entry of list) drop(key, entry);
    },
    clear() { entries.clear(); bytes = 0; },
    dispose() { worker?.terminate(); worker = null; replies.clear(); entries.clear(); bytes = 0; },
  };
}

// Realtime playback: clips are scheduled on the AudioContext clock a short window
// ahead, so edits are heard on the next block instead of after a full mix render.
// Stretched clips not rendered yet join in place as soon as their render lands.
// `transport` is { loop: {start, end} | null, rate }; rate scales the timeline.
// Edits replace only the clips that changed: untouched clips keep sounding.
export function createPlaylistEngine({ context, output, cache, assets, onEnded, onError }) {
  const master = context.createGain(), tracks = new Map(), live = new Set();
  master.connect(output);
  let session = null, signature = '', timer = 0;
  const versionOf = clip => assets().get(clip.asset)?.version || 0;
  // A clip's identity for scheduling: its fields plus the version of its audio.
  const clipSignature = clip => JSON.stringify([clip, versionOf(clip)]);
  function signatureOf(state, transport) {
    const versions = [...new Set(state.clips.map(clip => clip.asset))].map(id => assets().get(id)?.version || 0);
    return JSON.stringify([state.clips, transport.loop, transport.rate, versions]);
  }
  // Each track is a mixer insert: its EQ (track.eq), then its fader. Clips and the track's
  // instruments enter at the EQ input.
  function trackBus(id) {
    let bus = tracks.get(id);
    if (!bus) {
      const gain = context.createGain(), eq = globalThis.SCParametricEQ?.createGraph(context, { analyse: true }) || null;
      gain.connect(master);
      if (eq) { eq.apply(null, false, true); eq.output.connect(gain); }
      bus = { gain, eq, input: eq ? eq.input : gain, settings: 'null' };
      tracks.set(id, bus);
    }
    return bus;
  }
  const trackGain = id => trackBus(id).input;
  function mixTracks(state) {
    for (const track of state.tracks) {
      const bus = trackBus(track.id), settings = JSON.stringify(track.eq || null);
      bus.gain.gain.setTargetAtTime(trackAudible(state, track) ? track.gain : 0, context.currentTime, .005);
      if (bus.eq && settings !== bus.settings) { bus.eq.apply(track.eq || null); bus.settings = settings; }
    }
    const ids = new Set(state.tracks.map(track => track.id));
    for (const [id, bus] of tracks) if (!ids.has(id)) { bus.eq?.dispose(); bus.gain.disconnect(); tracks.delete(id); }
  }
  function retire(clipId = null) {
    const at = context.currentTime;
    for (const node of [...live]) {
      if (clipId !== null && node.clipId !== clipId) continue;
      node.gain.gain.cancelAndHoldAtTime(at); node.gain.gain.linearRampToValueAtTime(0, at + RESTART_FADE);
      node.source.stop(at + RESTART_FADE); live.delete(node);
    }
  }
  function schedule(owner, clip, when, offset, limit) {
    const asset = assets().get(clip.asset);
    if (!asset) return;
    const stretch = needsStretch(clip);
    const start = () => {
      if (session !== owner) return;
      const stretched = stretch ? cache.lookup(clip, asset) : null;
      if (stretch && !stretched) return;
      const node = startClip(context, trackGain(clip.track), clip, asset, stretched, when, offset, { rate: owner.rate, limit });
      if (node) { node.clipId = clip.id; live.add(node); node.source.addEventListener('ended', () => live.delete(node)); }
    };
    if (!stretch || cache.has(clip, asset)) start();
    else cache.request(clip, asset).then(start, onError);
  }
  // Every pass of `clips` between timeline elapsed `a` and `b`; the first window also
  // picks up clips already sounding at `a`.
  function scheduleRange(owner, clips, a, b) {
    transportWindows(a, b, owner.from, owner.length, owner.loop).forEach((window, index) => {
      for (const item of clipsInWindow(clips, window.from, window.to, window.entry || index === 0)) {
        schedule(owner, item.clip, owner.ctxStart + (window.zero + item.at) / owner.rate, item.offset, window.end - item.at);
      }
    });
  }
  function tick() {
    const owner = session;
    if (!owner) return;
    const elapsed = (context.currentTime - owner.ctxStart) * owner.rate;
    if (!owner.loop && owner.from + elapsed >= owner.length) { stop(); onEnded?.(); return; }
    const target = elapsed + LOOKAHEAD * owner.rate;
    if (target <= owner.horizon) return;
    for (const window of transportWindows(owner.horizon, target, owner.from, owner.length, owner.loop)) {
      for (const item of clipsInWindow(owner.state.clips, window.from, window.to, window.entry)) {
        schedule(owner, item.clip, owner.ctxStart + (window.zero + item.at) / owner.rate, item.offset, window.end - item.at);
      }
    }
    owner.horizon = target;
  }
  const loopOf = transport => transport.loop && transport.loop.end > transport.loop.start ? { ...transport.loop } : null;
  function begin(state, from, transport, editing = false) {
    retire();
    clearInterval(timer);
    const snapshot = structuredClone(state), length = arrangementEnd(snapshot);
    const loop = loopOf(transport);
    if (!(length > 0) || (loop && loop.start >= length)) { session = null; return false; }
    if (loop ? from < loop.start || from >= loop.end : from >= length) from = loop ? loop.start : 0;
    mixTracks(snapshot);
    session = { state: snapshot, from, loop, length, rate: transport.rate || 1, ctxStart: context.currentTime + (editing ? .005 : .03), horizon: 0 };
    signature = signatureOf(snapshot, transport);
    timer = setInterval(tick, TICK_MS); tick();
    return true;
  }
  function now() {
    const owner = session;
    if (!owner) return null;
    const elapsed = Math.max(0, context.currentTime - owner.ctxStart) * owner.rate;
    if (!owner.loop) return Math.min(owner.from + elapsed, owner.length);
    const first = owner.loop.end - owner.from, span = owner.loop.end - owner.loop.start;
    return elapsed < first ? owner.from + elapsed : owner.loop.start + (elapsed - first) % span;
  }
  function stop() {
    const at = now();
    retire(); session = null; clearInterval(timer);
    return at;
  }
  const sameLoop = (a, b) => (!a && !b) || (!!a && !!b && Math.abs(a.start - b.start) < 1e-9 && Math.abs(a.end - b.end) < 1e-9);
  // Applies an edit without a restart: changed, added and removed clips are replaced
  // over the span already scheduled. Returns false when a restart is needed instead.
  function patch(state, transport) {
    const owner = session, loop = loopOf(transport), length = arrangementEnd(state);
    if ((transport.rate || 1) !== owner.rate || !(length > 0) || (loop && loop.start >= length)) return false;
    if (!sameLoop(loop, owner.loop) || length !== owner.length) {
      const position = now(), elapsed = Math.max(0, context.currentTime - owner.ctxStart) * owner.rate;
      // A new loop or end only matters at the wrap: restart when one is close.
      const reach = position + (owner.horizon - elapsed) + .05;
      const wrap = item => item ? item.end : Infinity;
      if (owner.loop && reach >= wrap(owner.loop)) return false;
      if (loop && (reach >= loop.end || position < loop.start || position >= loop.end)) return false;
      if (!loop && position >= length) return false;
      // Rebase the clock on the current position; the scheduled span stays valid.
      owner.from = position; owner.ctxStart += elapsed / owner.rate; owner.horizon = Math.max(0, owner.horizon - elapsed);
      owner.loop = loop; owner.length = length;
    }
    const before = new Map(owner.state.clips.map(clip => [clip.id, clipSignature(clip)]));
    const snapshot = structuredClone(state);
    const changed = snapshot.clips.filter(clip => before.get(clip.id) !== clipSignature(clip));
    const kept = new Set(snapshot.clips.map(clip => clip.id));
    owner.state = snapshot;
    mixTracks(snapshot);
    for (const id of before.keys()) if (!kept.has(id)) retire(id);
    for (const clip of changed) {
      const asset = assets().get(clip.asset), wanted = clipSignature(clip);
      const replace = () => {
        if (session !== owner || !owner.state.clips.some(item => item.id === clip.id && clipSignature(item) === wanted)) return;
        retire(clip.id);
        scheduleRange(owner, [clip], Math.max(0, (context.currentTime + .005 - owner.ctxStart) * owner.rate), owner.horizon);
      };
      // A stretched clip keeps its previous version audible until the new render lands.
      if (asset && before.has(clip.id) && needsStretch(clip) && !cache.has(clip, asset)) cache.request(clip, asset).then(replace, onError);
      else replace();
    }
    return true;
  }
  return {
    play: begin,
    // Track mix changes ramp the track gains; clip edits replace only the edited clips.
    // Speed changes, and loop or end changes right at a wrap, restart from the position.
    update(state, transport) {
      if (!session) { mixTracks(state); return; }
      const next = signatureOf(state, transport);
      if (next === signature) { mixTracks(state); return; }
      if (!patch(state, transport)) { begin(state, now(), transport, true); return; }
      signature = next;
    },
    stop, now,
    playing: () => !!session,
    // Mixer state (faders, mute/solo, track EQ) applies while stopped too.
    mix: mixTracks,
    // Where a track's instruments play into, and the EQ graph whose spectrum the editor shows.
    trackInput: id => trackBus(id).input,
    trackGraph: id => tracks.get(id)?.eq || null,
    dispose() { stop(); master.disconnect(); for (const bus of tracks.values()) { bus.eq?.dispose(); bus.gain.disconnect(); } tracks.clear(); },
  };
}

// Prefetch stretched renders for audible clips, earliest first, so play starts warm.
export function prefetchStretches(state, assets, cache, onError) {
  for (const clip of audibleClips(state).filter(needsStretch).sort((a, b) => a.at - b.at)) {
    const asset = assets.get(clip.asset);
    if (asset && !cache.has(clip, asset)) cache.request(clip, asset).catch(onError);
  }
}

// The export follows the realtime insert order: track EQ, fader, master FX, master EQ.
export async function renderArrangement(state, assets, cache, { signal, progress, masterEq = null, masterFx = null } = {}) {
  validateArrangement(state, assets); signal?.throwIfAborted();
  const end = arrangementEnd(state);
  if (!end) throw new Error('Add a sample to the playlist first.');
  const sampleRate = 44100, offline = new OfflineAudioContext(2, Math.ceil(end * sampleRate), sampleRate);
  const equalizer = globalThis.SCParametricEQ;
  const insert = (settings, destination) => {
    if (!equalizer?.isActive(settings)) return destination;
    const graph = equalizer.createGraph(offline); graph.apply(settings, false, true); graph.output.connect(destination);
    return graph.input;
  };
  const effects = globalThis.SCTempoEffects;
  const withFx = masterFx?.bypassed !== true && effects?.EFFECT_NAMES.some(name => Number(masterFx?.[name]) > 0);
  const master = withFx ? offline.destination : insert(masterEq, offline.destination);
  const gains = new Map(state.tracks.map(track => {
    const gain = offline.createGain(); gain.gain.value = track.gain; gain.connect(master);
    return [track.id, insert(track.eq, gain)];
  }));
  const clips = audibleClips(state);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], asset = assets.get(clip.asset);
    progress?.(i / (clips.length + 1));
    let stretched = null;
    if (needsStretch(clip)) { await cache.request(clip, asset); signal?.throwIfAborted(); stretched = cache.lookup(clip, asset); }
    startClip(offline, gains.get(clip.track), clip, asset, stretched, clip.at);
  }
  let mix = await offline.startRendering();
  signal?.throwIfAborted();
  // Reuse Player Tools' offline DSP, including effect tails. The playlist allows
  // five minutes, longer than a pad; bound its stereo render to 128 MiB.
  if (withFx) mix = await effects.renderSample(mix, { ...masterFx, eq: masterEq }, signal, { maxBytes: 128 * 1024 * 1024 });
  // One common gain preserves stereo balance and prevents clipping in exports.
  let peak = 1;
  for (let c = 0; c < 2; c++) for (const value of mix.getChannelData(c)) peak = Math.max(peak, Math.abs(value));
  if (peak > 1) for (let c = 0; c < 2; c++) { const data = mix.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] /= peak; }
  progress?.(1);
  return mix;
}
