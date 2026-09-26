const activeBuilds = new Map();
const buildRecords = new Map();
const directorySaves = new Map();
const padRenders = new Map();
const instrumentCancellations = new Map();
const instrumentTransfers = new Map();
const INSTRUMENT_MAX_BYTES = 128 * 1024 * 1024;
const INSTRUMENT_CHUNK_BYTES = 1024 * 1024;
const SERVICE_WORKER_KEEPALIVE_MS = 10000;
const INSTRUMENT_CANCEL_TTL_MS = 5 * 60 * 1000;
const PAD_MAX_BYTES = 12 * 1024 * 1024;
let padDatabasePromise = null;

function openPadDatabase() {
  if (!padDatabasePromise) {
    padDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("scdl-player-pads", 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("samples")) database.createObjectStore("samples", { keyPath: "index" });
        if (!database.objectStoreNames.contains("operations")) database.createObjectStore("operations", { keyPath: "id" });
        if (!database.objectStoreNames.contains("claims")) database.createObjectStore("claims", { keyPath: "index" });
      };
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
function validPadOperationId(id) { return typeof id === "string" && /^pad_[A-Za-z0-9_-]{8,100}$/.test(id); }
function validInstrumentOperationId(id) { return typeof id === "string" && /^instrument_[A-Za-z0-9_-]{8,100}$/.test(id); }

function instrumentAbortError() {
  return Object.assign(new Error("Instrument preparation cancelled."), {
    name: "AbortError",
    code: "instrument_cancelled",
  });
}

function pruneInstrumentCancellations() {
  const cutoff = Date.now() - INSTRUMENT_CANCEL_TTL_MS;
  for (const [id, transfer] of instrumentTransfers) {
    if (transfer.updatedAt < cutoff) instrumentTransfers.delete(id);
  }
  for (const [id, cancelledAt] of instrumentCancellations) {
    if (cancelledAt < cutoff) instrumentCancellations.delete(id);
  }
  while (instrumentCancellations.size > 200) {
    instrumentCancellations.delete(instrumentCancellations.keys().next().value);
  }
}

function cancelInstrumentRender(operationId) {
  if (!validInstrumentOperationId(operationId)) throw new Error("Invalid instrument operation.");
  pruneInstrumentCancellations();
  instrumentCancellations.set(operationId, Date.now());
  instrumentTransfers.delete(operationId);
  const record = padRenders.get(operationId);
  record?.controller?.abort();
  try { record?.reader?.abort(); } catch {}
  return { success: true, cancelled: Boolean(record), code: "instrument_cancelled" };
}

async function beginPadOperation(index, id, kind) {
  if (!validPadIndex(index) || !validPadOperationId(id) || !["store", "render"].includes(kind)) throw new Error("Invalid pad operation.");
  const database = await openPadDatabase();
  const result = await new Promise((resolve, reject) => {
    const transaction = database.transaction(["operations", "claims"], "readwrite");
    const operations = transaction.objectStore("operations");
    const claims = transaction.objectStore("claims");
    let operation;
    const request = operations.get(id);
    request.onsuccess = () => {
      operation = request.result;
      if (operation) return;
      operation = { id, index, kind, state: "pending", updatedAt: Date.now() };
      operations.put(operation);
      claims.put({ index, id });
    };
    transaction.oncomplete = () => resolve(operation);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  if (result.index !== index || result.kind !== kind) throw new Error("Pad operation ID conflict.");
  return result;
}

async function readPadOperation(id) {
  if (!validPadOperationId(id)) throw new Error("Invalid pad operation.");
  return padTransactionFor("operations", "readonly", (store) => store.get(id));
}

async function padTransactionFor(storeName, mode, action) {
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function finishPadOperation(id, blob, name, failure = null) {
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["operations", "claims", "samples"], "readwrite");
    const operations = transaction.objectStore("operations");
    const claims = transaction.objectStore("claims");
    const samples = transaction.objectStore("samples");
    let result;
    const request = operations.get(id);
    request.onsuccess = () => {
      const operation = request.result;
      if (!operation) { result = { success: false, code: "unknown_operation" }; return; }
      if (operation.state !== "pending") { result = operation.result; return; }
      const claimRequest = claims.get(operation.index);
      claimRequest.onsuccess = () => {
        if (claimRequest.result?.id !== id) {
          result = { success: false, code: "obsolete_pad", error: "A newer sample replaced this operation." };
        } else if (failure) {
          result = { success: false, code: failure.code || "pad_failed", error: failure.message || "Could not prepare this pad.", status: failure.status };
        } else if (!(blob instanceof Blob) || blob.size > PAD_MAX_BYTES) {
          result = { success: false, code: "pad_too_large", error: "This sample is too large for a pad." };
        } else {
          const record = { index: operation.index, name: String(name || "Sample").slice(0, 100), blob, updatedAt: Date.now() };
          samples.put(record);
          result = { success: true, pad: { index: record.index, name: record.name, updatedAt: record.updatedAt } };
        }
        operation.state = result.success ? "done" : "failed";
        operation.result = result;
        operation.updatedAt = Date.now();
        operations.put(operation);
      };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function cancelPadOperation(id) {
  const operation = await readPadOperation(id);
  if (!operation) return { success: false, code: "unknown_operation" };
  padRenders.get(id)?.controller.abort();
  return finishPadOperation(id, null, null, { code: "pad_cancelled", message: "Pad preparation cancelled." });
}

async function storePad(index, name, blob, id) {
  if (!validPadIndex(index) || !(blob instanceof Blob) || blob.size > PAD_MAX_BYTES) {
    throw new Error("This sample is too large for a pad.");
  }
  const operation = await readPadOperation(id);
  if (!operation || operation.index !== index) throw new Error("Invalid pad operation.");
  return finishPadOperation(id, blob, name);
}

async function handlePadMessage(message) {
  try {
    if (message.type === "OFFSCREEN_PAD_LIST") {
      const records = await padTransaction("readonly", (store) => store.getAll());
      return { success: true, pads: records.map(({ index, name, updatedAt }) => ({ index, name, updatedAt })) };
    }
    if (message.type === "OFFSCREEN_INSTRUMENT_CANCEL") {
      return cancelInstrumentRender(message.operationId);
    }
    if (message.type === "OFFSCREEN_INSTRUMENT_READ") {
      pruneInstrumentCancellations();
      const transfer = instrumentTransfers.get(message.operationId);
      if (!transfer || message.offset !== transfer.offset) throw new Error("Instrument transfer is unavailable or out of order.");
      const part = transfer.blob.slice(transfer.offset, transfer.offset + INSTRUMENT_CHUNK_BYTES);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(part);
      });
      if (instrumentCancellations.has(message.operationId)) throw instrumentAbortError();
      const offset = transfer.offset;
      transfer.offset += part.size;
      transfer.updatedAt = Date.now();
      if (transfer.offset === transfer.blob.size) instrumentTransfers.delete(message.operationId);
      return { success: true, chunk: { offset, byteLength: part.size, dataUrl } };
    }
    if (message.type === "OFFSCREEN_INSTRUMENT_RENDER") {
      if (!validInstrumentOperationId(message.operationId)) {
        throw new Error("Invalid instrument operation.");
      }
      pruneInstrumentCancellations();
      if (instrumentCancellations.has(message.operationId)) throw instrumentAbortError();
      const controller = new AbortController();
      const record = padRenders.get(message.operationId) || {};
      record.controller = controller;
      record.reader = null;
      padRenders.set(message.operationId, record);
      const keepaliveId = setInterval(() => chrome.runtime.sendMessage({ type: "OFFSCREEN_KEEPALIVE", buildId: message.buildId }).catch(() => {}), SERVICE_WORKER_KEEPALIVE_MS);
      try {
        const { blob } = await SCDownload.buildTrackBlob(message.streamUrl, message.trackData, null, controller.signal,
          message.fullTrack === true ? null : message.trimRange, message.playbackTransform, message.effects, true);
        if (controller.signal.aborted || instrumentCancellations.has(message.operationId)) throw instrumentAbortError();
        if (!(blob instanceof Blob) || blob.size === 0 || blob.size > (message.fullTrack === true ? INSTRUMENT_MAX_BYTES : PAD_MAX_BYTES)) {
          throw new Error("This loop is too large for the instrument.");
        }
        if (message.fullTrack === true) {
          instrumentTransfers.set(message.operationId, { blob, offset: 0, updatedAt: Date.now() });
          return { success: true, instrument: { fullTrack: true, byteLength: blob.size, mimeType: blob.type,
            name: String(message.name || "Loop instrument").slice(0, 100) } };
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          record.reader = reader;
          const abortReader = () => {
            try { reader.abort(); } catch { reject(instrumentAbortError()); }
          };
          controller.signal.addEventListener("abort", abortReader, { once: true });
          reader.onload = () => {
            controller.signal.removeEventListener("abort", abortReader);
            record.reader = null;
            resolve(reader.result);
          };
          reader.onerror = () => {
            controller.signal.removeEventListener("abort", abortReader);
            record.reader = null;
            reject(reader.error);
          };
          reader.onabort = () => {
            controller.signal.removeEventListener("abort", abortReader);
            record.reader = null;
            reject(instrumentAbortError());
          };
          reader.readAsDataURL(blob);
        });
        if (controller.signal.aborted || instrumentCancellations.has(message.operationId)) throw instrumentAbortError();
        return { success: true, instrument: { name: String(message.name || "Loop instrument").slice(0, 100), dataUrl } };
      } finally {
        clearInterval(keepaliveId);
        if (padRenders.get(message.operationId) === record) padRenders.delete(message.operationId);
      }
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
      const operationId = message.operationId;
      const operation = await beginPadOperation(message.index, operationId, "store");
      if (operation.state !== "pending") return operation.result;
      if (typeof message.base64 !== "string" || message.base64.length > Math.ceil(PAD_MAX_BYTES * 4 / 3) + 4) {
        throw new Error("This sample is too large for a pad.");
      }
      const binary = atob(message.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return await storePad(message.index, message.name, new Blob([bytes], { type: message.mimeType || "audio/wav" }), operationId);
    }
    if (message.type === "OFFSCREEN_PAD_RENDER") {
      const operationId = message.operationId;
      const operation = await beginPadOperation(message.index, operationId, "render");
      if (operation.state !== "pending") return operation.result;
      const controller = new AbortController();
      padRenders.set(operationId, { controller });
      const keepaliveId = setInterval(() => chrome.runtime.sendMessage({ type: "OFFSCREEN_KEEPALIVE", buildId: message.buildId }).catch(() => {}), SERVICE_WORKER_KEEPALIVE_MS);
      try {
        const { blob } = await SCDownload.buildTrackBlob(message.streamUrl, message.trackData, null, controller.signal,
          message.trimRange, message.playbackTransform, message.effects, true);
        return await storePad(message.index, message.name, blob, operationId);
      } finally { clearInterval(keepaliveId); padRenders.delete(operationId); }
    }
    return { success: false, error: "Unknown pad operation." };
  } catch (error) {
    if (validPadOperationId(message.operationId) && ["OFFSCREEN_PAD_STORE", "OFFSCREEN_PAD_RENDER"].includes(message.type)) {
      return finishPadOperation(message.operationId, null, null, error).catch(() => ({
        success: false, error: error?.message || "Could not prepare this pad.", code: error?.code || "pad_failed", status: error?.status,
      }));
    }
    return { success: false, error: error?.message || "Could not prepare this pad.",
      code: error?.code || (error?.name === "AbortError" ? "instrument_cancelled" : "pad_failed"), status: error?.status };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || sender?.tab ||
      sender?.url !== chrome.runtime.getURL("scripts/background.js")) {
    // runtime.sendMessage broadcasts to extension contexts.  Messages sent by
    // the popup are handled by the service worker, so responding here would
    // race the worker and could make the popup receive this unrelated response.
    return false;
  }
  if (!message || typeof message.type !== "string") return false;
  if (["OFFSCREEN_PAD_LIST", "OFFSCREEN_PAD_GET", "OFFSCREEN_PAD_STORE", "OFFSCREEN_PAD_RENDER",
      "OFFSCREEN_INSTRUMENT_RENDER", "OFFSCREEN_INSTRUMENT_CANCEL", "OFFSCREEN_INSTRUMENT_READ"].includes(message.type)) {
    const operationId = message.operationId;
    if (["OFFSCREEN_INSTRUMENT_CANCEL", "OFFSCREEN_INSTRUMENT_READ"].includes(message.type)) {
      Promise.resolve(handlePadMessage(message)).then(sendResponse);
      return true;
    }
    if (operationId && padRenders.has(operationId) && padRenders.get(operationId).promise) {
      padRenders.get(operationId).promise.then(sendResponse);
      return true;
    }
    const promise = handlePadMessage(message);
    if (operationId) {
      const record = padRenders.get(operationId) || {};
      record.promise = promise;
      padRenders.set(operationId, record);
    }
    promise.then(sendResponse);
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
      message.playbackTransform || null,
      message.effects || null,
      message.allowWav === true
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
