/* ISOLATED-world bridge for Player Tools on YouTube: exposes the extension
 * assets to the MAIN-world panel, forwards the pad storage requests, and sends
 * recorded loops to the Stem Extractor. Anything that needs the audio file
 * (downloads, rendered pads, slices) is SoundCloud-only. */
(() => {
  "use strict";
  if (globalThis.__seibYouTubeContent || window.top !== window) return;
  globalThis.__seibYouTubeContent = true;

  const t = globalThis.SCDLI18n?.t || ((key) => key);
  const UPLOAD_CHUNK = 256 * 1024;
  const MAX_RECORDING_BYTES = 44 + 192000 * 4 * 120;
  const OPEN_LOOPER_GUIDE_EVENT = "scdl:open-looper-guide";
  // Pad storage only; the background still rejects stream renders from YouTube.
  const PAD_TYPES = {
    list: "GET_LOOP_PAD_LIST",
    "preset-list": "SAMPLER_PRESET_LIST",
    "preset-save": "SAMPLER_PRESET_SAVE",
    "preset-load": "SAMPLER_PRESET_LOAD",
    "preset-delete": "SAMPLER_PRESET_DELETE",
    "preset-render": "SAMPLER_PRESET_RENDER",
    delete: "DELETE_LOOP_PAD_AUDIO",
    get: "GET_LOOP_PAD_AUDIO",
    trim: "TRIM_LOOP_PAD_AUDIO",
    store: "STORE_LOOP_PAD_AUDIO",
  };

  function exposeAssets() {
    const root = document.documentElement;
    const copy = (keys) => JSON.stringify(Object.fromEntries(keys.map(([name, key]) => [name, t(key)])));
    root.setAttribute("data-scdl-ui-language", chrome.i18n?.getUILanguage?.() || navigator.language || "en");
    root.setAttribute("data-scdl-sampler-copy", copy([
      "slice", "title", "confirm", "replace", "cancel", "preparing", "stop", "done", "cancelled", "changed", "failed",
      "tooLong", "locked", "selectPad", "presets", "saveState", "stateName", "noStates", "deleteState", "stateSaved",
      "stateLoaded", "stateFailed", "statesLoading", "stateBusy",
    ].map((name) => [name, `sampler_${name}`])));
    root.setAttribute("data-scdl-piano-copy", copy([["status", "piano_mode_status"], ["help", "piano_mode_help"]]));
    root.setAttribute("data-scdl-extension-logo-url", chrome.runtime.getURL("assets/LooperPlayerToolkit.png"));
    root.setAttribute("data-scdl-extension-toolkit-url", chrome.runtime.getURL("assets/icons/player-toolkit.png"));
    root.setAttribute("data-scdl-extension-drum-samples-url", chrome.runtime.getURL("assets/drums/"));
    root.setAttribute("data-scdl-extension-bitcrusher-worklet-url", chrome.runtime.getURL("scripts/bitcrusher-processor.js"));
    root.setAttribute("data-scdl-extension-record-worklet-url", chrome.runtime.getURL("scripts/record-processor.js"));
    document.dispatchEvent(new CustomEvent("scdl:extension-assets-ready"));
  }

  function base64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function text(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  // Same port protocol as the Likes Explorer recorder (scripts/stem-recording-jobs.js).
  function uploadRecording(data) {
    const bytes = data.bytes instanceof ArrayBuffer ? new Uint8Array(data.bytes) : null;
    if (!bytes || bytes.length < 48 || bytes.length > MAX_RECORDING_BYTES) {
      return Promise.resolve({ success: false, error: "Invalid recording." });
    }
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: "stem-recording-upload" });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { port.disconnect(); } catch {}
        resolve(result);
      };
      port.onMessage.addListener((message) => finish(message?.success
        ? { success: true }
        : { success: false, error: message?.error || "Could not send the recording to the Stem Extractor." }));
      port.onDisconnect.addListener(() => finish({ success: false, error: chrome.runtime.lastError?.message || "Upload interrupted." }));
      const artworkUrl = text(data.artworkUrl, 2048);
      port.postMessage({ type: "begin", size: bytes.length, title: text(data.title, 300) || "YouTube",
        artist: text(data.artist, 300), artworkUrl: /^https:\/\//.test(artworkUrl) ? artworkUrl : "", trackUrl: text(data.trackUrl, 2048) });
      for (let index = 0; index < bytes.length; index += UPLOAD_CHUNK) {
        port.postMessage({ type: "chunk", data: base64(bytes.subarray(index, index + UPLOAD_CHUNK)) });
      }
      port.postMessage({ type: "end" });
    });
  }

  function forwardPad(data) {
    const type = PAD_TYPES[data.action];
    if (!type) return Promise.resolve({ success: false, error: "This action is not available on YouTube." });
    const payload = { type };
    if (data.action.startsWith("preset-")) {
      payload.presetId = data.presetId;
      payload.name = data.name;
      payload.settings = data.settings;
    }
    if (data.action !== "list") payload.index = data.index;
    if (data.action === "delete") payload.operationId = data.operationId;
    if (data.action === "get") {
      payload.timePercent = data.timePercent;
      payload.original = data.original === true;
      payload.metadataOnly = data.metadataOnly === true;
      payload.expectedUpdatedAt = data.expectedUpdatedAt;
    }
    if (data.action === "trim") {
      payload.trim = data.trim;
      payload.expectedUpdatedAt = data.expectedUpdatedAt;
      payload.expectedTrimRevision = data.expectedTrimRevision;
    }
    if (data.action === "store") {
      payload.operationId = data.operationId;
      payload.name = data.name;
      payload.mimeType = data.mimeType;
      payload.base64 = data.base64;
    }
    return chrome.runtime.sendMessage(payload);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "scdl-pad-main") return;
    const { id, action } = event.data;
    if (typeof id !== "string" || id.length > 100 || typeof action !== "string") return;
    const work = action === "record-stems" ? uploadRecording(event.data) : forwardPad(event.data);
    Promise.resolve(work)
      .catch((error) => ({ success: false, error: error?.message || "Could not reach the extension." }))
      .then((result) => window.postMessage({ source: "scdl-pad-content", id, result }, location.origin));
  });

  // The panel's brand name opens the informative popup, as on SoundCloud.
  document.addEventListener(OPEN_LOOPER_GUIDE_EVENT, () => {
    chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: "looper" })
      .then(() => chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_POPUP" }))
      .catch(() => chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: null }).catch(() => {}));
  });

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type !== "OPEN_PLAYER_TOOLS_PANEL") return false;
    document.dispatchEvent(new CustomEvent("scdl:open-player-tools-panel"));
    sendResponse({ success: true });
    return false;
  });

  exposeAssets();
})();
