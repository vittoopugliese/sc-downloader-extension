const INLINE_BUTTON_ID = "scdl-inline-download";
const INLINE_STYLES_ID = "scdl-inline-styles";
const SUCCESS_RESET_MS = 2000;
const BULK_WARN_THRESHOLD = 200;

let inlineTrackData = null;
let isInlineDownloading = false;
let successResetTimeout = null;

function injectInlineStyles() {
  if (document.getElementById(INLINE_STYLES_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = INLINE_STYLES_ID;
  style.textContent = `
    #${INLINE_BUTTON_ID}.sc-button {
      position: relative;
    }

    #${INLINE_BUTTON_ID} .scdl-inline-icon {
      width: 20px;
      height: 20px;
      display: block;
      border-radius: 4px;
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
  return (
    document.querySelector(
      ".listenEngagement__actions .sc-button-group"
    ) ||
    document.querySelector(".soundActions .sc-button-group")
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

function setInlineButtonState(state) {
  const button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    return;
  }

  button.classList.remove("is-loading", "is-success", "is-error");

  const collectionPage = isCollectionInlinePage();

  if (state === "loading") {
    button.classList.add("is-loading");
    button.title = collectionPage ? "Preparing download..." : "Downloading...";
    button.setAttribute(
      "aria-label",
      collectionPage ? "Preparing download..." : "Downloading..."
    );
    return;
  }

  if (state === "success") {
    button.classList.add("is-success");
    button.title = collectionPage ? "Download started!" : "Downloaded!";
    button.setAttribute(
      "aria-label",
      collectionPage ? "Download started!" : "Downloaded!"
    );
    return;
  }

  if (state === "error") {
    button.classList.add("is-error");
    button.title = "Error, please retry";
    button.setAttribute("aria-label", "Error, please retry");
    return;
  }

  button.title = collectionPage ? "Download playlist" : "Download";
  button.setAttribute(
    "aria-label",
    collectionPage ? "Download playlist" : "Download"
  );
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

async function handleInlineDownloadClick() {
  if (isInlineDownloading) {
    return;
  }

  if (isCollectionInlinePage()) {
    return handleInlineCollectionDownloadClick();
  }

  const trackData = inlineTrackData || window.SCDL?.getTrackData?.();
  if (!trackData?.streamUrl) {
    setInlineButtonState("error");
    isInlineDownloading = false;
    return;
  }

  isInlineDownloading = true;
  setInlineButtonState("loading");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "GET_STREAM_URL",
      streamUrl: trackData.streamUrl,
      clientId: trackData.clientId,
      trackAuthorization: trackData.trackAuthorization,
      streamProtocol: trackData.streamProtocol,
      streamPreset: trackData.streamPreset,
      streamMimeType: trackData.streamMimeType,
    });

    if (!result?.success || !result.url) {
      throw new Error(result?.error || "Cannot obtain final file URL.");
    }

    const { blob, fileName } = await SCDownload.buildTrackBlob(
      result.url,
      trackData
    );
    SCDownload.triggerBlobDownload(blob, fileName);
    setInlineButtonState("success");
    resetInlineButtonStateAfterSuccess();
  } catch (error) {
    console.error("SC Track Downloader inline download error:", error);
    isInlineDownloading = false;
    setInlineButtonState("error");
  }
}

function createInlineDownloadButton() {
  injectInlineStyles();

  const button = document.createElement("button");
  button.id = INLINE_BUTTON_ID;
  button.type = "button";
  button.title = "Download";
  button.setAttribute("aria-label", "Download");
  button.className =
    "sc-button sc-button-secondary sc-button-medium sc-button-icon sc-button-responsive";

  const iconWrap = document.createElement("div");
  const icon = document.createElement("img");
  icon.className = "scdl-inline-icon";
  icon.src = chrome.runtime.getURL("assets/icon48.png");
  icon.alt = "";
  icon.draggable = false;
  iconWrap.appendChild(icon);
  button.appendChild(iconWrap);

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
