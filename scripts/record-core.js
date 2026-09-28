/* Post-EQ stereo recorder. A separate context mixes/resamples output taps. */
(() => {
  "use strict";
  const MAX_SECONDS = 300;
  function encodeWav(chunks, frames, sampleRate) {
    const bytes = new ArrayBuffer(44 + frames * 4);
    const view = new DataView(bytes);
    const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
    text(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, frames * 4, true);
    let offset = 44;
    for (const channels of chunks) for (let i = 0; i < channels[0].length; i++) {
      for (let channel = 0; channel < 2; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        offset += 2;
      }
    }
    return new Blob([bytes], { type: "audio/wav" });
  }
  function create({ effects, onChange = () => {}, moduleUrl } = {}) {
    let context, input, analyser, processor, initialization, unsubscribe;
    let state = "idle", chunks = [], frames = 0, peaks = [], buffer = null;
    let preview = null, previewOffset = 0, previewStart = 0, stopPromise, stopped;
    let message = "", disposed = false;
    let playbackRevision = 0;
    const taps = new Map();
    const notify = () => onChange(snapshot());
    const snapshot = () => ({ state, duration: frames / (context?.sampleRate || 48000),
      sampleRate: context?.sampleRate || 48000, frames, message, maxSeconds: MAX_SECONDS });
    function attach(sourceContext, output) {
      for (const [oldContext, tap] of taps) if (oldContext.state === "closed") {
        releaseTap(tap); taps.delete(oldContext);
      }
      if (taps.has(sourceContext) || sourceContext.state === "closed") return;
      const destination = sourceContext.createMediaStreamDestination();
      output.connect(destination);
      const source = context.createMediaStreamSource(destination.stream);
      source.connect(input);
      taps.set(sourceContext, { output, destination, source });
    }
    async function prepare() {
      if (disposed) throw new Error("Recorder has been closed.");
      if (!initialization) initialization = (async () => {
        const url = moduleUrl || document.documentElement.getAttribute("data-scdl-extension-record-worklet-url");
        if (!url) throw new Error("Reload SoundCloud to enable Record.");
        context = new AudioContext({ sampleRate: 48000 });
        input = context.createGain();
        input.channelCount = 2; input.channelCountMode = "explicit";
        analyser = context.createAnalyser(); analyser.fftSize = 2048;
        input.connect(analyser);
        await context.audioWorklet.addModule(url);
        if (disposed) throw new Error("Recorder has been closed.");
        processor = new AudioWorkletNode(context, "scdl-record", { channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2] });
        input.connect(processor); processor.connect(context.destination);
        processor.port.onmessage = ({ data }) => {
          if (data.channels && (state === "recording" || state === "stopping")) {
            const remaining = Math.max(0, Math.floor(MAX_SECONDS * context.sampleRate) - frames);
            const channels = data.channels.map(channel => channel.subarray(0, remaining));
            if (channels[0].length) {
              chunks.push(channels); frames += channels[0].length;
              // Small fixed buckets keep drawing proportional to screen width.
              for (let i = 0; i < channels[0].length; i += 128) {
                let min = 0, max = 0;
                for (let j = i; j < Math.min(i + 128, channels[0].length); j++) {
                  min = Math.min(min, channels[0][j], channels[1][j]);
                  max = Math.max(max, channels[0][j], channels[1][j]);
                }
                peaks.push([min, max]);
              }
            }
          }
          if (data.stopped && (state === "recording" || state === "stopping")) {
            if (data.limitReached) message = "5-minute limit reached. Your sample is ready.";
            state = frames ? "ready" : "idle"; stopped?.(); stopped = null; notify();
          }
        };
        unsubscribe = effects.observeOutput(attach);
      })().catch(async error => {
        unsubscribe?.(); unsubscribe = null;
        detach();
        await context?.close().catch(() => {});
        initialization = null;
        throw error;
      });
      await initialization;
      await context.resume();
    }
    function releaseTap({ output, destination, source }) {
      try { output.disconnect(destination); } catch {}
      source.disconnect(); destination.stream.getTracks().forEach(track => track.stop());
    }
    function detach() {
      for (const tap of taps.values()) releaseTap(tap);
      taps.clear();
    }
    async function start() {
      if (["recording", "stopping", "preparing"].includes(state)) return;
      const previousState = frames ? "ready" : "idle";
      stopPreview(); state = "preparing"; message = ""; notify();
      try {
        await prepare();
        const playback = effects.getPlaybackContext();
        await playback.resume();
        if (!effects.snapshot().available) throw new Error(effects.snapshot().reason || "This player cannot be recorded.");
        chunks = []; frames = 0; peaks = []; buffer = null; previewOffset = 0;
        state = "recording"; processor.port.postMessage("start"); notify();
      } catch (error) { state = previousState; message = error.message; notify(); throw error; }
    }
    function stop() {
      if (state === "stopping") return stopPromise;
      if (state !== "recording") { stopPreview(); return Promise.resolve(); }
      state = "stopping";
      stopPromise = new Promise(resolve => { stopped = resolve; });
      processor.port.postMessage("stop"); notify();
      return stopPromise;
    }
    function position() {
      return state === "playing" ? Math.min(frames / context.sampleRate, previewOffset + context.currentTime - previewStart) : previewOffset;
    }
    function stopPreview() {
      playbackRevision++;
      if (preview) {
        previewOffset = position(); preview.onended = null; preview.stop(); preview.disconnect(); preview = null;
        state = frames ? "ready" : "idle"; notify();
      }
    }
    async function play(offset = previewOffset) {
      if (!frames || ["recording", "stopping", "preparing"].includes(state)) return;
      stopPreview();
      const revision = playbackRevision;
      await context.resume();
      if (disposed || revision !== playbackRevision) return;
      if (!buffer) {
        buffer = context.createBuffer(2, frames, context.sampleRate);
        let at = 0;
        for (const channels of chunks) {
          channels.forEach((channel, index) => buffer.copyToChannel(channel, index, at)); at += channels[0].length;
        }
        // Keep the chunk interface for waveform/export, but share the preview PCM.
        // Retaining the captured arrays as well would double a five-minute take.
        chunks = [];
        const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
        for (let offset = 0; offset < frames; offset += 2048) {
          chunks.push(channels.map(channel => channel.subarray(offset, Math.min(frames, offset + 2048))));
        }
      }
      previewOffset = offset >= buffer.duration ? 0 : Math.max(0, offset);
      previewStart = context.currentTime;
      preview = context.createBufferSource(); preview.buffer = buffer;
      // Preview the already processed sample once; never feed it back into capture/EQ.
      preview.connect(context.destination);
      preview.onended = () => { preview.disconnect(); preview = null; previewOffset = 0; state = "ready"; notify(); };
      preview.start(0, previewOffset); state = "playing"; notify();
    }
    function seek(seconds) {
      if (!frames || ["recording", "stopping", "preparing"].includes(state)) return;
      const playing = state === "playing";
      stopPreview(); previewOffset = Math.max(0, Math.min(frames / context.sampleRate, seconds));
      if (playing) return play(previewOffset);
      notify();
    }
    function clear() {
      if (["recording", "stopping", "preparing"].includes(state)) return;
      stopPreview(); chunks = []; frames = 0; peaks = []; buffer = null; previewOffset = 0; message = ""; state = "idle"; notify();
    }
    function dispose() {
      disposed = true; stopPreview(); unsubscribe?.(); detach();
      processor?.port.close(); context?.close().catch(() => {}); stopped?.();
      chunks = []; peaks = []; buffer = null;
    }
    return Object.freeze({ prepare, start, stop, play, stopPreview, seek, clear, dispose, snapshot, position,
      peaks: () => peaks,
      sampleAt(index, channel) { return chunks[Math.floor(index / 2048)]?.[channel]?.[index % 2048] || 0; },
      readLive(samples) { if (analyser) analyser.getFloatTimeDomainData(samples); else samples.fill(0); },
      exportWav() { if (!frames || ["recording", "stopping"].includes(state)) throw new Error("Stop recording before downloading."); return encodeWav(chunks, frames, context.sampleRate); },
    });
  }
  globalThis.SCRecord = Object.freeze({ create, encodeWav, MAX_SECONDS });
})();
