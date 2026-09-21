const activeBuilds = new Map();
const buildRecords = new Map();
const directorySaves = new Map();
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
        typeof message.trackData !== "object") {
      sendResponse({ success: false, code: "invalid_build" });
      return false;
    }
    const signature = JSON.stringify([message.streamUrl, message.trackData,
      message.trimRange || null, message.playbackTransform || null]);
    const existing = buildRecords.get(message.buildId);
    if (existing && existing.signature !== signature) {
      sendResponse({ success: false, code: "operation_conflict" });
      return false;
    }
    if (existing) {
      existing.promise.then(sendResponse);
      return true;
    }
    const promise = handleBuild(message);
    buildRecords.set(message.buildId, { signature, promise });
    promise.then(sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_SAVE_TO_DIRECTORY") {
    if (typeof message.blobUrl !== "string" || !message.blobUrl.startsWith("blob:") ||
        typeof message.fileName !== "string" || message.fileName.length > 255 ||
        typeof message.directoryId !== "string" || message.directoryId.length > 128 ||
        typeof message.operationId !== "string" || !/^track_[A-Za-z0-9_]+$/.test(message.operationId) ||
        message.operationId.length > 100) {
      sendResponse({ success: false, code: "invalid_save" });
      return false;
    }
    const signature = JSON.stringify([message.blobUrl, message.fileName, message.directoryId]);
    const existing = directorySaves.get(message.operationId);
    if (existing && existing.signature !== signature) {
      sendResponse({ success: false, code: "operation_conflict" });
      return false;
    }
    if (existing) {
      existing.promise.then(sendResponse);
      return true;
    }
    const promise = handleDirectorySave(message);
    directorySaves.set(message.operationId, { signature, promise });
    promise.then(sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_REVOKE") {
    try {
      if (typeof message.blobUrl === "string" && message.blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(message.blobUrl);
        for (const [id, record] of buildRecords) {
          if (record.blobUrl === message.blobUrl) buildRecords.delete(id);
        }
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

async function handleDirectorySave(message) {
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
    return { success: true, fileName };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Could not save to the selected folder.",
      code: error.code || "save_failed",
    };
  }
}

async function handleBuild(message) {
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
    const record = buildRecords.get(message.buildId);
    if (record) record.blobUrl = blobUrl;
    return { success: true, blobUrl, fileName };
  } catch (error) {
    if (error.name === "AbortError") {
      return { success: false, error: "Build aborted." };
    } else {
      return {
        success: false,
        error: error.message || "Build failed.",
        code: error.code || "build_failed",
        status: error.status,
      };
    }
  } finally {
    clearInterval(keepaliveId);
    activeBuilds.delete(message.buildId);
  }
}
