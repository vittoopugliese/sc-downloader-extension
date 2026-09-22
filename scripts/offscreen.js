const activeBuilds = new Map();
const buildRecords = new Map();
const directorySaves = new Map();
const SERVICE_WORKER_KEEPALIVE_MS = 10000;
const PAD_MAX_BYTES = 12 * 1024 * 1024;
let padDatabasePromise = null;

function openPadDatabase() {
  if (!padDatabasePromise) {
    padDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("scdl-player-pads", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("samples", { keyPath: "index" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { padDatabasePromise = null; throw error; });
  }
  return padDatabasePromise;
}

async function padTransaction(mode, action) {
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("samples", mode);
    const request = action(transaction.objectStore("samples"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Could not save the pad sample."));
  });
}

function validPadIndex(index) { return Number.isInteger(index) && index >= 0 && index < 6; }

async function storePad(index, name, blob) {
  if (!validPadIndex(index) || !(blob instanceof Blob) || blob.size > PAD_MAX_BYTES) {
    throw new Error("This sample is too large for a pad.");
  }
  const record = { index, name: String(name || "Sample").slice(0, 100), blob, updatedAt: Date.now() };
  await padTransaction("readwrite", (store) => store.put(record));
  return { index, name: record.name, updatedAt: record.updatedAt };
}

async function handlePadMessage(message) {
  try {
    if (message.type === "OFFSCREEN_PAD_LIST") {
      const records = await padTransaction("readonly", (store) => store.getAll());
      return { success: true, pads: records.map(({ index, name, updatedAt }) => ({ index, name, updatedAt })) };
    }
    if (!validPadIndex(message.index)) throw new Error("Invalid pad.");
    if (message.type === "OFFSCREEN_PAD_GET") {
      const record = await padTransaction("readonly", (store) => store.get(message.index));
      if (!record) return { success: true, pad: null };
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(record.blob);
      });
      return { success: true, pad: { index: record.index, name: record.name, dataUrl } };
    }
    if (message.type === "OFFSCREEN_PAD_STORE") {
      if (typeof message.base64 !== "string" || message.base64.length > Math.ceil(PAD_MAX_BYTES * 4 / 3) + 4) {
        throw new Error("This sample is too large for a pad.");
      }
      const binary = atob(message.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return { success: true, pad: await storePad(message.index, message.name, new Blob([bytes], { type: message.mimeType || "audio/wav" })) };
    }
    if (message.type === "OFFSCREEN_PAD_RENDER") {
      const controller = new AbortController();
      const keepaliveId = setInterval(() => chrome.runtime.sendMessage({ type: "OFFSCREEN_KEEPALIVE", buildId: message.buildId }).catch(() => {}), SERVICE_WORKER_KEEPALIVE_MS);
      try {
        const { blob } = await SCDownload.buildTrackBlob(message.streamUrl, message.trackData, null, controller.signal,
          message.trimRange, message.playbackTransform, message.effects);
        return { success: true, pad: await storePad(message.index, message.name, blob) };
      } finally { clearInterval(keepaliveId); }
    }
    return { success: false, error: "Unknown pad operation." };
  } catch (error) {
    return { success: false, error: error?.message || "Could not prepare this pad.", code: error?.code || "pad_failed", status: error?.status };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || sender?.tab ||
      sender?.url !== chrome.runtime.getURL("scripts/background.js")) {
    sendResponse({ success: false, code: "invalid_sender" });
    return false;
  }
  if (!message || typeof message.type !== "string") return false;
  if (["OFFSCREEN_PAD_LIST", "OFFSCREEN_PAD_GET", "OFFSCREEN_PAD_STORE", "OFFSCREEN_PAD_RENDER"].includes(message.type)) {
    handlePadMessage(message).then(sendResponse);
    return true;
  }
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
