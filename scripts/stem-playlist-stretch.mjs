// Pitch/time stretch of one source range with Signalsmith Stretch. Pure PCM in and
// out, so it runs in a worker. Output length is input / speed; pitch is independent.
// Seek with lookahead compensates the stretcher's input/output latency.
export function stretchChannels(wasm, channels, sampleRate, { pitch, speed }) {
  const count = channels.length, frames = channels[0].length;
  const length = Math.max(1, Math.round(frames / speed));
  const output = Array.from({ length: count }, () => new Float32Array(length));
  wasm._main();
  wasm._configure(2, Math.round(sampleRate * .12), Math.round(sampleRate * .03), true);
  wasm._reset();
  const inLatency = wasm._inputLatency(), outLatency = wasm._outputLatency(), capacity = inLatency + outLatency;
  if (!Number.isSafeInteger(capacity) || capacity < 128 || capacity > sampleRate) throw new Error('Invalid stretch buffer size.');
  const pointer = wasm._setBuffers(2, capacity);
  wasm._setTransposeFactor(2 ** (pitch / 12), 8000 / sampleRate);
  wasm._setFormantSemitones(0, false);
  wasm._setFormantBase(0);
  let previous = null;
  for (let frame = 0; frame < length; frame += 128) {
    const end = Math.round((frame + outLatency) * speed + inLatency);
    const first = previous === null, size = first ? capacity : end - previous, start = first ? end - capacity : previous;
    if (size < 0 || size > capacity) throw new Error('Invalid stretch window.');
    for (let c = 0; c < 2; c++) {
      const input = new Float32Array(wasm.HEAP8.buffer, pointer + c * capacity * 4, capacity), source = channels[Math.min(c, count - 1)];
      for (let i = 0; i < size; i++) { const at = start + i; input[i] = at >= 0 && at < frames ? source[at] : 0; }
    }
    if (first) wasm._seek(capacity, Math.fround(speed));
    wasm._process(first ? 0 : size, 128);
    const block = Math.min(128, length - frame);
    for (let c = 0; c < count; c++) {
      const rendered = new Float32Array(wasm.HEAP8.buffer, pointer + (c + 2) * capacity * 4, block);
      if (!rendered.every(Number.isFinite)) throw new Error('Invalid rendered audio.');
      output[c].set(rendered, frame);
    }
    previous = end;
  }
  return output;
}
