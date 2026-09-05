const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const coreContext = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "looper-core.js"), "utf8"),
  coreContext
);
const core = vm.runInContext("SCLooperCore", coreContext);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(core.createInitialRange(60000, 0)), {
  startMs: 0,
  endMs: 10000,
  durationMs: 60000,
});
assert.deepEqual(plain(core.createInitialRange(60000, 22500)), {
  startMs: 22500,
  endMs: 32500,
  durationMs: 60000,
});
assert.deepEqual(plain(core.createInitialRange(60000, 57500)), {
  startMs: 50000,
  endMs: 60000,
  durationMs: 60000,
});
assert.deepEqual(plain(core.createInitialRange(5000, 4900)), {
  startMs: 0,
  endMs: 5000,
  durationMs: 5000,
});
assert.equal(core.createInitialRange(249, 0), null);
assert.equal(core.createInitialRange(Number.NaN, 0), null);

const base = { startMs: 1000, endMs: 3000, durationMs: 5000 };
assert.equal(core.moveMarker(base, "start", -100).startMs, 0);
assert.equal(core.moveMarker(base, "start", 2900).startMs, 2750);
assert.equal(core.moveMarker(base, "end", 1100).endMs, 1250);
assert.equal(core.moveMarker(base, "end", 9000).endMs, 5000);
assert.equal(core.normalizeRange({ startMs: 4900, endMs: 4901, durationMs: 5000 }).endMs, 5000);
assert.equal(core.normalizeRange({ startMs: 4900, endMs: 4901, durationMs: 5000 }).startMs, 4750);

assert.deepEqual(plain(core.moveRange(base, 750)), {
  startMs: 1750,
  endMs: 3750,
  durationMs: 5000,
});
assert.deepEqual(plain(core.moveRange(base, -5000)), {
  startMs: 0,
  endMs: 2000,
  durationMs: 5000,
});
assert.deepEqual(plain(core.moveRange(base, 5000)), {
  startMs: 3000,
  endMs: 5000,
  durationMs: 5000,
});
assert.equal(
  core.moveRange(base, 5000).endMs - core.moveRange(base, 5000).startMs,
  base.endMs - base.startMs
);

assert.equal(core.positionToTime(50, 0, 100, 10000), 5000);
assert.equal(core.positionToTime(-50, 0, 100, 10000), 0);
assert.equal(core.positionToTime(150, 0, 100, 10000), 10000);
assert.equal(core.positionToTime(50, 0, 0, 10000), null);
assert.equal(core.timeToPercent(2500, 10000), 25);
assert.equal(core.timeToPercent(15000, 10000), 100);

assert.equal(core.getSeekTarget(base, 999), 1000);
assert.equal(core.getSeekTarget(base, 1000), null);
assert.equal(core.getSeekTarget(base, 2999), null);
assert.equal(core.getSeekTarget(base, 3000), 1000);
assert.equal(core.getSeekTarget(base, Number.NaN), null);

const noOp = () => {};
const documentStub = {
  body: {},
  head: { appendChild: noOp },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noOp,
  removeEventListener: noOp,
};
const windowStub = {
  location: {
    href: "https://soundcloud.com/discover",
    origin: "https://soundcloud.com",
    pathname: "/discover",
  },
  SCDL: { isTrackPage: () => false },
  addEventListener: noOp,
  removeEventListener: noOp,
};
const lifecycleContext = vm.createContext({
  console,
  URL,
  document: documentStub,
  window: windowStub,
  globalThis: {},
  SCLooperCore: core,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  setInterval: () => 1,
  clearInterval: noOp,
  setTimeout: () => 1,
  clearTimeout: noOp,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: noOp,
});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "looper.js"), "utf8"),
  lifecycleContext
);
const looper = vm.runInContext("SCLooper", lifecycleContext);
assert.doesNotThrow(() => looper.reset("first"));
assert.doesNotThrow(() => looper.reset("second"));
assert.deepEqual(plain(looper.getState()), { active: false });

console.log("Looper verification passed.");
