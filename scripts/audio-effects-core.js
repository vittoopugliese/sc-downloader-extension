/*
 * Small Web Audio effects graph for the SoundCloud Player Tools.
 * This module uses browser-native nodes and does not process exported audio.
 */
(() => {
  "use strict";

  if (globalThis.SCTempoEffects) return;
  // Observe sources from document_start: a media element can only have one.
  // When the page owns that source, add wet returns without altering its dry path.
  const mediaSources = new WeakMap();
  const contextPrototype = (globalThis.AudioContext || globalThis.webkitAudioContext)?.prototype;
  if (contextPrototype?.createMediaElementSource) {
    const nativeCreateSource = contextPrototype.createMediaElementSource;
    contextPrototype.createMediaElementSource = function (target) {
      const source = nativeCreateSource.call(this, target);
      mediaSources.set(target, source);
      return source;
    };
  }
  if (typeof globalThis.MediaElementAudioSourceNode === "function") {
    globalThis.MediaElementAudioSourceNode = new Proxy(globalThis.MediaElementAudioSourceNode, {
      construct(target, args, newTarget) {
        const source = Reflect.construct(target, args, newTarget);
        mediaSources.set(source.mediaElement, source);
        return source;
      },
    });
  }

  const DEFAULTS = Object.freeze({ reverb: 0, delay: 0 });
  const MAX_SEND = Object.freeze({ reverb: 0.25, delay: 0.3 });
  const REVERB_SECONDS = 0.8;
  const DELAY_SECONDS = 0.25;
  const FEEDBACK = 0.25;
  const RAMP_SECONDS = 0.02;
  const TRACK_RESET_MS = 900;
  const REVERB_IMPULSE_ENERGY = 0.15;
  const EFFECT_NODES = Object.freeze({ reverb: "reverb", delay: "delay" });

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.max(0, Math.min(100, number)));
  }

  function createImpulse(context) {
    const length = Math.max(1, Math.floor(context.sampleRate * REVERB_SECONDS));
    const buffer = context.createBuffer(2, length, context.sampleRate);
    let seed = 0x51c0ffee;
    let energy = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        const decay = Math.pow(1 - index / length, 3.2);
        samples[index] = noise * decay * (channel === 0 ? 1 : 0.87);
        energy += samples[index] * samples[index];
      }
    }
    const scale = Math.sqrt(REVERB_IMPULSE_ENERGY / Math.max(energy, Number.EPSILON));
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) samples[index] *= scale;
    }
    return buffer;
  }

  function create(options = {}) {
    const AudioContextConstructor = options.AudioContext ||
      globalThis.AudioContext || globalThis.webkitAudioContext;
    const getActiveAudio = options.getActiveAudio || (() => null);
    const onAvailabilityChange = options.onAvailabilityChange || (() => {});
    let audio = null;
    let context = null;
    let ownsContext = false;
    let graph = null;
    const graphs = new WeakMap();
    let bypassed = false;
    let available = true;
    let reason = "";
    let resetTimer = null;
    const values = { ...DEFAULTS };

    function snapshot() {
      return Object.freeze({ ...values, bypassed, available, reason, initialized: Boolean(graph) });
    }

    function setParam(param, value) {
      const now = context.currentTime;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, RAMP_SECONDS / 3);
    }

    function updateReturns() {
      if (!graph || !context) return;
      const active = !bypassed && available;
      setParam(graph.reverbReturn.gain, active ? values.reverb / 100 * MAX_SEND.reverb : 0);
      setParam(graph.delayReturn.gain, active ? values.delay / 100 * MAX_SEND.delay : 0);
      if (!graph.ownsSource) return;
      const useLimiter = active && (values.reverb > 0 || values.delay > 0);
      if (useLimiter && !graph.processedOutput) {
        graph.source.disconnect(context.destination);
        graph.source.connect(graph.master);
        graph.processedOutput = true;
      } else if (!useLimiter && graph.processedOutput) {
        graph.source.disconnect(graph.master);
        graph.source.connect(context.destination);
        graph.processedOutput = false;
      }
    }

    function flushEffectTail(name) {
      if (!graph || !context) return;
      const targetGraph = graph;
      const effectNode = targetGraph[EFFECT_NODES[name]];
      if (!targetGraph.connected[name]) {
        setParam(targetGraph[`${name}Return`].gain, 0);
        return;
      }
      if (targetGraph.resetTimers[name] !== undefined) {
        clearTimeout(targetGraph.resetTimers[name]);
      }
      setParam(targetGraph[`${name}Return`].gain, 0);
      targetGraph.source.disconnect(effectNode);
      targetGraph.connected[name] = false;
      targetGraph.resetTimers[name] = setTimeout(() => {
        delete targetGraph.resetTimers[name];
        if (values[name] > 0) {
          targetGraph.source.connect(effectNode);
          targetGraph.connected[name] = true;
        }
        if (graph === targetGraph) updateReturns();
      }, TRACK_RESET_MS);
    }

    function ensureEffectConnected(name) {
      if (!graph || !context || values[name] === 0 || graph.connected[name]) return;
      if (graph.resetTimers[name] !== undefined) return;
      graph.source.connect(graph[EFFECT_NODES[name]]);
      graph.connected[name] = true;
    }

    function connectAudio(target) {
      const cached = graphs.get(target);
      if (cached) {
        audio = target;
        graph = cached;
        context = cached.context;
        ensureEffectConnected("reverb");
        ensureEffectConnected("delay");
        updateReturns();
        return true;
      }
      try {
        const existingSource = mediaSources.get(target);
        if (existingSource) context = existingSource.context;
        const source = existingSource || context.createMediaElementSource(target);
        const ownsSource = !existingSource;
        const reverb = context.createConvolver();
        reverb.buffer = createImpulse(context);
        const reverbReturn = context.createGain();
        const delay = context.createDelay(1);
        delay.delayTime.value = DELAY_SECONDS;
        const feedback = context.createGain();
        feedback.gain.value = FEEDBACK;
        const delayReturn = context.createGain();
        const master = context.createGain();
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        reverbReturn.gain.value = 0;
        delayReturn.gain.value = 0;

        if (ownsSource) source.connect(context.destination);
        reverb.connect(reverbReturn);
        reverbReturn.connect(master);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(delayReturn);
        delayReturn.connect(master);
        master.connect(limiter);
        limiter.connect(context.destination);

        const targetGraph = {
          source, reverb, reverbReturn, delay, feedback, delayReturn, master, limiter,
          context, ownsSource,
          resetTimers: {},
          connected: { reverb: false, delay: false },
          processedOutput: false,
        };
        graphs.set(target, targetGraph);
        target.addEventListener("loadstart", resetTail);
        target.addEventListener("emptied", resetTail);
        target.addEventListener("loadedmetadata", restoreAfterTrackChange);
        audio = target;
        graph = targetGraph;
        ensureEffectConnected("reverb");
        ensureEffectConnected("delay");
        updateReturns();
        return true;
      } catch (error) {
        available = false;
        reason = error?.message || "Could not connect this audio player.";
        onAvailabilityChange(false, error);
        return false;
      }
    }

    function initialize() {
      if (!available || typeof AudioContextConstructor !== "function") {
        available = false;
        reason = "Web Audio is unavailable in this browser.";
        onAvailabilityChange(false);
        return false;
      }
      const target = getActiveAudio();
      if (!target || typeof target.play !== "function") return false;
      const mediaUrl = target.currentSrc || target.src;
      if (!mediaUrl || target.readyState < 1) return false;
      let mediaOrigin = "";
      try { mediaOrigin = new URL(mediaUrl, globalThis.location?.href).origin; } catch {}
      if (
        globalThis.location?.origin && mediaOrigin &&
        mediaOrigin !== globalThis.location.origin &&
        !["anonymous", "use-credentials"].includes(target.crossOrigin)
      ) {
        available = false;
        reason = "The SoundCloud stream does not allow live audio effects.";
        onAvailabilityChange(false, new Error(reason));
        return false;
      }
      try {
        const existingSource = mediaSources.get(target);
        ownsContext = !existingSource;
        context = existingSource?.context || new AudioContextConstructor();
        if (!connectAudio(target)) throw new Error(reason);
        if (context.state === "suspended") context.resume().catch(() => {});
        onAvailabilityChange(true);
        return true;
      } catch (error) {
        available = false;
        reason = error?.message || "Could not initialize live audio effects.";
        if (ownsContext) { try { context?.close()?.catch(() => {}); } catch {} }
        context = null;
        graph = null;
        audio = null;
        onAvailabilityChange(false, error);
        return false;
      }
    }

    function resetTail() {
      if (!graph || !context) return;
      if (resetTimer !== null) clearTimeout(resetTimer);
      setParam(graph.reverbReturn.gain, 0);
      setParam(graph.delayReturn.gain, 0);
      resetTimer = setTimeout(() => {
        resetTimer = null;
        updateReturns();
      }, TRACK_RESET_MS);
    }

    function restoreAfterTrackChange() {
      if (resetTimer === null) updateReturns();
    }

    function set(name, value) {
      if (!(name in DEFAULTS)) throw new RangeError(`Unknown audio effect: ${name}`);
      values[name] = clampPercent(value);
      if (values[name] === 0) flushEffectTail(name);
      if (values[name] > 0) {
        const target = getActiveAudio();
        if (graph && context && target && target !== audio) connectAudio(target);
        else if (!graph && !initialize()) return snapshot();
        ensureEffectConnected(name);
      }
      updateReturns();
      return snapshot();
    }

    function setBypassed(value) {
      bypassed = Boolean(value);
      updateReturns();
      return snapshot();
    }

    function discover(candidate) {
      if (!candidate || typeof candidate.play !== "function") return;
      // Cache one graph per player element because SoundCloud can replace its
      // media element while navigating inside the single-page app.
      if (!graph) audio = candidate;
      else if (
        candidate !== audio && context &&
        (values.reverb > 0 || values.delay > 0)
      ) connectAudio(candidate);
    }

    function applyToActive() {
      const candidate = getActiveAudio();
      if (candidate && candidate !== audio) {
        if (graph && context && (values.reverb > 0 || values.delay > 0)) connectAudio(candidate);
        else audio = candidate;
      }
      if (!graph && available && (values.reverb > 0 || values.delay > 0)) initialize();
      return snapshot();
    }

    return Object.freeze({ applyToActive, discover, set, setBypassed, snapshot });
  }

  globalThis.SCTempoEffects = Object.freeze({ create, clampPercent, DEFAULTS });
})();
