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
    return [];
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
});

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

console.log("Looper MAIN-world bridge verification passed.");
