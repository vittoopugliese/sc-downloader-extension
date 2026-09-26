const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const downloadCalls = [];
const offscreenMessages = [];
let storedDestination = { id: "stored-id", name: "Stored Music" };
const operations = new Map();

const context = vm.createContext({
  console,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  SCDownloadDirectory: {
    getCurrent: async () => storedDestination,
  },
  SCBulkLibrary: {
    getActiveJob: async () => null,
    async beginOperation(operationId, signature) {
      const id = operationId || `track_test_${operations.size + 1}`;
      const existing = operations.get(id);
      if (existing) {
        if (existing.signature !== signature) throw Object.assign(new Error("operation conflict"), { code: "operation_conflict" });
        return { ...existing, isNew: false };
      }
      const operation = { operationId: id, signature, state: "resolving", stage: "resolving", result: null };
      operations.set(id, operation);
      return { ...operation, isNew: true };
    },
    async updateOperation(operationId, update) {
      const next = { ...operations.get(operationId), ...update };
      operations.set(operationId, next);
      return { ...next };
    },
    async getOperation(operationId) { return operations.get(operationId) || null; },
    async getOperationsByState(states) {
      const wanted = new Set(states);
      return [...operations.values()].filter((operation) => wanted.has(operation.state));
    },
  },
  SCStreamSelector: {
    extractStreamInfo: () => null,
    getStreamFormatLabel: () => null,
    getAvailableFormats: () => ({}),
    shouldPreferOriginal: (track, preference = "auto") =>
      (preference === "auto" || preference === "original") &&
      track.downloadable === true &&
      track.hasDownloadsLeft !== false &&
      Boolean(track.id),
  },
  chrome: {
    runtime: {
      getURL: (value) => value,
      getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
      sendMessage(message, callback) {
        offscreenMessages.push(message);
        if (message.type === "OFFSCREEN_BUILD") {
          callback({
            success: true,
            blobUrl: "blob:test-audio",
            fileName: "Исполнитель - Песня.mp3",
          });
          return;
        }
        if (message.type === "OFFSCREEN_SAVE_TO_DIRECTORY") {
          callback({ success: true, fileName: message.fileName });
          return;
        }
        callback({ success: true });
      },
    },
    storage: {
      local: {
        get: async () => ({}),
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    downloads: {
      download(options, callback) {
        downloadCalls.push(options);
        callback(downloadCalls.length);
      },
      search(_query, callback) {
        callback([{ state: "complete" }]);
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
    },
    offscreen: {
      closeDocument: async () => {},
    },
  },
});

for (const relativePath of [
  "scripts/format-utils.js",
  "scripts/soundcloud-http.js",
  "scripts/download-track.js",
  "scripts/download-source.js",
  "scripts/download-destination.js",
  "scripts/track-download-execution.js",
  "scripts/bulk-job-manager.js",
]) {
  const filePath = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
    filename: filePath,
  });
}

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

(async () => {
  evaluate(`SCDownloadSource.configure({
    getDownloadPolicy: async () => ({ allDownloadsActivated: true }),
    request: async () => ({ ok: true, json: async () => ({ url: "https://example.com/audio.mp3" }) }),
    getOAuthToken: async () => { throw new Error("No session"); }
  })`);

  await evaluate(`BulkJobManager.downloadSingleTrack(
    { id: 1, artist: "Исполнитель", title: "Песня", streamUrl: "https://api-v2.soundcloud.com/media/soundcloud:tracks:123/stream", clientId: "client" },
    "auto",
    { id: "chosen-id", name: "Chosen Music" }
  )`);
  const explicitSave = offscreenMessages.find(
    (message) => message.type === "OFFSCREEN_SAVE_TO_DIRECTORY"
  );
  assertEqual(explicitSave.directoryId, "chosen-id", "Explicit folder handle");
  assertEqual(explicitSave.fileName, "Исполнитель - Песня.mp3", "Unicode filename");
  assertEqual(downloadCalls.length, 0, "Custom folder bypasses chrome.downloads");

  offscreenMessages.length = 0;
  await evaluate(`BulkJobManager.downloadSingleTrack(
    { id: 2, artist: "Artist", title: "Title", streamUrl: "https://api-v2.soundcloud.com/media/soundcloud:tracks:123/stream", clientId: "client" },
    "auto"
  )`);
  const storedSave = offscreenMessages.find(
    (message) => message.type === "OFFSCREEN_SAVE_TO_DIRECTORY"
  );
  assertEqual(storedSave.directoryId, "stored-id", "Remembered folder handle");

  storedDestination = null;
  await evaluate(`BulkJobManager.downloadSingleTrack(
    { id: 3, artist: "Artist", title: "Title", streamUrl: "https://api-v2.soundcloud.com/media/soundcloud:tracks:123/stream", clientId: "client" },
    "auto"
  )`);
  assertEqual(downloadCalls.length, 1, "Default Downloads fallback");
  assertEqual(downloadCalls[0].filename, "Исполнитель - Песня.mp3", "Default filename");
  assertEqual(downloadCalls[0].saveAs, false, "Default download must not prompt per file");
  assertEqual(downloadCalls[0].conflictAction, "uniquify", "Duplicates must be preserved");
  const browserOperation = [...operations.values()].find((operation) => operation.downloadId === 1);
  assertEqual(browserOperation.state, "completed", "Browser save reaches a durable terminal state");
  assertEqual(browserOperation.result.success, true, "Successful browser save is persisted");

  offscreenMessages.length = 0;
  await evaluate(`BulkJobManager.downloadLoop(
    { id: 4, artist: "Artist", title: "Loop Track", streamUrl: "https://api-v2.soundcloud.com/media/soundcloud:tracks:123/stream", clientId: "client" },
    "auto",
    { startMs: 1500, endMs: 7250, durationMs: 10000 }
  )`);
  const loopBuild = offscreenMessages.find(
    (message) => message.type === "OFFSCREEN_BUILD"
  );
  assertEqual(loopBuild.trimRange.startMs, 1500, "Loop start forwarded to builder");
  assertEqual(loopBuild.trimRange.endMs, 7250, "Loop end forwarded to builder");

  operations.set("track_recover_resolving", { operationId: "track_recover_resolving", signature: "a", state: "resolving" });
  operations.set("track_recover_download", { operationId: "track_recover_download", signature: "b", state: "download_started", downloadId: 77 });
  operations.set("track_recover_folder", { operationId: "track_recover_folder", signature: "c", state: "save_requested", saveKind: "directory" });
  await evaluate("BulkJobManager.recoverDirectOperations()");
  assertEqual(operations.get("track_recover_resolving").state, "failed", "Pre-save restart is safely retryable");
  assertEqual(operations.get("track_recover_resolving").result.code, "interrupted_before_save", "Pre-save restart is not ambiguous");
  assertEqual(operations.get("track_recover_download").state, "completed", "Known Chrome download is reconciled");
  assertEqual(operations.get("track_recover_folder").state, "ambiguous_save", "Folder save request remains ambiguous");

  console.log("Download routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
