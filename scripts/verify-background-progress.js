const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let messageListener = null;
let cookieChangedListener = null;
const progressCalls = [];
const authChangeMessages = [];

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
      resolveLoggedInUser: async () => ({
        user: { id: 7, username: "Listener", permalink_url: "https://soundcloud.com/listener", oauthToken: "sentinel" },
        oauthToken: "sentinel",
      }),
      refresh: async () => ({}),
    }),
  },
  chrome: {
    tabs: {
      onRemoved: { addListener() {} },
      query: async () => [{ id: 4 }, { id: 5 }, { id: null }],
      sendMessage: async (tabId, message) => {
        authChangeMessages.push({ tabId, message });
        if (tabId === 5) throw new Error("No receiving end");
        return { success: true };
      },
    },
    cookies: {
      get() {},
      onChanged: { addListener(listener) { cookieChangedListener = listener; } },
    },
    runtime: {
      id: "test-extension",
      getURL: (path) => `chrome-extension://test-extension/${path}`,
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
  assert.equal(typeof cookieChangedListener, "function");
  cookieChangedListener({ cookie: { name: "oauth_token", domain: ".soundcloud.com" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(authChangeMessages)), [
    { tabId: 4, message: { type: "SOUNDCLOUD_AUTH_CHANGED" } },
    { tabId: 5, message: { type: "SOUNDCLOUD_AUTH_CHANGED" } },
  ]);
  const response = await new Promise((resolve) => {
    const keepChannelOpen = messageListener(
      {
        type: "OFFSCREEN_BUILD_PROGRESS",
        buildId: "build-7",
        statusText: "Downloading 7/12 parts...",
      },
      { id: "test-extension", url: "chrome-extension://test-extension/offscreen.html" },
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

  const profileResponse = await new Promise((resolve) => {
    const keepChannelOpen = messageListener(
      { type: "GET_LOGGED_IN_USER", clientId: "client" },
      { id: "test-extension", frameId: 0, tab: { id: 3, url: "https://soundcloud.com/you/likes" }, url: "https://soundcloud.com/you/likes" },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
  assert.equal(profileResponse.success, true);
  assert.equal(profileResponse.profile.user.id, 7);
  assert.equal(JSON.stringify(profileResponse).includes("sentinel"), false);

  let invalidSenderResponse;
  assert.equal(messageListener({ type: "GET_LOGGED_IN_USER", clientId: "client" }, {}, (value) => { invalidSenderResponse = value; }), false);
  assert.equal(invalidSenderResponse.code, "invalid_sender");
  console.log("Background progress routing verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
