const SCLooperCore = (() => {
  const MIN_RANGE_MS = 250;
  const DEFAULT_RANGE_MS = 10000;

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function normalizeDuration(durationMs) {
    return isFiniteNumber(durationMs) && durationMs >= MIN_RANGE_MS
      ? durationMs
      : null;
  }

  function normalizeRange(range) {
    const durationMs = normalizeDuration(range?.durationMs);
    if (durationMs === null) return null;

    let startMs = isFiniteNumber(range?.startMs) ? range.startMs : 0;
    let endMs = isFiniteNumber(range?.endMs)
      ? range.endMs
      : Math.min(DEFAULT_RANGE_MS, durationMs);

    startMs = clamp(startMs, 0, durationMs);
    endMs = clamp(endMs, 0, durationMs);

    if (endMs < startMs) {
      [startMs, endMs] = [endMs, startMs];
    }

    if (endMs - startMs < MIN_RANGE_MS) {
      if (startMs + MIN_RANGE_MS <= durationMs) {
        endMs = startMs + MIN_RANGE_MS;
      } else {
        endMs = durationMs;
        startMs = durationMs - MIN_RANGE_MS;
      }
    }

    return { startMs, endMs, durationMs };
  }

  function createInitialRange(durationMs, currentTimeMs = 0) {
    const duration = normalizeDuration(durationMs);
    if (duration === null) return null;

    const current = isFiniteNumber(currentTimeMs)
      ? clamp(currentTimeMs, 0, duration)
      : 0;
    const span = Math.min(DEFAULT_RANGE_MS, duration);
    const endMs = Math.min(current + span, duration);

    return normalizeRange({
      startMs: endMs === duration ? Math.max(0, duration - span) : current,
      endMs,
      durationMs: duration,
    });
  }

  function moveMarker(range, marker, timeMs) {
    const normalized = normalizeRange(range);
    if (!normalized || !isFiniteNumber(timeMs)) return normalized;

    if (marker === "start") {
      return {
        ...normalized,
        startMs: clamp(
          timeMs,
          0,
          normalized.endMs - MIN_RANGE_MS
        ),
      };
    }

    if (marker === "end") {
      return {
        ...normalized,
        endMs: clamp(
          timeMs,
          normalized.startMs + MIN_RANGE_MS,
          normalized.durationMs
        ),
      };
    }

    return normalized;
  }

  function moveRange(range, deltaMs) {
    const normalized = normalizeRange(range);
    if (!normalized || !isFiniteNumber(deltaMs)) return normalized;

    const spanMs = normalized.endMs - normalized.startMs;
    const startMs = clamp(
      normalized.startMs + deltaMs,
      0,
      normalized.durationMs - spanMs
    );

    return {
      ...normalized,
      startMs,
      endMs: startMs + spanMs,
    };
  }

  function positionToTime(clientX, left, width, durationMs) {
    const duration = normalizeDuration(durationMs);
    if (
      duration === null ||
      !isFiniteNumber(clientX) ||
      !isFiniteNumber(left) ||
      !isFiniteNumber(width) ||
      width <= 0
    ) {
      return null;
    }

    return clamp((clientX - left) / width, 0, 1) * duration;
  }

  function timeToPercent(timeMs, durationMs) {
    const duration = normalizeDuration(durationMs);
    if (duration === null || !isFiniteNumber(timeMs)) return 0;
    return clamp(timeMs / duration, 0, 1) * 100;
  }

  function getSeekTarget(range, currentTimeMs) {
    const normalized = normalizeRange(range);
    if (!normalized || !isFiniteNumber(currentTimeMs)) return null;

    return currentTimeMs < normalized.startMs || currentTimeMs >= normalized.endMs
      ? normalized.startMs
      : null;
  }

  return {
    MIN_RANGE_MS,
    DEFAULT_RANGE_MS,
    normalizeRange,
    createInitialRange,
    moveMarker,
    moveRange,
    positionToTime,
    timeToPercent,
    getSeekTarget,
  };
})();
