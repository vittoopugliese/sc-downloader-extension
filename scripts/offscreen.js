const activeBuilds = new Map();
const SERVICE_WORKER_KEEPALIVE_MS = 10000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || sender?.tab ||
      sender?.url !== chrome.runtime.getURL("scripts/background.js")) {
    sendResponse({ success: false, code: "invalid_sender" });
    return false;
  }
  if (!message || typeof message.type !== "string") return false;
  if (message.type === "OFFSCREEN_BUILD") {
    if (typeof message.buildId !== "string" || !/^track_[A-Za-z0-9_]+$/.test(message.buildId) ||
        message.buildId.length > 100 || typeof message.streamUrl !== "string" ||
        message.streamUrl.length > 4096 || !message.trackData ||
        typeof message.trackData !== "object" || activeBuilds.has(message.buildId)) {
      sendResponse({ success: false, code: "invalid_build" });
      return false;
    }
    handleBuild(message, sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_SAVE_TO_DIRECTORY") {
    if (typeof message.blobUrl !== "string" || !message.blobUrl.startsWith("blob:") ||
        typeof message.fileName !== "string" || message.fileName.length > 255 ||
        typeof message.directoryId !== "string" || message.directoryId.length > 128) {
      sendResponse({ success: false, code: "invalid_save" });
      return false;
    }
    handleDirectorySave(message, sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_REVOKE") {
    try {
      if (typeof message.blobUrl === "string" && message.blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(message.blobUrl);
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (message.type === "OFFSCREEN_ABORT") {
    const controller = activeBuilds.get(message.buildId);
    controller?.abort();
    sendResponse({ success: true });
    return true;
  }

  return false;
});

async function handleDirectorySave(message, sendResponse) {
  try {
    const response = await fetch(message.blobUrl);
    if (!response.ok) {
      throw new Error(`Could not read the prepared audio file (${response.status}).`);
    }

    const blob = await response.blob();
    const fileName = await SCDownloadDirectory.saveBlob(
      message.directoryId,
      message.fileName,
      blob
    );
    sendResponse({ success: true, fileName });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message || "Could not save to the selected folder.",
    });
  }
}

async function handleBuild(message, sendResponse) {
  const controller = new AbortController();
  const keepaliveId = setInterval(() => {
    chrome.runtime
      .sendMessage({
        type: "OFFSCREEN_KEEPALIVE",
        buildId: message.buildId,
      })
      .catch(() => {});
  }, SERVICE_WORKER_KEEPALIVE_MS);
  activeBuilds.set(message.buildId, controller);

  const reportProgress = (statusText) => {
    chrome.runtime
      .sendMessage({
        type: "OFFSCREEN_BUILD_PROGRESS",
        buildId: message.buildId,
        statusText,
      })
      .catch(() => {});
  };

  try {
    const { blob, fileName } = await SCDownload.buildTrackBlob(
      message.streamUrl,
      message.trackData,
      reportProgress,
      controller.signal,
      message.trimRange || null,
      message.playbackTransform || null
    );
    const blobUrl = URL.createObjectURL(blob);
    sendResponse({ success: true, blobUrl, fileName });
  } catch (error) {
    if (error.name === "AbortError") {
      sendResponse({ success: false, error: "Build aborted." });
    } else {
      sendResponse({
        success: false,
        error: error.message || "Build failed.",
        code: error.code || "build_failed",
        status: error.status,
      });
    }
  } finally {
    clearInterval(keepaliveId);
    activeBuilds.delete(message.buildId);
  }
}
