const INLINE_BUTTON_ID = "scdl-inline-download";
const INLINE_STYLES_ID = "scdl-inline-styles";
const SUCCESS_RESET_MS = 2000;
const BULK_WARN_THRESHOLD = 200;
const PLAYER_DOWNLOAD_TIMEOUT_MS = 120000;
const PLAYER_WAVEFORM_ATTRIBUTE = "data-scdl-player-waveform";
const PLAYER_WAVEFORM_EVENT = "scdl:player-waveform-ready";
const TRACK_EXPORT_EVENT = "scdl:download-current-track";
const TRACK_EXPORT_RESULT_EVENT = "scdl:download-current-track-result";
const TRACK_EXPORT_ATTRIBUTE = "data-scdl-track-export-request";
const translate = globalThis.SCDLI18n?.t || ((key) => key);
const inlineDownloadIntent = SCDownloadIntent.create(chrome.runtime);

let inlineTrackData = null;
let isInlineDownloading = false;
let isPlayerDownloading = false;
let playerTrackUrl = null;
let successResetTimeout = null;
let playerVisualRequestId = 0;

function publishPlayerVisual(trackUrl) {
  const requestId = playerVisualRequestId += 1;
  const root = document.documentElement;
  if (!root?.setAttribute) return;
  if (!trackUrl) {
    root.removeAttribute?.(PLAYER_WAVEFORM_ATTRIBUTE);
    if (typeof document.dispatchEvent === "function" && typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(PLAYER_WAVEFORM_EVENT));
    return;
  }
  Promise.resolve(window.SCDL?.resolvePlayerTrackData?.(trackUrl))
    .then((trackData) => {
      if (requestId !== playerVisualRequestId || playerTrackUrl !== trackUrl) return;
      root.setAttribute(PLAYER_WAVEFORM_ATTRIBUTE, JSON.stringify({
        trackUrl,
        waveformUrl: trackData?.waveformUrl || null,
      }));
      if (typeof document.dispatchEvent === "function" && typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(PLAYER_WAVEFORM_EVENT));
    })
    .catch(() => {
      if (requestId !== playerVisualRequestId) return;
      root.setAttribute(PLAYER_WAVEFORM_ATTRIBUTE, JSON.stringify({ trackUrl, waveformUrl: null }));
      if (typeof document.dispatchEvent === "function" && typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(PLAYER_WAVEFORM_EVENT));
    });
}

function readPlayerPlaybackTransform() {
  const host = document.getElementById("scdl-tempo-control");
  const rate = Number(host?.getAttribute("data-scdl-tempo-rate"));
  const preservePitch = host?.getAttribute("data-scdl-tempo-preserve-pitch") === "true";
  if (!Number.isFinite(rate)) return null;
  return { rate, preservePitch };
}

