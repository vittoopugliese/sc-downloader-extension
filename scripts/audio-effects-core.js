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

  const DEFAULTS = Object.freeze({
    reverb: 0, delay: 0, reverbRoom: "hall", reverbSize: 55, reverbDecay: 2.4, reverbPreDelay: 20, reverbTone: 70,
    delayTime: 250, delayFeedback: 25, delayTone: 70, preset: "custom",
  });
  const MAX_SEND = Object.freeze({ reverb: 0.7, delay: 0.55 });
  const REVERB_ROOMS = Object.freeze({ room: { seconds: 0.7, decay: 4.5 }, hall: { seconds: 2.4, decay: 2.7 }, plate: { seconds: 1.6, decay: 1.5 } });
  const PRESETS = Object.freeze({
    subtle: { reverb: 18, delay: 0, reverbRoom: "room", reverbSize: 30, reverbDecay: 0.8, reverbPreDelay: 8, reverbTone: 70, delayTime: 180, delayFeedback: 15, delayTone: 70 },
    studio: { reverb: 35, delay: 12, reverbRoom: "plate", reverbSize: 45, reverbDecay: 1.6, reverbPreDelay: 18, reverbTone: 72, delayTime: 220, delayFeedback: 22, delayTone: 68 },
    wide: { reverb: 52, delay: 16, reverbRoom: "hall", reverbSize: 75, reverbDecay: 4.8, reverbPreDelay: 45, reverbTone: 78, delayTime: 310, delayFeedback: 28, delayTone: 72 },
    dub: { reverb: 12, delay: 48, reverbRoom: "room", reverbSize: 40, reverbDecay: 1.2, reverbPreDelay: 12, reverbTone: 55, delayTime: 380, delayFeedback: 60, delayTone: 42 },
  });
  const RAMP_SECONDS = 0.02;
  const TRACK_RESET_MS = 900;
  const REVERB_IMPULSE_ENERGY = 0.15;
  const EFFECT_NODES = Object.freeze({ reverb: "reverbPreDelay", delay: "delay" });

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.max(0, Math.min(100, number)));
  }

  function createImpulse(context, room, size, decaySeconds) {
    const profile = REVERB_ROOMS[room] || REVERB_ROOMS.hall;
    const seconds = Number(decaySeconds);
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(2, length, context.sampleRate);
    let seed = 0x51c0ffee;
    let energy = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        const decay = Math.pow(1 - index / length, profile.decay * (1.3 - Number(size) / 100 * 0.6));
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

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.max(min, Math.min(max, number))) : fallback;
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
    const graphReferences = new Set();
    let bypassed = false;
    let available = true;
    let reason = "";
    let resetTimer = null;
    const values = { ...DEFAULTS };

    function snapshot() {
      return Object.freeze({ ...values, bypassed, available, reason, initialized: Boolean(graph) });
    }

    function updateCharacter(targetGraph = graph) {
      if (!targetGraph || !targetGraph.context) return;
      const contextForGraph = targetGraph.context;
      targetGraph.reverb.buffer = createImpulse(contextForGraph, values.reverbRoom, values.reverbSize, values.reverbDecay);
      setParam(targetGraph.reverbPreDelay.delayTime, values.reverbPreDelay / 1000);
      setParam(targetGraph.reverbTone.frequency, 600 + values.reverbTone / 100 * 15400);
      setParam(targetGraph.delayTone.frequency, 500 + values.delayTone / 100 * 15500);
      setParam(targetGraph.delay.delayTime, values.delayTime / 1000);
      setParam(targetGraph.feedback.gain, values.delayFeedback / 100 * 0.82);
    }

    function setParam(param, value, contextForParam = context) {
      const now = contextForParam.currentTime;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, RAMP_SECONDS / 3);
    }

    function updateReturns(targetGraph = graph) {
      if (!targetGraph?.context) return;
      const contextForGraph = targetGraph.context;
      const active = !bypassed && available;
      setParam(targetGraph.reverbReturn.gain, active ? values.reverb / 100 * MAX_SEND.reverb : 0, contextForGraph);
      setParam(targetGraph.delayReturn.gain, active ? values.delay / 100 * MAX_SEND.delay : 0, contextForGraph);
      if (!targetGraph.ownsSource) return;
      const useLimiter = active && (values.reverb > 0 || values.delay > 0);
      if (useLimiter && !targetGraph.processedOutput) {
        targetGraph.source.disconnect(contextForGraph.destination);
        targetGraph.source.connect(targetGraph.master);
        targetGraph.processedOutput = true;
      } else if (!useLimiter && targetGraph.processedOutput) {
        targetGraph.source.disconnect(targetGraph.master);
        targetGraph.source.connect(contextForGraph.destination);
        targetGraph.processedOutput = false;
      }
    }

    function updateAllReturns() {
      for (const reference of graphReferences) {
        const targetGraph = reference.deref();
        if (targetGraph) updateReturns(targetGraph);
        else graphReferences.delete(reference);
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
        const reverbPreDelay = context.createDelay(0.25);
        const reverb = context.createConvolver();
        const reverbTone = context.createBiquadFilter();
        reverbTone.type = "lowpass";
        const reverbReturn = context.createGain();
        const delay = context.createDelay(1);
        delay.delayTime.value = values.delayTime / 1000;
        const feedback = context.createGain();
        feedback.gain.value = values.delayFeedback / 100 * 0.82;
        const delayTone = context.createBiquadFilter();
        delayTone.type = "lowpass";
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
        reverbPreDelay.connect(reverb);
        reverb.connect(reverbTone);
        reverbTone.connect(reverbReturn);
        reverbReturn.connect(master);
        delay.connect(delayTone);
        delayTone.connect(feedback);
        feedback.connect(delay);
        delay.connect(delayReturn);
        delayReturn.connect(master);
        master.connect(limiter);
        limiter.connect(context.destination);

        const targetGraph = {
          source, reverbPreDelay, reverb, reverbTone, reverbReturn, delay, delayTone, feedback, delayReturn, master, limiter,
          context, ownsSource,
          resetTimers: {},
          connected: { reverb: false, delay: false },
          processedOutput: false,
        };
        graphs.set(target, targetGraph);
        graphReferences.add(new WeakRef(targetGraph));
        target.addEventListener("loadstart", resetTail);
        target.addEventListener("emptied", resetTail);
        target.addEventListener("loadedmetadata", restoreAfterTrackChange);
        audio = target;
        graph = targetGraph;
        updateCharacter(targetGraph);
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
      values.preset = "custom";
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

    function setCharacter(name, value) {
      if (!(name in DEFAULTS) || name === "reverb" || name === "delay") throw new RangeError(`Unknown effect setting: ${name}`);
      if (name === "reverbRoom") values[name] = REVERB_ROOMS[value] ? value : DEFAULTS.reverbRoom;
      else if (name === "reverbDecay") values[name] = Math.round(Math.max(0.2, Math.min(12, Number(value) || DEFAULTS[name])) * 10) / 10;
      else values[name] = clamp(value, name === "delayTime" ? 60 : 0, name === "delayTime" ? 800 : name === "reverbPreDelay" ? 200 : 100, DEFAULTS[name]);
      values.preset = "custom";
      updateCharacter();
      return snapshot();
    }

    function applyPreset(name) {
      const preset = PRESETS[name];
      if (!preset) throw new RangeError(`Unknown effect preset: ${name}`);
      Object.assign(values, preset, { preset: name });
      if (!graph && !initialize()) return snapshot();
      updateCharacter();
      ensureEffectConnected("reverb");
      ensureEffectConnected("delay");
      updateReturns();
      return snapshot();
    }

    function setBypassed(value) {
      bypassed = Boolean(value);
      updateAllReturns();
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

    return Object.freeze({ applyPreset, applyToActive, discover, set, setBypassed, setCharacter, snapshot });
  }

  globalThis.SCTempoEffects = Object.freeze({ create, clampPercent, DEFAULTS, PRESETS, REVERB_ROOMS });
})();
