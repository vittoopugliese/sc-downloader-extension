const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noOp = () => {};

function element({ className = "", attributes = {}, rect } = {}) {
  return {
    className,
    attributes,
    parentElement: null,
    isConnected: true,
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return rect || { left: 0, top: 0, width: 0, height: 0 };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

const body = element();
const hero = element({ className: "fullHero__waveform" });
const wrapper = element({
  className: "waveformWrapper",
  rect: { left: 40, top: 100, width: 784, height: 100 },
});
const waveform = element({
  className: "waveformWrapper__waveform",
  rect: { left: 40, top: 100, width: 784, height: 100 },
});
const actions = element({ className: "soundActions" });
const menuButton = element({
  className:
    "sc-button-more sc-button-secondary sc-button sc-button-medium sc-button-icon",
  attributes: { "aria-haspopup": "true", "aria-label": "More", title: "More" },
  rect: { left: 300, top: 220, width: 30, height: 26 },
});
waveform.parentElement = wrapper;
wrapper.parentElement = hero;
hero.parentElement = body;
menuButton.parentElement = actions;
actions.parentElement = body;

const documentStub = {
  body,
  head: null,
  documentElement: { setAttribute: noOp },
  querySelectorAll(selector) {
    if (selector.includes("waveformWrapper__waveform")) return [waveform];
    if (selector === 'button[aria-haspopup="true"]') return [menuButton];
    if (selector === "h1") return [element()];
    return [];
  },
  querySelector: () => null,
  addEventListener: noOp,
  removeEventListener: noOp,
};
const windowStub = {
  document: documentStub,
  location: {
    href: "https://soundcloud.com/artist/current-dom",
    origin: "https://soundcloud.com",
    pathname: "/artist/current-dom",
  },
  SCDL: {
    isTrackPage: () => true,
    getTrackData: () => ({ duration: "3:30" }),
  },
  getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  addEventListener: noOp,
  removeEventListener: noOp,
};
windowStub.top = windowStub;

const context = vm.createContext({
  console,
  URL,
  document: documentStub,
  window: windowStub,
  globalThis: {},
  SCLooperCore: { MIN_RANGE_MS: 250 },
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
    "  globalThis.__discoverLooperTarget = discoverTarget;\n  const looper = { ensureMounted: runEnsureMounted, reset, getState };"
  )
  .replace(
    '  if (document.body) startLifecycle();\n  else document.addEventListener("DOMContentLoaded", startLifecycle, { once: true });',
    ""
  );
vm.runInContext(source, context, { filename: "looper.js" });

const target = vm.runInContext("globalThis.__discoverLooperTarget()", context);
assert.ok(target, "The current SoundCloud waveform DOM must be discovered");
assert.equal(target.waveform, waveform);
assert.equal(target.wrapper, wrapper);
assert.equal(target.menuButton, menuButton);
assert.equal(target.durationMs, 210000);
console.log("Current SoundCloud looper DOM verification passed.");
