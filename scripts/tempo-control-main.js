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
  const RATE_STORAGE = "scdl.tempo.rate";
  const PITCH_STORAGE = "scdl.tempo.preservePitch";
  const DEFAULT_SAVED_RATES = [0.5, 1, 1.5, 2];
  const CUSTOM_RATE_STORAGE = DEFAULT_SAVED_RATES.map(
    (_, index) => `scdl.tempo.savedRate.${index + 1}`
  );
  const DETACH_STORAGE = "scdl.tempo.panelDetached";
  const WAVEFORM_COLLAPSED_STORAGE = "scdl.tempo.waveformCollapsed";
  const RATE_ATTRIBUTE = "data-scdl-tempo-rate";
  const PITCH_ATTRIBUTE = "data-scdl-tempo-preserve-pitch";
  const EXTENSION_LOGO_ATTRIBUTE = "data-scdl-extension-logo-url";
  const EXTENSION_PLAYER_ICON_ATTRIBUTE = "data-scdl-extension-player-icon-url";
  const EXTENSION_ASSETS_EVENT = "scdl:extension-assets-ready";
  const OPEN_LOOPER_GUIDE_EVENT = "scdl:open-looper-guide";
  const OPEN_PLAYER_TOOLS_PANEL_EVENT = "scdl:open-player-tools-panel";
  const REVIEW_URL = "https://chrome.google.com/webstore/detail/ekmbbjdpakacalghjkikfppebgdpoebb/reviews";
  const LOOP_COMMAND_EVENT = "scdl-looper:command";
  const LOOP_COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const LOOP_RESPONSE_ATTRIBUTE = "data-scdl-looper-response";
  const LOOP_SESSION_EVENT = "scdl-loop-session:changed";
  const LOOP_EXPORT_EVENT = "scdl:download-loop";
  const LOOP_EXPORT_RESULT_EVENT = "scdl:download-loop-result";
  const LOOP_EXPORT_ATTRIBUTE = "data-scdl-loop-export-request";
  const TRACK_EXPORT_EVENT = "scdl:download-current-track";
  const TRACK_EXPORT_RESULT_EVENT = "scdl:download-current-track-result";
  const TRACK_EXPORT_ATTRIBUTE = "data-scdl-track-export-request";
  const PLAYER_WAVEFORM_ATTRIBUTE = "data-scdl-player-waveform";
  const PLAYER_WAVEFORM_EVENT = "scdl:player-waveform-ready";
  const ACCESS_ATTRIBUTE = "data-scdl-player-tools-access";
  const ACCESS_EVENT = "scdl:player-tools-access-changed";
  const ACCESS_REQUEST_ATTRIBUTE = "data-scdl-player-tools-request";
  const ACCESS_RESPONSE_ATTRIBUTE = "data-scdl-player-tools-response";
  const ACCESS_REQUEST_EVENT = "scdl:player-tools-request";
  const ACCESS_RESPONSE_EVENT = "scdl:player-tools-response";
  const VOLUME_LAYER_ATTRIBUTE = "data-scdl-tempo-panel-open";
  const VOLUME_LAYER_STYLE_ID = "scdl-tempo-volume-layer";
  const LONG_PRESS_MS = 650;
  const HOVER_OPEN_DELAY_MS = 254;
  // The panel sits eight pixels above its trigger. This brief grace period
  // keeps a hover-opened panel available while the cursor crosses that gap.
  const HOVER_CLOSE_DELAY_MS = 80;
  const PLAYER_TIMELINE_SELECTOR = [
    ".playbackTimeline",
    ".playbackTimeline__progressWrapper",
    ".playbackTimeline__progressBackground",
    ".playbackTimeline__progressHandle",
    ".playbackTimeline__progressContainer",
  ].join(",");
  // Inline copy of assets/icons/bypass.svg for the MAIN-world shadow UI.
  const BYPASS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17.2C22 19.85 19.85 22 17.2 22C15.78 22 14.51 21.38 13.63 20.4C12.87 19.55 12.4 18.43 12.4 17.2C12.4 14.55 14.55 12.4 17.2 12.4C18.57 12.4 19.81 12.98 20.69 13.91C20.68 13.91 20.68 13.91 20.69 13.92C21.5 14.78 22 15.93 22 17.2Z"/><path d="M18.48 18.54L15.95 16M18.45 16.03L15.92 18.57"/><path d="M22 8.69C22 10.66 21.49 12.4 20.69 13.91C19.81 12.98 18.57 12.4 17.2 12.4C14.55 12.4 12.4 14.55 12.4 17.2C12.4 18.43 12.87 19.55 13.63 20.4C13.26 20.57 12.92 20.71 12.62 20.81C12.28 20.93 11.72 20.93 11.38 20.81C8.48 19.82 2 15.69 2 8.69C2 5.6 4.49 3.09998 7.56 3.09998C9.37 3.09998 10.99 3.98002 12 5.33002C13.01 3.98002 14.63 3.09998 16.44 3.09998C19.51 3.09998 22 5.6 22 8.69Z"/></svg>`;
  // Inline copy of assets/icons/settings.svg so the tempo panel matches popup.html.
  const SETTINGS_ICON = `<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M502.325 307.303 463.319 276.498a25.82 25.82 0 0 1-9.668-20.348v-.252a25.88 25.88 0 0 1 9.667-20.396l39.007-30.806a25.89 25.89 0 0 0 7.737-29.701l-17.134-41.366a25.89 25.89 0 0 0-26.472-15.532l-49.366 5.8a25.9 25.9 0 0 1-21.258-7.586l-.354-.356a25.88 25.88 0 0 1-7.552-21.225l5.799-49.363a25.89 25.89 0 0 0-15.531-26.472L337.004 1.939a25.89 25.89 0 0 0-29.701 7.736L276.498 48.68a25.82 25.82 0 0 1-20.349 9.668h-.252a25.88 25.88 0 0 1-20.395-9.667L204.697 9.675a25.89 25.89 0 0 0-29.702-7.736L133.63 19.072a25.89 25.89 0 0 0-15.532 26.473l5.799 49.366a25.9 25.9 0 0 1-7.585 21.257l-.356.356a25.88 25.88 0 0 1-21.226 7.552l-49.363-5.799a25.89 25.89 0 0 0-26.472 15.531L1.939 174.996a25.89 25.89 0 0 0 7.736 29.701l39.006 30.805a25.82 25.82 0 0 1 9.668 20.348v.251a25.88 25.88 0 0 1-9.667 20.395L9.675 307.303a25.89 25.89 0 0 0-7.736 29.701l17.134 41.365a25.89 25.89 0 0 0 26.472 15.532l49.366-5.799a25.9 25.9 0 0 1 21.258 7.586l.356.356a25.88 25.88 0 0 1 7.552 21.226l-5.799 49.364a25.89 25.89 0 0 0 15.532 26.472l41.366 17.134a25.89 25.89 0 0 0 29.701-7.736l30.804-39.005a25.82 25.82 0 0 1 20.348-9.669h.251a25.88 25.88 0 0 1 20.396 9.667l30.806 39.007a25.89 25.89 0 0 0 29.701 7.736l41.366-17.134a25.89 25.89 0 0 0 15.532-26.472l-5.8-49.366a25.9 25.9 0 0 1 7.586-21.257l.356-.356a25.88 25.88 0 0 1 21.225-7.552l49.364 5.799a25.89 25.89 0 0 0 26.472-15.531l17.134-41.365a25.89 25.89 0 0 0-7.737-29.701ZM281.292 329.698a77.75 77.75 0 1 1-59.52-143.695 77.75 77.75 0 0 1 59.52 143.695Z"/></svg>`;
  if (window[INSTALLED_FLAG] || !globalThis.SCTempoControl) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const { DEFAULTS, clampRate, create, formatRate } = globalThis.SCTempoControl;
  const effectsApi = globalThis.SCTempoEffects;
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
  let trackDownloadPending = false;
  let loopState = { active: false, enabled: false, startMs: null, endMs: null, durationMs: null };
  let accessSnapshot = { state: "loading", plan: "free", capabilities: {} };
  let playerToolsSessionId = null;
  let accessRequestId = 0;
  let loopPollInterval = null;
  let waveformSamples = [];
  let waveformTrackUrl = null;
  let waveformSourceUrl = null;
  let waveformZoom = null;
  let waveformLoadId = 0;
  let waveformDrag = null;
  let setterHoldTimer = null;
  let setterLongPressed = false;
  let panelOpenMode = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  let panelDetached = (() => {
    try { return localStorage.getItem(DETACH_STORAGE) === "true"; } catch { return false; }
  })();
  let waveformCollapsed = (() => {
    try { return localStorage.getItem(WAVEFORM_COLLAPSED_STORAGE) === "true"; } catch { return false; }
  })();
  let effectsCollapsed = true;
  let effectsFailure = "";
  let effectsBypassed = false;
  const customRates = CUSTOM_RATE_STORAGE.map((key, index) => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? DEFAULT_SAVED_RATES[index] : clampRate(stored);
    } catch {
      return DEFAULT_SAVED_RATES[index];
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
    const logoUrl = document.documentElement.getAttribute(EXTENSION_LOGO_ATTRIBUTE);
    const playerIconUrl = document.documentElement.getAttribute(EXTENSION_PLAYER_ICON_ATTRIBUTE);
    if (logoUrl) {
      ui.brandLogo.src = logoUrl;
      ui.brandLogo.hidden = false;
    }
    if (!playerIconUrl) return;
    ui.triggerLogo.src = playerIconUrl;
    ui.triggerLogo.hidden = false;
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

  function readAccessSnapshot() {
    try {
      const value = JSON.parse(document.documentElement.getAttribute(ACCESS_ATTRIBUTE) || "null");
      if (value && typeof value === "object" && value.capabilities) accessSnapshot = value;
    } catch {}
    playerToolsSessionId = accessSnapshot?.grant?.sessionId || null;
  }

  function hasCapability(name) {
    return accessSnapshot?.plan === "pro" || accessSnapshot?.capabilities?.[name] === true;
  }

  function setProRequired(message = "Player Tools Pro is required for this control.") {
    playbackFailure = message;
    render();
  }

  function requestAccess(type, operation, payload = {}) {
    const root = document.documentElement;
    const id = `player-tools-${Date.now()}-${accessRequestId += 1}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        document.removeEventListener(ACCESS_RESPONSE_EVENT, listener);
        resolve({ success: false, code: "access-error" });
      }, 4_000);
      const listener = () => {
        let response;
        try { response = JSON.parse(root.getAttribute(ACCESS_RESPONSE_ATTRIBUTE) || "null"); } catch { response = null; }
        if (response?.id !== id) return;
        clearTimeout(timeout);
        document.removeEventListener(ACCESS_RESPONSE_EVENT, listener);
        if (response.snapshot) {
          accessSnapshot = response.snapshot;
          playerToolsSessionId = response.snapshot.grant?.sessionId || null;
        }
        resolve(response);
      };
      document.addEventListener(ACCESS_RESPONSE_EVENT, listener);
      root.setAttribute(ACCESS_REQUEST_ATTRIBUTE, JSON.stringify({
        id, type, operation, sessionId: playerToolsSessionId, payload,
      }));
      document.dispatchEvent(new CustomEvent(ACCESS_REQUEST_EVENT));
    });
  }

  async function authorizeControl(operation) {
    const result = await requestAccess("authorize", operation);
    if (!result?.allowed) {
      setProRequired(result?.code === "trial-exhausted"
        ? "Your Player Tools preview is complete. Unlock lifetime access to continue."
        : "Create an A–B loop to use this Player Tools control.");
      return false;
    }
    return true;
  }

  async function authorizeLoop(payload) {
    const completeRange = Number.isFinite(payload?.startMs) && Number.isFinite(payload?.endMs)
      && payload.endMs - payload.startMs >= 250;
    if (!completeRange) return true;
    const operation = loopState.active ? "edit-loop" : "begin-loop";
    const result = await requestAccess("authorize", operation, {
      trackIdentity: loopState.trackIdentity || null,
      generation: loopState.generation,
    });
    if (!result?.allowed) {
      setProRequired(result?.code === "trial-exhausted"
        ? "Your Player Tools preview is complete. Unlock lifetime access to make another loop."
        : "Player Tools Pro is required to edit this loop.");
      return false;
    }
    return true;
  }

  async function finishLoopSession() {
    if (!playerToolsSessionId || accessSnapshot?.plan === "pro") return;
    await requestAccess("end", "end-session").catch(() => {});
    playerToolsSessionId = null;
  }

  document.addEventListener(ACCESS_EVENT, () => {
    readAccessSnapshot();
    if (!hasCapability("tempo")) {
      controller.setRate(DEFAULTS.rate);
      controller.setPreservePitch(false);
    }
    render();
  });
  readAccessSnapshot();

  async function applyPlayerRate(rate, { animate = false } = {}) {
    if (!(await authorizeControl("set-rate"))) return;
    playbackFailure = "";
    animateNextRateChange = animate;
    const state = controller.setRate(rate);
    writeSetting(RATE_STORAGE, state.rate);
  }

  async function applyPlayerPitch(enabled) {
    if (!(await authorizeControl("set-preserve-pitch"))) {
      if (ui) ui.pitchToggle.checked = controller.snapshot().preservePitch;
      return;
    }
    playbackFailure = "";
    const state = controller.setPreservePitch(enabled);
    writeSetting(PITCH_STORAGE, state.preservePitch);
  }

  async function savePlayerPreset(index) {
    if (!(await authorizeControl("save-preset"))) return;
    customRates[index] = controller.snapshot().rate;
    writeSetting(CUSTOM_RATE_STORAGE[index], customRates[index]);
    render();
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

  const effectsController = effectsApi?.create({
    getActiveAudio() {
      const discovered = controller.getActiveAudio?.();
      if (discovered) return discovered;
      const players = [...document.querySelectorAll("audio")].filter(
        (audio) => audio.isConnected
      );
      const score = (audio) =>
        (audio.paused === false ? 100 : 0) +
        ((audio.currentSrc || audio.src) ? 20 : 0) +
        (audio.readyState >= 1 ? 10 : 0) +
        (Number.isFinite(audio.duration) ? 5 : 0);
      return players.sort((left, right) => score(right) - score(left))[0] || null;
    },
    onAvailabilityChange(available, error) {
      effectsFailure = available
        ? ""
        : (error?.message || "Audio effects are unavailable for this player.");
      if (error) console.warn("[SC Downloader Effects]", error);
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

  function visibleWaveformWindow() {
    const durationMs = loopState.durationMs;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    return globalThis.SCLooperCore?.normalizeZoomWindow?.(waveformZoom, durationMs) || { startMs: 0, endMs: durationMs };
  }

  function waveformTime(clientX) {
    const rect = ui.waveformStage.getBoundingClientRect();
    const window = visibleWaveformWindow();
    return window && globalThis.SCLooperCore?.positionToTime
      ? globalThis.SCLooperCore.positionToTime(clientX, rect.left, rect.width, window)
      : null;
  }

  function drawWaveform() {
    if (!ui?.waveformCanvas || waveformCollapsed) return;
    const canvas = ui.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0e1216";
    context.fillRect(0, 0, width, height);
    const windowRange = visibleWaveformWindow();
    if (!windowRange) return;
    const durationMs = loopState.durationMs;
    const samples = waveformSamples.length ? waveformSamples : Array.from({ length: 180 }, (_, index) => 22 + Math.abs(Math.sin(index * 1.73) * 58 + Math.sin(index * .29) * 18));
    const first = Math.floor(windowRange.startMs / durationMs * samples.length);
    const last = Math.max(first + 1, Math.ceil(windowRange.endMs / durationMs * samples.length));
    const visible = samples.slice(first, last);
    const maximum = Math.max(1, ...visible.map((sample) => Math.abs(Number(sample) || 0)));
    const complete = Number.isFinite(loopState.startMs) && Number.isFinite(loopState.endMs);
    const start = complete ? loopPercentInWindow(loopState.startMs, windowRange) : -1;
    const end = complete ? loopPercentInWindow(loopState.endMs, windowRange) : -1;
    const barWidth = width / visible.length;
    for (let index = 0; index < visible.length; index += 1) {
      const percent = index / Math.max(1, visible.length - 1) * 100;
      const barHeight = Math.max(2 * scale, Math.abs(Number(visible[index]) || 0) / maximum * (height * .72));
      context.fillStyle = complete && percent >= start && percent <= end ? "#ff741f" : "#858d96";
      context.globalAlpha = complete && (percent < start || percent > end) ? .55 : .92;
      context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(1, barWidth - scale), barHeight);
    }
    context.globalAlpha = 1;
    if (complete) { context.fillStyle = "rgba(255, 106, 26, .18)"; context.fillRect(width * start / 100, 0, width * (end - start) / 100, height); }
    if (Number.isFinite(loopState.currentTimeMs)) {
      const playhead = loopPercentInWindow(loopState.currentTimeMs, windowRange);
      if (playhead >= 0 && playhead <= 100) { context.fillStyle = "rgba(255,255,255,.72)"; context.fillRect(width * playhead / 100, 0, Math.max(1, scale), height); }
    }
  }

  function loopPercentInWindow(value, windowRange = visibleWaveformWindow()) {
    if (!windowRange || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, (value - windowRange.startMs) / (windowRange.endMs - windowRange.startMs) * 100));
  }

  async function loadPlayerWaveform() {
    if (waveformCollapsed) return;
    let descriptor = null;
    try { descriptor = JSON.parse(document.documentElement.getAttribute(PLAYER_WAVEFORM_ATTRIBUTE) || "null"); } catch {}
    if (!descriptor || (descriptor.trackUrl === waveformTrackUrl && descriptor.waveformUrl === waveformSourceUrl && !Array.isArray(descriptor.samples))) return;
    waveformTrackUrl = descriptor.trackUrl;
    waveformSourceUrl = descriptor.waveformUrl || null;
    waveformZoom = null;
    waveformSamples = [];
    const loadId = waveformLoadId += 1;
    if (Array.isArray(descriptor.samples)) { waveformSamples = descriptor.samples; drawWaveform(); return; }
    if (!descriptor.waveformUrl) { drawWaveform(); return; }
    try {
      const response = await fetch(descriptor.waveformUrl);
      const data = await response.json();
      if (loadId !== waveformLoadId) return;
      waveformSamples = Array.isArray(data.samples) ? data.samples : [];
    } catch { waveformSamples = []; }
    drawWaveform();
  }

  function renderLoop() {
    if (!ui?.waveformStage) return;
    ui.waveformShell.classList.toggle("is-collapsed", waveformCollapsed);
    ui.waveformToggle.setAttribute("aria-expanded", String(!waveformCollapsed));
    ui.waveformToggle.setAttribute(
      "aria-label",
      waveformCollapsed ? "Expand looper" : "Minimize looper"
    );
    ui.waveformToggle.title = ui.waveformToggle.getAttribute("aria-label");
    const duration = Number.isFinite(loopState.durationMs) ? loopState.durationMs : 0;
    const start = Number.isFinite(loopState.startMs) ? loopState.startMs : 0;
    const end = Number.isFinite(loopState.endMs) ? loopState.endMs : duration;
    const windowRange = visibleWaveformWindow();
    const startPercent = loopPercentInWindow(start, windowRange);
    const endPercent = loopPercentInWindow(end, windowRange);
    ui.waveformSelection.style.left = `${startPercent}%`;
    ui.waveformSelection.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    ui.waveformSelection.hidden = !loopState.active;
    for (const [marker, value, letter] of [[ui.waveformStart, loopState.startMs, "a"], [ui.waveformEnd, loopState.endMs, "b"]]) {
      marker.hidden = !Number.isFinite(value) || !windowRange || value < windowRange.startMs || value > windowRange.endMs;
      marker.style.left = `${loopPercentInWindow(value, windowRange)}%`;
      marker.textContent = letter;
      marker.setAttribute("aria-valuenow", String(Math.round(value || 0)));
      marker.setAttribute("aria-valuetext", formatLoopTime(value));
    }
    ui.setA.textContent = Number.isFinite(loopState.startMs)
      ? formatLoopTime(loopState.startMs)
      : "Set A";
    ui.setB.textContent = Number.isFinite(loopState.endMs)
      ? formatLoopTime(loopState.endMs)
      : "Set B";
    ui.setA.disabled = !loopState.available;
    ui.setB.disabled = !loopState.available;
    ui.clearLoop.disabled = !loopState.active && !Number.isFinite(loopState.startMs);
    for (const [input, value] of [[ui.loopStartTime, loopState.startMs], [ui.loopEndTime, loopState.endMs]]) {
      input.disabled = !loopState.available || duration <= 0;
      if (ui.root.activeElement !== input) input.value = Number.isFinite(value) ? formatLoopTime(value) : "";
    }
    ui.waveformStartLabel.textContent = formatLoopTime(windowRange?.startMs || 0);
    ui.waveformMiddleLabel.textContent = formatLoopTime(windowRange ? (windowRange.startMs + windowRange.endMs) / 2 : 0);
    ui.waveformEndLabel.textContent = formatLoopTime(windowRange?.endMs || duration);
    drawWaveform();
  }

  function setWaveformCollapsed(collapsed) {
    waveformCollapsed = Boolean(collapsed);
    try { localStorage.setItem(WAVEFORM_COLLAPSED_STORAGE, String(waveformCollapsed)); } catch {}

    if (waveformCollapsed) {
      waveformLoadId += 1;
      waveformSamples = [];
      waveformTrackUrl = null;
      waveformSourceUrl = null;
      waveformZoom = null;
      ui.waveformCanvas.width = 1;
      ui.waveformCanvas.height = 1;
    }

    renderLoop();
    if (!waveformCollapsed && !ui.panel.hidden) {
      loadPlayerWaveform();
      setTimeout(drawWaveform, 180);
    }
    if (!ui.panel.hidden) positionPanel();
  }

  async function setLoopPoint(marker) {
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
    if (!(await authorizeLoop(payload))) return;
    setLoopFailure(requestLoop("set-loop", payload));
    readLoopState();
  }

  async function setLoopFromSliders(marker) {
    const activatesLoop = !loopState.active;
    const payload = {
      marker,
      startMs: ui.loopStart.valueAsNumber,
      endMs: ui.loopEnd.valueAsNumber,
      enabled: true,
      startPlayback: activatesLoop,
    };
    if (!(await authorizeLoop(payload))) return;
    setLoopFailure(requestLoop("set-loop", payload));
    readLoopState();
  }

  async function commitLoopTime(marker) {
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
    const payload = { marker, startMs, endMs, enabled: true, startPlayback: !loopState.active };
    if (!(await authorizeLoop(payload))) return;
    setLoopFailure(requestLoop("set-loop", payload));
    readLoopState();
  }

  async function clearLoop() {
    setLoopFailure(requestLoop("clear-loop"));
    await finishLoopSession();
    readLoopState();
  }

  async function setWaveformRange(nextRange, marker = null) {
    if (!nextRange) return;
    const payload = { ...nextRange, marker, enabled: true, startPlayback: !loopState.active };
    if (!(await authorizeLoop(payload))) return;
    setLoopFailure(requestLoop("set-loop", payload));
    readLoopState();
  }

  function beginWaveformDrag(event, kind) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!Number.isFinite(loopState.durationMs)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    waveformDrag = { kind, pointerId: event.pointerId, startX: event.clientX, range: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs } };
  }

  function moveWaveformDrag(event) {
    if (!waveformDrag || waveformDrag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const core = globalThis.SCLooperCore;
    const timeMs = waveformTime(event.clientX);
    if (!core || timeMs === null) return;
    let nextRange;
    if (waveformDrag.kind === "selection") {
      const startTime = waveformTime(waveformDrag.startX);
      nextRange = core.moveRange(waveformDrag.range, timeMs - startTime);
    } else {
      nextRange = core.moveMarker(waveformDrag.range, waveformDrag.kind, timeMs);
    }
    setWaveformRange(nextRange, waveformDrag.kind === "selection" ? null : waveformDrag.kind);
  }

  function endWaveformDrag(event) {
    if (!waveformDrag || waveformDrag.pointerId !== event.pointerId) return;
    moveWaveformDrag(event);
    event.currentTarget.releasePointerCapture(event.pointerId);
    waveformDrag = null;
  }

  function moveWaveformMarkerByKey(event, marker) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const amount = event.shiftKey ? 1000 : 100;
    const value = loopState[`${marker}Ms`] + (event.key === "ArrowLeft" ? -amount : amount);
    setWaveformRange(globalThis.SCLooperCore?.moveMarker?.(loopState, marker, value), marker);
  }

  function handleWaveformWheel(event) {
    if (!Number.isFinite(loopState.durationMs) || !event.deltaY) return;
    const focusMs = waveformTime(event.clientX);
    if (focusMs === null) return;
    event.preventDefault();
    waveformZoom = globalThis.SCLooperCore?.zoomWindowAt?.(waveformZoom, loopState.durationMs, focusMs, event.deltaY) || null;
    renderLoop();
  }

  function installSetterHold(button, marker) {
    const cancel = () => { if (setterHoldTimer !== null) clearTimeout(setterHoldTimer); setterHoldTimer = null; };
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      setterLongPressed = false;
      cancel();
      setterHoldTimer = setTimeout(() => { setterHoldTimer = null; setterLongPressed = true; clearLoop(); }, LONG_PRESS_MS);
    });
    for (const name of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(name, cancel);
    button.addEventListener("click", (event) => {
      if (setterLongPressed) { event.preventDefault(); setterLongPressed = false; return; }
      setLoopPoint(marker);
    });
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

  async function downloadCurrentTrack() {
    if (trackDownloadPending) return;
    const id = `track-export-${Date.now()}`;
    trackDownloadPending = true;
    loopFailure = "Preparing track download…";
    render();
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: "Download request timed out." }), 120000);
      const listener = (event) => {
        if (event.detail?.id !== id) return;
        clearTimeout(timeout);
        document.removeEventListener(TRACK_EXPORT_RESULT_EVENT, listener);
        resolve(event.detail);
      };
      document.addEventListener(TRACK_EXPORT_RESULT_EVENT, listener);
      const state = controller.snapshot();
      document.documentElement.setAttribute(TRACK_EXPORT_ATTRIBUTE, JSON.stringify({
        id,
        playbackTransform: { rate: state.effectiveRate, preservePitch: state.preservePitch },
      }));
      document.dispatchEvent(new CustomEvent(TRACK_EXPORT_EVENT));
    });
    document.documentElement.removeAttribute(TRACK_EXPORT_ATTRIBUTE);
    trackDownloadPending = false;
    loopFailure = result?.success ? "Track download started." : (result?.error || "Could not start track download.");
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
          position: relative;
          display: block;
        }

        .trigger:hover { color: #abababff; }
        .trigger-shell {
          position: relative;
          display: inline-flex;
          width: 64px;
          height: 34px;
          flex: 0 0 64px;
        }

        .clear-rate {
          position: absolute;
          top: 0;
          right: 0;
          z-index: 1;
          width: 14px;
          height: 14px;
          margin: 0;
          padding: 0;
          border: 0;
          color: #fff;
          background: transparent;
          font: 700 13px/14px Arial, sans-serif;
          cursor: pointer;
          opacity: .9;
        }

        .clear-rate:hover { color: #fff; opacity: 1; }
        .clear-rate:focus-visible {
          outline: 2px solid #ff5500;
          outline-offset: 1px;
          border-radius: 2px;
        }

        .trigger-rate {
          position: absolute;
          bottom: 2px;
          left: 50%;
          width: max-content;
          font-variant-numeric: tabular-nums;
          margin: 0;
          color: #ff6c23ff;
          font-size: 9px;
          font-weight: 600;
          line-height: 1;
          transform: translateX(-50%);
        }
        .trigger-rate.is-bypassed { color: #d6d6d6; }
        .trigger-icon {
          display: block;
          position: absolute;
          top: 2px;
          left: 50%;
          width: 20px;
          height: 20px;
          object-fit: contain;
          transform: translateX(-50%);
        }
        .trigger:focus-visible,
        input:focus-visible {
          outline: 2px solid #ff5500;
          outline-offset: 2px;
        }

        .panel {
          position: fixed;
          z-index: 2147483646;
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
          padding-bottom: 10px;
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
          user-select: none;
          -webkit-user-drag: none;
          user-drag: none;
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
        .panel-header { align-items: center; gap: 8px; padding-bottom: 10px; }
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
        .clear-loop, .download-loop { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; border-radius: 5px; cursor: pointer; font: 600 10px/1 Interstate, Arial, sans-serif; }
        .clear-loop { border: 1px solid #484848; color: #fff; background: #292929; }
        .download-loop { border: 1px solid #b84400; color: #fff; background: #ff5500; }
        .clear-loop svg, .download-loop svg { width: 12px; height: 12px; flex: 0 0 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .status { margin-top: 5px; }

        /* Expanded player editor, compact enough to stay clear of the player. */
        .panel { width: min(420px, calc(100vw - 16px)); max-height: calc(100vh - 64px); overflow-y: auto; padding: 7px; border: 1px solid #262626; border-radius: 14px; background: linear-gradient(145deg, #171717, #050505); box-shadow: 0 16px 50px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.04); scrollbar-width: thin; scrollbar-color: #4b4b4b transparent; }
        .panel-header { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 92px 92px; gap: 12px; padding-bottom: 10px; }
        .presets { display: grid; grid-template-columns: repeat(2, 42px); gap: 5px; flex-basis: auto; }
        .preset { width: 42px; height: 27px; border-radius: 7px; font-size: 12px; }
        .custom-preset, .custom-preset[data-saved="true"] { width: 42px; padding: 0 2px; font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .brand { grid-column: 1; grid-row: 1; justify-content: flex-start; min-width: 0; }
        .brand-logo { width: 54px; height: 54px; flex-basis: 54px; border-radius: 11px; }
        .brand-name { font-size: 16px; line-height: 1.04; text-align: left; }
        .brand-title-line { position: relative; display: inline-block; min-width: 0; }
        .free-badge { position: absolute; bottom: 3px; left: 95px; display: inline-flex; align-items: center; height: 13px; margin-left: 6px; padding: 0 4px; border: 1px solid #22c55e; border-radius: 4px; color: #86efac; background: rgba(34, 197, 94, .14); font: 800 8px/1 Arial, sans-serif; letter-spacing: .04em; }
        .rating-link { color: #989898; font-size: 10px; font-weight: 500; text-decoration-color: #666; opacity: .82; }
        .rating-link:hover { color: #bdc1c5; opacity: 1; }
        .setter { height: 28px; padding: 0 8px; border-radius: 7px; font-size: 11px; font-variant-numeric: tabular-nums; }
        .tempo-row { display: grid; grid-template-columns: minmax(0, 1fr) 22px; align-items: center; gap: 5px; margin-bottom: 8px; }
        .pitch-label { display: grid; place-items: center; width: 22px; height: 32px; margin: 0; padding: 0; cursor: help; }
        .pitch-toggle { width: 16px; height: 16px; margin: 0; }
        .speed-status { position: static; grid-column: 2; grid-row: 1; align-self: end; justify-self: center; min-width: 0; height: 26px; justify-content: center; gap: 2px; }
        .current { width: 7ch; flex-basis: 7ch; font-size: 17px; }
        .current.is-bypassed { color: #d6d6d6; }
        .slider-wrap { height: 32px; margin: 0; border: 1px solid #30373e; border-radius: 9px; background: rgba(255,255,255,.025); padding: 2px 32px 2px; }
        .slider { height: 24px; border-radius: 42%; background-size: 100% 8px; }
        .slider::-webkit-slider-runnable-track { height: 9px; border-radius: 999px; }
        .slider::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -2.5px; box-shadow: 0 0 0 2px #fff; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; }
        .limits { padding: 0 7px; }
        .range-label { top: 8px; padding: 0; border-radius: 0; background: transparent; transform: translateX(-50%); }
        .waveform-shell { position: relative; overflow: hidden; height: 130px; border: 1px solid #343434; border-radius: 11px; background: linear-gradient(#101010, #080808); touch-action: none; transition: height 160ms ease; }
        .waveform-shell.is-collapsed { height: 32px; touch-action: auto; }
        .waveform-stage { position: absolute; inset: 25px 8px 27px; cursor: crosshair; }
        .waveform-canvas { display: block; width: 100%; height: 100%; border-radius: 8px; }
        .waveform-selection { position: absolute; inset: 0 auto 0; border: 0; border-inline: 1px solid #ff741f; background: linear-gradient(90deg, rgba(255, 145, 85, .28), rgba(255, 106, 26, .055) 50%, rgba(255, 145, 85, .28)); cursor: grab; }
        .waveform-marker { position: absolute; z-index: 7; top: -17px; width: 18px; height: 18px; margin-left: -9px; padding: 0; border: 0; border-radius: 5px 5px 3px 3px; color: #fff; background: #ff741f; font: 800 11px/1 Arial; text-transform: lowercase; cursor: ew-resize; box-shadow: 0 2px 7px rgba(255, 116, 31, .28); }
        .waveform-marker::after { content: ""; position: absolute; top: 18px; left: 50%; width: 1px; height: 90px; background: #ff741f; transform: translateX(-50%); }
        .waveform-title { position: absolute; z-index: 3; top: 4px; left: 50%; display: inline-flex; align-items: center; gap: 5px; color: #fff; font-size: 11px; font-weight: 700; transform: translateX(-50%); pointer-events: none; }
        .waveform-title svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .waveform-times { position: absolute; inset: auto 9px 3px; display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; color: #7e8790; font-size: 10px; font-variant-numeric: tabular-nums; }
        .waveform-start-label { justify-self: start; }
        .waveform-middle-label { justify-self: center; }
        .waveform-end-label { justify-self: end; }
        .waveform-actions { position: absolute; z-index: 5; top: 4px; right: 6px; display: flex; gap: 4px; }
        .waveform-setters { display: contents; }
        .waveform-times .setter { z-index: 5; width: 68px; height: 23px; padding: 0 6px; border-radius: 6px; font-size: 10px; transform: translateY(-2px); }
        .waveform-toggle { position: absolute; z-index: 8; top: 4px; left: 6px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid #484848; border-radius: 6px; color: #c8c8c8; background: #202020; cursor: pointer; }
        .waveform-toggle:hover { color: #ff6a1a; border-color: #ff6a1a; }
        .waveform-toggle:focus-visible { outline: 2px solid #ff5500; outline-offset: 1px; }
        .waveform-toggle svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 160ms ease; }
        .waveform-shell.is-collapsed .waveform-toggle svg { transform: rotate(180deg); }
        .waveform-shell.is-collapsed .waveform-stage { display: none; }
        .waveform-shell.is-collapsed .waveform-title { left: 34px; line-height: 22px; transform: none; }
        .waveform-shell.is-collapsed .waveform-times { inset: 4px 0; grid-template-columns: repeat(2, max-content); justify-content: center; gap: 10px; }
        .waveform-shell.is-collapsed .waveform-times > span { display: none; }
        .waveform-shell.is-collapsed .waveform-setters { display: block; }
        .waveform-shell.is-collapsed .waveform-times .setter { width: auto; height: 22px; padding: 0 7px; transform: none; }
        .player-tools-upgrade { display: none; position: absolute; z-index: 12; inset: 3px; border: 1px solid #ff6a1a; border-radius: 7px; color: #fff; background: #3d2115; font: 700 10px/1 Interstate, Arial, sans-serif; cursor: pointer; }
        .waveform-shell.is-locked { height: 34px; touch-action: auto; }
        .waveform-shell.is-locked .waveform-stage, .waveform-shell.is-locked .waveform-times, .waveform-shell.is-locked .waveform-actions, .waveform-shell.is-locked .waveform-toggle { display: none; }
        .waveform-shell.is-locked .waveform-title { left: 9px; line-height: 26px; transform: none; }
        .waveform-shell.is-locked .player-tools-upgrade { display: block; left: auto; right: 4px; width: 172px; }

        .effects-shell { margin-top: 7px; overflow: hidden; border: 1px solid #30373e; border-radius: 9px; background: rgba(255,255,255,.025); }
        .effects-toggle { display: flex; align-items: center; width: 100%; height: 30px; gap: 8px; padding: 0 9px; border: 0; color: #e8e8e8; background: transparent; text-align: left; cursor: pointer; }
        .effects-toggle:hover { color: #fff; background: rgba(255,255,255,.035); }
        .effects-icon { display: block; width: 17px; height: 17px; color: #c9cdd1; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .effects-title { flex: 1; font: 700 11px/1 Interstate, Arial, sans-serif; }
        .effects-chevron { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; transition: transform 140ms ease; }
        .effects-shell.is-collapsed .effects-chevron { transform: rotate(180deg); }
        .effects-body { padding: 0 9px 4px; }
        .effects-shell.is-collapsed .effects-body { display: none; }
        .effect-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) 34px; align-items: center; gap: 9px; min-height: 31px; border-top: 1px solid rgba(255,255,255,.055); }
        .effect-label { color: #d5d8db; font: 500 11px/1 Interstate, Arial, sans-serif; }
        .effect-slider { appearance: none; -webkit-appearance: none; width: 100%; height: 20px; margin: 0; border: 0; background: linear-gradient(to right, #ff5500 var(--range-fill, 0%), #30373e var(--range-fill, 0%)) center / 100% 6px no-repeat; cursor: pointer; }
        .effect-slider:disabled { cursor: not-allowed; opacity: .45; }
        .effect-slider::-webkit-slider-runnable-track { height: 6px; background: transparent; }
        .effect-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin-top: -3.5px; border: 2px solid #f3f3f3; border-radius: 50%; background: #aeb5bc; }
        .effect-slider[data-active="true"]::-webkit-slider-thumb { background: #ff7b38; }
        .effect-slider::-moz-range-track { height: 6px; background: #30373e; }
        .effect-slider::-moz-range-progress { height: 6px; background: #ff5500; }
        .effect-slider::-moz-range-thumb { width: 11px; height: 11px; border: 1px solid #f3f3f3; border-radius: 50%; background: #ff7b38; }
        .effect-value { color: #bfc4c8; font: 500 10px/1 Interstate, Arial, sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
        .effects-note { margin: 0 0 3px 81px; color: #858c92; font: 9px/1.2 Interstate, Arial, sans-serif; }
        .effects-export-note { margin: 4px 0 0; color: #9da3a8; font: 9px/1.2 Interstate, Arial, sans-serif; }
        .presets { grid-column: 3; grid-row: 1; }
        .panel-tools { display: flex; grid-column: 2; grid-row: 1; justify-self: center; align-self: start; gap: 5px; margin-left: 0; }
        .panel-tool { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 27px; height: 24px; margin: 0; padding: 0; border: 1px solid rgba(255,255,255,.2); border-radius: 4px; color: #fff; background: rgba(255,255,255,.08); cursor: pointer; outline: none; transition: background-color 200ms, border-color 200ms; }
        .panel-tool:hover { color: #fff; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.14); }
        .panel-tool:focus-visible { border-color: rgba(255,85,0,.65); }
        .panel-tool:disabled { opacity: .48; cursor: wait; }
        .panel-tool[aria-pressed="true"] { color: #ff6a1a; border-color: #ff6a1a; }
        .panel-tool svg { display: block; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .settings-button svg { width: 13px; height: 13px; fill: currentColor; stroke: none; }
        .clear-loop, .download-loop { height: 22px; padding: 0 6px; border-radius: 6px; opacity: .82; }
        .loop-edit { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

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
      <span class="trigger-shell">
        <button
          class="trigger"
          type="button"
          aria-label="Playback speed 1x"
          aria-haspopup="dialog"
          aria-expanded="false"
        ><img class="trigger-icon" width="24" height="24" alt="" draggable="false" hidden /><span class="trigger-rate">1x</span></button>
        <button class="clear-rate" type="button" aria-label="Clear selected playback speed" title="Clear selected playback speed">×</button>
      </span>
      <section
        class="panel"
        role="dialog"
        aria-label="Playback speed and loop"
        hidden
      >
        <div class="panel-header">
        <div class="presets" role="group" aria-label="Quick playback speeds">
          ${customRates.map((rate, index) => `<button class="preset custom-preset" type="button" data-custom-index="${index}" data-saved="true" aria-pressed="false" title="Saved speed ${formatRate(rate)}. Hold to replace">${formatRate(rate)}</button>`).join("")}
        </div>
        <div class="brand">
          <img class="brand-logo" width="58" height="58" alt="" draggable="false" hidden />
          <div class="brand-copy">
            <div class="brand-title-line"><button class="brand-name" type="button" aria-label="Open the Looper guide">SoundCloud Track <br />Downloader</button><span class="free-badge">FREE</span></div>
            <a class="rating-link" href="${REVIEW_URL}" target="_blank" rel="noopener noreferrer">Please consider rating the app!</a>
          </div>
        </div>
        <div class="panel-tools" role="group" aria-label="Panel options">
          <button class="panel-tool download-track-button" type="button" aria-label="Download current playing" title="Download current playing">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
          </button>
          <button class="panel-tool settings-button" type="button" aria-label="Open settings" title="Open settings">
            ${SETTINGS_ICON}
          </button>
          <button class="panel-tool detach-button" type="button" aria-label="Keep panel open when clicking outside" aria-pressed="false" title="Keep panel open when clicking outside">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M12 8v8"/><path d="M5 5h14v14H5z"/></svg>
          </button>
        </div>
        <div class="speed-status">
          <output class="current">1x</output>
          <button class="bypass" type="button" aria-label="Bypass loop and playback effects" aria-pressed="false" title="Bypass loop and playback effects">${BYPASS_ICON}</button>
        </div>
        </div>
        <div class="tempo-row">
          <div class="slider-wrap">
            <div class="limits" aria-hidden="true"><span>0.1x</span><span>3x</span></div>
            <span class="range-label" aria-hidden="true">Tone &amp; Velocity</span>
            <input
            class="slider"
            type="range"
            min="0.1"
            max="3"
            step="${DEFAULTS.step}"
            value="1"
            aria-label="Playback speed"
            />
          </div>
          <label class="pitch-label" title="Keep tone"><input class="pitch-toggle" type="checkbox" aria-label="Keep tone" title="Keep tone" /></label>
        </div>
        <div class="waveform-shell" role="group" aria-label="Loop waveform">
          <button class="waveform-toggle" type="button" aria-label="Minimize looper" aria-expanded="true" title="Minimize looper"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
          <span class="waveform-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8.5 5 6 2.5 8.5M5 6v7a3.5 3.5 0 0 0 6 2.5l2-2a3.5 3.5 0 0 1 6 2.5v2M16.5 15.5 19 18l2.5-2.5"/></svg>Loop Region</span>
          <div class="waveform-actions"><button class="clear-loop" type="button" aria-label="Clear loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Clear</span></button><button class="download-loop" type="button" aria-label="Download loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span>WAV</span></button></div>
          <div class="waveform-stage">
            <canvas class="waveform-canvas" aria-hidden="true"></canvas>
            <div class="waveform-selection" hidden></div>
            <button class="waveform-marker waveform-start" type="button" role="slider" aria-label="Loop start A">A</button>
            <button class="waveform-marker waveform-end" type="button" role="slider" aria-label="Loop end B">B</button>
          </div>
          <div class="waveform-times"><span class="waveform-start-label">00:00.000</span><div class="waveform-setters"><button class="setter set-a" type="button">Set A</button></div><span class="waveform-middle-label">00:00.000</span><div class="waveform-setters"><button class="setter set-b" type="button">Set B</button></div><span class="waveform-end-label">00:00.000</span></div>
          <button class="player-tools-upgrade" type="button">Try Player Tools — $3.69 lifetime</button>
        </div>
        <div class="loop-edit">
          <input class="loop-time loop-start-time" inputmode="decimal" placeholder="A 00:00.000" aria-label="Loop start time" />
          <input class="loop-time loop-end-time" inputmode="decimal" placeholder="B 00:00.000" aria-label="Loop end time" />
        </div>
        <section class="effects-shell is-collapsed" aria-label="Audio effects">
          <button class="effects-toggle" type="button" aria-expanded="false">
            <svg class="effects-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2l2-7 4 14 3-11 2 7h2l1-3h2"/></svg>
            <span class="effects-title">FX</span>
            <svg class="effects-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
          </button>
          <div class="effects-body">
            <div class="effect-row"><label class="effect-label" for="scdl-effect-reverb">Reverb</label><input class="effect-slider" id="scdl-effect-reverb" type="range" min="0" max="100" step="1" value="0" aria-label="Reverb amount" title="Reverb amount; 0% turns it off" /><output class="effect-value" data-effect-value="reverb">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-delay">Delay</label><input class="effect-slider" id="scdl-effect-delay" type="range" min="0" max="100" step="1" value="0" aria-label="Delay amount" title="Delay amount; 0% turns it off" /><output class="effect-value" data-effect-value="delay">0%</output></div>
            <p class="effects-note">Amount added · 0% off</p>
          </div>
        </section>
        <p class="effects-export-note" hidden>WAV exports without FX.</p>
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

  function setVolumeLayerOpen(open) {
    let style = document.getElementById(VOLUME_LAYER_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = VOLUME_LAYER_STYLE_ID;
      style.textContent = `html[${VOLUME_LAYER_ATTRIBUTE}="true"] .volume__sliderWrapper { z-index: 2147483647 !important; }`;
      (document.head || document.documentElement).append(style);
    }
    document.documentElement.setAttribute(VOLUME_LAYER_ATTRIBUTE, String(open));
  }

  function setPanelOpen(open) {
    if (!ui) return;
    ui.panel.hidden = !open;
    ui.trigger.setAttribute("aria-expanded", String(open));
    setVolumeLayerOpen(open);
    if (open) positionPanel();
  }

  function clearHoverTimers() {
    if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
    if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
  }

  function openPanel(mode) {
    if (!ui) return;
    clearHoverTimers();
    panelOpenMode = mode;
    setPanelOpen(true);
    if (!waveformCollapsed) loadPlayerWaveform();
  }

  document.addEventListener(OPEN_PLAYER_TOOLS_PANEL_EVENT, () => {
    mount();
    if (ui) openPanel("click");
  });

  function closePanel() {
    clearHoverTimers();
    panelOpenMode = null;
    setPanelOpen(false);
  }

  function pointerIsOverTempoControl() {
    return ui && (ui.trigger.matches(":hover") || ui.panel.matches(":hover"));
  }

  function scheduleHoverOpen() {
    if (!ui || !ui.panel.hidden || hoverOpenTimer !== null) return;
    hoverOpenTimer = setTimeout(() => {
      hoverOpenTimer = null;
      if (ui?.panel.hidden && ui.trigger.matches(":hover")) openPanel("hover");
    }, HOVER_OPEN_DELAY_MS);
  }

  function scheduleHoverClose() {
    if (!ui || panelDetached || panelOpenMode !== "hover") return;
    if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null;
      if (!panelDetached && panelOpenMode === "hover" && !pointerIsOverTempoControl()) {
        closePanel();
      }
    }, HOVER_CLOSE_DELAY_MS);
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
      clearRate: root.querySelector(".clear-rate"),
      panel: root.querySelector(".panel"),
      slider: root.querySelector(".slider"),
      pitchToggle: root.querySelector(".pitch-toggle"),
      current: root.querySelector(".current"),
      triggerLogo: root.querySelector(".trigger-icon"),
      triggerRate: root.querySelector(".trigger-rate"),
      bypass: root.querySelector(".bypass"),
      status: root.querySelector(".status"),
      brandLogo: root.querySelector(".brand-logo"),
      brandName: root.querySelector(".brand-name"),
      downloadTrackButton: root.querySelector(".download-track-button"),
      settingsButton: root.querySelector(".settings-button"),
      detachButton: root.querySelector(".detach-button"),
      setA: root.querySelector(".set-a"),
      setB: root.querySelector(".set-b"),
      waveformShell: root.querySelector(".waveform-shell"),
      waveformToggle: root.querySelector(".waveform-toggle"),
      waveformStage: root.querySelector(".waveform-stage"),
      waveformCanvas: root.querySelector(".waveform-canvas"),
      waveformSelection: root.querySelector(".waveform-selection"),
      waveformStart: root.querySelector(".waveform-start"),
      waveformEnd: root.querySelector(".waveform-end"),
      waveformStartLabel: root.querySelector(".waveform-start-label"),
      waveformMiddleLabel: root.querySelector(".waveform-middle-label"),
      waveformEndLabel: root.querySelector(".waveform-end-label"),
      loopStartTime: root.querySelector(".loop-start-time"),
      loopEndTime: root.querySelector(".loop-end-time"),
      clearLoop: root.querySelector(".clear-loop"),
      downloadLoop: root.querySelector(".download-loop"),
      playerToolsUpgrade: root.querySelector(".player-tools-upgrade"),
      effectsShell: root.querySelector(".effects-shell"),
      effectsToggle: root.querySelector(".effects-toggle"),
      effectSliders: Object.fromEntries(
        ["reverb", "delay"].map((name) => [name, root.querySelector(`#scdl-effect-${name}`)])
      ),
      effectValues: Object.fromEntries(
        ["reverb", "delay"].map((name) => [name, root.querySelector(`[data-effect-value="${name}"]`)])
      ),
      effectsExportNote: root.querySelector(".effects-export-note"),
    };

    ui.trigger.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      if (hoverCloseTimer !== null) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }
      scheduleHoverOpen();
    });
    ui.trigger.addEventListener("pointerleave", () => {
      if (hoverOpenTimer !== null) {
        clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
      }
      scheduleHoverClose();
    });
    ui.panel.addEventListener("pointerenter", () => {
      if (hoverCloseTimer !== null) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }
    });
    ui.panel.addEventListener("pointerleave", scheduleHoverClose);
    ui.trigger.addEventListener("click", () => {
      if (ui.panel.hidden) openPanel("click");
      else if (panelDetached || panelOpenMode === "click") closePanel();
      else openPanel("click");
    });
    ui.clearRate.addEventListener("click", (event) => {
      event.stopPropagation();
      applyPlayerRate(DEFAULTS.rate, { animate: true });
    });
    ui.brandName.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });
    ui.downloadTrackButton.addEventListener("click", downloadCurrentTrack);
    ui.settingsButton.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });
    ui.detachButton.addEventListener("click", () => {
      panelDetached = !panelDetached;
      try { localStorage.setItem(DETACH_STORAGE, String(panelDetached)); } catch {}
      // Leaving detach returns to the persistent click mode, so the next
      // outside click is the explicit close action even if it began as hover.
      if (!panelDetached && !ui.panel.hidden) panelOpenMode = "click";
      render();
    });
    ui.waveformToggle.addEventListener("click", () => {
      setWaveformCollapsed(!waveformCollapsed);
    });
    ui.effectsToggle.addEventListener("click", () => {
      effectsCollapsed = !effectsCollapsed;
      ui.effectsShell.classList.toggle("is-collapsed", effectsCollapsed);
      ui.effectsToggle.setAttribute("aria-expanded", String(!effectsCollapsed));
      if (!ui.panel.hidden) positionPanel();
    });
    for (const [name, slider] of Object.entries(ui.effectSliders)) {
      slider.addEventListener("input", () => {
        const state = effectsController?.set(name, slider.valueAsNumber);
        if (state?.available) {
          effectsFailure = state[name] > 0 && !state.initialized
            ? "Play a track to activate FX."
            : "";
        }
        render();
      });
    }
    root.querySelectorAll(".preset").forEach((button) => {
      if (button.classList.contains("custom-preset")) return;
      button.addEventListener("click", () => {
        applyPlayerRate(Number(button.dataset.rate), { animate: true });
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
          savePlayerPreset(index);
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
        timer = setTimeout(() => { timer = null; longPressed = true; savePlayerPreset(index); }, LONG_PRESS_MS);
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
        applyPlayerRate(customRates[index], { animate: true });
      });
    });
    ui.slider.addEventListener("input", () => {
      applyPlayerRate(ui.slider.valueAsNumber);
    });
    ui.slider.addEventListener("dblclick", () => {
      applyPlayerRate(DEFAULTS.rate, { animate: true });
    });
    ui.pitchToggle.addEventListener("change", () => {
      applyPlayerPitch(ui.pitchToggle.checked);
    });
    ui.bypass.addEventListener("click", () => {
      playbackFailure = "";
      animateNextRateChange = true;
      const bypassed = !controller.snapshot().bypassed;
      controller.setBypassed(bypassed);
      requestLoop("set-global-bypass", { bypassed });
      readLoopState();
    });
    installSetterHold(ui.setA, "start");
    installSetterHold(ui.setB, "end");
    for (const [marker, name] of [[ui.waveformStart, "start"], [ui.waveformEnd, "end"]]) {
      marker.addEventListener("pointerdown", (event) => beginWaveformDrag(event, name));
      marker.addEventListener("pointermove", moveWaveformDrag);
      marker.addEventListener("pointerup", endWaveformDrag);
      marker.addEventListener("pointercancel", endWaveformDrag);
      marker.addEventListener("keydown", (event) => moveWaveformMarkerByKey(event, name));
    }
    ui.waveformSelection.addEventListener("pointerdown", (event) => beginWaveformDrag(event, "selection"));
    ui.waveformSelection.addEventListener("pointermove", moveWaveformDrag);
    ui.waveformSelection.addEventListener("pointerup", endWaveformDrag);
    ui.waveformSelection.addEventListener("pointercancel", endWaveformDrag);
    ui.waveformStage.addEventListener("wheel", handleWaveformWheel, { passive: false });
    ui.waveformStage.addEventListener("dblclick", () => { waveformZoom = null; renderLoop(); });
    ui.waveformCanvas.addEventListener("click", (event) => { const timeMs = waveformTime(event.clientX); if (timeMs !== null) requestLoop("seek", { timeMs }); });
    for (const [input, marker] of [[ui.loopStartTime, "start"], [ui.loopEndTime, "end"]]) {
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commitLoopTime(marker); input.blur(); } if (event.key === "Escape") { input.value = Number.isFinite(loopState[`${marker}Ms`]) ? formatLoopTime(loopState[`${marker}Ms`]) : ""; input.blur(); } });
      input.addEventListener("blur", () => { if (input.value.trim()) commitLoopTime(marker); });
    }
    ui.clearLoop.addEventListener("click", clearLoop);
    ui.downloadLoop.addEventListener("click", downloadLoopFromPlayer);
    ui.playerToolsUpgrade.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });

    render();
    syncBrandLogo();
    readLoopState();
    return host;
  }

  function render() {
    if (!ui) return;
    const state = controller.snapshot();
    const canUseTempo = hasCapability("tempo");
    const canEditLoop = hasCapability("editLoop");
    const freeLocked = accessSnapshot?.state === "free_locked";
    const text = formatRate(state.effectiveRate);
    const triggerText = formatTriggerRate(state.effectiveRate);
    const animateRate = animateNextRateChange;
    animateNextRateChange = false;
    ui.trigger.setAttribute("aria-label", `Playback speed ${triggerText}`);
    ui.slider.value = String(state.rate);
    ui.slider.setAttribute("aria-valuetext", formatRate(state.rate));
    ui.bypass.setAttribute("aria-pressed", String(state.bypassed));
    ui.current.classList.toggle("is-bypassed", state.bypassed);
    ui.triggerRate.classList.toggle("is-bypassed", state.bypassed);
    ui.bypass.title = state.bypassed
      ? "Bypass on — restore loop, speed and tone"
      : "Bypass loop, speed and tone";
    ui.bypass.setAttribute("aria-label", ui.bypass.title);
    ui.detachButton.setAttribute("aria-pressed", String(panelDetached));
    ui.detachButton.setAttribute(
      "aria-label",
      panelDetached
        ? "Close panel when clicking outside"
        : "Keep panel open when clicking outside"
    );
    ui.detachButton.title = ui.detachButton.getAttribute("aria-label");
    ui.downloadTrackButton.disabled = trackDownloadPending;
    ui.clearRate.disabled = !canUseTempo;
    ui.slider.disabled = !canUseTempo;
    ui.pitchToggle.disabled = !canUseTempo || !state.preservePitchSupported;
    ui.bypass.disabled = false;
    ui.root.querySelectorAll(".preset").forEach((button) => { button.disabled = !canUseTempo; });
    ui.waveformShell.classList.toggle("is-locked", freeLocked);
    ui.waveformToggle.disabled = freeLocked;
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
    if (effectsBypassed !== state.bypassed) {
      effectsBypassed = state.bypassed;
      effectsController?.setBypassed(effectsBypassed);
    }
    renderRate(state.effectiveRate, animateRate);
    ui.host.setAttribute(RATE_ATTRIBUTE, String(state.effectiveRate));
    ui.host.setAttribute(PITCH_ATTRIBUTE, String(state.preservePitch));
    const message = playbackFailure || storageFailure || loopFailure || effectsFailure;
    ui.status.textContent = message;
    ui.status.hidden = !message;
    renderLoop();
    renderEffects();
  }

  function renderEffects() {
    if (!ui || !effectsController) return;
    const state = effectsController.snapshot();
    for (const name of ["reverb", "delay"]) {
      const slider = ui.effectSliders[name];
      slider.value = String(state[name]);
      slider.disabled = !state.available;
      slider.dataset.active = String(state[name] > 0);
      ui.effectValues[name].textContent = `${state[name]}%`;
      syncRange(slider);
    }
    ui.effectsShell.classList.toggle("is-collapsed", effectsCollapsed);
    ui.effectsToggle.setAttribute("aria-expanded", String(!effectsCollapsed));
    ui.effectsExportNote.hidden = state.reverb === 0 && state.delay === 0;
  }

  function mount() {
    const player = document.querySelector(PLAYER_SELECTOR);
    if (!player) {
      ui?.host.remove();
      closePanel();
      return;
    }

    const host = ui?.host || createUi();
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
  document.querySelectorAll("audio").forEach((audio) => {
    controller.discover(audio);
    effectsController?.discover(audio);
  });
  for (const event of ["play", "loadedmetadata"]) {
    document.addEventListener(
      event,
      (mediaEvent) => {
        controller.apply(mediaEvent.target);
        effectsController?.discover(mediaEvent.target);
        effectsController?.applyToActive();
      },
      true
    );
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLAudioElement) {
          controller.discover(node);
          effectsController?.discover(node);
        } else {
          node.querySelectorAll("audio").forEach((audio) => {
            controller.discover(audio);
            effectsController?.discover(audio);
          });
        }
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
        !panelDetached &&
        !event.composedPath().includes(ui.host) &&
        !isPlayerTimelineInteraction(event)
      ) {
        closePanel();
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
        closePanel();
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
  document.addEventListener(PLAYER_WAVEFORM_EVENT, loadPlayerWaveform);
  loopPollInterval = setInterval(readLoopState, 250);

  mount();
  render();
})();
