/*
 * Pure keyboard-to-pitch helpers shared by Player Tools and local tests.
 * FL-style physical keyboard: white-note rows plus sharps and duplicate notes.
 */
(() => {
  "use strict";

  const ROOT_MIDI = 72;
  const PAD_COUNT = 8;

  function editRange(range, kind, timeMs, anchorMs = 0) {
    const { durationMs } = range;
    if (!Number.isFinite(durationMs) || durationMs < 1 || !Number.isFinite(timeMs)) return null;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    let { startMs, endMs } = range;
    if (kind === "create") {
      startMs = clamp(Math.min(anchorMs, timeMs), 0, durationMs - 1);
      endMs = clamp(Math.max(anchorMs, timeMs), startMs + 1, durationMs);
    } else if (kind === "selection") {
      const length = endMs - startMs;
      startMs = clamp(startMs + timeMs - anchorMs, 0, durationMs - length);
      endMs = startMs + length;
    } else if (kind === "start") startMs = clamp(timeMs, 0, endMs - 1);
    else if (kind === "end") endMs = clamp(timeMs, startMs + 1, durationMs);
    return { startMs, endMs, durationMs };
  }

  function cropWav(bytes, startMs, endMs) {
    const input = new DataView(bytes);
    const sampleRate = input.getUint32(24, true);
    const blockSize = input.getUint16(32, true);
    const totalFrames = input.getUint32(40, true) / blockSize;
    const start = Math.max(0, Math.min(totalFrames - 1, Math.round(startMs * sampleRate / 1000)));
    const end = Math.max(start + 1, Math.min(totalFrames, Math.round(endMs * sampleRate / 1000)));
    const length = end - start;
    const result = new ArrayBuffer(44 + length * blockSize);
    new Uint8Array(result).set(new Uint8Array(bytes, 0, 44));
    new Uint8Array(result, 44).set(new Uint8Array(bytes, 44 + start * blockSize, length * blockSize));
    const output = new DataView(result);
    output.setUint32(4, result.byteLength - 8, true);
    output.setUint32(40, length * blockSize, true);
    const fade = Math.min(Math.round(sampleRate * .003), Math.floor(length / 2));
    for (let frame = 0; frame < fade; frame++) {
      const gain = fade > 1 ? frame / (fade - 1) : 0;
      for (let channel = 0; channel < blockSize / 2; channel++) {
        for (const at of [44 + frame * blockSize + channel * 2,
          44 + (length - 1 - frame) * blockSize + channel * 2]) {
          output.setInt16(at, Math.round(output.getInt16(at, true) * gain), true);
        }
      }
    }
    return result;
  }

  function sliceRanges(totalFrames) {
    if (!Number.isSafeInteger(totalFrames) || totalFrames < PAD_COUNT) {
      throw new RangeError("The loop is too short for eight slices.");
    }
    return Array.from({ length: PAD_COUNT }, (_, index) => ({
      start: Math.floor(totalFrames * index / PAD_COUNT),
      end: Math.floor(totalFrames * (index + 1) / PAD_COUNT),
    }));
  }

  // Split the canonical PCM16 WAV produced by SCDownload.encodeWavSegment.
  // Keeping PCM frames avoids another decode/resample and preserves exact edges.
  function sliceWav(bytes, trimRange, rate) {
    const view = new DataView(bytes);
    const text = (at, length) => String.fromCharCode(...new Uint8Array(bytes, at, length));
    if (bytes.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 8) !== "WAVEfmt " ||
        text(36, 4) !== "data" || view.getUint32(16, true) !== 16 ||
        view.getUint16(20, true) !== 1 || view.getUint16(34, true) !== 16) {
      throw new Error("Invalid rendered loop audio.");
    }
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const blockSize = channels * 2;
    const dataLength = view.getUint32(40, true);
    if (![1, 2].includes(channels) || sampleRate < 1 || sampleRate > 192000 ||
        view.getUint16(32, true) !== blockSize || dataLength % blockSize ||
        44 + dataLength !== bytes.byteLength || !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(trimRange?.startMs) || !Number.isFinite(trimRange?.endMs) ||
        trimRange.startMs < 0 || trimRange.endMs <= trimRange.startMs) {
      throw new Error("Invalid rendered loop audio.");
    }
    // Match the loop renderer's frame rounding, excluding any reverb/echo tail
    // beyond B: slices always cover exactly the selected, transformed region.
    const selectedFrames = Math.ceil((Math.ceil(trimRange.endMs / 1000 * sampleRate) -
      Math.floor(trimRange.startMs / 1000 * sampleRate)) / rate);
    if (selectedFrames > dataLength / blockSize) throw new Error("The rendered loop is incomplete.");
    return sliceRanges(selectedFrames).map(({ start, end }) => {
      const length = end - start;
      const result = new ArrayBuffer(44 + length * blockSize);
      new Uint8Array(result).set(new Uint8Array(bytes, 0, 44));
      new Uint8Array(result, 44).set(new Uint8Array(bytes, 44 + start * blockSize, length * blockSize));
      const output = new DataView(result);
      output.setUint32(4, result.byteLength - 8, true);
      output.setUint32(40, length * blockSize, true);
      const fade = Math.min(Math.round(sampleRate * .003), Math.floor(length / 2));
      for (let frame = 0; frame < fade; frame++) {
        const gain = fade > 1 ? frame / (fade - 1) : 0;
        for (let channel = 0; channel < channels; channel++) {
          for (const at of [44 + frame * blockSize + channel * 2,
            44 + (length - 1 - frame) * blockSize + channel * 2]) {
            output.setInt16(at, Math.round(output.getInt16(at, true) * gain), true);
          }
        }
      }
      return { bytes: result, startFrame: start, endFrame: end, sampleRate };
    });
  }
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
    PAD_COUNT,
    cropWav,
    editRange,
    sliceRanges,
    sliceWav,
    ROOT_MIDI,
    ROWS,
    KEY_TO_MIDI,
    midiForKey,
    midiForEvent,
    shiftOctave,
    playbackRateForMidi,
  });
})();
