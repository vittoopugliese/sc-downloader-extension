const INLINE_BUTTON_ID = "scdl-inline-download";
const PLAYER_BUTTON_ID = "scdl-player-download";
const INLINE_STYLES_ID = "scdl-inline-styles";
const SUCCESS_RESET_MS = 2000;
const BULK_WARN_THRESHOLD = 200;
const PLAYER_DOWNLOAD_TIMEOUT_MS = 120000;

let inlineTrackData = null;
let isInlineDownloading = false;
let isPlayerDownloading = false;
let playerTrackUrl = null;
let successResetTimeout = null;
let playerSuccessResetTimeout = null;

function injectInlineStyles() {
  if (document.getElementById(INLINE_STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = INLINE_STYLES_ID;
  style.textContent = `
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

    #${INLINE_BUTTON_ID}::before,
    #${PLAYER_BUTTON_ID}::before {
      content: none;
      display: none;
    }

    #${INLINE_BUTTON_ID} .scdl-inline-icon,
    #${PLAYER_BUTTON_ID} .scdl-player-icon {
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

    #${PLAYER_BUTTON_ID}.scdl-player-download {
      position: relative;
      flex: 0 0 auto;
      width: 32px;
      height: 100%;
      min-width: 32px;
      margin: 0 0 0 24px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
      box-sizing: border-box;
    }

    #${PLAYER_BUTTON_ID} .scdl-player-icon {
      width: 22px;
      height: 22px;
      display: block;
      object-fit: contain;
      border-radius: 100%;
    }

    #${PLAYER_BUTTON_ID}.is-loading {
      opacity: 0.65;
      cursor: wait;
      pointer-events: none;
    }

    #${PLAYER_BUTTON_ID}.is-loading .scdl-player-icon {
      visibility: hidden;
    }

    #${PLAYER_BUTTON_ID}.is-loading::after {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      padding: 0;
      box-sizing: border-box;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 85, 0, 0.28);
      border-top-color: #ff5500;
      border-radius: 50%;
      animation: scdl-inline-spin 0.8s linear infinite;
    }

    #${PLAYER_BUTTON_ID}.is-disabled {
      opacity: 0.42;
      cursor: default;
      pointer-events: none;
    }

    #${INLINE_BUTTON_ID}.scdl-profile-download {
      display: inline-flex;
      align-items: center;
    }

    #${INLINE_BUTTON_ID}.scdl-profile-download .scdl-inline-icon {
      width: 16px;
      height: 16px;
    }

    #${INLINE_BUTTON_ID}.scdl-profile-floating {
      position: fixed;
      right: 24px;
      bottom: 92px;
      z-index: 10000;
      min-height: 36px;
      padding: 0 14px;
      color: #fff;
      background: #f50;
      border-color: #f50;
      border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
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
      ? "Loading track selector..."
      : collectionPage
        ? "Preparing download..."
        : "Downloading...";
    button.setAttribute(
      "aria-label",
      button.title
    );
    if (profileLabel) {
      profileLabel.textContent = "Opening selector...";
    }
    return;
  }

  if (state === "success") {
    button.classList.add("is-success");
    button.title = profileTracksPage
      ? "Track selector opened"
      : collectionPage
        ? "Download started!"
        : "Downloaded!";
    button.setAttribute(
      "aria-label",
      button.title
    );
    if (profileLabel) {
      profileLabel.textContent = "Selector opened";
    }
    return;
  }

  if (state === "error") {
    button.classList.add("is-error");
    button.title = "Error, please retry";
    button.setAttribute("aria-label", "Error, please retry");
    return;
  }

  button.title = profileTracksPage
    ? "Select user tracks"
    : collectionPage
      ? "Download playlist"
      : "Download";
  button.setAttribute(
    "aria-label",
    button.title
  );
  if (profileLabel) {
    profileLabel.textContent = "Download tracks";
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
  return /already in progress/i.test(message || "");
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
      `Download ${total} tracks as individual files in your Downloads folder? You can close this tab and the download will continue in the background. Or open the popup and select specific track count. Continue?`
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
      throw new Error("No downloadable tracks were found.");
    }

    const formatPreference = await SCStreamSelector.getStoredFormatPreference();

    const startResult = await chrome.runtime.sendMessage({
      type: "START_BULK_JOB",
      tracks,
      playlistTitle: playlistData.title,
      playlistMeta: {
        artworkUrl: playlistData.artwork_url || null,
        artist: playlistData.artist || null,
        artistImageUrl: playlistData.artistImageUrl || null,
        artistUrl: playlistData.artistUrl || null,
      },
      formatPreference,
    });

    if (!startResult?.success || !startResult.job) {
      const errorMessage =
        startResult?.error || "Could not start the background download.";

      if (isJobAlreadyRunningError(errorMessage)) {
        isInlineDownloading = false;
        setInlineButtonNotice("A download is already in progress");
        return;
      }

      throw new Error(errorMessage);
    }

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
      throw new Error(result?.error || "Could not open the extension popup.");
    }

    setInlineButtonState("success");
    resetInlineButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader profile selector error:", error);
    isInlineDownloading = false;
    setInlineButtonNotice("Open the extension to select user tracks");
    const label = document.querySelector(
      `#${INLINE_BUTTON_ID} .scdl-profile-download-label`
    );
    if (label) {
      label.textContent = "Open extension icon";
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
  if (
    !trackData?.streamUrl &&
    !(trackData?.downloadable && trackData?.hasDownloadsLeft)
  ) {
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
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_SINGLE_TRACK",
      trackData,
      formatPreference,
    });

    if (!result?.success) {
      throw new Error(result?.error || "Download failed.");
    }

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

function setPlayerButtonState(state, message = null) {
  const button = document.getElementById(PLAYER_BUTTON_ID);
  if (!button) {
    return;
  }

  button.classList.remove("is-loading", "is-success", "is-error", "is-disabled");

  if (state === "loading") {
    button.classList.add("is-loading");
    button.title = "Downloading current track...";
    button.setAttribute("aria-label", button.title);
    return;
  }

  if (state === "success") {
    button.classList.add("is-success");
    button.title = "Current track downloaded";
    button.setAttribute("aria-label", button.title);
    return;
  }

  if (state === "error") {
    button.classList.add("is-error");
    button.title = message || "Could not download the current track";
    button.setAttribute("aria-label", button.title);
    return;
  }

  if (state === "disabled") {
    button.classList.add("is-disabled");
    button.title = message || "No downloadable track is playing";
    button.setAttribute("aria-label", button.title);
    return;
  }

  button.title = "Download current track";
  button.setAttribute("aria-label", button.title);
}

function resetPlayerButtonStateAfterSuccess() {
  if (playerSuccessResetTimeout) {
    clearTimeout(playerSuccessResetTimeout);
  }

  playerSuccessResetTimeout = setTimeout(() => {
    playerSuccessResetTimeout = null;
    isPlayerDownloading = false;
    setPlayerButtonState("idle");
  }, SUCCESS_RESET_MS);
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

function createPlayerDownloadButton() {
  const button = document.createElement("button");
  button.id = PLAYER_BUTTON_ID;
  button.type = "button";
  button.className =
    "sc-button sc-button-secondary sc-button-small sc-button-icon sc-button-responsive scdl-player-download";
  button.title = "Download current track";
  button.setAttribute("aria-label", button.title);

  const icon = document.createElement("img");
  icon.className = "scdl-player-icon";
  icon.src = chrome.runtime.getURL("assets/icon48.png");
  icon.alt = "";
  icon.draggable = false;
  button.appendChild(icon);
  button.addEventListener("click", handlePlayerDownloadClick);
  return button;
}

function ensurePlayerDownloadButton() {
  const container = findPlayerControlsContainer();
  const trackUrl = getPlayerTrackUrl();
  let button = document.getElementById(PLAYER_BUTTON_ID);

  if (!container || !trackUrl) {
    button?.remove();
    playerTrackUrl = null;
    return;
  }

  injectInlineStyles();

  if (playerTrackUrl !== trackUrl) {
    playerTrackUrl = trackUrl;
    if (!isPlayerDownloading) {
      setPlayerButtonState("idle");
    }
  }

  if (!button) {
    button = createPlayerDownloadButton();
  }

  if (button.parentElement !== container) {
    const soundBadge = container.querySelector(".playControls__soundBadge");
    if (soundBadge) {
      soundBadge.insertAdjacentElement("afterend", button);
    } else {
      container.appendChild(button);
    }
  }

  if (!isPlayerDownloading) {
    setPlayerButtonState("idle");
  }
}

async function handlePlayerDownloadClick() {
  if (isPlayerDownloading || !playerTrackUrl) {
    return;
  }

  const requestedTrackUrl = playerTrackUrl;
  isPlayerDownloading = true;
  setPlayerButtonState("loading");

  try {
    const trackData = await withPlayerDownloadTimeout(
      window.SCDL?.resolvePlayerTrackData?.(requestedTrackUrl),
      "Timed out while resolving the current track."
    );

    if (
      !trackData?.streamUrl &&
      !(trackData?.downloadable && trackData?.hasDownloadsLeft)
    ) {
      throw new Error("The current track has no downloadable source.");
    }

    const result = await withPlayerDownloadTimeout(
      chrome.runtime.sendMessage({
        type: "DOWNLOAD_SINGLE_TRACK",
        trackData,
        formatPreference: "auto",
      }),
      "The download did not finish in time."
    );

    if (!result?.success) {
      throw new Error(result?.error || "Download failed.");
    }

    if (playerTrackUrl !== requestedTrackUrl) {
      isPlayerDownloading = false;
      setPlayerButtonState("idle");
      return;
    }

    setPlayerButtonState("success");
    resetPlayerButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader player download error:", error);
    isPlayerDownloading = false;
    if (playerTrackUrl === requestedTrackUrl) {
      setPlayerButtonState("error", error.message);
    } else {
      setPlayerButtonState("idle");
    }
  }
}

function createInlineDownloadButton() {
  injectInlineStyles();

  const button = document.createElement("button");
  button.id = INLINE_BUTTON_ID;
  button.type = "button";
  button.title = "Download";
  button.setAttribute("aria-label", "Download");
  const profileTracksPage = isProfileTracksInlinePage();
  button.className = profileTracksPage
    ? "sc-button sc-button-secondary sc-button-medium sc-button-responsive scdl-profile-download"
    : "sc-button sc-button-secondary sc-button-medium sc-button-icon sc-button-responsive";

  const icon = document.createElement("img");
  icon.className = "scdl-inline-icon scdl-filtered";
  icon.src = chrome.runtime.getURL("assets/download.svg");
  icon.alt = "";
  icon.draggable = false;
  button.appendChild(icon);

  if (profileTracksPage) {
    const label = document.createElement("span");
    label.className = "scdl-profile-download-label";
    label.textContent = "Download tracks";
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
  const profileTracksPage = isProfileTracksInlinePage();
  if (!buttonGroup && !profileTracksPage) {
    return;
  }

  let button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    button = createInlineDownloadButton();
    const moreButton = buttonGroup?.querySelector(".sc-button-more");
    if (!buttonGroup) {
      button.classList.add("scdl-profile-floating");
      document.body.appendChild(button);
    } else if (moreButton) {
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
    ensurePlayerDownloadButton();

    if (!isInlineButtonPage()) {
      return;
    }

    if (document.getElementById(INLINE_BUTTON_ID)) {
      return;
    }

    if (!findActionButtonGroup() && !isProfileTracksInlinePage()) {
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
ensurePlayerDownloadButton();
