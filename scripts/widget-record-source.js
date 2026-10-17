/* Capture source for SCRecord that reads the Likes Explorer widget iframe.
 * Pairs with widget-record-tap.js, which runs inside w.soundcloud.com. */
(function (root) {
  "use strict";
  const ORIGIN = "https://w.soundcloud.com";
  const PROTOCOL = "widget-record";
  const pt = (source, ...values) => root.SCPlayerToolsText?.t(source, ...values) ?? source.replace(/\$(\d+)/g, (match, index) => values[index - 1] ?? match);
  const validBlock = channels => Array.isArray(channels) && channels.length === 2 &&
    channels.every(channel => channel instanceof Float32Array && channel.length > 0 && channel.length <= 8192) &&
    channels[0].length === channels[1].length;

  function create({ getFrame, moduleUrl, startTimeout = 5000, stopTimeout = 3000 }) {
    let callbacks = null, active = null, monitored = null, listening = false;
    let scope = null, scopeAt = 0;
    const pending = new Map();
    const post = (target, message) => { try { target?.postMessage({ scdl: PROTOCOL, ...message }, ORIGIN); } catch {} };
    const currentWindow = () => getFrame()?.contentWindow || null;

    function end(limitReached) {
      if (!active) return;
      clearTimeout(active.stopTimer);
      active = null;
      callbacks?.onStopped(limitReached === true);
    }
    function receive(event) {
      if (event.origin !== ORIGIN) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.scdl !== PROTOCOL) return;
      if (data.type === "scope") {
        if (event.source === monitored && data.samples instanceof Float32Array && data.samples.length === 256) { scope = data.samples; scopeAt = performance.now(); }
        return;
      }
      if (typeof data.id !== "string") return;
      const request = pending.get(data.id);
      if (request && event.source === request.window) {
        if (data.type === "started") { pending.delete(data.id); clearTimeout(request.timer); request.resolve(); return; }
        if (data.type === "error") { pending.delete(data.id); clearTimeout(request.timer); request.reject(failure(data.code)); return; }
      }
      if (!active || data.id !== active.id || event.source !== active.window) return;
      if (data.type === "chunk") {
        const rate = Number(data.sampleRate);
        if (!Number.isFinite(rate) || rate < 8000 || rate > 192000 || !validBlock(data.channels)) return;
        callbacks?.onChunk(data.channels, rate);
      } else if (data.type === "stopped") end(data.limitReached);
    }
    function failure(code) {
      if (code === "no-source") return new Error(pt("Press play on the player to record."));
      if (code === "busy") return new Error(pt("The player is already recording."));
      return new Error(pt("Could not record audio."));
    }
    function listen() {
      if (listening) return;
      listening = true; window.addEventListener("message", receive);
    }
    // Follows the widget when the Explorer loads another track.
    function syncMonitor() {
      const target = currentWindow();
      if (target === monitored) return;
      post(monitored, { type: "monitor", on: false });
      monitored = target; scope = null;
      post(monitored, { type: "monitor", on: true });
    }
    return {
      async prepare({ maxSeconds, onChunk, onStopped }) {
        callbacks = { maxSeconds, onChunk, onStopped };
        listen(); syncMonitor();
      },
      start() {
        listen();
        const target = currentWindow();
        if (!target) return Promise.reject(new Error(pt("Press play on the player to record.")));
        if (active) return Promise.reject(failure("busy"));
        const id = crypto.randomUUID();
        active = { id, window: target, stopTimer: null };
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            if (active?.id === id) active = null;
            reject(new Error(pt("The player did not answer. Reload the track and try again.")));
          }, startTimeout);
          pending.set(id, { window: target, timer, resolve,
            reject(error) { if (active?.id === id) active = null; reject(error); } });
          post(target, { type: "start", id, moduleUrl, maxSeconds: callbacks?.maxSeconds || 120 });
        });
      },
      stop() {
        if (!active) return;
        post(active.window, { type: "stop", id: active.id });
        clearTimeout(active.stopTimer);
        // If the iframe was removed, nobody acknowledges the stop.
        active.stopTimer = setTimeout(() => end(false), stopTimeout);
      },
      // Called when the Explorer replaces or removes the iframe: keep what was recorded.
      interrupt() {
        if (active && currentWindow() !== active.window) end(false);
        syncMonitor();
      },
      readLive(samples) {
        if (active && currentWindow() !== active.window) end(false);
        syncMonitor();
        if (!scope || performance.now() - scopeAt > 300) { samples.fill(0); return; }
        const ratio = scope.length / samples.length;
        for (let i = 0; i < samples.length; i++) samples[i] = scope[Math.min(scope.length - 1, Math.floor(i * ratio))];
      },
      dispose() {
        for (const request of pending.values()) clearTimeout(request.timer);
        pending.clear();
        if (active) { post(active.window, { type: "stop", id: active.id }); clearTimeout(active.stopTimer); active = null; }
        post(monitored, { type: "monitor", on: false }); monitored = null;
        if (listening) window.removeEventListener("message", receive);
        listening = false; callbacks = null;
      },
    };
  }
  root.SCWidgetRecordSource = Object.freeze({ create });
})(globalThis);
