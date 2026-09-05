const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let messageListener = null;
const progressCalls = [];

const manager = {
  KEEPALIVE_ALARM: "keepalive",
  reportBuildProgress(buildId, statusText) {
    progressCalls.push({ buildId, statusText });
    return Promise.resolve(true);
  },
  recoverRunningJob() {},
  ensureJobRunning: async () => {},
  getStatus: async () => {
    throw new Error("storage unavailable");
  },
};

const context = vm.createContext({
  console,
  URL,
  fetch: async () => {},
  importScripts() {},
  BulkJobManager: manager,
  SCDownloadTrack: { migrate: (value) => value },
  SCDownloadSource: {
    configure: () => ({
      resolveStream: async () => ({}),
      resolveOriginal: async () => ({}),
      resolveLoggedInUser: async () => ({}),
      refresh: async () => ({}),
    }),
  },
  chrome: {
    cookies: { get() {} },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    alarms: { onAlarm: { addListener() {} } },
  },
});

const source = fs.readFileSync(path.resolve(__dirname, "background.js"), "utf8");
vm.runInContext(source, context, { filename: "background.js" });

(async () => {
  assert.equal(typeof messageListener, "function");
  const response = await new Promise((resolve) => {
    const keepChannelOpen = messageListener(
      {
        type: "OFFSCREEN_BUILD_PROGRESS",
        buildId: "build-7",
        statusText: "Downloading 7/12 parts...",
      },
      {},
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.deepEqual(progressCalls, [
    { buildId: "build-7", statusText: "Downloading 7/12 parts..." },
  ]);
  assert.equal(response.success, true);
  assert.equal(response.handled, true);

  const errorResponse = await new Promise((resolve) => {
    const keepChannelOpen = messageListener({ type: "GET_JOB_STATUS" }, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });
  assert.equal(errorResponse.success, false);
  assert.equal(errorResponse.error, "storage unavailable");
  console.log("Background progress routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