function injectInlineStyles() {
  if (document.getElementById(INLINE_STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = INLINE_STYLES_ID;
  style.textContent = `
    #${INLINE_BUTTON_ID} {
      font-family: "SCDL UI", sans-serif;
    }

    #${INLINE_BUTTON_ID}.sc-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      vertical-align: middle;
    }

    #${INLINE_BUTTON_ID}.sc-button-icon {
      width: 32px;
      min-width: 32px;
      padding: 0;
    }

    #${INLINE_BUTTON_ID}::before {
      content: none;
      display: none;
    }

    #${INLINE_BUTTON_ID} .scdl-inline-icon {
      flex: none;
      margin: 0;
      padding: 0;
      border: 0;
      position: static;
      transform: none;
    }

    #${INLINE_BUTTON_ID} .scdl-inline-icon {
      width: 20px;
      height: 20px;
      display: block;
      border-radius: 4px;
      object-fit: contain;
    }

    #${INLINE_BUTTON_ID}.scdl-profile-download {
      display: inline-flex;
      align-items: center;
      color: #fff !important;
      background: #f50 !important;
      border-color: #f50 !important;
    }

    #${INLINE_BUTTON_ID}.scdl-profile-download .scdl-inline-icon {
      width: 16px;
      height: 16px;
    }

    #${INLINE_BUTTON_ID}.is-loading {
      opacity: 0.65;
      cursor: wait;
      pointer-events: none;
    }

    #${INLINE_BUTTON_ID}.is-loading .scdl-inline-icon {
      visibility: hidden;
    }

    #${INLINE_BUTTON_ID}.is-loading::after {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      padding: 0;
      box-sizing: border-box;
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 85, 0, 0.25);
      border-top-color: #ff5500;
      border-radius: 50%;
      animation: scdl-inline-spin 0.8s linear infinite;
    }

    #${INLINE_BUTTON_ID}.is-success .scdl-inline-icon {
      opacity: 0.45;
    }

    .scdl-filtered {
      filter: invert(1);
    }

    #${INLINE_BUTTON_ID}.is-error .scdl-inline-icon {
      opacity: 0.45;
    }

    @keyframes scdl-inline-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
  document.head.appendChild(style);
}

function findActionButtonGroup() {
  if (window.SCDL?.isProfileTracksPage?.()) {
    const profileSelectors = [
      ".userInfoBar__buttons .sc-button-group",
      ".userInfoBar__buttons",
      ".profileHeaderInfo__buttons .sc-button-group",
      ".profileHeaderInfo__buttons",
      ".userMain__headerButtons .sc-button-group",
      ".userMain__headerButtons",
      ".soundHeader__actions .sc-button-group",
      ".header__actions .sc-button-group",
    ];

    for (const selector of profileSelectors) {
      const group = document.querySelector(selector);
      if (group) {
        return group;
      }
    }

    return null;
  }

  return (
    document.querySelector(
      ".listenEngagement__actions .sc-button-group"
    ) ||
    document.querySelector(".soundActions .sc-button-group") ||
    document.querySelector(".sound__soundActions .sc-button-group")
  );
}

function isInlineButtonPage() {
  return (
    window.SCDL?.isTrackPage?.() ||
    window.SCDL?.isCollectionPage?.()
  );
}

function isCollectionInlinePage() {
  return window.SCDL?.isCollectionPage?.() === true;
}

function isProfileTracksInlinePage() {
  return window.SCDL?.isProfileTracksPage?.() === true;
}

function setInlineButtonState(state) {
  const button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    return;
  }

  button.classList.remove("is-loading", "is-success", "is-error");

  const collectionPage = isCollectionInlinePage();
  const profileTracksPage = isProfileTracksInlinePage();
  const profileLabel = button.querySelector(".scdl-profile-download-label");

  if (state === "loading") {
    button.classList.add("is-loading");
    button.title = profileTracksPage
      ? translate("inline_loading_selector")
      : collectionPage
        ? translate("inline_preparing")
        : translate("inline_downloading");
    button.setAttribute(
      "aria-label",
      button.title
    );
    if (profileLabel) {
      profileLabel.textContent = translate("inline_opening_selector");
    }
    return;
  }

  if (state === "success") {
    button.classList.add("is-success");
    button.title = profileTracksPage
      ? translate("inline_selector_opened")
      : collectionPage
        ? translate("inline_download_started")
        : translate("inline_downloaded");
    button.setAttribute(
      "aria-label",
      button.title
    );
    if (profileLabel) {
      profileLabel.textContent = translate("inline_selector_opened");
    }
    return;
  }

  if (state === "error") {
    button.classList.add("is-error");
    button.title = translate("error_retry");
    button.setAttribute("aria-label", translate("error_retry"));
    return;
  }

  button.title = profileTracksPage
    ? translate("inline_select_user_tracks")
    : collectionPage
      ? translate("inline_download_playlist")
      : translate("download");
  button.setAttribute(
    "aria-label",
    button.title
  );
  if (profileLabel) {
    profileLabel.textContent = translate("inline_download_tracks");
  }
}

function setInlineButtonNotice(message) {
  const button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    return;
  }

  button.classList.remove("is-loading", "is-success", "is-error");
  button.title = message;
  button.setAttribute("aria-label", message);
}

function isJobAlreadyRunningError(message) {
  return SCDownloadIntent.isJobAlreadyRunning(message);
}

function resetInlineButtonStateAfterSuccess() {
  if (successResetTimeout) {
    clearTimeout(successResetTimeout);
  }

  successResetTimeout = setTimeout(() => {
    successResetTimeout = null;
    isInlineDownloading = false;
    setInlineButtonState("idle");
  }, SUCCESS_RESET_MS);
}

async function handleInlineCollectionDownloadClick() {
  const playlistData = window.SCDL?.getPlaylistData?.();
  if (!playlistData?.title) {
    setInlineButtonState("error");
    isInlineDownloading = false;
    return;
  }

  const total =
    playlistData.totalCount ?? playlistData.tracks?.length ?? 0;

  if (total >= BULK_WARN_THRESHOLD) {
    const proceed = confirm(
      translate("inline_collection_confirm", total)
    );

    if (!proceed) {
      return;
    }
  }

  isInlineDownloading = true;
  setInlineButtonState("loading");

  try {
    const tracks = await window.SCDL.resolveBulkTracks(null);

    if (!tracks?.length) {
      throw new Error(translate("no_downloadable_tracks"));
    }

    const formatPreference = await SCStreamSelector.getStoredFormatPreference();

    await inlineDownloadIntent.downloadCollection(tracks, playlistData, {
      formatPreference,
    });

    setInlineButtonState("success");
    resetInlineButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader inline bulk download error:", error);
    isInlineDownloading = false;

    if (isJobAlreadyRunningError(error.message)) {
      setInlineButtonNotice("A download is already in progress");
      return;
    }

    setInlineButtonState("error");
  }
}

async function handleProfileTracksClick() {
  isInlineDownloading = true;
  setInlineButtonState("loading");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "OPEN_EXTENSION_POPUP",
    });

    if (!result?.success) {
      throw new Error(result?.error || translate("open_popup_failed"));
    }

    setInlineButtonState("success");
    resetInlineButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader profile selector error:", error);
    isInlineDownloading = false;
    setInlineButtonNotice(translate("open_extension_for_selection"));
    const label = document.querySelector(
      `#${INLINE_BUTTON_ID} .scdl-profile-download-label`
    );
    if (label) {
      label.textContent = translate("open_extension_icon");
    }
  }
}

