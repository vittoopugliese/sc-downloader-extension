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
      const request = indexedDB.open("scdl-player-pads", 4);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("samples")) database.createObjectStore("samples", { keyPath: "index" });
        if (!database.objectStoreNames.contains("operations")) database.createObjectStore("operations", { keyPath: "id" });
        if (!database.objectStoreNames.contains("claims")) database.createObjectStore("claims", { keyPath: "index" });
        if (!database.objectStoreNames.contains("presets")) database.createObjectStore("presets", { keyPath: "id" });
        if (!database.objectStoreNames.contains("sources")) database.createObjectStore("sources", { keyPath: "id" });
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

async function readPadBlob(record) {
  if (!record?.audioId) return record?.blob;
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("sources", "readonly");
    const get = tx.objectStore("sources").get(record.audioId);
    tx.oncomplete = () => resolve(get.result?.blob);
    tx.onerror = () => reject(tx.error);
  });
}

async function prunePadSources() {
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["sources", "samples", "presets"], "readwrite");
    const samples = tx.objectStore("samples").getAll();
    const presets = tx.objectStore("presets").getAll();
    presets.onsuccess = () => {
      const used = new Set([...samples.result, ...presets.result.flatMap(preset => preset.samples || [])]
        .map(sample => sample.audioId).filter(Boolean));
      const cursor = tx.objectStore("sources").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!used.has(item.key)) item.delete();
        item.continue();
      };
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function validPadIndex(index) { return Number.isInteger(index) && index >= 0 && index < 8; }
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
  if (!validPadIndex(index) || !validPadOperationId(id) || !["store", "render", "delete"].includes(kind)) throw new Error("Invalid pad operation.");
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
        } else if (operation.kind === "delete") {
          samples.delete(operation.index);
          result = { success: true };
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

// Presets own their audio blobs. Restoring all pads and invalidating pending
// writes happen in one transaction, so an older render cannot overwrite a load.
async function handleSamplerPreset(message) {
  const action = message.type.replace("OFFSCREEN_SAMPLER_PRESET_", "");
  const readAudio = async audio => {
    if (typeof audio !== "string" || audio.length > 44 * 1024 * 1024 || !/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(audio)) throw new Error("Invalid instrument audio (maximum 32 MB).");
    return (await fetch(audio)).blob();
  };
  if (action === "RENDER") {
    const time = message.settings?.timePercent;
    if (!Number.isInteger(time) || time < 25 || time > 400) throw new Error("Invalid instrument time.");
    const blob = await renderPadTime(await readAudio(message.settings.audio), time);
    const audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { success: true, audio };
  }
  const id = message.presetId;
  if (action !== "LIST" && (typeof id !== "string" || !/^preset_[A-Za-z0-9_-]{8,100}$/.test(id))) {
    throw new Error("Invalid sampler preset.");
  }
  const metadata = ({ id, name, createdAt, settings }) => ({ id, name, createdAt, kind: settings?.kind || "pads" });
  if (action === "LIST") {
    const records = await padTransactionFor("presets", "readonly", store => store.getAll());
    return { success: true, presets: records.map(metadata).sort((a, b) => b.createdAt - a.createdAt) };
  }
  if (action === "DELETE") {
    await padTransactionFor("presets", "readwrite", store => store.delete(id));
    return { success: true };
  }
  let settings;
  if (action === "SAVE") {
    const state = message.settings;
    const keys = new Set();
    if (!state || !Array.isArray(state.pads) || state.pads.length !== 8 || !validPadIndex(state.selectedPadIndex)) {
      throw new Error("Invalid sampler settings.");
    }
    settings = { selectedPadIndex: state.selectedPadIndex, adsrEnabled: state.adsrEnabled === true,
      cutItself: state.cutItself === true, pads: state.pads.map(pad => {
        if (!pad || typeof pad.key !== "string" || !/^([a-z0-9])?$/.test(pad.key) || (pad.key && keys.has(pad.key))) {
          throw new Error("Invalid pad keys.");
        }
        if (pad.key) keys.add(pad.key);
        const bounded = (value, min, max) => {
          if (!Number.isFinite(value) || value < min || value > max) throw new Error("Invalid pad settings.");
          return value;
        };
        if (!Number.isInteger(pad.timePercent ?? 100)) throw new Error("Invalid pad time.");
        return { key: pad.key, gainPercent: bounded(pad.gainPercent, 0, 154), pitchSemitones: bounded(pad.pitchSemitones, -12, 12),
          timePercent: bounded(pad.timePercent ?? 100, 25, 400),
          envelope: Object.fromEntries(["attack", "decay", "sustain", "release"].map(key =>
            [key, bounded(pad.envelope?.[key], 0, key === "sustain" ? 100 : 5000)])) };
      }) };
    settings.kind = state.kind === "piano" ? "piano" : "pads";
    if (settings.kind === "piano") {
      const instrument = state.instrument;
      await readAudio(instrument?.audio);
      if (!Number.isInteger(instrument.octave) || Math.abs(instrument.octave) > 4) throw new Error("Invalid octave.");
      // Reuse the validated selected-pad shape for the keyboard-wide controls.
      settings.instrument = { ...settings.pads[state.selectedPadIndex], audio: instrument.audio, octave: instrument.octave };
    }
    if (typeof message.name !== "string" || !message.name.trim() || message.name.length > 80) throw new Error("Enter a preset name.");
  }
  const database = await openPadDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["presets", "samples", "claims"], "readwrite");
    const presets = tx.objectStore("presets");
    const samples = tx.objectStore("samples");
    let result;
    const guard = callback => () => {
      try { callback(); }
      catch (error) { reject(error); try { tx.abort(); } catch {} }
    };
    const get = presets.get(id);
    get.onsuccess = guard(() => {
      const preset = get.result;
      if (action === "SAVE") {
        if (preset) { result = { success: true, preset: metadata(preset) }; return; }
        const all = samples.getAll();
        all.onsuccess = guard(() => {
          const record = { id, name: message.name.trim(), createdAt: Date.now(), settings, samples: settings.kind === "piano" ? [] : all.result };
          presets.add(record);
          result = { success: true, preset: metadata(record) };
        });
      } else if (action === "LOAD" && preset) {
        if (preset.settings.kind === "piano") {
          result = { success: true, settings: preset.settings, pads: [] };
          return;
        }
        samples.clear();
        const updatedAt = Date.now();
        const claimId = `preset_load_${crypto.randomUUID()}`;
        for (let index = 0; index < 8; index++) tx.objectStore("claims").put({ index, id: claimId });
        for (const sample of preset.samples) samples.put({ ...sample, updatedAt });
        result = { success: true, settings: preset.settings,
          pads: preset.samples.map(({ index, name }) => ({ index, name, updatedAt })) };
      } else result = { success: false, error: "This sampler preset is no longer available." };
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save the sampler state."));
  });
}

