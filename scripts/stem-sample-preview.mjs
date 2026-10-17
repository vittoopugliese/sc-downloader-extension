// Browser preview: one voice with its own gain on its own AudioContext, so it never
// reaches the project transport, the WAV export or the recorder. Decoded files stay in a
// small LRU cache; the Playlist can take a cached buffer instead of decoding it again.
const SAMPLE_RATE = 44100, MAX_FILE = 64 * 1024 * 1024, PEAKS = 600;
export const PREVIEW_BUDGET = 32 * 1024 * 1024;
const bytesOf = buffer => buffer.length * buffer.numberOfChannels * 4;

// Peak per bin across channels: the waveform is drawn from these, never from samples.
export function peaksOf(buffer, bins = PEAKS) {
  const peaks = new Float32Array(bins), step = buffer.length / bins;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let bin = 0; bin < bins; bin++) {
      const from = Math.floor(bin * step), to = Math.max(from + 1, Math.floor((bin + 1) * step));
      const stride = Math.max(1, Math.floor((to - from) / 256));
      let peak = peaks[bin];
      for (let i = from; i < to && i < data.length; i += stride) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
      peaks[bin] = peak;
    }
  }
  return peaks;
}

export function createSamplePreview({ budget = PREVIEW_BUDGET, onState } = {}) {
  const cache = new Map();
  let context = null, gain = null, voice = null, last = null, volume = .8, used = 0;
  const keyOf = (path, file) => `${path}|${file.size}|${file.lastModified}`;
  function remember(key, sample) {
    if (sample.bytes > budget) return;
    cache.set(key, sample); used += sample.bytes;
    for (const [old, item] of cache) { if (used <= budget) break; if (old !== key) { cache.delete(old); used -= item.bytes; } }
  }
  function forget(key) { const item = cache.get(key); if (item) { cache.delete(key); used -= item.bytes; } return item; }
  function stop() {
    if (!voice) return;
    const current = voice; voice = null;
    current.source.onended = null;
    try { current.source.stop(); } catch { /* already stopped */ }
    current.source.disconnect(); onState?.(null);
  }
  return {
    keyOf,
    // Reads and decodes a file, or returns it from the cache. `file` is the File itself.
    async load(path, file) {
      const key = keyOf(path, file), hit = cache.get(key);
      if (hit) { cache.delete(key); cache.set(key, hit); return last = hit; }
      if (file.size > MAX_FILE) throw new Error('too-large');
      const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer());
      const sample = { key, name: file.name, buffer, peaks: peaksOf(buffer), bytes: bytesOf(buffer) };
      remember(key, sample);
      return last = sample;
    },
    // `wanted` is checked once the context resumes, so a stale selection never starts.
    async play(sample, wanted = () => true) {
      stop();
      if (!context) {
        context = new AudioContext({ latencyHint: 'interactive' });
        gain = context.createGain(); gain.gain.value = volume; gain.connect(context.destination);
      }
      if (context.state !== 'running') await context.resume();
      if (!wanted()) return;
      stop();
      const source = context.createBufferSource();
      source.buffer = sample.buffer; source.connect(gain);
      const current = { source, sample, startedAt: context.currentTime };
      source.onended = () => { if (voice === current) { voice = null; source.disconnect(); onState?.(null); } };
      voice = current; source.start(); onState?.(sample);
    },
    stop,
    playing: () => voice?.sample || null,
    // Seconds into the playing sample, or null.
    position: () => voice ? Math.min(voice.sample.buffer.duration, context.currentTime - voice.startedAt) : null,
    setVolume(value) { volume = value; if (gain) gain.gain.setTargetAtTime(value, context.currentTime, .015); },
    volume: () => volume,
    // Hands a cached buffer to the importer; it leaves the preview budget.
    take(path, file) {
      const key = keyOf(path, file), item = forget(key) || (last?.key === key ? last : null);
      if (item === last) last = null;
      return item?.buffer || null;
    },
    clear() { cache.clear(); used = 0; last = null; },
    // The last loaded file counts even when it is too large to stay cached.
    bytes: () => used + (last && !cache.has(last.key) ? last.bytes : 0),
    dispose() { stop(); cache.clear(); used = 0; last = null; context?.close(); context = gain = null; },
  };
}
