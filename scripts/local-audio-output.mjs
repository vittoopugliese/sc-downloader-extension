// Local master: shared Player Tools FX, then EQ, then the recorder/output tap.
export function createEqualizedOutput({ audioContext }) {
  const equalizer = globalThis.SCParametricEQ;
  let context, graph, input, settings = equalizer.normalize(null);
  const listeners = new Set();
  const effects = globalThis.SCTempoEffects.create({
    localAudio() { prepare(); return { context, input, output: graph.input }; },
    bitcrusherModuleUrl: new URL('./bitcrusher-processor.js', import.meta.url).href,
  });
  function prepare() {
    if (!graph) {
      context = audioContext();
      graph = equalizer.createGraph(context, { analyse: true });
      input = context.createGain();
      graph.apply(settings, false, true);
      graph.output.connect(context.destination);
      for (const listener of listeners) listener(context, graph.output);
    }
    return graph;
  }
  return Object.freeze({
    effects,
    effectsSettings() {
      const state = effects.snapshot();
      return Object.fromEntries([...Object.keys(globalThis.SCTempoEffects.DEFAULTS), 'bypassed'].map(key => [key, state[key]]));
    },
    restoreEffects(saved) {
      effects.reset();
      if (!saved || typeof saved !== 'object') return;
      if (Object.hasOwn(globalThis.SCTempoEffects.PRESETS, saved.preset)) effects.applyPreset(saved.preset);
      for (const key of Object.keys(globalThis.SCTempoEffects.DEFAULTS)) {
        if (key === 'preset' || key === 'schemaVersion' || saved[key] == null || saved[key] === effects.snapshot()[key]) continue;
        if (globalThis.SCTempoEffects.EFFECT_NAMES.includes(key)) effects.set(key, saved[key]);
        else effects.setCharacter(key, saved[key]);
      }
      effects.setBypassed(saved.bypassed === true);
    },
    input() { effects.getPlaybackContext(); return input; },
    getPlaybackContext() { prepare(); return context; },
    snapshot() { return { eq: equalizer.normalize(settings), initialized: !!graph, available: true, bypassed: false }; },
    setEqualizer(value) { settings = equalizer.validate(value); graph?.apply(settings); },
    analyseEqualizer() { return graph || null; },
    observeOutput(listener) {
      prepare(); listener(context, graph.output); listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { listeners.clear(); effects.dispose(); graph?.dispose(); graph = null; },
  });
}
