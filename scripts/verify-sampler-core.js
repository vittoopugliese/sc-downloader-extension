const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "sampler-core.js"), "utf8");
const context = vm.createContext({ globalThis: {} });
vm.runInContext(source, context, { filename: "sampler-core.js" });
const sampler = context.globalThis.SCSamplerCore;

assert.ok(sampler);
assert.equal(sampler.midiForKey("z"), 60);
const expectedRows = [
  ["zxcvbnm,./", "C4 D4 E4 F4 G4 A4 B4 C5 D5 E5"],
  ["asdfghjkl;'", "B3 C#4 D#4 E4 F#4 G#4 A#4 C5 C#5 D#5 F5"],
  ["qwertyuiop[]", "C5 D5 E5 F5 G5 A5 B5 C6 D6 E6 F6 G6"],
  ["1234567890-=", "B4 C#5 D#5 E5 F#5 G#5 A#5 C6 C#6 D#6 F6 G6"],
];
const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
for (const [keys, notes] of expectedRows) {
  notes.split(" ").forEach((note, index) => {
    const midi = (Number(note.at(-1)) + 1) * 12 + pitchClasses.indexOf(note.slice(0, -1));
    assert.equal(sampler.midiForKey(keys[index]), midi, `${keys[index]} = ${note}`);
  });
}
for (const [code, midi] of Object.entries({ Comma: 72, Period: 74, Slash: 76, Semicolon: 75, Quote: 77, BracketLeft: 89, BracketRight: 91, Minus: 89, Equal: 91, Digit2: 73, KeyQ: 72 })) {
  assert.equal(sampler.midiForEvent({ code, key: "?" }), midi);
}
assert.equal(sampler.midiForEvent({ key: "?" }), 76);
assert.equal(sampler.midiForKey("A"), 59);
assert.equal(sampler.midiForKey("!"), null);
assert.equal(sampler.midiForKey(""), null);

assert.equal(sampler.playbackRateForMidi(72), 1);
assert.equal(sampler.playbackRateForMidi(84), 2);
assert.equal(sampler.playbackRateForMidi(60), 0.5);
assert.ok(Math.abs(sampler.playbackRateForMidi(73) - 2 ** (1 / 12)) < 1e-12);
assert.throws(() => sampler.playbackRateForMidi(NaN), /finite/);

assert.equal(Object.keys(sampler.KEY_TO_MIDI).length, 45);
assert.equal(sampler.shiftOctave(0, -1), -1);
assert.equal(sampler.shiftOctave(-4, -1), -4);
assert.equal(sampler.shiftOctave(3, 1), 3);
for (let octave = -4; octave <= 3; octave++) {
  for (const midi of Object.values(sampler.KEY_TO_MIDI)) {
    assert.ok(midi + octave * 12 >= 0 && midi + octave * 12 <= 127);
  }
}

console.log("Sampler core verification passed.");
