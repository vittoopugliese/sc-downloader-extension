(() => {
  "use strict";

  if (globalThis.SCLoopSession) return;

  const MIN_RANGE_MS = globalThis.SCLooperCore?.MIN_RANGE_MS || 250;
  const EMPTY = Object.freeze({ active: false, enabled: false, effectiveEnabled: false, bypassed: false, startMs: null, endMs: null, durationMs: null, trackIdentity: null, generation: 0, error: null });

  function same(left, right) { return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => left[key] === right[key]); }
  function duration(value) { const result = Number(value); return Number.isFinite(result) && result >= MIN_RANGE_MS ? Math.round(result) : null; }
  function clamp(value, maximum) { return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : null; }
  function completeRange(startMs, endMs, durationMs) {
    if (globalThis.SCLooperCore?.normalizeRange) return globalThis.SCLooperCore.normalizeRange({ startMs, endMs, durationMs });
    let start = clamp(startMs, durationMs); let end = clamp(endMs, durationMs);
    if (start === null || end === null) return null;
    if (end < start) [start, end] = [end, start];
    if (end - start < MIN_RANGE_MS) { end = Math.min(durationMs, start + MIN_RANGE_MS); start = Math.max(0, end - MIN_RANGE_MS); }
    return { startMs: start, endMs: end, durationMs };
  }
  function create() {
    let state = EMPTY;
    const listeners = new Set();
    function emit(candidate) {
      const next = Object.freeze({ ...candidate, effectiveEnabled: Boolean(candidate.active && candidate.enabled && !candidate.bypassed) });
      if (same(state, next)) return state;
      state = next;
      for (const listener of listeners) listener(state);
      return state;
    }
    function setRange(command) {
      const durationMs = duration(command.durationMs ?? state.durationMs);
      if (durationMs === null) return state;
      const startMs = command.startMs === undefined ? clamp(state.startMs, durationMs) : clamp(command.startMs, durationMs);
      const endMs = command.endMs === undefined ? clamp(state.endMs, durationMs) : clamp(command.endMs, durationMs);
      const range = startMs !== null && endMs !== null ? completeRange(startMs, endMs, durationMs) : { startMs, endMs, durationMs };
      const active = range.startMs !== null && range.endMs !== null;
      return emit({ ...state, ...range, active, enabled: command.enabled === undefined ? state.enabled || active : Boolean(command.enabled) && active, trackIdentity: command.trackIdentity ?? state.trackIdentity, generation: Number.isInteger(command.generation) ? command.generation : state.generation, error: null });
    }
    function command(input = {}) {
      switch (input.type) {
        case "set-range": return setRange(input);
        case "set-enabled": return emit({ ...state, enabled: Boolean(input.enabled) && state.active, error: null });
        case "set-bypass": return emit({ ...state, bypassed: Boolean(input.bypassed), error: null });
        case "set-error": return emit({ ...state, error: input.error || null });
        case "set-track": return emit({ ...EMPTY, bypassed: state.bypassed, trackIdentity: input.trackIdentity || null, generation: Number.isInteger(input.generation) ? input.generation : state.generation });
        case "clear": return emit({ ...EMPTY, bypassed: state.bypassed, trackIdentity: state.trackIdentity, generation: state.generation });
        default: return state;
      }
    }
    return Object.freeze({ command, snapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, destroy() { listeners.clear(); state = EMPTY; } });
  }
  globalThis.SCLoopSession = Object.freeze({ create, MIN_RANGE_MS });
})();