// Serialize time renders to bound decoder/WASM working memory across pads/tabs.
let padTimeQueue = Promise.resolve();
let pendingPadTimes = 0;
function renderPadTime(blob, timePercent) {
  if (pendingPadTimes >= 8) return Promise.reject(new Error("Sampler is busy preparing audio. Try again shortly."));
  pendingPadTimes++;
  const keepalive = setInterval(() => chrome.runtime.sendMessage({ type: "OFFSCREEN_KEEPALIVE" }).catch(() => {}), SERVICE_WORKER_KEEPALIVE_MS);
  const render = padTimeQueue.then(async () => {
    if (blob.size > PAD_MAX_BYTES) throw new Error("This sample is too large for a pad.");
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (decoded.duration > 30 || decoded.length * decoded.numberOfChannels * 4 > 16 * 1024 * 1024) {
        throw new Error("Samples must be 30 seconds or shorter and fit the pad memory limit.");
      }
      const rendered = await SCLoopAudioRenderer.render(decoded,
        { startMs: 0, endMs: decoded.duration * 1000 }, { rate: 100 / timePercent, preservePitch: true });
      return new Blob([SCDownload.encodeWavSegment(rendered,
        { startMs: 0, endMs: rendered.length / rendered.sampleRate * 1000 })], { type: "audio/wav" });
    } finally { await context.close(); }
  });
  padTimeQueue = render.catch(() => {});
  return render.finally(() => { pendingPadTimes--; clearInterval(keepalive); });
}

