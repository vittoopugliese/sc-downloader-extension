const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class AudioParam {
  constructor(value = 0) { this.value = value; this.events = []; }
  cancelScheduledValues(time) { this.events.push(["cancel", time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(["target", value, time, constant]); }
}

class AudioNode {
  constructor(kind) { this.kind = kind; this.connections = []; }
  connect(target) { this.connections.push(target); return target; }
  disconnect(target) {
    this.connections = target ? this.connections.filter((node) => node !== target) : [];
  }
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.instances.push(this);
    this.currentTime = 10;
    this.sampleRate = 100;
    this.state = "running";
    this.destination = new AudioNode("destination");
    this.nodes = [];
  }
  node(kind) { const node = new AudioNode(kind); this.nodes.push(node); return node; }
  createMediaElementSource(audio) { audio.sourceCount += 1; return this.node("media-source"); }
  createConvolver() { return this.node("convolver"); }
  createBiquadFilter() { const node = this.node("biquad"); node.frequency = new AudioParam(); return node; }
  createGain() { const node = this.node("gain"); node.gain = new AudioParam(); return node; }
  createDelay() { const node = this.node("delay"); node.delayTime = new AudioParam(); return node; }
  createDynamicsCompressor() {
    const node = this.node("compressor");
    for (const name of ["threshold", "knee", "ratio", "attack", "release"]) node[name] = new AudioParam();
    return node;
  }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (index) => data[index] };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
FakeAudioContext.instances = [];

class FakeAudio {
  constructor({ src = "https://media.soundcloud.com/audio", crossOrigin = "anonymous" } = {}) {
    this.paused = false;
    this.sourceCount = 0;
    this.listeners = new Map();
    this.currentSrc = src;
    this.src = src;
    this.readyState = 4;
    this.crossOrigin = crossOrigin;
  }
  play() {}
  closest(selector) { return selector === ".playControls__elements" ? {} : null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

const context = vm.createContext({
  AudioContext: FakeAudioContext,
  clearTimeout,
  setTimeout,
  Math,
  URL,
  location: { href: "https://soundcloud.com/artist/track", origin: "https://soundcloud.com" },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "audio-effects-core.js"), "utf8"), context);
let activeAudio = new FakeAudio();
const effects = context.SCTempoEffects.create({
  getActiveAudio: () => activeAudio,
  AudioContext: FakeAudioContext,
});

if (effects.snapshot().initialized) throw new Error("FX must not initialize before use.");
effects.set("reverb", 40);
let state = effects.snapshot();
if (!state.initialized || state.reverb !== 40 || state.delay !== 0) {
  throw new Error(`Reverb did not initialize with its requested value: ${JSON.stringify(state)}`);
}
const graphNodes = FakeAudioContext.instances[0].nodes;
const [reverbPreDelay, delayNode] = graphNodes.filter((node) => node.kind === "delay");
const feedbackNode = graphNodes.filter((node) => node.kind === "gain")[1];
const masterNode = graphNodes.filter((node) => node.kind === "gain")[3];
const limiterNode = graphNodes.find((node) => node.kind === "compressor");
if (delayNode.delayTime.value !== 0.25 || feedbackNode.gain.value !== 0.205) {
  throw new Error("Delay time or feedback defaults changed unexpectedly.");
}
const sourceNode = graphNodes.find((node) => node.kind === "media-source");
const destination = FakeAudioContext.instances[0].destination;
if (!sourceNode.connections.includes(masterNode) || masterNode.connections[0] !== limiterNode || limiterNode.connections[0] !== destination) {
  throw new Error("Active effects must route the mixed signal through the output limiter.");
}
const impulse = graphNodes.find((node) => node.kind === "convolver").buffer;
const impulseEnergy = Array.from({ length: 2 }, (_, channel) => impulse.getChannelData(channel))
  .flatMap((samples) => Array.from(samples))
  .reduce((total, sample) => total + sample * sample, 0);
if (!Number.isFinite(impulseEnergy) || Math.abs(impulseEnergy - 0.15) > 1e-5) {
  throw new Error("The reverb impulse response must have bounded energy.");
}
if (sourceNode.connections.includes(delayNode)) {
  throw new Error("A zero-percent delay must not feed its effect branch.");
}

effects.set("delay", 150);
state = effects.snapshot();
if (state.delay !== 100) throw new Error("Effect slider values must clamp to 100%.");
if (!sourceNode.connections.includes(delayNode)) throw new Error("The delay branch did not connect when enabled.");
effects.setCharacter("delayTime", 500);
effects.setCharacter("delayFeedback", 60);
effects.setCharacter("reverbSize", 90);
effects.setCharacter("reverbRoom", "plate");
effects.setCharacter("reverbDecay", 6.5);
effects.setCharacter("reverbPreDelay", 80);
if (delayNode.delayTime.value !== 0.5 || reverbPreDelay.delayTime.value !== 0.08 || Math.abs(feedbackNode.gain.value - 0.492) > 1e-9 || effects.snapshot().reverbRoom !== "plate" || effects.snapshot().reverbDecay !== 6.5) {
  throw new Error("Advanced FX settings did not update the live audio graph.");
}
effects.applyPreset("dub");
if (effects.snapshot().preset !== "dub" || effects.snapshot().delayFeedback !== 60 || effects.snapshot().delay !== 48) {
  throw new Error("FX presets did not apply their complete sound profile.");
}
effects.set("reverb", -1);
if (effects.snapshot().reverb !== 0) throw new Error("0% must switch an effect off.");
if (sourceNode.connections.includes(reverbPreDelay)) {
  throw new Error("The reverb input must disconnect while its tail is cleared.");
}
const reverbReturn = graphNodes.filter((node) => node.kind === "gain")[0];
const delayReturn = graphNodes.filter((node) => node.kind === "gain")[2];
effects.setBypassed(true);
if (!effects.snapshot().bypassed) throw new Error("Global bypass state was not applied.");
if (reverbReturn.gain.value !== 0 || delayReturn.gain.value !== 0) {
  throw new Error("Global bypass must silence both effect returns.");
}
if (!sourceNode.connections.includes(destination)) {
  throw new Error("Bypass must restore the unprocessed direct output path.");
}
effects.setBypassed(false);
if (delayReturn.gain.value !== 0.264) throw new Error("Unbypass did not restore the delay amount.");
if (!sourceNode.connections.includes(masterNode)) {
  throw new Error("Enabling effects must restore the limited output path.");
}

const replacementAudio = new FakeAudio();
activeAudio = replacementAudio;
effects.applyToActive();
if (replacementAudio.sourceCount !== 1) throw new Error("SPA media element replacement was not connected.");
effects.applyToActive();
if (replacementAudio.sourceCount !== 1) throw new Error("A media element must only be connected once.");
if (activeAudio.sourceCount !== 1) throw new Error("Initial player was not connected once.");

const unsafeAudio = new FakeAudio({ crossOrigin: null });
const unsafeEffects = context.SCTempoEffects.create({
  getActiveAudio: () => unsafeAudio,
  AudioContext: FakeAudioContext,
});
const contextsBeforeUnsafeAudio = FakeAudioContext.instances.length;
unsafeEffects.set("reverb", 50);
if (unsafeEffects.snapshot().available || unsafeAudio.sourceCount !== 0) {
  throw new Error("Cross-origin audio without CORS mode must stay on its native playback path.");
}
if (FakeAudioContext.instances.length !== contextsBeforeUnsafeAudio) {
  throw new Error("Unsafe audio must be checked before its output is routed through Web Audio.");
}

console.log("Audio effects core verification passed.");
