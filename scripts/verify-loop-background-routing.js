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
const instrumentRenders = [];
const instrumentCancels = [];
const sliceMessages = [];
const sliceRenders = [];
const sessionState = {};
let instrumentRenderBlocker = null;
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
    async padMessage(message) {
      sliceMessages.push(message);
      return { success: true, state: "pending" };
    },
    async renderLoopSlices(...args) { sliceRenders.push(args); return { success: true, state: "prepared" }; },
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
    async renderLoopInstrument(...args) {
      instrumentRenders.push(args);
      if (instrumentRenderBlocker) await instrumentRenderBlocker.promise;
      if (args[6]?.fullTrack) {
        await args[6].onChunk({ offset: 0, byteLength: 4, dataUrl: "data:audio/wav;base64,UklGRg==" });
        return { success: true, instrument: { fullTrack: true, byteLength: 4 } };
      }
      return { success: true, instrument: { name: args[4], dataUrl: "data:audio/wav;base64,UklGRg==" } };
    },
    async cancelLoopInstrument(operationId) {
      instrumentCancels.push(operationId);
      instrumentRenderBlocker?.reject(Object.assign(new Error("Instrument preparation cancelled."), {
        code: "instrument_cancelled", name: "AbortError",
      }));
      return { success: true, cancelled: true };
    },
  },
  chrome: {
    storage: {
      local: { async get() { return {}; }, async set() {}, async setAccessLevel() {} },
      sync: { async get() { return {}; } },
      session: {
        async get(key) { return { [key]: structuredClone(sessionState[key]) }; },
        async set(value) { Object.assign(sessionState, structuredClone(value)); },
      },
    },
    runtime: {
      id: "test-extension",
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
        if (callback) callback({ success: true, trackData: resolvedTrack });
        else return Promise.resolve({ success: true });
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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

  const instrument = await dispatch({
    type: "RENDER_LOOP_INSTRUMENT",
    operationId: "instrument_routing_001",
    trackUrl: "https://soundcloud.com/artist/track",
    trimRange,
    playbackTransform,
    effects,
    name: "Loop Instrument",
  }, { id: "test-extension", tab: { id: 42 }, url: "https://soundcloud.com/artist/track" });
  assert.equal(instrument.success, true, JSON.stringify(instrument));
  assert.equal(instrumentRenders.length, 1);
  assert.equal(instrumentRenders[0][0], resolvedTrack);
  assert.deepEqual(instrumentRenders[0][1], trimRange);
  assert.deepEqual(instrumentRenders[0][2], playbackTransform);
  assert.deepEqual(instrumentRenders[0][3], effects);
  assert.equal(instrumentRenders[0][4], "Loop Instrument");
  assert.equal(instrumentRenders[0][5], "instrument_routing_001");

  instrumentRenderBlocker = deferred();
  const cancellableRequest = {
    type: "RENDER_LOOP_INSTRUMENT",
    operationId: "instrument_routing_cancel_001",
    trackUrl: "https://soundcloud.com/artist/track",
    trimRange,
    playbackTransform,
    effects,
    name: "Cancellable Instrument",
  };
  const owner = { id: "test-extension", tab: { id: 42 }, frameId: 0, documentId: "document-a",
    url: "https://soundcloud.com/artist/track" };
  const firstRender = dispatch(cancellableRequest, owner);
  const duplicateRender = dispatch({ ...cancellableRequest }, owner);
  while (instrumentRenders.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instrumentRenders.length, 2, "duplicate request must share one render");
  const foreignCancel = await dispatch({ type: "CANCEL_LOOP_INSTRUMENT",
    operationId: cancellableRequest.operationId }, { ...owner, tab: { id: 43 }, documentId: "document-b" });
  assert.equal(foreignCancel.code, "unknown_operation");
  assert.equal(instrumentCancels.length, 0, "another tab cannot cancel the operation");
  const ownCancel = await dispatch({ type: "CANCEL_LOOP_INSTRUMENT",
    operationId: cancellableRequest.operationId }, owner);
  assert.equal(ownCancel.cancelled, true);
  assert.deepEqual(instrumentCancels, [cancellableRequest.operationId]);
  assert.equal((await firstRender).code, "instrument_cancelled");
  assert.equal((await duplicateRender).code, "instrument_cancelled");
  instrumentRenderBlocker = null;

  const fullTrack = await dispatch({
    type: "RENDER_LOOP_INSTRUMENT", operationId: "instrument_full_track_routing_001", fullTrack: true,
    trackUrl: "https://soundcloud.com/artist/track",
    trimRange: { startMs: 0, endMs: 240000, durationMs: 240000 },
    playbackTransform, effects, name: "Editable sample",
  }, owner);
  assert.equal(fullTrack.success, true, JSON.stringify(fullTrack));
  assert.equal(instrumentRenders.at(-1)[6].fullTrack, true, "full instruments bypass the pad-only 30 second limit");
  const transferred = tabMessages.find(entry => entry.message.type === "LOOP_INSTRUMENT_CHUNK");
  assert.equal(transferred.tabId, 42);
  assert.equal(transferred.options.documentId, "document-a", "audio is sent only to the requesting document");
  assert.equal(transferred.message.operationId, "instrument_full_track_routing_001");
  const padLimit = await new Promise(resolve => messageListener({
    type: "RENDER_LOOP_PAD", index: 0, fullTrack: true,
    trimRange: { startMs: 0, endMs: 240000 }, playbackTransform,
  }, owner, resolve));
  assert.equal(padLimit.success, false, "fullTrack cannot bypass pad duration limits");

  const sliceRequest = { type: "RENDER_LOOP_SLICES", operationId: "pad_slice_routing_001", count: 8,
    trackUrl: "https://soundcloud.com/artist/track", trackIdentity: "permalink:https://soundcloud.com/artist/track", generation: 1,
    trimRange, playbackTransform, effects: { reverb: 20, unknown: "ignored" }, name: "Selected" };
  assert.equal((await dispatch(sliceRequest, owner)).success, true);
  assert.equal(sliceRenders.length, 1);
  const begun = sliceMessages.find(message => message.type === "OFFSCREEN_SLICES_BEGIN");
  assert.equal(begun.input.count, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(begun.input.trimRange)), trimRange);
  assert.equal(begun.input.effects.unknown, undefined, "only allowlisted effects cross the renderer boundary");
  assert.equal(begun.input.effects.reverb, 20);
  assert.equal(JSON.parse(begun.owner).documentId, owner.documentId);
  for (const change of [{ count: 6 }, { generation: -1 }, { trackIdentity: "another-track" },
    { trimRange: { ...trimRange, startMs: -1 } }, { trimRange: { startMs: 0, endMs: 31000, durationMs: 90000 }, playbackTransform: { rate: 1 } },
    { effects: { delay: NaN } }]) {
    assert.equal((await dispatch({ ...sliceRequest, ...change }, owner)).success, false);
  }
  assert.equal(sliceRenders.length, 1, "invalid slice requests never render");
  await dispatch({ type: "COMMIT_LOOP_SLICES", operationId: sliceRequest.operationId }, owner);
  assert.equal(sliceMessages.at(-1).type, "OFFSCREEN_SLICES_COMMIT");
  await dispatch({ type: "CANCEL_LOOP_SLICES", operationId: sliceRequest.operationId }, owner);
  assert.equal(sliceMessages.at(-1).type, "OFFSCREEN_SLICES_CANCEL");
  for (const index of [6, 7]) {
    assert.equal((await dispatch({ type: "GET_LOOP_PAD_AUDIO", index }, owner)).success, true);
    assert.equal(sliceMessages.at(-1).index, index);
  }
  const deleteOperation = "pad_delete_routing_test";
  assert.equal((await dispatch({ type: "DELETE_LOOP_PAD_AUDIO", index: 7, operationId: deleteOperation }, owner)).success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(sliceMessages.at(-1))), {
    type: "OFFSCREEN_PAD_DELETE", index: 7, operationId: deleteOperation,
  });
  const invalidDelete = await new Promise(resolve => messageListener({ type: "DELETE_LOOP_PAD_AUDIO", index: 8, operationId: deleteOperation }, owner, resolve));
  assert.equal(invalidDelete.success, false);
  const invalidPad = await new Promise(resolve => messageListener({ type: "GET_LOOP_PAD_AUDIO", index: 8 }, owner, resolve));
  assert.equal(invalidPad.success, false);

  console.log("Loop background routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