async function handlePadMessage(message) {
  try {
    if (message.type.startsWith("OFFSCREEN_SAMPLER_PRESET_")) return await handleSamplerPreset(message);
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
    if (message.type === "OFFSCREEN_PAD_DELETE") {
      const operation = await beginPadOperation(message.index, message.operationId, "delete");
      if (operation.state !== "pending") return operation.result;
      return await finishPadOperation(message.operationId);
    }
    if (message.type === "OFFSCREEN_PAD_TRIM") {
      const before = await padTransaction("readonly", store => store.get(message.index));
      if (!before || before.updatedAt !== message.expectedUpdatedAt) throw new Error("The sample changed.");
      let durationMs = before.sourceDurationMs;
      if (!Number.isFinite(durationMs)) {
        const context = new AudioContext();
        try { durationMs = (await context.decodeAudioData(await (await readPadBlob(before)).arrayBuffer())).duration * 1000; }
        finally { await context.close(); }
      }
      const database = await openPadDatabase();
      return await new Promise((resolve, reject) => {
        const tx = database.transaction("samples", "readwrite");
        const store = tx.objectStore("samples");
        const get = store.get(message.index);
        let result;
        get.onsuccess = () => {
          const record = get.result;
          const trim = message.trim;
          if (!record || record.updatedAt !== message.expectedUpdatedAt ||
              !Number.isFinite(trim?.startMs) || !Number.isFinite(trim?.endMs) ||
              trim.startMs < 0 || trim.endMs - trim.startMs < 1 ||
              trim.endMs > durationMs) {
            result = { success: false, error: "The sample changed or its bounds are invalid." };
            return;
          }
          record.trim = { startMs: trim.startMs, endMs: trim.endMs };
          record.sourceDurationMs = durationMs;
          store.put(record);
          result = { success: true };
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    if (message.type === "OFFSCREEN_PAD_GET") {
      const timePercent = message.timePercent ?? 100;
      if (!Number.isInteger(timePercent) || timePercent < 25 || timePercent > 400) throw new Error("Invalid pad time.");
      const record = await padTransaction("readonly", (store) => store.get(message.index));
      if (!record && timePercent === 100) return { success: true, pad: null };
      let blob = await readPadBlob(record);
      if (blob && record.trim && !message.original) {
        let bytes = await blob.arrayBuffer();
        if (record.schemaVersion !== 2 || record.kind !== "slice") {
          const context = new AudioContext({ sampleRate: record.sampleRate || 48000 });
          try {
            const decoded = await context.decodeAudioData(bytes);
            bytes = SCDownload.encodeWavSegment(decoded, { startMs: 0, endMs: decoded.duration * 1000 }).buffer;
          } finally { await context.close(); }
        }
        blob = new Blob([SCSamplerCore.cropWav(bytes, record.trim.startMs, record.trim.endMs)], { type: "audio/wav" });
      }
      if (timePercent !== 100 && !message.original) {
        if (!blob) {
          const samples = ["kick1", "clap1", "hat1", "kick2", "snare1", "tom1", "clap2", "hat2"];
          const response = await fetch(chrome.runtime.getURL(`assets/drums/${samples[message.index]}.wav`));
          if (!response.ok) throw new Error("Could not load the default sample.");
          blob = await response.blob();
        }
        blob = await renderPadTime(blob, timePercent);
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { success: true, pad: { index: message.index, name: record?.name || "", dataUrl, trim: record?.trim, originalTrim: record?.originalTrim,
        sourceDurationMs: record?.sourceDurationMs, updatedAt: record?.updatedAt, audioId: record?.audioId } };
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
  if (["OFFSCREEN_SLICES_BEGIN", "OFFSCREEN_SLICES_RENDER", "OFFSCREEN_SLICES_COMMIT", "OFFSCREEN_SLICES_CANCEL"].includes(message.type)) {
    SCSamplerSlices.handle(message, openPadDatabase).then(result => {
      sendResponse(result);
      if (message.type === "OFFSCREEN_SLICES_COMMIT") prunePadSources().catch(console.warn);
    }).catch(error =>
      sendResponse({ success: false, code: "slice_failed", error: error?.message || "Could not prepare the slices." }));
    return true;
  }
  if (["OFFSCREEN_SAMPLER_PRESET_LIST", "OFFSCREEN_SAMPLER_PRESET_SAVE", "OFFSCREEN_SAMPLER_PRESET_LOAD", "OFFSCREEN_SAMPLER_PRESET_DELETE", "OFFSCREEN_SAMPLER_PRESET_RENDER",
      "OFFSCREEN_PAD_LIST", "OFFSCREEN_PAD_DELETE", "OFFSCREEN_PAD_GET", "OFFSCREEN_PAD_TRIM", "OFFSCREEN_PAD_STORE", "OFFSCREEN_PAD_RENDER",
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
    promise.then(result => {
      sendResponse(result);
      if (["OFFSCREEN_PAD_DELETE", "OFFSCREEN_PAD_STORE", "OFFSCREEN_PAD_RENDER",
        "OFFSCREEN_SAMPLER_PRESET_DELETE", "OFFSCREEN_SAMPLER_PRESET_LOAD"].includes(message.type)) {
        prunePadSources().catch(console.warn);
      }
    });
    return true;
  }
  if (message.type === "OFFSCREEN_WAVEFORM") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000);
    SCDownload.buildTrackBlob(message.streamUrl, message.trackData, null, controller.signal, null, null, null, false, true)
      .then(sendResponse).catch(error => sendResponse({ success: false, error: error.message, status: error.status }))
      .finally(() => clearTimeout(timeout));
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
