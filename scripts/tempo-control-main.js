/*
 * SoundCloud player adapter for scripts/tempo-control-core.js. Other players
 * (YouTube) plug in through globalThis.SCPlayerToolsPlatform.
 * The audio-control implementation is adapted under the MIT license; see
 * THIRD_PARTY_LICENSES.md.
 */
(() => {
  "use strict";
  const pt = (source, ...values) => globalThis.SCPlayerToolsText?.t(source, ...values) ?? source.replace(/\$(\d+)/g, (match, index) => values[index - 1] ?? match);
  // YouTube enforces Trusted Types. The policy stays private to this file and
  // only receives the extension's own markup.
  const trustedHtml = (() => {
    let policy = null;
    try { policy = globalThis.trustedTypes?.createPolicy?.("seib-player-tools", { createHTML: (value) => value }); } catch {}
    return (value) => policy ? policy.createHTML(value) : value;
  })();

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
  const TOOLTIPS_STORAGE = "scdl.tooltips.enabled";
  const TOOLTIPS_ATTRIBUTE = "data-scdl-tooltips-enabled";
  function readTooltipsEnabled() {
    try { return localStorage.getItem(TOOLTIPS_STORAGE) !== "false"; } catch { return true; }
  }
  let tooltipsEnabled = readTooltipsEnabled();
  function syncTooltips() {
    document.documentElement?.setAttribute(TOOLTIPS_ATTRIBUTE, String(tooltipsEnabled));
    document.dispatchEvent(new Event("scdl:tooltips-changed"));
    ui?.tooltipsButton.setAttribute("aria-pressed", String(tooltipsEnabled));
  }
  const WAVEFORM_COLLAPSED_STORAGE = "scdl.tempo.waveformCollapsed";
  const RATE_ATTRIBUTE = "data-scdl-tempo-rate";
  const PITCH_ATTRIBUTE = "data-scdl-tempo-preserve-pitch";
  const EXTENSION_LOGO_ATTRIBUTE = "data-scdl-extension-logo-url";

  const EXTENSION_DRUM_SAMPLES_ATTRIBUTE = "data-scdl-extension-drum-samples-url";


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
  // The Player Tools store build rewrites this to true: no full-track downloads, no SCTD branding.
  const TOOLS_EDITION = false;
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
    { name: "Kick", sample: "kick1.wav", key: "z" },
    { name: "Clap", sample: "clap1.wav", key: "x" },
    { name: "Hat", sample: "hat1.wav", key: "c" },
    { name: "Kick 2", sample: "kick2.wav", key: "v" },
    { name: "Snare", sample: "snare1.wav", key: "b" },
    { name: "Tom", sample: "tom1.wav", key: "n" },
    { name: "Clap 2", sample: "clap2.wav", key: "m" },
    { name: "Hat 2", sample: "hat2.wav", key: "l" },
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
  const BYPASS_ICON = `<sc-icon name="bypass" aria-hidden="true"></sc-icon>`;
  const SETTINGS_ICON = `<sc-icon name="settings" aria-hidden="true"></sc-icon>`;
  if (window[INSTALLED_FLAG] || !globalThis.SCTempoControl || !globalThis.SCSamplerCore) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const { DEFAULTS, clampRate, create, formatRate } = globalThis.SCTempoControl;
  const effectsApi = globalThis.SCTempoEffects;
  // Set by scripts/youtube-platform.js. SoundCloud has no adapter.
  const platform = globalThis.SCPlayerToolsPlatform || null;
  const IS_YOUTUBE = platform?.id === "youtube";
  const MEDIA_SELECTOR = IS_YOUTUBE ? "video" : "audio";
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
  let recordUi = null;
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
  let sliceJob = null;
  let sliceConfirmation = null;
  let suppressPanelEscape = false;
  let loopState = { active: false, enabled: false, startMs: null, endMs: null, durationMs: null };
  let stemCapture = null;
  let youtubeRatePushed = null;
  let liveWaveform = null;
  let liveWaveformTimer = null;
  let liveWaveformRevision = -1;
  let accessSnapshot = { state: "loading", plan: "free", capabilities: {} };
  let playerToolsSessionId = null;
  let accessRequestId = 0;
  let accessLocked = false;
  let accessActionPending = false;
  let rateIntent = null;
  let rateAuthorization = null;
  let loopPollInterval = null;
  let waveformSamples = [];
  let waveformSpectrum = null;
  let waveformAnalysisCache = null;
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
  const instrumentKeys = new Map();
  const instrumentEnvelope = { attack: 4, decay: 100, sustain: 100, release: 100 };
  const instrumentSettings = { gainPercent: 100, pitchSemitones: 0, timePercent: 100 };
  let instrumentTimeCache = null;
  let selectedPadIndex = 0;
  let padEditor = null;
  let padEditorIntent = 0;
  let padEditorZoom = null;
  let padEditorPending = false;
  const padEditorCache = new Map();
  // Slices share an audioId: decode and analyze their original source only once.
  const padWaveformSources = new Map();

  // Account unique PCM allocations across playback and editor caches. Eviction
  // only drops reusable references; active voices keep their own AudioBuffer.
  function enforcePadCacheBudget(protectedBuffer = null) {
    const buffers = new Map();
    const add = (buffer, lastUsed = 0) => {
      if (buffer) buffers.set(buffer, Math.max(buffers.get(buffer) || 0, lastUsed));
    };
    for (const pad of drumPads) add(pad.buffer, pad.lastUsed);
    for (const entry of padWaveformSources.values()) add(entry.buffer, entry.lastUsed);
    for (const editor of padEditorCache.values()) add(editor.buffer, editor.lastUsed);
    add(padEditor?.buffer, performance.now());
    const bytes = buffer => buffer.length * buffer.numberOfChannels * 4;
    let total = [...buffers.keys()].reduce((sum, buffer) => sum + bytes(buffer), 0);
    for (const [buffer] of [...buffers].sort((a, b) => a[1] - b[1])) {
      if (total <= 64 * 1024 * 1024 && padWaveformSources.size <= drumPads.length) break;
      if (buffer === protectedBuffer || buffer === padEditor?.buffer) continue;
      for (const pad of drumPads) if (pad.buffer === buffer) pad.buffer = null;
      for (const [source, entry] of padWaveformSources) if (entry.buffer === buffer) padWaveformSources.delete(source);
      for (const editor of padEditorCache.values()) {
        if (editor.buffer !== buffer) continue;
        editor.buffer = null;
        editor.peaks = null;
      }
      total -= bytes(buffer);
    }
  }

  async function loadPadWaveform(source, getUrl) {
    const cached = padWaveformSources.get(source);
    if (cached) { cached.lastUsed = performance.now(); return cached.promise; }
    const revision = padCacheRevision;
    const entry = { buffer: null, lastUsed: performance.now(), promise: null };
    const loading = (async () => {
      const response = await fetch(await getUrl());
      if (!response.ok) throw new Error(pt("Could not load the sample waveform."));
      const buffer = await getDrumAudioContext().decodeAudioData(await response.arrayBuffer());
      const peaks = new Float32Array(Math.min(4096, buffer.length));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame++) {
          const bin = Math.min(peaks.length - 1, Math.floor(frame / data.length * peaks.length));
          peaks[bin] = Math.max(peaks[bin], Math.abs(data[frame]));
        }
      }
      if (revision === padCacheRevision && padWaveformSources.get(source) === entry && !ui?.panel.hidden) {
        entry.buffer = buffer;
        enforcePadCacheBudget(buffer);
      } else if (padWaveformSources.get(source) === entry) padWaveformSources.delete(source);
      return { buffer, peaks };
    })();
    entry.promise = loading;
    padWaveformSources.set(source, entry);
    try { return await loading; }
    catch (error) { if (padWaveformSources.get(source) === entry) padWaveformSources.delete(source); throw error; }
  }

  function showPadEditor(editor) {
    if (padEditor?.buffer !== editor.buffer) {
      padEditorZoom = null;
      waveformRevision++;
    }
    padEditor = editor;
    editor.lastUsed = performance.now();
    enforcePadCacheBudget(editor.buffer);
    padEditorPending = false;
    const selectionChanged = selectedPadIndex !== editor.index;
    selectedPadIndex = editor.index;
    if (waveformCollapsed) setWaveformCollapsed(false);
    if (selectionChanged) renderSelectedPadControls();
    renderLoop();
  }

  function editorState() {
    return padEditor ? { ...padEditor.trim, durationMs: padEditor.durationMs,
      active: Boolean(padEditor.buffer), available: Boolean(padEditor.buffer) } : loopState;
  }

  function leavePadEditor() {
    padEditorIntent++;
    padEditorPending = false;
    padEditor = null;
    padEditorZoom = null;
    waveformDrag = null;
    waveformDrawPreview = null;
    waveformRevision++;
    renderLoop();
  }

  async function editPad(index = selectedPadIndex) {
    if (waveformDrag || drumPads[index]?.busy) return;
    const intent = ++padEditorIntent;
    const pad = drumPads[index];
    if (instrumentMode || instrumentPreparing) exitInstrument();
    const cached = padEditorCache.get(index);
    // An in-flight local save owns its optimistic bounds. Otherwise refresh
    // metadata on every opening, including changes made by another tab.
    if (cached?.buffer && cached.version === pad.version && cached.saving) { showPadEditor(cached); return; }
    // Keep the current waveform visible until the next source is ready.
    padEditorPending = true;
    try {
      if ((padHydration || !padsHydrated) && !await hydrateDrumPads()) throw new Error(pt("Could not restore saved samples."));
      await pad.trimSave;
      if (intent !== padEditorIntent || ui?.panel.hidden) return;
      const requestedVersion = pad.version;
      const record = (await requestPad("get", { index, metadataOnly: true })).pad;
      if (intent !== padEditorIntent || ui?.panel.hidden) return;
      if (pad.busy || pad.version !== requestedVersion) { leavePadEditor(); return; }
      applyPadMetadata(index, record);
      updateDrumLabels();
      const version = pad.version;
      const defaultUrl = () => new URL(pad.sample, document.documentElement.getAttribute(EXTENSION_DRUM_SAMPLES_ATTRIBUTE)).href;
      const source = record?.audioId || (record ? `pad:${index}:${record.updatedAt}` : defaultUrl());
      const { buffer, peaks } = await loadPadWaveform(source, async () => record
        ? (await requestPad("get", { index, original: true, expectedUpdatedAt: record.updatedAt })).pad?.dataUrl
        : defaultUrl());
      if (intent !== padEditorIntent || ui?.panel.hidden) return;
      if (version !== pad.version) { leavePadEditor(); return; }
      const durationMs = record?.sourceDurationMs || buffer.duration * 1000;
      const trim = record?.trim || { startMs: 0, endMs: durationMs };
      const editor = { index, version, buffer, durationMs, trim: { ...trim }, updatedAt: record?.updatedAt,
        trimRevision: record?.trimRevision || 0, peaks };
      padEditorCache.set(index, editor);
      showPadEditor(editor);
    } catch (error) {
      if (intent !== padEditorIntent) return;
      leavePadEditor();
      showDrumError(error?.message || pt("Could not open this pad."));
    }
  }

  async function setPadRange(range) {
    const editor = padEditor;
    if (!editor?.buffer || !Number.isFinite(range?.startMs) || !Number.isFinite(range?.endMs) ||
        range.startMs < 0 || range.endMs > editor.durationMs || range.endMs - range.startMs < 1) return;
    const pad = drumPads[editor.index];
    const trim = { startMs: range.startMs, endMs: range.endMs };
    if (trim.startMs === editor.trim.startMs && trim.endMs === editor.trim.endMs) return;
    editor.trim = trim;
    pad.version++;
    editor.version = pad.version;
    pad.buffer = null;
    pad.loading = null;
    // Playback reads editor.trim immediately. Persist only the newest pending range,
    // keeping at most one write in flight instead of queueing every pointer move.
    editor.pendingTrim = trim;
    renderLoop();
    if (editor.saving) return editor.saving;
    const save = (pad.trimSave || Promise.resolve()).then(async () => {
      if (!pad.saved) {
        const blob = await (await fetch(new URL(pad.sample, document.documentElement.getAttribute(EXTENSION_DRUM_SAMPLES_ATTRIBUTE)).href)).blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await requestPad("store", { index: editor.index, name: pad.name, mimeType: "audio/wav",
          base64: dataUrl.split(",")[1], operationId: `pad_${crypto.randomUUID()}` });
        pad.saved = true;
        const record = (await requestPad("get", { index: editor.index, metadataOnly: true })).pad;
        editor.updatedAt = record.updatedAt;
        editor.trimRevision = record.trimRevision || 0;
        pad.updatedAt = record.updatedAt;
      }
      while (editor.pendingTrim) {
        const latest = editor.pendingTrim;
        editor.pendingTrim = null;
        const result = await requestPad("trim", { index: editor.index, trim: latest, expectedUpdatedAt: editor.updatedAt,
          expectedTrimRevision: editor.trimRevision });
        editor.trimRevision = result.trimRevision ?? editor.trimRevision + 1;
        pad.trimRevision = editor.trimRevision;
      }
    });
    editor.saving = pad.trimSave = save.catch(error => {
      editor.pendingTrim = null;
      padEditorCache.delete(editor.index);
      if (padEditor === editor) leavePadEditor();
      showDrumError(error?.message || pt("Could not save pad bounds."));
    }).finally(() => { editor.saving = null; });
    await pad.trimSave;
  }
  let samplerPresetBusy = false;
  let samplerPresets = [];
  let samplerPresetListVersion = 0;
  let instrumentCutItself = true;
  let instrumentAdsrEnabled = false;
  const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  let renderedPlayingNote = "";
  const padRequests = new Map();
  let padHydration = null;
  let padsHydrated = false;
  let padCacheTimer = null;
  let padCacheRevision = 0;
  const drumPads = DRUM_DEFAULTS.map((defaultPad) => ({ ...defaultPad, envelope: { ...instrumentEnvelope }, gainPercent: 100, pitchSemitones: 0, timePercent: 100, buffer: null, loading: null, customName: "", saved: false, busy: false, version: 0 }));
  try {
    const savedKeys = JSON.parse(localStorage.getItem(DRUM_KEYS_STORAGE) || "null");
    if (Array.isArray(savedKeys)) {
      savedKeys.slice(0, drumPads.length).forEach((key, index) => {
        if (key === "" || (typeof key === "string" && /^[a-z0-9]$/i.test(key))) {
          drumPads[index].key = key.toLowerCase();
        }
      });
      // New defaults must never steal a key from an existing custom assignment.
      for (let index = savedKeys.length; index < drumPads.length; index++) {
        if (drumPads.slice(0, index).some(pad => pad.key === drumPads[index].key)) {
          drumPads[index].key = [..."jklqwertyuiopzxcvbnm1234567890"].find(key =>
            !drumPads.some((pad, other) => other !== index && pad.key === key)) || "";
        }
      }
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
  let controlsGrid = false;
  let resetInProgress = false;
  let resetGeneration = 0;
  let playbackIntentVersion = 0;
  let effectIntentVersion = 0;
  let expandedEffectSettings = null;
  let effectsFailure = "";
  let effectsBypassed = false;
  let echoFreezePlayback = null;
  let echoFreezeRevision = 0;
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
    if (logoUrl) { ui.brandLogo.src = logoUrl; ui.brandLogo.hidden = false; }
    const toolkitUrl = document.documentElement.getAttribute("data-scdl-extension-toolkit-url");
    if (toolkitUrl) { ui.triggerLogo.src = toolkitUrl; ui.triggerLogo.hidden = false; }
    ui.detachIcon.hidden = false;
    ui.trashIcon.hidden = false;
  }

  document.addEventListener(EXTENSION_ASSETS_EVENT, syncBrandLogo);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "scdl-pad-content") return;
    if (event.data.chunk) {
      const request = [...padRequests.values()].find((pending) => pending.action === "instrument" && pending.operationId === event.data.operationId);
      if (!request || request.transferError) return;
      try {
        const { offset, byteLength, dataUrl } = event.data.chunk;
        if (offset !== request.byteLength || !Number.isSafeInteger(byteLength) || byteLength <= 0 ||
            byteLength > 1024 * 1024 || offset + byteLength > 128 * 1024 * 1024 ||
            typeof dataUrl !== "string" || dataUrl.length > 1500000 || !/^data:[^,]*;base64,/.test(dataUrl)) {
          throw new Error(pt("Invalid instrument audio chunk."));
        }
        const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
        if (binary.length !== byteLength) throw new Error(pt("Incomplete instrument audio chunk."));
        request.chunks.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
        request.byteLength += byteLength;
      } catch (error) { request.transferError = error; }
      return;
    }
    const request = padRequests.get(event.data.id);
    if (!request) return;
    padRequests.delete(event.data.id);
    clearTimeout(request.timeout);
    if (request.transferError) request.reject(request.transferError);
    else if (event.data.result?.success && event.data.result.instrument?.fullTrack) {
      if (request.byteLength !== event.data.result.instrument.byteLength || !request.byteLength) {
        request.reject(new Error(pt("The instrument audio transfer was incomplete.")));
      } else request.resolve({ ...event.data.result, audioBlob: new Blob(request.chunks, { type: event.data.result.instrument.mimeType }) });
    }
    else if (event.data.result?.success) request.resolve(event.data.result);
    else request.reject(new Error(event.data.result?.error || pt("Could not prepare this pad.")));
  });

  function requestPad(action, payload = {}) {
    const id = `pad_${Date.now()}_${++padRequestNumber}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        padRequests.delete(id);
        if ((action === "instrument" || action === "slices") && payload.operationId) {
          window.postMessage({ source: "scdl-pad-main", id: `cancel_${id}`,
            action: action === "slices" ? "cancel-slices" : "cancel-instrument", operationId: payload.operationId }, location.origin);
        }
        reject(new Error(pt("The pad request timed out.")));
      }, action === "list" ? 10000 : action === "waveform" ? 660000 : 120000);
      padRequests.set(id, { resolve, reject, timeout, action, operationId: payload.operationId || null, chunks: [], byteLength: 0 });
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
      const error = new Error(pt("Instrument preparation cancelled."));
      error.name = "AbortError";
      request.reject(error);
    }
    window.postMessage({ source: "scdl-pad-main", id: `cancel_${Date.now()}_${++padRequestNumber}`,
      action: "cancel-instrument", operationId }, location.origin);
  }

  function applyPadMetadata(index, record) {
    const pad = drumPads[index];
    const name = record?.name || "";
    const trimRevision = record?.trimRevision || 0;
    if (pad.saved === Boolean(record) && pad.customName === name && pad.updatedAt === record?.updatedAt &&
        (pad.trimRevision || 0) === trimRevision) return;
    pad.version++;
    pad.customName = name;
    pad.saved = Boolean(record);
    pad.updatedAt = record?.updatedAt;
    pad.trimRevision = trimRevision;
    pad.buffer = null;
    pad.loading = null;
    padEditorCache.delete(index);
  }

  function hydrateDrumPads() {
    if (padHydration) return padHydration;
    // MAIN runs at document_start; content.js announces its bridge only after
    // installing the message listener. An early postMessage would be lost.
    if (!document.documentElement.getAttribute(EXTENSION_DRUM_SAMPLES_ATTRIBUTE)) return Promise.resolve(false);
    const versions = drumPads.map(pad => pad.version);
    padHydration = (async () => {
      try {
        const result = await requestPad("list");
        if (!Array.isArray(result.pads)) throw new Error(pt("Could not restore saved samples."));
        drumPads.forEach((pad, index) => {
          if (pad.busy || pad.version !== versions[index] || padEditorCache.get(index)?.saving) return;
          const record = result.pads.find(record => record.index === index);
          applyPadMetadata(index, record);
        });
        padsHydrated = true;
        updateDrumLabels();
        if (ui?.drumMessage.textContent === pt("Could not restore saved samples. Reopen Sampler to retry.")) showDrumError("");
        if (ui && !ui.panel.hidden) positionPanel();
        return true;
      } catch (error) {
        if (ui && !ui.panel.hidden) showDrumError(pt("Could not restore saved samples. Reopen Sampler to retry."));
        console.warn("[SC Downloader Pads]", error);
        return false;
      } finally { padHydration = null; }
    })();
    return padHydration;
  }

  document.addEventListener(EXTENSION_ASSETS_EVENT, () => {
    if (!ui) return;
    ui.host.lang = globalThis.SCPlayerToolsText?.locale() || "en";
    globalThis.SCPlayerToolsText?.refresh(ui.root);
    hydrateDrumPads(); renderSamplerPresetCopy(); render();
  });

  function schedulePadCacheRelease() {
    clearTimeout(padCacheTimer);
    padCacheTimer = setTimeout(() => {
      padCacheTimer = null;
      padCacheRevision += 1;
      for (const pad of drumPads) pad.buffer = null;
      padEditorCache.clear();
      padWaveformSources.clear();
      if (!instrumentMode && !instrumentPreparing) {
        instrumentBuffer = null;
        instrumentTimeCache = null;
        instrumentSnapshot = null;
      }
    }, 60000);
  }

  function updateDrumLabels() {
    if (!ui) return;
    renderSamplerPresetBusy();
    drumPads.forEach((pad, index) => {
      const button = ui.drumButtons[index];
      button.querySelector(".drum-key").textContent = pad.key ? pad.key.toUpperCase() : "·";
      button.classList.toggle("is-saving", pad.busy);
      button.setAttribute("aria-label", pt("$1 drum pad. Key $2. Right click to edit sample bounds. Hold left click to remove the saved sample and restore the default. Shift + Enter or Shift + Space to load an audio sample.", pad.customName || pt(pad.name), pad.key ? pad.key.toUpperCase() : pt("Unassigned")));
      button.title = pt("$1 · Right-click to open this sample in the looper and edit its start/end · hold left click to restore default · Shift + Enter / Space to load", Array.from(pad.customName || pt(pad.name)).slice(0, 20).join(""));
      button.setAttribute("data-scdl-tooltip", button.title);
    });
  }

  function showDrumError(message) {
    if (!ui) return;
    ui.drumMessage.removeAttribute("data-scdl-tooltip");
    ui.drumMessage.removeAttribute("tabindex");
    ui.drumMessage.textContent = pt(message);
    ui.drumMessage.hidden = !message;
    ui.drumStatus.hidden = !message && !ui.playingNote.textContent;
  }

  function renderPlayingNote(midiNote = null) {
    if (!ui) return;
    const value = Number.isInteger(midiNote)
      ? `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}` : "";
    if (value === renderedPlayingNote) return;
    renderedPlayingNote = value;
    ui.playingNote.textContent = value;
    ui.drumStatus.hidden = !value && !ui.drumMessage.textContent;
  }

  function renderInstrumentMessage() {
    if (!ui || !instrumentMode) return;
    let copy = {};
    try { copy = JSON.parse(document.documentElement.getAttribute("data-scdl-piano-copy") || "{}"); } catch {}
    const octave = instrumentOctave >= 0 ? `+${instrumentOctave}` : String(instrumentOctave);
    const status = typeof copy.status === "string" && copy.status !== "piano_mode_status"
      ? copy.status : pt("Piano mode on · ← → octave ({octave})");
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
    if (effectsController) return effectsController.getPlaybackContext();
    if (!drumAudioContext) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Audio playback is unavailable in this browser.");
      drumAudioContext = new AudioContextConstructor();
    }
    return drumAudioContext;
  }

  function invalidatePendingInstrumentNotes() {
    instrumentNoteRevision += 1;
    instrumentKeys.clear();
  }

  function instrumentGainAt(voice, time) {
    const points = voice.envelopePoints || [[time, 0]];
    let previous = points[0];
    for (const point of points.slice(1)) {
      if (time < point[0]) {
        const fraction = Math.max(0, (time - previous[0]) / (point[0] - previous[0]));
        return previous[1] + (point[1] - previous[1]) * fraction;
      }
      previous = point;
    }
    return previous[1];
  }

  function scheduleInstrumentEnvelope(voice, initial = false) {
    const envelope = voice.envelope || instrumentEnvelope;
    const now = voice.context.currentTime;
    const param = voice.gain.gain;
    const value = initial ? 0 : instrumentGainAt(voice, now);
    if (!initial && param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
    const points = [[now, value]];
    if (voice.releasing) {
      const end = Math.max(now + 0.002, voice.releaseStartedAt + voice.releaseMs / 1000);
      points.push([end, 0]);
      voice.source.stop(Math.min(end + 0.002, voice.sampleEndAt ?? Infinity));
    } else if (!instrumentAdsrEnabled) {
      // Keep the short anti-click fade even when the musical envelope is off.
      points.push([now + (initial ? .004 : .008), 1]);
    } else {
      const attackEnd = voice.startedAt + envelope.attack / 1000;
      const decayEnd = attackEnd + envelope.decay / 1000;
      if (attackEnd > now) points.push([attackEnd, 1]);
      else if (initial) {
        param.setValueAtTime(1, now);
        points[0][1] = 1;
      }
      points.push([Math.max(now + 0.002, decayEnd), envelope.sustain / 100]);
    }
    for (const [time, level] of points.slice(1)) param.linearRampToValueAtTime(level, time);
    voice.envelopePoints = points;
  }

  function releaseInstrumentKey(event) {
    const key = event.code || event.key;
    const held = instrumentKeys.get(key);
    if (!held) return;
    held.released = true;
    if (held.voice) held.voice.keyReleased = true;
    if (instrumentAdsrEnabled || held.voice) instrumentKeys.delete(key);
    if (instrumentAdsrEnabled) {
      releaseInstrumentVoice(held.voice, (held.voice?.envelope || instrumentEnvelope).release, true);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function cleanupInstrumentVoice(voice) {
    if (!voice || voice.cleaned) return;
    voice.cleaned = true;
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer);
    voice.cleanupTimer = null;
    voice.source.onended = null;
    try { voice.source.disconnect(); } catch {}
    try { voice.sourceFade?.disconnect(); } catch {}
    try { voice.padGain?.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
    instrumentVoices.delete(voice);
    if (instrumentKeys.get(voice.key)?.voice === voice) instrumentKeys.delete(voice.key);
    if (instrumentVoice === voice) {
      instrumentVoice = null;
      renderPlayingNote();
    }
  }

  function releaseInstrumentVoice(voice, releaseMs = 8, envelopeRelease = false) {
    if (!voice || voice.cleaned || (voice.releasing && envelopeRelease)) return;
    voice.releasing = true;
    voice.envelopeRelease = envelopeRelease;
    voice.releaseStartedAt = voice.context.currentTime;
    voice.releaseMs = releaseMs;
    try {
      scheduleInstrumentEnvelope(voice);
    } catch {
      cleanupInstrumentVoice(voice);
    }
  }

  function stopInstrumentVoice(releaseMs = 8) {
    stopAllInstrumentVoices(releaseMs);
  }

  function setInstrumentAdsrEnabled(enabled) {
    instrumentAdsrEnabled = Boolean(enabled);
    if (ui?.instrumentAdsrToggle) ui.instrumentAdsrToggle.checked = instrumentAdsrEnabled;
    ui?.instrumentControls?.classList.toggle("is-bypassed", !instrumentAdsrEnabled);
    if (instrumentAdsrEnabled) {
      for (const [key, held] of instrumentKeys) {
        if (held.released) instrumentKeys.delete(key);
      }
    }
    for (const voice of instrumentVoices) {
      if (voice.cleaned || (voice.releasing && !voice.envelopeRelease)) continue;
      if (instrumentAdsrEnabled && voice.keyReleased) {
        releaseInstrumentVoice(voice, (voice.envelope || instrumentEnvelope).release, true);
        continue;
      }
      if (voice.releasing) {
        // A completed release cannot be restarted; cut voices stay cut, too.
        if (voice.context.currentTime >= voice.envelopePoints.at(-1)[0] ||
            voice.context.currentTime >= voice.sampleEndAt) continue;
        voice.releasing = false;
        voice.envelopeRelease = false;
        voice.source.stop(voice.sampleEndAt);
      }
      scheduleInstrumentEnvelope(voice);
    }
  }

  function selectedEnvelope() {
    return instrumentMode ? instrumentEnvelope : drumPads[selectedPadIndex].envelope;
  }

  function renderSelectedPadControls() {
    if (!ui?.instrumentControls) return;
    if (ui.instrumentControls.renderedPadIndex !== selectedPadIndex) {
      ui.instrumentControls.renderedPadIndex = selectedPadIndex;
      ui.drumButtons.forEach((button, index) => {
        button.classList.toggle("is-selected", index === selectedPadIndex);
        button.setAttribute("aria-pressed", String(index === selectedPadIndex));
      });
    }
    const pad = instrumentMode ? instrumentSettings : drumPads[selectedPadIndex];
    const key = JSON.stringify([instrumentMode, pad.gainPercent, pad.pitchSemitones, pad.timePercent, selectedEnvelope()]);
    if (ui.instrumentControls.renderedSettings === key) return;
    ui.instrumentControls.renderedSettings = key;
    for (const knob of ui.instrumentControls.querySelectorAll("button")) knob.renderControl?.();
    renderInstrumentEnvelopeGraph();
  }

  function bindInstrumentControls() {
    for (const knob of ui.instrumentControls.querySelectorAll(".envelope-knob")) {
      const name = knob.dataset.envelope;
      const maximum = name === "sustain" ? 100 : 5000;
      const output = knob.parentElement.querySelector("output");
      const normalized = () => name === "sustain"
        ? selectedEnvelope()[name] / 100 : Math.sqrt(selectedEnvelope()[name] / maximum);
      const render = () => {
        const value = selectedEnvelope()[name];
        const text = name === "sustain" ? `${value}%` : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
        knob.style.setProperty("--knob-angle", `${-135 + normalized() * 270}deg`);
        knob.setAttribute("aria-valuenow", String(value));
        knob.setAttribute("aria-valuetext", text);
        output.textContent = text;
      };
      const update = (value) => {
        const envelope = selectedEnvelope();
        envelope[name] = Math.round(Math.max(0, Math.min(maximum, value)));
        ui.instrumentControls.renderedSettings = null;
        render();
        renderInstrumentEnvelopeGraph();
        if (!instrumentAdsrEnabled) return;
        for (const voice of instrumentVoices) {
          if (voice.cleaned || (voice.envelope || instrumentEnvelope) !== envelope) continue;
          if (voice.releasing) {
            if (name !== "release" || !voice.envelopeRelease) continue;
            voice.releaseMs = envelope.release;
          } else if (name === "release") continue;
          scheduleInstrumentEnvelope(voice);
        }
      };
      let drag = null;
      knob.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        drag = { id: event.pointerId, y: event.clientY, value: normalized() };
        knob.setPointerCapture(event.pointerId);
        knob.focus();
        event.preventDefault();
      });
      knob.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        const value = Math.max(0, Math.min(1, drag.value + (drag.y - event.clientY) / 160));
        update((name === "sustain" ? value : value * value) * maximum);
      });
      for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
        knob.addEventListener(eventName, () => { drag = null; });
      }
      knob.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const step = (name === "sustain" ? 1 : 10) * (event.shiftKey ? 10 : 1);
        update(event.key === "Home" ? 0 : event.key === "End" ? maximum
          : selectedEnvelope()[name] + (["ArrowUp", "ArrowRight"].includes(event.key) ? step : -step));
      });
      knob.renderControl = render;
      render();
    }
    renderInstrumentEnvelopeGraph();
    ui.instrumentAdsrToggle.addEventListener("change", (event) => setInstrumentAdsrEnabled(event.target.checked));
    setInstrumentAdsrEnabled(instrumentAdsrEnabled);
    ui.instrumentCutItself.addEventListener("change", (event) => {
      instrumentCutItself = event.target.checked;
      if (instrumentCutItself) {
        invalidatePendingInstrumentNotes();
        for (const voice of instrumentVoices) {
          if (voice !== instrumentVoice) releaseInstrumentVoice(voice);
        }
        if (instrumentVoice && !instrumentVoice.releasing && !instrumentVoice.keyReleased) {
          instrumentKeys.set(instrumentVoice.key, { voice: instrumentVoice, released: instrumentVoice.keyReleased });
        }
      }
    });
  }

  function renderInstrumentEnvelopeGraph() {
    const graph = ui?.instrumentControls.querySelector(".envelope-graph");
    if (!graph) return;
    const { attack, decay, sustain, release } = selectedEnvelope();
    // Sustain is a level held until keyup, represented by a fixed-width plateau.
    const scale = 76 / Math.max(500, attack + decay + release);
    const a = 5 + attack * scale;
    const d = a + decay * scale;
    const s = d + 24;
    const r = s + release * scale;
    const y = 43 - sustain * .35;
    const line = `M5 43 L${a} 8 L${d} ${y} L${s} ${y} L${r} 43`;
    graph.querySelector(".envelope-curve").setAttribute("d", line);
    graph.querySelector(".envelope-fill").setAttribute("d", `${line} Z`);
    graph.querySelector(".envelope-keyup").setAttribute("x1", s);
    graph.querySelector(".envelope-keyup").setAttribute("x2", s);
    graph.setAttribute("aria-label", pt("ADSR: attack $1 ms, decay $2 ms, sustain $3%, release $4 ms. Dashed line: key release.", attack, decay, sustain, release));
  }

  function stopAllInstrumentVoices(releaseMs = 8) {
    invalidatePendingInstrumentNotes();
    instrumentVoice = null;
    renderPlayingNote();
    for (const voice of instrumentVoices) releaseInstrumentVoice(voice, releaseMs);
  }

  function setInstrumentMode(enabled, { clearBuffer = false, message = "" } = {}) {
    if (enabled && !instrumentMode) {
      stopAllInstrumentVoices();
      instrumentOctave = 0;
    }
    instrumentMode = Boolean(enabled);
    renderSelectedPadControls();
    if (!instrumentMode) stopAllInstrumentVoices();
    if (clearBuffer) {
      instrumentBuffer = null;
      instrumentTimeCache = null;
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
    // The master EQ stays live while playing notes; never bake it into the voice.
    effects.eq = { enabled: false, hardClip: false, bands: [] };
    const descriptor = {
      signatureVersion: 2,
      trackIdentity: String(loopState.trackIdentity || ""),
      generation: Number.isInteger(loopState.generation) ? loopState.generation : null,
      trimRange: {
        startMs: 0,
        endMs: normalizedInstrumentNumber(loopState.durationMs),
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
    if (snapshot?.saved) return true;
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
    if (padEditor || padEditorPending) leavePadEditor();
    const intentVersion = ++instrumentIntentVersion;
    instrumentPreparing = true;
    setInstrumentMode(false, { message: pt("Preparing loop instrument…") });
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
    const duration = descriptor.trimRange.durationMs;
    if (!Number.isFinite(duration) || duration <= 0) {
      instrumentPreparing = false;
      showDrumError(pt("The track duration is not available yet."));
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
        fullTrack: true,
        trackUrl: descriptor.trackIdentity.replace(/^permalink:/, ""),
        trimRange: descriptor.trimRange,
        playbackTransform: descriptor.playbackTransform,
        effects: descriptor.effects,
        name: `Instrument ${(descriptor.trimRange.startMs / 1000).toFixed(1)}–${(descriptor.trimRange.endMs / 1000).toFixed(1)}s`,
      });
      if (intentVersion !== instrumentIntentVersion || !loopMatchesInstrumentSnapshot(descriptor)) return;
      if (!result.audioBlob) throw new Error(pt("The prepared instrument audio is unavailable."));
      const context = getDrumAudioContext();
      const expectedSeconds = duration / 1000 / descriptor.playbackTransform.rate;
      if (expectedSeconds * context.sampleRate * 2 * 4 > 256 * 1024 * 1024) {
        throw new Error(pt("This track is too large to keep in sampler memory at this speed."));
      }
      const buffer = await context.decodeAudioData(await result.audioBlob.arrayBuffer());
      if (buffer.length * buffer.numberOfChannels * 4 > 256 * 1024 * 1024) {
        throw new Error(pt("This track is too large to keep in sampler memory."));
      }
      if (intentVersion !== instrumentIntentVersion || !loopMatchesInstrumentSnapshot(descriptor)) return;
      instrumentBuffer = buffer;
      instrumentTimeCache = null;
      instrumentPreparing = false;
      instrumentOperationId = null;
      setInstrumentMode(true);
    } catch (error) {
      if (intentVersion !== instrumentIntentVersion) return;
      instrumentPreparing = false;
      instrumentOperationId = null;
      instrumentSnapshot = null;
      setInstrumentMode(false, { clearBuffer: true, message: error?.message || pt("Could not prepare this loop instrument.") });
    }
  }

  function instrumentSelection() {
    if (instrumentSnapshot?.saved) return { start: 0, end: instrumentBuffer.duration };
    const range = waveformDrawPreview || loopState;
    const rate = instrumentSnapshot?.playbackTransform.rate || 1;
    const start = Math.max(0, range.startMs / 1000 / rate);
    const end = Math.min(instrumentBuffer?.duration || 0, range.endMs / 1000 / rate);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
  }

  function syncInstrumentSelection() {
    if (!instrumentMode || !instrumentBuffer || instrumentSnapshot?.saved) return;
    const range = instrumentSelection();
    for (const voice of instrumentVoices) {
      if (voice.stretched) {
        if (range?.start !== voice.originalSelection.start || range?.end !== voice.originalSelection.end) releaseInstrumentVoice(voice);
        continue;
      }
      if (voice.releasing || voice.cleaned) continue;
      const now = voice.context.currentTime;
      const position = range ? voice.padPosition + Math.max(0, now - voice.padRateChangedAt) * voice.playbackRate + range.start - voice.selectionStart : Infinity;
      if (!range || position >= range.end) {
        releaseInstrumentVoice(voice);
        continue;
      }
      voice.padPosition = position;
      voice.padRateChangedAt = now;
      voice.selectionEnd = range.end;
      voice.sampleEndAt = now + (range.end - position) / voice.playbackRate;
      if (voice.selectionStart !== range.start) {
        const previousSource = voice.source;
        const previousFade = voice.sourceFade;
        const source = voice.context.createBufferSource();
        const fade = voice.context.createGain();
        source.buffer = instrumentBuffer;
        source.playbackRate.value = voice.playbackRate;
        source.connect(fade).connect(voice.gain);
        fade.gain.setValueAtTime(0, now);
        fade.gain.linearRampToValueAtTime(1, now + .008);
        source.start(now, position);
        previousSource.onended = () => { previousSource.disconnect(); previousFade.disconnect(); };
        const heldGain = previousFade.gain.value;
        if (previousFade.gain.cancelAndHoldAtTime) previousFade.gain.cancelAndHoldAtTime(now);
        else { previousFade.gain.cancelScheduledValues(now); previousFade.gain.setValueAtTime(heldGain, now); }
        previousFade.gain.linearRampToValueAtTime(0, now + .008);
        previousSource.stop(now + .008);
        voice.source = source;
        voice.sourceFade = fade;
        voice.selectionStart = range.start;
        source.onended = () => cleanupInstrumentVoice(voice);
      }
      voice.source.stop(voice.sampleEndAt);
    }
  }

  async function playInstrumentNote(midiNote, key = String(midiNote)) {
    if (!capability("loopInstrument") || !instrumentMode || !instrumentBuffer) return;
    const noteRevision = instrumentCutItself ? ++instrumentNoteRevision : instrumentNoteRevision;
    const held = { voice: null };
    const previousKey = instrumentKeys.get(key);
    releaseInstrumentVoice(previousKey?.voice);
    instrumentKeys.set(key, held);
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
      if (noteRevision !== instrumentNoteRevision || instrumentKeys.get(key) !== held || !capability("loopInstrument") ||
          !instrumentMode || instrumentBuffer !== buffer || ui?.panel.hidden || document.hidden) return;
      let range = instrumentSelection();
      if (!range) return;
      const originalSelection = range;
      let noteBuffer = buffer;
      const timePercent = instrumentSettings.timePercent;
      if (timePercent !== 100) {
        const signature = `${range.start}:${range.end}:${timePercent}`;
        if (instrumentTimeCache?.buffer !== buffer || instrumentTimeCache.signature !== signature) {
          const promise = encodeInstrumentAudio(buffer, range)
            .then(audio => requestPad("preset-render", { settings: { audio, timePercent } }))
            .then(async result => context.decodeAudioData(await (await fetch(result.audio)).arrayBuffer()));
          instrumentTimeCache = { buffer, signature, promise };
          promise.catch(() => { if (instrumentTimeCache?.promise === promise) instrumentTimeCache = null; });
        }
        noteBuffer = await instrumentTimeCache.promise;
        const currentRange = instrumentSelection();
        if (noteRevision !== instrumentNoteRevision || instrumentKeys.get(key) !== held || !instrumentMode || instrumentBuffer !== buffer || instrumentSettings.timePercent !== timePercent || currentRange?.start !== range.start || currentRange?.end !== range.end || ui?.panel.hidden || document.hidden) return;
        range = { start: 0, end: noteBuffer.duration };
      }
      if (instrumentCutItself) {
        for (const voice of instrumentVoices) releaseInstrumentVoice(voice);
      }
      // Bound overlapping voices, including long release tails.
      if (instrumentVoices.size >= 32) {
        const oldest = instrumentVoices.values().next().value;
        oldest.source.stop();
        cleanupInstrumentVoice(oldest);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      const sourceFade = context.createGain();
      source.buffer = noteBuffer;
      source.playbackRate.value = globalThis.SCSamplerCore.playbackRateForMidi(midiNote) * 2 ** (instrumentSettings.pitchSemitones / 12);
      const padGain = context.createGain();
      padGain.gain.value = instrumentSettings.gainPercent / 100;
      source.connect(sourceFade).connect(gain).connect(padGain).connect(context.destination);
      const voice = { source, sourceFade, gain, padGain, midiNote, originalSelection, stretched: timePercent !== 100,
        padPosition: range.start, padRateChangedAt: context.currentTime, selectionEnd: range.end,
        context, key, keyReleased: held.released === true, startedAt: context.currentTime,
        selectionStart: range.start, playbackRate: source.playbackRate.value,
        sampleEndAt: context.currentTime + (range.end - range.start) / source.playbackRate.value,
        cleanupTimer: null, releasing: false, cleaned: false };
      held.voice = voice;
      instrumentVoices.add(voice);
      instrumentVoice = voice;
      source.onended = () => {
        cleanupInstrumentVoice(voice);
      };
      try {
        scheduleInstrumentEnvelope(voice, true);
        source.start(voice.startedAt, range.start);
        source.stop(voice.sampleEndAt);
        if (held.released && instrumentKeys.get(key) === held) instrumentKeys.delete(key);
        renderPlayingNote(midiNote);
      } catch (error) {
        cleanupInstrumentVoice(voice);
        throw error;
      }
    } catch (error) {
      if (noteRevision !== instrumentNoteRevision) return;
      showDrumError(error?.message || pt("Could not play the loop instrument."));
    }
  }

  function cachePadBuffer(pad, buffer) {
    const bytes = value => value ? value.length * value.numberOfChannels * 4 : 0;
    const budget = 64 * 1024 * 1024;
    pad.buffer = null;
    pad.lastUsed = performance.now();
    const editorBytes = padEditor?.buffer === buffer ? 0 : bytes(padEditor?.buffer);
    if (bytes(buffer) + editorBytes <= budget) pad.buffer = buffer;
    enforcePadCacheBudget(pad.buffer);
  }

  async function loadDefaultDrum(pad) {
    if (pad.buffer) return pad.buffer;
    if (pad.loading) return pad.loading;
    if (!pad.sample && !pad.saved) throw new Error(pt("Hold this pad to load a sample, or assign a loop to it."));
    const base = document.documentElement.getAttribute(EXTENSION_DRUM_SAMPLES_ATTRIBUTE);
    if (!base && !pad.saved) throw new Error(pt("The drum samples are not ready yet."));
    const version = pad.version;
    const cacheRevision = padCacheRevision;
    const loading = (async () => {
      const url = pad.saved || pad.timePercent !== 100
        ? (await requestPad("get", { index: drumPads.indexOf(pad), timePercent: pad.timePercent })).pad?.dataUrl
        : new URL(pad.sample, base).href;
      if (!url) throw new Error(pt("The saved sample is unavailable."));
      const response = await fetch(url);
      if (!response.ok) throw new Error(pt("Could not load $1.", pt(pad.name)));
      const buffer = await getDrumAudioContext().decodeAudioData(await response.arrayBuffer());
      if (pad.version === version && padCacheRevision === cacheRevision) cachePadBuffer(pad, buffer);
      return buffer;
    })();
    pad.loading = loading;
    try { return await loading; }
    finally { if (pad.loading === loading) pad.loading = null; }
  }

  function updatePadControl(index, name, value) {
    const pad = instrumentMode ? instrumentSettings : drumPads[index];
    const limits = { gainPercent: [0, 154], pitchSemitones: [-12, 12], timePercent: [25, 400] };
    if (!pad || !limits[name] || !Number.isFinite(value) || pad.busy) return;
    const next = Math.round(Math.max(limits[name][0], Math.min(limits[name][1], value)));
    if (pad[name] === next) return;
    pad[name] = next;
    if (ui?.instrumentControls) ui.instrumentControls.renderedSettings = null;
    if (name === "timePercent") {
      if (instrumentMode) {
        instrumentTimeCache = null;
        invalidatePendingInstrumentNotes();
        return;
      }
      // Re-render from the saved original on the next hit. Invalidate pending
      // notes too, so an older stretch can never play after a newer edit.
      pad.version++;
      pad.buffer = null;
      pad.loading = null;
      return;
    }
    for (const voice of instrumentVoices) {
      if ((instrumentMode ? voice.midiNote === undefined : voice.padIndex !== index) || voice.cleaned) continue;
      const now = voice.context.currentTime;
      if (name === "gainPercent") {
        voice.padGain.gain.setTargetAtTime(pad.gainPercent / 100, now, .008);
      } else {
        // Integrate the old rate before changing it; elapsed * new rate would
        // move the sample cursor and truncate notes after live pitch edits.
        voice.padPosition += Math.max(0, now - voice.padRateChangedAt) * voice.playbackRate;
        voice.padRateChangedAt = now;
        voice.playbackRate = 2 ** (pad.pitchSemitones / 12) * (instrumentMode ? globalThis.SCSamplerCore.playbackRateForMidi(voice.midiNote) : 1);
        voice.source.playbackRate.setValueAtTime(voice.playbackRate, now);
        voice.sampleEndAt = now + Math.max(0, (voice.selectionEnd ?? voice.source.buffer.duration) - voice.padPosition) / voice.playbackRate;
        if (voice.livePadTrim) schedulePadTrimFade(voice);
        if (voice.releasing) scheduleInstrumentEnvelope(voice);
        else voice.source.stop(voice.sampleEndAt);
      }
    }
  }

  function bindPadControls(root) {
    const selected = () => instrumentMode ? instrumentSettings : drumPads[selectedPadIndex];
    for (const knob of root.querySelectorAll(".pad-knob[data-pad-control]")) {
      const name = knob.dataset.padControl;
      const gain = name === "gainPercent";
      const time = name === "timePercent";
      const minimum = gain ? 0 : time ? 25 : -12;
      const maximum = gain ? 154 : time ? 400 : 12;
      const render = () => {
        const value = selected()[name];
        knob.setAttribute("aria-label", `${instrumentMode ? pt("Keyboard") : pt("Selected pad")} ${pt(gain ? "Gain" : time ? "Time" : "Pitch")}`);
        const label = gain || time ? `${value}%` : `${value > 0 ? "+" : ""}${value} st`;
        knob.style.setProperty("--knob-angle", `${-135 + (value - minimum) / (maximum - minimum) * 270}deg`);
        knob.setAttribute("aria-valuenow", String(value));
        knob.setAttribute("aria-valuetext", label);
        knob.title = `${gain ? pt("Gain") : time ? pt("Time (duration, keeps tone; next hit)") : pt("Pitch")}: ${label} · ${pt("Double-click to reset")}`;
        knob.nextElementSibling.textContent = label;
      };
      const update = value => { updatePadControl(selectedPadIndex, name, value); render(); };
      let drag = null;
      knob.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        drag = { id: event.pointerId, y: event.clientY, value: selected()[name] };
        knob.setPointerCapture(event.pointerId);
        knob.focus();
        event.preventDefault();
      });
      knob.addEventListener("pointermove", event => {
        if (drag?.id === event.pointerId) update(drag.value + (drag.y - event.clientY) * (maximum - minimum) / 140);
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) knob.addEventListener(type, () => { drag = null; });
      knob.addEventListener("dblclick", () => update(gain || time ? 100 : 0));
      knob.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        update(event.key === "Home" ? minimum : event.key === "End" ? maximum
          : selected()[name] + (["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1) * (event.shiftKey ? 10 : 1));
      });
      knob.renderControl = render;
      render();
    }
  }

  function schedulePadTrimFade(voice) {
    const now = voice.context.currentTime;
    const fade = Math.min(.003, (voice.selectionEnd - voice.selectionStart) / 2);
    const elapsed = voice.padPosition - voice.selectionStart;
    const remaining = voice.selectionEnd - voice.padPosition;
    const gain = voice.sourceFade.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0, Math.min(1, elapsed / fade, remaining / fade)), now);
    if (elapsed < fade) gain.linearRampToValueAtTime(1, now + (fade - elapsed) / voice.playbackRate);
    if (remaining > fade) gain.setValueAtTime(1, voice.sampleEndAt - fade / voice.playbackRate);
    gain.linearRampToValueAtTime(0, Math.max(now, voice.sampleEndAt));
  }

  async function playDrum(index, key = `pad:${index}`, released = true) {
    const pad = drumPads[index];
    if (!pad || pad.busy || instrumentMode) return;
    if (!waveformDrag) {
      selectedPadIndex = index;
    }
    renderSelectedPadControls();
    const noteRevision = instrumentCutItself ? ++instrumentNoteRevision : instrumentNoteRevision;
    const held = { voice: null, released };
    releaseInstrumentVoice(instrumentKeys.get(key)?.voice);
    instrumentKeys.set(key, held);
    try {
      const context = getDrumAudioContext();
      if (context.state !== "running") await context.resume();
      if (padHydration || !padsHydrated) {
        if (!await hydrateDrumPads()) throw new Error(pt("Could not restore saved samples. Reopen Sampler to retry."));
      }
      if (pad.busy) return;
      let editor = padEditorCache.get(index);
      if (!editor?.buffer || editor.version !== pad.version || pad.timePercent !== 100) editor = null;
      if (!editor) await pad.trimSave;
      const version = pad.version;
      if (!pad.buffer && pad.timePercent !== 100) showDrumError(pt("Preparing sample time…"));
      const buffer = editor?.buffer || pad.buffer || await loadDefaultDrum(pad);
      const offset = editor ? editor.trim.startMs / 1000 : 0;
      const end = editor ? editor.trim.endMs / 1000 : buffer.duration;
      pad.lastUsed = performance.now();
      if (editor) editor.lastUsed = pad.lastUsed;
      if (noteRevision !== instrumentNoteRevision || instrumentKeys.get(key) !== held ||
          pad.version !== version || pad.busy || instrumentMode || ui?.panel.hidden || document.hidden) return;
      if (instrumentCutItself) {
        for (const voice of instrumentVoices) releaseInstrumentVoice(voice);
      }
      if (instrumentVoices.size >= 32) {
        const oldest = instrumentVoices.values().next().value;
        oldest.source.stop();
        cleanupInstrumentVoice(oldest);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      const padGain = context.createGain();
      padGain.gain.value = (pad.gainPercent ?? 100) / 100;
      source.playbackRate.value = 2 ** ((pad.pitchSemitones ?? 0) / 12);
      const sourceFade = editor ? context.createGain() : null;
      if (sourceFade) source.connect(sourceFade).connect(gain);
      else source.connect(gain);
      gain.connect(padGain).connect(context.destination);
      const voice = { source, sourceFade, livePadTrim: Boolean(editor), gain, padGain, padIndex: index, envelope: pad.envelope, context, key, keyReleased: held.released === true,
        padPosition: offset, selectionStart: offset, selectionEnd: end, padRateChangedAt: context.currentTime, playbackRate: source.playbackRate.value,
        startedAt: context.currentTime, sampleEndAt: context.currentTime + (end - offset) / source.playbackRate.value,
        cleanupTimer: null, releasing: false, cleaned: false };
      held.voice = voice;
      instrumentVoices.add(voice);
      instrumentVoice = voice;
      source.onended = () => cleanupInstrumentVoice(voice);
      try {
        if (sourceFade) schedulePadTrimFade(voice);
        scheduleInstrumentEnvelope(voice, true);
        source.start(voice.startedAt, offset);
        source.stop(voice.sampleEndAt);
        if (held.released) {
          instrumentKeys.delete(key);
          if (instrumentAdsrEnabled) releaseInstrumentVoice(voice, (voice.envelope || instrumentEnvelope).release, true);
        }
      } catch (error) {
        cleanupInstrumentVoice(voice);
        throw error;
      }
      ui?.drumButtons[index].classList.add("is-active");
      setTimeout(() => ui?.drumButtons[index].classList.remove("is-active"), 140);
      showDrumError("");
    } catch (error) {
      if (noteRevision === instrumentNoteRevision) showDrumError(error?.message || pt("Could not play this sample."));
    } finally {
      if (!held.voice && instrumentKeys.get(key) === held) instrumentKeys.delete(key);
    }
  }

  async function loadCustomDrum(index, file) {
    if (!file) return;
    if (drumPads[index]?.busy) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|ogg|m4a|flac|aac)$/i.test(file.name)) {
      showDrumError(pt("Choose an audio file for this pad."));
      return;
    }
    const pad = drumPads[index];
    const version = ++pad.version;
    if (padEditorPending || padEditor?.index === index) leavePadEditor();
    pad.busy = true;
    updateDrumLabels();
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error(pt("This sample is too large for a pad."));
      const bytes = await file.arrayBuffer();
      const buffer = await getDrumAudioContext().decodeAudioData(bytes.slice(0));
      const pcmBytes = buffer.length * buffer.numberOfChannels * 4;
      if (buffer.duration > 30 || pcmBytes > 16 * 1024 * 1024) {
        throw new Error(pt("Samples must be 30 seconds or shorter and fit the pad memory limit."));
      }
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const name = file.name.replace(/\.[^.]+$/, "") || pad.name;
      await pad.trimSave;
      await requestPad("store", { index, name, mimeType: file.type || "audio/wav", base64, operationId: `pad_${crypto.randomUUID()}` });
      if (pad.version !== version) return;
      pad.buffer = null;
      if (!ui?.panel.hidden && pad.timePercent === 100) cachePadBuffer(pad, buffer);
      pad.saved = true;
      pad.customName = name;
      updateDrumLabels();
      showDrumError("");
    } catch (error) {
      showDrumError(error?.message || pt("Could not read that audio sample."));
    } finally {
      pad.busy = false;
      updateDrumLabels();
    }
  }

  async function resetDrumPad(index) {
    const pad = drumPads[index];
    if (!pad?.saved || pad.busy) return;
    if (padEditorPending || padEditor?.index === index) leavePadEditor();
    pad.busy = true;
    pad.version += 1;
    updateDrumLabels();
    try {
      await pad.trimSave;
      await requestPad("delete", { index, operationId: `pad_${crypto.randomUUID()}` });
      pad.saved = false;
      pad.customName = "";
      pad.updatedAt = undefined;
      pad.buffer = null;
      pad.loading = null;
      showDrumError(pt("Default sample restored."));
    } catch (error) {
      showDrumError(error?.message || pt("Could not remove the saved sample."));
    } finally {
      pad.busy = false;
      updateDrumLabels();
    }
  }

  function handleDrumKeydown(event) {
    if (!ui || ui.panel.hidden || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (ui.samplerPresetMenu.matches(":popover-open")) return;
    if (ui.sliceDialog.open) return;
    if (sliceJob && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelSlices();
      return;
    }
    if (instrumentMode) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setInstrumentMode(false, { message: "" });
        ui.instrumentToggle?.focus();
        return;
      }
      const target = event.composedPath()[0];
      if ((target?.classList?.contains("envelope-knob") || target?.classList?.contains("pad-knob") || target?.classList?.contains("waveform-marker")) && /^(Arrow|Home$|End$)/.test(event.key)) return;
      if (target?.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "") &&
          !target.classList.contains("instrument-cut-itself") && !target.classList.contains("instrument-adsr-toggle"))) return;
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
      if (!event.repeat) playInstrumentNote(midiNote + instrumentOctave * 12, event.code || event.key);
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
    if (target?.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "") &&
        !target.classList.contains("instrument-cut-itself") && !target.classList.contains("instrument-adsr-toggle"))) return;
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
    playDrum(index, event.code || event.key, false);
  }

  // Installed at document_start on window: SoundCloud can register capture
  // listeners before the lazily mounted panel exists.
  function handlePlayerToolsKey(event) {
    if (event.type === "keyup") releaseInstrumentKey(event);
    if (!ui || ui.panel.hidden || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.composedPath()[0];
    const editable = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
    const samplerToggle = target?.classList?.contains("instrument-cut-itself") || target?.classList?.contains("instrument-adsr-toggle");
    if (editable && !samplerToggle) return;
    if (event.type === "keydown") handleDrumKeydown(event);
    // Cover unassigned keys, held-key repeats, keypress and keyup as well.
    // Leave focus navigation and the focused controls' arrow keys available.
    const controlArrow = event.composedPath().includes(ui.host) && /^(Arrow|Home$|End$)/.test(event.key);
    const controlSpace = event.key === " " && (target?.tagName === "BUTTON" || samplerToggle);
    if (!controlArrow && !controlSpace && (/^[a-z0-9,./;'\[\]\\=\-]$/i.test(event.key) || /^( |ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(event.key))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  for (const type of ["keydown", "keypress", "keyup"]) {
    window.addEventListener(type, handlePlayerToolsKey, true);
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
    if (code === "trial-expired") return pt("Your 7-day Player Tools trial has ended. Player Tools Pro is required to keep using this feature.");
    if (code === "trial-exhausted" || code === "pro-required") return pt("Player Tools Pro is required to keep using this feature.");
    if (code === "stale-generation") return pt("The track changed. Please set the loop again.");
    return pt("Player Tools access could not be confirmed. Please retry.");
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
    if (padEditor || padEditorPending) leavePadEditor();
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
    cancelSlices();
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
      attempt(pt("Pitch"), () => controller.setPreservePitch(DEFAULTS.preservePitch));
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
      if (resetErrors.length) effectsFailure = pt("Could not fully reset Player Tools. $1", resetErrors.join("; "));
    } finally {
      if (generation === resetGeneration) resetInProgress = false;
      render();
    }
  }

  async function applyPlayerPitch(enabled) {
    if (padEditor || padEditorPending) leavePadEditor();
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
    ...(platform ? { isAudio: platform.isMedia } : {}),
    initialRate: readStoredRate(),
    initialPreservePitch: readStoredPitch(),
    onChange: render,
    onError(error) {
      playbackFailure = IS_YOUTUBE
        ? pt("Could not change playback speed. Reload YouTube and retry.")
        : pt("Could not change playback speed. Reload SoundCloud and retry.");
      console.warn("[SC Downloader Tempo]", error);
      render();
    },
  });

  const effectsController = effectsApi?.create({
    getActiveAudio() {
      const discovered = controller.getActiveAudio?.();
      if (discovered) return discovered;
      if (platform) return platform.media();
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

  // A speed picked in YouTube's own menu or with < > becomes the Player Tools speed.
  if (IS_YOUTUBE) {
    platform.onRateChange((rate) => {
      if (Math.abs(rate - controller.snapshot().rate) > 0.001) applyPlayerRate(rate, { animate: true });
    });
  }

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
      ? pt("Play a track to activate FX.")
      : "";
    render();
    return state;
  }

  function startEchoFreeze() {
    if (effectsController?.isDelayFrozen?.()) return;
    if (!effectsController?.setDelayFreeze(true)) return;
    echoFreezeRevision += 1;
    echoFreezePlayback = null;
    const audio = controller.getActiveAudio?.();
    if (audio?.paused === false) {
      try {
        audio.pause();
        echoFreezePlayback = {
          audio,
          source: audio.currentSrc || audio.src || "",
        };
      } catch (error) {
        effectsController.setDelayFreeze(false);
        effectsFailure = pt("Could not pause playback for Echo Freeze.");
        console.warn("[SC Downloader Effects]", error);
      }
    }
    renderEffects();
  }

  function releaseEchoFreeze({ resumePlayback = true } = {}) {
    const wasFrozen = effectsController?.isDelayFrozen?.() === true;
    const playback = echoFreezePlayback;
    if (!wasFrozen && !playback) return;
    echoFreezePlayback = null;
    const revision = ++echoFreezeRevision;
    if (wasFrozen) effectsController.setDelayFreeze(false);
    renderEffects();
    if (!resumePlayback || !playback?.audio || playback.audio.paused === false) return;
    const currentSource = playback.audio.currentSrc || playback.audio.src || "";
    if (currentSource !== playback.source) return;
    try {
      Promise.resolve(playback.audio.play()).catch((error) => {
        if (revision !== echoFreezeRevision || effectsController?.isDelayFrozen?.()) return;
        playbackFailure = pt("Echo Freeze ended, but playback could not resume. Press play to continue.");
        console.warn("[SC Downloader Effects]", error);
        render();
      });
    } catch (error) {
      if (revision !== echoFreezeRevision || effectsController?.isDelayFrozen?.()) return;
      playbackFailure = pt("Echo Freeze ended, but playback could not resume. Press play to continue.");
      console.warn("[SC Downloader Effects]", error);
      render();
    }
  }

  function writeSetting(key, value) {
    try {
      localStorage.setItem(key, String(value));
      storageFailure = "";
      return true;
    } catch {
      storageFailure = pt("Could not save this playback setting.");
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
    if (instrumentSnapshot && !instrumentSnapshot.saved && (
      !nextLoop.active ||
      nextLoop.trackIdentity !== instrumentSnapshot.trackIdentity ||
      nextLoop.generation !== instrumentSnapshot.generation ||
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
    syncInstrumentSelection();
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

  function setLoopFailure(response) {
    const error = response?.error;
    loopFailure = error === "waiting-metadata" || error === "waiting-track"
      ? pt("Loop is waiting for the current track metadata.")
      : error === "stale-generation"
        ? pt("The track changed. Please set the loop again.")
        : error ? pt("Could not update the loop. Please retry.") : "";
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
    const loopState = editorState();
    return Number.isFinite(value) && Number.isFinite(loopState.durationMs) && loopState.durationMs > 0
      ? Math.max(0, Math.min(100, value / loopState.durationMs * 100))
      : 0;
  }

  function visibleWaveformWindow() {
    const loopState = editorState();
    const durationMs = loopState.durationMs;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    return globalThis.SCLooperCore?.normalizeZoomWindow?.(padEditor ? padEditorZoom : waveformZoom, durationMs) || { startMs: 0, endMs: durationMs };
  }

  function waveformTime(clientX) {
    const rect = ui.waveformStage.getBoundingClientRect();
    const window = visibleWaveformWindow();
    return window && globalThis.SCLooperCore?.positionToTime
      ? globalThis.SCLooperCore.positionToTime(clientX, rect.left, rect.width, window)
      : null;
  }

  function drawWaveform() {
    const loopState = editorState();
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
      padEditor ? null : displayedRange.startMs, padEditor ? null : displayedRange.endMs, loopState.active]);
    if (drawKey === waveformStaticKey) return;
    waveformStaticKey = drawKey;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0e1216";
    context.fillRect(0, 0, width, height);
    if (!windowRange) return;
    const durationMs = loopState.durationMs;
    const samples = padEditor ? padEditor.peaks : waveformSpectrum?.peaks || waveformSamples;
    const complete = Number.isFinite(displayedRange.startMs) && Number.isFinite(displayedRange.endMs);
    const start = complete ? loopPercentInWindow(displayedRange.startMs, windowRange) : -1;
    const end = complete ? loopPercentInWindow(displayedRange.endMs, windowRange) : -1;
    // One column per physical pixel; peak aggregation preserves short transients.
    let maximum = 0;
    for (const sample of samples) maximum = Math.max(maximum, Math.abs(Number(sample) || 0));
    if (!samples.length || !maximum) return;
    const bands = padEditor ? null : waveformSpectrum?.bands;
    const sourceDuration = padEditor ? padEditor.buffer?.duration * 1000 : waveformSpectrum?.durationMs || durationMs;
    for (let x = 0; x < width; x += 1) {
      const from = (windowRange.startMs + x / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      const to = (windowRange.startMs + (x + 1) / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      let peak = 0, low = 0, mid = 0, high = 0;
      for (let i = Math.max(0, Math.floor(from)); i < Math.min(samples.length, Math.max(Math.floor(from) + 1, Math.ceil(to))); i += 1) {
        peak = Math.max(peak, Math.abs(Number(samples[i]) || 0));
        if (bands) { low += bands[i * 3]; mid += bands[i * 3 + 1]; high += bands[i * 3 + 2]; }
      }
      const energy = Math.max(low, mid, high);
      context.fillStyle = bands && energy > 0
        ? 'rgb(' + [low, mid, high].map(value => Math.round(55 + 190 * Math.sqrt(value / energy))).join(',') + ')'
        : '#858d96';
      const percent = x / width * 100;
      context.globalAlpha = !padEditor && complete && (percent < start || percent > end) ? .58 : .96;
      const barHeight = peak / maximum * height * .88;
      context.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }
    context.globalAlpha = 1;
  }

  function renderWaveformPlayhead() {
    if (!ui?.waveformPlayhead || waveformCollapsed || ui.panel.hidden || document.hidden) return;
    if (padEditor) { ui.waveformPlayhead.hidden = true; return; }
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

  // Without the audio file, the waveform fills in as the video is heard.
  function startLiveWaveform() {
    if (!globalThis.SCLiveWaveform || !effectsController) return;
    liveWaveform ||= globalThis.SCLiveWaveform.create({
      effects: effectsController,
      getMedia: () => platform.media(),
      getIdentity: () => platform.trackIdentity(),
      isSuspended: () => platform.isAdPlaying(),
    });
    // Keeps listening once started, so playback with the panel closed still counts.
    liveWaveform.start();
    if (liveWaveformTimer === null) liveWaveformTimer = setInterval(refreshLiveWaveform, 250);
    ui.waveformCanvas.title = pt("The waveform fills in as the video plays. Red: bass | Green: mids | Blue: treble");
    refreshLiveWaveform();
  }

  function refreshLiveWaveform() {
    if (!liveWaveform || !ui || ui.panel.hidden || waveformCollapsed) return;
    const identity = platform.trackIdentity();
    const revision = liveWaveform.revision();
    if (identity === waveformTrackUrl && revision === liveWaveformRevision) return;
    if (identity !== waveformTrackUrl) waveformZoom = null;
    waveformTrackUrl = identity;
    liveWaveformRevision = revision;
    waveformSamples = [];
    waveformSpectrum = liveWaveform.snapshot();
    waveformRevision += 1;
    renderLoop();
  }

  async function loadPlayerWaveform() {
    if (waveformCollapsed || !ui?.waveformCanvas || ui.panel.hidden) return;
    if (IS_YOUTUBE) { startLiveWaveform(); return; }
    let descriptor = null;
    try { descriptor = JSON.parse(document.documentElement.getAttribute(PLAYER_WAVEFORM_ATTRIBUTE) || "null"); } catch {}
    if (!descriptor) {
      waveformLoadId += 1; waveformSamples = []; waveformSpectrum = null;
      waveformTrackUrl = null; waveformSourceUrl = null; waveformRevision += 1; renderLoop(); return;
    }
    if (descriptor.trackUrl === waveformTrackUrl && (descriptor.waveformUrl || null) === waveformSourceUrl &&
        !Array.isArray(descriptor.samples) && (waveformSamples.length || waveformSpectrum || waveformAnalysisCache)) return;
    waveformTrackUrl = descriptor.trackUrl;
    waveformSourceUrl = descriptor.waveformUrl || null;
    waveformZoom = null;
    waveformSamples = [];
    waveformSpectrum = null;
    waveformRevision += 1;
    const loadId = waveformLoadId += 1;
    renderLoop();
    if (Array.isArray(descriptor.samples)) { waveformSamples = descriptor.samples; waveformRevision += 1; renderLoop(); return; }
    loadSpectralWaveform(descriptor.trackUrl, loadId);
    if (!descriptor.waveformUrl) { renderLoop(); return; }
    try {
      const response = await fetch(descriptor.waveformUrl);
      const data = await response.json();
      if (loadId !== waveformLoadId) return;
      waveformSamples = Array.isArray(data.samples) ? data.samples : [];
    } catch (error) {
      console.warn("[SC Downloader] Player waveform could not be loaded.", descriptor.waveformUrl, error);
      if (loadId !== waveformLoadId) return; waveformSamples = [];
    }
    waveformRevision += 1;
    renderLoop();
  }

  async function loadSpectralWaveform(trackUrl, loadId) {
    if (!trackUrl) return;
    ui.waveformCanvas.title = pt('Analyzing audio frequencies...');
    let analysis;
    try {
      if (waveformAnalysisCache?.trackUrl !== trackUrl) {
        const promise = requestPad('waveform', { trackUrl }).then(result => result.waveform);
        waveformAnalysisCache = { trackUrl, promise };
      }
      analysis = waveformAnalysisCache;
      const data = await analysis.promise;
      if (loadId !== waveformLoadId || waveformCollapsed) return;
      if (!Array.isArray(data?.peaks) || !data.peaks.length || data.peaks.length > 65536 ||
          !Array.isArray(data.bands) || data.bands.length !== data.peaks.length * 3 ||
          !Number.isFinite(data.durationMs) || data.durationMs <= 0 ||
          !data.peaks.every(value => Number.isFinite(value) && value >= 0) ||
          !data.bands.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid waveform');
      waveformSpectrum = data;
      waveformRevision += 1;
      ui.waveformCanvas.title = pt('Red: bass | Green: mids | Blue: treble');
      renderLoop();
    } catch (error) {
      console.warn("[SC Downloader] Spectral waveform analysis failed.", trackUrl, error);
      if (waveformAnalysisCache === analysis) waveformAnalysisCache = null;
      if (loadId === waveformLoadId) ui.waveformCanvas.title = pt('Amplitude waveform | Frequency analysis unavailable');
    }
  }

  function commitLoopRender() {
    const loopState = editorState();
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
      padIndex: padEditor?.index, waveformCollapsed, duration, start: displayedRange.startMs, end: displayedRange.endMs,
      preview: Boolean(waveformDrawPreview), active: loopState.active, available: loopState.available, windowRange,
      slicePending: Boolean(sliceJob), sliceCommitting: sliceJob?.committing, loopDownloadPending, padRenderPending, saveAllowed: capability("saveLoopPad"),
      instrumentAllowed: capability("loopInstrument"), instrumentMode, instrumentPreparing,
    });
    if (presentationKey !== loopPresentationKey) {
      loopPresentationKey = presentationKey;
      sectionControllers.loop?.setCollapsed(waveformCollapsed, { notify: false });
    ui.waveformSelection.style.left = `${startPercent}%`;
    ui.waveformSelection.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    ui.waveformSelection.hidden = !waveformDrawPreview && !loopState.active;
    ui.waveformPadShade.hidden = !padEditor;
    if (padEditor) {
      ui.waveformPadShade.style.setProperty("--pad-start", `${Math.max(0, Math.min(100, startPercent))}%`);
      ui.waveformPadShade.style.setProperty("--pad-end", `${Math.max(0, Math.min(100, endPercent))}%`);
    }
    for (const [marker, value, letter] of [[ui.waveformStart, displayedRange.startMs, "a"], [ui.waveformEnd, displayedRange.endMs, "b"]]) {
      marker.hidden = !Number.isFinite(value) || !windowRange || value < windowRange.startMs || value > windowRange.endMs;
      marker.style.left = `${loopPercentInWindow(value, windowRange)}%`;
      marker.textContent = letter;
      marker.setAttribute("aria-valuenow", String(Math.round(value || 0)));
      marker.setAttribute("aria-valuetext", formatLoopTime(value));
    }
    const hasLoopMarker = Number.isFinite(loopState.startMs) || Number.isFinite(loopState.endMs);
    ui.clearLoop.disabled = !loopState.available || !hasLoopMarker || loopDownloadPending;
    ui.downloadLoop.disabled = !loopState.active || loopDownloadPending;
    // A YouTube loop recording stays clickable so Stems can cancel it.
    if (ui.separateStems) ui.separateStems.disabled = !loopState.active || (ui.separateStems.dataset.pending === "true" && !stemCapture);
    ui.sliceButton.disabled = sliceJob ? sliceJob.committing : !capability("saveLoopPad") || !loopState.active || padRenderPending;
    ui.sliceButton.title = samplerCopy(!capability("saveLoopPad") ? "locked" : sliceJob ? "stop" : "slice");
    ui.sliceButton.setAttribute("aria-label", ui.sliceButton.title);
    ui.sliceButton.setAttribute("aria-busy", String(Boolean(sliceJob)));
    ui.saveLoopPad.disabled = !capability("saveLoopPad") || !loopState.active || padRenderPending;
    ui.saveLoopPad.title = capability("saveLoopPad") ? pt("Save loop to a pad") : pt("Player Tools Pro required");
    ui.instrumentToggle.disabled = !capability("loopInstrument") || (!loopState.active && !instrumentMode) || padRenderPending;
    ui.instrumentControls.hidden = false;
    ui.instrumentCutLabel.hidden = false;
    ui.instrumentAdsrLabel.hidden = false;
    ui.drumStatus.hidden = !ui.drumMessage.textContent && !ui.playingNote.textContent;
    ui.drumSection.classList.toggle("is-instrument", instrumentMode);
    ui.instrumentToggle.setAttribute("aria-pressed", String(instrumentMode));
    ui.instrumentToggle.classList.toggle("is-preparing", instrumentPreparing);
    ui.instrumentToggle.setAttribute("aria-label", instrumentPreparing
      ? pt("Cancel loop instrument preparation")
      : instrumentMode ? pt("Disable piano mode") : pt("Play selected loop in piano mode"));
    ui.instrumentToggle.title = instrumentPreparing
      ? pt("Preparing loop instrument…")
      : instrumentMode ? pt("Disable piano mode") : pt("Play selected loop in piano mode");
    if (!capability("loopInstrument")) ui.instrumentToggle.title = pt("Player Tools Pro required");
    ui.waveformStartLabel.textContent = formatLoopTime(windowRange?.startMs || 0);
    ui.waveformMiddleLabel.textContent = formatLoopTime(windowRange ? (windowRange.startMs + windowRange.endMs) / 2 : 0);
    ui.waveformEndLabel.textContent = formatLoopTime(windowRange?.endMs || duration);
    ui.editorTrack.hidden = waveformCollapsed || !padEditor;
    ui.editorTrack.title = editorCopy("back");
    ui.editorTrack.setAttribute("aria-label", editorCopy("back"));
    for (const [marker, letter] of [[ui.waveformStart, "A"], [ui.waveformEnd, "B"]]) {
      const label = (padEditor ? "Pad " + drumPads[padEditor.index].key.toUpperCase() : editorCopy("track")) + " " + letter;
      marker.setAttribute("aria-label", label);
      marker.setAttribute("aria-valuemin", "0");
      marker.setAttribute("aria-valuemax", String(duration));
    }
    if (padEditor) for (const button of [ui.clearLoop, ui.downloadLoop, ui.separateStems, ui.sliceButton, ui.saveLoopPad, ui.instrumentToggle]) button.disabled = true;
    }
    drawWaveform();
    renderWaveformPlayhead();
  }

  function renderLoop() {
    if (sliceConfirmation && !sliceIsCurrent(sliceConfirmation)) closeSliceConfirmation();
    if (sliceJob && !sliceJob.committing && !sliceIsCurrent(sliceJob.snapshot)) cancelSlices(samplerCopy("changed"));
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
      waveformSpectrum = null;
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
    return samplerCollapsed && waveformCollapsed && effectsCollapsed && Boolean(equalizerUi?.isCollapsed()) && (recordUi?.isCollapsed() ?? true);
  }

  function renderControlsVisibility() {
    if (!ui?.visibilityButton) return;
    const allCollapsed = areAllControlsCollapsed();
    const action = controlsHidden
      ? { label: pt("Show all controls in two columns"), icon: "expand", state: "hidden" }
      : controlsGrid
        ? { label: pt("Show controls in one column"), icon: "grid", state: "grid" }
        : allCollapsed
        ? { label: pt("Hide all controls"), icon: "up", state: "collapsed" }
        : { label: pt("Collapse all controls"), icon: "down", state: "normal" };
    ui.panel.classList.toggle("controls-hidden", controlsHidden);
    ui.panel.classList.toggle("controls-grid", controlsGrid && !controlsHidden);
    ui.controlsHiddenMessage.hidden = !controlsHidden;
    ui.visibilityButton.dataset.state = action.state;
    ui.visibilityButton.setAttribute("aria-label", action.label);
    ui.visibilityButton.title = action.label;
    ui.visibilityUpIcon.toggleAttribute("hidden", action.icon !== "up");
    ui.visibilityDownIcon.toggleAttribute("hidden", action.icon !== "down");
    ui.visibilityExpandIcon.hidden = action.icon !== "expand";
    ui.visibilityGridIcon.toggleAttribute("hidden", action.icon !== "grid");
    equalizerUi?.setVisible(!ui.panel.hidden && !controlsHidden);
    recordUi?.setVisible(!ui.panel.hidden && !controlsHidden);
  }

  function setAllControlsCollapsed(collapsed) {
    setSamplerCollapsed(collapsed);
    setWaveformCollapsed(collapsed);
    setEffectsCollapsed(collapsed);
    equalizerUi?.setCollapsed(collapsed, { notify: false });
    recordUi?.setCollapsed(collapsed, { notify: false });
    renderControlsVisibility();
  }

  function cycleControlsVisibility() {
    if (controlsHidden) {
      controlsHidden = false;
      controlsGrid = true;
      setAllControlsCollapsed(false);
    } else if (controlsGrid) {
      controlsGrid = false;
      renderControlsVisibility();
    } else if (areAllControlsCollapsed()) {
      controlsHidden = true;
      renderControlsVisibility();
    } else {
      setAllControlsCollapsed(true);
    }
    if (!ui.panel.hidden) positionPanel();
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

  async function clearLoop() {
    loopIntentVersion += 1;
    disableInstrument("");
    setLoopFailure(requestLoop("clear-loop"));
    await finishLoopSession();
    readLoopState();
  }

  async function setWaveformRange(nextRange, marker = null, options = {}) {
    if (!nextRange) return;
    if (padEditor) { await setPadRange(nextRange); return; }
    const payload = { ...nextRange, marker, enabled: true, startPlayback: !loopState.active };
    await applyAuthorizedLoop(payload, options);
  }

  function beginWaveformDrag(event, kind) {
    if (padEditorPending) return;
    const loopState = editorState();
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
    if (padEditor) {
      const { range, kind, anchorMs, startX } = waveformDrag;
      const next = globalThis.SCSamplerCore.editRange(range, kind, timeMs,
        kind === "create" ? anchorMs : waveformTime(startX));
      waveformDrag.moved = true;
      if (kind === "create") { waveformDrawPreview = next; renderLoop(); }
      else setPadRange(next);
      return;
    }
    let nextRange;
    if (waveformDrag.kind === "create") {
      waveformDrag.moved = true;
      nextRange = core.createRangeFromSelection(
        waveformDrag.range.durationMs,
        waveformDrag.anchorMs,
        timeMs
      );
      waveformDrawPreview = nextRange;
      syncInstrumentSelection();
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
        syncInstrumentSelection();
        renderLoop();
      });
    }
    waveformDrag = null;
  }

  function moveWaveformMarkerByKey(event, marker) {
    if (padEditorPending) return;
    const loopState = editorState();
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const amount = event.shiftKey ? 1000 : 100;
    const value = loopState[`${marker}Ms`] + (event.key === "ArrowLeft" ? -amount : amount);
    if (padEditor) { setPadRange(globalThis.SCSamplerCore.editRange(loopState, marker, value)); return; }
    setWaveformRange(globalThis.SCLooperCore?.moveMarker?.(loopState, marker, value), marker);
  }

  function handleWaveformWheel(event) {
    const loopState = editorState();
    if (!Number.isFinite(loopState.durationMs) || !event.deltaY) return;
    const focusMs = waveformTime(event.clientX);
    if (focusMs === null) return;
    event.preventDefault();
    if (padEditor) padEditorZoom = globalThis.SCLooperCore?.zoomWindowAt?.(padEditorZoom, loopState.durationMs, focusMs, event.deltaY) || null;
    else waveformZoom = globalThis.SCLooperCore?.zoomWindowAt?.(waveformZoom, loopState.durationMs, focusMs, event.deltaY) || null;
    renderLoop();
  }

  function editorCopy(key) {
    return { track: pt("Track"), back: pt("Back to track") }[key];
  }

  const SAMPLER_COPY = {
    presets: "Saved sampler states", saveState: "Save state", stateName: "State name",
    noStates: "No saved states yet", deleteState: "Delete state", stateSaved: "Sampler state saved.",
    stateLoaded: "Sampler state restored.", stateFailed: "Could not update sampler states. Please try again.",
    statesLoading: "Loading states…", stateBusy: "Wait for the samples to finish saving.",
    slice: "Slice selected loop into 8 pads",
    title: "Replace all eight pads?",
    confirm: "The selected A–B loop will be split into eight equal slices. This replaces all eight sounds, including custom samples. Your assigned keys will stay the same.",
    replace: "Replace with 8 slices", cancel: "Cancel",
    preparing: "Preparing 8 slices… Press Escape to cancel.",
    stop: "Cancel slice preparation", done: "8 slices saved. Play them with your pad keys.",
    cancelled: "Slice preparation cancelled. Pads were not changed.",
    changed: "The loop or its settings changed. Slice preparation cancelled.",
    failed: "Could not save the eight slices. Please try again.",
    tooLong: "Select a loop of up to 30 seconds at the current speed.",
    locked: "Player Tools Pro required",
    selectPad: "Choose one of the eight pads. Press Escape to cancel.",
  };

  function samplerCopy(key) {
    let copy = {};
    try { copy = JSON.parse(document.documentElement.getAttribute("data-scdl-sampler-copy") || "{}"); } catch {}
    return typeof copy[key] === "string" && copy[key] !== `sampler_${key}` ? copy[key] : pt(SAMPLER_COPY[key]);
  }

  function closeSamplerPresets() {
    if (!ui) return;
    ui.samplerPresetMenu.hidePopover();
    ui.samplerPresetToggle.setAttribute("aria-expanded", "false");
  }

  async function encodeInstrumentAudio(buffer, range) {
    if (!buffer || !range) throw new Error(pt("No instrument sample selected."));
    const start = Math.max(0, Math.floor(range.start * buffer.sampleRate));
    const frames = Math.min(buffer.length, Math.floor(range.end * buffer.sampleRate)) - start;
    const channels = buffer.numberOfChannels;
    const size = frames * channels * 2;
    if (frames <= 0 || size > 32 * 1024 * 1024) throw new Error(pt("Instrument samples must be smaller than 32 MB."));
    const wav = new ArrayBuffer(44 + size);
    const view = new DataView(wav);
    const label = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    label(0, "RIFF"); view.setUint32(4, 36 + size, true); label(8, "WAVE"); label(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, size, true);
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i++) {
        const value = Math.max(-1, Math.min(1, data[start + i]));
        view.setInt16(44 + (i * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([wav], { type: "audio/wav" }));
    });
  }

  function renderSamplerPresetCopy() {
    if (!ui) return;
    ui.samplerPresetToggle.title = samplerCopy("presets");
    ui.samplerPresetToggle.setAttribute("aria-label", samplerCopy("presets"));
    ui.samplerPresetMenu.setAttribute("aria-label", samplerCopy("presets"));
    ui.samplerPresetName.placeholder = samplerCopy("stateName");
    ui.samplerPresetName.setAttribute("aria-label", samplerCopy("stateName"));
    ui.samplerPresetSave.textContent = `+ ${samplerCopy("saveState")} · ${instrumentMode ? pt("Piano") : pt("8 pads")}`;
  }

  function renderSamplerPresetBusy() {
    if (!ui?.samplerPresetMenu) return;
    const busy = samplerPresetBusy || padRenderPending || drumPads.some(pad => pad.busy);
    ui.samplerPresetMenu.querySelectorAll("button, input").forEach(control => { control.disabled = busy; });
    ui.samplerPresetMenu.setAttribute("aria-busy", String(busy));
  }

  function renderSamplerPresets() {
    const list = ui.samplerPresetList;
    list.replaceChildren();
    if (!samplerPresets.length) {
      const empty = document.createElement("p");
      empty.textContent = samplerCopy("noStates");
      list.append(empty);
    }
    for (const preset of samplerPresets) {
      const row = document.createElement("div");
      row.className = "sampler-preset-row";
      const kind = document.createElement("span");
      kind.className = "sampler-preset-kind";
      kind.replaceChildren(globalThis.SCIcons.create(preset.kind === "piano" ? "piano" : "sampler"));
      kind.title = preset.kind === "piano" ? pt("Piano · 1 sample") : pt("8 pads");
      kind.setAttribute("aria-label", kind.title);
      const load = document.createElement("button");
      load.type = "button";
      load.className = "sampler-preset-load";
      load.textContent = preset.name;
      load.title = preset.name;
      load.addEventListener("click", () => runSamplerPreset("load", preset));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sampler-preset-delete";
      remove.replaceChildren(globalThis.SCIcons.create("close"));
      remove.setAttribute("aria-label", `${samplerCopy("deleteState")}: ${preset.name}`);
      remove.title = remove.getAttribute("aria-label");
      remove.addEventListener("click", () => runSamplerPreset("delete", preset));
      row.append(kind, load, remove);
      list.append(row);
    }
    renderSamplerPresetBusy();
    positionSamplerPresets();
  }

  function positionSamplerPresets() {
    const menu = ui?.samplerPresetMenu;
    if (!menu?.matches(":popover-open")) return;
    const rect = ui.samplerPresetToggle.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, innerHeight - menu.offsetHeight - 8))}px`;
  }

  async function openSamplerPresets() {
    if (ui.samplerPresetMenu.matches(":popover-open")) { closeSamplerPresets(); return; }
    const menu = ui.samplerPresetMenu;
    renderSamplerPresetCopy();
    ui.samplerPresetStatus.textContent = samplerCopy("statesLoading");
    menu.showPopover();
    ui.samplerPresetToggle.setAttribute("aria-expanded", "true");
    positionSamplerPresets();
    ui.samplerPresetName.focus();
    const version = ++samplerPresetListVersion;
    try {
      const result = await requestPad("preset-list");
      if (version !== samplerPresetListVersion) return;
      samplerPresets = result.presets;
      renderSamplerPresets();
      ui.samplerPresetStatus.textContent = "";
      positionSamplerPresets();
    } catch {
      if (version === samplerPresetListVersion) ui.samplerPresetStatus.textContent = samplerCopy("stateFailed");
    }
  }

  async function runSamplerPreset(action, preset = null) {
    if (samplerPresetBusy || padRenderPending || drumPads.some(pad => pad.busy)) {
      ui.samplerPresetStatus.textContent = samplerCopy("stateBusy");
      return;
    }
    const name = ui.samplerPresetName.value.trim();
    if (action === "save" && !name) { ui.samplerPresetName.reportValidity(); return; }
    samplerPresetBusy = true;
    if (action === "load" && (padEditor || padEditorPending)) leavePadEditor();
    samplerPresetListVersion++;
    if (action !== "delete") {
      cancelLoopPadSelection();
      drumPads.forEach(pad => { pad.busy = true; });
      padRenderPending = true;
      updateDrumLabels();
      renderLoop();
    }
    renderSamplerPresetBusy();
    ui.samplerPresetStatus.textContent = "";
    try {
      const piano = action === "save" && instrumentMode;
      await Promise.all(drumPads.map(pad => pad.trimSave));
      const instrument = piano ? { ...instrumentSettings, envelope: { ...instrumentEnvelope }, octave: instrumentOctave,
        audio: await encodeInstrumentAudio(instrumentBuffer, instrumentSelection()) } : null;
      const result = await requestPad(`preset-${action}`, { presetId: preset?.id || `preset_${crypto.randomUUID()}`, name,
        ...(action === "save" ? { settings: { kind: piano ? "piano" : "pads", instrument, selectedPadIndex, adsrEnabled: instrumentAdsrEnabled, cutItself: instrumentCutItself,
          pads: drumPads.map(({ key, gainPercent, pitchSemitones, timePercent, envelope }, index) => ({ key, gainPercent, pitchSemitones, timePercent, envelope: { ...envelope },
            ...(piano && index === selectedPadIndex ? { ...instrumentSettings, envelope: { ...instrumentEnvelope } } : {}) })) } } : {}) });
      if (action === "load") {
        if (padEditor || padEditorPending) leavePadEditor();
        const savedInstrument = result.settings.kind === "piano" ? result.settings.instrument : null;
        const restoredBuffer = savedInstrument ? await getDrumAudioContext().decodeAudioData(await (await fetch(savedInstrument.audio)).arrayBuffer()) : null;
        exitInstrument({ message: "" });
        stopAllInstrumentVoices();
        if (!savedInstrument) drumPads.forEach((pad, index) => {
          const record = result.pads.find(item => item.index === index);
          Object.assign(pad, { timePercent: 100 }, result.settings.pads[index], { version: pad.version + 1, saved: Boolean(record),
            customName: record?.name || "", updatedAt: record?.updatedAt, buffer: null, loading: null });
        });
        padsHydrated = true;
        selectedPadIndex = result.settings.selectedPadIndex;
        instrumentCutItself = result.settings.cutItself;
        ui.instrumentCutItself.checked = instrumentCutItself;
        setInstrumentAdsrEnabled(result.settings.adsrEnabled);
        if (savedInstrument) {
          instrumentBuffer = restoredBuffer;
          instrumentSnapshot = { saved: true };
          instrumentTimeCache = null;
          for (const key of ["gainPercent", "pitchSemitones", "timePercent"]) instrumentSettings[key] = savedInstrument[key];
          Object.assign(instrumentEnvelope, savedInstrument.envelope);
          setInstrumentMode(true);
          instrumentOctave = savedInstrument.octave;
          renderInstrumentMessage();
        }
        try { localStorage.setItem(DRUM_KEYS_STORAGE, JSON.stringify(drumPads.map(pad => pad.key))); } catch {}
        setSamplerCollapsed(false);
        renderSelectedPadControls();
        closeSamplerPresets();
        ui.samplerPresetToggle.focus();
        if (!savedInstrument) showDrumError(samplerCopy("stateLoaded"));
      } else if (action === "save") {
        samplerPresets.unshift(result.preset);
        ui.samplerPresetName.value = "";
        ui.samplerPresetStatus.textContent = samplerCopy("stateSaved");
      } else samplerPresets = samplerPresets.filter(item => item.id !== preset.id);
      renderSamplerPresets();
    } catch (error) {
      console.warn("[SC Downloader Sampler Presets]", error);
      ui.samplerPresetStatus.textContent = samplerCopy("stateFailed");
    } finally {
      samplerPresetBusy = false;
      if (action !== "delete") {
        drumPads.forEach(pad => { pad.busy = false; });
        padRenderPending = false;
        updateDrumLabels();
        renderLoop();
      }
      renderSamplerPresetBusy();
      positionSamplerPresets();
    }
  }

  function sliceDescriptor() {
    if (!loopState.active || waveformDrawPreview || !Number.isFinite(loopState.startMs) ||
        !Number.isFinite(loopState.endMs) || loopState.endMs <= loopState.startMs) return null;
    const { signature: _signature, ...snapshot } = buildInstrumentDescriptor();
    snapshot.trimRange = { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs };
    return { ...snapshot, signature: JSON.stringify(snapshot) };
  }

  function sliceIsCurrent(snapshot) {
    return capability("saveLoopPad") && snapshot?.signature === sliceDescriptor()?.signature;
  }

  function closeSliceConfirmation() {
    sliceConfirmation = null;
    suppressPanelEscape = true;
    setTimeout(() => { suppressPanelEscape = false; }, 0);
    if (ui?.sliceDialog.open) ui.sliceDialog.close();
  }

  function cancelSlices(message = samplerCopy("cancelled")) {
    closeSliceConfirmation();
    suppressPanelEscape = true;
    setTimeout(() => { suppressPanelEscape = false; }, 0);
    const job = sliceJob;
    // Once submitted, the atomic commit is the linearization point.
    if (!job || job.committing) return;
    sliceJob = null;
    for (const [id, pending] of padRequests) {
      if (pending.action !== "slices" || pending.operationId !== job.operationId) continue;
      padRequests.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(Object.assign(new Error("Slice preparation cancelled."), { name: "AbortError" }));
    }
    requestPad("cancel-slices", { operationId: job.operationId }).catch(() => {});
    padRenderPending = false;
    drumPads.forEach(pad => { pad.busy = false; });
    updateDrumLabels();
    showDrumError(message);
    renderLoop();
  }

  function openSliceConfirmation() {
    if (sliceJob) { cancelSlices(); return; }
    if (!capability("saveLoopPad") || padRenderPending || drumPads.some(pad => pad.busy)) return;
    const snapshot = sliceDescriptor();
    if (!snapshot) return;
    if ((snapshot.trimRange.endMs - snapshot.trimRange.startMs) / snapshot.playbackTransform.rate > 30000) {
      showDrumError(samplerCopy("tooLong"));
      return;
    }
    sliceConfirmation = snapshot;
    ui.sliceTitle.textContent = samplerCopy("title");
    ui.sliceDescription.textContent = samplerCopy("confirm");
    ui.sliceReplace.textContent = samplerCopy("replace");
    ui.sliceCancel.textContent = samplerCopy("cancel");
    ui.sliceDialog.showModal();
    ui.sliceCancel.focus();
  }

  async function sliceLoopToPads() {
    const snapshot = sliceConfirmation;
    closeSliceConfirmation();
    if (!snapshot || !sliceIsCurrent(snapshot) || padRenderPending || drumPads.some(pad => pad.busy)) return;
    if (padEditor || padEditorPending) leavePadEditor();
    cancelLoopPadSelection();
    exitInstrument();
    setSamplerCollapsed(false);
    const job = { operationId: `pad_slice_${Date.now()}_${++padRequestNumber}`, snapshot, committing: false };
    sliceJob = job;
    padRenderPending = true;
    drumPads.forEach(pad => { pad.busy = true; });
    updateDrumLabels();
    showDrumError(samplerCopy("preparing"));
    renderLoop();
    try {
      await Promise.all(drumPads.map(pad => pad.trimSave));
      const prepared = await requestPad("slices", {
        operationId: job.operationId, count: 8,
        trackIdentity: snapshot.trackIdentity, generation: snapshot.generation,
        trackUrl: snapshot.trackIdentity.replace(/^permalink:/, ""),
        trimRange: snapshot.trimRange, playbackTransform: snapshot.playbackTransform, effects: snapshot.effects,
        name: `Loop ${(snapshot.trimRange.startMs / 1000).toFixed(1)}–${(snapshot.trimRange.endMs / 1000).toFixed(1)}s`,
      });
      if (sliceJob !== job) return;
      if (!sliceIsCurrent(snapshot)) { cancelSlices(samplerCopy("changed")); return; }
      job.committing = true;
      renderLoop();
      const result = prepared.pads ? prepared : await requestPad("commit-slices", { operationId: job.operationId });
      for (const record of result.pads || []) {
        const pad = drumPads[record.index];
        if (!pad) continue;
        pad.version++;
        pad.buffer = null;
        pad.loading = null;
        pad.saved = true;
        pad.customName = record.name;
      }
      showDrumError(samplerCopy("done"));
      drumPads.forEach(pad => { pad.busy = false; });
      selectedPadIndex = 0;
      renderSelectedPadControls();
    } catch (error) {
      if (sliceJob !== job) return;
      requestPad("cancel-slices", { operationId: job.operationId }).catch(() => {});
      console.warn("[SC Downloader Slices]", error);
      showDrumError(samplerCopy("failed"));
    } finally {
      if (sliceJob === job) {
        sliceJob = null;
        padRenderPending = false;
        drumPads.forEach(pad => { pad.busy = false; });
        updateDrumLabels();
        renderLoop();
      }
    }
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
      showDrumError(pt("Pad samples can be up to 30 seconds long. Shorten the loop or increase its speed."));
      return;
    }
    selectingLoopPad = {
      trackUrl: String(loopState.trackIdentity || "").replace(/^permalink:/, ""),
      trimRange: { startMs: loopState.startMs, endMs: loopState.endMs, durationMs: loopState.durationMs },
      playbackTransform: { rate: state.effectiveRate, preservePitch: state.preservePitch },
      effects: { ...effectsController?.snapshot(), eq: { enabled: false, hardClip: false, bands: [] } },
      name: `Loop ${(loopState.startMs / 1000).toFixed(1)}–${(loopState.endMs / 1000).toFixed(1)}s`,
    };
    setSamplerCollapsed(false);
    ui.drumSection.classList.add("is-selecting");
    ui.saveLoopPad.setAttribute("aria-pressed", "true");
    showDrumError(samplerCopy("selectPad"));
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
    showDrumError(pt("Preparing loop for pad $1…", index + 1));
    try {
      const operationId = `pad_${crypto.randomUUID()}`;
      const result = await requestPad("render", { index, operationId, ...sample });
      pad.version += 1;
      pad.buffer = null;
      pad.loading = null;
      pad.saved = true;
      pad.customName = result.pad?.name || sample.name;
      showDrumError(pt("Loop saved to pad $1.", index + 1));
    } catch (error) {
      showDrumError(error?.message || pt("Could not save this loop to a pad."));
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
        () => finish({ success: false, error: pt("Download request timed out.") }),
        DOWNLOAD_REQUEST_TIMEOUT_MS
      );
      const listener = (event) => {
        if (event.detail?.id === id) finish(event.detail);
      };
      document.addEventListener(eventName, listener);
      try {
        request();
      } catch (error) {
        finish({ success: false, error: error?.message || pt("Could not start download request.") });
      }
    });
  }

  function setPlayerBypassed(bypassed) {
    playbackFailure = "";
    animateNextRateChange = true;
    controller.setBypassed(bypassed);
    requestLoop("set-global-bypass", { bypassed: bypassed || !capability("tempo") });
    readLoopState();
  }

  function seekMedia(media, timeMs) {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); media.removeEventListener("seeked", done); resolve(); };
      const timer = setTimeout(done, 5000);
      media.addEventListener("seeked", done);
      media.currentTime = timeMs / 1000;
    });
  }

  // Drops the silence before playback reached the recorder, cuts the take to
  // the loop length and undoes the player volume, which the capture includes.
  // The WAV is the 16-bit stereo layout of SCRecord.encodeWav.
  function trimCapturedWav(bytes, durationMs, gain = 1) {
    const view = new DataView(bytes);
    const rate = view.getUint32(24, true);
    const frames = Math.floor((bytes.byteLength - 44) / 4);
    const samples = new Int16Array(bytes, 44, frames * 2);
    let first = 0;
    const search = Math.min(frames, Math.round(rate * 0.3));
    while (first < search && Math.abs(samples[first * 2]) < 64 && Math.abs(samples[first * 2 + 1]) < 64) first += 1;
    if (first === search) first = 0;
    const count = Math.max(0, Math.min(frames - first, Math.round(durationMs / 1000 * rate)));
    const output = new ArrayBuffer(44 + count * 4);
    new Uint8Array(output).set(new Uint8Array(bytes, 0, 44));
    new Uint8Array(output, 44).set(new Uint8Array(bytes, 44 + first * 4, count * 4));
    if (gain !== 1) {
      const pcm = new Int16Array(output, 44, count * 2);
      for (let index = 0; index < pcm.length; index += 1) pcm[index] = Math.max(-32768, Math.min(32767, Math.round(pcm[index] * gain)));
    }
    const header = new DataView(output);
    header.setUint32(4, output.byteLength - 8, true);
    header.setUint32(40, count * 4, true);
    return output;
  }

  // YouTube offers no audio file to cut, so the loop is recorded in real time,
  // at the original speed without effects, and opened in the Stem Extractor.
  async function recordLoopStems() {
    if (stemCapture) { stemCapture.cancelled = true; return; }
    const media = platform.media();
    if (!loopState.active || !media || !globalThis.SCRecord || !effectsController) return;
    const startMs = loopState.startMs;
    const endMs = loopState.endMs;
    const lengthMs = endMs - startMs;
    if (lengthMs > 120000) {
      showDownloadStatus(pt("Stem separation supports loops up to 2 minutes. Shorten the selected loop first."));
      return;
    }
    if (media.muted || media.volume === 0) {
      showDownloadStatus(pt("Unmute the video to record the loop."));
      return;
    }
    const identity = platform.trackIdentity();
    const info = platform.trackInfo() || {};
    const wasBypassed = controller.snapshot().bypassed;
    const capture = stemCapture = { cancelled: false };
    const recorder = globalThis.SCRecord.create({ effects: effectsController, maxSeconds: Math.ceil(lengthMs / 1000) + 2 });
    ui.separateStems.dataset.pending = "true";
    ui.separateStems.setAttribute("aria-pressed", "true");
    renderLoop();
    try {
      if (!wasBypassed) setPlayerBypassed(true);
      media.pause();
      await seekMedia(media, startMs);
      await recorder.start();
      const volume = media.volume;
      await media.play();
      await new Promise((resolve, reject) => {
        let previousMs = media.currentTime * 1000;
        const timer = setInterval(() => {
          const nowMs = media.currentTime * 1000;
          let failure = null;
          if (capture.cancelled) failure = pt("Loop recording cancelled.");
          else if (platform.trackIdentity() !== identity) failure = pt("The video changed. Loop recording cancelled.");
          else if (platform.isAdPlaying()) failure = pt("An ad interrupted the recording. Try again after the ad.");
          else if (media.paused && !media.ended) failure = pt("Playback paused. Loop recording cancelled.");
          if (failure) { clearInterval(timer); reject(new Error(failure)); return; }
          showDownloadStatus(pt("Recording the loop for Stems: $1 / $2. Click Stems again to cancel.",
            formatLoopTime(Math.max(0, Math.min(lengthMs, nowMs - startMs))), formatLoopTime(lengthMs)));
          // A jump back means the player wrapped or seeked: the loop already ended.
          if (nowMs >= endMs || media.ended || nowMs < previousMs - 250) { clearInterval(timer); resolve(); }
          previousMs = nowMs;
        }, 50);
      });
      media.pause();
      await recorder.stop();
      const wav = trimCapturedWav(await recorder.exportWav().arrayBuffer(), lengthMs, volume > 0.01 ? 1 / volume : 1);
      showDownloadStatus(pt("Opening the Stem Extractor…"));
      await requestPad("record-stems", { bytes: wav, title: info.title || "YouTube", artist: info.artist || "",
        artworkUrl: info.artworkUrl || "", trackUrl: info.url || "" });
      showDownloadStatus(pt("Loop opened in Stems. Separation uses the original speed without effects."), { dismissAfter: 6000 });
    } catch (error) {
      media.pause();
      showDownloadStatus(error?.message || pt("Could not open stem separation."));
    } finally {
      await recorder.stop().catch(() => {});
      recorder.dispose();
      if (!wasBypassed && controller.snapshot().bypassed) setPlayerBypassed(false);
      stemCapture = null;
      ui.separateStems.dataset.pending = "false";
      ui.separateStems.setAttribute("aria-pressed", "false");
      renderLoop();
    }
  }

  async function separateLoopStems() {
    if (IS_YOUTUBE) { await recordLoopStems(); return; }
    if (!loopState.active || ui.separateStems.dataset.pending === "true") return;
    if (loopState.endMs - loopState.startMs > 120000) {
      showDownloadStatus(pt("Stem separation supports loops up to 2 minutes. Shorten the selected loop first."));
      return;
    }
    const snapshot = { trackUrl: String(loopState.trackIdentity || "").replace(/^permalink:/, ""),
      trimRange: { startMs: loopState.startMs, endMs: loopState.endMs } };
    ui.separateStems.dataset.pending = "true";
    renderLoop();
    try {
      await requestPad("stems", snapshot);
      if (String(loopState.trackIdentity || "").replace(/^permalink:/, "") === snapshot.trackUrl) {
        const audio = controller.getActiveAudio?.();
        if (audio && !audio.paused) audio.pause();
      }
      showDownloadStatus(pt("Loop opened in Stems. Separation uses the original speed without effects."), { dismissAfter: 6000 });
    } catch (error) { showDownloadStatus(error.message || pt("Could not open stem separation.")); }
    finally { ui.separateStems.dataset.pending = "false"; renderLoop(); }
  }

  async function downloadLoopFromPlayer() {
    if (!loopState.active || !Number.isFinite(loopState.startMs) || !Number.isFinite(loopState.endMs)) {
      showDownloadStatus(pt("Set both loop markers before downloading."));
      return;
    }
    const id = `loop-export-${Date.now()}`;
    loopDownloadPending = true;
    showDownloadStatus(pt("Preparing loop download…"));
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
    showDownloadStatus(result?.success ? pt("Loop download started.") : (result?.error || pt("Could not start loop download.")));
  }

  async function downloadCurrentTrack() {
    if (TOOLS_EDITION || trackDownloadPending) return;
    const id = `track-export-${Date.now()}`;
    trackDownloadPending = true;
    showDownloadStatus(pt("Preparing track download…"));
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
      result?.success ? pt("Track download started.") : (result?.error || pt("Could not start track download.")),
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
    const envelopeHelp = {
      attack: pt("Time for the sound to reach full volume."),
      decay: pt("Time for the sound to fall from full volume to the sustain level."),
      sustain: pt("Volume held while the key is pressed."),
      release: pt("Time for the sound to fade out after you release the key."),
    };
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

        .panel.controls-grid {
          width: min(840px, calc(100vw - 16px));
        }
        .controls-layout { display: grid; gap: 4px; position:relative; }
        .controls-column { display: contents; }
        .controls-layout .drum-section { order: 0; }
        .controls-layout .waveform-shell { order: 1; }
        .controls-layout .effects-shell { order: 2; }
        .controls-layout .peq { order: 3; }
        .controls-layout .record-section { order: 4; }
        .controls-layout > .controls-column > section { margin: 0; min-width: 0; }
        .controls-layout.is-sortable > .controls-column > section { order:var(--section-order); }
        .controls-layout.is-sortable .tool-section-toggle { touch-action:none; user-select:none; }
        .controls-layout.is-sortable .tool-section-toggle:active { cursor:grabbing; }
        .controls-layout.is-reordering, .controls-layout.is-reordering * { cursor:grabbing !important; }
        .controls-column > section.is-reordering { opacity:.45; }
        .section-drop-marker { position:absolute; z-index:10; height:2px; background:#ff7b38; box-shadow:0 0 5px #ff550080; pointer-events:none; }
        @media (min-width: 800px) {
          .controls-grid .controls-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
          .controls-grid .controls-column { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
          .controls-grid .controls-layout.is-sortable > .controls-column > section { order:0; }
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
        .current { border: 0; padding: 0; background: transparent; font: inherit; color: inherit; cursor: text; }
        .rate-input { box-sizing: border-box; width: 54px; min-width: 0; padding: 2px; border: 0; border-bottom: 1px solid #f50; border-radius: 0; background: transparent; color: inherit; font: inherit; text-align: right; outline: none; appearance: textfield; }
        .rate-input::-webkit-inner-spin-button, .rate-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .rate-input:focus-visible { outline: none; }
        .current:focus-visible { outline: 1px solid #f50; outline-offset: 2px; }
        .current[hidden], .rate-input[hidden] { display: none; }
        .bypass sc-icon{ width: 20px; height: 20px; animation: heart-float 3s ease-in-out infinite; }
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

        .current, .rate-input {
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
        .current, .rate-input { font-size: 15px; }
        .bypass { width: 26px; height: 26px; }
        .bypass sc-icon{ width: 21px; height: 21px; }
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
        .clear-loop, .download-loop, .separate-stems { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; border-radius: 5px; cursor: pointer; font-size: 10px; font-weight: 600; line-height: 1; }
        .clear-loop, .separate-stems { border: 1px solid #484848; color: #fff; background: #292929; }
        .download-loop { border: 1px solid #b84400; color: #fff; background: #ff5500; }
        .save-loop-pad, .loop-instrument, .slice-loop, .sampler-preset-toggle { display: grid; place-items: center; width: 24px; height: 26px; padding: 0; border: 1px solid #484848; border-radius: 5px; color: #d6d6d6; background: #292929; cursor: pointer; }
        .save-loop-pad:hover, .save-loop-pad[aria-pressed="true"], .loop-instrument:hover, .loop-instrument[aria-pressed="true"], .slice-loop:hover { color: #fff; border-color: #ff7b38; }
        .loop-instrument[aria-pressed="true"] { color: #ff8a4c; background: #462619; }
        .loop-instrument.is-preparing sc-icon{ animation: instrument-pulse .8s ease-in-out infinite alternate; }
        .instrument-controls { padding: 5px 7px 7px; }
        .instrument-controls[hidden],
        .drum-section.is-collapsed:not(.is-instrument) .instrument-controls,
        .drum-section.is-collapsed:not(.is-instrument) .drum-status,
        .drum-section.is-collapsed:not(.is-instrument) .drum-note-controls { display: none; }
        .instrument-controls.is-bypassed .envelope-control,
        .instrument-controls.is-bypassed .envelope-graph { opacity: .45; }
        .instrument-envelope { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) minmax(40px, 1.5fr) 18px; gap: 3px; align-items: center; }
        .instrument-toggles { display: flex; flex-direction: column; gap: 4px; }
        .envelope-graph { display: block; width: 100%; height: 46px; overflow: visible; }
        .envelope-curve { fill: none; stroke: #ff8a4c; stroke-width: 1.6; stroke-linejoin: round; }
        .envelope-fill { fill: #ff8a4c; opacity: .1; }
        .envelope-axis, .envelope-keyup { fill: none; stroke: #666; stroke-width: .6; }
        .envelope-keyup { stroke-dasharray: 2 2; }
        .envelope-control { display: grid; justify-items: center; gap: 3px; min-width: 0; color: #aaa; font-size: 8px; }
        .envelope-control output { font-size: 8px; color: #aaa; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .envelope-knob { position: relative; width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 1px solid #666; background: radial-gradient(circle at 35% 30%, #535353, #252525); cursor: ns-resize; touch-action: none; }
        .envelope-knob::after { content: ""; position: absolute; width: 3px; height: 8px; left: calc(50% - 1.5px); top: 3px; border-radius: 2px; background: #ff8a4c; transform-origin: 50% 10px; transform: rotate(var(--knob-angle)); }
        .envelope-knob:hover { border-color: #ff8a4c; }
        .envelope-knob:focus-visible { outline: 2px solid #ff8a4c; outline-offset: 3px; }
        .instrument-cut-label, .instrument-adsr-label { display: grid; place-items: center; width: 18px; height: 20px; margin: 0; padding: 0; cursor: help; }
        .instrument-cut-label[hidden], .instrument-adsr-label[hidden] { display: none; }
        .instrument-cut-itself, .instrument-adsr-toggle { width: 16px; height: 16px; accent-color: #ff7b38; margin: 0; }
        @keyframes instrument-pulse { to { opacity: .35; transform: scale(.88); } }
        .save-loop-pad sc-icon,.loop-instrument sc-icon,.slice-loop sc-icon,.sampler-preset-toggle sc-icon{ width: 13px; height: 13px;      }
        .clear-loop:disabled, .download-loop:disabled, .separate-stems:disabled, .save-loop-pad:disabled, .loop-instrument:disabled, .slice-loop:disabled { cursor: not-allowed; opacity: .45; }
        .clear-loop img,.clear-loop sc-icon,.download-loop sc-icon{ width: 12px; height: 12px; flex: 0 0 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .status { margin-top: 5px; }

        /* Expanded player editor, compact enough to stay clear of the player. */
        .panel { width: min(420px, calc(100vw - 16px)); max-height: calc(100vh - 64px); overflow-y: auto; padding: 7px; border: 1px solid #262626; border-radius: 14px; background: linear-gradient(145deg, #171717, #050505); box-shadow: 0 16px 50px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.04); scrollbar-width: thin; scrollbar-color: #4b4b4b transparent; }
        .panel-header { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; grid-template-rows: 32px; align-items: center; column-gap: 5px; row-gap: 2px; padding-bottom: 6px; }
        .drum-section { margin: 0 0 6px; overflow: hidden; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); }
        .slice-dialog { width: min(330px, calc(100vw - 48px)); box-sizing: border-box; padding: 18px; border: 1px solid #555; border-radius: 12px; color: #eee; background: #202020; font: 13px/1.5 system-ui, sans-serif; }
        .slice-dialog::backdrop { background: rgb(0 0 0 / .65); }
        .slice-dialog h3 { margin: 0 0 10px; font-size: 16px; }
        .slice-dialog p { margin: 0 0 18px; }
        .slice-dialog > div { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
        .slice-dialog button { padding: 7px 10px; border: 1px solid #777; border-radius: 6px; color: #fff; background: #333; cursor: pointer; font: inherit; }
        .slice-dialog .slice-replace { background: #a83700; border-color: #ff7b38; }
        .slice-dialog button:focus-visible { outline: 2px solid #ff7b38; outline-offset: 3px; }
        .sampler-preset-toggle:hover, .sampler-preset-toggle[aria-expanded="true"] { color:#fff; border-color:#ff7b38; }
        .sampler-preset-menu { position:fixed; inset:auto; margin:0; width:208px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto; padding:5px; border:1px solid #494949; border-radius:8px; background:#242424; color:#fff; box-shadow:0 8px 24px #0008; font:11px/1.4 system-ui,sans-serif; }
        .sampler-preset-list { max-height:168px; overflow:auto; }
        .sampler-preset-list p { margin:8px; color:#aaa; }
        .sampler-preset-row { display:flex; gap:3px; height:24px; }
        .sampler-preset-kind { flex:0 0 18px; align-self:center; text-align:center; color:#ff934d; }
        .sampler-preset-menu button { min-height:24px; padding:3px 6px; border:0; border-radius:4px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
        .sampler-preset-menu button:hover { background:#383838; }
        .sampler-preset-menu button:focus-visible, .sampler-preset-toggle:focus-visible { outline:2px solid #ff7b38; outline-offset:-2px; }
        .sampler-preset-load { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .sampler-preset-menu .sampler-preset-delete { flex:0 0 30px; text-align:center; font-size:19px; color:#aaa; }
        .sampler-preset-menu .sampler-preset-delete:hover { color:#ff856b; }
        .sampler-preset-form { display:grid; gap:4px; margin-top:5px; padding-top:7px; border-top:1px solid #414141; }
        .sampler-preset-name { width:100%; padding:6px 8px; border:1px solid #555; border-radius:4px; color:#fff; background:#191919; font:inherit; }
        .sampler-preset-menu .sampler-preset-save { color:#ff934d; }
        .sampler-preset-menu :disabled { opacity:.5; cursor:wait; }
        .sampler-preset-status { margin:4px 7px; color:#bbb; font-size:11px; }
        .sampler-preset-status:empty { display:none; }
        .sampler-body { padding: 6px 7px; }
        .drum-section.is-instrument .sampler-body { display: none; }
        ${globalThis.SCSamplerCore.PAD_STYLES}
        .pad-control { display: grid; justify-items: center; gap: 3px; min-width: 0; font-size: 8px; color: #aaa; }
        .pad-control output { font-size: 8px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .pad-knob { position: relative; width: 28px; height: 28px; padding: 0; border: 1px solid #555; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #484848, #222); cursor: ns-resize; touch-action: none; }
        .pad-knob::after { content: ""; position: absolute; width: 3px; height: 8px; left: calc(50% - 1.5px); top: 3px; border-radius: 2px; background: #ff8a4c; transform-origin: 50% 10px; transform: rotate(var(--knob-angle)); }
        .pad-knob:hover { border-color: #ff8a4c; }
        .pad-knob:focus-visible { outline: 2px solid #ff8a4c; outline-offset: 2px; }
        .drum-file { display: none; }
        .drum-status { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0; padding: 4px 7px 6px; color: #ffb199; font-size: 10px; line-height: 1.2; }
        .drum-status[hidden] { display: none; }
        .drum-message { min-width: 0; }
        .drum-note-controls { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; }
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
        .current, .rate-input { width: 6ch; flex: 0 0 auto; font-size: 13px; }
        .current.is-bypassed { color: #d6d6d6; }
        .bypass { width: 20px; height: 22px; }
        .bypass sc-icon{ width: 19px; height: 19px; }
        .slider-wrap { height: 26px; margin: 0; border: 1px solid #30373e; border-radius: 7px; background: rgba(255,255,255,.025); padding: 0; }
        .slider { height: 24px; border-radius: 6px; background-size: 100% 100%; }
        .slider::-webkit-slider-runnable-track { height: 9px; border-radius: 999px; }
        .slider::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -2.5px; box-shadow: 0 0 0 2px #fff; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; }
        .limits { inset-inline: 0; padding: 0 6px; font-size: 8px; text-shadow: 0 1px 2px #000; }
        .range-label { top: 50%; padding: 0; border-radius: 0; background: transparent; font-size: 8px; text-shadow: 0 1px 2px #000; transform: translate(-50%, -50%); }
        .waveform-shell { position: relative; overflow: hidden; height: 126px; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); touch-action: none; transition: height 160ms ease; }
        .waveform-shell.is-collapsed { height: 32px; touch-action: auto; }
        .waveform-stage { position: absolute; inset: 34px 8px 24px; cursor: crosshair; }
        .waveform-canvas { display: block; width: 100%; height: 100%; border-radius: 8px; }
        .waveform-playhead { position: absolute; z-index: 4; inset: 0 auto 0 0; width: 1px; background: rgba(255,255,255,.72); pointer-events: none; }
        .waveform-selection { position: absolute; inset: 0 auto 0; border: 0; border-inline: 1px solid #ff741f; background: transparent; cursor: grab; }
        .waveform-pad-shade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, #0e121666 0 var(--pad-start), transparent var(--pad-start) var(--pad-end), #0e121666 var(--pad-end) 100%); }
        .waveform-marker { position: absolute; z-index: 7; top: -2px; width: 18px; height: 18px; margin-left: -9px; padding: 0; border: 0; border-radius: 5px 5px 3px 3px; color: #fff; background: #ff741f; font-size: 11px; font-weight: 800; line-height: 1; text-transform: lowercase; cursor: ew-resize; box-shadow: 0 2px 7px rgba(255, 116, 31, .28); }
        .waveform-marker::after { content: ""; position: absolute; top: 18px; left: 50%; width: 1px; height: 90px; background: #ff741f; transform: translateX(-50%); }
        .waveform-times { position: absolute; inset: auto 9px 5px; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; color: #7e8790; font-size: 10px; font-variant-numeric: tabular-nums; }
        .waveform-start-label { justify-self: start; }
        .waveform-middle-label { justify-self: center; }
        .waveform-end-label { justify-self: end; }
        .player-tools-upgrade { display: none; position: absolute; z-index: 12; inset: 3px; border: 1px solid #ff6a1a; border-radius: 7px; color: #fff; background: #3d2115; font-size: 10px; font-weight: 700; line-height: 1; cursor: pointer; }
        .waveform-shell.is-locked { height: 34px; touch-action: auto; }
        .waveform-shell.is-locked .waveform-stage, .waveform-shell.is-locked .waveform-times, .waveform-shell.is-locked .waveform-actions, .waveform-shell.is-locked .waveform-toggle { display: none; }
        .waveform-shell.is-locked .player-tools-upgrade { display: block; left: auto; right: 4px; width: 172px; }

        .effects-shell { margin-top: 7px; overflow: hidden; border: 1px solid #343434; border-radius: 11px; background: rgba(255,255,255,.025); }
        .effect-bypass { width: 23px; height: 23px; padding: 0; border: 1px solid #4b5157; border-radius: 5px; color: #9ca3aa; background: #202428; font-size: 11px; font-weight: 800; line-height: 1; cursor: pointer; }
        .effect-bypass sc-icon { width: 17px; height: 17px; }
        .effect-bypass[aria-pressed="true"] { border-color: #c95819; color: #ff7b38; background: #3a251b; }
        .effect-bypass:hover:not(:disabled) { border-color: #ff7b38; color: #fff; }
        .effect-bypass:disabled { cursor: not-allowed; opacity: .45; }
        .effect-bypass:focus-visible { outline: 2px solid #ff5500; outline-offset: 1px; }

        .effects-body { padding: 0 9px 4px; }
        .effects-presets { display: flex; gap: 4px; padding: 3px 0 5px; }
        .effects-preset { flex: 1; height: 22px; padding: 0 3px; border: 1px solid #3b4249; border-radius: 5px; color: #bfc4c8; background: #202428; font-size: 9px; font-weight: 600; line-height: 1; cursor: pointer; }
        .effects-preset:hover, .effects-preset[aria-pressed="true"] { border-color: #ff6a1a; color: #fff; background: #462619; }
        .effect-knob-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; padding-bottom: 5px; }
        .effect-knob-grid > .effect-group-title { grid-column: span 2; text-align: center; }
        .effect-row { display: grid; grid-template-rows: minmax(22px, auto) 28px auto; justify-items: center; align-content: start; gap: 5px; min-width: 0; }
        .effect-label { color: #d5d8db; font-size: 9px; font-weight: 500; line-height: 1.2; max-width: 100%; overflow-wrap: anywhere; text-align: center; }
        .fx-knob { position: relative; box-sizing: border-box; width: 28px; height: 28px; border: 1px solid #555; border-radius: 50%; background: radial-gradient(ellipse at 35% 40%, rgb(255 125 45 / var(--knob-glow, 0)), transparent 95%), radial-gradient(circle at 35% 30%, #393939, #202020); box-shadow: 0 0 7px rgb(255 125 45 / var(--knob-halo, 0)); }
        .fx-knob::before { content: ""; position: absolute; inset: -1px; border-radius: 50%; background: conic-gradient(from 225deg, #ffd09a 0deg, #ff984f var(--knob-sweep, 0deg), transparent var(--knob-sweep, 0deg)); mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); pointer-events: none; }
        .fx-knob.is-pearl { background: radial-gradient(ellipse at 25% 80%, #dfc49e18, transparent 65%), radial-gradient(ellipse at 80% 30%, #b6a1de24, transparent 70%), radial-gradient(circle at 35% 30%, #393939, #202020); border-color: #8b8195; box-shadow: none; }
        .fx-knob.is-pearl::before { display: none; }
        .fx-knob:has(input[aria-expanded="true"]) { border-color: #b99a83; }
        .fx-knob::after { content: ""; position: absolute; width: 3px; height: 8px; left: calc(50% - 1.5px); top: 2px; border-radius: 2px; background: #ff8a4c; transform-origin: 50% 11px; transform: rotate(var(--knob-angle, -135deg)); pointer-events: none; }
        .fx-knob:hover { border-color: #ff8a4c; }
        .fx-knob:focus-within { outline: 2px solid #ff8a4c; outline-offset: 2px; }
        .fx-knob.is-disabled { opacity: .45; }
        .fx-knob > input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ns-resize; touch-action: none; }
        .fx-knob > input:disabled { cursor: not-allowed; }
        .effect-value { color: #bfc4c8; font-size: 10px; font-weight: 500; line-height: 1; text-align: right; font-variant-numeric: tabular-nums; }
        .effect-settings { display: none; grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 8px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,.08); }
        .effect-character-control { display: grid; justify-items: center; align-content: start; gap: 6px; min-width: 0; }
        .effect-character-control .effect-room { max-width: 100%; align-self: center; }
        .effect-settings .effect-freeze { grid-column: 1 / -1; }
        .effect-settings.is-open { display: grid; }
        .effect-setting-label { align-self: center; color: #9da3a8; font-size: 9px; font-weight: 500; line-height: 1; }
        .effect-setting-slider { width: 100%; accent-color: #ff5500; }
        .effect-setting-value { align-self: center; color: #bfc4c8; font-size: 9px; font-weight: 500; line-height: 1; text-align: right; }
        .effect-room { height: 21px; border: 1px solid #3b4249; border-radius: 4px; color: #e8e8e8; background: #202428; font-size: 9px; font-weight: 500; }
        .effects-note { margin: 4px 0; color: #858c92; font-size: 9px; line-height: 1.2; text-align: center; }
        .panel-tools { display: flex; grid-column: 3; grid-row: 1; justify-self: end; align-self: center; gap: 3px; margin-left: 0; }
        .panel-tool { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 23px; height: 20px; margin: 0; padding: 0; border: 1px solid rgba(255,255,255,.2); border-radius: 4px; color: #fff; background: rgba(255,255,255,.08); cursor: pointer; outline: none; transition: background-color 200ms, border-color 200ms; }
        .panel-tool:hover { color: #fff; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.14); }
        .panel-tool:focus-visible { border-color: rgba(255,85,0,.65); }
        .panel-tool:disabled { opacity: .48; cursor: wait; }
        .panel-tool.is-unavailable:disabled { cursor: not-allowed; }
        :host([data-platform="youtube"]) :is(.download-track-button, .download-loop, .save-loop-pad, .loop-instrument, .slice-loop) { display: none !important; }
        .panel-tool[aria-pressed="true"] { color: #ff6a1a; border-color: #ff6a1a; }
        .panel-tool sc-icon{ display: block; width: 12px; height: 12px;      }
        .panel-tool .cross-icon { display:block; width:12px; height:12px; }
        .panel-tool .panel-tool-icon { display:block; width:13px; height:13px; }
        .trigger .trigger-icon { width:20px; height:20px; }
        /* YouTube: a pill like the like/share buttons, with the theme's own colors. */
        :host([data-platform="youtube"]) .trigger-shell { width: auto; height: 36px; flex: 0 0 auto; }
        :host([data-platform="youtube"]) .trigger { display: inline-flex; align-items: center; gap: 6px; width: auto; height: 36px; margin: 0; padding: 0 14px 0 6px; border-radius: 18px; color: var(--yt-spec-text-primary, #0f0f0f); background: var(--yt-spec-additive-background, rgba(0, 0, 0, .05)); font: 500 14px/36px Roboto, Arial, sans-serif; white-space: nowrap; }
        :host([data-platform="youtube"]) .trigger:hover { color: var(--yt-spec-text-primary, #0f0f0f); background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, .1)); }
        :host([data-platform="youtube"]) .trigger::after { content: "Player Tools"; order: 1; }
        :host([data-platform="youtube"]) .trigger .trigger-icon { position: static; width: 26px; height: 26px; transform: none; }
        :host([data-platform="youtube"]) .trigger-rate { position: static; order: 2; font-size: 12px; transform: none; }
        .detach-button[aria-pressed="true"] .panel-tool-icon { filter:brightness(0) saturate(100%) invert(56%) sepia(93%) saturate(1985%) hue-rotate(336deg) brightness(104%) contrast(101%); }
        @media (max-width: 360px) {
          .panel-header { grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 3px; }
          .brand-logo { width: 28px; height: 28px; border-radius: 7px; }
          .brand-name { font-size: 11px; }
          .free-badge { height: 14px; padding: 0 3px; font-size: 7px; }
          .current, .rate-input { font-size: 11px; }
          .panel-tool { width: 20px; }
          .drum-pad { padding-inline: 4px; }
          .bypass,.bypass sc-icon{ width: 16px; height: 16px; }
        }
        .clear-loop, .download-loop, .separate-stems { height: 22px; padding: 0 6px; border-radius: 6px; opacity: .82; }
        .save-loop-pad, .loop-instrument, .slice-loop, .sampler-preset-toggle { width: 22px; height: 22px; }
        .editor-track { display: grid; place-items: center; width: 22px; height: 22px; padding: 3px; border: 1px solid #484848; border-radius: 6px; color: #ddd; background: #292929; cursor: pointer; }
        .editor-track[hidden] { display: none; }
        .editor-track sc-icon{ width: 14px; height: 14px;      }
        ${collapsible.styles}
        .drum-section, .waveform-shell, .effects-shell { transition:height 160ms ease; }
        .drum-section > .tool-section-header .tool-section-heading { padding-right:110px; }
        .waveform-shell > .tool-section-header .tool-section-heading,
        .effects-shell > .tool-section-header .tool-section-heading { padding-right:164px; }
        .effect-group-title { margin: 5px 0 2px; color: #858c92; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .effect-freeze { grid-column: 1 / -1; height: 24px; border: 1px solid #4b5157; border-radius: 5px; color: #d5d8db; background: #202428; font-size: 10px; font-weight: 700; cursor: pointer; }
        .effect-freeze:hover:not(:disabled), .effect-freeze[aria-pressed="true"] { border-color: #ff6a1a; color: #fff; background: #462619; }
        .effect-freeze:disabled { cursor: not-allowed; opacity: .45; }
        .sampler-icon { width:14px; height:14px; filter:brightness(0) invert(1); }
        .waveform-body { display:contents; }
        .controls-hidden .controls-layout,
        .controls-hidden .drum-section,
        .controls-hidden .waveform-shell,
        .controls-hidden .effects-shell,
        .controls-hidden .peq,
        .controls-hidden .record-section { display:none !important; }
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
        ><img class="trigger-icon" width="20" height="20" alt="" draggable="false" hidden /><span class="trigger-rate">1x</span></button>
        <button class="clear-rate" type="button" aria-label="Reset Player Tools" title="Reset Player Tools" hidden><sc-icon name="close" class="cross-icon" aria-hidden="true"></sc-icon></button>
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
            <div class="brand-title-line"><button class="brand-name" type="button" aria-label="Open the Looper guide">${TOOLS_EDITION || IS_YOUTUBE ? "Player Tools" : "SCTD Player Tools"}</button><span class="free-badge" aria-label="Player Tools Free plan"><sc-icon name="${IS_YOUTUBE ? "youtube" : "soundcloud"}" class="plan-badge-icon" aria-hidden="true"></sc-icon><span class="plan-badge-label">FREE</span></span></div>
          </div>
        </div>
        <div class="panel-tools" role="group" aria-label="Panel options">
          <button class="panel-tool download-track-button${TOOLS_EDITION ? " is-unavailable" : ""}" type="button" aria-label="${TOOLS_EDITION ? "Full-track downloads are not available in this version" : "Download current playing"}" title="${TOOLS_EDITION ? "Full-track downloads are not available in this version" : "Download current playing"}">
            <sc-icon name="download" aria-hidden="true"></sc-icon>
          </button>
          <button class="panel-tool tooltips-button" type="button" aria-label="Tooltips" aria-pressed="true" data-scdl-tooltip="Toggle tooltips">
            <sc-icon name="help" aria-hidden="true"></sc-icon>
          </button>
          <button class="panel-tool reset-tools-button" type="button" aria-label="Reset playback, Loop, FX and EQ. Samples are kept." title="Reset playback, Loop, FX and EQ. Samples are kept.">
            <sc-icon name="trash" class="panel-tool-icon trash-icon" hidden aria-hidden="true"></sc-icon>
          </button>
          <button class="panel-tool detach-button" type="button" aria-label="Keep panel open when clicking outside" aria-pressed="false" title="Keep panel open when clicking outside">
            <sc-icon name="detach" class="panel-tool-icon detach-icon" hidden aria-hidden="true"></sc-icon>
          </button>
          <button class="panel-tool visibility-button" type="button" aria-controls="scdl-sampler scdl-loop-region scdl-audio-effects scdl-parametric-eq scdl-record" aria-label="Collapse all controls" title="Collapse all controls"><sc-icon name="minimize" class="visibility-symbol visibility-up-icon" hidden aria-hidden="true"></sc-icon><sc-icon name="down" class="visibility-symbol visibility-down-icon" aria-hidden="true"></sc-icon><sc-icon name="sampler" class="visibility-symbol visibility-grid-icon" hidden aria-hidden="true"></sc-icon><sc-icon name="expand" class="panel-tool-icon visibility-expand-icon" hidden aria-hidden="true"></sc-icon></button>
          <button class="panel-tool close-button" type="button" aria-label="Close panel" title="Close panel">
            <sc-icon name="close" class="cross-icon" aria-hidden="true"></sc-icon>
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
            ${customRates.map((rate, index) => `<button class="preset custom-preset" type="button" data-custom-index="${index}" data-saved="true" aria-pressed="false" title="${pt("Saved speed $1. Hold to replace", formatRate(rate))}">${formatRate(rate)}</button>`).join("")}
          </div>
          <label class="pitch-label" data-scdl-tooltip="Keep tone: change playback speed without changing the pitch."><input class="pitch-toggle" type="checkbox" aria-label="Keep tone" /></label>
        <div class="speed-status">
          <button class="current" type="button" aria-label="Edit playback speed" title="Click to edit playback speed">1x</button>
          <input class="rate-input" type="number" min="0.1" max="3" step="${DEFAULTS.step}" aria-label="Playback speed multiplier" hidden />
          <button class="bypass" type="button" aria-label="Bypass loop and playback effects" aria-pressed="false" title="Bypass loop and playback effects">${BYPASS_ICON}</button>
        </div>
        </div>
        <section class="drum-section is-collapsed" id="scdl-sampler" aria-label="Sampler">
          ${collapsible.header({ title: pt("Sampler"), bodyId: "scdl-sampler-pads", expanded: false, toggleClass: "sampler-toggle", actionsClass: "sampler-actions", icon: '<sc-icon name="sampler" class="tool-section-icon sampler-icon" aria-hidden="true"></sc-icon>', actions: '<button class="save-loop-pad" type="button" aria-label="Save loop to a pad" aria-pressed="false" title="Save loop to a pad"><sc-icon name="sampler" aria-hidden="true"></sc-icon></button><button class="loop-instrument" type="button" aria-label="Play selected loop in piano mode" aria-pressed="false" title="Play selected loop in piano mode"><sc-icon name="piano" aria-hidden="true"></sc-icon></button><button class="slice-loop" type="button" aria-label="Slice selected loop into 8 pads"><sc-icon name="slice" aria-hidden="true"></sc-icon></button><button class="sampler-preset-toggle" type="button" aria-expanded="false" aria-haspopup="dialog" aria-controls="scdl-sampler-presets"><sc-icon name="save" aria-hidden="true"></sc-icon></button>' })}
          <dialog class="slice-dialog" aria-labelledby="slice-title" aria-describedby="slice-description"><h3 id="slice-title"></h3><p id="slice-description"></p><div><button class="slice-cancel" type="button" autofocus></button><button class="slice-replace" type="button"></button></div></dialog>
          <div class="sampler-preset-menu" id="scdl-sampler-presets" popover="manual" role="dialog" aria-label="Saved sampler states">
            <div class="sampler-preset-list"></div>
            <form class="sampler-preset-form"><input class="sampler-preset-name" type="text" maxlength="80" required autocomplete="off" /><button class="sampler-preset-save" type="submit"></button></form>
            <p class="sampler-preset-status" role="status" aria-live="polite"></p>
          </div>
          <div class="sampler-body" id="scdl-sampler-pads">
            <div class="drum-pads">
              ${drumPads.map((pad, index) => `<div class="drum-slot"><button class="drum-pad" type="button" data-drum-index="${index}"><span class="drum-key">${pad.key.toUpperCase()}</span></button><input class="drum-file" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a" tabindex="-1" aria-label="${pt("Load sample for $1", pt(pad.name))}" /></div>`).join("")}
            </div>
          </div>
          <p class="drum-status" role="status" aria-live="polite" hidden><span class="drum-message"></span><span class="drum-note-controls" aria-live="off"><span class="playing-note"></span></span></p>
          <div class="instrument-controls" role="group" aria-label="Sample envelope" hidden>
            <div class="instrument-envelope">
              ${[["gainPercent", pt("GAIN"), 0, 154], ["pitchSemitones", pt("PITCH"), -12, 12], ["timePercent", pt("TIME"), 25, 400]].map(([name, label, min, max]) => `<div class="pad-control"><span>${label}</span><button class="pad-knob" type="button" role="slider" data-pad-control="${name}" aria-label="${pt("Selected pad")} ${label.toLowerCase()}" aria-valuemin="${min}" aria-valuemax="${max}" aria-orientation="vertical"></button><output></output></div>`).join("")}
              ${["attack", "decay", "sustain", "release"].map((name) => `<div class="envelope-control"><span>${name[0].toUpperCase()}</span><button class="envelope-knob" type="button" role="slider" data-envelope="${name}" aria-label="${pt(name[0].toUpperCase() + name.slice(1))}" aria-valuemin="0" aria-valuemax="${name === "sustain" ? 100 : 5000}" aria-orientation="vertical" data-scdl-tooltip="${pt(name[0].toUpperCase() + name.slice(1))}: ${envelopeHelp[name]}"></button><output></output></div>`).join("")}
              <svg class="envelope-graph" viewBox="0 0 110 52" role="img" aria-label="ADSR envelope" data-scdl-tooltip="ADSR: how the volume changes over time. The dashed line marks when you release the key."><path class="envelope-axis" d="M5 5 V43 H105"/><path class="envelope-fill"/><line class="envelope-keyup" y1="5" y2="45"/><path class="envelope-curve"/></svg>
              <div class="instrument-toggles"><label class="instrument-cut-label" title="Cut itself" data-scdl-tooltip="Cut itself" hidden><input class="instrument-cut-itself" type="checkbox" aria-label="Cut itself" checked /></label><label class="instrument-adsr-label" title="ADSR" data-scdl-tooltip="ADSR" hidden><input class="instrument-adsr-toggle" type="checkbox" aria-label="ADSR" /></label></div>
            </div>
          </div>
        </section>
        <section class="waveform-shell" id="scdl-loop-region" role="group" aria-label="Loop Region">
          ${collapsible.header({ title: pt("Loop Region"), bodyId: "scdl-loop-region-body", toggleClass: "waveform-toggle", headerClass: "waveform-header", actionsClass: "waveform-actions", icon: '<sc-icon name="loop" class="tool-section-icon" aria-hidden="true"></sc-icon>', actions: '<button class="editor-track" type="button" hidden><sc-icon name="refresh" aria-hidden="true"></sc-icon></button><button class="clear-loop" type="button" aria-label="Clear loop"><sc-icon name="close" class="cross-icon" aria-hidden="true"></sc-icon><span>Clear</span></button><button class="download-loop" type="button" aria-label="Download loop"><sc-icon name="download" aria-hidden="true"></sc-icon><span>WAV</span></button>' })}
          <div class="waveform-body" id="scdl-loop-region-body">
          <div class="waveform-stage">
            <canvas class="waveform-canvas" aria-hidden="true"></canvas>
            <div class="waveform-pad-shade" aria-hidden="true" hidden></div>
            <div class="waveform-playhead" aria-hidden="true" hidden></div>
            <div class="waveform-selection" hidden></div>
            <button class="waveform-marker waveform-start" type="button" role="slider" aria-label="Loop start A">A</button>
            <button class="waveform-marker waveform-end" type="button" role="slider" aria-label="Loop end B">B</button>
          </div>
          <div class="waveform-times"><span class="waveform-start-label">00:00.000</span><span class="waveform-middle-label">00:00.000</span><span class="waveform-end-label">00:00.000</span></div>
          <button class="player-tools-upgrade" type="button">Get Player Tools Pro</button>
          </div>
        </section>
        <section class="effects-shell is-collapsed" id="scdl-audio-effects" aria-label="FX">
          ${collapsible.header({ title: "FX", bodyId: "scdl-audio-effects-body", expanded: false, toggleClass: "effects-toggle", headerClass: "effects-header", actionsClass: "effect-bypasses", icon: '<sc-icon name="fx" class="tool-section-icon effects-icon" aria-hidden="true"></sc-icon>', actions: '<button class="effect-bypass" type="button" data-effect-bypass="reverb" aria-label="Enable reverb" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button><button class="effect-bypass" type="button" data-effect-bypass="delay" aria-label="Enable echo" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button><button class="effect-bypass" type="button" data-effect-bypass="flanger" aria-label="Enable flanger" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button><button class="effect-bypass" type="button" data-effect-bypass="phaser" aria-label="Enable phaser" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button><button class="effect-bypass" type="button" data-effect-bypass="bitcrusher" aria-label="Enable bitcrusher" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button><button class="effect-bypass" type="button" data-effect-bypass="saturation" aria-label="Enable saturation" aria-pressed="false"><sc-icon name="bypass" aria-hidden="true"></sc-icon></button>' })}
          <div class="effects-body" id="scdl-audio-effects-body">
            <div class="effects-presets" role="group" aria-label="FX presets"><button class="effects-preset" data-fx-preset="subtle" type="button">Subtle</button><button class="effects-preset" data-fx-preset="studio" type="button">Studio</button><button class="effects-preset" data-fx-preset="wide" type="button">Wide</button><button class="effects-preset" data-fx-preset="dub" type="button">Dub</button></div>
            <div class="effect-knob-grid">
            <p class="effect-group-title">Space</p>
            <p class="effect-group-title">Motion</p>
            <p class="effect-group-title">Color</p>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-reverb">Reverb</label><input class="effect-slider" id="scdl-effect-reverb" type="range" min="0" max="100" step="1" value="0" aria-label="Reverb mix" title="Reverb mix; 0% turns it off" /><output class="effect-value" data-effect-value="reverb">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-delay">Echo</label><input class="effect-slider" id="scdl-effect-delay" type="range" min="0" max="100" step="1" value="0" aria-label="Echo mix" title="Echo mix; 0% turns it off" /><output class="effect-value" data-effect-value="delay">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-flanger">Flanger</label><input class="effect-slider" id="scdl-effect-flanger" type="range" min="0" max="100" step="1" value="0" aria-label="Flanger mix" /><output class="effect-value" data-effect-value="flanger">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-phaser">Phaser</label><input class="effect-slider" id="scdl-effect-phaser" type="range" min="0" max="100" step="1" value="0" aria-label="Phaser mix" /><output class="effect-value" data-effect-value="phaser">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-saturation">Saturation</label><input class="effect-slider" id="scdl-effect-saturation" type="range" min="0" max="100" step="1" value="0" aria-label="Saturation mix" /><output class="effect-value" data-effect-value="saturation">0%</output></div>
            <div class="effect-row"><label class="effect-label" for="scdl-effect-bitcrusher">Bitcrusher</label><input class="effect-slider" id="scdl-effect-bitcrusher" type="range" min="0" max="100" step="1" value="0" aria-label="Bitcrusher mix" /><output class="effect-value" data-effect-value="bitcrusher">0%</output></div>
            </div>
            <div class="effect-settings" data-effect-settings-panel="reverb"><label class="effect-setting-label" for="scdl-effect-reverb-room">Room</label><select class="effect-room" id="scdl-effect-reverb-room" data-effect-character="reverbRoom"><option value="room">Room</option><option value="hall">Hall</option><option value="plate">Plate</option></select><span></span><label class="effect-setting-label" for="scdl-effect-reverb-size">Size</label><input class="effect-setting-slider" id="scdl-effect-reverb-size" type="range" min="0" max="100" value="55" data-effect-character="reverbSize" /><output class="effect-setting-value" data-effect-character-value="reverbSize">55%</output><label class="effect-setting-label" for="scdl-effect-reverb-decay">Decay</label><input class="effect-setting-slider" id="scdl-effect-reverb-decay" type="range" min="0.2" max="12" step="0.1" value="2.4" data-effect-character="reverbDecay" /><output class="effect-setting-value" data-effect-character-value="reverbDecay">2.4s</output><label class="effect-setting-label" for="scdl-effect-reverb-predelay">Pre-delay</label><input class="effect-setting-slider" id="scdl-effect-reverb-predelay" type="range" min="0" max="200" value="20" data-effect-character="reverbPreDelay" /><output class="effect-setting-value" data-effect-character-value="reverbPreDelay">20ms</output><label class="effect-setting-label" for="scdl-effect-reverb-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-reverb-tone" type="range" min="0" max="100" value="70" data-effect-character="reverbTone" /><output class="effect-setting-value" data-effect-character-value="reverbTone">70%</output></div>
            <div class="effect-settings" data-effect-settings-panel="delay"><label class="effect-setting-label" for="scdl-effect-delay-time">Time</label><input class="effect-setting-slider" id="scdl-effect-delay-time" type="range" min="60" max="800" value="250" data-effect-character="delayTime" /><output class="effect-setting-value" data-effect-character-value="delayTime">250ms</output><label class="effect-setting-label" for="scdl-effect-delay-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-delay-feedback" type="range" min="0" max="100" value="25" data-effect-character="delayFeedback" /><output class="effect-setting-value" data-effect-character-value="delayFeedback">25%</output><label class="effect-setting-label" for="scdl-effect-delay-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-delay-tone" type="range" min="0" max="100" value="70" data-effect-character="delayTone" /><output class="effect-setting-value" data-effect-character-value="delayTone">70%</output><button class="effect-freeze" type="button" data-effect-freeze aria-label="Hold to freeze echo" aria-pressed="false">Hold to Freeze</button></div>
            <div class="effect-settings" data-effect-settings-panel="flanger"><label class="effect-setting-label" for="scdl-effect-flanger-rate">Rate</label><input class="effect-setting-slider" id="scdl-effect-flanger-rate" type="range" min="0.05" max="5" step="0.05" data-effect-character="flangerRate" /><output class="effect-setting-value" data-effect-character-value="flangerRate"></output><label class="effect-setting-label" for="scdl-effect-flanger-depth">Depth</label><input class="effect-setting-slider" id="scdl-effect-flanger-depth" type="range" min="0" max="100" data-effect-character="flangerDepth" /><output class="effect-setting-value" data-effect-character-value="flangerDepth"></output><label class="effect-setting-label" for="scdl-effect-flanger-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-flanger-feedback" type="range" min="0" max="100" data-effect-character="flangerFeedback" /><output class="effect-setting-value" data-effect-character-value="flangerFeedback"></output></div>
            <div class="effect-settings" data-effect-settings-panel="phaser"><label class="effect-setting-label" for="scdl-effect-phaser-rate">Rate</label><input class="effect-setting-slider" id="scdl-effect-phaser-rate" type="range" min="0.05" max="5" step="0.05" data-effect-character="phaserRate" /><output class="effect-setting-value" data-effect-character-value="phaserRate"></output><label class="effect-setting-label" for="scdl-effect-phaser-depth">Depth</label><input class="effect-setting-slider" id="scdl-effect-phaser-depth" type="range" min="0" max="100" data-effect-character="phaserDepth" /><output class="effect-setting-value" data-effect-character-value="phaserDepth"></output><label class="effect-setting-label" for="scdl-effect-phaser-feedback">Feedback</label><input class="effect-setting-slider" id="scdl-effect-phaser-feedback" type="range" min="0" max="100" data-effect-character="phaserFeedback" /><output class="effect-setting-value" data-effect-character-value="phaserFeedback"></output></div>
            <div class="effect-settings" data-effect-settings-panel="saturation"><label class="effect-setting-label" for="scdl-effect-saturation-drive">Drive</label><input class="effect-setting-slider" id="scdl-effect-saturation-drive" type="range" min="0" max="100" data-effect-character="saturationDrive" /><output class="effect-setting-value" data-effect-character-value="saturationDrive"></output><label class="effect-setting-label" for="scdl-effect-saturation-tone">Tone</label><input class="effect-setting-slider" id="scdl-effect-saturation-tone" type="range" min="0" max="100" data-effect-character="saturationTone" /><output class="effect-setting-value" data-effect-character-value="saturationTone"></output></div>
            <div class="effect-settings" data-effect-settings-panel="bitcrusher"><label class="effect-setting-label" for="scdl-effect-bit-depth">Bits</label><input class="effect-setting-slider" id="scdl-effect-bit-depth" type="range" min="2" max="16" step="1" data-effect-character="bitDepth" /><output class="effect-setting-value" data-effect-character-value="bitDepth"></output><label class="effect-setting-label" for="scdl-effect-sample-rate-reduction">Downsample</label><input class="effect-setting-slider" id="scdl-effect-sample-rate-reduction" type="range" min="0" max="100" data-effect-character="sampleRateReduction" /><output class="effect-setting-value" data-effect-character-value="sampleRateReduction"></output></div>
            <p class="effects-note">Drag to adjust · Hold for options</p>
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
    const width = ui.panel.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width));
    ui.panel.style.left = `${left}px`;
    if (!IS_YOUTUBE) {
      ui.panel.style.bottom = `${Math.max(8, innerHeight - anchor.top + 8)}px`;
      return;
    }
    // The YouTube trigger sits mid-page: open on the side with more room and
    // scroll inside the panel instead of leaving the viewport.
    ui.panel.style.maxHeight = "";
    const height = ui.panel.offsetHeight;
    const roomAbove = anchor.top - 16;
    const roomBelow = innerHeight - anchor.bottom - 16;
    const below = height > roomAbove && roomBelow > roomAbove;
    ui.panel.style.maxHeight = `${Math.max(160, below ? roomBelow : roomAbove)}px`;
    ui.panel.style.top = below ? `${anchor.bottom + 8}px` : "";
    ui.panel.style.bottom = below ? "" : `${Math.max(8, innerHeight - anchor.top + 8)}px`;
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
    recordUi?.setVisible(open && !controlsHidden);
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
    clearTimeout(padCacheTimer);
    hydrateDrumPads();
    document.dispatchEvent(new CustomEvent(PLAYER_TOOLS_OPENED_EVENT));
    if (!waveformCollapsed) loadPlayerWaveform();
  }

  document.addEventListener(OPEN_PLAYER_TOOLS_PANEL_EVENT, () => {
    mount();
    if (ui) openPanel("click");
  });

  function closePanel() {
    if (padEditor || padEditorPending) leavePadEditor();
    closeSamplerPresets();
    cancelSlices();
    clearHoverTimers();
    panelOpenMode = null;
    hoveredDrum = null;
    cancelLoopPadSelection();
    exitInstrument({ message: "" });
    setPanelOpen(false);
    schedulePadCacheRelease();
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
        node.matches(IS_YOUTUBE ? "#movie_player" : PLAYER_TIMELINE_SELECTOR)
    );
  }

  function createUi() {
    const host = document.createElement("span");
    host.id = HOST_ID;
    if (platform) host.dataset.platform = platform.id;
    host.lang = globalThis.SCPlayerToolsText?.locale() || "en";
    host.style.cssText = [
      "display:flex",
      "align-items:center",
      "flex:0 0 auto",
      "height:100%",
      "margin-left:8px",
    ].join(";");

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = trustedHtml(template());
    globalThis.SCPlayerToolsText?.localize(root);
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
      samplerPresetToggle: root.querySelector(".sampler-preset-toggle"),
      samplerPresetMenu: root.querySelector(".sampler-preset-menu"),
      samplerPresetList: root.querySelector(".sampler-preset-list"),
      samplerPresetName: root.querySelector(".sampler-preset-name"),
      samplerPresetSave: root.querySelector(".sampler-preset-save"),
      samplerPresetStatus: root.querySelector(".sampler-preset-status"),
      samplerIcon: root.querySelector(".sampler-icon"),
      drumMessage: root.querySelector(".drum-message"),
      drumStatus: root.querySelector(".drum-status"),
      playingNote: root.querySelector(".playing-note"),
      slider: root.querySelector(".slider"),
      pitchToggle: root.querySelector(".pitch-toggle"),
      current: root.querySelector(".current"),
      rateInput: root.querySelector(".rate-input"),
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
      tooltipsButton: root.querySelector(".tooltips-button"),
      trashIcon: root.querySelector(".trash-icon"),
      visibilityButton: root.querySelector(".visibility-button"),
      visibilityUpIcon: root.querySelector(".visibility-up-icon"),
      visibilityDownIcon: root.querySelector(".visibility-down-icon"),
      visibilityExpandIcon: root.querySelector(".visibility-expand-icon"),
      visibilityGridIcon: root.querySelector(".visibility-grid-icon"),
      controlsHiddenMessage: root.querySelector(".controls-hidden-message"),
      waveformShell: root.querySelector(".waveform-shell"),
      waveformToggle: root.querySelector(".waveform-toggle"),
      waveformBody: root.querySelector(".waveform-body"),
      waveformActions: root.querySelector(".waveform-actions"),
      waveformStage: root.querySelector(".waveform-stage"),
      editorTrack: root.querySelector(".editor-track"),
      waveformCanvas: root.querySelector(".waveform-canvas"),
      waveformPadShade: root.querySelector(".waveform-pad-shade"),
      waveformPlayhead: root.querySelector(".waveform-playhead"),
      waveformSelection: root.querySelector(".waveform-selection"),
      waveformStart: root.querySelector(".waveform-start"),
      waveformEnd: root.querySelector(".waveform-end"),
      waveformStartLabel: root.querySelector(".waveform-start-label"),
      waveformMiddleLabel: root.querySelector(".waveform-middle-label"),
      waveformEndLabel: root.querySelector(".waveform-end-label"),
      clearLoop: root.querySelector(".clear-loop"),
      downloadLoop: root.querySelector(".download-loop"),
      sliceButton: root.querySelector(".slice-loop"),
      sliceDialog: root.querySelector(".slice-dialog"),
      sliceTitle: root.querySelector("#slice-title"),
      sliceDescription: root.querySelector("#slice-description"),
      sliceReplace: root.querySelector(".slice-replace"),
      sliceCancel: root.querySelector(".slice-cancel"),
      saveLoopPad: root.querySelector(".save-loop-pad"),
      instrumentToggle: root.querySelector(".loop-instrument"),
      instrumentControls: root.querySelector(".instrument-controls"),
      instrumentCutLabel: root.querySelector(".instrument-cut-label"),
      instrumentCutItself: root.querySelector(".instrument-cut-itself"),
      instrumentAdsrLabel: root.querySelector(".instrument-adsr-label"),
      instrumentAdsrToggle: root.querySelector(".instrument-adsr-toggle"),
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

    renderSamplerPresetCopy();
    ui.samplerPresetToggle.addEventListener("click", openSamplerPresets);
    root.querySelector(".sampler-preset-form").addEventListener("submit", event => {
      event.preventDefault();
      runSamplerPreset("save");
    });
    document.addEventListener("pointerdown", event => {
      if (ui.samplerPresetMenu.matches(":popover-open") && !event.composedPath().includes(ui.samplerPresetMenu) &&
          !event.composedPath().includes(ui.samplerPresetToggle)) closeSamplerPresets();
    }, true);
    sectionControllers.sampler = collapsible.mount({
      section: ui.drumSection,
      toggle: ui.samplerToggle,
      body: root.querySelector(".sampler-body"),
      collapsed: samplerCollapsed,
      onChange(value) { samplerCollapsed = value; if (!value) hydrateDrumPads(); renderControlsVisibility(); if (!ui.panel.hidden) positionPanel(); },
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
      let holdTimer = null;
      let suppressClick = false;
      let pointerPlaying = false;
      const pointerKey = `pad-pointer:${index}`;
      const releasePointer = () => {
        if (!pointerPlaying) return;
        pointerPlaying = false;
        releaseInstrumentKey({ code: pointerKey, preventDefault() {}, stopImmediatePropagation() {} });
      };
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
        clearHold();
      });
      button.addEventListener("pointerdown", (event) => {
        if (selectingLoopPad || drumPads[index].busy) return;
        if (event.button !== 0) return;
        clearHold();
        suppressClick = false;
        if (instrumentAdsrEnabled) {
          pointerPlaying = true;
          suppressClick = true;
          button.setPointerCapture(event.pointerId);
          playDrum(index, pointerKey, false);
        }
        holdTimer = setTimeout(() => {
          holdTimer = null;
          suppressClick = true;
          releasePointer();
          resetDrumPad(index);
        }, DRUM_LONG_PRESS_MS);
      });
      for (const eventName of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) {
        button.addEventListener(eventName, () => { releasePointer(); clearHold(); });
      }
      button.addEventListener("contextmenu", (event) => { event.preventDefault(); if (!selectingLoopPad) editPad(index); });
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
    syncTooltips();
    ui.tooltipsButton.addEventListener("click", () => {
      tooltipsEnabled = !tooltipsEnabled;
      syncTooltips();
      writeSetting(TOOLTIPS_STORAGE, tooltipsEnabled);
    });
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
    bindEffectKnobs(root);
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
    ui.effectFreeze.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || ui.effectFreeze.disabled) return;
      event.preventDefault();
      ui.effectFreeze.setPointerCapture?.(event.pointerId);
      startEchoFreeze();
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      ui.effectFreeze.addEventListener(eventName, releaseEchoFreeze);
    }
    ui.effectFreeze.addEventListener("keydown", (event) => {
      if (![' ', 'Enter'].includes(event.key) || event.repeat || ui.effectFreeze.disabled) return;
      event.preventDefault();
      startEchoFreeze();
    });
    ui.effectFreeze.addEventListener("keyup", (event) => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      releaseEchoFreeze();
    });
    const exitForPageLifecycle = () => {
      cancelSlices();
      releaseEchoFreeze();
      exitInstrument({ message: "" });
    };
    window.addEventListener("blur", exitForPageLifecycle);
    window.addEventListener("pagehide", () => {
      cancelSlices();
      releaseEchoFreeze({ resumePlayback: false });
      exitInstrument({ message: "" });
    });
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
    ui.current.addEventListener("click", () => {
      ui.rateInput.value = String(rateIntent?.rate ?? controller.snapshot().rate);
      ui.current.hidden = true;
      ui.rateInput.hidden = false;
      ui.rateInput.focus();
      ui.rateInput.select();
    });
    const finishRateEdit = (commit, restoreFocus = false) => {
      if (ui.rateInput.hidden) return;
      const value = ui.rateInput.valueAsNumber;
      ui.rateInput.hidden = true;
      ui.current.hidden = false;
      if (commit && Number.isFinite(value)) applyPlayerRate(clampRate(value));
      if (restoreFocus) ui.current.focus();
    };
    ui.rateInput.addEventListener("blur", () => finishRateEdit(true));
    ui.rateInput.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finishRateEdit(event.key === "Enter", true);
    });
    ui.slider.addEventListener("dblclick", () => {
      applyPlayerRate(DEFAULTS.rate, { animate: true });
    });
    ui.pitchToggle.addEventListener("change", () => {
      applyPlayerPitch(ui.pitchToggle.checked);
    });
    ui.bypass.addEventListener("click", () => setPlayerBypassed(!controller.snapshot().bypassed));
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
    ui.editorTrack.addEventListener("click", leavePadEditor);
    ui.waveformStage.addEventListener("dblclick", () => { if (padEditor) padEditorZoom = null; else waveformZoom = null; renderLoop(); });
    ui.waveformCanvas.addEventListener("click", (event) => {
      if (padEditorPending) return;
      if (suppressWaveformClick) {
        suppressWaveformClick = false;
        event.preventDefault();
        return;
      }
      const timeMs = waveformTime(event.clientX);
      if (padEditor) { playDrum(padEditor.index); return; }
      if (timeMs !== null) requestLoop("seek", { timeMs });
    });
    ui.clearLoop.addEventListener("click", clearLoop);
    ui.separateStems = document.createElement("button");
    ui.separateStems.type = "button";
    ui.separateStems.className = "separate-stems";
    ui.separateStems.innerHTML = trustedHtml('<sc-icon name="layers" aria-hidden="true"></sc-icon><span>Stems</span>');
    ui.separateStems.title = IS_YOUTUBE
      ? pt("Record the selected loop in real time and separate it into vocals, drums, bass and other (up to 2 minutes)")
      : pt("Separate the selected loop into vocals, drums, bass and other (up to 2 minutes)");
    ui.separateStems.setAttribute("aria-label", ui.separateStems.title);
    ui.downloadLoop.before(ui.separateStems);
    ui.separateStems.addEventListener("click", separateLoopStems);
    ui.downloadLoop.addEventListener("click", downloadLoopFromPlayer);
    ui.sliceButton.addEventListener("click", openSliceConfirmation);
    ui.sliceReplace.addEventListener("click", sliceLoopToPads);
    ui.sliceCancel.addEventListener("click", closeSliceConfirmation);
    ui.sliceDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeSliceConfirmation();
    });
    ui.sliceDialog.addEventListener("close", () => { sliceConfirmation = null; ui.sliceButton.focus(); });
    ui.saveLoopPad.addEventListener("click", selectLoopPad);
    ui.instrumentToggle.addEventListener("click", toggleLoopInstrument);
    bindInstrumentControls();
    bindPadControls(root);
    renderSelectedPadControls();
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
    if (globalThis.SCRecordUI && effectsController) {
      recordUi = globalThis.SCRecordUI.mount({ container: ui.panel, effects: effectsController,
        onCollapsedChange() { renderControlsVisibility(); if (!ui.panel.hidden) positionPanel(); },
      });
    }
    const controlsLayout = document.createElement("div");
    controlsLayout.className = "controls-layout";
    ui.panel.querySelector(".drum-section").before(controlsLayout);
    for (const selectors of [[".drum-section", ".effects-shell", ".record-section"], [".waveform-shell", ".peq"]]) {
      const column = document.createElement("div");
      column.className = "controls-column";
      for (const selector of selectors) {
        const section = ui.panel.querySelector(selector);
        if (section) column.append(section);
      }
      controlsLayout.append(column);
    }
    collapsible.reorder({ layout: controlsLayout, storageKey: "scdl.player-tools.section-order.v1",
      onChange() { if (!ui.panel.hidden) positionPanel(); },
    });
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
    ui.planBadgeLabel.textContent = isPro ? "PRO" : pt("FREE");
    ui.planBadge.classList.toggle("is-pro", isPro);
    ui.planBadge.setAttribute("aria-label", isPro ? pt("Player Tools Pro active") : pt("Player Tools Free plan"));
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
    // Keep YouTube's speed menu showing the Player Tools speed.
    if (IS_YOUTUBE && state.rate !== youtubeRatePushed && platform.setPlayerRate(state.rate)) youtubeRatePushed = state.rate;
    const text = formatRate(state.effectiveRate);
    const triggerText = formatTriggerRate(state.effectiveRate);
    const animateRate = animateNextRateChange;
    animateNextRateChange = false;
    ui.trigger.setAttribute("aria-label", pt("Playback speed $1", triggerText));
    // Keep the thumb under the pointer while access is checked asynchronously.
    ui.slider.value = String(playbackAllowed && rateIntent ? rateIntent.rate : state.rate);
    ui.current.disabled = !playbackAllowed;
    ui.rateInput.disabled = !playbackAllowed;
    ui.slider.setAttribute("aria-valuetext", formatRate(state.rate));
    ui.bypass.setAttribute("aria-pressed", String(state.bypassed));
    ui.current.classList.toggle("is-bypassed", state.bypassed);
    ui.triggerRate.classList.toggle("is-bypassed", state.bypassed);
    ui.bypass.title = state.bypassed
      ? pt("Bypass on — restore all Player Tools")
      : pt("Bypass all Player Tools");
    ui.bypass.setAttribute("aria-label", ui.bypass.title);
    ui.detachButton.setAttribute("aria-pressed", String(panelDetached));
    ui.detachButton.setAttribute(
      "aria-label",
      panelDetached
        ? pt("Close panel when clicking outside")
        : pt("Keep panel open when clicking outside")
    );
    ui.detachButton.title = ui.detachButton.getAttribute("aria-label");
    ui.downloadTrackButton.disabled = TOOLS_EDITION || trackDownloadPending;
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
        ? pt("Saved speed $1. Hold to replace", formatRate(value))
        : pt("Hold to save the current speed");
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
    ui.status.textContent = pt(message);
    ui.status.hidden = !message;
    renderLoop();
    renderEffects();
    equalizerUi?.sync();
    renderControlsVisibility();
  }

  function formatEffectValue(name, value) {
    return ["delayTime", "reverbPreDelay"].includes(name) ? `${value}ms`
      : name === "reverbDecay" ? `${value.toFixed(1)}s`
        : ["flangerRate", "phaserRate"].includes(name) ? `${value.toFixed(2)}Hz`
          : name === "bitDepth" ? `${value}bit` : `${value}%`;
  }

  function syncEffectKnob(control) {
    const shell = control.closest(".fx-knob");
    if (!shell) return;
    const fraction = (control.valueAsNumber - Number(control.min)) / (Number(control.max) - Number(control.min));
    shell.style.setProperty("--knob-angle", `${-135 + fraction * 270}deg`);
    shell.style.setProperty("--knob-sweep", `${fraction * 270}deg`);
    shell.style.setProperty("--knob-glow", String(fraction > 0 ? 0.16 + fraction * 0.5 : 0));
    shell.style.setProperty("--knob-halo", String(fraction * 0.24));
    shell.classList.toggle("is-pearl", control.dataset.effectCharacter === "bitDepth");
    shell.classList.toggle("is-disabled", control.disabled);
    const text = formatEffectValue(control.dataset.effectCharacter, control.valueAsNumber);
    control.setAttribute("aria-valuetext", text);
    const output = shell.nextElementSibling;
    if (output?.tagName === "OUTPUT") output.textContent = text;
  }

  function bindEffectKnobs(root) {
    // Preserve native ranges, labels and change handlers for keyboard access,
    // authorization, presets and persistence; only replace pointer interaction.
    for (const panel of root.querySelectorAll(".effect-settings")) {
      for (const label of [...panel.querySelectorAll("label")]) {
        const control = label.nextElementSibling;
        const output = control.nextElementSibling;
        const group = document.createElement("div");
        group.className = "effect-character-control";
        label.before(group);
        group.append(label, control, output);
      }
    }
    for (const control of root.querySelectorAll(".effect-slider, .effect-setting-slider")) {
      const shell = document.createElement("div");
      shell.className = "fx-knob";
      control.before(shell);
      shell.append(control);
      control.setAttribute("aria-orientation", "vertical");
      const name = control.classList.contains("effect-slider") ? control.id.replace("scdl-effect-", "") : null;
      const label = root.querySelector(`label[for="${control.id}"]`)?.textContent || control.getAttribute("aria-label");
      control.removeAttribute("title");
      control.setAttribute("data-scdl-tooltip", pt("$1: drag vertically · Shift for fine adjustment", label) + (name ? pt(" · Hold to open options (Enter / Space)") : ""));
      if (name) {
        control.dataset.effectSettings = name;
        const panel = root.querySelector(`[data-effect-settings-panel="${name}"]`);
        panel.id = `scdl-fx-options-${name}`;
        control.setAttribute("aria-controls", panel.id);
      }
      const toggleOptions = () => {
        expandedEffectSettings = expandedEffectSettings === name ? null : name;
        renderEffects();
        if (!ui.panel.hidden) positionPanel();
      };
      let holdTimer = null;
      const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
      let drag = null;
      control.addEventListener("keydown", event => {
        if (!name || control.disabled || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        if (!event.repeat) toggleOptions();
      });
      control.addEventListener("contextmenu", event => event.preventDefault());
      control.addEventListener("blur", () => { cancelHold(); drag = null; });
      control.addEventListener("pointerdown", event => {
        if (event.button !== 0 || control.disabled) return;
        event.preventDefault();
        control.focus();
        control.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, value: control.valueAsNumber, moved: false };
        cancelHold();
        if (name) holdTimer = setTimeout(() => {
          if (!drag || control.disabled || !control.isConnected) return;
          drag = null;
          toggleOptions();
        }, 500);
      });
      control.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId || control.disabled) return;
        if (!drag.moved) {
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
          drag.moved = true;
          cancelHold();
        }
        const min = Number(control.min);
        const max = Number(control.max);
        const step = Number(control.step) || 1;
        const value = drag.value + (drag.y - event.clientY) * (max - min) / (event.shiftKey ? 1400 : 140);
        control.value = String(Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step)));
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const finish = event => {
        cancelHold();
        if (!drag || drag.id !== event.pointerId) return;
        const previous = drag.value;
        drag = null;
        if (!control.disabled && control.valueAsNumber !== previous) control.dispatchEvent(new Event("change", { bubbles: true }));
        else syncEffectKnob(control);
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) control.addEventListener(type, finish);
      control.addEventListener("input", () => syncEffectKnob(control));
      syncEffectKnob(control);
    }
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
      const effectName = pt(({ reverb: "Reverb", delay: "Echo", flanger: "Flanger", phaser: "Phaser", saturation: "Saturation", bitcrusher: "Bitcrusher" })[name]);
      bypass.title = pt(enabled ? "Disable $1 ($2% wet)" : "Enable $1 ($2% wet)", effectName, enabled ? state[name] : effectWetMemory[name] || DEFAULT_EFFECT_TOGGLE_WET);
      bypass.setAttribute("aria-label", bypass.title);
      syncRange(slider);
      syncEffectKnob(slider);
    }
    for (const [name, control] of Object.entries(ui.effectCharacters)) {
      control.value = String(state[name]);
      control.disabled = !state.available || !effectAllowed(name) || accessActionPending;
      const output = ui.effectCharacterValues[name];
      if (output) output.textContent = formatEffectValue(name, Number(state[name]));
      if (control.type === "range") syncEffectKnob(control);
    }
    ui.root.querySelectorAll(".effects-preset").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.fxPreset === state.preset));
      button.disabled = !state.available || !capability("premiumEffects") || accessActionPending;
    });
    ui.root.querySelectorAll(".effect-slider[data-effect-settings]").forEach((button) => {
      const expanded = button.dataset.effectSettings === expandedEffectSettings;
      button.setAttribute("aria-expanded", String(expanded));
    });
    ui.root.querySelectorAll(".effect-settings").forEach((panel) => {
      panel.classList.toggle("is-open", panel.dataset.effectSettingsPanel === expandedEffectSettings);
    });
    const frozen = effectsController.isDelayFrozen?.() === true;
    ui.effectFreeze.disabled = !state.available || !capability("freeEffects") || accessActionPending || state.delay === 0;
    ui.effectFreeze.setAttribute("aria-pressed", String(frozen));
    ui.effectFreeze.textContent = frozen ? pt("Frozen — release") : pt("Hold to Freeze");
    ui.effectsShell.classList.toggle("is-collapsed", effectsCollapsed);
    ui.effectsToggle.setAttribute("aria-expanded", String(!effectsCollapsed));
  }

  function mount() {
    if (platform) {
      const host = ui?.host || (platform.videoId() ? createUi() : null);
      if (!host || !platform.mount(host)) {
        ui?.host.remove();
        closePanel();
      }
      return;
    }
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
  document.querySelectorAll(MEDIA_SELECTOR).forEach((audio) => {
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
        if (node instanceof HTMLAudioElement || platform?.isMedia(node)) {
          controller.discover(node);
          effectsController?.discover(node);
        } else {
          node.querySelectorAll(MEDIA_SELECTOR).forEach((audio) => {
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
      if (event.composedPath()[0] === ui?.rateInput) return;
      if (ui?.sliceDialog.open) return;
      if (event.key === "Escape" && ui?.samplerPresetMenu.matches(":popover-open")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSamplerPresets();
        ui.samplerPresetToggle.focus();
        return;
      }
      if (event.key === "Escape" && suppressPanelEscape) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === "Escape" && sliceJob) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelSlices();
        ui?.sliceButton.focus();
        return;
      }
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
  // The YouTube trigger scrolls with the page; the fixed panel follows it.
  if (IS_YOUTUBE) window.addEventListener("scroll", () => positionPanel(), { passive: true });
  window.addEventListener("resize", () => {
    positionPanel();
    positionSamplerPresets();
    renderLoop();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === TOOLTIPS_STORAGE || event.key === null) {
      tooltipsEnabled = readTooltipsEnabled();
      syncTooltips();
    }
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
