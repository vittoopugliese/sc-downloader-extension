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
  start() { this.started = true; }
  stop() { this.stopped = true; }
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
  createBiquadFilter() { const node = this.node("biquad"); node.frequency = new AudioParam(); node.Q = new AudioParam(); return node; }
  createGain() { const node = this.node("gain"); node.gain = new AudioParam(); return node; }
  createDelay() { const node = this.node("delay"); node.delayTime = new AudioParam(); return node; }
  createOscillator() { const node = this.node("oscillator"); node.frequency = new AudioParam(); return node; }
  createWaveShaper() { return this.node("waveshaper"); }
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
const limiterNode = graphNodes.find((node) => node.kind === "compressor");
const masterNode = graphNodes.find((node) => node.kind === "gain" && node.connections.includes(limiterNode));
const delayNode = graphNodes.find((node) => node.kind === "delay" && node.delayTime.value === 0.25);
const delayInput = graphNodes.find((node) => node.kind === "gain" && node.connections.includes(delayNode));
const reverbPreDelay = graphNodes.find((node) => node.kind === "delay" && node !== delayNode && node.delayTime.value === 0.02);
const feedbackNode = graphNodes.find((node) => node.kind === "gain" && Math.abs(node.gain.value - 0.205) < 1e-9);
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
if (sourceNode.connections.includes(delayInput)) {
  throw new Error("A zero-percent delay must not feed its effect branch.");
}

effects.set("delay", 150);
state = effects.snapshot();
if (state.delay !== 100) throw new Error("Effect slider values must clamp to 100%.");
if (!sourceNode.connections.includes(delayInput)) throw new Error("The delay branch did not connect when enabled.");
effects.setCharacter("delayTime", 500);
effects.setCharacter("delayFeedback", 60);
effects.setCharacter("reverbSize", 90);
effects.setCharacter("reverbRoom", "plate");
effects.setCharacter("reverbDecay", 6.5);
effects.setCharacter("reverbPreDelay", 80);
if (delayNode.delayTime.value !== 0.5 || reverbPreDelay.delayTime.value !== 0.08 || Math.abs(feedbackNode.gain.value - 0.492) > 1e-9 || effects.snapshot().reverbRoom !== "plate" || effects.snapshot().reverbDecay !== 6.5) {
  throw new Error("Advanced FX settings did not update the live audio graph.");
}
for (const name of ["flanger", "phaser", "bitcrusher", "saturation"]) effects.set(name, 30);
effects.setCharacter("flangerRate", 1.25);
effects.setCharacter("flangerDepth", 70);
effects.setCharacter("flangerFeedback", 35);
effects.setCharacter("phaserRate", 0.75);
effects.setCharacter("phaserDepth", 65);
effects.setCharacter("phaserFeedback", 30);
effects.setCharacter("bitDepth", 7);
effects.setCharacter("sampleRateReduction", 60);
effects.setCharacter("saturationDrive", 55);
effects.setCharacter("saturationTone", 45);
state = effects.snapshot();
if (state.schemaVersion !== 2 || state.flanger !== 30 || state.phaser !== 30 || state.bitcrusher !== 30 || state.saturation !== 30 ||
    state.flangerRate !== 1.25 || state.phaserRate !== 0.75 || state.bitDepth !== 7 || state.saturationDrive !== 55) {
  throw new Error(`New FX settings did not update the normalized snapshot: ${JSON.stringify(state)}`);
}
if (sourceNode.connections.length < 7 || graphNodes.filter((node) => node.kind === "oscillator" && node.started).length !== 2 ||
    graphNodes.filter((node) => node.kind === "waveshaper" && node.curve?.length > 1000).length !== 2) {
  throw new Error("Motion and color effect branches were not connected to the existing graph.");
}
if (!effects.setDelayFreeze(true) || delayInput.gain.value !== 0 || feedbackNode.gain.value !== 0.985) {
  throw new Error("Echo freeze must close the input and hold a bounded feedback loop.");
}
if (effects.setDelayFreeze(false) || delayInput.gain.value !== 1 || Math.abs(feedbackNode.gain.value - 0.492) > 1e-9) {
  throw new Error("Releasing echo freeze must restore the configured input and feedback.");
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
const reverbTone = graphNodes.find((node) => node.kind === "biquad" && node.connections.some((target) => target.kind === "gain" && target.connections.includes(masterNode)));
const reverbReturn = reverbTone.connections.find((node) => node.kind === "gain");
const delayReturn = delayNode.connections.find((node) => node.kind === "gain" && node.connections.includes(masterNode));
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
const replacementNodeStart = graphNodes.length;
effects.applyToActive();
if (replacementAudio.sourceCount !== 1) throw new Error("SPA media element replacement was not connected.");
effects.applyToActive();
if (replacementAudio.sourceCount !== 1) throw new Error("A media element must only be connected once.");
if (activeAudio.sourceCount !== 1) throw new Error("Initial player was not connected once.");
const replacementNodes = graphNodes.slice(replacementNodeStart);
const replacementLimiter = replacementNodes.find((node) => node.kind === "compressor");
const replacementMaster = replacementNodes.find((node) => node.kind === "gain" && node.connections.includes(replacementLimiter));
const replacementReturns = replacementNodes.filter((node) => node.kind === "gain" && node.connections.includes(replacementMaster)).slice(0, 2);
if (replacementReturns[0].gain.value !== 0 || replacementReturns[1].gain.value !== 0.264) {
  throw new Error("The replacement player must receive the configured effect amounts.");
}
effects.setBypassed(true);
if ([reverbReturn, delayReturn, ...replacementReturns].some((node) => node.gain.value !== 0)) {
  throw new Error("Global bypass must silence effects on every player graph, including replaced SoundCloud players.");
}
effects.setBypassed(false);
if (delayReturn.gain.value !== 0.264 || replacementReturns[1].gain.value !== 0.264) {
  throw new Error("Unbypass must restore effects on every player graph.");
}
const contextsBeforeReset = FakeAudioContext.instances.length;
const wetNodesBeforeReset = graphNodes.filter((node) =>
  ["delay", "convolver", "biquad"].includes(node.kind) || node === feedbackNode
);
state = effects.reset();
for (const [name, value] of Object.entries(context.SCTempoEffects.DEFAULTS)) {
  if (state[name] !== value) throw new Error(`FX reset did not restore ${name}: ${JSON.stringify(state)}`);
}
if (state.bypassed || state.reverb !== 0 || state.delay !== 0) {
  throw new Error("FX reset must produce a neutral, unbypassed snapshot.");
}
if ([reverbReturn, delayReturn, ...replacementReturns].some((node) => node.gain.value !== 0) ||
    sourceNode.connections.includes(reverbPreDelay) || sourceNode.connections.includes(delayInput)) {
  throw new Error("FX reset must silence and disconnect every existing effect tail.");
}
if (FakeAudioContext.instances.length !== contextsBeforeReset) {
  throw new Error("FX reset must not create a new AudioContext.");
}
if (wetNodesBeforeReset.some((node) => node.connections.length !== 0)) {
  throw new Error("FX reset must detach the old wet graphs so buffered tails cannot return.");
}
if (graphNodes.length <= replacementNodeStart + replacementNodes.length) {
  throw new Error("FX reset must replace wet nodes inside the existing AudioContext.");
}
effects.setBypassed(true);
effects.setBypassed(false);
if ([reverbReturn, delayReturn, ...replacementReturns].some((node) => node.gain.value !== 0)) {
  throw new Error("Bypass toggles after reset must not revive old wet values.");
}

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
