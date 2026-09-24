/*
 * Pure keyboard-to-pitch helpers shared by Player Tools and local tests.
 * Rows intentionally start one octave apart: Z=C3, A=C4, Q=C5.
 */
(() => {
  "use strict";

  const ROOT_MIDI = 60;
  const ROWS = Object.freeze([
    Object.freeze({ keys: "zxcvbnm", startMidi: 48 }),
    Object.freeze({ keys: "asdfghjkl", startMidi: 60 }),
    Object.freeze({ keys: "qwertyuiop", startMidi: 72 }),
  ]);
  const KEY_TO_MIDI = Object.freeze(Object.fromEntries(
    ROWS.flatMap(({ keys, startMidi }) =>
      [...keys].map((key, index) => [key, startMidi + index])
    )
  ));

  function midiForKey(key) {
    if (typeof key !== "string" || key.length !== 1) return null;
    const midi = KEY_TO_MIDI[key.toLowerCase()];
    return Number.isInteger(midi) ? midi : null;
  }

  function playbackRateForMidi(midiNote, rootMidi = ROOT_MIDI) {
    const note = Number(midiNote);
    const root = Number(rootMidi);
    if (!Number.isFinite(note) || !Number.isFinite(root)) {
      throw new TypeError("MIDI notes must be finite numbers.");
    }
    return 2 ** ((note - root) / 12);
  }

  globalThis.SCSamplerCore = Object.freeze({
    ROOT_MIDI,
    ROWS,
    KEY_TO_MIDI,
    midiForKey,
    playbackRateForMidi,
  });
})();
