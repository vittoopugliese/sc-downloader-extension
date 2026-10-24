/* Frequency-colored waveform built while the track plays, for players whose
 * audio file cannot be fetched (YouTube). It taps the post-EQ output of the
 * playback graph and fills the bins of the media time it hears, with the same
 * peaks/bands format and crossovers as scripts/spectral-waveform.js. */
(() => {
  "use strict";
  const TICK_MS = 40;
  const MAX_BINS = 16000;
  const MIN_BIN_MS = 20;
  const MAX_TRACKS = 4;

  function create({ effects, getMedia, getIdentity, isSuspended = () => false, onChange = () => {} }) {
    const tracks = new Map();
    const block = new Float32Array(2048);
    let analyser = null;
    let analyserContext = null;
    let unsubscribe = null;
    let timer = null;
    let low = 0;
    let belowHigh = 0;
    let lastTimeMs = null;

    function attach(context, output) {
      if (context.state === "closed" || context === analyserContext) return;
      let playback = null;
      try { playback = effects.getPlaybackContext(); } catch { return; }
      if (context !== playback) return;
      try { analyser?.disconnect(); } catch {}
      analyser = context.createAnalyser();
      analyser.fftSize = block.length;
      analyser.smoothingTimeConstant = 0;
      output.connect(analyser);
      analyserContext = context;
    }

    function trackFor(identity, durationMs) {
      // Keyed by duration too: returning from an ad keeps what was already drawn.
      const key = `${identity}|${Math.round(durationMs / 1000)}`;
      let track = tracks.get(key);
      if (!track) {
        const binMs = Math.max(MIN_BIN_MS, durationMs / MAX_BINS);
        const count = Math.max(1, Math.ceil(durationMs / binMs));
        track = { key, identity, durationMs, binMs, peaks: new Float32Array(count), bands: new Float32Array(count * 3), revision: 0 };
        tracks.set(key, track);
        while (tracks.size > MAX_TRACKS) tracks.delete(tracks.keys().next().value);
      }
      tracks.delete(key);
      tracks.set(key, track);
      return track;
    }

    function current() {
      const media = getMedia();
      const identity = getIdentity();
      const durationMs = Number(media?.duration) * 1000;
      if (!media || !identity || !Number.isFinite(durationMs) || durationMs <= 0 || isSuspended()) return null;
      return { media, track: trackFor(identity, durationMs) };
    }

    function tick() {
      const active = current();
      if (!active || !analyser || analyserContext?.state !== "running") { lastTimeMs = null; return; }
      const { media, track } = active;
      if (media.paused || media.seeking || media.readyState < 3) { lastTimeMs = null; return; }
      const endMs = media.currentTime * 1000;
      const rate = media.playbackRate > 0 ? media.playbackRate : 1;
      // A seek or a loop wrap starts a new run; never smear audio across the jump.
      const fullSpanMs = block.length / analyserContext.sampleRate * 1000 * rate;
      const startMs = lastTimeMs !== null && endMs > lastTimeMs && endMs - lastTimeMs < fullSpanMs
        ? lastTimeMs : Math.max(0, endMs - Math.min(fullSpanMs, TICK_MS * rate));
      lastTimeMs = endMs;
      if (endMs <= startMs) return;
      analyser.getFloatTimeDomainData(block);
      const frames = Math.min(block.length, Math.round((endMs - startMs) / rate / 1000 * analyserContext.sampleRate));
      const first = block.length - frames;
      const lowAlpha = 1 - Math.exp(-2 * Math.PI * 250 / analyserContext.sampleRate);
      const highAlpha = 1 - Math.exp(-2 * Math.PI * 4000 / analyserContext.sampleRate);
      let changed = false;
      for (let index = first; index < block.length; index += 1) {
        const value = block[index];
        low += lowAlpha * (value - low);
        belowHigh += highAlpha * (value - belowHigh);
        const timeMs = startMs + (index - first) / frames * (endMs - startMs);
        const bin = Math.min(track.peaks.length - 1, Math.floor(timeMs / track.binMs));
        const peak = Math.abs(value);
        if (peak > track.peaks[bin]) track.peaks[bin] = peak;
        track.bands[bin * 3] += low * low;
        track.bands[bin * 3 + 1] += (belowHigh - low) ** 2;
        track.bands[bin * 3 + 2] += (value - belowHigh) ** 2;
        changed = true;
      }
      if (changed) {
        track.revision += 1;
        onChange();
      }
    }

    function start() {
      if (timer !== null) return;
      if (!unsubscribe) {
        try { unsubscribe = effects.observeOutput(attach); } catch { unsubscribe = null; }
      }
      timer = setInterval(tick, TICK_MS);
    }

    function stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      lastTimeMs = null;
    }

    // Live views of the typed arrays: drawWaveform only indexes them.
    function snapshot() {
      const active = current();
      if (!active) return null;
      const { track } = active;
      return { identity: track.identity, revision: track.revision, durationMs: track.durationMs,
        peaks: track.peaks, bands: track.bands };
    }

    function revision() {
      return current()?.track.revision ?? -1;
    }

    function dispose() {
      stop();
      unsubscribe?.();
      unsubscribe = null;
      try { analyser?.disconnect(); } catch {}
      analyser = null;
      analyserContext = null;
      tracks.clear();
    }

    return Object.freeze({ start, stop, snapshot, revision, dispose });
  }

  globalThis.SCLiveWaveform = Object.freeze({ create });
})();
