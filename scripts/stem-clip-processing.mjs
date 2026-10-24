// Peak normalization shares one multiplier across both channels, preserving stereo
// balance. Source buffers are immutable and cached by identity, not copied.
const peaks = new WeakMap();
export function normalizationGain(buffer, targetDb = -1) {
  let peak = peaks.get(buffer);
  if (peak === undefined) {
    peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
    }
    peaks.set(buffer, peak);
  }
  return peak > 1e-6 ? Math.min(1e6, 10 ** (targetDb / 20) / peak) : 1;
}
