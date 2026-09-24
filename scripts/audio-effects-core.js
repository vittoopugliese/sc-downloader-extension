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
  const bitcrusherModuleLoads = new WeakMap();
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
    schemaVersion: 2,
    reverb: 0, delay: 0, reverbRoom: "hall", reverbSize: 55, reverbDecay: 2.4, reverbPreDelay: 20, reverbTone: 70,
    delayTime: 250, delayFeedback: 25, delayTone: 70,
    flanger: 0, flangerRate: 0.25, flangerDepth: 50, flangerFeedback: 15,
    phaser: 0, phaserRate: 0.2, phaserDepth: 50, phaserFeedback: 10,
    bitcrusher: 0, bitDepth: 12, sampleRateReduction: 25,
    saturation: 0, saturationDrive: 25, saturationTone: 60,
    preset: "custom",
  });
  const EFFECT_NAMES = Object.freeze(["reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation"]);
  const MAX_SEND = Object.freeze({ reverb: 0.7, delay: 0.55, flanger: 0.55, phaser: 0.55, bitcrusher: 0.65, saturation: 0.65 });
  const REVERB_ROOMS = Object.freeze({ room: { seconds: 0.7, decay: 4.5 }, hall: { seconds: 2.4, decay: 2.7 }, plate: { seconds: 1.6, decay: 1.5 } });
  const PRESETS = Object.freeze({
    subtle: { reverb: 18, delay: 0, flanger: 0, phaser: 0, bitcrusher: 0, saturation: 0, reverbRoom: "room", reverbSize: 30, reverbDecay: 0.8, reverbPreDelay: 8, reverbTone: 70, delayTime: 180, delayFeedback: 15, delayTone: 70 },
    studio: { reverb: 35, delay: 12, flanger: 0, phaser: 0, bitcrusher: 0, saturation: 8, reverbRoom: "plate", reverbSize: 45, reverbDecay: 1.6, reverbPreDelay: 18, reverbTone: 72, delayTime: 220, delayFeedback: 22, delayTone: 68, saturationDrive: 18, saturationTone: 68 },
    wide: { reverb: 52, delay: 16, flanger: 14, phaser: 10, bitcrusher: 0, saturation: 0, reverbRoom: "hall", reverbSize: 75, reverbDecay: 4.8, reverbPreDelay: 45, reverbTone: 78, delayTime: 310, delayFeedback: 28, delayTone: 72 },
    dub: { reverb: 12, delay: 48, flanger: 0, phaser: 0, bitcrusher: 0, saturation: 12, reverbRoom: "room", reverbSize: 40, reverbDecay: 1.2, reverbPreDelay: 12, reverbTone: 55, delayTime: 380, delayFeedback: 60, delayTone: 42, saturationDrive: 30, saturationTone: 48 },
  });
  const RAMP_SECONDS = 0.02;
  const TRACK_RESET_MS = 900;
  const REVERB_IMPULSE_ENERGY = 0.15;
  const EFFECT_NODES = Object.freeze({ reverb: "reverbPreDelay", delay: "delayInput", flanger: "flangerInput", phaser: "phaserInput", bitcrusher: "bitcrusherInput", saturation: "saturationInput" });

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.max(0, Math.min(100, number)));
  }

  function createSaturationCurve(drive) {
    const amount = 1 + clampPercent(drive) / 100 * 49;
    const curve = new Float32Array(2049);
    const denominator = Math.tanh(amount);
    for (let index = 0; index < curve.length; index += 1) {
      const input = index / (curve.length - 1) * 2 - 1;
      curve[index] = Math.tanh(input * amount) / denominator;
    }
    return curve;
  }

  function createCrusherCurve(bitDepth) {
    const steps = Math.pow(2, clamp(bitDepth, 2, 16, DEFAULTS.bitDepth) - 1);
    const curve = new Float32Array(65537);
    for (let index = 0; index < curve.length; index += 1) {
      const input = index / (curve.length - 1) * 2 - 1;
      curve[index] = Math.round(input * steps) / steps;
    }
    return curve;
  }

  function crushBuffer(buffer, bitDepth, reduction) {
    const result = new AudioBuffer({
      length: buffer.length,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    });
    const steps = Math.pow(2, clamp(bitDepth, 2, 16, DEFAULTS.bitDepth) - 1);
    const hold = Math.max(1, Math.round(1 + clampPercent(reduction) / 100 * 63));
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const output = result.getChannelData(channel);
      let sample = 0;
      for (let index = 0; index < input.length; index += 1) {
        if (index % hold === 0) sample = Math.round(input[index] * steps) / steps;
        output[index] = sample;
      }
    }
    return result;
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
    const flangerWet = settings?.bypassed ? 0 : clampPercent(settings?.flanger);
    const phaserWet = settings?.bypassed ? 0 : clampPercent(settings?.phaser);
    const bitcrusherWet = settings?.bypassed ? 0 : clampPercent(settings?.bitcrusher);
    const saturationWet = settings?.bypassed ? 0 : clampPercent(settings?.saturation);
    const eqSettings = globalThis.SCParametricEQ?.validate(settings?.eq);
    const eqActive = settings?.bypassed !== true && globalThis.SCParametricEQ?.isActive(eqSettings);
    if (!reverbWet && !delayWet && !flangerWet && !phaserWet && !bitcrusherWet && !saturationWet && !eqActive) return buffer;
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
    let effectSource = source;
    if (eqActive) {
      const equalizer = globalThis.SCParametricEQ.createGraph(context);
      equalizer.apply(eqSettings, false, true);
      source.connect(equalizer.input);
      effectSource = equalizer.output;
    }
    effectSource.connect(master);
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
      effectSource.connect(preDelay);
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
      effectSource.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(master);
    }
    if (flangerWet) {
      const delay = context.createDelay(0.03);
      delay.delayTime.value = 0.0035;
      const feedback = context.createGain();
      feedback.gain.value = clampPercent(settings?.flangerFeedback ?? DEFAULTS.flangerFeedback) / 100 * 0.75;
      const lfo = context.createOscillator();
      lfo.frequency.value = clampFloat(settings?.flangerRate, 0.05, 5, DEFAULTS.flangerRate);
      const modulation = context.createGain();
      modulation.gain.value = clampPercent(settings?.flangerDepth ?? DEFAULTS.flangerDepth) / 100 * 0.008;
      const wet = context.createGain();
      wet.gain.value = flangerWet / 100 * MAX_SEND.flanger;
      effectSource.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      lfo.connect(modulation);
      modulation.connect(delay.delayTime);
      delay.connect(wet);
      wet.connect(master);
      lfo.start();
    }
    if (phaserWet) {
      const stages = [350, 700, 1400, 2800].map((frequency) => {
        const stage = context.createBiquadFilter();
        stage.type = "allpass";
        stage.frequency.value = frequency;
        stage.Q.value = 0.7;
        return stage;
      });
      const feedback = context.createGain();
      feedback.gain.value = clampPercent(settings?.phaserFeedback ?? DEFAULTS.phaserFeedback) / 100 * 0.7;
      const lfo = context.createOscillator();
      lfo.frequency.value = clampFloat(settings?.phaserRate, 0.05, 5, DEFAULTS.phaserRate);
      const depth = clampPercent(settings?.phaserDepth ?? DEFAULTS.phaserDepth) / 100;
      effectSource.connect(stages[0]);
      stages.forEach((stage, index) => {
        if (stages[index + 1]) stage.connect(stages[index + 1]);
        const modulation = context.createGain();
        modulation.gain.value = [250, 500, 900, 1600][index] * depth;
        lfo.connect(modulation);
        modulation.connect(stage.frequency);
      });
      stages.at(-1).connect(feedback);
      feedback.connect(stages[0]);
      const wet = context.createGain();
      wet.gain.value = phaserWet / 100 * MAX_SEND.phaser;
      stages.at(-1).connect(wet);
      wet.connect(master);
      lfo.start();
    }
    if (saturationWet) {
      const shaper = context.createWaveShaper();
      shaper.curve = createSaturationCurve(settings?.saturationDrive ?? DEFAULTS.saturationDrive);
      shaper.oversample = "4x";
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 900 + clampPercent(settings?.saturationTone ?? DEFAULTS.saturationTone) / 100 * 15100;
      const wet = context.createGain();
      wet.gain.value = saturationWet / 100 * MAX_SEND.saturation;
      effectSource.connect(shaper);
      shaper.connect(tone);
      tone.connect(wet);
      wet.connect(master);
    }
    let crusherSource = null;
    if (bitcrusherWet) {
      crusherSource = context.createBufferSource();
      crusherSource.buffer = crushBuffer(buffer, settings?.bitDepth ?? DEFAULTS.bitDepth, settings?.sampleRateReduction ?? DEFAULTS.sampleRateReduction);
      let crusherEffectSource = crusherSource;
      if (eqActive) {
        const crusherEqualizer = globalThis.SCParametricEQ.createGraph(context);
        crusherEqualizer.apply(eqSettings, false, true);
        crusherSource.connect(crusherEqualizer.input);
        crusherEffectSource = crusherEqualizer.output;
      }
      const wet = context.createGain();
      wet.gain.value = bitcrusherWet / 100 * MAX_SEND.bitcrusher;
      crusherEffectSource.connect(wet);
      wet.connect(master);
      crusherSource.start();
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

  function clampFloat(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function createWetBranches(context, returns) {
    const reverbPreDelay = context.createDelay(0.25);
    const reverb = context.createConvolver();
    const reverbTone = context.createBiquadFilter();
    reverbTone.type = "lowpass";
    reverbPreDelay.connect(reverb);
    reverb.connect(reverbTone);
    reverbTone.connect(returns.reverbReturn);

    const delayInput = context.createGain();
    const delay = context.createDelay(1);
    const delayTone = context.createBiquadFilter();
    delayTone.type = "lowpass";
    const feedback = context.createGain();
    delayInput.connect(delay);
    delay.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(delay);
    delay.connect(returns.delayReturn);

    const flangerInput = context.createGain();
    const flangerDelay = context.createDelay(0.03);
    const flangerFeedback = context.createGain();
    const flangerLfo = context.createOscillator();
    const flangerModulation = context.createGain();
    flangerInput.connect(flangerDelay);
    flangerDelay.connect(flangerFeedback);
    flangerFeedback.connect(flangerDelay);
    flangerLfo.connect(flangerModulation);
    flangerModulation.connect(flangerDelay.delayTime);
    flangerDelay.connect(returns.flangerReturn);
    flangerLfo.start();

    const phaserInput = context.createGain();
    const phaserStages = [350, 700, 1400, 2800].map((frequency) => {
      const stage = context.createBiquadFilter();
      stage.type = "allpass";
      stage.frequency.value = frequency;
      stage.Q.value = 0.7;
      return stage;
    });
    const phaserFeedback = context.createGain();
    const phaserLfo = context.createOscillator();
    const phaserModulations = phaserStages.map(() => context.createGain());
    phaserInput.connect(phaserStages[0]);
    phaserStages.forEach((stage, index) => {
      if (phaserStages[index + 1]) stage.connect(phaserStages[index + 1]);
      phaserLfo.connect(phaserModulations[index]);
      phaserModulations[index].connect(stage.frequency);
    });
    phaserStages.at(-1).connect(phaserFeedback);
    phaserFeedback.connect(phaserStages[0]);
    phaserStages.at(-1).connect(returns.phaserReturn);
    phaserLfo.start();

    const bitcrusherInput = context.createGain();
    const bitcrusherShaper = context.createWaveShaper();
    const bitcrusherTone = context.createBiquadFilter();
    bitcrusherTone.type = "lowpass";
    bitcrusherInput.connect(bitcrusherShaper);
    bitcrusherShaper.connect(bitcrusherTone);
    bitcrusherTone.connect(returns.bitcrusherReturn);

    const saturationInput = context.createGain();
    const saturationShaper = context.createWaveShaper();
    saturationShaper.oversample = "4x";
    const saturationTone = context.createBiquadFilter();
    saturationTone.type = "lowpass";
    saturationInput.connect(saturationShaper);
    saturationShaper.connect(saturationTone);
    saturationTone.connect(returns.saturationReturn);

    const wetNodes = [reverbPreDelay, reverb, reverbTone, delayInput, delay, delayTone, feedback,
      flangerInput, flangerDelay, flangerFeedback, flangerLfo, flangerModulation,
      phaserInput, ...phaserStages, phaserFeedback, phaserLfo, ...phaserModulations,
      bitcrusherInput, bitcrusherShaper, bitcrusherTone, saturationInput, saturationShaper, saturationTone];
    return { reverbPreDelay, reverb, reverbTone, delayInput, delay, delayTone, feedback,
      flangerInput, flangerDelay, flangerFeedback, flangerLfo, flangerModulation,
      phaserInput, phaserStages, phaserFeedback, phaserLfo, phaserModulations,
      bitcrusherInput, bitcrusherShaper, bitcrusherTone,
      saturationInput, saturationShaper, saturationTone, wetNodes };
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
    let delayFrozen = false;

    function installBitcrusherWorklet(targetGraph = graph) {
      const contextForGraph = targetGraph?.context;
      const WorkletNode = options.AudioWorkletNode || globalThis.AudioWorkletNode;
      const moduleUrl = globalThis.document?.documentElement?.getAttribute?.("data-scdl-extension-bitcrusher-worklet-url");
      if (!contextForGraph?.audioWorklet?.addModule || typeof WorkletNode !== "function" || !moduleUrl || targetGraph.bitcrusherWorklet) return;
      let load = bitcrusherModuleLoads.get(contextForGraph);
      if (!load) {
        load = contextForGraph.audioWorklet.addModule(moduleUrl);
        bitcrusherModuleLoads.set(contextForGraph, load);
      }
      const expectedInput = targetGraph.bitcrusherInput;
      load.then(() => {
        if (targetGraph.bitcrusherInput !== expectedInput || targetGraph.bitcrusherWorklet) return;
        const processor = new WorkletNode(contextForGraph, "scdl-bitcrusher", { numberOfInputs: 1, numberOfOutputs: 1 });
        expectedInput.disconnect(targetGraph.bitcrusherShaper);
        expectedInput.connect(processor);
        processor.connect(targetGraph.bitcrusherReturn);
        targetGraph.bitcrusherWorklet = processor;
        targetGraph.wetNodes.push(processor);
        setParam(processor.parameters.get("bitDepth"), values.bitDepth, contextForGraph);
        setParam(processor.parameters.get("reduction"), values.sampleRateReduction, contextForGraph);
      }).catch(() => {
        bitcrusherModuleLoads.delete(contextForGraph);
      });
    }

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
      setParam(targetGraph.feedback.gain, delayFrozen ? 0.985 : values.delayFeedback / 100 * 0.82, contextForGraph);
      setParam(targetGraph.delayInput.gain, delayFrozen ? 0 : 1, contextForGraph);
      setParam(targetGraph.flangerDelay.delayTime, 0.0035, contextForGraph);
      setParam(targetGraph.flangerLfo.frequency, values.flangerRate, contextForGraph);
      setParam(targetGraph.flangerModulation.gain, values.flangerDepth / 100 * 0.008, contextForGraph);
      setParam(targetGraph.flangerFeedback.gain, values.flangerFeedback / 100 * 0.75, contextForGraph);
      setParam(targetGraph.phaserLfo.frequency, values.phaserRate, contextForGraph);
      targetGraph.phaserModulations.forEach((modulation, index) =>
        setParam(modulation.gain, [250, 500, 900, 1600][index] * values.phaserDepth / 100, contextForGraph));
      setParam(targetGraph.phaserFeedback.gain, values.phaserFeedback / 100 * 0.7, contextForGraph);
      targetGraph.bitcrusherShaper.curve = createCrusherCurve(values.bitDepth);
      targetGraph.bitcrusherTone.frequency.value = Math.max(800, contextForGraph.sampleRate / 2 * (1 - values.sampleRateReduction / 100 * 0.94));
      if (targetGraph.bitcrusherWorklet) {
        setParam(targetGraph.bitcrusherWorklet.parameters.get("bitDepth"), values.bitDepth, contextForGraph);
        setParam(targetGraph.bitcrusherWorklet.parameters.get("reduction"), values.sampleRateReduction, contextForGraph);
      }
      targetGraph.saturationShaper.curve = createSaturationCurve(values.saturationDrive);
      setParam(targetGraph.saturationTone.frequency, 900 + values.saturationTone / 100 * 15100, contextForGraph);
    }

    function rebuildWetBranches(targetGraph) {
      const contextForGraph = targetGraph.context;
      const oldNodes = targetGraph.wetNodes;
      for (const name of EFFECT_NAMES) {
        if (targetGraph.connected[name]) {
          targetGraph.source.disconnect(targetGraph[EFFECT_NODES[name]]);
        }
        targetGraph.connected[name] = false;
      }
      for (const node of oldNodes) {
        try { node.stop?.(); } catch {}
        try { node.disconnect(); } catch {}
      }
      targetGraph.bitcrusherWorklet = null;
      Object.assign(targetGraph, createWetBranches(contextForGraph, targetGraph));
      if (values.bitcrusher > 0) installBitcrusherWorklet(targetGraph);
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
      for (const name of EFFECT_NAMES) {
        setParam(targetGraph[`${name}Return`].gain, active ? values[name] / 100 * MAX_SEND[name] : 0, contextForGraph);
      }
      if (!targetGraph.ownsSource) return;
      const useLimiter = active && EFFECT_NAMES.some((name) => values[name] > 0);
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
      if (name === "bitcrusher") installBitcrusherWorklet(graph);
      graph.source.connect(graph[EFFECT_NODES[name]]);
      graph.connected[name] = true;
    }

    function connectAudio(target) {
      const cached = graphs.get(target);
      if (cached) {
        audio = target;
        graph = cached;
        context = cached.context;
        EFFECT_NAMES.forEach(ensureEffectConnected);
        updateReturns();
        return true;
      }
      try {
        const existingSource = mediaSources.get(target);
        if (existingSource) context = existingSource.context;
        const source = existingSource || context.createMediaElementSource(target);
        const ownsSource = !existingSource;
        const returns = Object.fromEntries(EFFECT_NAMES.map((name) => [`${name}Return`, context.createGain()]));
        const master = context.createGain();
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        for (const name of EFFECT_NAMES) returns[`${name}Return`].gain.value = 0;

        if (ownsSource) source.connect(context.destination);
        for (const name of EFFECT_NAMES) returns[`${name}Return`].connect(master);
        master.connect(limiter);
        limiter.connect(context.destination);

        const targetGraph = {
          source, ...returns, master, limiter,
          context, ownsSource,
          resetTimers: {},
          connected: Object.fromEntries(EFFECT_NAMES.map((name) => [name, false])),
          processedOutput: false,
        };
        Object.assign(targetGraph, createWetBranches(context, returns));
        if (values.bitcrusher > 0) installBitcrusherWorklet(targetGraph);
        graphs.set(target, targetGraph);
        graphReferences.add(new WeakRef(targetGraph));
        target.addEventListener("loadstart", resetTail);
        target.addEventListener("emptied", resetTail);
        target.addEventListener("loadedmetadata", restoreAfterTrackChange);
        audio = target;
        graph = targetGraph;
        updateCharacter(targetGraph);
        EFFECT_NAMES.forEach(ensureEffectConnected);
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
      setDelayFreeze(false);
      EFFECT_NAMES.forEach((name) => setParam(graph[`${name}Return`].gain, 0));
      resetTimer = setTimeout(() => {
        resetTimer = null;
        updateReturns();
      }, TRACK_RESET_MS);
    }

    function restoreAfterTrackChange() {
      if (resetTimer === null) updateReturns();
    }

    function set(name, value) {
      if (!EFFECT_NAMES.includes(name)) throw new RangeError(`Unknown audio effect: ${name}`);
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
      if (!(name in DEFAULTS) || EFFECT_NAMES.includes(name) || ["schemaVersion", "preset"].includes(name)) throw new RangeError(`Unknown effect setting: ${name}`);
      if (name === "reverbRoom") values[name] = REVERB_ROOMS[value] ? value : DEFAULTS.reverbRoom;
      else if (name === "reverbDecay") values[name] = Math.round(Math.max(0.2, Math.min(12, Number(value) || DEFAULTS[name])) * 10) / 10;
      else if (["flangerRate", "phaserRate"].includes(name)) values[name] = Math.round(clampFloat(value, 0.05, 5, DEFAULTS[name]) * 100) / 100;
      else if (name === "bitDepth") values[name] = clamp(value, 2, 16, DEFAULTS[name]);
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
      for (const effectName of EFFECT_NAMES) {
        if (values[effectName] > 0) ensureEffectConnected(effectName);
        else flushEffectTail(effectName);
      }
      updateReturns();
      return snapshot();
    }

    function setBypassed(value) {
      bypassed = Boolean(value);
      if (bypassed) setDelayFreeze(false);
      updateAllReturns();
      return snapshot();
    }

    function setDelayFreeze(value) {
      delayFrozen = Boolean(value) && !bypassed && available && values.delay > 0;
      for (const reference of graphReferences) {
        const targetGraph = reference.deref();
        if (!targetGraph) { graphReferences.delete(reference); continue; }
        setParam(targetGraph.delayInput.gain, delayFrozen ? 0 : 1, targetGraph.context);
        setParam(targetGraph.feedback.gain, delayFrozen ? 0.985 : values.delayFeedback / 100 * 0.82, targetGraph.context);
      }
      return delayFrozen;
    }

    function isDelayFrozen() { return delayFrozen; }

    function reset() {
      Object.assign(values, DEFAULTS);
      bypassed = false;
      delayFrozen = false;
      eqSettings = globalThis.SCParametricEQ?.normalize(null);
      eqRevision += 1;
      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = null;
      for (const reference of graphReferences) {
        const targetGraph = reference.deref();
        if (!targetGraph) { graphReferences.delete(reference); continue; }
        for (const name of EFFECT_NAMES) {
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
        (EFFECT_NAMES.some((name) => values[name] > 0) || (eqRequested && eqAllowed))
      ) connectAudio(candidate);
    }

    function applyToActive() {
      const candidate = getActiveAudio();
      if (candidate && candidate !== audio) {
        if (graph && context && (EFFECT_NAMES.some((name) => values[name] > 0) || (eqRequested && eqAllowed))) connectAudio(candidate);
        else audio = candidate;
      }
      if (!graph && available && (EFFECT_NAMES.some((name) => values[name] > 0) || (eqRequested && eqAllowed))) initialize();
      return snapshot();
    }

    return Object.freeze({ applyPreset, applyToActive, discover, isDelayFrozen, reset, set, setBypassed, setCharacter, setDelayFreeze, snapshot,
      setEqualizer, setEqualizerAllowed, analyseEqualizer });
  }

  globalThis.SCTempoEffects = Object.freeze({ create, renderSample, clampPercent, DEFAULTS, EFFECT_NAMES, PRESETS, REVERB_ROOMS });
})();