async function handleInlineDownloadClick() {
  if (isInlineDownloading) {
    return;
  }

  if (isProfileTracksInlinePage()) {
    return handleProfileTracksClick();
  }

  if (isCollectionInlinePage()) {
    return handleInlineCollectionDownloadClick();
  }

  const trackData = inlineTrackData || window.SCDL?.getTrackData?.();
  if (!SCDownloadTrack.canDownload(trackData)) {
    setInlineButtonState("error");
    isInlineDownloading = false;
    return;
  }

  isInlineDownloading = true;
  setInlineButtonState("loading");

  try {
    const formatPreference =
      trackData.formatPreference ||
      (await SCStreamSelector.getStoredFormatPreference());
    await inlineDownloadIntent.downloadTrack(trackData, {
      formatPreference,
    });

    setInlineButtonState("success");
    resetInlineButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader inline download error:", error);
    isInlineDownloading = false;
    setInlineButtonState("error");
  }
}

function normalizePlayerTrackUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function withPlayerDownloadTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(message)),
      PLAYER_DOWNLOAD_TIMEOUT_MS
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function getPlayerTrackUrl() {
  const link = document.querySelector(
    ".playControls__soundBadge .playbackSoundBadge__titleLink"
  );

  return link?.href ? normalizePlayerTrackUrl(link.href) : null;
}

function findPlayerControlsContainer() {
  return document.querySelector(".playControls__elements");
}

function ensurePlayerTrack() {
  const container = findPlayerControlsContainer();
  const trackUrl = getPlayerTrackUrl();

  if (!container || !trackUrl) {
    playerTrackUrl = null;
    publishPlayerVisual(null);
    return;
  }

  if (playerTrackUrl !== trackUrl) {
    playerTrackUrl = trackUrl;
    publishPlayerVisual(trackUrl);
  }
}

