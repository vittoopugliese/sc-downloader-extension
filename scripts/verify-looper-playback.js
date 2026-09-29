const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noOp = () => {};
const coreContext = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "looper-core.js"), "utf8"),
  coreContext
);
const core = vm.runInContext("SCLooperCore", coreContext);

let nowMs = 0;
const windowStub = {
  location: {
    href: "https://soundcloud.com/artist/track",
    origin: "https://soundcloud.com",
    pathname: "/artist/track",
  },
  addEventListener: noOp,
  removeEventListener: noOp,
};
const documentStub = {
  body: {},
  documentElement: { setAttribute: noOp },
  addEventListener: noOp,
  removeEventListener: noOp,
  querySelector: () => null,
  querySelectorAll: () => [],
};
const context = vm.createContext({
  console,
  URL,
  document: documentStub,
  window: windowStub,
  performance: { now: () => nowMs },
  SCLooperCore: core,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: noOp,
});

const source = fs
  .readFileSync(path.resolve(__dirname, "looper.js"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(
    "  const looper = { ensureMounted: runEnsureMounted, reset, getState };",
    `  globalThis.__setPlaybackFixture = (fixturePlayer, fixtureRange) => {
      player = fixturePlayer;
      range = fixtureRange;
      initialUrl = window.location.href;
      initialTrackIdentity = null;
      lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
      lastTrackIdentityCheckAt = Number.NEGATIVE_INFINITY;
      frameId = null;
    };
    globalThis.__runLoopFrame = loopFrame;
    const looper = { ensureMounted: runEnsureMounted, reset, getState };`
  )
  .replace(
    '  if (document.body) startLifecycle();\n  else document.addEventListener("DOMContentLoaded", startLifecycle, { once: true });',
    ""
  );
vm.runInContext(source, context);

let seekAttempts = 0;
const ignoredSeekPlayer = {
  getCurrentTimeMs: () => 3000,
  getTrackIdentity: () => null,
  seekToMs: () => {
    seekAttempts += 1;
    return true;
  },
};
const range = { startMs: 1000, endMs: 3000, durationMs: 10000 };

const setPlaybackFixture = vm.runInContext("__setPlaybackFixture", context);
const runLoopFrame = vm.runInContext("__runLoopFrame", context);

let identityChecks = 0;
setPlaybackFixture({
  getCurrentTimeMs: () => 2000,
  getTrackIdentity: () => {
    identityChecks += 1;
    return null;
  },
  seekToMs: noOp,
}, range);
for (let frame = 0; frame < 20; frame += 1) runLoopFrame();
assert.equal(
  identityChecks,
  1,
  "Track identity discovery must not query the DOM on every animation frame"
);
nowMs = 501;
runLoopFrame();
assert.equal(
  identityChecks,
  2,
  "Track identity discovery must run again after the throttle interval"
);

nowMs = 0;
setPlaybackFixture(ignoredSeekPlayer, range);
runLoopFrame();
nowMs = 500;
runLoopFrame();

assert.equal(seekAttempts, 0, "The waveform must never enforce playback directly");

let currentTimeMs = range.endMs;
let completedLoops = 0;
const workingPlayer = {
  getCurrentTimeMs: () => currentTimeMs,
  getTrackIdentity: () => null,
  seekToMs: (timeMs) => {
    completedLoops += 1;
    currentTimeMs = timeMs;
    return true;
  },
};

setPlaybackFixture(workingPlayer, range);
for (let cycle = 0; cycle < 10; cycle += 1) {
  currentTimeMs = range.endMs;
  runLoopFrame();
  runLoopFrame();
}
assert.equal(completedLoops, 0, "The MAIN bridge, not the waveform, owns loop seeks");

console.log("Looper playback verification passed.");
