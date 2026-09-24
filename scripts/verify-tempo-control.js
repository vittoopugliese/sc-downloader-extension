const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const corePath = path.join(__dirname, "tempo-control-core.js");
const adapterPath = path.join(__dirname, "tempo-control-main.js");
const contentPath = path.join(__dirname, "content.js");
const panelLogo = "assets/icons/player-toolkit.png";
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
if (
  mainWorldEntry.js.indexOf("scripts/sampler-core.js") < 0 ||
  mainWorldEntry.js.indexOf("scripts/sampler-core.js") > mainWorldEntry.js.indexOf("scripts/tempo-control-main.js") ||
  mainWorldEntry.js.indexOf("scripts/audio-effects-core.js") < 0 ||
  mainWorldEntry.js.indexOf("scripts/audio-effects-core.js") > mainWorldEntry.js.indexOf("scripts/tempo-control-main.js")
) {
  throw new Error("The audio effects engine must load before the tempo panel adapter.");
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
  "scripts/sampler-core.js",
  "scripts/audio-effects-core.js",
  "scripts/parametric-eq.js",
  "scripts/player-tools-collapsible.js",
  "scripts/parametric-eq-ui.js",
  "scripts/tempo-control-main.js",
  "THIRD_PARTY_LICENSES.md",
  panelLogo,
  "assets/drums",
]) {
  if (!packageScript.includes(`\"${item}\"`)) {
    throw new Error(`Extension package is missing ${item}.`);
  }
}
const contentCode = fs.readFileSync(contentPath, "utf8");
if (!fs.existsSync(path.join(projectRoot, "assets/icons/eq.svg")) ||
    !manifest.web_accessible_resources?.some((entry) => entry.resources?.includes("assets/icons/eq.svg")) ||
    !packageScript.includes('"assets/icons"')) {
  throw new Error("The EQ icon must be packaged and exposed to SoundCloud.");
}
for (const name of ["cross", "detach", "trash", "expand"]) {
  const asset = `assets/icons/${name}.svg`;
  if (!fs.existsSync(path.join(projectRoot, asset)) ||
      !manifest.web_accessible_resources?.some((entry) => entry.resources?.includes(asset)) ||
      !contentCode.includes(asset)) {
    throw new Error(`The ${name} icon must be loaded from its packaged asset file.`);
  }
}

if (
  !contentCode.includes(panelLogo) ||
  !manifest.web_accessible_resources?.some((entry) =>
    entry.resources?.includes(panelLogo)
  )
) {
  throw new Error("The tempo panel logo is not exposed to SoundCloud.");
}
if (
  !contentCode.includes("assets/drums/") ||
  !manifest.web_accessible_resources?.some((entry) => entry.resources?.includes("assets/drums/*.wav"))
) {
  throw new Error("The default drum samples are not exposed to SoundCloud.");
}

class MockMediaElement {
  constructor() {
    this.values = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: true,
    };
    this.listeners = new Map();
    this.paused = true;
    this.currentSrc = "";
    this.src = "";
    this.readyState = 0;
    this.duration = NaN;
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
class MockAudioConstructor extends MockAudioElement {
  constructor(source) {
    super();
    this.crossOrigin = null;
    this.sourceAssignedWithCors = false;
    let assignedSource = "";
    Object.defineProperty(this, "src", {
      configurable: true,
      get: () => assignedSource,
      set: (value) => {
        this.sourceAssignedWithCors = this.crossOrigin === "anonymous";
        assignedSource = value;
      },
    });
    if (source !== undefined) {
      this.src = source;
    }
  }
}
const audioGlobal = { Audio: MockAudioConstructor };
const context = vm.createContext({ console, WeakRef });
vm.runInContext(fs.readFileSync(corePath, "utf8"), context, {
  filename: corePath,
});

const controller = context.SCTempoControl.create({
  mediaPrototype: MockMediaElement.prototype,
  isAudio: (media) => media instanceof MockAudioElement,
  audioGlobal,
  initialRate: 0.85,
  initialPreservePitch: true,
});
controller.install();

const constructedAudio = new audioGlobal.Audio("https://media.soundcloud.test/stream.mp3");
if (
  constructedAudio.crossOrigin !== "anonymous" ||
  !constructedAudio.sourceAssignedWithCors ||
  controller.getActiveAudio() !== constructedAudio
) {
  throw new Error("SoundCloud Audio URLs must opt into CORS before the source is assigned.");
}

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

const detachedPlayingAudio = new MockAudioElement();
detachedPlayingAudio.paused = false;
detachedPlayingAudio.currentSrc = "https://media.soundcloud.test/stream.mp3";
detachedPlayingAudio.readyState = 4;
detachedPlayingAudio.duration = 180;
controller.discover(detachedPlayingAudio);
if (controller.getActiveAudio() !== detachedPlayingAudio) {
  throw new Error("Tempo control did not expose a detached playing Audio instance to Player Tools.");
}

const adapterCode = fs.readFileSync(adapterPath, "utf8");
for (const expected of [
  'min="0.1"',
  'max="3"',
  'step="${DEFAULTS.step}"',
  "Keep Tone",
  "scdl.tempo.waveformCollapsed",
  "Download current playing",
  "scdl:download-current-track",
  ".playbackTimeline__progressWrapper",
]) {
  if (!adapterCode.includes(expected)) {
    throw new Error(`Tempo player adapter is missing ${expected}.`);
  }
}

console.log("Tempo control verification passed.");
