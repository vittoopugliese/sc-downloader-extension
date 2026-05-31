const INLINE_BUTTON_ID = "scdl-inline-download";
const INLINE_STYLES_ID = "scdl-inline-styles";
const SUCCESS_RESET_MS = 2000;

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

function setInlineButtonState(state) {
  const button = document.getElementById(INLINE_BUTTON_ID);
  if (!button) {
    return;
  }

  button.classList.remove("is-loading", "is-success", "is-error");

  if (state === "loading") {
    button.classList.add("is-loading");
    button.title = "Downloading...";
    button.setAttribute("aria-label", "Downloading...");
    return;
  }

  if (state === "success") {
    button.classList.add("is-success");
    button.title = "Downloaded!";
    button.setAttribute("aria-label", "Downloaded!");
    return;
  }

  if (state === "error") {
    button.classList.add("is-error");
    button.title = "Error, please retry";
    button.setAttribute("aria-label", "Error, please retry");
    return;
  }

  button.title = "Download";
  button.setAttribute("aria-label", "Download");
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

async function handleInlineDownloadClick() {
  if (isInlineDownloading) {
    return;
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
  if (!window.SCDL?.isTrackPage?.()) {
    removeInlineDownloadButton();
    return;
  }

  inlineTrackData = trackData || window.SCDL?.getTrackData?.() || null;

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
    if (!window.SCDL?.isTrackPage?.()) {
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
