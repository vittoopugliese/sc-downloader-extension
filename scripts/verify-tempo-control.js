const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const corePath = path.join(__dirname, "tempo-control-core.js");
const adapterPath = path.join(__dirname, "tempo-control-main.js");
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8")
);

const mainWorldEntry = manifest.content_scripts.find(
  (entry) =>
    entry.world === "MAIN" &&
    entry.js?.includes("scripts/tempo-control-core.js") &&
    entry.js?.includes("scripts/tempo-control-main.js")
);
if (!mainWorldEntry || mainWorldEntry.run_at !== "document_start") {
  throw new Error("Tempo control is not loaded at document_start in MAIN world.");
}
if (mainWorldEntry.all_frames) {
  throw new Error("Tempo control should only run in SoundCloud's top frame.");
}

const packageScript = fs.readFileSync(
  path.join(__dirname, "package-extension.ps1"),
  "utf8"
);
for (const item of [
  "scripts/tempo-control-core.js",
  "scripts/tempo-control-main.js",
  "THIRD_PARTY_LICENSES.md",
]) {
  if (!packageScript.includes(`\"${item}\"`)) {
    throw new Error(`Extension package is missing ${item}.`);
  }
}

class MockMediaElement {
  constructor() {
    this.values = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: true,
    };
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  play() {
    return Promise.resolve();
  }
}

for (const name of ["playbackRate", "defaultPlaybackRate", "preservesPitch"]) {
  Object.defineProperty(MockMediaElement.prototype, name, {
    configurable: true,
    get() {
      return this.values[name];
    },
    set(value) {
      this.values[name] = value;
    },
  });
}

class MockAudioElement extends MockMediaElement {}
const context = vm.createContext({ console, WeakRef });
vm.runInContext(fs.readFileSync(corePath, "utf8"), context, {
  filename: corePath,
});

const controller = context.SCTempoControl.create({
  mediaPrototype: MockMediaElement.prototype,
  isAudio: (media) => media instanceof MockAudioElement,
  initialRate: 0.85,
  initialPreservePitch: true,
});
controller.install();

const audio = new MockAudioElement();
controller.discover(audio);
controller.apply(audio);
if (
  audio.playbackRate !== 0.85 ||
  audio.defaultPlaybackRate !== 0.85 ||
  audio.preservesPitch !== true
) {
  throw new Error("Initial speed and pitch mode were not applied to audio.");
}

audio.playbackRate = 1.5;
if (audio.playbackRate !== 0.85) {
  throw new Error("A host playback-rate write escaped the tempo guard.");
}

controller.setRate(9);
controller.setPreservePitch(false);
if (audio.playbackRate !== 3 || audio.preservesPitch !== false) {
  throw new Error("Rate clamping or Preserve Pitch updates are broken.");
}
if (context.SCTempoControl.formatRate(1) !== "1.000x") {
  throw new Error("Compact player rate formatting is broken.");
}

const adapterCode = fs.readFileSync(adapterPath, "utf8");
for (const expected of [
  'min="0.1"',
  'max="3"',
  'step="${DEFAULTS.step}"',
  "Keep Tone",
  "#scdl-player-download",
  ".playbackTimeline__progressWrapper",
]) {
  if (!adapterCode.includes(expected)) {
    throw new Error(`Tempo player adapter is missing ${expected}.`);
  }
}

console.log("Tempo control verification passed.");
