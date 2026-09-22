/*
 * Small Web Audio effects graph for the SoundCloud Player Tools.
 * Native live effects and offline pad rendering.
 */
(() => {
  "use strict";

  if (globalThis.SCTempoEffects) return;
  // Observe sources from document_start: a media element can only have one.
  // Observe the site's source early so EQ can preserve its downstream dry path.
  const mediaSources = new WeakMap();
  const sourceRoutes = new WeakMap();
  function rememberSource(target, source) {
    mediaSources.set(target, source);
    if (sourceRoutes.has(source)) return source;
    const connect = source.connect;
    const disconnect = source.disconnect;
    const route = { edges: [], output: null, eq: null, connect, disconnect };
    sourceRoutes.set(source, route);
    // Observe only this source's outgoing edges, before the site connects it.
    // Once EQ is installed, future site connections/disconnections use its output.
    source.connect = function (...args) {
      const result = connect.apply(route.output || source, args);
      if (!route.edges.some((edge) => edge[0] === args[0] && (edge[1] || 0) === (args[1] || 0) && (edge[2] || 0) === (args[2] || 0))) route.edges.push(args);
      return result;
    };
    source.disconnect = function (...args) {
      const result = disconnect.apply(route.output || source, args);
      route.edges = route.edges.filter((edge) => {
        if (!args.length) return false;
        if (typeof args[0] === "number") return (edge[1] || 0) !== args[0];
        return edge[0] !== args[0] || (args.length > 1 && (edge[1] || 0) !== args[1]) ||
          (args.length > 2 && (edge[2] || 0) !== args[2]);
      });
      return result;
    };
    return source;
  }

  function insertEqualizer(source) {
    const route = sourceRoutes.get(source);
    if (!route || !globalThis.SCParametricEQ) throw new Error("Reload SoundCloud to enable the equalizer.");
    if (route.eq) return route.eq;
    const eq = globalThis.SCParametricEQ.createGraph(source.context, { analyse: true });
    const moved = [];
    try {
      // Disconnect only recorded edges; preserve the site's volume/mute graph.
      for (const edge of route.edges) {
        const exactEdge = typeof edge[0]?.numberOfInputs === "number"
          ? [edge[0], edge[1] || 0, edge[2] || 0] : [edge[0], edge[1] || 0];
        route.disconnect.apply(source, exactEdge);
        moved.push(edge);
        route.connect.apply(eq.output, edge);
      }
      route.connect.call(source, eq.input);
      route.output = eq.output;
      route.eq = eq;
      return eq;
    } catch (error) {
      eq.output.disconnect();
      for (const edge of moved) route.connect.apply(source, edge);
      throw error;
    }
  }
  const contextPrototype = (globalThis.AudioContext || globalThis.webkitAudioContext)?.prototype;
  if (contextPrototype?.createMediaElementSource) {
    const nativeCreateSource = contextPrototype.createMediaElementSource;
    contextPrototype.createMediaElementSource = function (target) {
      const source = nativeCreateSource.call(this, target);
      return rememberSource(target, source);
    };
  }
  if (typeof globalThis.MediaElementAudioSourceNode === "function") {
    globalThis.MediaElementAudioSourceNode = new Proxy(globalThis.MediaElementAudioSourceNode, {
      construct(target, args, newTarget) {
        const source = Reflect.construct(target, args, newTarget);
        return rememberSource(source.mediaElement, source);
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

  async function renderSample(buffer, settings, signal) {
    const reverbWet = settings?.bypassed ? 0 : clampPercent(settings?.reverb);
    const delayWet = settings?.bypassed ? 0 : clampPercent(settings?.delay);
    if (!reverbWet && !delayWet) return buffer;
    if (signal?.aborted) throw new DOMException("Render aborted.", "AbortError");
    const sampleRate = buffer.sampleRate;
    const delaySeconds = clamp(settings?.delayTime, 60, 800, DEFAULTS.delayTime) / 1000;
    const feedbackValue = clampPercent(settings?.delayFeedback) / 100 * 0.82;
    const reverbSeconds = Math.max(0.2, Math.min(12, Number(settings?.reverbDecay) || DEFAULTS.reverbDecay));
    const reverbPreDelaySeconds = clamp(settings?.reverbPreDelay, 0, 200, DEFAULTS.reverbPreDelay) / 1000;
    const delayTail = delayWet ? delaySeconds * Math.ceil(Math.log(0.001) / Math.log(Math.max(0.05, feedbackValue))) : 0;
    const tailSeconds = Math.min(12, Math.max(reverbWet ? reverbSeconds + reverbPreDelaySeconds : 0, delayTail));
    const frameCount = buffer.length + Math.ceil(tailSeconds * sampleRate);
    if (frameCount * Math.min(buffer.numberOfChannels, 2) * 4 > 64 * 1024 * 1024) {
      throw new Error("This loop is too large to save as a pad sample.");
    }
    const context = new OfflineAudioContext(Math.min(buffer.numberOfChannels, 2), frameCount, sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    source.connect(master);
    if (reverbWet) {
      const preDelay = context.createDelay(0.25);
      preDelay.delayTime.value = reverbPreDelaySeconds;
      const reverb = context.createConvolver();
      reverb.buffer = createImpulse(context, settings?.reverbRoom, settings?.reverbSize ?? DEFAULTS.reverbSize, reverbSeconds);
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 600 + clampPercent(settings?.reverbTone ?? DEFAULTS.reverbTone) / 100 * 15400;
      const wet = context.createGain();
      wet.gain.value = reverbWet / 100 * MAX_SEND.reverb;
      source.connect(preDelay);
      preDelay.connect(reverb);
      reverb.connect(tone);
      tone.connect(wet);
      wet.connect(master);
    }
    if (delayWet) {
      const delay = context.createDelay(1);
      delay.delayTime.value = delaySeconds;
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 500 + clampPercent(settings?.delayTone ?? DEFAULTS.delayTone) / 100 * 15500;
      const feedback = context.createGain();
      feedback.gain.value = feedbackValue;
      const wet = context.createGain();
      wet.gain.value = delayWet / 100 * MAX_SEND.delay;
      source.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(master);
    }
    master.connect(limiter);
    limiter.connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    if (signal?.aborted) throw new DOMException("Render aborted.", "AbortError");
    return rendered;
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
    let eqSettings = globalThis.SCParametricEQ?.normalize(null);
    let eqAllowed = false;
    let eqRequested = false;
    let eqRevision = 0;

    function snapshot() {
      return Object.freeze({ ...values, eq: globalThis.SCParametricEQ?.normalize(eqSettings), bypassed, available, reason, initialized: Boolean(graph) });
    }

    function updateEqualizer(targetGraph = graph) {
      if (!targetGraph) return;
      if (eqRequested && eqAllowed && !targetGraph.eq) targetGraph.eq = insertEqualizer(targetGraph.source);
      const key = `${eqRevision}:${bypassed}:${eqAllowed}`;
      if (targetGraph.eq && targetGraph.eqKey !== key) {
        targetGraph.eq.apply(eqSettings, bypassed || !eqAllowed);
        targetGraph.eqKey = key;
      }
    }

    function setEqualizer(value) {
      eqSettings = globalThis.SCParametricEQ.validate(value);
      eqRevision++;
      eqRequested = true;
      if (eqAllowed) {
        if (!graph) initialize();
        else applyToActive();
        updateEqualizer();
      }
      return snapshot();
    }

    function setEqualizerAllowed(value) {
      if (eqAllowed === Boolean(value)) return;
      eqAllowed = Boolean(value);
      for (const reference of graphReferences) updateEqualizer(reference.deref());
    }

    function analyseEqualizer() {
      if (!eqAllowed) return null;
      eqRequested = true;
      applyToActive();
      if (!graph) initialize();
      updateEqualizer();
      return graph?.eq || null;
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

    function rebuildWetBranches(targetGraph) {
      const contextForGraph = targetGraph.context;
      const oldNodes = [
        targetGraph.reverbPreDelay, targetGraph.reverb, targetGraph.reverbTone,
        targetGraph.delay, targetGraph.delayTone, targetGraph.feedback,
      ];
      for (const name of ["reverb", "delay"]) {
        if (targetGraph.connected[name]) {
          targetGraph.source.disconnect(targetGraph[EFFECT_NODES[name]]);
        }
        targetGraph.connected[name] = false;
      }
      for (const node of oldNodes) {
        try { node.disconnect(); } catch {}
      }

      const reverbPreDelay = contextForGraph.createDelay(0.25);
      const reverb = contextForGraph.createConvolver();
      const reverbTone = contextForGraph.createBiquadFilter();
      reverbTone.type = "lowpass";
      reverbPreDelay.connect(reverb);
      reverb.connect(reverbTone);
      reverbTone.connect(targetGraph.reverbReturn);

      const delay = contextForGraph.createDelay(1);
      const delayTone = contextForGraph.createBiquadFilter();
      delayTone.type = "lowpass";
      const feedback = contextForGraph.createGain();
      delay.connect(delayTone);
      delayTone.connect(feedback);
      feedback.connect(delay);
      delay.connect(targetGraph.delayReturn);

      Object.assign(targetGraph, {
        reverbPreDelay, reverb, reverbTone, delay, delayTone, feedback,
      });
    }

    function setParam(param, value, contextForParam = context) {
      const now = contextForParam.currentTime;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, RAMP_SECONDS / 3);
    }

    function updateReturns(targetGraph = graph) {
      if (!targetGraph?.context) return;
      updateEqualizer(targetGraph);
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

    function reset() {
      Object.assign(values, DEFAULTS);
      bypassed = false;
      eqSettings = globalThis.SCParametricEQ?.normalize(null);
      eqRevision += 1;
      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = null;
      for (const reference of graphReferences) {
        const targetGraph = reference.deref();
        if (!targetGraph) { graphReferences.delete(reference); continue; }
        for (const name of ["reverb", "delay"]) {
          if (targetGraph.resetTimers[name] !== undefined) clearTimeout(targetGraph.resetTimers[name]);
          delete targetGraph.resetTimers[name];
          setParam(targetGraph[`${name}Return`].gain, 0, targetGraph.context);
        }
        // These nodes retain buffered audio after their input is disconnected.
        // Replace only the wet branches so old tails cannot return on re-enable.
        rebuildWetBranches(targetGraph);
        updateCharacter(targetGraph);
        updateEqualizer(targetGraph);
        updateReturns(targetGraph);
      }
      return snapshot();
    }

    function discover(candidate) {
      if (!candidate || typeof candidate.play !== "function") return;
      // Cache one graph per player element because SoundCloud can replace its
      // media element while navigating inside the single-page app.
      if (!graph) audio = candidate;
      else if (
        candidate !== audio && context &&
        (values.reverb > 0 || values.delay > 0 || (eqRequested && eqAllowed))
      ) connectAudio(candidate);
    }

    function applyToActive() {
      const candidate = getActiveAudio();
      if (candidate && candidate !== audio) {
        if (graph && context && (values.reverb > 0 || values.delay > 0 || (eqRequested && eqAllowed))) connectAudio(candidate);
        else audio = candidate;
      }
      if (!graph && available && (values.reverb > 0 || values.delay > 0 || (eqRequested && eqAllowed))) initialize();
      return snapshot();
    }

    return Object.freeze({ applyPreset, applyToActive, discover, reset, set, setBypassed, setCharacter, snapshot,
      setEqualizer, setEqualizerAllowed, analyseEqualizer });
  }

  globalThis.SCTempoEffects = Object.freeze({ create, renderSample, clampPercent, DEFAULTS, PRESETS, REVERB_ROOMS });
})();
