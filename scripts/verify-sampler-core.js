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

assert.equal(sampler.PAD_COUNT, 8);
for (const total of [8, 9, 15, 1003, 48000 * 30 + 1]) {
  const ranges = sampler.sliceRanges(total);
  assert.equal(ranges.length, 8);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges.at(-1).end, total);
  assert.equal(ranges.reduce((sum, range) => sum + range.end - range.start, 0), total);
  ranges.forEach((range, index) => {
    assert.ok(range.end > range.start);
    if (index) assert.equal(range.start, ranges[index - 1].end);
  });
}
for (const invalid of [0, 7, NaN, Infinity, -10, 8.5]) assert.throws(() => sampler.sliceRanges(invalid));

const frames = 1003;
const bytes = new ArrayBuffer(44 + (frames + 200) * 4);
const wav = new DataView(bytes);
for (const [at, value] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]]) {
  [...value].forEach((letter, index) => wav.setUint8(at + index, letter.charCodeAt(0)));
}
wav.setUint32(4, bytes.byteLength - 8, true);
wav.setUint32(16, 16, true);
wav.setUint16(20, 1, true);
wav.setUint16(22, 2, true);
wav.setUint32(24, 8000, true);
wav.setUint16(32, 4, true);
wav.setUint16(34, 16, true);
wav.setUint32(40, bytes.byteLength - 44, true);
for (let i = 0; i < frames + 200; i++) {
  wav.setInt16(44 + i * 4, 10000 + i, true);
  wav.setInt16(46 + i * 4, -10000 - i, true);
}
const slices = sampler.sliceWav(bytes, { startMs: 1000, endMs: 1000 + frames / 8 }, 1);
assert.equal(slices.length, 8);
assert.equal(slices.reduce((sum, slice) => sum + (slice.bytes.byteLength - 44) / 4, 0), frames, "tails after B are excluded");
slices.forEach(slice => {
  const output = new DataView(slice.bytes);
  assert.equal(output.getUint16(22, true), 2);
  assert.equal(output.getUint32(24, true), 8000);
  const length = slice.endFrame - slice.startFrame;
  assert.equal(output.getInt16(44, true), 0);
  assert.equal(output.getInt16(44 + (length - 1) * 4, true), 0);
  const middle = Math.floor(length / 2);
  assert.equal(output.getInt16(44 + middle * 4, true), 10000 + slice.startFrame + middle);
  assert.equal(output.getInt16(46 + middle * 4, true), -10000 - slice.startFrame - middle);
});
assert.throws(() => sampler.sliceWav(bytes, { startMs: 0, endMs: 9999 }, 1), /incomplete/);
assert.throws(() => sampler.sliceWav(new ArrayBuffer(12), { startMs: 0, endMs: 1 }, 1), /Invalid/);
console.log("Eight-slice PCM coverage, channels, fades and tail boundaries passed.");
const shortPad = { startMs: 10, endMs: 50, durationMs: 100 };
assert.equal(sampler.editRange(shortPad, "start", 49).startMs, 49);
assert.equal(sampler.editRange(shortPad, "end", 1000).endMs, 100);
assert.equal(sampler.editRange(shortPad, "selection", 99, 10).startMs, 60);
assert.equal(sampler.editRange(shortPad, "create", 20, 20).endMs, 21);
assert.equal(shortPad.startMs, 10, "editing a pad does not mutate the input range");
console.log("Pad bounds allow short samples, overlaps and clamped gestures.");
