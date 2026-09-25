/*
 * Pure keyboard-to-pitch helpers shared by Player Tools and local tests.
 * FL-style physical keyboard: white-note rows plus sharps and duplicate notes.
 */
(() => {
  "use strict";

  const ROOT_MIDI = 72;
  const ROWS = Object.freeze([
    Object.freeze({ keys: "zxcvbnm,./", notes: Object.freeze([60, 62, 64, 65, 67, 69, 71, 72, 74, 76]) }),
    Object.freeze({ keys: "asdfghjkl;'", notes: Object.freeze([59, 61, 63, 64, 66, 68, 70, 72, 73, 75, 77]) }),
    Object.freeze({ keys: "qwertyuiop[]", notes: Object.freeze([72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89, 91]) }),
    Object.freeze({ keys: "1234567890-=", notes: Object.freeze([71, 73, 75, 76, 78, 80, 82, 84, 85, 87, 89, 91]) }),
  ]);
  const KEY_TO_MIDI = Object.freeze(Object.fromEntries(
    ROWS.flatMap(({ keys, notes }) =>
      [...keys].map((key, index) => [key, notes[index]])
    )
  ));

  function midiForKey(key) {
    if (typeof key !== "string" || key.length !== 1) return null;
    const midi = KEY_TO_MIDI[key.toLowerCase()];
    return Number.isInteger(midi) ? midi : null;
  }

  function midiForEvent(event) {
    const punctuation = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=" };
    const key = punctuation[event.code] || (/^Key[A-Z]$/.test(event.code || "")
      ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code || "") ? event.code.slice(5) : event.key);
    return midiForKey(key === "?" ? "/" : key);
  }

  function shiftOctave(octave, direction) {
    return Math.max(-4, Math.min(3, octave + direction));
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
    midiForEvent,
    shiftOctave,
    playbackRateForMidi,
  });
})();
