const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "sampler-core.js"), "utf8");
const context = vm.createContext({ globalThis: {} });
vm.runInContext(source, context, { filename: "sampler-core.js" });
const sampler = context.globalThis.SCSamplerCore;

assert.ok(sampler);
assert.equal(sampler.midiForKey("z"), 48);
assert.equal(sampler.midiForKey("A"), 60);
assert.equal(sampler.midiForKey("q"), 72);
assert.equal(sampler.midiForKey("p"), 81);
assert.equal(sampler.midiForKey("1"), null);
assert.equal(sampler.midiForKey(""), null);

assert.equal(sampler.playbackRateForMidi(60), 1);
assert.equal(sampler.playbackRateForMidi(72), 2);
assert.equal(sampler.playbackRateForMidi(48), 0.5);
assert.ok(Math.abs(sampler.playbackRateForMidi(61) - 2 ** (1 / 12)) < 1e-12);
assert.throws(() => sampler.playbackRateForMidi(NaN), /finite/);

assert.equal(Object.keys(sampler.KEY_TO_MIDI).length, 26);
assert.equal(new Set(Object.keys(sampler.KEY_TO_MIDI)).size, 26);

console.log("Sampler core verification passed.");
