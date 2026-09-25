let lastUrl = location.href;
const t = globalThis.SCDLI18n?.t || ((key) => key);
let observerRegistered = false;
let urlCheckInterval = null;
let urlChangeTimeout = null;
let lastBulkProgressAt = 0;
const EXTENSION_LOGO_ATTRIBUTE = "data-scdl-extension-logo-url";
const EXTENSION_PLAYER_ICON_ATTRIBUTE = "data-scdl-extension-player-icon-url";
const EXTENSION_EQ_ICON_ATTRIBUTE = "data-scdl-extension-eq-url";
const EXTENSION_CROSS_ICON_ATTRIBUTE = "data-scdl-extension-cross-url";
const EXTENSION_DRUM_SAMPLES_ATTRIBUTE = "data-scdl-extension-drum-samples-url";
const EXTENSION_MEGAPHONE_ATTRIBUTE = "data-scdl-extension-megaphone-url";
const EXTENSION_SOCIAL_BADGE_ATTRIBUTE = "data-scdl-extension-social-badge-url";
const EXTENSION_DETACH_ICON_ATTRIBUTE = "data-scdl-extension-detach-icon-url";
const EXTENSION_TRASH_ICON_ATTRIBUTE = "data-scdl-extension-trash-icon-url";
const EXTENSION_EXPAND_ICON_ATTRIBUTE = "data-scdl-extension-expand-icon-url";
const EXTENSION_BITCRUSHER_WORKLET_ATTRIBUTE = "data-scdl-extension-bitcrusher-worklet-url";
const EXTENSION_ASSETS_EVENT = "scdl:extension-assets-ready";
const OPEN_LOOPER_GUIDE_EVENT = "scdl:open-looper-guide";
const LOOP_EXPORT_EVENT = "scdl:download-loop";
const LOOP_EXPORT_RESULT_EVENT = "scdl:download-loop-result";
const LOOP_EXPORT_ATTRIBUTE = "data-scdl-loop-export-request";
const POPUP_START_VIEW_KEY = "scdl.popup.startView";
const OPEN_PLAYER_TOOLS_PANEL_EVENT = "scdl:open-player-tools-panel";
const OPEN_PLAYER_TOOLS_PRO_EVENT = "scdl:open-player-tools-pro";

if (window.top === window) {
  const checkoutReturn = new URL(location.href).searchParams.get("sctd_pro") === "complete";
  if (checkoutReturn) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("sctd_pro");
    history.replaceState(history.state, "", cleanUrl.toString());
    chrome.runtime.sendMessage({ type: "CLAIM_PLAYER_TOOLS_CHECKOUT" })
      .then((result) => {
        if (result?.success && result.commerce?.status === "active") {
          document.dispatchEvent(new CustomEvent(OPEN_PLAYER_TOOLS_PANEL_EVENT));
        }
      })
      .catch(() => {});
  }
}

function exposeTempoControlAssets() {
  document.documentElement?.setAttribute?.("data-scdl-piano-copy", JSON.stringify({
    status: t("piano_mode_status"),
    help: t("piano_mode_help"),
  }));
  document.documentElement?.setAttribute?.(
    EXTENSION_LOGO_ATTRIBUTE,
    chrome.runtime.getURL("assets/LooperPlayerToolkit.png")
  );
  document.documentElement?.setAttribute?.(
    EXTENSION_PLAYER_ICON_ATTRIBUTE,
    chrome.runtime.getURL("assets/icons/player-toolkit.png")
  );
  document.documentElement?.setAttribute?.(
    EXTENSION_EQ_ICON_ATTRIBUTE,
    chrome.runtime.getURL("assets/icons/eq.svg")
  );
  document.documentElement?.setAttribute?.(
    EXTENSION_CROSS_ICON_ATTRIBUTE,
    chrome.runtime.getURL("assets/icons/cross.svg")
  );
  document.documentElement?.setAttribute?.(
    EXTENSION_DRUM_SAMPLES_ATTRIBUTE,
    chrome.runtime.getURL("assets/drums/")
  );
  document.documentElement?.setAttribute?.(EXTENSION_MEGAPHONE_ATTRIBUTE, chrome.runtime.getURL("assets/icons/megaphone.svg"));
  document.documentElement?.setAttribute?.(EXTENSION_SOCIAL_BADGE_ATTRIBUTE, chrome.runtime.getURL("assets/icons/sound-cloud-social-badge.svg"));
  document.documentElement?.setAttribute?.(EXTENSION_DETACH_ICON_ATTRIBUTE, chrome.runtime.getURL("assets/icons/detach.svg"));
  document.documentElement?.setAttribute?.(EXTENSION_TRASH_ICON_ATTRIBUTE, chrome.runtime.getURL("assets/icons/trash.svg"));
  document.documentElement?.setAttribute?.(EXTENSION_EXPAND_ICON_ATTRIBUTE, chrome.runtime.getURL("assets/icons/expand.svg"));
  document.documentElement?.setAttribute?.(EXTENSION_BITCRUSHER_WORKLET_ATTRIBUTE, chrome.runtime.getURL("scripts/bitcrusher-processor.js"));
  if (typeof document.dispatchEvent === "function" && typeof CustomEvent === "function") {
    document.dispatchEvent(new CustomEvent(EXTENSION_ASSETS_EVENT));
  }
}

