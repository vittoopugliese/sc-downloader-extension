/* Likes Explorer recorder tap inside the SoundCloud widget iframe (MAIN world).
 * The widget plays an MSE blob through its own AudioContext, so the page can
 * tap that graph. Only the Explorer's iframes load this file (scdl_likes_player=1).
 * PCM blocks stream to the Explorer as they arrive, so the parent owns the take. */
(() => {
  "use strict";
  if (globalThis.__scdlWidgetRecordTap) return;
  globalThis.__scdlWidgetRecordTap = true;
  const PARENT = "https://soundcloud.com";
  const PROTOCOL = "widget-record";
  const MODULE = /^chrome-extension:\/\/[a-p]{32}\/scripts\/record-processor\.js$/;
  const nativeCreate = AudioContext.prototype.createMediaElementSource;
  const nativePlay = HTMLMediaElement.prototype.play;
  const elements = new Set(), connected = new WeakSet(), loadedContexts = new WeakSet();
  let tap = null, take = null, analyser = null, scopeTimer = null, ownContext = null, monitorWanted = false;

  AudioContext.prototype.createMediaElementSource = function (element) {
    const node = nativeCreate.call(this, element);
    connected.add(element);
    stopScope();
    tap = { context: this, node };
    send({ type: "status", ready: true });
    if (monitorWanted) startScope();
    return node;
  };
  HTMLMediaElement.prototype.play = function () {
    elements.add(this);
    return nativePlay.apply(this, arguments);
  };

  function send(message, transfer = []) {
    try { window.parent.postMessage({ scdl: PROTOCOL, ...message }, PARENT, transfer); } catch {}
  }
  // Plan B if a future widget stops using Web Audio: route the playing element
  // through our own context so it keeps sounding while we tap it.
  function ensureTap() {
    if (tap && tap.context.state !== "closed") return tap;
    const element = [...elements].find(item => !item.paused && !connected.has(item));
    if (!element) return null;
    ownContext ||= new AudioContext();
    const node = nativeCreate.call(ownContext, element);
    connected.add(element); node.connect(ownContext.destination);
    tap = { context: ownContext, node };
    return tap;
  }
  function stopScope() {
    clearInterval(scopeTimer); scopeTimer = null;
    try { analyser?.disconnect(); } catch {}
    analyser = null;
  }
  function startScope() {
    const current = ensureTap();
    if (!current || scopeTimer) return;
    analyser = current.context.createAnalyser(); analyser.fftSize = 2048;
    current.node.connect(analyser);
    const full = new Float32Array(2048);
    scopeTimer = setInterval(() => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(full);
      const samples = new Float32Array(256);
      for (let i = 0; i < 256; i++) samples[i] = full[i * 8];
      send({ type: "scope", samples }, [samples.buffer]);
    }, 50);
  }
  async function start({ id, moduleUrl, maxSeconds }) {
    if (take) { send({ type: "error", id, code: "busy" }); return; }
    const current = ensureTap();
    if (!current) { send({ type: "error", id, code: "no-source" }); return; }
    if (typeof moduleUrl !== "string" || !MODULE.test(moduleUrl)) { send({ type: "error", id, code: "module" }); return; }
    const seconds = Math.max(1, Math.min(300, Number(maxSeconds) || 120));
    take = { id, node: null };
    try {
      if (!loadedContexts.has(current.context)) {
        await current.context.audioWorklet.addModule(moduleUrl);
        loadedContexts.add(current.context);
      }
      await current.context.resume().catch(() => {});
      if (take?.id !== id) return;
      const node = new AudioWorkletNode(current.context, "scdl-record", { channelCount: 2, channelCountMode: "explicit",
        outputChannelCount: [2], processorOptions: { maxSeconds: seconds } });
      take.node = node;
      node.port.onmessage = ({ data }) => {
        if (data.channels) {
          send({ type: "chunk", id, sampleRate: current.context.sampleRate, channels: data.channels }, data.channels.map(channel => channel.buffer));
        }
        if (data.stopped) {
          send({ type: "stopped", id, limitReached: data.limitReached === true });
          try { current.node.disconnect(node); } catch {}
          node.disconnect(); node.port.close();
          if (take?.id === id) take = null;
        }
      };
      // The processor writes silence; connecting it to the destination keeps it pulled.
      current.node.connect(node); node.connect(current.context.destination);
      node.port.postMessage("start");
      send({ type: "started", id, sampleRate: current.context.sampleRate });
    } catch (error) {
      if (take?.id === id) take = null;
      send({ type: "error", id, code: "capture", message: String(error?.message || error).slice(0, 200) });
    }
  }
  function stop({ id }) {
    if (!take || take.id !== id) { send({ type: "stopped", id, limitReached: false }); return; }
    if (take.node) take.node.port.postMessage("stop");
    else { take = null; send({ type: "stopped", id, limitReached: false }); }
  }
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== PARENT) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.scdl !== PROTOCOL || typeof data.type !== "string") return;
    if (data.type === "hello") send({ type: "status", ready: !!ensureTap() });
    else if (data.type === "monitor") { monitorWanted = data.on === true; if (monitorWanted) startScope(); else stopScope(); }
    else if (data.type === "start" && typeof data.id === "string") start(data);
    else if (data.type === "stop" && typeof data.id === "string") stop(data);
  });
})();
