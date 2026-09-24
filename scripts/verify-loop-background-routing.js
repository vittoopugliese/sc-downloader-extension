const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const policy = require("./player-tools-policy.js");
const { create, STORAGE_KEY } = require("./player-tools-access.js");
let accessState = policy.normalize();
accessState.entitlement = { status: "active", licenseId: "license-1", checkedAt: Date.now(), expiresAt: Date.now() + 60_000 };
const access = create({ storage: {
  async get() { return { [STORAGE_KEY]: structuredClone(accessState) }; },
  async set(value) { accessState = structuredClone(value[STORAGE_KEY]); },
} });

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
  SCPlayerToolsAccess: access,
  SCPlayerToolsCommerce: {
    LICENSE_REVALIDATION_ALARM: "license-revalidation",
    create: () => ({
      async getState() { return { status: "active" }; },
      async startTrial() { return {}; },
      async consumeTrial() { return {}; },
      async validateEntitlement() { return true; },
      async ensureEntitlement(entitlement) { return { status: "active", entitlement }; },
      async validateTrial() { return { status: "valid" }; },
      async track() { return true; },
    }),
  },
  BulkJobManager: {
    KEEPALIVE_ALARM: "keepalive",
    recoverRunningJob: async () => {},
    ensureJobRunning: async () => {},
    reportBuildProgress: async () => true,
    async downloadSingleTrack(...args) {
      downloads.push(args);
      return { success: true };
    },
    async createJob(...args) {
      downloads.push(args);
      return { id: "original-bulk" };
    },
    async downloadLoop(...args) {
      downloads.push(args);
      return { success: true, fileName: "Artist - Track (loop).wav" };
    },
  },
  chrome: {
    storage: {
      local: { async get() { return {}; }, async set() {}, async setAccessLevel() {} },
      sync: { async get() { return {}; } },
      session: { async get() { return {}; }, async set() {} },
    },
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "test" }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    alarms: { async create() {}, async clear() {}, onAlarm: { addListener() {} } },
    cookies: { get() {} },
    tabs: {
      onRemoved: { addListener() {} },
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
  const playbackTransform = { rate: 0.85, preservePitch: true };
  const response = await dispatch(
    {
      type: "DOWNLOAD_LOOP",
      trackData: null,
      trackUrl: "https://soundcloud.com/artist/track",
      trimRange,
      playbackTransform,
    },
    { tab: { id: 42 } }
  );

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0].tabId, 42);
  assert.equal(tabMessages[0].options.frameId, 0);
  assert.equal(tabMessages[0].message.type, "RESOLVE_LOOP_TRACK_DATA");
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0][0], resolvedTrack);
  assert.deepEqual(downloads[0][2], trimRange);
  assert.deepEqual(downloads[0][3], playbackTransform);

  accessState.entitlement = { status: "free" };
  accessState.trial.used = 20;
  const deniedLoop = await dispatch({ type: "DOWNLOAD_LOOP", trackUrl: "https://soundcloud.com/artist/track",
    trimRange, playbackTransform: { rate: 1 } }, { tab: { id: 42 } });
  assert.equal(deniedLoop.code, "pro-required");
  assert.equal(tabMessages.length, 1, "denial precedes track resolution");
  assert.equal(downloads.length, 1, "denial precedes processing");
  const deniedTrack = await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack,
    playbackTransform }, {});
  assert.equal(deniedTrack.code, "pro-required");
  assert.equal(downloads.length, 1);
  const deniedEqTrack = await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack,
    playbackTransform: { rate: 1 }, effects: { eq: { enabled: true, bands: [{ frequency: 1000, gain: 6, q: 1 }] } } }, {});
  assert.equal(deniedEqTrack.code, "pro-required", "EQ-only export must be authorized as Pro");
  assert.equal(downloads.length, 1);
  const deniedColorTrack = await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack,
    playbackTransform: { rate: 1 }, effects: { saturation: 25, saturationDrive: 40 } }, {});
  assert.equal(deniedColorTrack.code, "pro-required", "New FX-only exports must be authorized as Pro");
  assert.equal(downloads.length, 1);
  const original = await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack }, {});
  assert.equal(original.success, true);
  const neutral = await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack,
    playbackTransform: { rate: 1, preservePitch: true } }, {});
  assert.equal(neutral.success, true);
  const bulk = await dispatch({ type: "START_BULK_JOB", tracks: [resolvedTrack], playbackTransform }, {});
  assert.equal(bulk.success, true);
  assert.equal(downloads.at(-1).includes(playbackTransform), false, "bulk never inherits effects");
  accessState.entitlement = { status: "active", licenseId: "license-1", checkedAt: Date.now(), expiresAt: Date.now() + 60_000 };
  const effects = { eq: { enabled: true, bands: [{ frequency: 1000, gain: 6, q: 1 }] } };
  assert.equal((await dispatch({ type: "DOWNLOAD_SINGLE_TRACK", trackData: resolvedTrack, playbackTransform, effects }, {})).success, true);
  assert.deepEqual(downloads.at(-1)[4], effects, "Authorized EQ settings must reach the audio build path");

  console.log("Loop background routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