function onDocumentEvent(type, listener) {
  if (typeof document?.addEventListener === "function") document.addEventListener(type, listener);
}

onDocumentEvent(OPEN_LOOPER_GUIDE_EVENT, () => {
  chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: "looper" })
    .then(() => chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_POPUP" }))
    .then((result) => {
      if (!result?.success) {
        throw new Error(result?.error || "The extension popup could not open.");
      }
    })
    .catch(async (error) => {
      await chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: null }).catch(() => {});
      console.warn("[SC Downloader] Could not open the Looper guide.", error);
    });
});

onDocumentEvent(OPEN_PLAYER_TOOLS_PRO_EVENT, () => {
  chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: "pro" })
    .then(() => chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_POPUP" }))
    .catch(async (error) => {
      await chrome.runtime.sendMessage({ type: "SET_POPUP_START_VIEW", view: null }).catch(() => {});
      console.warn("[SC Downloader] Could not open Player Tools Pro.", error);
    });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'GET_LIKES_CONTEXT') {
    Promise.all([intake.resolveClientId(), intake.getCollection() ? Promise.resolve(intake.getCollection()) : intake.extractCurrent()])
      .then(([clientId, collection]) => sendResponse({ success: true, clientId, sourceUserId: collection?.sourceUserId || null, sourceName: collection?.artist || null, sourceUrl: collection?.sourceUrl || collection?.pageUrl || null }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  if (request.type !== "OPEN_PLAYER_TOOLS_PANEL") return false;
  document.dispatchEvent(new CustomEvent(OPEN_PLAYER_TOOLS_PANEL_EVENT));
  sendResponse({ success: true });
  return false;
});

onDocumentEvent(LOOP_EXPORT_EVENT, () => {
  let request;
  try {
    request = JSON.parse(document.documentElement.getAttribute(LOOP_EXPORT_ATTRIBUTE) || "null");
  } catch {
    request = null;
  }
  if (!request?.id || !request.trimRange || !Number.isFinite(request.trimRange.startMs) || !Number.isFinite(request.trimRange.endMs)) return;
  const trackUrl = String(request.trackIdentity || "").replace(/^permalink:/, "") || null;
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_LOOP",
    operationId: `track_${crypto.randomUUID().replaceAll("-", "")}`,
    trackUrl,
    trimRange: request.trimRange,
    playbackTransform: request.playbackTransform || null,
    effects: request.effects || null,
  }).then((result) => {
    document.dispatchEvent(new CustomEvent(LOOP_EXPORT_RESULT_EVENT, { detail: { id: request.id, ...result } }));
  }).catch((error) => {
    document.dispatchEvent(new CustomEvent(LOOP_EXPORT_RESULT_EVENT, { detail: { id: request.id, success: false, error: error?.message || "Could not start loop download." } }));
  });
});

window.addEventListener?.("message", (event) => {
  if (event.source !== window || event.data?.source !== "scdl-pad-main") return;
  const { id, action, index } = event.data;
  if (typeof id !== "string" || id.length > 100) return;
  const types = {
    list: "GET_LOOP_PAD_LIST",
    get: "GET_LOOP_PAD_AUDIO",
    store: "STORE_LOOP_PAD_AUDIO",
    render: "RENDER_LOOP_PAD",
    instrument: "RENDER_LOOP_INSTRUMENT",
    "cancel-instrument": "CANCEL_LOOP_INSTRUMENT",
  };
  if (!types[action]) return;
  const payload = { type: types[action] };
  if (action !== "list") payload.index = index;
  if (action === "store") {
    payload.operationId = event.data.operationId;
    payload.name = event.data.name;
    payload.mimeType = event.data.mimeType;
    payload.base64 = event.data.base64;
  }
  if (action === "render" || action === "instrument") {
    payload.operationId = event.data.operationId;
    payload.trackUrl = event.data.trackUrl;
    payload.trimRange = event.data.trimRange;
    payload.playbackTransform = event.data.playbackTransform;
    payload.effects = event.data.effects;
    payload.name = event.data.name;
  }
  if (action === "cancel-instrument") payload.operationId = event.data.operationId;
  chrome.runtime.sendMessage(payload).then((result) => {
    window.postMessage({ source: "scdl-pad-content", id, result }, location.origin);
  }).catch((error) => {
    window.postMessage({ source: "scdl-pad-content", id, result: { success: false, error: error?.message || "Could not reach the extension." } }, location.origin);
  });
});

exposeTempoControlAssets();

