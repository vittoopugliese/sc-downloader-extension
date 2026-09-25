const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let messageListener = null;
let intervalCallback = null;
let intervalDelay = null;
const messages = [];

const context = vm.createContext({
  console,
  AbortController,
  URL: {
    createObjectURL: () => "blob:test",
    revokeObjectURL() {},
  },
  setInterval(callback, delay) {
    intervalCallback = callback;
    intervalDelay = delay;
    return 1;
  },
  clearInterval() {},
  chrome: {
    runtime: {
      id: "test-extension",
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      sendMessage(message) {
        messages.push(message);
        return Promise.resolve({ success: true });
      },
    },
  },
  SCDownload: {
    buildTrackBlob(_streamUrl, _trackData, onProgress) {
      assert.equal(
        typeof onProgress,
        "function",
        "Offscreen must wire build progress"
      );
      onProgress("Downloading 1/2 parts...");
      return new Promise(() => {});
    },
  },
  SCDownloadDirectory: {},
});

const source = fs.readFileSync(path.resolve(__dirname, "offscreen.js"), "utf8");
vm.runInContext(source, context, { filename: "offscreen.js" });

assert.equal(typeof messageListener, "function", "Offscreen message listener must register");
let unrelatedResponse;
assert.equal(messageListener(
  { type: "RESTORE_PLAYER_TOOLS_LICENSE" },
  { id: "test-extension", url: "chrome-extension://test-extension/popup.html" },
  (value) => { unrelatedResponse = value; }
), false, "Offscreen must ignore messages that belong to another extension context");
assert.equal(unrelatedResponse, undefined,
  "Offscreen must not race the service worker response for popup messages");
messageListener(
  {
    type: "OFFSCREEN_BUILD",
    buildId: "track_long_track_0",
    streamUrl: "https://example.com/audio.m3u8",
    trackData: { streamProtocol: "hls" },
  },
  { id: "test-extension", url: "chrome-extension://test-extension/scripts/background.js" },
  () => {}
);

assert.equal(typeof intervalCallback, "function", "Long builds must schedule a service-worker keepalive");
assert.ok(intervalDelay <= 15000, `Keepalive interval is too slow: ${intervalDelay}ms`);
assert.equal(messages[0].type, "OFFSCREEN_BUILD_PROGRESS");
assert.equal(messages[0].buildId, "track_long_track_0");
assert.equal(messages[0].statusText, "Downloading 1/2 parts...");
intervalCallback();
assert.equal(messages.length, 2);
assert.equal(messages[1].type, "OFFSCREEN_KEEPALIVE");
assert.equal(messages[1].buildId, "track_long_track_0");

console.log("Offscreen keepalive verification passed.");
