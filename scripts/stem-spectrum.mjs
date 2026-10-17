// One frequency-colored peak analysis per AudioBuffer, shared by the stem editors
// and the playlist clips. Buffers are never mutated, so a result never goes stale.
const pending = new WeakMap(), ready = new WeakMap();

export function spectrumOf(buffer) {
  let promise = pending.get(buffer);
  if (!promise) {
    promise = globalThis.SCSpectralWaveform.analyze(buffer).then(spectrum => { ready.set(buffer, spectrum); return spectrum; });
    pending.set(buffer, promise);
  }
  return promise;
}

export const spectrumNow = buffer => ready.get(buffer);

// Same mapping as the stem waveforms: bass red, mids green, treble blue. Painters call
// this once per pixel column, so colors are built once and reused.
const colors = new Map();
export function spectrumColor(low, mid, high) {
  const energy = Math.max(low, mid, high);
  if (!(energy > 0)) return '#858d96';
  const r = Math.round(55 + 190 * Math.sqrt(low / energy)), g = Math.round(55 + 190 * Math.sqrt(mid / energy)), b = Math.round(55 + 190 * Math.sqrt(high / energy));
  const key = r << 16 | g << 8 | b;
  let color = colors.get(key);
  if (!color) { color = `rgb(${r},${g},${b})`; if (colors.size < 65536) colors.set(key, color); }
  return color;
}
