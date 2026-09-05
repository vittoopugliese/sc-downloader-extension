const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let messageListener = null;
const tabMessages = [];
const downloads = [];
const resolvedTrack = {
  id: 7,
  title: "Track",
  streamUrl: "https://api.test/stream",
  clientId: "client",
};

const context = vm.createContext({
  console,
  URL,
  importScripts() {},
  SCDownloadSource: {
    configure: () => ({}),
  },
  SCDownloadTrack: {
    canDownload: (track) => Boolean(track?.streamUrl),
    migrate: (track) => track,
  },
  BulkJobManager: {
    KEEPALIVE_ALARM: "keepalive",
    recoverRunningJob: async () => {},
    ensureJobRunning: async () => {},
    reportBuildProgress: async () => true,
    async downloadLoop(...args) {
      downloads.push(args);
      return { success: true, fileName: "Artist - Track (loop).wav" };
    },
  },
  chrome: {
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    alarms: { onAlarm: { addListener() {} } },
    cookies: { get() {} },
    tabs: {
      sendMessage(tabId, message, options, callback) {
        tabMessages.push({ tabId, message, options });
        callback({ success: true, trackData: resolvedTrack });
      },
    },
    action: {},
  },
});

vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "background.js"), "utf8"),
  context,
  { filename: "background.js" }
);

function dispatch(request, sender) {
  return new Promise((resolve, reject) => {
    const handled = messageListener(request, sender, resolve);
    if (handled !== true) reject(new Error("Background did not keep the response open"));
  });
}

(async () => {
  const trimRange = { startMs: 1000, endMs: 4000, durationMs: 10000 };
  const response = await dispatch(
    {
      type: "DOWNLOAD_LOOP",
      trackData: null,
      trackUrl: "https://soundcloud.com/artist/track",
      trimRange,
    },
    { tab: { id: 42 } }
  );

  assert.equal(response.success, true);
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0].tabId, 42);
  assert.equal(tabMessages[0].options.frameId, 0);
  assert.equal(tabMessages[0].message.type, "RESOLVE_LOOP_TRACK_DATA");
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0][0], resolvedTrack);
  assert.deepEqual(downloads[0][2], trimRange);

  console.log("Loop background routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
