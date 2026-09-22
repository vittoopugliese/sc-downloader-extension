/* Bounded parametric EQ settings and a reusable native Web Audio graph. */
(() => {
  "use strict";
  const MAX_BANDS = 8;
  const limit = (value, min, max, fallback) => Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;

  function normalize(value) {
    return {
      enabled: value?.enabled !== false,
      bands: (Array.isArray(value?.bands) ? value.bands : []).slice(0, MAX_BANDS).map((band) => ({
        frequency: limit(band?.frequency, 20, 20000, 1000),
        gain: limit(band?.gain, -18, 18, 0),
        q: limit(band?.q, 0.1, 18, 1),
      })),
    };
  }

  function validate(value) {
    if (value === undefined || value === null) return normalize(null);
    if (typeof value !== "object" || typeof value.enabled !== "boolean" ||
        !Array.isArray(value.bands) || value.bands.length > MAX_BANDS ||
        value.bands.some((band) => !band ||
          !Number.isFinite(band.frequency) || band.frequency < 20 || band.frequency > 20000 ||
          !Number.isFinite(band.gain) || band.gain < -18 || band.gain > 18 ||
          !Number.isFinite(band.q) || band.q < 0.1 || band.q > 18)) {
      throw new Error("Invalid parametric EQ settings.");
    }
    return normalize(value);
  }

  function isActive(value) {
    const settings = normalize(value);
    return settings.enabled && settings.bands.some((band) => band.gain !== 0);
  }

  function createGraph(context, { analyse = false } = {}) {
    const input = context.createGain();
    const filters = Array.from({ length: MAX_BANDS }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      filter.gain.value = 0;
      return filter;
    });
    let output = input;
    for (const filter of filters) { output.connect(filter); output = filter; }
    const routedOutput = context.createGain();
    output.connect(routedOutput);
    const analyser = analyse ? context.createAnalyser() : null;
    if (analyser) {
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0.55;
      // Keep the meter attached if the site disconnects and reconnects its source.
      output.connect(analyser);
    }
    const spectrum = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    function apply(value, bypassed = false, immediate = false) {
      const settings = normalize(value);
      const active = settings.enabled && !bypassed;
      const set = (param, number) => {
        param.cancelScheduledValues(context.currentTime);
        if (immediate) param.value = number;
        else param.setTargetAtTime(number, context.currentTime, 0.012);
      };
      set(input.gain, 1);
      filters.forEach((filter, index) => {
        const band = settings.bands[index];
        set(filter.frequency, Math.min(band?.frequency || 1000, context.sampleRate * 0.49));
        set(filter.Q, band?.q || 1);
        set(filter.gain, active ? band?.gain || 0 : 0);
      });
    }
    function readSpectrum() {
      if (!analyser) return null;
      analyser.getFloatFrequencyData(spectrum);
      return { values: spectrum, sampleRate: context.sampleRate, fftSize: analyser.fftSize };
    }
    function response(frequencies) {
      const result = new Float32Array(frequencies.length);
      const magnitude = new Float32Array(frequencies.length);
      const phase = new Float32Array(frequencies.length);
      for (const filter of filters) {
        filter.getFrequencyResponse(frequencies, magnitude, phase);
        for (let i = 0; i < result.length; i++) result[i] += 20 * Math.log10(Math.max(1e-9, magnitude[i]));
      }
      return result;
    }
    return { input, output: routedOutput, apply, readSpectrum, response };
  }

  globalThis.SCParametricEQ = Object.freeze({ MAX_BANDS, normalize, validate, isActive, createGraph });
})();
