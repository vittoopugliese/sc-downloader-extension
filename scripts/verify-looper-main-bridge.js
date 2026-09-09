const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeMedia {
  constructor(src = "") {
    this.src = src;
    this.currentSrc = src;
    this.duration = 44.656;
    this.currentTime = 3;
    this.paused = true;
    this.readyState = 4;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  play() {
    this.paused = false;
    this.listeners.get("playing")?.();
    return Promise.resolve();
  }

  load() {}
}

class FakeAudio extends FakeMedia {}

const documentListeners = new Map();
const root = new FakeElement();
let documentMedia = [];
let nextAnimationId = 0;
const animationCallbacks = new Map();
root.dispatchEvent = (event) => {
  event.target = root;
  documentListeners.get(event.type)?.(event);
  return true;
};

const documentStub = {
  documentElement: root,
  addEventListener(type, listener) {
    documentListeners.set(type, listener);
  },
  querySelectorAll() {
    return documentMedia;
  },
};
const windowStub = {
  Audio: FakeAudio,
  HTMLMediaElement: FakeMedia,
};
const context = vm.createContext({
  console,
  document: documentStub,
  window: windowStub,
  Element: FakeElement,
  HTMLMediaElement: FakeMedia,
  WeakSet,
  Set,
  Number,
  JSON,
  Object,
  requestAnimationFrame(callback) {
    nextAnimationId += 1;
    animationCallbacks.set(nextAnimationId, callback);
    return nextAnimationId;
  },
  cancelAnimationFrame(id) {
    animationCallbacks.delete(id);
  },
});

vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "loop-session.js"), "utf8"),
  context
);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "looper-main-bridge.js"), "utf8"),
  context
);

const media = vm.runInContext(
  'new window.Audio("https://cf-media.sndcdn.com/track.mp3")',
  context
);
assert.equal(
  documentStub.querySelectorAll("audio, video").length,
  0,
  "The fixture must keep the Audio object detached from the DOM"
);

function command(type, payload = {}) {
  const id = `test-${type}`;
  root.setAttribute(
    "data-scdl-looper-command",
    JSON.stringify({ id, type, expectedDurationMs: 44656, ...payload })
  );
  root.dispatchEvent({ type: "scdl-looper:command" });
  return JSON.parse(root.getAttribute("data-scdl-looper-response"));
}

const state = command("state");
assert.equal(state.ok, true);
assert.equal(state.state.available, true);
assert.equal(state.state.durationMs, 44656);
assert.equal(state.state.currentTimeMs, 3000);

assert.equal(command("seek", { timeMs: 12000 }).ok, true);
assert.equal(media.currentTime, 12);

media.play();
const currentMedia = new FakeAudio("https://cf-media.sndcdn.com/current-track.mp3");
currentMedia.isConnected = true;
currentMedia.currentTime = 7;
documentMedia = [currentMedia];
assert.equal(
  command("state").state.currentTimeMs,
  7000,
  "A connected current media element must win over a detached historical player"
);
assert.equal(command("seek", { timeMs: 15000 }).ok, true);
assert.equal(currentMedia.currentTime, 15);
assert.equal(media.currentTime, 12, "Seeking must not target the historical player");

const configured = command("set-loop", {
  startMs: 1000,
  endMs: 3000,
  enabled: true,
  startPlayback: false,
});
assert.equal(configured.ok, true);
assert.equal(configured.loop.active, true);
assert.equal(configured.loop.enabled, true);
currentMedia.currentTime = 3;
const loopCallback = [...animationCallbacks.values()].at(-1);
loopCallback();
assert.equal(currentMedia.currentTime, 1, "MAIN must enforce B by seeking to A");

assert.equal(command("set-loop-enabled", { enabled: false }).ok, true);
assert.equal(command("state").state.loop.enabled, false);
assert.equal(command("set-loop-enabled", { enabled: true }).loop.enabled, true);
assert.equal(command("set-global-bypass", { bypassed: true }).loop.enabled, false);
assert.equal(
  command("set-loop", {
    startMs: 1500,
    endMs: 3500,
    enabled: true,
    startPlayback: false,
  }).loop.enabled,
  false,
  "Waveform edits must not escape the shared bypass"
);
assert.equal(command("set-global-bypass", { bypassed: false }).loop.enabled, true);

const replacementMedia = new FakeAudio("https://cf-media.sndcdn.com/replacement.mp3");
replacementMedia.isConnected = true;
documentMedia = [replacementMedia];
replacementMedia.play();
assert.equal(
  command("state").state.loop.active,
  false,
  "Starting another player track must clear the transient loop"
);

console.log("Looper MAIN-world bridge verification passed.");
