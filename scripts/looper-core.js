const SCLooperCore = (() => {
  const MIN_RANGE_MS = 250;
  const DEFAULT_RANGE_MS = 10000;
  const MIN_ZOOM_WINDOW_MS = 1000;

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

  function createRangeFromSelection(durationMs, anchorMs, focusMs) {
    const duration = normalizeDuration(durationMs);
    if (
      duration === null ||
      !isFiniteNumber(anchorMs) ||
      !isFiniteNumber(focusMs)
    ) {
      return null;
    }

    return normalizeRange({
      startMs: Math.min(anchorMs, focusMs),
      endMs: Math.max(anchorMs, focusMs),
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

  function normalizeTimeViewport(viewport) {
    if (isFiniteNumber(viewport)) {
      const durationMs = normalizeDuration(viewport);
      return durationMs === null ? null : { startMs: 0, endMs: durationMs };
    }

    const startMs = viewport?.startMs;
    const endMs = viewport?.endMs;
    return isFiniteNumber(startMs) &&
      isFiniteNumber(endMs) &&
      endMs > startMs
      ? { startMs, endMs }
      : null;
  }

  function positionToTime(clientX, left, width, viewport) {
    const normalizedViewport = normalizeTimeViewport(viewport);
    if (
      normalizedViewport === null ||
      !isFiniteNumber(clientX) ||
      !isFiniteNumber(left) ||
      !isFiniteNumber(width) ||
      width <= 0
    ) {
      return null;
    }

    const spanMs = normalizedViewport.endMs - normalizedViewport.startMs;
    return (
      normalizedViewport.startMs +
      clamp((clientX - left) / width, 0, 1) * spanMs
    );
  }

  function timeToPercent(timeMs, viewport) {
    const normalizedViewport = normalizeTimeViewport(viewport);
    if (normalizedViewport === null || !isFiniteNumber(timeMs)) return 0;
    const spanMs = normalizedViewport.endMs - normalizedViewport.startMs;
    return clamp((timeMs - normalizedViewport.startMs) / spanMs, 0, 1) * 100;
  }

  function normalizeZoomWindow(window, durationMs) {
    const duration = normalizeDuration(durationMs);
    if (duration === null) return null;

    const startMs = isFiniteNumber(window?.startMs) ? window.startMs : 0;
    const endMs = isFiniteNumber(window?.endMs) ? window.endMs : duration;
    const normalizedStart = clamp(Math.min(startMs, endMs), 0, duration);
    const normalizedEnd = clamp(Math.max(startMs, endMs), 0, duration);
    const minimumSpan = Math.min(MIN_ZOOM_WINDOW_MS, duration);

    if (normalizedEnd - normalizedStart < minimumSpan) {
      const centered = (normalizedStart + normalizedEnd) / 2;
      const start = clamp(centered - minimumSpan / 2, 0, duration - minimumSpan);
      return { startMs: start, endMs: start + minimumSpan };
    }

    return { startMs: normalizedStart, endMs: normalizedEnd };
  }

  function zoomWindowAt(window, durationMs, focusMs, direction) {
    const duration = normalizeDuration(durationMs);
    if (
      duration === null ||
      !isFiniteNumber(focusMs) ||
      !isFiniteNumber(direction) ||
      direction === 0
    ) {
      return null;
    }

    const current = normalizeZoomWindow(window, duration) || {
      startMs: 0,
      endMs: duration,
    };
    const currentSpan = current.endMs - current.startMs;
    const nextSpan = clamp(
      currentSpan * (direction < 0 ? 0.8 : 1.25),
      Math.min(MIN_ZOOM_WINDOW_MS, duration),
      duration
    );

    if (nextSpan >= duration) return null;

    const focus = clamp(focusMs, current.startMs, current.endMs);
    const focusRatio = timeToPercent(focus, current) / 100;
    const startMs = clamp(
      focus - focusRatio * nextSpan,
      0,
      duration - nextSpan
    );

    return { startMs, endMs: startMs + nextSpan };
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
    createRangeFromSelection,
    moveMarker,
    moveRange,
    positionToTime,
    timeToPercent,
    MIN_ZOOM_WINDOW_MS,
    normalizeZoomWindow,
    zoomWindowAt,
    getSeekTarget,
  };
})();

// MAIN-world consumers (the player panel and session model) are loaded as
// separate content-script entries, so expose the shared pure helpers explicitly.
globalThis.SCLooperCore = SCLooperCore;
