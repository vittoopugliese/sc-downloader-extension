const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const downloadCalls = [];
const offscreenMessages = [];
let storedDestination = { id: "stored-id", name: "Stored Music" };

const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  SCDownloadDirectory: {
    getCurrent: async () => storedDestination,
  },
  SCStreamSelector: {
    resolveDownloadSource: async (trackData) => ({
      streamUrl: "https://example.com/audio.mp3",
      trackData,
    }),
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

for (const relativePath of ["scripts/format-utils.js", "scripts/bulk-job-manager.js"]) {
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
  evaluate(`BulkJobManager.setStreamDependencies({
    resolveStreamUrl: async () => ({ url: "https://example.com/audio.mp3" }),
    resolveOriginalDownload: async () => null,
    refreshTrackMetadata: async (trackData) => trackData
  })`);

  await evaluate(`BulkJobManager.downloadSingleTrack(
    { id: 1, artist: "Исполнитель", title: "Песня" },
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
    { id: 2, artist: "Artist", title: "Title" },
    "auto"
  )`);
  const storedSave = offscreenMessages.find(
    (message) => message.type === "OFFSCREEN_SAVE_TO_DIRECTORY"
  );
  assertEqual(storedSave.directoryId, "stored-id", "Remembered folder handle");

  storedDestination = null;
  await evaluate(`BulkJobManager.downloadSingleTrack(
    { id: 3, artist: "Artist", title: "Title" },
    "auto"
  )`);
  assertEqual(downloadCalls.length, 1, "Default Downloads fallback");
  assertEqual(downloadCalls[0].filename, "Исполнитель - Песня.mp3", "Default filename");
  assertEqual(downloadCalls[0].saveAs, false, "Default download must not prompt per file");
  assertEqual(downloadCalls[0].conflictAction, "uniquify", "Duplicates must be preserved");

  console.log("Download routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
