const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "manifest.json"), "utf8")
);
const looperRegistration = manifest.content_scripts.find((registration) =>
  registration.js.includes("scripts/looper.js")
);
assert.equal(
  looperRegistration?.all_frames,
  true,
  "The looper must run in SoundCloud's embedded crossfade frame"
);
const bridgeRegistration = manifest.content_scripts.find((registration) =>
  registration.js.includes("scripts/looper-main-bridge.js")
);
assert.equal(bridgeRegistration?.world, "MAIN", "The media bridge must run in MAIN");
assert.equal(
  bridgeRegistration?.run_at,
  "document_start",
  "The media bridge must capture detached Audio objects before SoundCloud starts"
);
assert.equal(bridgeRegistration?.all_frames, true);

function element({ attributes = {}, rect = null } = {}) {
  return {
    attributes,
    parentElement: null,
    isConnected: true,
    style: {},
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
const trackRoot = element();
const waveformBranch = element({ rect: { left: 0, top: 0, width: 624, height: 130 } });
const waveform = element({
  attributes: { role: "slider", "aria-label": "Waveform", "aria-valuemax": "44656" },
  rect: { left: 0, top: 0, width: 624, height: 130 },
});
const menuButton = element({
  attributes: { "aria-label": "Más acciones", "aria-haspopup": "true" },
});
const bridgeAttributes = new Map();
let bridgeCurrentTimeMs = 3000;
const bridgeRoot = {
  setAttribute(name, value) {
    bridgeAttributes.set(name, value);
  },
  getAttribute(name) {
    return bridgeAttributes.get(name) ?? null;
  },
  removeAttribute(name) {
    bridgeAttributes.delete(name);
  },
  dispatchEvent(event) {
    if (event.type !== "scdl-looper:command") return true;
    const command = JSON.parse(bridgeAttributes.get("data-scdl-looper-command"));
    const response = command.type === "state"
      ? {
          id: command.id,
          ok: true,
          state: {
            available: true,
            durationMs: 44656,
            currentTimeMs: bridgeCurrentTimeMs,
            paused: false,
          },
        }
      : { id: command.id, ok: true };
    if (command.type === "seek") bridgeCurrentTimeMs = command.timeMs;
    bridgeAttributes.set("data-scdl-looper-response", JSON.stringify(response));
    return true;
  },
};
const localBridgeAttributes = new Map();
let localBridgeCurrentTimeMs = 1000;
const localBridgeRoot = {
  setAttribute(name, value) {
    localBridgeAttributes.set(name, value);
  },
  getAttribute(name) {
    return localBridgeAttributes.get(name) ?? null;
  },
  removeAttribute(name) {
    localBridgeAttributes.delete(name);
  },
  dispatchEvent(event) {
    if (event.type !== "scdl-looper:command") return true;
    const command = JSON.parse(
      localBridgeAttributes.get("data-scdl-looper-command")
    );
    const response = command.type === "state"
      ? {
          id: command.id,
          ok: true,
          state: {
            available: true,
            durationMs: null,
            currentTimeMs: localBridgeCurrentTimeMs,
            paused: true,
          },
        }
      : { id: command.id, ok: true };
    if (command.type === "seek") localBridgeCurrentTimeMs = command.timeMs;
    localBridgeAttributes.set(
      "data-scdl-looper-response",
      JSON.stringify(response)
    );
    return true;
  },
};
const parentDocument = {
  documentElement: bridgeRoot,
  querySelectorAll: () => [],
  querySelector: () => null,
};
waveform.parentElement = waveformBranch;
waveformBranch.parentElement = trackRoot;
trackRoot.parentElement = body;
trackRoot.querySelector = (selector) => selector === "h1" ? element() : null;
trackRoot.querySelectorAll = (selector) =>
  selector === 'button[aria-haspopup="true"]'
    ? [menuButton]
    : selector === '[role="slider"][aria-label="Waveform"]'
      ? [waveform]
      : [];

const documentStub = {
  body,
  head: null,
  documentElement: localBridgeRoot,
  querySelectorAll(selector) {
    if (selector === '[role="slider"][aria-label="Waveform"]') return [waveform];
    if (selector === 'button[aria-haspopup="true"]') return [menuButton];
    return [];
  },
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};
const windowStub = {
  document: documentStub,
  location: {
    href: "https://soundcloud.com/discover",
    origin: "https://soundcloud.com",
    pathname: "/discover",
  },
  SCDL: { isTrackPage: () => false },
  getComputedStyle: () => ({ display: "block", visibility: "visible" }),
};
windowStub.parent = { document: parentDocument };
windowStub.top = windowStub.parent;
const context = vm.createContext({
  console,
  URL,
  document: documentStub,
  window: windowStub,
  Event: class {
    constructor(type) {
      this.type = type;
    }
  },
  SCLooperCore: { MIN_RANGE_MS: 250 },
});

const source = fs
  .readFileSync(path.resolve(__dirname, "looper.js"), "utf8")
  .replace(
    "  const looper = { ensureMounted: runEnsureMounted, reset, getState };",
    "  globalThis.__discoverLooperTarget = discoverTarget;\n  globalThis.__createNativeMediaAdapter = createNativeMediaAdapter;\n  const looper = { ensureMounted: runEnsureMounted, reset, getState };"
  )
  .replace(
    '  if (document.body) startLifecycle();\n  else document.addEventListener("DOMContentLoaded", startLifecycle, { once: true });',
    ""
  );
vm.runInContext(source, context);

const target = vm.runInContext("__discoverLooperTarget()", context);
assert.ok(target, "The waveform could not resolve the supplied action container");
assert.equal(target.waveform, waveform);
assert.equal(target.menuButton, menuButton);

const adapter = vm.runInContext("__createNativeMediaAdapter(44656)", context);
assert.equal(
  adapter.isAvailable(),
  true,
  "The player in the parent document did not enable the loop button"
);
assert.equal(adapter.getCurrentTimeMs(), 3000);
assert.equal(adapter.seekToMs(12000), true);
assert.equal(bridgeCurrentTimeMs, 12000);
adapter.destroy();
console.log("Looper mount verification passed.");
