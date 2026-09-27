/* Frequency-colored peak envelopes. Analysis never touches the playback graph. */
(() => {
  "use strict";
  async function analyze(buffer, signal) {
    const size = Math.max(1, Math.ceil(Math.max(buffer.sampleRate * .005, buffer.length / 65536)));
    const count = Math.ceil(buffer.length / size);
    const peaks = new Float32Array(count);
    const bands = new Float32Array(count * 3);
    // Complementary one-pole crossovers: bass <250 Hz, treble >4 kHz.
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 250 / buffer.sampleRate);
    const highAlpha = 1 - Math.exp(-2 * Math.PI * 4000 / buffer.sampleRate);
    for (let channel = 0; channel < Math.min(buffer.numberOfChannels, 2); channel += 1) {
      const pcm = buffer.getChannelData(channel);
      let low = 0, belowHigh = 0;
      for (let bin = 0; bin < count; bin += 1) {
        if (bin % 1024 === 0) {
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const end = Math.min(pcm.length, (bin + 1) * size);
        let bass = 0, mid = 0, treble = 0;
        for (let frame = bin * size; frame < end; frame += 1) {
          const value = pcm[frame];
          low += lowAlpha * (value - low);
          belowHigh += highAlpha * (value - belowHigh);
          bass += low * low;
          mid += (belowHigh - low) ** 2;
          treble += (value - belowHigh) ** 2;
          peaks[bin] = Math.max(peaks[bin], Math.abs(value));
        }
        // Sum channel energies, avoiding cancellation in out-of-phase stereo.
        bands[bin * 3] += bass;
        bands[bin * 3 + 1] += mid;
        bands[bin * 3 + 2] += treble;
      }
    }
    return { peaks: Array.from(peaks), bands: Array.from(bands), durationMs: buffer.length / buffer.sampleRate * 1000 };
  }
  // Keep the established full-buffer analysis below its 256 MiB stereo budget.
  function needsStreaming(durationMs) {
    return Number(durationMs) / 1000 * 48000 * 2 * 4 > 256 * 1024 * 1024;
  }
  globalThis.SCSpectralWaveform = { analyze, needsStreaming };
})();
