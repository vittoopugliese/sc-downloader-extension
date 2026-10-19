// A passive post-master tap. One canvas, reusable buffers, and at most 30 paints/sec.
// Hidden/idle monitors disconnect their taps and own no animation frame.
export function mountOutputMonitor({ element, output, trackLevel, locale = 'en' }) {
  const modes = ['combined', 'stems', 'spectrum', 'waveform'];
  const copy = {
    en: ['Spectrum + waveform', 'Stems', 'Spectrum', 'Waveform + stereo levels', 'Click to change view'],
    es: ['Espectro + waveform', 'Stems', 'Espectro', 'Waveform + niveles estéreo', 'Clic para cambiar de vista'],
    de: ['Spektrum + Wellenform', 'Stems', 'Spektrum', 'Wellenform + Stereo-Pegel', 'Klicken zum Ansichtswechsel'],
    'pt-BR': ['Espectro + forma de onda', 'Stems', 'Espectro', 'Forma de onda + níveis estéreo', 'Clique para mudar a visualização'],
    ru: ['Спектр + волна', 'Стемы', 'Спектр', 'Волна + стереоуровни', 'Нажмите для смены вида'],
  }[locale] || ['Spectrum + waveform', 'Stems', 'Spectrum', 'Waveform + stereo levels', 'Click to change view'];
  const canvas = element.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  const stems = element.querySelector('.stem-preview');
  const rows = [...stems.querySelectorAll('.preview-track')].map(row => ({
    key: row.dataset.channel, wave: row.querySelector('.preview-wave'), level: 0, value: '',
  }));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fftSize = 8192;
  const bins = new Float32Array(fftSize / 2), left = new Float32Array(2048), right = new Float32Array(2048);
  // One spectrum point per display pixel, bounded independently of the header width.
  // Fractional bin positions keep the bass contour from repeating wide, flat steps.
  const bands = new Float32Array(2048), starts = new Float32Array(2049), compensation = new Float32Array(2048);
  const levels = new Float32Array(2), peaks = new Float32Array(2);
  let mode = 'combined', context, source, spectrum, stereoTap, splitter, lMeter, rMeter;
  let connected = false, frame = 0, active = false, disposed = false, visible = true;
  let width = 1, height = 36, bandCount = 1, dpr = 1, last = 0, quietSince = 0, wakeUntil = 0;
  try { const saved = localStorage.getItem('stems.outputMonitor'); if (modes.includes(saved)) mode = saved; } catch {}
  const drawable = () => !disposed && !document.hidden && visible;
  const dbLevel = peak => peak > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 48) / 48)) : 0;

  function mapSpectrum() {
    const panelWidth = mode === 'combined' ? Math.floor((width - 5) / 2) : width;
    bandCount = Math.max(1, Math.min(bands.length, Math.floor((panelWidth - 8) * dpr)));
    bands.fill(0);
    if (!context) return;
    const high = Math.min(20000, context.sampleRate / 2);
    for (let i = 0; i <= bandCount; i++) {
      const frequency = 25 * (high / 25) ** (i / bandCount);
      starts[i] = Math.min(bins.length - 1, frequency * fftSize / context.sampleRate);
      if (i < bandCount) compensation[i] = 10 * Math.log10(Math.max(1, frequency / (context.sampleRate / 2048)));
    }
  }

  function disconnect() {
    if (!connected) return;
    if (spectrum) { try { source.disconnect(spectrum); } catch {} }
    if (stereoTap) { try { source.disconnect(stereoTap); } catch {} }
    connected = false;
  }
  function connect() {
    if (connected || !source || mode === 'stems') return;
    if (!spectrum) {
      spectrum = context.createAnalyser(); spectrum.fftSize = fftSize; spectrum.smoothingTimeConstant = .45;
      // Match the stereo destination's speaker upmix: mono must light both meters.
      stereoTap = context.createGain(); stereoTap.channelCount = 2; stereoTap.channelCountMode = 'explicit';
      splitter = context.createChannelSplitter(2);
      stereoTap.connect(splitter);
      lMeter = context.createAnalyser(); rMeter = context.createAnalyser();
      lMeter.fftSize = rMeter.fftSize = 2048;
      splitter.connect(lMeter, 0); splitter.connect(rMeter, 1);
      mapSpectrum();
    }
    if (mode !== 'waveform') source.connect(spectrum);
    if (mode !== 'spectrum') source.connect(stereoTap);
    connected = true;
  }
  function panel(x, w) {
    ctx.fillStyle = '#191a1a'; ctx.fillRect(x, 0, w, height);
    ctx.strokeStyle = '#303131'; ctx.strokeRect(x + .5, .5, w - 1, height - 1);
    ctx.fillStyle = '#202121'; ctx.fillRect(x + 3, 3, Math.max(0, w - 6), height - 6);
  }
  function drawSpectrum(x, w) {
    panel(x, w);
    const bottom = height - 4, inner = Math.max(1, w - 8), step = inner / Math.max(1, bandCount - 1);
    ctx.fillStyle = '#777875'; ctx.beginPath(); ctx.moveTo(x + 4, bottom);
    for (let i = 0; i < bandCount; i++) ctx.lineTo(x + 4 + i * step, bottom - bands[i] * (height - 8));
    ctx.lineTo(x + w - 4, bottom); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#cccac6'; ctx.beginPath(); ctx.moveTo(x + 4, bottom);
    for (let i = 0; i < bandCount; i++) ctx.lineTo(x + 4 + i * step, bottom - bands[i] * (height - 10));
    ctx.lineTo(x + w - 4, bottom); ctx.closePath(); ctx.fill();
  }
  function drawWaveform(x, w) {
    const meterWidth = Math.min(100, Math.max(35, w * .24)), waveWidth = Math.max(1, w - meterWidth - 5);
    panel(x, waveWidth); panel(x + waveWidth + 4, meterWidth + 1);
    const inner = Math.max(1, Math.floor(waveWidth - 8)), mid = height / 2, amplitude = (height - 10) / 2;
    ctx.fillStyle = '#454644'; ctx.fillRect(x + 4, mid, inner, 1);
    ctx.fillStyle = '#ceccc8';
    // Signed min/max columns preserve transients, like the playlist waveform renderer.
    // Both channels are included so phase-inverted stereo cannot disappear in a mono sum.
    for (let i = 0; i < inner; i++) {
      const from = Math.floor(i * left.length / inner), to = Math.max(from + 1, Math.floor((i + 1) * left.length / inner));
      let lo = 0, hi = 0;
      for (let j = from; j < to; j++) { lo = Math.min(lo, left[j], right[j]); hi = Math.max(hi, left[j], right[j]); }
      ctx.fillRect(x + 4 + i, mid - Math.min(1, hi) * amplitude, 1, Math.max(.6, (Math.min(1, hi) - Math.max(-1, lo)) * amplitude));
    }
    const mx = x + waveWidth + 8, mw = meterWidth - 7, mh = (height - 11) / 2;
    for (let c = 0; c < 2; c++) {
      const y = 4 + c * (mh + 3);
      ctx.fillStyle = '#2c2d2b'; ctx.fillRect(mx, y, mw, mh);
      ctx.fillStyle = '#bfbdb6'; ctx.fillRect(mx, y, mw * levels[c], mh);
      ctx.fillStyle = '#d4cba3'; ctx.fillRect(mx + mw * .8, y, mw * Math.max(0, levels[c] - .8), mh);
      if (peaks[c] > .01) { ctx.fillStyle = '#eeece4'; ctx.fillRect(mx + Math.min(mw - 1, mw * peaks[c]), y, 1, mh); }
    }
  }
  function paint() {
    if (mode === 'stems') return;
    ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, width, height);
    if (mode === 'combined') { const half = Math.floor((width - 5) / 2); drawSpectrum(0, half); drawWaveform(half + 5, width - half - 5); }
    else if (mode === 'spectrum') drawSpectrum(0, width);
    else drawWaveform(0, width);
  }
  function reset() {
    bins.fill(-Infinity); left.fill(0); right.fill(0); bands.fill(0); levels.fill(0); peaks.fill(0);
    for (const row of rows) { row.level = 0; row.value = '0'; row.wave.style.setProperty('--level', '0'); }
    paint();
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; disconnect(); }
  function tick(now) {
    frame = 0;
    if (!drawable() || context?.state !== 'running') { stop(); return; }
    frame = requestAnimationFrame(tick);
    if (now - last < (reduced.matches ? 1000 / 15 : 1000 / 30)) return;
    const elapsed = Math.min(100, now - last || 33); last = now;
    let signal = 0;
    if (mode === 'stems') {
      for (const row of rows) {
        const peak = trackLevel(row.key); signal = Math.max(signal, peak);
        row.level = Math.max(dbLevel(peak), row.level * Math.exp(-elapsed / 170));
        if (row.level < .01) row.level = 0;
        const value = row.level.toFixed(3);
        if (row.value !== value) { row.wave.style.setProperty('--level', value); row.value = value; }
      }
    } else {
      connect();
      if (mode !== 'waveform') {
        spectrum.getFloatFrequencyData(bins);
        let loudest = -120;
        const decay = Math.exp(-elapsed / 120);
        for (let i = 0; i < bandCount; i++) {
          const from = starts[i], to = starts[i + 1], middle = (from + to) / 2;
          const bin = Math.floor(middle), fraction = middle - bin;
          let db;
          if (to - from < 1) {
            const a = Math.max(-120, bins[bin]), b = Math.max(-120, bins[Math.min(bin + 1, bins.length - 1)]);
            db = a + (b - a) * fraction;
          } else {
            // Preserve narrow peaks instead of averaging them into broad blocks.
            db = -120;
            for (let j = Math.ceil(from); j < to; j++) db = Math.max(db, bins[j]);
          }
          loudest = Math.max(loudest, db);
          // Octave compensation: pink noise reads approximately flat across log bands.
          const target = Math.max(0, Math.min(1, (db + compensation[i] + 72) / 66));
          bands[i] = Math.max(target, bands[i] * decay);
        }
        signal = Math.max(signal, 10 ** (loudest / 20));
      }
      if (mode !== 'spectrum') {
        lMeter.getFloatTimeDomainData(left); rMeter.getFloatTimeDomainData(right);
        let lp = 0, rp = 0;
        for (let i = 0; i < left.length; i++) { lp = Math.max(lp, Math.abs(left[i])); rp = Math.max(rp, Math.abs(right[i])); }
        signal = Math.max(signal, lp, rp);
        levels[0] = Math.max(dbLevel(lp), levels[0] * Math.exp(-elapsed / 180));
        levels[1] = Math.max(dbLevel(rp), levels[1] * Math.exp(-elapsed / 180));
        for (let i = 0; i < 2; i++) peaks[i] = Math.max(levels[i], peaks[i] - elapsed / 1800);
      }
      paint();
    }
    if (active || signal > .0001) quietSince = now;
    else if (now > wakeUntil && now - quietSince > 700) { stop(); reset(); }
  }
  function wake() {
    if (!drawable()) return;
    wakeUntil = performance.now() + 1000;
    if (context?.state === 'running' && !frame) { connect(); last = 0; quietSince = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function showMode() {
    stop(); mapSpectrum(); reset(); element.dataset.mode = mode;
    stems.hidden = mode !== 'stems'; canvas.hidden = mode === 'stems';
    const label = `${copy[modes.indexOf(mode)]} · ${copy[4]}`;
    element.setAttribute('aria-label', label); element.dataset.scdlTooltip = label;
    paint(); if (active) wake();
  }
  function cycle() {
    const wasRunning = !!frame;
    mode = modes[(modes.indexOf(mode) + 1) % modes.length]; showMode();
    if (wasRunning) wake();
    try { localStorage.setItem('stems.outputMonitor', mode); } catch {}
  }
  function keydown(event) {
    // Do not let Space also toggle the song transport.
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) cycle(); }
  }
  function visibility() { if (drawable()) { reset(); wake(); } else stop(); }
  const resize = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    width = Math.max(1, Math.min(2048, Math.round(rect.width))); height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); mapSpectrum(); paint();
  });
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); });
  const stateChanged = () => { if (context.state === 'running') wake(); else { stop(); reset(); } };
  const unobserve = output.observeOutput((audioContext, node) => {
    context = audioContext; source = node; context.addEventListener('statechange', stateChanged); wake();
  }, { prepare: false });
  element.addEventListener('click', cycle); element.addEventListener('keydown', keydown);
  document.addEventListener('visibilitychange', visibility);
  resize.observe(element); intersection.observe(element); showMode();
  return {
    setActive(value) { active = value; if (value) wake(); },
    wake,
    dispose() {
      disposed = true; stop(); unobserve(); resize.disconnect(); intersection.disconnect();
      context?.removeEventListener('statechange', stateChanged); stereoTap?.disconnect(); splitter?.disconnect();
      lMeter?.disconnect(); rMeter?.disconnect(); spectrum?.disconnect();
      element.removeEventListener('click', cycle); element.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
