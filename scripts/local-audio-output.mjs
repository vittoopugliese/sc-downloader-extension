// Adapter for pages that own their audio graph. The shared EQ/Record modules
// consume the same effects interface as the SoundCloud player.
export function createEqualizedOutput({ audioContext }) {
  const equalizer = globalThis.SCParametricEQ;
  let context, graph, settings = equalizer.normalize(null);
  const listeners = new Set();
  function prepare() {
    if (!graph) {
      context = audioContext();
      graph = equalizer.createGraph(context, { analyse: true });
      graph.apply(settings, false, true);
      graph.output.connect(context.destination);
      for (const listener of listeners) listener(context, graph.output);
    }
    return graph;
  }
  return Object.freeze({
    input() { return prepare().input; },
    getPlaybackContext() { prepare(); return context; },
    snapshot() { return { eq: equalizer.normalize(settings), initialized: !!graph, available: true, bypassed: false }; },
    setEqualizer(value) { settings = equalizer.validate(value); graph?.apply(settings); },
    analyseEqualizer() { return graph || null; },
    observeOutput(listener) {
      prepare(); listener(context, graph.output); listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { listeners.clear(); graph?.dispose(); graph = null; },
  });
}
