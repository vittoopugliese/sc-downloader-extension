/* Bounded parametric EQ settings and a reusable native Web Audio graph. */
(() => {
  "use strict";
  const MAX_BANDS = 8;
  const MAX_GAIN_DB = 36;
  const BAND_TYPES = new Set(["peaking", "highpass", "lowpass"]);
  const limit = (value, min, max, fallback) => Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;

  function normalize(value) {
    return {
      enabled: value?.enabled !== false,
      hardClip: value?.hardClip === true,
      bands: (Array.isArray(value?.bands) ? value.bands : []).slice(0, MAX_BANDS).map((band) => ({
        type: BAND_TYPES.has(band?.type) ? band.type : "peaking",
        frequency: limit(band?.frequency, 20, 20000, 1000),
        gain: limit(band?.gain, -MAX_GAIN_DB, MAX_GAIN_DB, 0),
        q: limit(band?.q, 0.1, 18, band?.type === "highpass" || band?.type === "lowpass" ? Math.SQRT1_2 : 1),
      })),
    };
  }

  function validate(value) {
    if (value === undefined || value === null) return normalize(null);
    if (typeof value !== "object" || typeof value.enabled !== "boolean" ||
        (value.hardClip !== undefined && typeof value.hardClip !== "boolean") ||
        !Array.isArray(value.bands) || value.bands.length > MAX_BANDS ||
        value.bands.some((band) => !band ||
          (band.type !== undefined && !BAND_TYPES.has(band.type)) ||
          !Number.isFinite(band.frequency) || band.frequency < 20 || band.frequency > 20000 ||
          !Number.isFinite(band.gain) || band.gain < -MAX_GAIN_DB || band.gain > MAX_GAIN_DB ||
          !Number.isFinite(band.q) || band.q < 0.1 || band.q > 18)) {
      throw new Error("Invalid parametric EQ settings.");
    }
    return normalize(value);
  }

  function isActive(value) {
    const settings = normalize(value);
    return settings.enabled && (settings.hardClip || settings.bands.some((band) => band.type !== "peaking" || band.gain !== 0));
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
    const clean = context.createGain();
    const clipped = context.createGain();
    // A unity-level shaper only changes samples already above full scale. Give
    // the fixed clip control a -8 dB threshold and compensate its input drive.
    const clipDrive = context.createGain();
    clipDrive.gain.value = 2.5;
    const hardClipper = context.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = i / (curve.length - 1) * 2 - 1;
    hardClipper.curve = curve;
    hardClipper.oversample = "4x";
    clean.gain.value = 1;
    clipped.gain.value = 0;
    output.connect(clean);
    output.connect(clipDrive);
    clipDrive.connect(hardClipper);
    hardClipper.connect(clipped);
    const routedOutput = context.createGain();
    clean.connect(routedOutput);
    clipped.connect(routedOutput);
    const analyser = analyse ? context.createAnalyser() : null;
    let meterInput = null;
    if (analyser) {
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0.55;
      // Keep the meter attached if the site disconnects and reconnects its source.
      meterInput = context.createGain();
      clean.connect(meterInput);
      clipped.connect(meterInput);
      meterInput.connect(analyser);
    }
    const spectrum = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    function apply(value, bypassed = false, immediate = false) {
      const settings = normalize(value);
      const active = settings.enabled && !bypassed;
      const clipActive = active && settings.hardClip;
      const set = (param, number) => {
        param.cancelScheduledValues(context.currentTime);
        if (immediate) param.value = number;
        else param.setTargetAtTime(number, context.currentTime, 0.012);
      };
      set(input.gain, 1);
      set(clean.gain, clipActive ? 0 : 1);
      set(clipped.gain, clipActive ? 0.4 : 0);
      filters.forEach((filter, index) => {
        const band = settings.bands[index];
        filter.type = active ? band?.type || "peaking" : "peaking";
        set(filter.frequency, Math.min(band?.frequency || 1000, context.sampleRate * 0.49));
        set(filter.Q, band?.q || 1);
        set(filter.gain, active && filter.type === "peaking" ? band?.gain || 0 : 0);
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
    function dispose() {
      for (const node of [input, ...filters, clean, clipped, clipDrive, hardClipper, routedOutput, meterInput, analyser]) node?.disconnect();
    }
    return { input, output: routedOutput, apply, readSpectrum, response, dispose };
  }

  globalThis.SCParametricEQ = Object.freeze({ MAX_BANDS, MAX_GAIN_DB, normalize, validate, isActive, createGraph });
})();