async function downloadCurrentPlayerTrack(playbackTransform = readPlayerPlaybackTransform()) {
  const requestedTrackUrl = getPlayerTrackUrl() || playerTrackUrl;
  if (!requestedTrackUrl) throw new Error(translate("inline_no_track"));
  const trackData = await withPlayerDownloadTimeout(
    window.SCDL?.resolvePlayerTrackData?.(requestedTrackUrl),
    translate("resolve_current_track_timeout")
  );

  if (!SCDownloadTrack.canDownload(trackData)) {
    throw new Error(translate("current_track_no_source"));
  }

  const result = await withPlayerDownloadTimeout(
    inlineDownloadIntent.downloadTrack(trackData, {
      formatPreference: "auto",
      playbackTransform,
    }),
    translate("download_timeout")
  );

  if (!result?.success) {
    throw new Error(result?.error || translate("download_failed"));
  }
  return result;
}

document.addEventListener?.(TRACK_EXPORT_EVENT, async () => {
  let request;
  try {
    request = JSON.parse(document.documentElement.getAttribute(TRACK_EXPORT_ATTRIBUTE) || "null");
  } catch {
    request = null;
  }
  if (!request?.id) return;
  if (isPlayerDownloading) {
    document.dispatchEvent(new CustomEvent(TRACK_EXPORT_RESULT_EVENT, { detail: { id: request.id, success: false, error: "A track download is already in progress." } }));
    return;
  }

  isPlayerDownloading = true;
  try {
    const result = await downloadCurrentPlayerTrack(request.playbackTransform || null);
    document.dispatchEvent(new CustomEvent(TRACK_EXPORT_RESULT_EVENT, { detail: { id: request.id, ...result } }));
  } catch (error) {
    console.error("SC Track Downloader player download error:", error);
    document.dispatchEvent(new CustomEvent(TRACK_EXPORT_RESULT_EVENT, { detail: { id: request.id, success: false, error: error?.message || translate("download_failed") } }));
  } finally {
    isPlayerDownloading = false;
  }
});

function createInlineDownloadButton() {
  injectInlineStyles();

  const button = document.createElement("button");
  button.id = INLINE_BUTTON_ID;
  button.type = "button";
  button.title = translate("download");
  button.setAttribute("aria-label", translate("download"));
  const profileTracksPage = isProfileTracksInlinePage();
  button.className = profileTracksPage
    ? "sc-button sc-button-secondary sc-button-medium sc-button-responsive scdl-profile-download"
    : "sc-button sc-button-secondary sc-button-medium sc-button-icon sc-button-responsive";

  const icon = document.createElement("img");
  icon.className = "scdl-inline-icon scdl-filtered";
  icon.src = chrome.runtime.getURL("assets/icons/download.svg");
  icon.alt = "";
  icon.draggable = false;
  button.appendChild(icon);

  if (profileTracksPage) {
    const label = document.createElement("span");
    label.className = "scdl-profile-download-label";
    label.textContent = translate("inline_download_tracks");
    button.appendChild(label);
  }

  button.addEventListener("click", handleInlineDownloadClick);
  return button;
}

function ensureInlineDownloadButton(trackData) {
  if (!isInlineButtonPage()) {
    removeInlineDownloadButton();
    return;
  }

  inlineTrackData = window.SCDL?.isTrackPage?.()
    ? trackData || window.SCDL?.getTrackData?.() || null
    : null;

  const buttonGroup = findActionButtonGroup();
  if (!buttonGroup) {
    return;
  }

  let button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    button = createInlineDownloadButton();
    const moreButton = buttonGroup.querySelector(".sc-button-more");
    if (moreButton) {
      buttonGroup.insertBefore(button, moreButton);
    } else {
      buttonGroup.appendChild(button);
    }
  }

  if (!isInlineDownloading) {
    setInlineButtonState("idle");
  }
}

function removeInlineDownloadButton() {
  inlineTrackData = null;
  isInlineDownloading = false;

  if (successResetTimeout) {
    clearTimeout(successResetTimeout);
    successResetTimeout = null;
  }

  document.getElementById(INLINE_BUTTON_ID)?.remove();
}

let toolbarObserver = null;

function startToolbarObserver() {
  if (toolbarObserver) {
    return;
  }

  toolbarObserver = new MutationObserver(() => {
    ensurePlayerTrack();

    if (!isInlineButtonPage()) {
      return;
    }

    if (document.getElementById(INLINE_BUTTON_ID)) {
      return;
    }

    if (!findActionButtonGroup()) {
      return;
    }

    ensureInlineDownloadButton();
  });

  toolbarObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

startToolbarObserver();
ensurePlayerTrack();
