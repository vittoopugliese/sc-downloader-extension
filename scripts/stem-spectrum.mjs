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

// Same mapping as the stem waveforms: bass red, mids green, treble blue.
export function spectrumColor(low, mid, high) {
  const energy = Math.max(low, mid, high);
  return energy > 0 ? `rgb(${[low, mid, high].map(value => Math.round(55 + 190 * Math.sqrt(value / energy))).join(',')})` : '#858d96';
}
