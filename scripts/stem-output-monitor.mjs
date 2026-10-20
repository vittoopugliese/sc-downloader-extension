// Passive post-master spectrum. Buffers are reused; hidden/idle views disconnect
// their taps and own no animation frame.
export function mountOutputMonitor({ element, output, locale = 'en' }) {
  const label = {
    en: 'Output frequency spectrum', es: 'Espectro de frecuencias de salida',
    de: 'Ausgangsfrequenzspektrum', 'pt-BR': 'Espectro de frequências de saída', ru: 'Частотный спектр выхода',
  }[locale] || 'Output frequency spectrum';
  element.setAttribute('aria-label', label);
  const canvas = element.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  // Keep analysis windows short: at 44.1 kHz these span 93/23 ms, with their
  // centres only 46/12 ms behind the current sample. Blend across two octaves.
  const analyses = [4096, 1024].map(fftSize => ({
    fftSize, node: null, bins: new Float32Array(fftSize / 2), starts: null, compensation: null,
  }));
  let bands = new Float32Array(0), blend = new Float32Array(0);
  let context, source, connected = false, frame = 0, active = false, disposed = false, visible = true;
  let width = 1, height = 1, dpr = 1, last = 0, quietSince = 0, wakeUntil = 0;
  const drawable = () => !disposed && !document.hidden && visible;

  function mapSpectrum() {
    // Sample at backing-store resolution, including supersampling on 1x displays.
    const count = Math.max(2, Math.ceil(Math.max(1, width - 4) * dpr));
    if (bands.length !== count) {
      bands = new Float32Array(count); blend = new Float32Array(count);
      for (const analysis of analyses) {
        analysis.starts = new Float32Array(count + 1);
        analysis.compensation = new Float32Array(count);
      }
    }
    if (!context) return;
    const high = Math.min(20000, context.sampleRate / 2);
    for (let i = 0; i <= count; i++) {
      const frequency = 25 * (high / 25) ** (i / count);
      if (i < count) blend[i] = Math.max(0, Math.min(1, Math.log2(frequency / 160) / 2));
      for (const analysis of analyses) {
        const binWidth = context.sampleRate / analysis.fftSize;
        analysis.starts[i] = Math.min(analysis.bins.length - 1, frequency / binWidth);
        // Normalize the noise bandwidth so both windows share the same log scale.
        if (i < count) analysis.compensation[i] = 10 * Math.log10(Math.max(1, frequency / binWidth));
      }
    }
  }
  function disconnect() {
    if (!connected) return;
    for (const { node } of analyses) { try { source.disconnect(node); } catch {} }
    connected = false;
  }
  function connect() {
    if (connected || !source) return;
    for (const analysis of analyses) {
      if (!analysis.node) {
        analysis.node = context.createAnalyser(); analysis.node.fftSize = analysis.fftSize;
        // One time-based release below; no second smoothing stage delaying attacks.
        analysis.node.smoothingTimeConstant = 0;
      }
      source.connect(analysis.node);
    }
    connected = true;
  }
  function paint() {
    ctx.fillStyle = '#191a1a'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#303131'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, width - 1, height - 1);
    ctx.fillStyle = '#202121'; ctx.fillRect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2));
    const bottom = height - 2, inner = Math.max(1, width - 4), amplitude = Math.max(0, height - 4);
    const step = inner / Math.max(1, bands.length - 1);
    ctx.beginPath();
    for (let i = 0; i < bands.length; i++) {
      const x = 2 + i * step, y = bottom - bands[i] * amplitude;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = '#dddcd7'; ctx.lineWidth = .65; ctx.stroke();
    ctx.lineTo(width - 2, bottom); ctx.lineTo(2, bottom); ctx.closePath();
    ctx.fillStyle = '#bbb9b4'; ctx.fill();
  }
  function reset() {
    for (const { bins } of analyses) bins.fill(-Infinity);
    bands.fill(0); paint();
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; disconnect(); }
  function bandDb(analysis, i) {
    const { bins, starts } = analysis, from = starts[i], to = starts[i + 1];
    if (to - from < 1) {
      const middle = (from + to) / 2, bin = Math.floor(middle), fraction = middle - bin;
      const a = Math.max(-120, bins[bin]), b = Math.max(-120, bins[Math.min(bin + 1, bins.length - 1)]);
      return a + (b - a) * fraction;
    }
    // Keep narrow peaks when several FFT bins land in the same display pixel.
    let db = -120;
    for (let bin = Math.ceil(from); bin < to; bin++) db = Math.max(db, bins[bin]);
    return db;
  }
  function tick(now) {
    frame = 0;
    if (!drawable() || context?.state !== 'running') { stop(); return; }
    frame = requestAnimationFrame(tick);
    const elapsed = Math.min(100, last ? now - last : 1000 / 60); last = now;
    connect();
    for (const { node, bins } of analyses) node.getFloatFrequencyData(bins);
    // Instant attacks, with a longer release so short sounds remain readable.
    const [bass, fast] = analyses, decay = Math.exp(-elapsed / 85);
    let loudest = -120;
    for (let i = 0; i < bands.length; i++) {
      const mix = blend[i];
      const low = mix < 1 ? bandDb(bass, i) : -120;
      const high = mix > 0 ? bandDb(fast, i) : -120;
      loudest = Math.max(loudest, low, high);
      const db = (low + bass.compensation[i]) * (1 - mix) + (high + fast.compensation[i]) * mix;
      const target = Math.max(0, Math.min(1, (db + 72) / 72));
      bands[i] = Math.max(target, bands[i] * decay);
    }
    paint();
    if (active || loudest > -80) quietSince = now;
    else if (now > wakeUntil && now - quietSince > 700) { stop(); reset(); }
  }
  function wake() {
    if (!drawable()) return;
    wakeUntil = performance.now() + 1000;
    if (context?.state === 'running' && !frame) { connect(); last = 0; quietSince = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function visibility() { if (drawable()) { reset(); wake(); } else stop(); }
  const resize = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    dpr = Math.max(2, devicePixelRatio || 1);
    canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0); mapSpectrum(); paint();
  });
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); });
  const stateChanged = () => { if (context.state === 'running') wake(); else { stop(); reset(); } };
  const unobserve = output.observeOutput((audioContext, node) => {
    stop(); context?.removeEventListener('statechange', stateChanged);
    for (const analysis of analyses) { analysis.node?.disconnect(); analysis.node = null; }
    context = audioContext; source = node; mapSpectrum(); reset();
    context.addEventListener('statechange', stateChanged); wake();
  }, { prepare: false });
  document.addEventListener('visibilitychange', visibility);
  resize.observe(element); intersection.observe(element); mapSpectrum(); reset();
  return {
    setActive(value) { active = value; if (value) wake(); },
    wake,
    dispose() {
      disposed = true; stop(); unobserve(); resize.disconnect(); intersection.disconnect();
      context?.removeEventListener('statechange', stateChanged);
      for (const { node } of analyses) node?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
