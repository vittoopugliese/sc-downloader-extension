const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const downloadCalls = [];
const offscreenMessages = [];
let rememberedDirectory = { id: "remembered-id", name: "Remembered Music" };

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {},
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
  },
});

const source = fs.readFileSync(
  path.resolve(__dirname, "download-destination.js"),
  "utf8"
);
vm.runInContext(source, context, { filename: "download-destination.js" });

const destination = vm.runInContext("SCDownloadDestination.create", context)({
  chromeApi: context.chrome,
  getRememberedDirectory: async () => rememberedDirectory,
  async sendOffscreenMessage(message) {
    offscreenMessages.push(message);
    return { success: true, fileName: `saved-${message.fileName}` };
  },
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

(async () => {
  assert.deepEqual(
    plain(await destination.resolve({ id: "chosen", name: "Chosen" })),
    { id: "chosen", name: "Chosen" }
  );
  assert.deepEqual(plain(await destination.resolve()), rememberedDirectory);
  rememberedDirectory = { id: 4, name: "Invalid" };
  assert.equal(await destination.resolve(), null);

  const directoryResult = await destination.save({
    blobUrl: "blob:directory",
    fileName: "Artist - Track.mp3",
    destination: { id: "chosen", name: "Chosen" },
    collection: { folderName: "Set", trackNumber: 3, totalTracks: 12 },
  });
  assert.deepEqual(plain(offscreenMessages[0]), {
    type: "OFFSCREEN_SAVE_TO_DIRECTORY",
    blobUrl: "blob:directory",
    fileName: "03 - Artist - Track.mp3",
    directoryId: "chosen",
  });
  assert.deepEqual(plain(directoryResult), {
    fileName: "saved-03 - Artist - Track.mp3",
    destinationName: "Chosen",
  });

  const browserResult = await destination.save({
    blobUrl: "blob:downloads",
    fileName: "Artist - Track.mp3",
    collection: { folderName: "Set", trackNumber: 3, totalTracks: 120 },
  });
  assert.deepEqual(plain(downloadCalls[0]), {
    url: "blob:downloads",
    filename: "Set/003 - Artist - Track.mp3",
    saveAs: false,
    conflictAction: "uniquify",
  });
  assert.deepEqual(plain(browserResult), {
    fileName: "003 - Artist - Track.mp3",
    destinationName: "Downloads",
  });

  const interruptedChrome = {
    runtime: {},
    downloads: {
      download(_options, callback) {
        callback(7);
      },
      search(_query, callback) {
        callback([{ state: "interrupted" }]);
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
  };
  const interruptedDestination = vm.runInContext(
    "SCDownloadDestination.create",
    context
  )({
    chromeApi: interruptedChrome,
    getRememberedDirectory: async () => null,
    sendOffscreenMessage: async () => ({ success: true }),
  });
  await assert.rejects(
    interruptedDestination.save({
      blobUrl: "blob:interrupted",
      fileName: "Track.mp3",
    }),
    /Download was interrupted/
  );

  const rejectedDirectory = vm.runInContext(
    "SCDownloadDestination.create",
    context
  )({
    chromeApi: context.chrome,
    getRememberedDirectory: async () => null,
    sendOffscreenMessage: async () => ({
      success: false,
      error: "Folder access expired.",
    }),
  });
  await assert.rejects(
    rejectedDirectory.save({
      blobUrl: "blob:directory-error",
      fileName: "Track.mp3",
      destination: { id: "expired", name: "Expired" },
    }),
    /Folder access expired/
  );

  console.log("Download destination verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
