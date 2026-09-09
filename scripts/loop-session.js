(() => {
  "use strict";

  if (globalThis.SCLoopSession) return;

  const MIN_RANGE_MS = 250;
  const EMPTY = Object.freeze({
    active: false,
    enabled: false,
    startMs: null,
    endMs: null,
    durationMs: null,
    trackIdentity: null,
  });

  function create() {
    let state = EMPTY;
    const listeners = new Set();

    function emit(next) {
      state = Object.freeze(next);
      for (const listener of listeners) listener(state);
      return state;
    }

    function point(value, durationMs) {
      if (!Number.isFinite(value)) return null;
      return Math.max(0, Math.min(durationMs, Math.round(value)));
    }

    function setRange(command) {
      const durationMs = Number(command.durationMs);
      if (!Number.isFinite(durationMs) || durationMs < MIN_RANGE_MS) return state;
      let startMs = command.startMs === undefined
        ? state.startMs
        : point(command.startMs, durationMs);
      let endMs = command.endMs === undefined
        ? state.endMs
        : point(command.endMs, durationMs);

      if (startMs !== null && endMs !== null && endMs - startMs < MIN_RANGE_MS) {
        if (command.marker === "start") {
          startMs = Math.max(0, endMs - MIN_RANGE_MS);
        } else {
          endMs = Math.min(durationMs, startMs + MIN_RANGE_MS);
          if (endMs - startMs < MIN_RANGE_MS) startMs = endMs - MIN_RANGE_MS;
        }
      }
      const active = startMs !== null && endMs !== null;
      return emit({
        active,
        enabled: command.enabled !== false && active,
        startMs,
        endMs,
        durationMs,
        trackIdentity: command.trackIdentity || state.trackIdentity || null,
      });
    }

    function command(input = {}) {
      if (input.type === "set-range") return setRange(input);
      if (input.type === "set-enabled") {
        return emit({ ...state, enabled: Boolean(input.enabled) && state.active });
      }
      if (input.type === "clear") return emit({ ...EMPTY });
      return state;
    }

    return Object.freeze({
      command,
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      destroy() {
        listeners.clear();
        state = EMPTY;
      },
    });
  }

  globalThis.SCLoopSession = Object.freeze({ create, MIN_RANGE_MS });
})();
