/*
 * SoundCloud player adapter for scripts/tempo-control-core.js.
 * The audio-control implementation is adapted under the MIT license; see
 * THIRD_PARTY_LICENSES.md.
 */
(() => {
  "use strict";

  const INSTALLED_FLAG = "__scdlTempoControlInstalled";
  const HOST_ID = "scdl-tempo-control";
  const PLAYER_SELECTOR = ".playControls__elements";
  const DOWNLOAD_BUTTON_SELECTOR = "#scdl-player-download";
  const RATE_STORAGE = "scdl.tempo.rate";
  const PITCH_STORAGE = "scdl.tempo.preservePitch";
  const CUSTOM_RATE_STORAGE = ["scdl.tempo.customRate.1", "scdl.tempo.customRate.2"];
  const RATE_ATTRIBUTE = "data-scdl-tempo-rate";
  const PITCH_ATTRIBUTE = "data-scdl-tempo-preserve-pitch";
  const EXTENSION_LOGO_ATTRIBUTE = "data-scdl-extension-logo-url";
  const EXTENSION_ASSETS_EVENT = "scdl:extension-assets-ready";
  const OPEN_LOOPER_GUIDE_EVENT = "scdl:open-looper-guide";
  const REVIEW_URL = "https://chrome.google.com/webstore/detail/ekmbbjdpakacalghjkikfppebgdpoebb/reviews";
  const LOOP_COMMAND_EVENT = "scdl-looper:command";
  const LOOP_COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const LOOP_RESPONSE_ATTRIBUTE = "data-scdl-looper-response";
  const LOOP_SESSION_EVENT = "scdl-loop-session:changed";
  const LOOP_EXPORT_EVENT = "scdl:download-loop";
  const LOOP_EXPORT_RESULT_EVENT = "scdl:download-loop-result";
  const LOOP_EXPORT_ATTRIBUTE = "data-scdl-loop-export-request";
  const LONG_PRESS_MS = 650;
  const PLAYER_TIMELINE_SELECTOR = [
    ".playbackTimeline",
    ".playbackTimeline__progressWrapper",
    ".playbackTimeline__progressBackground",
    ".playbackTimeline__progressHandle",
    ".playbackTimeline__progressContainer",
  ].join(",");
  // Inline copy of assets/icons/bypass.svg for the MAIN-world shadow UI.
  const BYPASS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17.2C22 19.85 19.85 22 17.2 22C15.78 22 14.51 21.38 13.63 20.4C12.87 19.55 12.4 18.43 12.4 17.2C12.4 14.55 14.55 12.4 17.2 12.4C18.57 12.4 19.81 12.98 20.69 13.91C20.68 13.91 20.68 13.91 20.69 13.92C21.5 14.78 22 15.93 22 17.2Z"/><path d="M18.48 18.54L15.95 16M18.45 16.03L15.92 18.57"/><path d="M22 8.69C22 10.66 21.49 12.4 20.69 13.91C19.81 12.98 18.57 12.4 17.2 12.4C14.55 12.4 12.4 14.55 12.4 17.2C12.4 18.43 12.87 19.55 13.63 20.4C13.26 20.57 12.92 20.71 12.62 20.81C12.28 20.93 11.72 20.93 11.38 20.81C8.48 19.82 2 15.69 2 8.69C2 5.6 4.49 3.09998 7.56 3.09998C9.37 3.09998 10.99 3.98002 12 5.33002C13.01 3.98002 14.63 3.09998 16.44 3.09998C19.51 3.09998 22 5.6 22 8.69Z"/></svg>`;
  // Kept inline because this script runs in the page's MAIN world, where
  // chrome.runtime.getURL() is intentionally unavailable. The paths match
  // assets/icons/speed-meter.svg, with fill changed to currentColor.
  const SPEED_METER_ICON = `<svg class="trigger-icon" viewBox="0 0 612 612" aria-hidden="true" focusable="false"><g><path d="M175.205 239.62c.127-1.965-.533-3.902-1.833-5.381l-58.84-66.941c-1.3-1.479-3.135-2.381-5.102-2.508-1.975-.126-3.902.533-5.381 1.833-27.037 23.766-49.479 51.794-66.706 83.305-.944 1.729-1.165 3.762-.611 5.651.554 1.89 1.836 3.483 3.565 4.427l78.205 42.748a7.46 7.46 0 0 0 3.557.912c2.627 0 5.174-1.398 6.523-3.866 11.386-20.828 26.229-39.359 44.114-55.08 1.482-1.308 2.384-3.143 2.509-5.11Z"/><path d="M201.462 214.829a7.46 7.46 0 0 0 10.041 3.081c20.962-11.117 43.512-18.371 67.025-21.561 4.064-.551 6.913-4.293 6.362-8.358l-11.979-88.316c-.551-4.064-4.304-6.909-8.358-6.362-35.708 4.843-69.949 15.857-101.772 32.736-3.623 1.922-5.002 6.416-3.082 10.041l41.763 78.739Z"/><path d="m105.785 334.345-86.017-23.338a7.47 7.47 0 0 0-9.113 5.224C3.586 342.295 0 369.309 0 396.523c0 4.657.111 9.329.342 14.284.185 3.981 3.468 7.083 7.414 7.083.116 0 .234-.002.35-.008l89.031-4.113a7.46 7.46 0 0 0 7.075-7.762c-.155-3.341-.23-6.444-.23-9.484 0-18.02 2.365-35.873 7.029-53.066a7.46 7.46 0 0 0-5.226-9.112Z"/><path d="M438.731 120.745c-32.411-15.625-67.04-25.308-102.925-28.786a7.46 7.46 0 0 0-8.11 6.677l-8.593 88.712c-.396 4.082 2.594 7.713 6.677 8.108 23.652 2.291 46.463 8.669 67.8 18.954a7.46 7.46 0 0 0 10.14-3.37l38.7-80.287c1.558-3.788.007-8.228-3.689-10.008Z"/><path d="M569.642 245.337a7.46 7.46 0 0 0-.828-5.624c-18.432-30.835-41.933-57.983-69.848-80.686a7.46 7.46 0 0 0-10.447 1.075l-56.237 69.144a7.46 7.46 0 0 0 1.077 10.449c18.47 15.019 34.015 32.975 46.205 53.369a7.46 7.46 0 0 0 10.186 2.564l76.501-45.728a7.46 7.46 0 0 0 3.391-4.562Z"/><path d="M598.044 304.939c-1.228-3.915-5.397-6.096-9.308-4.867l-85.048 26.648c-3.915 1.226-6.093 5.393-4.867 9.306 6.104 19.486 9.199 39.839 9.199 60.494 0 3.041-.076 6.144-.23 9.484a7.46 7.46 0 0 0 7.075 7.762l89.031 4.113.35.008c3.944 0 7.228-3.103 7.414-7.083.229-4.955.342-9.627.342-14.284 0-31.217-4.694-61.912-13.956-91.584Z"/><path d="M305.737 380.755c-1.281 0-2.555.042-3.824.11l-120.65-71.185a7.46 7.46 0 0 0-10.632 10.186l65.815 123.355a69.56 69.56 0 0 0-.371 7.195c0 18.608 7.246 36.101 20.403 49.258 13.158 13.158 30.652 20.404 49.26 20.404s36.101-7.248 49.258-20.404c13.157-13.157 20.403-30.65 20.403-49.258s-7.246-36.101-20.403-49.258c-13.157-13.157-30.652-20.403-49.259-20.403Z"/></g></svg>`;

  if (window[INSTALLED_FLAG] || !globalThis.SCTempoControl) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const { DEFAULTS, clampRate, create, formatRate } = globalThis.SCTempoControl;
  const RATE_ANIMATION_DURATION_MS = 220;
  let ui = null;
  let mountQueued = false;
  let playbackFailure = "";
  let storageFailure = "";
  let loopFailure = "";
  let rateAnimationFrame = null;
  let rateAnimationTarget = null;
  let displayedRate = null;
  let animateNextRateChange = false;
  let loopRequestId = 0;
  let loopState = { active: false, enabled: false, startMs: null, endMs: null, durationMs: null };
  let loopPollInterval = null;
  const customRates = CUSTOM_RATE_STORAGE.map((key) => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? null : clampRate(stored);
    } catch {
      return null;
    }
  });
  const reducedMotionQuery =
    typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  function prefersReducedMotion() {
    return reducedMotionQuery?.matches === true;
  }

  // Perlin's smootherstep: soft at both ends without the extra machinery of
  // a CSS animation or a second DOM tree.
  function smootherstep(progress) {
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  }

  function formatTriggerRate(rate) {
    return `${(Math.floor(Number(rate) * 10 + 1e-9) / 10).toFixed(1)}x`;
  }

  function cancelRateAnimation() {
    if (rateAnimationFrame !== null) cancelAnimationFrame(rateAnimationFrame);
    rateAnimationFrame = null;
    rateAnimationTarget = null;
  }

  function setDisplayedRate(rate) {
    if (!ui) return;
    ui.triggerRate.textContent = formatTriggerRate(rate);
    ui.current.textContent = formatRate(rate);
    displayedRate = rate;
  }

  function renderRate(target, animate) {
    if (!ui) return;

    // A non-rate render (for example Keep Tone) must not interrupt a rate
    // transition that is already heading to this exact target.
    if (!animate && rateAnimationFrame !== null && rateAnimationTarget === target) {
      return;
    }

    if (!animate || prefersReducedMotion()) {
      cancelRateAnimation();
      if (displayedRate !== target) setDisplayedRate(target);
      return;
    }

    if (rateAnimationFrame !== null && rateAnimationTarget === target) return;

    cancelRateAnimation();
    const origin = Number.isFinite(displayedRate) ? displayedRate : target;
    if (origin === target) {
      setDisplayedRate(target);
      return;
    }

    rateAnimationTarget = target;
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min((now - startedAt) / RATE_ANIMATION_DURATION_MS, 1);
      setDisplayedRate(origin + (target - origin) * smootherstep(progress));
      if (progress < 1 && !prefersReducedMotion()) {
        rateAnimationFrame = requestAnimationFrame(step);
        return;
      }
      rateAnimationFrame = null;
      rateAnimationTarget = null;
      setDisplayedRate(target);
    };
    rateAnimationFrame = requestAnimationFrame(step);
  }

  function syncBrandLogo() {
    if (!ui) return;
    const logoUrl = document.documentElement.getAttribute(
      EXTENSION_LOGO_ATTRIBUTE
    );
    if (!logoUrl) return;
    ui.brandLogo.src = logoUrl;
    ui.brandLogo.hidden = false;
  }

  document.addEventListener(EXTENSION_ASSETS_EVENT, syncBrandLogo);

  function readStoredRate() {
    try {
      const stored = localStorage.getItem(RATE_STORAGE);
      return stored === null ? DEFAULTS.rate : clampRate(stored);
    } catch {
      return DEFAULTS.rate;
    }
  }

  function readStoredPitch() {
    try {
      return localStorage.getItem(PITCH_STORAGE) === "true";
    } catch {
      return DEFAULTS.preservePitch;
    }
  }

  const controller = create({
    initialRate: readStoredRate(),
    initialPreservePitch: readStoredPitch(),
    onChange: render,
    onError(error) {
      playbackFailure =
        "Could not change playback speed. Reload SoundCloud and retry.";
      console.warn("[SC Downloader Tempo]", error);
      render();
    },
  });

  function writeSetting(key, value) {
    try {
      localStorage.setItem(key, String(value));
      storageFailure = "";
      return true;
    } catch {
      storageFailure = "Could not save this playback setting.";
      render();
      return false;
    }
  }

  function loopDocuments() {
    const results = [];
    const seen = new Set();
    function visit(targetWindow) {
      if (!targetWindow || seen.has(targetWindow)) return;
      seen.add(targetWindow);
      try {
        if (targetWindow.document?.documentElement) results.push(targetWindow.document);
        for (let index = 0; index < targetWindow.frames.length; index += 1) {
          visit(targetWindow.frames[index]);
        }
      } catch {
        // Cross-origin frames cannot contain the SoundCloud media we control.
      }
    }
    visit(window);
    return results;
  }

  function requestLoopFrom(targetDocument, type, payload = {}) {
    const root = targetDocument?.documentElement;
    if (!root?.dispatchEvent) return null;
    const id = `tempo-${Date.now()}-${loopRequestId += 1}`;
    try {
      root.removeAttribute(LOOP_RESPONSE_ATTRIBUTE);
      root.setAttribute(
        LOOP_COMMAND_ATTRIBUTE,
        JSON.stringify({ id, type, ...payload })
      );
      root.dispatchEvent(new CustomEvent(LOOP_COMMAND_EVENT, { bubbles: true }));
      const serialized = root.getAttribute(LOOP_RESPONSE_ATTRIBUTE);
      const response = serialized ? JSON.parse(serialized) : null;
      return response?.id === id ? response : null;
    } catch {
      return null;
    } finally {
      root.removeAttribute(LOOP_COMMAND_ATTRIBUTE);
      root.removeAttribute(LOOP_RESPONSE_ATTRIBUTE);
    }
  }

  function loopResponseScore(response) {
    if (!response?.state?.available) return response?.state?.loop?.active ? 500 : -1;
    return (response.state.loop?.active ? 1000 : 0) +
      (response.state.paused === false ? 100 : 0) +
      (Number.isFinite(response.state.currentTimeMs) ? 10 : 0);
  }

  function requestLoop(type, payload = {}) {
    const documents = loopDocuments();
    if (type === "state") {
      return documents
        .map((targetDocument) => requestLoopFrom(targetDocument, type, payload))
        .filter(Boolean)
        .sort((left, right) => loopResponseScore(right) - loopResponseScore(left))[0] || null;
    }
    if (type === "clear-loop" || type === "set-global-bypass") {
      const responses = documents
        .map((targetDocument) => requestLoopFrom(targetDocument, type, payload))
        .filter(Boolean);
      return responses.find((response) => response.loop?.active) || responses[0] || null;
    }
    const target = documents
      .map((targetDocument) => ({
        targetDocument,
        response: requestLoopFrom(targetDocument, "state"),
      }))
      .sort((left, right) => loopResponseScore(right.response) - loopResponseScore(left.response))[0];
    const generation = target?.response?.state?.loop?.generation;
    return requestLoopFrom(target?.targetDocument || document, type, {
      ...payload,
      ...(Number.isInteger(generation) ? { expectedGeneration: generation } : {}),
    });
  }

  function readLoopState() {
    const response = requestLoop("state");
    const state = response?.state;
    if (!state) return;
    loopState = state.loop || { active: false, enabled: false };
    loopState.available = state.available === true;
    loopState.currentTimeMs = state.currentTimeMs;
    loopState.durationMs = Number.isFinite(loopState.durationMs)
      ? loopState.durationMs
      : state.durationMs;
    renderLoop();
  }

  function formatLoopTime(value) {
    if (!Number.isFinite(value)) return "";
    const totalMs = Math.max(0, Math.round(value));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`;
  }

  function parseLoopTime(value) {
    const source = String(value || "").trim();
    if (!source) return null;
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(source);
    if (!match) return NaN;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes >= 60 || seconds >= 60) return NaN;
    return ((hours * 3600 + minutes * 60 + seconds) * 1000) + Number((match[4] || "").padEnd(3, "0"));
  }

  function setLoopFailure(response) {
    const error = response?.error;
    loopFailure = error === "waiting-metadata" || error === "waiting-track"
      ? "Loop is waiting for the current track metadata."
      : error === "stale-generation"
        ? "The track changed. Please set the loop again."
        : error ? "Could not update the loop. Please retry." : "";
    render();
  }

  function loopPercent(value) {
    return Number.isFinite(value) && Number.isFinite(loopState.durationMs) && loopState.durationMs > 0
      ? Math.max(0, Math.min(100, value / loopState.durationMs * 100))
      : 0;
  }

  function renderLoop() {
    if (!ui?.loopSlider) return;
    const duration = Number.isFinite(loopState.durationMs) ? loopState.durationMs : 0;
    const start = Number.isFinite(loopState.startMs) ? loopState.startMs : 0;
    const end = Number.isFinite(loopState.endMs) ? loopState.endMs : duration;
    for (const input of [ui.loopStart, ui.loopEnd]) {
      input.max = String(Math.max(1, duration));
      input.disabled = !loopState.available || duration <= 0;
    }
    ui.loopStart.value = String(start);
    ui.loopEnd.value = String(end);
    ui.loopStart.setAttribute("aria-valuetext", formatLoopTime(start));
    ui.loopEnd.setAttribute("aria-valuetext", formatLoopTime(end));
    ui.loopSlider.style.setProperty("--loop-start", `${loopPercent(start)}%`);
    ui.loopSlider.style.setProperty("--loop-end", `${loopPercent(end)}%`);
    ui.setA.textContent = Number.isFinite(loopState.startMs)
      ? `Set A  ${formatLoopTime(loopState.startMs)}`
      : "Set A";
    ui.setB.textContent = Number.isFinite(loopState.endMs)
      ? `Set B  ${formatLoopTime(loopState.endMs)}`
      : "Set B";
    ui.setA.disabled = !loopState.available;
    ui.setB.disabled = !loopState.available;
    ui.clearLoop.disabled = !loopState.active && !Number.isFinite(loopState.startMs);
    for (const [input, value] of [[ui.loopStartTime, loopState.startMs], [ui.loopEndTime, loopState.endMs]]) {
      input.disabled = !loopState.available || duration <= 0;
      if (ui.root.activeElement !== input) input.value = Number.isFinite(value) ? formatLoopTime(value) : "";
    }
  }

  function setLoopPoint(marker) {
    const liveState = requestLoop("state")?.state;
    const current = liveState?.currentTimeMs;
    if (liveState) {
      loopState = { ...(liveState.loop || loopState), available: liveState.available === true, currentTimeMs: current, durationMs: liveState.loop?.durationMs || liveState.durationMs };
    }
    if (!Number.isFinite(current)) return;
    const payload = {
      marker,
      startMs: marker === "start" ? current : loopState.startMs,
      endMs: marker === "end" ? current : loopState.endMs,
      enabled: true,
      startPlayback: true,
    };
    setLoopFailure(requestLoop("set-loop", payload));
    readLoopState();
  }

  function setLoopFromSliders(marker) {
    const activatesLoop = !loopState.active;
    setLoopFailure(requestLoop("set-loop", {
      marker,
      startMs: ui.loopStart.valueAsNumber,
      endMs: ui.loopEnd.valueAsNumber,
      enabled: true,
      startPlayback: activatesLoop,
    }));
    readLoopState();
  }

  function commitLoopTime(marker) {
    const input = marker === "start" ? ui.loopStartTime : ui.loopEndTime;
    const value = parseLoopTime(input.value);
    const duration = loopState.durationMs;
    if (!Number.isFinite(value) || !Number.isFinite(duration) || value < 0 || value > duration) {
      loopFailure = "Enter a time between 00:00.000 and the track duration.";
      render();
      return;
    }
    const startMs = marker === "start" ? value : loopState.startMs;
    const endMs = marker === "end" ? value : loopState.endMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < 250) {
      loopFailure = "Loop end must be at least 250 ms after its start.";
      render();
      return;
    }
    setLoopFailure(requestLoop("set-loop", { marker, startMs, endMs, enabled: true, startPlayback: !loopState.active }));
    readLoopState();
  }

  function clearLoop() {
    setLoopFailure(requestLoop("clear-loop"));
    readLoopState();
  }

  async function downloadLoopFromPlayer() {
    if (!loopState.active || !Number.isFinite(loopState.startMs) || !Number.isFinite(loopState.endMs)) {
      loopFailure = "Set both loop markers before downloading.";
      render();
      return;
    }
    const id = `loop-export-${Date.now()}`;
    ui.downloadLoop.disabled = true;
    loopFailure = "Preparing loop download…";
    render();
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: "Download request timed out." }), 120000);
      const listener = (event) => {
        if (event.detail?.id !== id) return;
        clearTimeout(timeout);
        document.removeEventListener(LOOP_EXPORT_RESULT_EVENT, listener);
        resolve(event.detail);
      };
      document.addEventListener(LOOP_EXPORT_RESULT_EVENT, listener);
      document.documentElement.setAttribute(LOOP_EXPORT_ATTRIBUTE, JSON.stringify({
        id,
        trackIdentity: loopState.trackIdentity,
        generation: loopState.generation,
        trimRange: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs },
        playbackTransform: { rate: controller.snapshot().effectiveRate, preservePitch: controller.snapshot().preservePitch },
      }));
      document.dispatchEvent(new CustomEvent(LOOP_EXPORT_EVENT));
    });
    document.documentElement.removeAttribute(LOOP_EXPORT_ATTRIBUTE);
    ui.downloadLoop.disabled = false;
    loopFailure = result?.success ? "Loop download started." : (result?.error || "Could not start loop download.");
    render();
  }

  function syncRange(input) {
    const minimum = Number(input.min) || 0;
    const span = Number(input.max) - minimum;
    const value = span > 0 ? (input.valueAsNumber - minimum) / span : 0;
    const fill = `${Math.max(0, Math.min(1, value || 0)) * 100}%`;
    input.style.setProperty("--range-fill", fill);
  }

  function template() {
    return `
      <style>
        :host {
          color: #fff;
          font: 12px/1.4 Interstate, Lucida Grande, Arial, sans-serif;
        }

        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }

        .trigger {
          width: 64px;
          height: 34px;
          margin: 0;
          margin-left: 6px;
          padding: 0;
          border: 0;
          color: #fff;
          background: transparent;
          font: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .trigger:hover { color: #abababff; }
        .trigger-icon {
          display: block;
          flex: 0 0 24px;
          width: 24px;
          height: 24px;
          fill: currentColor;
        }

        .trigger-rate {
          flex: 0 0 4ch;
          width: 4ch;
          font-variant-numeric: tabular-nums;
          margin-left: 2px;
          color: #ff6c23ff;
          font-size: 11px;
          font-weight: 600;
          line-height: 1;
          position:relative;
          transform: translateY(5px);
        }
        .trigger:focus-visible,
        input:focus-visible {
          outline: 2px solid #ff5500;
          outline-offset: 2px;
        }

        .panel {
          position: fixed;
          z-index: 2147483647;
          width: min(420px, calc(100vw - 16px));
          padding: 9px 8.5px 10px;
          border: 1px solid #444;
          border-radius: 7px;
          color: #eee;
          background: #202020;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
          transform-origin: bottom right;
        }

        .panel:not([hidden]) {
          animation: tempo-panel-enter 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes tempo-panel-enter {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .panel-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 18px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }

        .brand-logo {
          width: 48px;
          height: 48px;
          flex: 0 0 48px;
          border-radius: 10px;
          object-fit: contain;
        }

        .brand-name {
          margin: 0;
          padding: 0;
          border: 0;
          color: #fff;
          background: transparent;
          font: 700 17px/1.2 Interstate, Lucida Grande, Arial, sans-serif;
          text-align: left;
          text-decoration: none;
          cursor: pointer;
          transition: color 160ms ease;
        }

        .brand-name:hover { color: #d0d0d0; }
        .brand-name:focus-visible,
        .preset:focus-visible {
          outline: 2px solid #ff5500;
          outline-offset: 3px;
        }

        .presets {
          display: grid;
          grid-template-columns: repeat(3, 44px);
          gap: 5px;
          flex: 0 0 auto;
        }

        .preset {
          height: 30px;
          padding: 0;
          border: 1px solid #484848;
          border-radius: 5px;
          background: #292929;
          color: #ff6c23;
          font: 500 13px/1 Interstate, Lucida Grande, Arial, sans-serif;
          cursor: pointer;
          transition: background 160ms ease, border-color 160ms ease;
        }

        .preset:hover { background: #383838; border-color: #777; }
        .preset[aria-pressed="true"] { border-color: #ff5500; background: #42291d; }

        .title {
          margin: 0 0 22px;
          font-size: 14px;
          font-weight: 700;
        }

        .pitch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .slider-wrap {
          position: relative;
          height: 28px;
          margin: 0 0 8px;
        }

        .limits {
          position: absolute;
          z-index: 1;
          top: 50%;
          right: 4px;
          left: 4px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: #eee;
          font-size: 9px;
          font-weight: 600;
          line-height: 1;
          pointer-events: none;
          transform: translateY(-50%);
        }

        .slider {
          appearance: none;
          -webkit-appearance: none;
          display: block;
          width: 100%;
          height: 28px;
          margin: 0;
          border: 0;
          background: linear-gradient(
              to right,
              #ff5500 var(--range-fill, 0%),
              #3b3b3b var(--range-fill, 0%)
            ) center / 100% 8px no-repeat;
          cursor: pointer;
        }

        .slider::-webkit-slider-runnable-track {
          height: 8px;
          background: transparent;
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 19px;
          height: 19px;
          margin-top: -5.5px;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #ff5500;
        }

        .slider::-moz-range-track { height: 8px; background: #3b3b3b; }
        .slider::-moz-range-progress { height: 8px; background: #ff5500; }
        .slider::-moz-range-thumb {
          width: 15px;
          height: 15px;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #ff5500;
        }

        .bypass {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: 0;
          background: transparent;
          color: #ef5350;
          cursor: pointer;
          transition: color 160ms ease;
        }
        .bypass[aria-pressed="true"] { color: #ccc; }
        .bypass:hover { filter: brightness(1.15); }
        .bypass:focus-visible { outline: 2px solid #ff5500; outline-offset: 2px; }
        .speed-status { display: flex; align-items: center; gap: 6px; }
        .bypass svg { width: 20px; height: 20px; animation: heart-float 3s ease-in-out infinite; }
        @keyframes heart-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .pitch-label {
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font: 500 15px/1.2 Interstate, Lucida Grande, Arial, sans-serif;
        }

        .pitch-toggle {
          width: 18px;
          height: 18px;
          margin: 0;
          accent-color: #ff5500;
        }

        .current {
          width: 6ch;
          flex: 0 0 6ch;
          text-align: right;
          font-variant-numeric: tabular-nums;
          color: #ff5500;
          font-size: 16px;
          font-weight: 700;
        }

        .status {
          margin: 12px 0 0;
          color: #ffb199;
          font-size: 11px;
        }

        /* The player panel intentionally mirrors the compact one-screen layout. */
        .panel { width: min(420px, calc(100vw - 16px)); padding: 10px; border: 3px solid #080808; border-radius: 11px; }
        .panel-header { align-items: center; gap: 8px; margin-bottom: 8px; }
        .presets { order: -1; grid-template-columns: repeat(4, 36px); gap: 5px; flex-basis: 159px; }
        .preset { width: 36px; height: 28px; padding: 0; }
        .custom-preset { color: #ff3651; font-size: 16px; font-weight: 800; }
        .custom-preset[data-saved="true"] { color: #ff6c23; font-size: 10px; }
        .brand { gap: 7px; }
        .brand-logo { width: 58px; height: 58px; flex-basis: 58px; border-radius: 12px; transition: filter 180ms ease, opacity 180ms ease; }
        .brand-logo.is-bypassed { filter: grayscale(1); opacity: .58; }
        .brand-copy { min-width: 0; }
        .brand-name { font-size: 17px; white-space: nowrap; }
        .rating-link { display: block; margin-top: 3px; color: #fff; font-size: 9px; font-style: italic; font-weight: 600; text-decoration: underline; white-space: nowrap; }
        .rating-link:hover { color: #ffb18a; }
        .middle-row { display: grid; grid-template-columns: 159px 1fr; align-items: center; gap: 10px; margin-bottom: 6px; }
        .setters { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
        .setter { min-width: 0; height: 30px; padding: 0 5px; border: 1px solid #484848; border-radius: 6px; background: #292929; color: #fff; font: italic 600 10px/1 Interstate, Lucida Grande, Arial, sans-serif; cursor: pointer; white-space: nowrap; }
        .setter:hover:not(:disabled) { background: #383838; border-color: #777; }
        .setter:disabled { cursor: not-allowed; opacity: .48; }
        .pitch-row { gap: 6px; }
        .pitch-label { gap: 7px; font-size: 13px; white-space: nowrap; }
        .pitch-toggle { width: 17px; height: 17px; }
        .speed-status { margin-left: auto; gap: 4px; }
        .current { font-size: 15px; }
        .bypass { width: 26px; height: 26px; }
        .bypass svg { width: 21px; height: 21px; }
        .slider-wrap { height: 26px; margin: 0 0 5px; }
        .slider { height: 26px; background-size: 100% 10px; }
        .slider::-webkit-slider-runnable-track { height: 10px; }
        .slider::-moz-range-track, .slider::-moz-range-progress { height: 10px; }
        .range-label { position: absolute; z-index: 2; inset: 50% auto auto 50%; padding: 0 5px; color: #ddd; background: #3b3b3b; font-size: 9px; font-style: italic; font-weight: 700; line-height: 12px; pointer-events: none; transform: translate(-50%, -50%); }
        .loop-slider { position: relative; height: 28px; margin-top: 1px; background: linear-gradient(to right, #3b3b3b 0 var(--loop-start, 0%), #ff5500 var(--loop-start, 0%) var(--loop-end, 100%), #3b3b3b var(--loop-end, 100%) 100%) center / 100% 10px no-repeat; }
        .loop-range { appearance: none; -webkit-appearance: none; position: absolute; inset: 0; width: 100%; height: 28px; margin: 0; border: 0; background: transparent; pointer-events: none; }
        .loop-range::-webkit-slider-runnable-track { height: 10px; background: transparent; }
        .loop-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 19px; height: 19px; margin-top: -5px; border: 2px solid #fff; border-radius: 50%; background: #ff5500; pointer-events: auto; cursor: ew-resize; }
        .loop-range::-moz-range-track { height: 10px; background: transparent; }
        .loop-range::-moz-range-thumb { width: 15px; height: 15px; border: 2px solid #fff; border-radius: 50%; background: #ff5500; pointer-events: auto; cursor: ew-resize; }
        .loop-range:disabled::-webkit-slider-thumb { opacity: .45; cursor: not-allowed; }
        .loop-edit { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 5px; margin-top: 4px; }
        .loop-time { min-width: 0; height: 26px; padding: 0 6px; border: 1px solid #484848; border-radius: 5px; color: #fff; background: #292929; font: 11px/1 monospace; }
        .clear-loop { height: 26px; border: 1px solid #484848; border-radius: 5px; color: #fff; background: #292929; cursor: pointer; font: 600 10px/1 Interstate, Arial, sans-serif; }
        .download-loop { height: 26px; border: 1px solid #b84400; border-radius: 5px; color: #fff; background: #ff5500; cursor: pointer; font: 600 10px/1 Interstate, Arial, sans-serif; }
        .status { margin-top: 5px; }

        @media (forced-colors: active) {
          .trigger, .panel { border-color: CanvasText; }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation: none !important;
            transition: none !important;
          }
        }
      </style>
      <button
        class="trigger"
        type="button"
        aria-label="Playback speed 1x"
        aria-haspopup="dialog"
        aria-expanded="false"
      >${SPEED_METER_ICON}<span class="trigger-rate">1x</span></button>
      <section
        class="panel"
        role="dialog"
        aria-label="Playback speed and loop"
        hidden
      >
        <div class="panel-header">
        <div class="presets" role="group" aria-label="Quick playback speeds">
          ${[1, 2, 3].map((rate) => `<button class="preset" type="button" data-rate="${rate}" aria-pressed="false">${rate}x</button>`).join("")}
          ${customRates.slice(0, 1).map((rate, index) => `<button class="preset custom-preset" type="button" data-custom-index="${index}" data-saved="${rate !== null}" aria-pressed="false" title="${rate === null ? "Hold to save the current speed" : `Saved speed ${formatRate(rate)}. Hold to replace`}">${rate === null ? "X" : formatRate(rate)}</button>`).join("")}
          ${[0.5, 1.5, 2.5].map((rate) => `<button class="preset" type="button" data-rate="${rate}" aria-pressed="false">${rate}x</button>`).join("")}
          ${customRates.slice(1, 2).map((rate, offset) => { const index = offset + 1; return `<button class="preset custom-preset" type="button" data-custom-index="${index}" data-saved="${rate !== null}" aria-pressed="false" title="${rate === null ? "Hold to save the current speed" : `Saved speed ${formatRate(rate)}. Hold to replace`}">${rate === null ? "X" : formatRate(rate)}</button>`; }).join("")}
        </div>
        <div class="brand">
          <img class="brand-logo" width="58" height="58" alt="" hidden />
          <div class="brand-copy">
            <button class="brand-name" type="button" aria-label="Open the Looper guide">SoundCloud Track <br />Downloader</button>
            <a class="rating-link" href="${REVIEW_URL}" target="_blank" rel="noopener noreferrer">Please consider rating the app!</a>
          </div>
        </div>
        </div>
        <div class="middle-row">
          <div class="setters">
            <button class="setter set-a" type="button">Set A</button>
            <button class="setter set-b" type="button">Set B</button>
          </div>
          <div class="pitch-row">
            <label class="pitch-label"><input class="pitch-toggle" type="checkbox" />Keep Tone</label>
            <div class="speed-status">
              <output class="current">1x</output>
              <button class="bypass" type="button" aria-label="Bypass loop and playback effects" aria-pressed="false" title="Bypass loop and playback effects">${BYPASS_ICON}</button>
            </div>
          </div>
        </div>
        <div class="slider-wrap">
          <div class="limits" aria-hidden="true"><span>0.1x</span><span>4x</span></div>
          <span class="range-label" aria-hidden="true">Tone &amp; Velocity</span>
          <input
            class="slider"
            type="range"
            min="0.1"
            max="4"
            step="${DEFAULTS.step}"
            value="1"
            aria-label="Playback speed"
          />
        </div>
        <div class="loop-slider" role="group" aria-label="Loop range">
          <span class="range-label" aria-hidden="true">Loop</span>
          <input class="loop-range loop-start" type="range" min="0" max="1" step="1" value="0" aria-label="Loop start A" />
          <input class="loop-range loop-end" type="range" min="0" max="1" step="1" value="1" aria-label="Loop end B" />
        </div>
        <div class="loop-edit">
          <input class="loop-time loop-start-time" inputmode="decimal" placeholder="A 00:00.000" aria-label="Loop start time" />
          <input class="loop-time loop-end-time" inputmode="decimal" placeholder="B 00:00.000" aria-label="Loop end time" />
          <button class="clear-loop" type="button" aria-label="Clear loop">Clear</button>
          <button class="download-loop" type="button" aria-label="Download loop">WAV</button>
        </div>
        <p class="status" role="status" aria-live="polite" hidden></p>
      </section>
    `;
  }

  function positionPanel() {
    if (!ui || ui.panel.hidden) return;
    const anchor = ui.trigger.getBoundingClientRect();
    const width = Math.min(420, innerWidth - 16);
    const left = Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width));
    ui.panel.style.left = `${left}px`;
    ui.panel.style.bottom = `${Math.max(8, innerHeight - anchor.top + 8)}px`;
  }

  function setPanelOpen(open) {
    if (!ui) return;
    ui.panel.hidden = !open;
    ui.trigger.setAttribute("aria-expanded", String(open));
    if (open) positionPanel();
  }

  function isPlayerTimelineInteraction(event) {
    return event.composedPath().some(
      (node) =>
        typeof node?.matches === "function" &&
        node.matches(PLAYER_TIMELINE_SELECTOR)
    );
  }

  function createUi() {
    const host = document.createElement("span");
    host.id = HOST_ID;
    host.style.cssText = [
      "display:flex",
      "align-items:center",
      "flex:0 0 auto",
      "height:100%",
      "margin-left:8px",
    ].join(";");

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = template();
    ui = {
      host,
      root,
      trigger: root.querySelector(".trigger"),
      panel: root.querySelector(".panel"),
      slider: root.querySelector(".slider"),
      pitchToggle: root.querySelector(".pitch-toggle"),
      current: root.querySelector(".current"),
      triggerRate: root.querySelector(".trigger-rate"),
      bypass: root.querySelector(".bypass"),
      status: root.querySelector(".status"),
      brandLogo: root.querySelector(".brand-logo"),
      brandName: root.querySelector(".brand-name"),
      setA: root.querySelector(".set-a"),
      setB: root.querySelector(".set-b"),
      loopSlider: root.querySelector(".loop-slider"),
      loopStart: root.querySelector(".loop-start"),
      loopEnd: root.querySelector(".loop-end"),
      loopStartTime: root.querySelector(".loop-start-time"),
      loopEndTime: root.querySelector(".loop-end-time"),
      clearLoop: root.querySelector(".clear-loop"),
      downloadLoop: root.querySelector(".download-loop"),
    };

    ui.trigger.addEventListener("click", () => {
      setPanelOpen(ui.panel.hidden);
    });
    ui.brandName.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });
    root.querySelectorAll(".preset").forEach((button) => {
      if (button.classList.contains("custom-preset")) return;
      button.addEventListener("click", () => {
        playbackFailure = "";
        animateNextRateChange = true;
        const state = controller.setRate(Number(button.dataset.rate));
        writeSetting(RATE_STORAGE, state.rate);
      });
    });
    root.querySelectorAll(".custom-preset").forEach((button) => {
      const index = Number(button.dataset.customIndex);
      let timer = null;
      let longPressed = false;
      const cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        longPressed = false;
        cancel();
        timer = setTimeout(() => {
          timer = null;
          longPressed = true;
          customRates[index] = controller.snapshot().rate;
          writeSetting(CUSTOM_RATE_STORAGE[index], customRates[index]);
          render();
        }, LONG_PRESS_MS);
      });
      for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
        button.addEventListener(eventName, cancel);
      }
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.repeat || timer !== null) return;
        event.preventDefault();
        longPressed = false;
        timer = setTimeout(() => { timer = null; longPressed = true; customRates[index] = controller.snapshot().rate; writeSetting(CUSTOM_RATE_STORAGE[index], customRates[index]); render(); }, LONG_PRESS_MS);
      });
      button.addEventListener("keyup", (event) => { if (event.key === "Enter" || event.key === " ") cancel(); });
      button.addEventListener("blur", cancel);
      button.addEventListener("click", (event) => {
        if (longPressed) {
          event.preventDefault();
          longPressed = false;
          return;
        }
        if (!Number.isFinite(customRates[index])) return;
        playbackFailure = "";
        animateNextRateChange = true;
        const state = controller.setRate(customRates[index]);
        writeSetting(RATE_STORAGE, state.rate);
      });
    });
    ui.slider.addEventListener("input", () => {
      playbackFailure = "";
      const state = controller.setRate(ui.slider.valueAsNumber);
      writeSetting(RATE_STORAGE, state.rate);
    });
    ui.slider.addEventListener("dblclick", () => {
      playbackFailure = "";
      animateNextRateChange = true;
      const state = controller.setRate(DEFAULTS.rate);
      writeSetting(RATE_STORAGE, state.rate);
    });
    ui.pitchToggle.addEventListener("change", () => {
      playbackFailure = "";
      const state = controller.setPreservePitch(ui.pitchToggle.checked);
      writeSetting(PITCH_STORAGE, state.preservePitch);
    });
    ui.bypass.addEventListener("click", () => {
      playbackFailure = "";
      animateNextRateChange = true;
      const bypassed = !controller.snapshot().bypassed;
      controller.setBypassed(bypassed);
      requestLoop("set-global-bypass", { bypassed });
      readLoopState();
    });
    ui.setA.addEventListener("click", () => setLoopPoint("start"));
    ui.setB.addEventListener("click", () => setLoopPoint("end"));
    ui.loopStart.addEventListener("input", () => setLoopFromSliders("start"));
    ui.loopEnd.addEventListener("input", () => setLoopFromSliders("end"));
    for (const [input, marker] of [[ui.loopStartTime, "start"], [ui.loopEndTime, "end"]]) {
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commitLoopTime(marker); input.blur(); } if (event.key === "Escape") { input.value = Number.isFinite(loopState[`${marker}Ms`]) ? formatLoopTime(loopState[`${marker}Ms`]) : ""; input.blur(); } });
      input.addEventListener("blur", () => { if (input.value.trim()) commitLoopTime(marker); });
    }
    ui.clearLoop.addEventListener("click", clearLoop);
    ui.downloadLoop.addEventListener("click", downloadLoopFromPlayer);

    render();
    syncBrandLogo();
    readLoopState();
    return host;
  }

  function render() {
    if (!ui) return;
    const state = controller.snapshot();
    const text = formatRate(state.effectiveRate);
    const triggerText = formatTriggerRate(state.effectiveRate);
    const animateRate = animateNextRateChange;
    animateNextRateChange = false;
    ui.trigger.setAttribute("aria-label", `Playback speed ${triggerText}`);
    ui.slider.value = String(state.rate);
    ui.slider.setAttribute("aria-valuetext", formatRate(state.rate));
    ui.bypass.setAttribute("aria-pressed", String(state.bypassed));
    ui.bypass.title = state.bypassed
      ? "Bypass on — restore loop, speed and tone"
      : "Bypass loop, speed and tone";
    ui.bypass.setAttribute("aria-label", ui.bypass.title);
    ui.brandLogo.classList.toggle("is-bypassed", state.bypassed);
    ui.root.querySelectorAll(".preset").forEach((button) => {
      const customIndex = Number(button.dataset.customIndex);
      const buttonRate = Number.isInteger(customIndex)
        ? customRates[customIndex]
        : Number(button.dataset.rate);
      button.setAttribute("aria-pressed", String(buttonRate === state.rate));
    });
    ui.root.querySelectorAll(".custom-preset").forEach((button) => {
      const index = Number(button.dataset.customIndex);
      const value = customRates[index];
      button.dataset.saved = String(Number.isFinite(value));
      button.textContent = Number.isFinite(value) ? formatRate(value) : "X";
      button.title = Number.isFinite(value)
        ? `Saved speed ${formatRate(value)}. Hold to replace`
        : "Hold to save the current speed";
    });
    syncRange(ui.slider);
    ui.pitchToggle.checked = state.preservePitch;
    ui.pitchToggle.disabled = !state.preservePitchSupported;
    renderRate(state.effectiveRate, animateRate);
    ui.host.setAttribute(RATE_ATTRIBUTE, String(state.effectiveRate));
    ui.host.setAttribute(PITCH_ATTRIBUTE, String(state.preservePitch));
    const message = playbackFailure || storageFailure || loopFailure;
    ui.status.textContent = message;
    ui.status.hidden = !message;
    renderLoop();
  }

  function mount() {
    const player = document.querySelector(PLAYER_SELECTOR);
    if (!player) {
      ui?.host.remove();
      setPanelOpen(false);
      return;
    }

    const host = ui?.host || createUi();
    const downloadButton = player.querySelector(DOWNLOAD_BUTTON_SELECTOR);
    if (downloadButton) {
      if (downloadButton.nextElementSibling !== host) {
        downloadButton.insertAdjacentElement("afterend", host);
      }
      return;
    }

    if (host.parentElement !== player) {
      const soundBadge = player.querySelector(".playControls__soundBadge");
      if (soundBadge) soundBadge.insertAdjacentElement("afterend", host);
      else player.appendChild(host);
    }
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => {
      mountQueued = false;
      mount();
    });
  }

  controller.install();
  document.querySelectorAll("audio").forEach(controller.discover);
  for (const event of ["play", "loadedmetadata"]) {
    document.addEventListener(
      event,
      (mediaEvent) => controller.apply(mediaEvent.target),
      true
    );
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLAudioElement) controller.discover(node);
        else node.querySelectorAll("audio").forEach(controller.discover);
      }
    }
    scheduleMount();
  }).observe(document, { childList: true, subtree: true });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        ui &&
        !ui.panel.hidden &&
        !event.composedPath().includes(ui.host) &&
        !isPlayerTimelineInteraction(event)
      ) {
        setPanelOpen(false);
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && ui && !ui.panel.hidden) {
        document.documentElement?.setAttribute("data-scdl-tempo-panel-escape", "true");
        setTimeout(() => document.documentElement?.removeAttribute("data-scdl-tempo-panel-escape"), 0);
        setPanelOpen(false);
        ui.trigger.focus();
      }
    },
    true
  );
  window.addEventListener("resize", positionPanel);
  window.addEventListener("storage", (event) => {
    if (event.key === RATE_STORAGE) controller.setRate(readStoredRate());
    if (event.key === PITCH_STORAGE) {
      controller.setPreservePitch(readStoredPitch());
    }
  });
  document.addEventListener(LOOP_SESSION_EVENT, readLoopState);
  loopPollInterval = setInterval(readLoopState, 250);

  mount();
  render();
})();