const intake = SCPageIntake.create({
  window,
  document,
  fetch: (...args) => fetch(...args),
  runtime: chrome.runtime,
  streamSelector: SCStreamSelector,
  downloadTrack: SCDownloadTrack,
  onData(type, data) {
    chrome.runtime.sendMessage({ type, data }).catch(() => {});
  },
  onInline(trackData) {
    ensureInlineDownloadButton(trackData);
  },
  onRemoveInline() {
    removeInlineDownloadButton();
  },
});

function isSoundCloudLikesPage() {
  return intake.classify() === "likes";
}

function isPersonalLikesPage() {
  return new URL(window.location.href).pathname.toLowerCase() === "/you/likes";
}

function isSoundCloudPlaylistPage() {
  return intake.classify() === "playlist";
}

function isSoundCloudUserTracksPage() {
  return intake.classify() === "user_tracks";
}

function isSoundCloudTrackPage() {
  return intake.classify() === "track";
}

function isSoundCloudCollectionPage() {
  return ["likes", "playlist", "user_tracks"].includes(intake.classify());
}

function reportBulkFetchProgress(loaded, total) {
  const now = Date.now();
  if (now - lastBulkProgressAt < 150) return;
  lastBulkProgressAt = now;
  chrome.runtime
    .sendMessage({
      type: "BULK_FETCH_PROGRESS",
      loaded,
      total: Number.isFinite(total) ? total : loaded,
    })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SOUNDCLOUD_AUTH_CHANGED") {
    intake.reset();
    if (intake.classify() !== "other") scheduleCurrentPageExtraction(250);
    sendResponse({ success: true });
    return false;
  }
  if (request.type === "GET_TRACK_DATA") {
    sendResponse(intake.read(request.forceRefresh === true));
    return true;
  }

  if (request.type === "RESOLVE_LOOP_TRACK_DATA") {
    const pendingTrack = request.trackUrl
      ? intake.resolvePlayerTrack(request.trackUrl)
      : Promise.resolve(intake.getTrack() || intake.extractCurrent());
    pendingTrack
      .then((trackData) => {
        if (!SCDownloadTrack.canDownload(trackData)) {
          throw new Error(t("selected_loop_no_source"));
        }
        sendResponse({ success: true, trackData });
      })
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || t("resolve_selected_loop_failed"),
        })
      );
    return true;
  }

  if (request.type === "GET_BULK_TRACKS") {
    intake
      .resolveBulk(request.limit ?? null)
      .then((tracks) => sendResponse({ success: true, tracks }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "GET_BULK_PAGE") {
    intake
      .bulkPage(request.cursor ?? null, request.pageSize, request.sourceUrl)
      .then((page) => sendResponse({ success: true, page }))
      .catch((error) => sendResponse({
        success: false,
        error: error?.message || "Could not load the collection page.",
        code: error?.code || "network_error",
        retryAt: error?.retryAt || null,
      }));
    return true;
  }

  if (request.type === "GET_BULK_SELECTION_LIST") {
    intake
      .selectionList({
        onProgress: reportBulkFetchProgress,
        progressTotal: request.total ?? intake.getCollection()?.totalCount ?? null,
      })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "GET_BULK_SELECTION_PAGE") {
    intake.selectionPage(request.cursor ?? null, request.pageSize || 200)
      .then((page) => sendResponse({ success: true, page }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.type === "GET_BULK_TRACKS_BY_IDS") {
    intake
      .tracksByIds(request.ids || [], {
        onProgress: reportBulkFetchProgress,
        progressTotal: intake.getCollection()?.totalCount ?? null,
      })
      .then((tracks) => {
        if (!tracks.length) {
          sendResponse({
            success: false,
            error: t("no_matching_tracks"),
          });
          return;
        }
        sendResponse({ success: true, tracks });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "APPLY_FORMAT_PREFERENCE") {
    const data = intake.applyFormat(request.formatPreference);
    sendResponse({ success: true, data });
    return true;
  }

  return false;
});

function scheduleCurrentPageExtraction(delay) {
  if (urlChangeTimeout) clearTimeout(urlChangeTimeout);
  urlChangeTimeout = setTimeout(() => {
    urlChangeTimeout = null;
    if (intake.classify() !== "other") intake.extractCurrent();
  }, delay);
}

function handleUrlChange() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  intake.reset();
  scheduleCurrentPageExtraction(2000);
}

const observer = new MutationObserver(handleUrlChange);

function initScript() {
  if (!observerRegistered) {
    observer.observe(document, { subtree: true, childList: true });
    observerRegistered = true;
  }
  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(handleUrlChange, 750);
  }
  if (intake.classify() !== "other") scheduleCurrentPageExtraction(1254);
}

window.SCDL = {
  getTrackData: () => intake.getTrack(),
  getPlaylistData: () => intake.getCollection(),
  resolvePlayerTrackData: (url) => intake.resolvePlayerTrack(url),
  isTrackPage: isSoundCloudTrackPage,
  isCollectionPage: isSoundCloudCollectionPage,
  isProfileTracksPage: isSoundCloudUserTracksPage,
  resolveBulkTracks: (limit) => intake.resolveBulk(limit),
};

initScript();
