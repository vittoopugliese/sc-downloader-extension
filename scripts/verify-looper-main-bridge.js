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
let currentTrackHref = "https://soundcloud.com/artist/track";
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
  querySelector(selector) {
    return selector.includes("playbackSoundBadge__titleLink")
      ? { href: currentTrackHref }
      : null;
  },
};
const windowStub = {
  Audio: FakeAudio,
  HTMLMediaElement: FakeMedia,
  location: { href: "https://soundcloud.com/artist/track" },
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
  URL,
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
assert.equal(command("set-global-bypass", { bypassed: true }).loop.enabled, true);
assert.equal(command("state").state.loop.effectiveEnabled, false);
assert.equal(
  command("set-loop", {
    startMs: 1500,
    endMs: 3500,
    enabled: true,
    startPlayback: false,
  }).loop.effectiveEnabled,
  false,
  "Waveform edits must not escape the shared bypass"
);
assert.equal(command("set-global-bypass", { bypassed: false }).loop.effectiveEnabled, true);

// Moving the selection can seek into unbuffered audio. Until seeked fires,
// playback events and animation frames must not restart that same seek.
let pendingTime = 2;
let pendingTarget = null;
let seekWrites = 0;
Object.defineProperty(currentMedia, "currentTime", {
  configurable: true,
  get: () => pendingTime,
  set(value) {
    seekWrites += 1;
    pendingTarget = value;
    currentMedia.seeking = true;
  },
});
command("set-loop", { startMs: 10001, endMs: 12001, enabled: true, startPlayback: false });
function tickLoop() {
  const [id, callback] = [...animationCallbacks.entries()].at(-1);
  animationCallbacks.delete(id);
  callback();
}
tickLoop();
assert.equal(pendingTarget, 10.001, "Moving the loop forward must seek to its new A");
for (let frame = 0; frame < 20; frame += 1) {
  currentMedia.listeners.get("seeking")?.();
  currentMedia.listeners.get("timeupdate")?.();
  tickLoop();
}
assert.equal(seekWrites, 1, "A pending loop seek must not be restarted by playback events or frames");

// Media timestamps may land just below A at the nearest audio sample.
pendingTime = 10.00099;
currentMedia.seeking = false;
currentMedia.listeners.get("seeked")?.();
tickLoop();
assert.equal(seekWrites, 1, "Sub-millisecond seek rounding must not freeze playback at A");
pendingTime = 12.001;
tickLoop();
assert.equal(seekWrites, 2, "The moved loop must still wrap from its new B to A");
pendingTime = pendingTarget;
currentMedia.seeking = false;
currentMedia.listeners.get("seeked")?.();

pendingTime = 20;
currentMedia.listeners.get("timeupdate")?.();
assert.equal(seekWrites, 3, "Seeking past B must return to the active loop");
command("set-loop", { startMs: 15001, endMs: 17001, enabled: true, startPlayback: false });
tickLoop();
assert.equal(seekWrites, 3, "Moving A-B during a pending seek must allow it to finish");
pendingTime = pendingTarget;
currentMedia.seeking = false;
currentMedia.listeners.get("seeked")?.();
assert.equal(pendingTarget, 15.001, "Seek completion must use the latest selection without Clear");
assert.equal(seekWrites, 4);
pendingTime = pendingTarget;
currentMedia.seeking = false;
currentMedia.listeners.get("seeked")?.();
tickLoop();
assert.equal(seekWrites, 4, "Playback inside the moved selection must be allowed to advance");

const replacementMedia = new FakeAudio("https://cf-media.sndcdn.com/replacement.mp3");
replacementMedia.isConnected = true;
documentMedia = [replacementMedia];
currentTrackHref = "https://soundcloud.com/artist/replacement";
replacementMedia.play();
assert.equal(
  command("state").state.loop.active,
  false,
  "Starting another player track must clear the transient loop"
);

console.log("Looper MAIN-world bridge verification passed.");
