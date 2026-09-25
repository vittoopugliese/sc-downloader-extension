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
  const DEFAULT_SAVED_RATES = [0.5, 1];
  const CUSTOM_RATE_STORAGE = DEFAULT_SAVED_RATES.map(
    (_, index) => `scdl.tempo.savedRate.${index + 1}`
  );
  const DETACH_STORAGE = "scdl.tempo.panelDetached";
  const WAVEFORM_COLLAPSED_STORAGE = "scdl.tempo.waveformCollapsed";
  const RATE_ATTRIBUTE = "data-scdl-tempo-rate";
  const PITCH_ATTRIBUTE = "data-scdl-tempo-preserve-pitch";
  const EXTENSION_LOGO_ATTRIBUTE = "data-scdl-extension-logo-url";
  const EXTENSION_PLAYER_ICON_ATTRIBUTE = "data-scdl-extension-player-icon-url";
  const EXTENSION_DRUM_SAMPLES_ATTRIBUTE = "data-scdl-extension-drum-samples-url";
  const EXTENSION_MEGAPHONE_ATTRIBUTE = "data-scdl-extension-megaphone-url";
  const EXTENSION_SOCIAL_BADGE_ATTRIBUTE = "data-scdl-extension-social-badge-url";
  const EXTENSION_DETACH_ICON_ATTRIBUTE = "data-scdl-extension-detach-icon-url";
  const EXTENSION_TRASH_ICON_ATTRIBUTE = "data-scdl-extension-trash-icon-url";
  const EXTENSION_EXPAND_ICON_ATTRIBUTE = "data-scdl-extension-expand-icon-url";
  const EXTENSION_CROSS_ICON_ATTRIBUTE = "data-scdl-extension-cross-url";
  const EXTENSION_ASSETS_EVENT = "scdl:extension-assets-ready";
  const OPEN_LOOPER_GUIDE_EVENT = "scdl:open-looper-guide";
  const OPEN_PLAYER_TOOLS_PANEL_EVENT = "scdl:open-player-tools-panel";
  const PLAYER_TOOLS_OPENED_EVENT = "scdl:player-tools-opened";
  const OPEN_PLAYER_TOOLS_PRO_EVENT = "scdl:open-player-tools-pro";
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
  const DRUM_LONG_PRESS_MS = 600;
  const DRUM_KEYS_STORAGE = "scdl.drums.keys";
  const DRUM_DEFAULTS = [
    { name: "Kick", sample: "kick1.wav", key: "a" },
    { name: "Clap", sample: "clap1.wav", key: "s" },
    { name: "Hat", sample: "hat1.wav", key: "d" },
    { name: "Kick 2", sample: "kick2.wav", key: "f" },
    { name: "Snare", sample: "snare1.wav", key: "g" },
    { name: "Tom", sample: "tom1.wav", key: "h" },
  ];
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
  if (window[INSTALLED_FLAG] || !globalThis.SCTempoControl || !globalThis.SCSamplerCore) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const { DEFAULTS, clampRate, create, formatRate } = globalThis.SCTempoControl;
  const effectsApi = globalThis.SCTempoEffects;
  const EFFECT_NAMES = effectsApi?.EFFECT_NAMES || ["reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation"];
  const RATE_ANIMATION_DURATION_MS = 220;
  const DOWNLOAD_STATUS_DURATION_MS = 30000;
  const DOWNLOAD_REQUEST_TIMEOUT_MS = 120000;
  const DEFAULT_EFFECT_TOGGLE_WET = 20;
  const EFFECT_SIGNATURE_FIELDS = Object.freeze([
    "schemaVersion",
    "reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation",
    "reverbRoom", "reverbSize", "reverbDecay", "reverbPreDelay", "reverbTone",
    "delayTime", "delayFeedback", "delayTone",
    "flangerRate", "flangerDepth", "flangerFeedback",
    "phaserRate", "phaserDepth", "phaserFeedback",
    "bitDepth", "sampleRateReduction", "saturationDrive", "saturationTone",
  ]);
  let ui = null;
  let equalizerUi = null;
  const collapsible = globalThis.SCPlayerToolsCollapsible;
  const sectionControllers = {};
  const EQ_STORAGE = "scdl.parametric-eq.v1";
  let mountQueued = false;
  let playbackFailure = "";
  let storageFailure = "";
  let loopFailure = "";
  let downloadStatusTimer = null;
  let rateAnimationFrame = null;
  let rateAnimationTarget = null;
  let displayedRate = null;
  let animateNextRateChange = false;
  let loopRequestId = 0;
  let loopIntentVersion = 0;
  let trackDownloadPending = false;
  let loopDownloadPending = false;
  let padRenderPending = false;
  let loopState = { active: false, enabled: false, startMs: null, endMs: null, durationMs: null };
  let accessSnapshot = { state: "loading", plan: "free", capabilities: {} };
  let playerToolsSessionId = null;
  let accessRequestId = 0;
  let accessLocked = false;
  let accessActionPending = false;
  let rateIntent = null;
  let rateAuthorization = null;
  let loopPollInterval = null;
  let waveformSamples = [];
  let waveformTrackUrl = null;
  let waveformSourceUrl = null;
  let waveformZoom = null;
  let waveformLoadId = 0;
  let waveformDrag = null;
  let waveformDrawPreview = null;
  let waveformRevision = 0;
  let waveformStaticKey = "";
  let loopPresentationKey = "";
  let loopRenderFrame = null;
  let suppressWaveformClick = false;
  let panelOpenMode = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  let drumAudioContext = null;
  let hoveredDrum = null;
  let selectingLoopPad = null;
  let padRequestNumber = 0;
  let instrumentMode = false;
  let instrumentOctave = 0;
  let instrumentPreparing = false;
  let instrumentBuffer = null;
  let instrumentVoice = null;
  let instrumentNoteRevision = 0;
  let instrumentResumePromise = null;
  let instrumentIntentVersion = 0;
  let instrumentOperationId = null;
  let instrumentSnapshot = null;
  const instrumentVoices = new Set();
  const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  let renderedPlayingNote = "";
  const padRequests = new Map();
  const drumPads = DRUM_DEFAULTS.map((defaultPad) => ({ ...defaultPad, buffer: null, loading: null, customName: "", saved: false, busy: false, version: 0 }));
  try {
    const savedKeys = JSON.parse(localStorage.getItem(DRUM_KEYS_STORAGE) || "null");
    if (Array.isArray(savedKeys)) {
      savedKeys.forEach((key, index) => {
        if (key === "" || (typeof key === "string" && /^[a-z0-9]$/i.test(key))) {
          drumPads[index].key = key.toLowerCase();
        }
      });
    }
  } catch {}
  let panelDetached = (() => {
    try { return localStorage.getItem(DETACH_STORAGE) === "true"; } catch { return false; }
  })();
  let waveformCollapsed = (() => {
    try { return localStorage.getItem(WAVEFORM_COLLAPSED_STORAGE) === "true"; } catch { return false; }
  })();
  let effectsCollapsed = true;
  let samplerCollapsed = true;
  let controlsHidden = false;
  let resetInProgress = false;
  let resetGeneration = 0;
  let playbackIntentVersion = 0;
  let effectIntentVersion = 0;
  let expandedEffectSettings = null;
  let effectsFailure = "";
  let effectsBypassed = false;
  const effectWetMemory = Object.fromEntries(EFFECT_NAMES.map((name) => [name, DEFAULT_EFFECT_TOGGLE_WET]));
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
    const megaphoneUrl = document.documentElement.getAttribute(EXTENSION_MEGAPHONE_ATTRIBUTE);
    const socialBadgeUrl = document.documentElement.getAttribute(EXTENSION_SOCIAL_BADGE_ATTRIBUTE);
    const detachIconUrl = document.documentElement.getAttribute(EXTENSION_DETACH_ICON_ATTRIBUTE);
    const trashIconUrl = document.documentElement.getAttribute(EXTENSION_TRASH_ICON_ATTRIBUTE);
    const expandIconUrl = document.documentElement.getAttribute(EXTENSION_EXPAND_ICON_ATTRIBUTE);
    const crossIconUrl = document.documentElement.getAttribute(EXTENSION_CROSS_ICON_ATTRIBUTE);
    if (logoUrl) {
      ui.brandLogo.src = logoUrl;
      ui.brandLogo.hidden = false;
    }
    if (playerIconUrl) {
      ui.triggerLogo.src = playerIconUrl;
      ui.triggerLogo.hidden = false;
    }
    if (megaphoneUrl && ui.samplerIcon) ui.samplerIcon.src = megaphoneUrl;
    if (socialBadgeUrl && ui.planBadgeIcon) ui.planBadgeIcon.src = socialBadgeUrl;
    if (detachIconUrl && ui.detachIcon) { ui.detachIcon.src = detachIconUrl; ui.detachIcon.hidden = false; }
    if (trashIconUrl && ui.trashIcon) { ui.trashIcon.src = trashIconUrl; ui.trashIcon.hidden = false; }
    if (expandIconUrl && ui.visibilityExpandIcon) ui.visibilityExpandIcon.src = expandIconUrl;
    if (crossIconUrl) ui.crossIcons.forEach((icon) => { icon.src = crossIconUrl; });
  }

  document.addEventListener(EXTENSION_ASSETS_EVENT, syncBrandLogo);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "scdl-pad-content") return;
    const request = padRequests.get(event.data.id);
    if (!request) return;
    padRequests.delete(event.data.id);
    clearTimeout(request.timeout);
    if (event.data.result?.success) request.resolve(event.data.result);
    else request.reject(new Error(event.data.result?.error || "Could not prepare this pad."));
  });

  function requestPad(action, payload = {}) {
    const id = `pad_${Date.now()}_${++padRequestNumber}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        padRequests.delete(id);
        if (action === "instrument" && payload.operationId) {
          window.postMessage({ source: "scdl-pad-main", id: `cancel_${id}`,
            action: "cancel-instrument", operationId: payload.operationId }, location.origin);
        }
        reject(new Error("The pad request timed out."));
      }, 120000);
      padRequests.set(id, { resolve, reject, timeout, action, operationId: payload.operationId || null });
      window.postMessage({ source: "scdl-pad-main", id, action, ...payload }, location.origin);
    });
  }

  function cancelInstrumentRequest() {
    const operationId = instrumentOperationId;
    instrumentOperationId = null;
    if (!operationId) return;
    for (const [id, request] of padRequests) {
      if (request.action !== "instrument" || request.operationId !== operationId) continue;
      padRequests.delete(id);
      clearTimeout(request.timeout);
      const error = new Error("Instrument preparation cancelled.");
      error.name = "AbortError";
      request.reject(error);
    }
    window.postMessage({ source: "scdl-pad-main", id: `cancel_${Date.now()}_${++padRequestNumber}`,
      action: "cancel-instrument", operationId }, location.origin);
  }

  async function hydrateDrumPads() {
    try {
      const result = await requestPad("list");
      for (const record of result.pads || []) {
        const pad = drumPads[record.index];
        if (!pad || pad.busy || pad.version) continue;
        pad.customName = record.name;
        pad.saved = true;
        pad.buffer = null;
        pad.loading = null;
      }
      updateDrumLabels();
    } catch (error) { console.warn("[SC Downloader Pads]", error); }
  }

  function updateDrumLabels() {
    if (!ui) return;
    drumPads.forEach((pad, index) => {
      const button = ui.drumButtons[index];
      button.querySelector(".drum-key").textContent = pad.key ? pad.key.toUpperCase() : "·";
      button.classList.toggle("is-saving", pad.busy);
      button.setAttribute("aria-label", `${pad.customName || pad.name} drum pad. Key ${pad.key ? pad.key.toUpperCase() : "unassigned"}. Hold to load an audio sample.`);
      button.title = `${Array.from(pad.customName || pad.name).slice(0, 20).join("")} · hold to load`;
    });
  }

  function showDrumError(message) {
    if (!ui) return;
    ui.drumMessage.removeAttribute("data-scdl-tooltip");
    ui.drumMessage.removeAttribute("tabindex");
    ui.drumMessage.textContent = message;
    ui.drumMessage.hidden = !message;
    ui.drumStatus.hidden = !message;
  }

  function renderPlayingNote(midiNote = null) {
    if (!ui) return;
    const value = Number.isInteger(midiNote)
      ? `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}` : "";
    if (value === renderedPlayingNote) return;
    renderedPlayingNote = value;
    ui.playingNote.textContent = value;
  }

  function renderInstrumentMessage() {
    if (!ui || !instrumentMode) return;
    let copy = {};
    try { copy = JSON.parse(document.documentElement.getAttribute("data-scdl-piano-copy") || "{}"); } catch {}
    const octave = instrumentOctave >= 0 ? `+${instrumentOctave}` : String(instrumentOctave);
    const status = typeof copy.status === "string" && copy.status !== "piano_mode_status"
      ? copy.status : "Piano mode on · ← → octave ({octave})";
    showDrumError(status.replace("{octave}", octave));
    if (typeof copy.help === "string" && copy.help !== "piano_mode_help") {
      ui.drumMessage.setAttribute("data-scdl-tooltip", copy.help);
      ui.drumMessage.tabIndex = 0;
    }
  }

  document.addEventListener(EXTENSION_ASSETS_EVENT, renderInstrumentMessage);

  function setSamplerCollapsed(collapsed) {
    samplerCollapsed = Boolean(collapsed);
    sectionControllers.sampler?.setCollapsed(samplerCollapsed, { notify: false });
    renderControlsVisibility();
    if (!ui.panel.hidden) positionPanel();
  }

  function getDrumAudioContext() {
    if (!drumAudioContext) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Audio playback is unavailable in this browser.");
      drumAudioContext = new AudioContextConstructor();
    }
    return drumAudioContext;
  }

  function invalidatePendingInstrumentNotes() {
    instrumentNoteRevision += 1;
  }

  function cleanupInstrumentVoice(voice) {
    if (!voice || voice.cleaned) return;
    voice.cleaned = true;
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer);
    voice.cleanupTimer = null;
    voice.source.onended = null;
    try { voice.source.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
    instrumentVoices.delete(voice);
    if (instrumentVoice === voice) {
      instrumentVoice = null;
      renderPlayingNote();
    }
  }

  function releaseInstrumentVoice(voice, releaseMs = 8) {
    if (!voice || voice.releasing || voice.cleaned) return;
    voice.releasing = true;
    const now = voice.context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseMs / 1000);
      voice.source.stop(now + releaseMs / 1000 + 0.002);
      voice.cleanupTimer = setTimeout(() => cleanupInstrumentVoice(voice), releaseMs + 100);
    } catch {
      cleanupInstrumentVoice(voice);
    }
  }

  function stopInstrumentVoice(releaseMs = 8) {
    invalidatePendingInstrumentNotes();
    const voice = instrumentVoice;
    instrumentVoice = null;
    renderPlayingNote();
    releaseInstrumentVoice(voice, releaseMs);
  }

  function stopAllInstrumentVoices(releaseMs = 8) {
    invalidatePendingInstrumentNotes();
    instrumentVoice = null;
    renderPlayingNote();
    for (const voice of instrumentVoices) releaseInstrumentVoice(voice, releaseMs);
  }

  function setInstrumentMode(enabled, { clearBuffer = false, message = "" } = {}) {
    if (enabled && !instrumentMode) instrumentOctave = 0;
    instrumentMode = Boolean(enabled);
    if (!instrumentMode) stopInstrumentVoice();
    if (clearBuffer) {
      instrumentBuffer = null;
      instrumentSnapshot = null;
    }
    if (ui?.instrumentToggle) {
      ui.instrumentToggle.setAttribute("aria-pressed", String(instrumentMode));
      ui.instrumentToggle.classList.toggle("is-preparing", instrumentPreparing);
    }
    if (message || !instrumentMode) showDrumError(message);
    if (instrumentMode) renderInstrumentMessage();
    renderLoop();
  }

  function normalizedInstrumentNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : null;
  }

  function buildInstrumentDescriptor() {
    const playback = controller.snapshot();
    const snapshot = effectsController?.snapshot() || {};
    const effects = {};
    for (const field of EFFECT_SIGNATURE_FIELDS) {
      const value = snapshot[field] ?? effectsApi?.DEFAULTS?.[field];
      effects[field] = typeof value === "number" ? normalizedInstrumentNumber(value) : value;
    }
    effects.bypassed = snapshot.bypassed === true;
    const normalizedEq = globalThis.SCParametricEQ?.normalize(snapshot.eq) || {
      enabled: snapshot.eq?.enabled !== false,
      hardClip: snapshot.eq?.hardClip === true,
      bands: Array.isArray(snapshot.eq?.bands) ? snapshot.eq.bands : [],
    };
    effects.eq = {
      enabled: normalizedEq.enabled !== false,
      hardClip: normalizedEq.hardClip === true,
      bands: normalizedEq.bands.map((band) => ({
        type: String(band.type || "peaking"),
        frequency: normalizedInstrumentNumber(band.frequency),
        gain: normalizedInstrumentNumber(band.gain),
        q: normalizedInstrumentNumber(band.q),
      })),
    };
    const descriptor = {
      signatureVersion: 1,
      trackIdentity: String(loopState.trackIdentity || ""),
      generation: Number.isInteger(loopState.generation) ? loopState.generation : null,
      trimRange: {
        startMs: normalizedInstrumentNumber(loopState.startMs),
        endMs: normalizedInstrumentNumber(loopState.endMs),
        durationMs: normalizedInstrumentNumber(loopState.durationMs),
      },
      playbackTransform: {
        rate: normalizedInstrumentNumber(playback.effectiveRate),
        preservePitch: playback.preservePitch === true,
      },
      effects,
    };
    return Object.freeze({ ...descriptor, signature: JSON.stringify(descriptor) });
  }

  function loopMatchesInstrumentSnapshot(snapshot = instrumentSnapshot) {
    return Boolean(snapshot && loopState.active &&
      snapshot.signature === buildInstrumentDescriptor().signature);
  }

  function disableInstrument(message = "") {
    cancelInstrumentRequest();
    instrumentIntentVersion += 1;
    instrumentPreparing = false;
    setInstrumentMode(false, { clearBuffer: true, message });
  }

  function exitInstrument({ clearBuffer = false, message = "" } = {}) {
    cancelInstrumentRequest();
    instrumentIntentVersion += 1;
    instrumentPreparing = false;
    setInstrumentMode(false, { clearBuffer, message });
    stopAllInstrumentVoices();
  }

  async function toggleLoopInstrument() {
    if (instrumentMode) {
      setInstrumentMode(false, { message: "" });
      return;
    }
    if (instrumentPreparing) {
      disableInstrument("");
      return;
    }
    if (!loopState.active || padRenderPending) return;
    const intentVersion = ++instrumentIntentVersion;
    instrumentPreparing = true;
    setInstrumentMode(false, { message: "Preparing loop instrument…" });
    const authorized = await authorizePlayerTools("play-loop-instrument", "loopInstrument");
    if (intentVersion !== instrumentIntentVersion || ui?.panel.hidden || document.hidden) return;
    if (!authorized || !capability("loopInstrument") || !loopState.active || padRenderPending) {
      instrumentPreparing = false;
      renderLoop();
      return;
    }
    if (instrumentBuffer && loopMatchesInstrumentSnapshot()) {
      const audio = controller.getActiveAudio();
      if (audio && !audio.paused) audio.pause();
      instrumentPreparing = false;
      setInstrumentMode(true);
      return;
    }
    const descriptor = buildInstrumentDescriptor();
    const duration = (descriptor.trimRange.endMs - descriptor.trimRange.startMs) /
      descriptor.playbackTransform.rate;
    if (duration > 30000) {
      instrumentPreparing = false;
      showDrumError("Instrument samples can be up to 30 seconds long. Shorten the loop or increase its speed.");
      renderLoop();
      return;
    }
    cancelLoopPadSelection();
    const audio = controller.getActiveAudio();
    if (audio && !audio.paused) audio.pause();
    instrumentSnapshot = descriptor;
    try {
      const operationId = `instrument_${Date.now()}_${++padRequestNumber}`;
      instrumentOperationId = operationId;
      const result = await requestPad("instrument", {
        operationId,
        trackUrl: descriptor.trackIdentity.replace(/^permalink:/, ""),
        trimRange: descriptor.trimRange,
        playbackTransform: descriptor.playbackTransform,
        effects: descriptor.effects,
        name: `Instrument ${(descriptor.trimRange.startMs / 1000).toFixed(1)}–${(descriptor.trimRange.endMs / 1000).toFixed(1)}s`,
      });
      if (intentVersion !== instrumentIntentVersion || !loopMatchesInstrumentSnapshot(descriptor)) return;
      const dataUrl = result.instrument?.dataUrl;
      if (!dataUrl) throw new Error("The prepared instrument audio is unavailable.");
      const response = await fetch(dataUrl);
      const buffer = await getDrumAudioContext().decodeAudioData(await response.arrayBuffer());
      if (intentVersion !== instrumentIntentVersion || !loopMatchesInstrumentSnapshot(descriptor)) return;
      instrumentBuffer = buffer;
      instrumentPreparing = false;
      instrumentOperationId = null;
      setInstrumentMode(true);
    } catch (error) {
      if (intentVersion !== instrumentIntentVersion) return;
      instrumentPreparing = false;
      instrumentOperationId = null;
      instrumentSnapshot = null;
      setInstrumentMode(false, { clearBuffer: true, message: error?.message || "Could not prepare this loop instrument." });
    }
  }

  async function playInstrumentNote(midiNote) {
    if (!capability("loopInstrument") || !instrumentMode || !instrumentBuffer) return;
    const noteRevision = ++instrumentNoteRevision;
    const buffer = instrumentBuffer;
    try {
      const context = getDrumAudioContext();
      if (context.state !== "running") {
        if (!instrumentResumePromise) {
          instrumentResumePromise = Promise.resolve(context.resume())
            .finally(() => { instrumentResumePromise = null; });
        }
        await instrumentResumePromise;
      }
      if (noteRevision !== instrumentNoteRevision || !capability("loopInstrument") ||
          !instrumentMode || instrumentBuffer !== buffer || ui?.panel.hidden || document.hidden) return;
      const previousVoice = instrumentVoice;
      instrumentVoice = null;
      releaseInstrumentVoice(previousVoice);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = globalThis.SCSamplerCore.playbackRateForMidi(midiNote);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(1, context.currentTime + 0.004);
      source.connect(gain).connect(context.destination);
      const voice = { source, gain, context, cleanupTimer: null, releasing: false, cleaned: false };
      instrumentVoices.add(voice);
      instrumentVoice = voice;
      source.onended = () => {
        cleanupInstrumentVoice(voice);
      };
      try {
        source.start();
        renderPlayingNote(midiNote);
      } catch (error) {
        cleanupInstrumentVoice(voice);
        throw error;
      }
    } catch (error) {
      if (noteRevision !== instrumentNoteRevision) return;
      showDrumError(error?.message || "Could not play the loop instrument.");
    }
  }

  async function loadDefaultDrum(pad) {
    if (pad.buffer) return pad.buffer;
    if (pad.loading) return pad.loading;
    if (!pad.sample && !pad.saved) throw new Error("Hold this pad to load a sample, or assign a loop to it.");
    const base = document.documentElement.getAttribute(EXTENSION_DRUM_SAMPLES_ATTRIBUTE);
    if (!base && !pad.saved) throw new Error("The drum samples are not ready yet.");
    const version = pad.version;
    pad.loading = (async () => {
      const url = pad.saved ? (await requestPad("get", { index: drumPads.indexOf(pad) })).pad?.dataUrl : new URL(pad.sample, base).href;
      if (!url) throw new Error("The saved sample is unavailable.");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${pad.name}.`);
      const buffer = await getDrumAudioContext().decodeAudioData(await response.arrayBuffer());
      if (pad.version === version) pad.buffer = buffer;
      return buffer;
    })();
    try { return await pad.loading; }
    finally { pad.loading = null; }
  }

  async function playDrum(index) {
    const pad = drumPads[index];
    if (!pad) return;
    try {
      const context = getDrumAudioContext();
      const ready = context.resume();
      const buffer = pad.buffer || await loadDefaultDrum(pad);
      await ready;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
      ui?.drumButtons[index].classList.add("is-active");
      setTimeout(() => ui?.drumButtons[index].classList.remove("is-active"), 140);
      showDrumError("");
    } catch (error) {
      showDrumError(error?.message || "Could not play this sample.");
    }
  }

  async function loadCustomDrum(index, file) {
    if (!file) return;
    if (drumPads[index]?.busy) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|ogg|m4a|flac|aac)$/i.test(file.name)) {
      showDrumError("Choose an audio file for this pad.");
      return;
    }
    const pad = drumPads[index];
    const version = ++pad.version;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("This sample is too large for a pad.");
      const bytes = await file.arrayBuffer();
      const buffer = await getDrumAudioContext().decodeAudioData(bytes.slice(0));
      const pcmBytes = buffer.length * buffer.numberOfChannels * 4;
      if (buffer.duration > 30 || pcmBytes > 16 * 1024 * 1024) {
        throw new Error("Samples must be 30 seconds or shorter and fit the pad memory limit.");
      }
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const name = file.name.replace(/\.[^.]+$/, "") || pad.name;
      await requestPad("store", { index, name, mimeType: file.type || "audio/wav", base64, operationId: `pad_${Date.now()}_${++padRequestNumber}` });
      if (pad.version !== version) return;
      pad.buffer = buffer;
      pad.saved = true;
      pad.customName = name;
      updateDrumLabels();
      showDrumError("");
    } catch (error) {
      showDrumError(error?.message || "Could not read that audio sample.");
    }
  }

  function handleDrumKeydown(event) {
    if (!ui || ui.panel.hidden || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (instrumentMode) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setInstrumentMode(false, { message: "" });
        ui.instrumentToggle?.focus();
        return;
      }
      const target = event.composedPath()[0];
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          instrumentOctave = globalThis.SCSamplerCore.shiftOctave(instrumentOctave, event.key === "ArrowLeft" ? -1 : 1);
          stopInstrumentVoice();
          renderInstrumentMessage();
        }
        return;
      }
      const midiNote = globalThis.SCSamplerCore.midiForEvent(event);
      if (midiNote === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) playInstrumentNote(midiNote + instrumentOctave * 12);
      return;
    }
    if (event.repeat) return;
    if (selectingLoopPad) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelLoopPadSelection();
      }
      return;
    }
    const target = event.composedPath()[0];
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
    if (!/^[a-z0-9]$/i.test(event.key)) return;
    const key = event.key.toLowerCase();
    if (hoveredDrum !== null) {
      drumPads.forEach((pad, index) => { if (index !== hoveredDrum && pad.key === key) pad.key = ""; });
      drumPads[hoveredDrum].key = key;
      try { localStorage.setItem(DRUM_KEYS_STORAGE, JSON.stringify(drumPads.map((pad) => pad.key))); } catch {}
      updateDrumLabels();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const index = drumPads.findIndex((pad) => pad.key === key);
    if (index < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    playDrum(index);
  }

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

  function requestAccess(type, operation, payload = {}, options = {}) {
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
        id, type, operation, requestId: options.requestId || id,
        expectedGeneration: options.expectedGeneration,
        sessionId: options.sessionId === undefined ? playerToolsSessionId : options.sessionId, payload,
      }));
      document.dispatchEvent(new CustomEvent(ACCESS_REQUEST_EVENT));
    });
  }

  async function finishLoopSession() {
    if (!playerToolsSessionId || accessSnapshot?.plan === "pro") return;
    await requestAccess("end", "end-session").catch(() => {});
    playerToolsSessionId = null;
  }

  function capability(name) {
    return accessSnapshot?.capabilities?.[name] === true;
  }

  function accessMessage(code) {
    if (code === "trial-expired") return "Your 7-day Player Tools trial has ended. Player Tools Pro is required to keep using this feature.";
    if (code === "trial-exhausted" || code === "pro-required") return "Player Tools Pro is required to keep using this feature.";
    if (code === "stale-generation") return "The track changed. Please set the loop again.";
    return "Player Tools access could not be confirmed. Please retry.";
  }

  async function authorizePlayerTools(operation, capabilityName, payload, options) {
    if (!capability(capabilityName)) {
      playbackFailure = accessMessage(accessSnapshot?.code || "trial-exhausted");
      render();
      return null;
    }
    const showPendingUi = options?.showPendingUi !== false;
    if (showPendingUi) {
      accessActionPending = true;
      render();
    }
    const result = await requestAccess("authorize", operation, payload, options).catch(() => ({ success: false, code: "access-error" }));
    if (showPendingUi) accessActionPending = false;
    if (!result?.success || !result.allowed) {
      playbackFailure = accessMessage(result?.code);
      render();
      return null;
    }
    return result;
  }

  document.addEventListener(ACCESS_EVENT, () => {
    readAccessSnapshot();
    render();
  });
  readAccessSnapshot();

  async function applyPlayerRate(rate, { animate = false } = {}) {
    const intent = { rate };
    rateIntent = intent;
    // Share the in-flight check so continuous input cannot starve playback:
    // each response applies the latest value, even while the thumb is moving.
    // Rate checks must not disable or blink the other playback controls.
    if (!rateAuthorization) {
      rateAuthorization = authorizePlayerTools("set-rate", "tempo", {}, { showPendingUi: false })
        .finally(() => { rateAuthorization = null; });
    }
    render();
    const authorization = await rateAuthorization;
    if (rateIntent !== intent) return;
    rateIntent = null;
    if (!authorization || !capability("tempo")) {
      render();
      return;
    }
    playbackFailure = "";
    animateNextRateChange = animate;
    const state = controller.setRate(rate);
    writeSetting(RATE_STORAGE, state.rate);
  }

  async function resetPlayerTools() {
    if (resetInProgress) return;
    resetInProgress = true;
    const generation = ++resetGeneration;
    playbackIntentVersion += 1;
    rateIntent = null;
    accessActionPending = false;
    effectIntentVersion += 1;
    loopIntentVersion += 1;
    waveformDrag = null;
    waveformDrawPreview = null;
    waveformZoom = null;
    const resetErrors = [];
    const attempt = (area, action) => {
      try { return action(); }
      catch (error) {
        resetErrors.push(`${area}: ${error?.message || "reset failed"}`);
        return null;
      }
    };
    try {
      playbackFailure = "";
      effectsFailure = "";
      loopFailure = "";
      animateNextRateChange = true;
      const state = attempt("Playback rate", () => controller.setRate(DEFAULTS.rate));
      attempt("Pitch", () => controller.setPreservePitch(DEFAULTS.preservePitch));
      attempt("Bypass", () => controller.setBypassed(false));
      if (state) attempt("Stored rate", () => writeSetting(RATE_STORAGE, state.rate));
      attempt("Stored pitch", () => writeSetting(PITCH_STORAGE, DEFAULTS.preservePitch));
      const effectsReset = attempt("FX", () => effectsController?.reset());
      effectWetMemory.reverb = DEFAULT_EFFECT_TOGGLE_WET;
      effectWetMemory.delay = DEFAULT_EFFECT_TOGGLE_WET;
      expandedEffectSettings = null;
      if (globalThis.SCParametricEQ) {
        const emptyEq = globalThis.SCParametricEQ.normalize(null);
        if (effectsController && !effectsReset) {
          attempt("EQ audio", () => effectsController.setEqualizer(emptyEq));
        }
        attempt("Stored EQ", () => writeSetting(EQ_STORAGE, JSON.stringify(emptyEq)));
        attempt("EQ editor", () => equalizerUi?.reset());
      }
      try { await clearLoop(); }
      catch (error) { resetErrors.push(`Loop: ${error?.message || "reset failed"}`); }
      if (generation !== resetGeneration) return;
      attempt("Loop bypass", () => requestLoop("set-global-bypass", { bypassed: false }));
      attempt("Loop state", readLoopState);
      if (resetErrors.length) effectsFailure = `Could not fully reset Player Tools. ${resetErrors.join("; ")}`;
    } finally {
      if (generation === resetGeneration) resetInProgress = false;
      render();
    }
  }

  async function applyPlayerPitch(enabled) {
    const intentVersion = playbackIntentVersion;
    const authorization = await authorizePlayerTools("set-preserve-pitch", "preservePitch");
    if (!authorization || intentVersion !== playbackIntentVersion) return;
    playbackFailure = "";
    const state = controller.setPreservePitch(enabled);
    writeSetting(PITCH_STORAGE, state.preservePitch);
  }

  async function savePlayerPreset(index) {
    const authorization = await authorizePlayerTools("save-preset", "savePreset");
    if (!authorization) return;
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

  if (globalThis.SCParametricEQ && effectsController) {
    try {
      const saved = JSON.parse(localStorage.getItem(EQ_STORAGE) || "null");
      if (saved) effectsController.setEqualizer(globalThis.SCParametricEQ.validate(saved));
    } catch { /* Invalid stored EQ must never prevent playback. */ }
  }

  function freeEffect(name) {
    return /^(reverb|delay)/.test(name || "");
  }

  function effectAllowed(name) {
    return capability(freeEffect(name) ? "freeEffects" : "premiumEffects");
  }

  async function applyEffect(change, name) {
    const intentVersion = effectIntentVersion;
    const authorization = await authorizePlayerTools(freeEffect(name) ? "set-free-effect" : "set-effect",
      freeEffect(name) ? "freeEffects" : "premiumEffects");
    if (!authorization || !effectAllowed(name) || intentVersion !== effectIntentVersion) return null;
    const state = change();
    effectsFailure = state?.available && !state.initialized
      ? "Play a track to activate FX."
      : "";
    render();
    return state;
  }

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
    const nextLoop = state.loop || { active: false, enabled: false };
    if (instrumentSnapshot && (
      !nextLoop.active ||
      nextLoop.trackIdentity !== instrumentSnapshot.trackIdentity ||
      nextLoop.generation !== instrumentSnapshot.generation ||
      nextLoop.startMs !== instrumentSnapshot.trimRange.startMs ||
      nextLoop.endMs !== instrumentSnapshot.trimRange.endMs ||
      (Number.isFinite(nextLoop.durationMs) ? nextLoop.durationMs : state.durationMs) !== instrumentSnapshot.trimRange.durationMs
    )) {
      disableInstrument("");
    }
    if (nextLoop.trackIdentity !== loopState.trackIdentity || nextLoop.generation !== loopState.generation) {
      loopIntentVersion += 1;
      const grant = accessSnapshot?.grant;
      if (grant && (grant.trackIdentity !== nextLoop.trackIdentity || grant.generation !== nextLoop.generation)) {
        finishLoopSession().catch(() => {});
      }
    }
    loopState = nextLoop;
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

  async function applyAuthorizedLoop(payload, options = {}) {
    const intentVersion = loopIntentVersion;
    const before = requestLoop("state")?.state;
    const currentLoop = before?.loop;
    const trackIdentity = currentLoop?.trackIdentity;
    const generation = currentLoop?.generation;
    const durationMs = currentLoop?.durationMs || before?.durationMs;
    if (!trackIdentity || !Number.isInteger(generation) || !Number.isFinite(durationMs)) {
      setLoopFailure({ error: "waiting-track" });
      return null;
    }
    const operation = currentLoop?.active ? "edit-loop" : "begin-loop";
    // A single marker is a draft, not an activated loop or a trial use.
    if (!Number.isFinite(payload.startMs) || !Number.isFinite(payload.endMs)) {
      if (!capability(operation === "begin-loop" ? "beginLoop" : "editLoop")) {
        playbackFailure = accessMessage(accessSnapshot?.code || "trial-exhausted");
        render();
        return null;
      }
      const response = requestLoop("set-loop", {
        ...payload, enabled: false, startPlayback: false, expectedGeneration: generation,
      });
      if (response?.ok) playbackFailure = "";
      setLoopFailure(response);
      readLoopState();
      return response;
    }
    const authorization = await authorizePlayerTools(operation, operation === "begin-loop" ? "beginLoop" : "editLoop", {
      trackIdentity,
      generation,
      startMs: payload.startMs,
      endMs: payload.endMs,
      durationMs,
    }, {
      expectedGeneration: generation,
      sessionId: operation === "edit-loop" ? playerToolsSessionId : null,
      showPendingUi: options.showPendingUi,
    });
    if (!authorization) return null;
    const after = requestLoop("state")?.state?.loop;
    if (intentVersion !== loopIntentVersion || after?.trackIdentity !== trackIdentity || after?.generation !== generation) {
      playbackFailure = accessMessage("stale-generation");
      await finishLoopSession();
      render();
      return null;
    }
    const response = requestLoop("set-loop", { ...payload, expectedGeneration: generation });
    if (response?.ok) playbackFailure = "";
    setLoopFailure(response);
    readLoopState();
    return response;
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
    if (!ui?.waveformCanvas || waveformCollapsed || ui.panel.hidden || document.hidden) return;
    const canvas = ui.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const windowRange = visibleWaveformWindow();
    const displayedRange = waveformDrawPreview || loopState;
    const drawKey = JSON.stringify([waveformRevision, width, height, scale,
      loopState.durationMs, windowRange?.startMs, windowRange?.endMs,
      displayedRange.startMs, displayedRange.endMs, loopState.active]);
    if (drawKey === waveformStaticKey) return;
    waveformStaticKey = drawKey;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0e1216";
    context.fillRect(0, 0, width, height);
    if (!windowRange) return;
    const durationMs = loopState.durationMs;
    const samples = waveformSamples.length ? waveformSamples : Array.from({ length: 180 }, (_, index) => 22 + Math.abs(Math.sin(index * 1.73) * 58 + Math.sin(index * .29) * 18));
    const first = Math.floor(windowRange.startMs / durationMs * samples.length);
    const last = Math.max(first + 1, Math.ceil(windowRange.endMs / durationMs * samples.length));
    const visible = samples.slice(first, last);
    const maximum = Math.max(1, ...visible.map((sample) => Math.abs(Number(sample) || 0)));
    const complete = Number.isFinite(displayedRange.startMs) && Number.isFinite(displayedRange.endMs);
    const start = complete ? loopPercentInWindow(displayedRange.startMs, windowRange) : -1;
    const end = complete ? loopPercentInWindow(displayedRange.endMs, windowRange) : -1;
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
  }

  function renderWaveformPlayhead() {
    if (!ui?.waveformPlayhead || waveformCollapsed || ui.panel.hidden || document.hidden) return;
    const windowRange = visibleWaveformWindow();
    const position = Number.isFinite(loopState.currentTimeMs) && windowRange
      ? loopPercentInWindow(loopState.currentTimeMs, windowRange) : null;
    const visible = position !== null && position >= 0 && position <= 100;
    if (ui.waveformPlayhead.hidden === visible) ui.waveformPlayhead.hidden = !visible;
    if (visible) {
      const left = `${position}%`;
      if (ui.waveformPlayhead.style.left !== left) ui.waveformPlayhead.style.left = left;
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
    waveformRevision += 1;
    const loadId = waveformLoadId += 1;
    if (Array.isArray(descriptor.samples)) { waveformSamples = descriptor.samples; waveformRevision += 1; renderLoop(); return; }
    if (!descriptor.waveformUrl) { renderLoop(); return; }
    try {
      const response = await fetch(descriptor.waveformUrl);
      const data = await response.json();
      if (loadId !== waveformLoadId) return;
      waveformSamples = Array.isArray(data.samples) ? data.samples : [];
    } catch { waveformSamples = []; }
    waveformRevision += 1;
    renderLoop();
  }

  function commitLoopRender() {
    loopRenderFrame = null;
    if (!ui?.waveformStage) return;
    const duration = Number.isFinite(loopState.durationMs) ? loopState.durationMs : 0;
    const displayedRange = waveformDrawPreview || loopState;
    const start = Number.isFinite(displayedRange.startMs) ? displayedRange.startMs : 0;
    const end = Number.isFinite(displayedRange.endMs) ? displayedRange.endMs : duration;
    const windowRange = visibleWaveformWindow();
    const startPercent = loopPercentInWindow(start, windowRange);
    const endPercent = loopPercentInWindow(end, windowRange);
    const presentationKey = JSON.stringify({
      waveformCollapsed, duration, start: displayedRange.startMs, end: displayedRange.endMs,
      preview: Boolean(waveformDrawPreview), active: loopState.active, available: loopState.available, windowRange,
      loopDownloadPending, padRenderPending, saveAllowed: capability("saveLoopPad"),
      instrumentAllowed: capability("loopInstrument"), instrumentMode, instrumentPreparing,
    });
    if (presentationKey !== loopPresentationKey) {
      loopPresentationKey = presentationKey;
      sectionControllers.loop?.setCollapsed(waveformCollapsed, { notify: false });
    ui.waveformSelection.style.left = `${startPercent}%`;
    ui.waveformSelection.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    ui.waveformSelection.hidden = !waveformDrawPreview && !loopState.active;
    for (const [marker, value, letter] of [[ui.waveformStart, displayedRange.startMs, "a"], [ui.waveformEnd, displayedRange.endMs, "b"]]) {
      marker.hidden = !Number.isFinite(value) || !windowRange || value < windowRange.startMs || value > windowRange.endMs;
      marker.style.left = `${loopPercentInWindow(value, windowRange)}%`;
      marker.textContent = letter;
      marker.setAttribute("aria-valuenow", String(Math.round(value || 0)));
      marker.setAttribute("aria-valuetext", formatLoopTime(value));
    }
    for (const button of [ui.setA, ui.headerSetA]) {
      const fixed = Number.isFinite(loopState.startMs);
      const time = fixed ? formatLoopTime(loopState.startMs) : "";
      button.textContent = fixed ? time : "Set A";
      button.classList.toggle("has-loop-point", fixed);
      button.title = fixed ? `${time} · Hold to remove A` : "Set loop start at the current position";
      button.setAttribute("aria-label", fixed ? `Loop start A at ${time}. Hold to remove.` : "Set loop start at the current position");
      button.disabled = !loopState.available;
    }
    for (const button of [ui.setB, ui.headerSetB]) {
      const fixed = Number.isFinite(loopState.endMs);
      const time = fixed ? formatLoopTime(loopState.endMs) : "";
      button.textContent = fixed ? time : "Set B";
      button.classList.toggle("has-loop-point", fixed);
      button.title = fixed ? `${time} · Hold to remove B` : "Set loop end at the current position";
      button.setAttribute("aria-label", fixed ? `Loop end B at ${time}. Hold to remove.` : "Set loop end at the current position");
      button.disabled = !loopState.available;
    }
    const hasLoopMarker = Number.isFinite(loopState.startMs) || Number.isFinite(loopState.endMs);
    ui.clearLoop.disabled = !loopState.available || !hasLoopMarker || loopDownloadPending;
    ui.downloadLoop.disabled = !loopState.active || loopDownloadPending;
    ui.saveLoopPad.disabled = !capability("saveLoopPad") || !loopState.active || padRenderPending;
    ui.saveLoopPad.title = capability("saveLoopPad") ? "Save loop to a pad" : "Player Tools Pro required";
    ui.instrumentToggle.disabled = !capability("loopInstrument") || !loopState.active || padRenderPending;
    ui.instrumentToggle.setAttribute("aria-pressed", String(instrumentMode));
    ui.instrumentToggle.classList.toggle("is-preparing", instrumentPreparing);
    ui.instrumentToggle.setAttribute("aria-label", instrumentPreparing
      ? "Cancel loop instrument preparation"
      : instrumentMode ? "Disable piano mode" : "Play selected loop in piano mode");
    ui.instrumentToggle.title = instrumentPreparing
      ? "Preparing loop instrument…"
      : instrumentMode ? "Disable piano mode" : "Play selected loop in piano mode";
    if (!capability("loopInstrument")) ui.instrumentToggle.title = "Player Tools Pro required";
    for (const [input, value] of [[ui.loopStartTime, loopState.startMs], [ui.loopEndTime, loopState.endMs]]) {
      input.disabled = !loopState.available || duration <= 0;
      if (ui.root.activeElement !== input) input.value = Number.isFinite(value) ? formatLoopTime(value) : "";
    }
    ui.waveformStartLabel.textContent = formatLoopTime(windowRange?.startMs || 0);
    ui.waveformMiddleLabel.textContent = formatLoopTime(windowRange ? (windowRange.startMs + windowRange.endMs) / 2 : 0);
    ui.waveformEndLabel.textContent = formatLoopTime(windowRange?.endMs || duration);
    }
    drawWaveform();
    renderWaveformPlayhead();
  }

  function renderLoop() {
    if (loopRenderFrame !== null) return;
    if (typeof requestAnimationFrame === "function") {
      loopRenderFrame = requestAnimationFrame(commitLoopRender);
    } else {
      loopRenderFrame = true;
      queueMicrotask(commitLoopRender);
    }
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
      waveformRevision += 1;
      waveformStaticKey = "";
      ui.waveformCanvas.width = 1;
      ui.waveformCanvas.height = 1;
    }

    renderLoop();
    renderControlsVisibility();
    if (!waveformCollapsed && !ui.panel.hidden) {
      loadPlayerWaveform();
      setTimeout(renderLoop, 180);
    }
    if (!ui.panel.hidden) positionPanel();
  }

  function setEffectsCollapsed(collapsed) {
    effectsCollapsed = Boolean(collapsed);
    sectionControllers.effects?.setCollapsed(effectsCollapsed, { notify: false });
    renderControlsVisibility();
    if (!ui.panel.hidden) positionPanel();
  }

  function areAllControlsCollapsed() {
    return samplerCollapsed && waveformCollapsed && effectsCollapsed && Boolean(equalizerUi?.isCollapsed());
  }

  function renderControlsVisibility() {
    if (!ui?.visibilityButton) return;
    const allCollapsed = areAllControlsCollapsed();
    const action = controlsHidden
      ? { label: "Show and expand all controls", icon: "expand", state: "hidden" }
      : allCollapsed
        ? { label: "Hide all controls", icon: "up", state: "collapsed" }
        : { label: "Collapse all controls", icon: "down", state: "normal" };
    ui.panel.classList.toggle("controls-hidden", controlsHidden);
    ui.controlsHiddenMessage.hidden = !controlsHidden;
    ui.visibilityButton.dataset.state = action.state;
    ui.visibilityButton.setAttribute("aria-label", action.label);
    ui.visibilityButton.title = action.label;
    ui.visibilityUpIcon.toggleAttribute("hidden", action.icon !== "up");
    ui.visibilityDownIcon.toggleAttribute("hidden", action.icon !== "down");
    ui.visibilityExpandIcon.hidden = action.icon !== "expand";
    equalizerUi?.setVisible(!ui.panel.hidden && !controlsHidden);
  }

  function setAllControlsCollapsed(collapsed) {
    setSamplerCollapsed(collapsed);
    setWaveformCollapsed(collapsed);
    setEffectsCollapsed(collapsed);
    equalizerUi?.setCollapsed(collapsed, { notify: false });
    renderControlsVisibility();
  }

  function cycleControlsVisibility() {
    if (controlsHidden) {
      controlsHidden = false;
      setAllControlsCollapsed(false);
    } else if (areAllControlsCollapsed()) {
      controlsHidden = true;
      renderControlsVisibility();
    } else {
      setAllControlsCollapsed(true);
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
    await applyAuthorizedLoop(payload);
  }

  async function unsetLoopPoint(marker) {
    const liveState = requestLoop("state")?.state;
    if (liveState) {
      loopState = { ...(liveState.loop || loopState), available: liveState.available === true, currentTimeMs: liveState.currentTimeMs, durationMs: liveState.loop?.durationMs || liveState.durationMs };
    }
    const key = `${marker}Ms`;
    if (!Number.isFinite(loopState[key])) return;
    const startMs = marker === "start" ? null : loopState.startMs;
    const endMs = marker === "end" ? null : loopState.endMs;
    if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) {
      await clearLoop();
      return;
    }
    await applyAuthorizedLoop({ marker, startMs, endMs, enabled: false, startPlayback: false });
    if (!loopState.active) await finishLoopSession();
  }

  function bindLoopSetter(button, marker) {
    let timer = null;
    let longPressed = false;
    const cancelTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const beginHold = () => {
      if (!Number.isFinite(loopState[`${marker}Ms`])) return;
      longPressed = false;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        longPressed = true;
        unsetLoopPoint(marker);
      }, LONG_PRESS_MS);
    };
    button.addEventListener("pointerdown", (event) => { if (event.button === 0) beginHold(); });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
      button.addEventListener(eventName, cancelTimer);
    }
    button.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) beginHold();
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === "Enter" || event.key === " ") cancelTimer();
    });
    button.addEventListener("blur", cancelTimer);
    button.addEventListener("click", (event) => {
      if (longPressed) {
        event.preventDefault();
        longPressed = false;
        return;
      }
      setLoopPoint(marker);
    });
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
    await applyAuthorizedLoop(payload);
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
    await applyAuthorizedLoop(payload);
  }

  async function clearLoop() {
    loopIntentVersion += 1;
    disableInstrument("");
    setLoopFailure(requestLoop("clear-loop"));
    await finishLoopSession();
    readLoopState();
  }

  async function setWaveformRange(nextRange, marker = null, options = {}) {
    if (!nextRange) return;
    const payload = { ...nextRange, marker, enabled: true, startPlayback: !loopState.active };
    await applyAuthorizedLoop(payload, options);
  }

  function beginWaveformDrag(event, kind) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!Number.isFinite(loopState.durationMs)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    waveformDrag = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      anchorMs: kind === "create" ? waveformTime(event.clientX) : null,
      moved: false,
      range: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs },
    };
  }

  function moveWaveformDrag(event) {
    if (!waveformDrag || waveformDrag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const core = globalThis.SCLooperCore;
    const timeMs = waveformTime(event.clientX);
    if (!core || timeMs === null) return;
    if (waveformDrag.kind === "create" && Math.abs(event.clientX - waveformDrag.startX) < 3) return;
    let nextRange;
    if (waveformDrag.kind === "create") {
      waveformDrag.moved = true;
      nextRange = core.createRangeFromSelection(
        waveformDrag.range.durationMs,
        waveformDrag.anchorMs,
        timeMs
      );
      waveformDrawPreview = nextRange;
      renderLoop();
      return;
    } else if (waveformDrag.kind === "selection") {
      const startTime = waveformTime(waveformDrag.startX);
      nextRange = core.moveRange(waveformDrag.range, timeMs - startTime);
    } else {
      nextRange = core.moveMarker(waveformDrag.range, waveformDrag.kind, timeMs);
    }
    // Pointer movement can issue several overlapping authorization requests.
    // Keep unrelated header controls interactive while those edits are checked.
    setWaveformRange(nextRange, ["selection", "create"].includes(waveformDrag.kind) ? null : waveformDrag.kind, {
      showPendingUi: false,
    });
  }

  function endWaveformDrag(event) {
    if (!waveformDrag || waveformDrag.pointerId !== event.pointerId) return;
    moveWaveformDrag(event);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (waveformDrag.kind === "create" && waveformDrag.moved) {
      suppressWaveformClick = true;
      const nextRange = waveformDrawPreview;
      setTimeout(() => { suppressWaveformClick = false; }, 0);
      setWaveformRange(nextRange, null, { showPendingUi: false }).finally(() => {
        if (waveformDrawPreview === nextRange) waveformDrawPreview = null;
        renderLoop();
      });
    }
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

  function cancelLoopPadSelection() {
    if (!selectingLoopPad) return;
    selectingLoopPad = null;
    ui?.drumSection.classList.remove("is-selecting");
    ui?.saveLoopPad.setAttribute("aria-pressed", "false");
    showDrumError("");
  }

  function selectLoopPad() {
    if (selectingLoopPad) { cancelLoopPadSelection(); return; }
    if (!capability("saveLoopPad") || !loopState.active || padRenderPending) return;
    if (instrumentPreparing) disableInstrument("");
    else if (instrumentMode) setInstrumentMode(false, { message: "" });
    const state = controller.snapshot();
    const duration = (loopState.endMs - loopState.startMs) / state.effectiveRate;
    if (duration > 30000) {
      showDrumError("Pad samples can be up to 30 seconds long. Shorten the loop or increase its speed.");
      return;
    }
    selectingLoopPad = {
      trackUrl: String(loopState.trackIdentity || "").replace(/^permalink:/, ""),
      trimRange: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs },
      playbackTransform: { rate: state.effectiveRate, preservePitch: state.preservePitch },
      effects: effectsController?.snapshot() || {},
      name: `Loop ${(loopState.startMs / 1000).toFixed(1)}–${(loopState.endMs / 1000).toFixed(1)}s`,
    };
    setSamplerCollapsed(false);
    ui.drumSection.classList.add("is-selecting");
    ui.saveLoopPad.setAttribute("aria-pressed", "true");
    showDrumError("Choose one of the six pads. Press Escape to cancel.");
  }

  async function saveLoopToPad(index) {
    if (!capability("saveLoopPad") || !selectingLoopPad || padRenderPending) return;
    const sample = selectingLoopPad;
    selectingLoopPad = null;
    ui.drumSection.classList.remove("is-selecting");
    ui.saveLoopPad.setAttribute("aria-pressed", "false");
    const pad = drumPads[index];
    pad.busy = true;
    padRenderPending = true;
    updateDrumLabels();
    renderLoop();
    showDrumError(`Preparing loop for pad ${index + 1}…`);
    try {
      const operationId = `pad_${Date.now()}_${++padRequestNumber}`;
      const result = await requestPad("render", { index, operationId, ...sample });
      pad.version += 1;
      pad.buffer = null;
      pad.loading = null;
      pad.saved = true;
      pad.customName = result.pad?.name || sample.name;
      showDrumError(`Loop saved to pad ${index + 1}.`);
    } catch (error) {
      showDrumError(error?.message || "Could not save this loop to a pad.");
    } finally {
      pad.busy = false;
      padRenderPending = false;
      updateDrumLabels();
      renderLoop();
    }
  }

  function showDownloadStatus(message, { dismissAfter = null } = {}) {
    if (downloadStatusTimer !== null) {
      clearTimeout(downloadStatusTimer);
      downloadStatusTimer = null;
    }
    loopFailure = message;
    render();
    if (dismissAfter === null) return;
    downloadStatusTimer = setTimeout(() => {
      downloadStatusTimer = null;
      // Do not erase a newer status, such as a subsequent download error.
      if (loopFailure !== message) return;
      loopFailure = "";
      render();
    }, dismissAfter);
  }

  function waitForDownloadResult(eventName, id, request) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        document.removeEventListener(eventName, listener);
        resolve(result);
      };
      const timeout = setTimeout(
        () => finish({ success: false, error: "Download request timed out." }),
        DOWNLOAD_REQUEST_TIMEOUT_MS
      );
      const listener = (event) => {
        if (event.detail?.id === id) finish(event.detail);
      };
      document.addEventListener(eventName, listener);
      try {
        request();
      } catch (error) {
        finish({ success: false, error: error?.message || "Could not start download request." });
      }
    });
  }

  async function downloadLoopFromPlayer() {
    if (!loopState.active || !Number.isFinite(loopState.startMs) || !Number.isFinite(loopState.endMs)) {
      showDownloadStatus("Set both loop markers before downloading.");
      return;
    }
    const id = `loop-export-${Date.now()}`;
    loopDownloadPending = true;
    showDownloadStatus("Preparing loop download…");
    const result = await waitForDownloadResult(LOOP_EXPORT_RESULT_EVENT, id, () => {
      document.documentElement.setAttribute(LOOP_EXPORT_ATTRIBUTE, JSON.stringify({
        id,
        trackIdentity: loopState.trackIdentity,
        generation: loopState.generation,
        trimRange: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs },
        playbackTransform: { rate: controller.snapshot().effectiveRate, preservePitch: controller.snapshot().preservePitch },
        effects: effectsController?.snapshot() || {},
      }));
      document.dispatchEvent(new CustomEvent(LOOP_EXPORT_EVENT));
    });
    document.documentElement.removeAttribute(LOOP_EXPORT_ATTRIBUTE);
    loopDownloadPending = false;
    showDownloadStatus(result?.success ? "Loop download started." : (result?.error || "Could not start loop download."));
  }

  async function downloadCurrentTrack() {
    if (trackDownloadPending) return;
    const id = `track-export-${Date.now()}`;
    trackDownloadPending = true;
    showDownloadStatus("Preparing track download…");
    const result = await waitForDownloadResult(TRACK_EXPORT_RESULT_EVENT, id, () => {
      const state = controller.snapshot();
      document.documentElement.setAttribute(TRACK_EXPORT_ATTRIBUTE, JSON.stringify({
        id,
        playbackTransform: { rate: state.effectiveRate, preservePitch: state.preservePitch },
        effects: effectsController?.snapshot() || {},
      }));
      document.dispatchEvent(new CustomEvent(TRACK_EXPORT_EVENT));
    });
    document.documentElement.removeAttribute(TRACK_EXPORT_ATTRIBUTE);
    trackDownloadPending = false;
    showDownloadStatus(
      result?.success ? "Track download started." : (result?.error || "Could not start track download."),
      { dismissAfter: result?.success ? DOWNLOAD_STATUS_DURATION_MS : null }
    );
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
          font-family: Interstate, "Lucida Grande", Arial, sans-serif;
          font-size: 12px;
          line-height: 1.4;
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
          cursor: pointer;
          opacity: .9;
        }

        .clear-rate .cross-icon { width: 12px; height: 12px; }

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
          font-size: 17px;
          font-weight: 700;
          line-height: 1.2;
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
          font-size: 13px;
          font-weight: 500;
          line-height: 1;
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
          font-size: 15px;
          font-weight: 500;
          line-height: 1.2;
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
        .middle-row { display: grid; grid-template-columns: 159px 1fr; align-items: center; gap: 10px; margin-bottom: 6px; }
        .setters { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
        .setter { min-width: 0; height: 30px; padding: 0 5px; border: 1px solid #484848; border-radius: 6px; background: #292929; color: #fff; font-size: 10px; font-style: italic; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; }
        .setter.has-loop-point { font-style: normal; font-variant-numeric: tabular-nums; }
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
        .clear-loop, .download-loop { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; border-radius: 5px; cursor: pointer; font-size: 10px; font-weight: 600; line-height: 1; }
        .clear-loop { border: 1px solid #484848; color: #fff; background: #292929; }
        .download-loop { border: 1px solid #b84400; color: #fff; background: #ff5500; }
        .save-loop-pad, .loop-instrument { display: grid; place-items: center; width: 24px; height: 26px; padding: 0; border: 1px solid #484848; border-radius: 5px; color: #d6d6d6; background: #292929; cursor: pointer; }
        .save-loop-pad:hover, .save-loop-pad[aria-pressed="true"], .loop-instrument:hover, .loop-instrument[aria-pressed="true"] { color: #fff; border-color: #ff7b38; }
        .loop-instrument[aria-pressed="true"] { color: #ff8a4c; background: #462619; }
        .loop-instrument.is-preparing svg { animation: instrument-pulse .8s ease-in-out infinite alternate; }
        @keyframes instrument-pulse { to { opacity: .35; transform: scale(.88); } }
        .save-loop-pad svg, .loop-instrument svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        .clear-loop:disabled, .download-loop:disabled, .save-loop-pad:disabled, .loop-instrument:disabled { cursor: not-allowed; opacity: .45; }
        .clear-loop svg, .clear-loop img, .download-loop svg { width: 12px; height: 12px; flex: 0 0 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .status { margin-top: 5px; }

        /* Expanded player editor, compact enough to stay clear of the player. */
        .panel { width: min(420px, calc(100vw - 16px)); max-height: calc(100vh - 64px); overflow-y: auto; padding: 7px; border: 1px solid #262626; border-radius: 14px; background: linear-gradient(145deg, #171717, #050505); box-shadow: 0 16px 50px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.04); scrollbar-width: thin; scrollbar-color: #4b4b4b transparent; }
        .panel-header { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; grid-template-rows: 32px; align-items: center; column-gap: 5px; row-gap: 2px; padding-bottom: 6px; }
        .drum-section { margin: 0 0 6px; overflow: hidden; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); }
        .sampler-body { padding: 6px 7px; }
        .drum-pads { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
        .drum-pad { display: flex; flex-direction: row; align-items: center; justify-content: center; width: 100%; height: 28px; padding: 3px 6px; border: 1px solid #4a4a4a; border-radius: 8px; color: #fff; background: #292929; font: inherit; cursor: pointer; user-select: none; touch-action: manipulation; transition: transform 90ms ease, background-color 90ms ease, border-color 90ms ease; }
        .drum-slot:nth-child(2) .drum-pad { background: #383838; }
        .drum-slot:nth-child(3) .drum-pad { background: #464646; }
        .drum-slot:nth-child(4) .drum-pad { background: #343434; }
        .drum-pad:hover, .drum-pad.is-holding { border-color: #ff7b38; }
        .drum-pad.is-active { transform: scale(.95); border-color: #ff5500; background: #713516 !important; }
        .drum-section.is-selecting .drum-pad { border-color: #ff7b38; box-shadow: 0 0 0 1px rgba(255, 123, 56, .25); }
        .drum-pad.is-saving { opacity: .55; cursor: progress; }
        .drum-pad:focus-visible { outline: 2px solid #ff5500; outline-offset: 2px; }
        .drum-key { flex: 0 0 auto; font-size: 14px; font-weight: 800; line-height: 1; }
        .drum-file { display: none; }
        .drum-status { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0; padding: 4px 7px 6px; color: #ffb199; font-size: 10px; line-height: 1.2; }
        .drum-status[hidden] { display: none; }
        .drum-message { min-width: 0; }
        .playing-note { flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; }
        .brand { display: contents; }
        .brand-logo { width: 32px; height: 32px; flex-basis: 32px; border-radius: 8px; object-fit: cover; }
        .panel-header .brand-logo { grid-column: 1; grid-row: 1; }
        .brand-copy { display: flex; grid-column: 2; grid-row: 1; align-items: center; min-width: 0; }
        .brand-title-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .brand-name { font-size: 16px; line-height: 1.1; text-align: left; white-space: nowrap; }
        .free-badge { display: inline-flex; align-items: center; gap: 3px; height: 17px; padding: 0 5px; border: 1px solid #22c55e; border-radius: 4px; color: #86efac; background: rgba(34, 197, 94, .14); font-size: 9px; font-weight: 800; line-height: 1; letter-spacing: .04em; }
        .plan-badge-icon { display: none; width: 11px; height: 11px; object-fit: contain; filter: invert(1) brightness(2); }
        .free-badge.is-pro { border-color: #8b5cf6; color: #f5f3ff; background: #32105e; box-shadow: 0 0 0 0 rgba(139, 92, 246, .32); animation: pro-badge-glow 2.8s ease-in-out infinite; }
        .free-badge.is-pro .plan-badge-icon { display: block; animation: pro-badge-icon-float 2.8s ease-in-out infinite; }
        @keyframes pro-badge-glow { 50% { border-color: #a78bfa; box-shadow: 0 0 0 2px rgba(139, 92, 246, .14), 0 0 10px rgba(124, 58, 237, .22); } }
        @keyframes pro-badge-icon-float { 50% { transform: translateY(-.5px); opacity: .86; } }
        .presets { display: grid; order: 0; grid-template-columns: 1fr; gap: 2px; width: 32px; margin: 0; justify-self: center; flex-basis: auto; }
        .preset { width: 32px; height: 12px; border-radius: 3px; font-size: 8px; }
        .custom-preset, .custom-preset[data-saved="true"] { width: 32px; padding: 0 1px; font-size: 7px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .setter { height: 28px; padding: 0 8px; border-radius: 7px; font-size: 11px; font-variant-numeric: tabular-nums; }
        .tempo-row { display: grid; grid-template-columns: minmax(0, 1fr) 32px 22px auto; align-items: center; gap: 5px; margin-bottom: 6px; }
        .pitch-label { display: grid; place-items: center; width: 22px; height: 26px; margin: 0; padding: 0; cursor: help; }
        .pitch-toggle { width: 16px; height: 16px; margin: 0; }
        .speed-status { position: static; align-self: center; justify-self: end; min-width: 0; height: 26px; justify-content: center; gap: 3px; }
        .current { width: 6ch; flex: 0 0 auto; font-size: 13px; }
        .current.is-bypassed { color: #d6d6d6; }
        .bypass { width: 20px; height: 22px; }
        .bypass svg { width: 19px; height: 19px; }
        .slider-wrap { height: 26px; margin: 0; border: 1px solid #30373e; border-radius: 7px; background: rgba(255,255,255,.025); padding: 0; }
        .slider { height: 24px; border-radius: 6px; background-size: 100% 100%; }
        .slider::-webkit-slider-runnable-track { height: 9px; border-radius: 999px; }
        .slider::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -2.5px; box-shadow: 0 0 0 2px #fff; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; }
        .limits { inset-inline: 0; padding: 0 6px; font-size: 8px; text-shadow: 0 1px 2px #000; }
        .range-label { top: 50%; padding: 0; border-radius: 0; background: transparent; font-size: 8px; text-shadow: 0 1px 2px #000; transform: translate(-50%, -50%); }
        .waveform-shell { position: relative; overflow: hidden; height: 130px; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); touch-action: none; transition: height 160ms ease; }
        .waveform-shell.is-collapsed { height: 32px; touch-action: auto; }
        .waveform-stage { position: absolute; inset: 34px 8px 27px; cursor: crosshair; }
        .waveform-canvas { display: block; width: 100%; height: 100%; border-radius: 8px; }
        .waveform-playhead { position: absolute; z-index: 4; inset: 0 auto 0 0; width: 1px; background: rgba(255,255,255,.72); pointer-events: none; }
        .waveform-selection { position: absolute; inset: 0 auto 0; border: 0; border-inline: 1px solid #ff741f; background: linear-gradient(90deg, rgba(255, 145, 85, .28), rgba(255, 106, 26, .055) 50%, rgba(255, 145, 85, .28)); cursor: grab; }
        .waveform-marker { position: absolute; z-index: 7; top: -2px; width: 18px; height: 18px; margin-left: -9px; padding: 0; border: 0; border-radius: 5px 5px 3px 3px; color: #fff; background: #ff741f; font-size: 11px; font-weight: 800; line-height: 1; text-transform: lowercase; cursor: ew-resize; box-shadow: 0 2px 7px rgba(255, 116, 31, .28); }
        .waveform-marker::after { content: ""; position: absolute; top: 18px; left: 50%; width: 1px; height: 90px; background: #ff741f; transform: translateX(-50%); }
        .waveform-times { position: absolute; inset: auto 9px 3px; display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; color: #7e8790; font-size: 10px; font-variant-numeric: tabular-nums; }
        .waveform-start-label { justify-self: start; }
        .waveform-middle-label { justify-self: center; }
        .waveform-end-label { justify-self: end; }
        .waveform-header-setters { display: flex; gap: 4px; }
        .waveform-shell:not(.is-collapsed) .waveform-header-setters { display: none; }
        .waveform-header-setters .setter { min-width: 39px; height: 23px; padding: 0 6px; border-radius: 5px; font-size: 9px; }
        .waveform-setters { display: contents; }
        .waveform-times .setter { z-index: 5; width: 68px; height: 23px; padding: 0 6px; border-radius: 6px; font-size: 10px; transform: translateY(-2px); }
        .player-tools-upgrade { display: none; position: absolute; z-index: 12; inset: 3px; border: 1px solid #ff6a1a; border-radius: 7px; color: #fff; background: #3d2115; font-size: 10px; font-weight: 700; line-height: 1; cursor: pointer; }
        .waveform-shell.is-locked { height: 34px; touch-action: auto; }
        .waveform-shell.is-locked .waveform-stage, .waveform-shell.is-locked .waveform-times, .waveform-shell.is-locked .waveform-actions, .waveform-shell.is-locked .waveform-toggle { display: none; }
        .waveform-shell.is-locked .player-tools-upgrade { display: block; left: auto; right: 4px; width: 172px; }

        .effects-shell { margin-top: 7px; overflow: hidden; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); }
        .effect-bypass { width: 23px; height: 23px; padding: 0; border: 1px solid #4b5157; border-radius: 5px; color: #9ca3aa; background: #202428; font-size: 11px; font-weight: 800; line-height: 1; cursor: pointer; }
        .effect-bypass[aria-pressed="true"] { border-color: #c95819; color: #ff7b38; background: #3a251b; }
        .effect-bypass:hover:not(:disabled) { border-color: #ff7b38; color: #fff; }
        .effect-bypass:disabled { cursor: not-allowed; opacity: .45; }
        .effect-bypass:focus-visible { outline: 2px solid #ff5500; outline-offset: 1px; }

        .effects-body { padding: 0 9px 4px; }
        .effects-presets { display: flex; gap: 4px; padding: 3px 0 5px; }
        .effects-preset { flex: 1; height: 22px; padding: 0 3px; border: 1px solid #3b4249; border-radius: 5px; color: #bfc4c8; background: #202428; font-size: 9px; font-weight: 600; line-height: 1; cursor: pointer; }
        .effects-preset:hover, .effects-preset[aria-pressed="true"] { border-color: #ff6a1a; color: #fff; background: #462619; }
        .effect-row { display: grid; grid-template-columns: 62px minmax(0, 1fr) 34px 22px; align-items: center; gap: 7px; min-height: 31px; border-top: 1px solid rgba(255,255,255,.055); }
        .effect-label { color: #d5d8db; font-size: 11px; font-weight: 500; line-height: 1; }
        .effect-slider { appearance: none; -webkit-appearance: none; width: 100%; height: 20px; margin: 0; border: 0; background: linear-gradient(to right, #ff5500 var(--range-fill, 0%), #30373e var(--range-fill, 0%)) center / 100% 6px no-repeat; cursor: pointer; }
        .effect-slider:disabled { cursor: not-allowed; opacity: .45; }
        .effect-slider::-webkit-slider-runnable-track { height: 6px; background: transparent; }
        .effect-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin-top: -3.5px; border: 2px solid #f3f3f3; border-radius: 50%; background: #aeb5bc; }
        .effect-slider[data-active="true"]::-webkit-slider-thumb { background: #ff7b38; }
        .effect-slider::-moz-range-track { height: 6px; background: #30373e; }
        .effect-slider::-moz-range-progress { height: 6px; background: #ff5500; }
        .effect-slider::-moz-range-thumb { width: 11px; height: 11px; border: 1px solid #f3f3f3; border-radius: 50%; background: #ff7b38; }
        .effect-value { color: #bfc4c8; font-size: 10px; font-weight: 500; line-height: 1; text-align: right; font-variant-numeric: tabular-nums; }
        .effect-settings-toggle { width: 20px; height: 20px; padding: 0; border: 0; color: #858c92; background: transparent; font-size: 16px; line-height: 1; cursor: pointer; }
        .effect-settings-toggle:hover, .effect-settings-toggle[aria-expanded="true"] { color: #ff7b38; }
        .effect-settings { display: none; grid-template-columns: 62px minmax(0, 1fr) 34px; gap: 4px 7px; padding: 4px 0 6px 69px; border-top: 1px solid rgba(255,255,255,.045); }
        .effect-settings.is-open { display: grid; }
        .effect-setting-label { align-self: center; color: #9da3a8; font-size: 9px; font-weight: 500; line-height: 1; }
        .effect-setting-slider { width: 100%; accent-color: #ff5500; }
        .effect-setting-value { align-self: center; color: #bfc4c8; font-size: 9px; font-weight: 500; line-height: 1; text-align: right; }
        .effect-room { height: 21px; border: 1px solid #3b4249; border-radius: 4px; color: #e8e8e8; background: #202428; font-size: 9px; font-weight: 500; }
        .effects-note { margin: 0 0 3px 69px; color: #858c92; font-size: 9px; line-height: 1.2; }
        .panel-tools { display: flex; grid-column: 3; grid-row: 1; justify-self: end; align-self: center; gap: 3px; margin-left: 0; }
        .panel-tool { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 23px; height: 20px; margin: 0; padding: 0; border: 1px solid rgba(255,255,255,.2); border-radius: 4px; color: #fff; background: rgba(255,255,255,.08); cursor: pointer; outline: none; transition: background-color 200ms, border-color 200ms; }
        .panel-tool:hover { color: #fff; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.14); }
        .panel-tool:focus-visible { border-color: rgba(255,85,0,.65); }
        .panel-tool:disabled { opacity: .48; cursor: wait; }
        .panel-tool[aria-pressed="true"] { color: #ff6a1a; border-color: #ff6a1a; }
        .panel-tool svg { display: block; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .panel-tool .cross-icon { display:block; width:12px; height:12px; }
        .panel-tool-icon { display:block; width:13px; height:13px; object-fit:contain; filter:brightness(0) invert(1); }
        .detach-button[aria-pressed="true"] .panel-tool-icon { filter:brightness(0) saturate(100%) invert(56%) sepia(93%) saturate(1985%) hue-rotate(336deg) brightness(104%) contrast(101%); }
        @media (max-width: 360px) {
          .panel-header { grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 3px; }
          .brand-logo { width: 28px; height: 28px; border-radius: 7px; }
          .brand-name { font-size: 11px; }
          .free-badge { height: 14px; padding: 0 3px; font-size: 7px; }
          .current { font-size: 11px; }
          .panel-tool { width: 20px; }
          .drum-pad { padding-inline: 4px; }
          .bypass, .bypass svg { width: 16px; height: 16px; }
        }
        .clear-loop, .download-loop { height: 22px; padding: 0 6px; border-radius: 6px; opacity: .82; }
        .save-loop-pad, .loop-instrument { width: 22px; height: 22px; }
        .loop-edit { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
        ${collapsible.styles}
        .drum-section, .waveform-shell, .effects-shell { transition:height 160ms ease; }
        .drum-section > .tool-section-header .tool-section-heading { padding-right:58px; }
        .waveform-shell > .tool-section-header .tool-section-heading,
        .effects-shell > .tool-section-header .tool-section-heading { padding-right:164px; }
        .effect-group-title { margin: 5px 0 2px; color: #858c92; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .effect-freeze { grid-column: 1 / -1; height: 24px; border: 1px solid #4b5157; border-radius: 5px; color: #d5d8db; background: #202428; font-size: 10px; font-weight: 700; cursor: pointer; }
        .effect-freeze:hover:not(:disabled), .effect-freeze[aria-pressed="true"] { border-color: #ff6a1a; color: #fff; background: #462619; }
        .effect-freeze:disabled { cursor: not-allowed; opacity: .45; }
        .sampler-icon { width:14px; height:14px; filter:brightness(0) invert(1); }
        .waveform-body { display:contents; }
        .controls-hidden > .drum-section,
        .controls-hidden > .waveform-shell,
        .controls-hidden > .effects-shell,
        .controls-hidden > .peq { display:none !important; }
        .controls-hidden-message { margin:5px 2px 1px; color:#aeb4b9; font-size:10px; line-height:1.45; text-align:center; }
        .visibility-symbol { display:block; width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .visibility-up-icon { stroke-width:1.7; }
        .visibility-expand-icon { width:13px; height:13px; }

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
        <button class="clear-rate" type="button" aria-label="Reset Player Tools" title="Reset Player Tools" hidden><img class="cross-icon" alt="" aria-hidden="true" /></button>
      </span>
      <section
        class="panel"
        role="dialog"
        aria-label="Playback speed and loop"
        hidden
      >
        <div class="panel-header">
        <div class="brand">
          <img class="brand-logo" width="42" height="42" alt="" draggable="false" hidden />
          <div class="brand-copy">
            <div class="brand-title-line"><button class="brand-name" type="button" aria-label="Open the Looper guide">SCTD Player Tools</button><span class="free-badge" aria-label="Player Tools Free plan"><img class="plan-badge-icon" alt="" aria-hidden="true" /><span class="plan-badge-label">FREE</span></span></div>
          </div>
        </div>
        <div class="panel-tools" role="group" aria-label="Panel options">
          <button class="panel-tool download-track-button" type="button" aria-label="Download current playing" title="Download current playing">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
          </button>
          <button class="panel-tool reset-tools-button" type="button" aria-label="Reset playback, Loop, FX and EQ. Samples are kept." title="Reset playback, Loop, FX and EQ. Samples are kept.">
            <img class="panel-tool-icon trash-icon" alt="" aria-hidden="true" hidden />
          </button>
          <button class="panel-tool detach-button" type="button" aria-label="Keep panel open when clicking outside" aria-pressed="false" title="Keep panel open when clicking outside">
            <img class="panel-tool-icon detach-icon" alt="" aria-hidden="true" hidden />
          </button>
          <button class="panel-tool visibility-button" type="button" aria-controls="scdl-sampler scdl-loop-region scdl-audio-effects scdl-parametric-eq" aria-label="Collapse all controls" title="Collapse all controls"><svg class="visibility-symbol visibility-up-icon" viewBox="0 0 16 16" aria-hidden="true" hidden><path d="M3.5 8h9" /></svg><svg class="visibility-symbol visibility-down-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6.5 4.5 4 4.5-4" /></svg><img class="panel-tool-icon visibility-expand-icon" alt="" aria-hidden="true" hidden /></button>
          <button class="panel-tool close-button" type="button" aria-label="Close panel" title="Close panel">
            <img class="cross-icon" alt="" aria-hidden="true" />
          </button>
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
          <div class="presets" role="group" aria-label="Quick playback speeds">
            ${customRates.map((rate, index) => `<button class="preset custom-preset" type="button" data-custom-index="${index}" data-saved="true" aria-pressed="false" title="Saved speed ${formatRate(rate)}. Hold to replace">${formatRate(rate)}</button>`).join("")}
          </div>
          <label class="pitch-label" title="Keep tone"><input class="pitch-toggle" type="checkbox" aria-label="Keep tone" title="Keep tone" /></label>
        <div class="speed-status">
          <output class="current">1x</output>
          <button class="bypass" type="button" aria-label="Bypass loop and playback effects" aria-pressed="false" title="Bypass loop and playback effects">${BYPASS_ICON}</button>
        </div>
        </div>
        <section class="drum-section is-collapsed" id="scdl-sampler" aria-label="Sampler">
          ${collapsible.header({ title: "Sampler", bodyId: "scdl-sampler-pads", expanded: false, toggleClass: "sampler-toggle", actionsClass: "sampler-actions", icon: '<img class="tool-section-icon sampler-icon" alt="" aria-hidden="true" />', actions: '<button class="save-loop-pad" type="button" aria-label="Save loop to a pad" aria-pressed="false" title="Save loop to a pad"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button><button class="loop-instrument" type="button" aria-label="Play selected loop in piano mode" aria-pressed="false" title="Play selected loop in piano mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM7 5v8M12 5v8M17 5v8M5 13h4M10 13h4M15 13h4"/></svg></button>' })}
          <div class="sampler-body" id="scdl-sampler-pads">
            <div class="drum-pads">
              ${drumPads.map((pad, index) => `<div class="drum-slot"><button class="drum-pad" type="button" data-drum-index="${index}"><span class="drum-key">${pad.key.toUpperCase()}</span></button><input class="drum-file" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a" tabindex="-1" aria-label="Load sample for ${pad.name}" /></div>`).join("")}
            </div>
          </div>
          <p class="drum-status" role="status" aria-live="polite" hidden><span class="drum-message"></span><span class="playing-note" aria-live="off"></span></p>
        </section>
        <section class="waveform-shell" id="scdl-loop-region" role="group" aria-label="Loop Region">
          ${collapsible.header({ title: "Loop Region", bodyId: "scdl-loop-region-body", toggleClass: "waveform-toggle", headerClass: "waveform-header", actionsClass: "waveform-actions", icon: '<svg class="tool-section-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8.5 5 6 2.5 8.5M5 6v7a3.5 3.5 0 0 0 6 2.5l2-2a3.5 3.5 0 0 1 6 2.5v2M16.5 15.5 19 18l2.5-2.5"/></svg>', actions: '<div class="waveform-header-setters"><button class="setter header-set-a" type="button" aria-label="Set loop start">Set A</button><button class="setter header-set-b" type="button" aria-label="Set loop end">Set B</button></div><button class="clear-loop" type="button" aria-label="Clear loop"><img class="cross-icon" alt="" aria-hidden="true" /><span>Clear</span></button><button class="download-loop" type="button" aria-label="Download loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span>WAV</span></button>' })}
          <div class="waveform-body" id="scdl-loop-region-body">
          <div class="waveform-stage">
            <canvas class="waveform-canvas" aria-hidden="true"></canvas>
            <div class="waveform-playhead" aria-hidden="true" hidden></div>
            <div class="waveform-selection" hidden></div>
            <button class="waveform-marker waveform-start" type="button" role="slider" aria-label="Loop start A">A</button>
            <button class="waveform-marker waveform-end" type="button" role="slider" aria-label="Loop end B">B</button>
          </div>
          <div class="waveform-times"><span class="waveform-start-label">00:00.000</span><div class="waveform-setters"><button class="setter set-a" type="button">Set A</button></div><span class="waveform-middle-label">00:00.000</span><div class="waveform-setters"><button class="setter set-b" type="button">Set B</button></div><span class="waveform-end-label">00:00.000</span></div>
          <button class="player-tools-upgrade" type="button">Get Player Tools Pro</button>
          </div>
        </section>
        <div class="loop-edit">
          <input class="loop-time loop-start-time" inputmode="decimal" placeholder="A 00:00.000" aria-label="Loop start time" />
          <input class="loop-time loop-end-time" inputmode="decimal" placeholder="B 00:00.000" aria-label="Loop end time" />
        </div>
        <section class="effects-shell is-collapsed" id="scdl-audio-effects" aria-label="FX">
          ${collapsible.header({ title: "FX", bodyId: "scdl-audio-effects-body", expanded: false, toggleClass: "effects-toggle", headerClass: "effects-header", actionsClass: "effect-bypasses", icon: '<svg class="tool-section-icon effects-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2l2-7 4 14 3-11 2 7h2l1-3h2"/></svg>', actions: '<button class="effect-bypass" type="button" data-effect-bypass="reverb" aria-label="Enable reverb" aria-pressed="false">R</button><button class="effect-bypass" type="button" data-effect-bypass="delay" aria-label="Enable echo" aria-pressed="false">E</button><button class="effect-bypass" type="button" data-effect-bypass="flanger" aria-label="Enable flanger" aria-pressed="false">F</button><button class="effect-bypass" type="button" data-effect-bypass="phaser" aria-label="Enable phaser" aria-pressed="false">P</button><button class="effect-bypass" type="button" data-effect-bypass="bitcrusher" aria-label="Enable bitcrusher" aria-pressed="false">B</button><button class="effect-bypass" type="button" data-effect-bypass="saturation" aria-label="Enable saturation" aria-pressed="false">S</button>' })}
          <div class="effects-body" id="scdl-audio-effects-body">
            <div class="effects-presets" role="group" aria-label="FX presets"><button class="effects-preset" data-fx-preset="subtle" type="button">Subtle</button><button class="effects-preset" data-fx-preset="studio" type="button">Studio</button><button class="effects-preset" data-fx-preset="wide" type="button">Wide</button><button class="effects-preset" data-fx-preset="dub" type="button">Dub</button></div>
            <p class="effect-group-title">Space</p>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-reverb">Reverb</label><input class="effect-slider" id="scdl-effect-reverb" type="range" min="0" max="100" step="1" value="0" aria-label="Reverb mix" title="Reverb mix; 0% turns it off" /><output class="effect-value" data-effect-value="reverb">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="reverb" aria-label="Reverb settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="reverb"><label class="effect-setting-label" for="scdl-effect-reverb-room">Room</label><select class="effect-room" id="scdl-effect-reverb-room" data-effect-character="reverbRoom"><option value="room">Room</option><option value="hall">Hall</option><option value="plate">Plate</option></select><span></span><label class="effect-setting-label" for="scdl-effect-reverb-size">Size</label><input class="effect-setting-slider" id="scdl-effect-reverb-size" type="range" min="0" max="100" value="55" data-effect-character="reverbSize" /><output class="effect-setting-value" data-effect-character-value="reverbSize">55%</output><label class="effect-setting-label" for="scdl-effect-reverb-decay">Decay</label><input class="effect-setting-slider" id="scdl-effect-reverb-decay" type="range" min="0.2" max="12" step="0.1" value="2.4" data-effect-character="reverbDecay" /><output class="effect-setting-value" data-effect-character-value="reverbDecay">2.4s</output><label class="effect-setting-label" for="scdl-effect-reverb-predelay">Pre-delay</label><input class="effect-setting-slider" id="scdl-effect-reverb-predelay" type="range" min="0" max="200" value="20" data-effect-character="reverbPreDelay" /><output class="effect-setting-value" data-effect-character-value="reverbPreDelay">20ms</output><label class="effect-setting-label" for="scdl-effect-reverb-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-reverb-tone" type="range" min="0" max="100" value="70" data-effect-character="reverbTone" /><output class="effect-setting-value" data-effect-character-value="reverbTone">70%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-delay">Echo</label><input class="effect-slider" id="scdl-effect-delay" type="range" min="0" max="100" step="1" value="0" aria-label="Echo mix" title="Echo mix; 0% turns it off" /><output class="effect-value" data-effect-value="delay">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="delay" aria-label="Echo settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="delay"><label class="effect-setting-label" for="scdl-effect-delay-time">Time</label><input class="effect-setting-slider" id="scdl-effect-delay-time" type="range" min="60" max="800" value="250" data-effect-character="delayTime" /><output class="effect-setting-value" data-effect-character-value="delayTime">250ms</output><label class="effect-setting-label" for="scdl-effect-delay-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-delay-feedback" type="range" min="0" max="100" value="25" data-effect-character="delayFeedback" /><output class="effect-setting-value" data-effect-character-value="delayFeedback">25%</output><label class="effect-setting-label" for="scdl-effect-delay-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-delay-tone" type="range" min="0" max="100" value="70" data-effect-character="delayTone" /><output class="effect-setting-value" data-effect-character-value="delayTone">70%</output><button class="effect-freeze" type="button" data-effect-freeze aria-label="Hold to freeze echo" aria-pressed="false">Hold to Freeze</button></div>
            <p class="effect-group-title">Motion</p>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-flanger">Flanger</label><input class="effect-slider" id="scdl-effect-flanger" type="range" min="0" max="100" step="1" value="0" aria-label="Flanger mix" /><output class="effect-value" data-effect-value="flanger">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="flanger" aria-label="Flanger settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="flanger"><label class="effect-setting-label" for="scdl-effect-flanger-rate">Rate</label><input class="effect-setting-slider" id="scdl-effect-flanger-rate" type="range" min="0.05" max="5" step="0.05" data-effect-character="flangerRate" /><output class="effect-setting-value" data-effect-character-value="flangerRate"></output><label class="effect-setting-label" for="scdl-effect-flanger-depth">Depth</label><input class="effect-setting-slider" id="scdl-effect-flanger-depth" type="range" min="0" max="100" data-effect-character="flangerDepth" /><output class="effect-setting-value" data-effect-character-value="flangerDepth"></output><label class="effect-setting-label" for="scdl-effect-flanger-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-flanger-feedback" type="range" min="0" max="100" data-effect-character="flangerFeedback" /><output class="effect-setting-value" data-effect-character-value="flangerFeedback"></output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-phaser">Phaser</label><input class="effect-slider" id="scdl-effect-phaser" type="range" min="0" max="100" step="1" value="0" aria-label="Phaser mix" /><output class="effect-value" data-effect-value="phaser">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="phaser" aria-label="Phaser settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="phaser"><label class="effect-setting-label" for="scdl-effect-phaser-rate">Rate</label><input class="effect-setting-slider" id="scdl-effect-phaser-rate" type="range" min="0.05" max="5" step="0.05" data-effect-character="phaserRate" /><output class="effect-setting-value" data-effect-character-value="phaserRate"></output><label class="effect-setting-label" for="scdl-effect-phaser-depth">Depth</label><input class="effect-setting-slider" id="scdl-effect-phaser-depth" type="range" min="0" max="100" data-effect-character="phaserDepth" /><output class="effect-setting-value" data-effect-character-value="phaserDepth"></output><label class="effect-setting-label" for="scdl-effect-phaser-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-phaser-feedback" type="range" min="0" max="100" data-effect-character="phaserFeedback" /><output class="effect-setting-value" data-effect-character-value="phaserFeedback"></output></div>
            <p class="effect-group-title">Color</p>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-saturation">Saturation</label><input class="effect-slider" id="scdl-effect-saturation" type="range" min="0" max="100" step="1" value="0" aria-label="Saturation mix" /><output class="effect-value" data-effect-value="saturation">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="saturation" aria-label="Saturation settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="saturation"><label class="effect-setting-label" for="scdl-effect-saturation-drive">Drive</label><input class="effect-setting-slider" id="scdl-effect-saturation-drive" type="range" min="0" max="100" data-effect-character="saturationDrive" /><output class="effect-setting-value" data-effect-character-value="saturationDrive"></output><label class="effect-setting-label" for="scdl-effect-saturation-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-saturation-tone" type="range" min="0" max="100" data-effect-character="saturationTone" /><output class="effect-setting-value" data-effect-character-value="saturationTone"></output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-bitcrusher">Bitcrusher</label><input class="effect-slider" id="scdl-effect-bitcrusher" type="range" min="0" max="100" step="1" value="0" aria-label="Bitcrusher mix" /><output class="effect-value" data-effect-value="bitcrusher">0%</output><button class="effect-settings-toggle" type="button" data-effect-settings="bitcrusher" aria-label="Bitcrusher settings" aria-expanded="false">⚙</button></div>
            <div class="effect-settings" data-effect-settings-panel="bitcrusher"><label class="effect-setting-label" for="scdl-effect-bit-depth">Bits</label><input class="effect-setting-slider" id="scdl-effect-bit-depth" type="range" min="2" max="16" step="1" data-effect-character="bitDepth" /><output class="effect-setting-value" data-effect-character-value="bitDepth"></output><label class="effect-setting-label" for="scdl-effect-sample-rate-reduction">Downsample</label><input class="effect-setting-slider" id="scdl-effect-sample-rate-reduction" type="range" min="0" max="100" data-effect-character="sampleRateReduction" /><output class="effect-setting-value" data-effect-character-value="sampleRateReduction"></output></div>
            <p class="effects-note">Mix · open ⚙ for character</p>
          </div>
        </section>
        <p class="controls-hidden-message" hidden>press maximize button again to show controls</p>
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
    equalizerUi?.setVisible(open && !controlsHidden);
    ui.trigger.setAttribute("aria-expanded", String(open));
    setVolumeLayerOpen(open);
    renderControlsVisibility();
    if (open) {
      positionPanel();
      renderLoop();
    }
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
    if (ui.panel.hidden) ui.panel.scrollTop = 0;
    setPanelOpen(true);
    document.dispatchEvent(new CustomEvent(PLAYER_TOOLS_OPENED_EVENT));
    if (!waveformCollapsed) loadPlayerWaveform();
  }

  document.addEventListener(OPEN_PLAYER_TOOLS_PANEL_EVENT, () => {
    mount();
    if (ui) openPanel("click");
  });

  function closePanel() {
    clearHoverTimers();
    panelOpenMode = null;
    hoveredDrum = null;
    cancelLoopPadSelection();
    exitInstrument({ message: "" });
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
      crossIcons: [...root.querySelectorAll(".cross-icon")],
      panel: root.querySelector(".panel"),
      drumButtons: [...root.querySelectorAll(".drum-pad")],
      drumFiles: [...root.querySelectorAll(".drum-file")],
      drumSection: root.querySelector(".drum-section"),
      samplerToggle: root.querySelector(".sampler-toggle"),
      samplerIcon: root.querySelector(".sampler-icon"),
      drumMessage: root.querySelector(".drum-message"),
      drumStatus: root.querySelector(".drum-status"),
      playingNote: root.querySelector(".playing-note"),
      slider: root.querySelector(".slider"),
      pitchToggle: root.querySelector(".pitch-toggle"),
      current: root.querySelector(".current"),
      triggerLogo: root.querySelector(".trigger-icon"),
      triggerRate: root.querySelector(".trigger-rate"),
      bypass: root.querySelector(".bypass"),
      status: root.querySelector(".status"),
      brandLogo: root.querySelector(".brand-logo"),
      brandName: root.querySelector(".brand-name"),
      planBadge: root.querySelector(".free-badge"),
      planBadgeIcon: root.querySelector(".plan-badge-icon"),
      planBadgeLabel: root.querySelector(".plan-badge-label"),
      downloadTrackButton: root.querySelector(".download-track-button"),
      detachButton: root.querySelector(".detach-button"),
      detachIcon: root.querySelector(".detach-icon"),
      resetToolsButton: root.querySelector(".reset-tools-button"),
      trashIcon: root.querySelector(".trash-icon"),
      visibilityButton: root.querySelector(".visibility-button"),
      visibilityUpIcon: root.querySelector(".visibility-up-icon"),
      visibilityDownIcon: root.querySelector(".visibility-down-icon"),
      visibilityExpandIcon: root.querySelector(".visibility-expand-icon"),
      controlsHiddenMessage: root.querySelector(".controls-hidden-message"),
      setA: root.querySelector(".set-a"),
      setB: root.querySelector(".set-b"),
      headerSetA: root.querySelector(".header-set-a"),
      headerSetB: root.querySelector(".header-set-b"),
      waveformShell: root.querySelector(".waveform-shell"),
      waveformToggle: root.querySelector(".waveform-toggle"),
      waveformBody: root.querySelector(".waveform-body"),
      waveformActions: root.querySelector(".waveform-actions"),
      waveformStage: root.querySelector(".waveform-stage"),
      waveformCanvas: root.querySelector(".waveform-canvas"),
      waveformPlayhead: root.querySelector(".waveform-playhead"),
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
      saveLoopPad: root.querySelector(".save-loop-pad"),
      instrumentToggle: root.querySelector(".loop-instrument"),
      playerToolsUpgrade: root.querySelector(".player-tools-upgrade"),
      effectsShell: root.querySelector(".effects-shell"),
      effectsToggle: root.querySelector(".effects-toggle"),
      effectsBody: root.querySelector(".effects-body"),
      effectBypasses: Object.fromEntries(
        EFFECT_NAMES.map((name) => [name, root.querySelector(`[data-effect-bypass="${name}"]`)])
      ),
      effectSliders: Object.fromEntries(
        EFFECT_NAMES.map((name) => [name, root.querySelector(`#scdl-effect-${name}`)])
      ),
      effectValues: Object.fromEntries(
        EFFECT_NAMES.map((name) => [name, root.querySelector(`[data-effect-value="${name}"]`)])
      ),
      effectFreeze: root.querySelector("[data-effect-freeze]"),
      effectCharacters: Object.fromEntries(
        [...root.querySelectorAll("[data-effect-character]")].map((control) => [control.dataset.effectCharacter, control])
      ),
      effectCharacterValues: Object.fromEntries(
        [...root.querySelectorAll("[data-effect-character-value]")].map((output) => [output.dataset.effectCharacterValue, output])
      ),
    };

    sectionControllers.sampler = collapsible.mount({
      section: ui.drumSection,
      toggle: ui.samplerToggle,
      body: root.querySelector(".sampler-body"),
      collapsed: samplerCollapsed,
      onChange(value) { samplerCollapsed = value; renderControlsVisibility(); if (!ui.panel.hidden) positionPanel(); },
    });
    sectionControllers.loop = collapsible.mount({
      section: ui.waveformShell,
      toggle: ui.waveformToggle,
      body: ui.waveformBody,
      collapsed: waveformCollapsed,
      onChange: setWaveformCollapsed,
    });
    sectionControllers.effects = collapsible.mount({
      section: ui.effectsShell,
      toggle: ui.effectsToggle,
      body: ui.effectsBody,
      collapsed: effectsCollapsed,
      onChange: setEffectsCollapsed,
    });

    updateDrumLabels();
    ui.drumButtons.forEach((button, index) => {
      const input = ui.drumFiles[index];
      let pressedAt = 0;
      let holdTimer = null;
      let suppressClick = false;
      const clearHold = () => {
        if (holdTimer !== null) clearTimeout(holdTimer);
        holdTimer = null;
        button.classList.remove("is-holding");
      };
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") hoveredDrum = index;
      });
      button.addEventListener("pointerleave", () => {
        if (hoveredDrum === index) hoveredDrum = null;
      });
      button.addEventListener("pointerdown", (event) => {
        if (selectingLoopPad || drumPads[index].busy) return;
        if (event.button !== 0) return;
        pressedAt = performance.now();
        holdTimer = setTimeout(() => button.classList.add("is-holding"), DRUM_LONG_PRESS_MS);
      });
      button.addEventListener("pointerup", (event) => {
        const held = pressedAt && performance.now() - pressedAt >= DRUM_LONG_PRESS_MS;
        pressedAt = 0;
        clearHold();
        if (!held || event.button !== 0) return;
        suppressClick = true;
        input.click();
        setTimeout(() => { suppressClick = false; }, 0);
      });
      button.addEventListener("pointercancel", () => { pressedAt = 0; clearHold(); });
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("keydown", (event) => {
        if (!event.shiftKey || !["Enter", " "].includes(event.key)) return;
        if (drumPads[index].busy) return;
        event.preventDefault();
        event.stopPropagation();
        input.click();
      });
      button.addEventListener("click", (event) => {
        if (suppressClick) { event.preventDefault(); suppressClick = false; return; }
        if (selectingLoopPad) { saveLoopToPad(index); return; }
        playDrum(index);
      });
      input.addEventListener("change", () => {
        loadCustomDrum(index, input.files?.[0]);
        input.value = "";
      });
    });
    document.addEventListener("keydown", handleDrumKeydown, true);
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
      resetPlayerTools();
    });
    ui.brandName.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });
    ui.downloadTrackButton.addEventListener("click", downloadCurrentTrack);
    ui.resetToolsButton.addEventListener("click", resetPlayerTools);
    ui.visibilityButton.addEventListener("click", cycleControlsVisibility);
    root.querySelector(".close-button").addEventListener("click", () => {
      closePanel();
      ui.trigger.focus({ preventScroll: true });
    });
    ui.playerToolsUpgrade.addEventListener("click", (event) => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent(OPEN_PLAYER_TOOLS_PRO_EVENT));
    });
    ui.detachButton.addEventListener("click", () => {
      panelDetached = !panelDetached;
      try { localStorage.setItem(DETACH_STORAGE, String(panelDetached)); } catch {}
      // Leaving detach returns to the persistent click mode, so the next
      // outside click is the explicit close action even if it began as hover.
      if (!panelDetached && !ui.panel.hidden) panelOpenMode = "click";
      render();
    });
    for (const [name, slider] of Object.entries(ui.effectSliders)) {
      slider.addEventListener("change", async () => {
        const value = slider.valueAsNumber;
        const state = await applyEffect(() => effectsController?.set(name, value), name);
        if (state?.[name] > 0) effectWetMemory[name] = state[name];
      });
    }
    for (const [name, button] of Object.entries(ui.effectBypasses)) {
      button.addEventListener("click", async () => {
        const current = effectsController?.snapshot();
        if (!current?.available) return;
        const nextWet = current[name] > 0 ? 0 : effectWetMemory[name] || DEFAULT_EFFECT_TOGGLE_WET;
        const state = await applyEffect(() => effectsController.set(name, nextWet), name);
        if (state?.[name] > 0) effectWetMemory[name] = state[name];
      });
    }
    root.querySelectorAll(".effect-settings-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.effectSettings;
        expandedEffectSettings = expandedEffectSettings === name ? null : name;
        renderEffects();
        if (!ui.panel.hidden) positionPanel();
      });
    });
    root.querySelectorAll(".effects-preset").forEach((button) => {
      button.addEventListener("click", () => {
        applyEffect(() => effectsController?.applyPreset(button.dataset.fxPreset));
      });
    });
    for (const [name, control] of Object.entries(ui.effectCharacters)) {
      control.addEventListener("change", () => {
        const value = control.value;
        applyEffect(() => effectsController?.setCharacter(name, value), name);
      });
    }
    const releaseEchoFreeze = () => {
      if (!effectsController?.isDelayFrozen?.()) return;
      effectsController.setDelayFreeze(false);
      renderEffects();
    };
    ui.effectFreeze.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || ui.effectFreeze.disabled) return;
      event.preventDefault();
      ui.effectFreeze.setPointerCapture?.(event.pointerId);
      effectsController?.setDelayFreeze(true);
      renderEffects();
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      ui.effectFreeze.addEventListener(eventName, releaseEchoFreeze);
    }
    ui.effectFreeze.addEventListener("keydown", (event) => {
      if (![' ', 'Enter'].includes(event.key) || event.repeat || ui.effectFreeze.disabled) return;
      event.preventDefault();
      effectsController?.setDelayFreeze(true);
      renderEffects();
    });
    ui.effectFreeze.addEventListener("keyup", (event) => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      releaseEchoFreeze();
    });
    const exitForPageLifecycle = () => {
      releaseEchoFreeze();
      exitInstrument({ message: "" });
    };
    window.addEventListener("blur", exitForPageLifecycle);
    window.addEventListener("pagehide", exitForPageLifecycle);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) exitForPageLifecycle();
      else renderLoop();
    });
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
      requestLoop("set-global-bypass", { bypassed: bypassed || !capability("tempo") });
      readLoopState();
    });
    for (const button of [ui.setA, ui.headerSetA]) bindLoopSetter(button, "start");
    for (const button of [ui.setB, ui.headerSetB]) bindLoopSetter(button, "end");
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
    ui.waveformCanvas.addEventListener("pointerdown", (event) => beginWaveformDrag(event, "create"));
    ui.waveformCanvas.addEventListener("pointermove", moveWaveformDrag);
    ui.waveformCanvas.addEventListener("pointerup", endWaveformDrag);
    ui.waveformCanvas.addEventListener("pointercancel", endWaveformDrag);
    ui.waveformStage.addEventListener("wheel", handleWaveformWheel, { passive: false });
    ui.waveformStage.addEventListener("dblclick", () => { waveformZoom = null; renderLoop(); });
    ui.waveformCanvas.addEventListener("click", (event) => {
      if (suppressWaveformClick) {
        suppressWaveformClick = false;
        event.preventDefault();
        return;
      }
      const timeMs = waveformTime(event.clientX);
      if (timeMs !== null) requestLoop("seek", { timeMs });
    });
    for (const [input, marker] of [[ui.loopStartTime, "start"], [ui.loopEndTime, "end"]]) {
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commitLoopTime(marker); input.blur(); } if (event.key === "Escape") { input.value = Number.isFinite(loopState[`${marker}Ms`]) ? formatLoopTime(loopState[`${marker}Ms`]) : ""; input.blur(); } });
      input.addEventListener("blur", () => { if (input.value.trim()) commitLoopTime(marker); });
    }
    ui.clearLoop.addEventListener("click", clearLoop);
    ui.downloadLoop.addEventListener("click", downloadLoopFromPlayer);
    ui.saveLoopPad.addEventListener("click", selectLoopPad);
    ui.instrumentToggle.addEventListener("click", toggleLoopInstrument);
    ui.playerToolsUpgrade.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent(OPEN_LOOPER_GUIDE_EVENT));
    });

    if (globalThis.SCParametricEQUI && effectsController) {
      equalizerUi = globalThis.SCParametricEQUI.mount({
        container: ui.panel,
        effects: effectsController,
        isAllowed: () => capability("parametricEq"),
        authorize: () => authorizePlayerTools("set-eq", "parametricEq", {}, { showPendingUi: false }),
        onChange(settings) {
          writeSetting(EQ_STORAGE, JSON.stringify(settings));
          render();
        },
        onCollapsedChange() {
          renderControlsVisibility();
          if (!ui.panel.hidden) positionPanel();
        },
      });
    }
    renderControlsVisibility();
    render();
    syncBrandLogo();
    hydrateDrumPads();
    readLoopState();
    return host;
  }

  function render() {
    if (!ui) return;
    const playbackAllowed = capability("tempo");
    const isPro = accessSnapshot?.plan === "pro";
    effectsController?.setEqualizerAllowed(capability("parametricEq"));
    if (!capability("premiumEffects")) {
      const fx = effectsController?.snapshot();
      for (const name of EFFECT_NAMES) {
        if (!freeEffect(name) && fx?.[name] > 0) effectsController.set(name, 0);
      }
    }
    if (!capability("loopInstrument") && (instrumentMode || instrumentPreparing || instrumentBuffer)) disableInstrument();
    if (!capability("saveLoopPad") && selectingLoopPad) cancelLoopPadSelection();
    ui.planBadgeLabel.textContent = isPro ? "PRO" : "FREE";
    ui.planBadge.classList.toggle("is-pro", isPro);
    ui.planBadge.setAttribute("aria-label", isPro ? "Player Tools Pro active" : "Player Tools Free plan");
    if (!playbackAllowed && !accessLocked) {
      accessLocked = true;
      controller.setRate(DEFAULTS.rate);
      controller.setPreservePitch(false);
      requestLoop("set-global-bypass", { bypassed: true });
    } else if (playbackAllowed && accessLocked) {
      accessLocked = false;
      controller.setRate(readStoredRate());
      controller.setPreservePitch(readStoredPitch());
      requestLoop("set-global-bypass", { bypassed: controller.snapshot().bypassed });
    }
    const state = controller.snapshot();
    const text = formatRate(state.effectiveRate);
    const triggerText = formatTriggerRate(state.effectiveRate);
    const animateRate = animateNextRateChange;
    animateNextRateChange = false;
    ui.trigger.setAttribute("aria-label", `Playback speed ${triggerText}`);
    // Keep the thumb under the pointer while access is checked asynchronously.
    ui.slider.value = String(playbackAllowed && rateIntent ? rateIntent.rate : state.rate);
    ui.slider.setAttribute("aria-valuetext", formatRate(state.rate));
    ui.bypass.setAttribute("aria-pressed", String(state.bypassed));
    ui.current.classList.toggle("is-bypassed", state.bypassed);
    ui.triggerRate.classList.toggle("is-bypassed", state.bypassed);
    ui.bypass.title = state.bypassed
      ? "Bypass on — restore all Player Tools"
      : "Bypass all Player Tools";
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
    const effectsState = effectsController?.snapshot();
    ui.clearRate.hidden = state.rate === DEFAULTS.rate &&
      state.preservePitch === DEFAULTS.preservePitch && !state.bypassed &&
      !(EFFECT_NAMES.some((name) => effectsState?.[name] > 0) || effectsState?.eq?.bands.length) && !loopState.active;
    ui.clearRate.disabled = resetInProgress;
    ui.resetToolsButton.disabled = resetInProgress;
    // Disabling a native range during input cancels its ongoing mouse drag.
    ui.slider.disabled = !playbackAllowed;
    ui.pitchToggle.disabled = !playbackAllowed || !state.preservePitchSupported || accessActionPending;
    ui.bypass.disabled = accessActionPending;
    ui.root.querySelectorAll(".preset").forEach((button) => { button.disabled = !playbackAllowed || accessActionPending; });
    ui.waveformShell.classList.toggle("is-locked", !playbackAllowed);
    ui.waveformToggle.disabled = !playbackAllowed || accessActionPending;
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
    const effectiveBypass = state.bypassed;
    if (effectsBypassed !== effectiveBypass) {
      effectsBypassed = effectiveBypass;
      effectsController?.setBypassed(effectsBypassed);
    }
    if (instrumentSnapshot && !loopMatchesInstrumentSnapshot()) disableInstrument("");
    renderRate(state.effectiveRate, animateRate);
    ui.host.setAttribute(RATE_ATTRIBUTE, String(state.effectiveRate));
    ui.host.setAttribute(PITCH_ATTRIBUTE, String(state.preservePitch));
    // A user-triggered export result must not be hidden by the standing access
    // notice for the optional Player Tools controls.
    const accessNotice = !playbackAllowed && accessSnapshot?.state !== "trial_not_started" && accessSnapshot?.state !== "loading"
      ? accessMessage(accessSnapshot?.code || "trial-exhausted") : "";
    const message = loopFailure || playbackFailure || accessNotice || storageFailure || effectsFailure;
    ui.status.textContent = message;
    ui.status.hidden = !message;
    renderLoop();
    renderEffects();
    equalizerUi?.sync();
    renderControlsVisibility();
  }

  function renderEffects() {
    if (!ui || !effectsController) return;
    const state = effectsController.snapshot();
    for (const name of EFFECT_NAMES) {
      const slider = ui.effectSliders[name];
      slider.value = String(state[name]);
      slider.disabled = !state.available || !effectAllowed(name) || accessActionPending;
      slider.dataset.active = String(state[name] > 0);
      ui.effectValues[name].textContent = `${state[name]}%`;
      if (state[name] > 0) effectWetMemory[name] = state[name];
      const bypass = ui.effectBypasses[name];
      const enabled = state[name] > 0;
      bypass.disabled = !state.available || !effectAllowed(name) || accessActionPending;
      bypass.setAttribute("aria-pressed", String(enabled));
      bypass.setAttribute("aria-label", `${enabled ? "Disable" : "Enable"} ${name}`);
      bypass.title = enabled
        ? `Disable ${name} (${state[name]}% wet)`
        : `Enable ${name} (${effectWetMemory[name] || DEFAULT_EFFECT_TOGGLE_WET}% wet)`;
      syncRange(slider);
    }
    for (const [name, control] of Object.entries(ui.effectCharacters)) {
      control.value = String(state[name]);
      control.disabled = !state.available || !effectAllowed(name) || accessActionPending;
      const output = ui.effectCharacterValues[name];
      if (output) output.textContent = ["delayTime", "reverbPreDelay"].includes(name)
        ? `${state[name]}ms`
        : name === "reverbDecay" ? `${state[name].toFixed(1)}s`
          : ["flangerRate", "phaserRate"].includes(name) ? `${Number(state[name]).toFixed(2)}Hz`
            : name === "bitDepth" ? `${state[name]}bit` : `${state[name]}%`;
    }
    ui.root.querySelectorAll(".effects-preset").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.fxPreset === state.preset));
      button.disabled = !state.available || !capability("premiumEffects") || accessActionPending;
    });
    ui.root.querySelectorAll(".effect-settings-toggle").forEach((button) => {
      const expanded = button.dataset.effectSettings === expandedEffectSettings;
      button.setAttribute("aria-expanded", String(expanded));
    });
    ui.root.querySelectorAll(".effect-settings").forEach((panel) => {
      panel.classList.toggle("is-open", panel.dataset.effectSettingsPanel === expandedEffectSettings);
    });
    const frozen = effectsController.isDelayFrozen?.() === true;
    ui.effectFreeze.disabled = !state.available || !capability("freeEffects") || accessActionPending || state.delay === 0;
    ui.effectFreeze.setAttribute("aria-pressed", String(frozen));
    ui.effectFreeze.textContent = frozen ? "Frozen — release" : "Hold to Freeze";
    ui.effectsShell.classList.toggle("is-collapsed", effectsCollapsed);
    ui.effectsToggle.setAttribute("aria-expanded", String(!effectsCollapsed));
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
      if (event.key === "Escape" && instrumentMode) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setInstrumentMode(false, { message: "" });
        ui?.instrumentToggle?.focus();
        return;
      }
      if (event.key === "Escape" && ui && !ui.panel.hidden) {
        document.documentElement?.setAttribute("data-scdl-tempo-panel-escape", "true");
        setTimeout(() => document.documentElement?.removeAttribute("data-scdl-tempo-panel-escape"), 0);
        closePanel();
        ui.trigger.focus();
      }
    },
    true
  );
  window.addEventListener("resize", () => {
    positionPanel();
    renderLoop();
  });
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
