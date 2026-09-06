const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const messages = [];
let runtimeResponse = { success: true };
const noOp = () => {};
const documentStub = {
  body: {},
  head: { appendChild: noOp },
  documentElement: { setAttribute: noOp },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noOp,
  removeEventListener: noOp,
};
const windowStub = {
  location: {
    href: "https://w.soundcloud.com/player/frame",
    origin: "https://w.soundcloud.com",
    pathname: "/player/frame",
  },
  addEventListener: noOp,
  removeEventListener: noOp,
};
windowStub.top = windowStub;

const context = vm.createContext({
  console: { ...console, error: noOp },
  URL,
  document: documentStub,
  window: windowStub,
  globalThis: {},
  SCLooperCore: { MIN_RANGE_MS: 250 },
  chrome: {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        return runtimeResponse;
      },
      getURL(value) {
        return `chrome-extension://test/${value}`;
      },
    },
  },
  setTimeout: () => 1,
  clearTimeout: noOp,
  setInterval: () => 1,
  clearInterval: noOp,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: noOp,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
});

const source = fs
  .readFileSync(path.resolve(__dirname, "looper.js"), "utf8")
  .replace(
    "  const looper = { ensureMounted: runEnsureMounted, reset, getState };",
    `  globalThis.__setLoopDownloadFixture = (nextRange, identity) => {
      range = nextRange;
      initialTrackIdentity = identity;
    };
    globalThis.__handleLoopDownloadClick = handleDownloadClick;
    const looper = { ensureMounted: runEnsureMounted, reset, getState };`
  )
  .replace(
    '  if (document.body) startLifecycle();\n  else document.addEventListener("DOMContentLoaded", startLifecycle, { once: true });',
    ""
  );
vm.runInContext(source, context, { filename: "looper.js" });

const setFixture = vm.runInContext("globalThis.__setLoopDownloadFixture", context);
const click = vm.runInContext("globalThis.__handleLoopDownloadClick", context);
setFixture(
  { startMs: 1000, endMs: 4000, durationMs: 10000 },
  "url:https://soundcloud.com/artist/track"
);

const button = {
  textContent: "",
  dataset: {},
  classList: {
    toggle: noOp,
  },
  disabled: false,
  hidden: false,
  title: "",
  isConnected: true,
  setAttribute: noOp,
};

(async () => {
  await click({
    currentTarget: button,
    preventDefault: noOp,
    stopPropagation: noOp,
  });

  assert.equal(
    messages.length,
    1,
    "A loop click from SoundCloud's player frame must reach the background"
  );
  assert.equal(messages[0].type, "DOWNLOAD_LOOP");
  assert.equal(
    messages[0].trackUrl,
    "https://soundcloud.com/artist/track"
  );

  runtimeResponse = { success: false, error: "Download failed" };
  await click({
    currentTarget: button,
    preventDefault: noOp,
    stopPropagation: noOp,
  });
  assert.equal(button.dataset.scdlLoopDownloadState, "error");
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "", "Errors must not replace the arrow with text");

  const looperSource = fs.readFileSync(
    path.resolve(__dirname, "looper.js"),
    "utf8"
  );
  assert.match(looperSource, /assets\/icons\/download\.svg/);
  console.log("Loop click verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
