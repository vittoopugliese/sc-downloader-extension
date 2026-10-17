const KEYS = 'ASDFGHJK';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Seconds into the shared, immutable drum buffer. Numeric entries are old presets.
export function normalizeDrumSlice(value, buffer) {
  if (typeof value === 'number') value = { start: value };
  if (!Number.isFinite(value?.start) || value.start < 0 || value.start >= buffer.duration) return null;
  const frame = 1 / buffer.sampleRate, snap = time => Math.round(time * buffer.sampleRate) / buffer.sampleRate;
  const start = clamp(snap(value.start), 0, buffer.duration - frame);
  const end = clamp(snap(Number.isFinite(value.end) ? value.end : start + .154), start + frame, buffer.duration);
  const length = end - start, minimum = Math.min(.001, length / 2);
  let fadeIn = clamp(Number.isFinite(value.fadeIn) ? value.fadeIn : .003, minimum, length);
  let fadeOut = clamp(Number.isFinite(value.fadeOut) ? value.fadeOut : .03, minimum, length);
  if (fadeIn + fadeOut > length) {
    fadeIn = clamp(length * fadeIn / (fadeIn + fadeOut), minimum, length - minimum);
    fadeOut = length - fadeIn;
  }
  return { start, end, fadeIn, fadeOut };
}

export function editDrumSlice(slice, kind, time, buffer) {
  if (!slice || !Number.isFinite(time)) return slice;
  const next = { ...slice }, length = slice.end - slice.start;
  const minimum = Math.min(.001, length / 2);
  if (kind === 'start') next.start = clamp(time, 0, slice.end - 1 / buffer.sampleRate);
  else if (kind === 'end') next.end = clamp(time, slice.start + 1 / buffer.sampleRate, buffer.duration);
  else if (kind === 'fadeIn') next.fadeIn = clamp(time - slice.start, minimum, length - slice.fadeOut);
  else if (kind === 'fadeOut') next.fadeOut = clamp(slice.end - time, minimum, length - slice.fadeIn);
  return normalizeDrumSlice(next, buffer);
}

export function scheduleDrumEnvelope(param, slice, now) {
  const length = slice.end - slice.start;
  param.setValueAtTime(0, now); param.linearRampToValueAtTime(1, now + slice.fadeIn);
  param.setValueAtTime(1, now + Math.max(slice.fadeIn, length - slice.fadeOut));
  param.linearRampToValueAtTime(0, now + length);
}

// Slicex-style auto-slicing, sized for the main thread: one pass of one-pole band
// splits (no FFT), log-energy flux, adaptive peak picking, then the strongest
// distinct hits are kept and mapped to the keys in time order.
const HOP = 256, BANDS = [150, 2500];
export function detectDrumSlices(buffer, { startMs = 0, endMs = buffer.duration * 1000, count = KEYS.length } = {}) {
  const rate = buffer.sampleRate, channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const first = clamp(Math.floor(startMs / 1000 * rate), 0, buffer.length);
  const last = clamp(Math.ceil(endMs / 1000 * rate), first, buffer.length);
  // Four frames of pre-roll settle the filters, so a hit on the loop's first sample is still a rise.
  const origin = Math.max(0, first - 4 * HOP), frames = Math.floor((last - origin) / HOP);
  if (frames < 8) return [];
  const sample = i => { let x = 0; for (const data of channels) x += data[i]; return x / channels.length; };
  // Hot loop reads at most two typed arrays; other layouts are downmixed once.
  const [left, right] = channels.length <= 2 ? channels : [Float32Array.from({ length: buffer.length }, (_, i) => sample(i))];
  // Bands run on sample pairs (half rate): attacks keep their detail, the hot loop halves.
  const [aLow, aHigh] = BANDS.map(hz => 1 - Math.exp(-4 * Math.PI * hz / rate));
  const energy = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  let low = 0, smooth = 0;
  for (let f = 0, i = origin; f < frames; f++) {
    let el = 0, em = 0, eh = 0;
    for (const end = i + HOP; i < end; i += 2) {
      const x = right ? (left[i] + left[i + 1] + right[i] + right[i + 1]) * .25 : (left[i] + left[i + 1]) * .5;
      low += aLow * (x - low); smooth += aHigh * (x - smooth);
      const mid = smooth - low, high = x - smooth;
      el += low * low; em += mid * mid; eh += high * high;
    }
    energy[0][f] = Math.log1p(el * 2e4 / HOP); energy[1][f] = Math.log1p(em * 2e4 / HOP); energy[2][f] = Math.log1p(eh * 2e4 / HOP);
  }
  // A two-frame lag keeps a hit that straddles frames as one peak.
  const flux = new Float32Array(frames), rise = f => energy.map(band => Math.max(0, band[f] - band[Math.max(0, f - 2)]));
  let peak = 0;
  for (let f = 1; f < frames; f++) { flux[f] = rise(f).reduce((a, b) => a + b, 0); peak = Math.max(peak, flux[f]); }
  if (!peak) return [];
  const near = Math.round(.06 * rate / HOP), wide = Math.round(.1 * rate / HOP), firstFrame = Math.floor((first - origin) / HOP) - 1;
  const onsets = [];
  for (let f = Math.max(1, firstFrame); f < frames; f++) {
    let mean = 0, n = 0, isPeak = flux[f] > .08 * peak;
    for (let k = Math.max(1, f - wide); isPeak && k <= Math.min(frames - 1, f + wide); k++) {
      mean += flux[k]; n++;
      if (Math.abs(k - f) <= near && (flux[k] > flux[f] || (flux[k] === flux[f] && k < f))) isPeak = false;
    }
    if (isPeak && flux[f] > 1.5 * mean / n) onsets.push({ frame: f, strength: flux[f], profile: rise(f) });
  }
  // Sample-accurate start: first crossing of a quarter of the attack above the floor, then back to a zero crossing.
  const at = frame => origin + frame * HOP;
  for (const onset of onsets) {
    const from = Math.max(origin, at(onset.frame - 2)), to = Math.min(last, at(onset.frame + 1) + Math.round(.01 * rate));
    let floor = 0, top = 0;
    for (let i = Math.max(0, from - HOP); i < from; i++) floor = Math.max(floor, Math.abs(sample(i)));
    for (let i = from; i < to; i++) top = Math.max(top, Math.abs(sample(i)));
    let start = from;
    while (start < to - 1 && Math.abs(sample(start)) < floor + .25 * (top - floor)) start++;
    for (const stop = Math.max(first, start - Math.round(.003 * rate)); start > stop && sample(start) * sample(start - 1) > 0;) start--;
    onset.start = Math.max(first, start);
  }
  // Keep the strongest hits, discounting ones that sound like a hit already kept.
  const similarity = (a, b) => {
    const dot = a.reduce((sum, x, i) => sum + x * b[i], 0), norm = Math.hypot(...a) * Math.hypot(...b);
    return norm ? dot / norm : 0;
  };
  const chosen = [], pool = [...onsets];
  while (chosen.length < count && pool.length) {
    let best = 0, score = -Infinity;
    pool.forEach((onset, i) => {
      const value = onset.strength * (1.2 - Math.max(0, ...chosen.map(other => similarity(onset.profile, other.profile))));
      if (value > score) { score = value; best = i; }
    });
    chosen.push(...pool.splice(best, 1));
  }
  chosen.sort((a, b) => a.start - b.start);
  // Each cut ends at the next detected hit, as Slicex regions do, capped at one second.
  return chosen.map(onset => {
    const next = onsets.find(other => other.start > onset.start + .02 * rate)?.start ?? last;
    const end = Math.min(next, last, onset.start + rate) / rate, start = onset.start / rate;
    return normalizeDrumSlice({ start, end, fadeIn: .001, fadeOut: Math.min(.02, (end - start) * .3) }, buffer);
  });
}

// Eight pads cut from one buffer. Each pad owns its trim and envelope; no pad depends
// on its neighbor. Markers, regions and handles live on `waveform`; the host draws the
// pad buttons and reads `state()` in `onRender`. An armed pad takes its sample from
// the next click (default length) or drag (selection) on the waveform; otherwise a
// drag re-cuts the selected pad, and a plain click changes nothing.
export function mountPadSampler({ waveform, buffer, timeline, audioContext, output, changed, saved, locale, report,
  keyboardActive = () => true, onRender = () => {}, defaultLength = .154 }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const slices = Array.from({ length: KEYS.length }, (_, i) => normalizeDrumSlice(saved?.[i], buffer));
  const controller = new AbortController(), options = { signal: controller.signal };
  let selected = 0, armed = null, disposed = false, drag = null;
  const voices = new Map(), liveVoices = new Set(), revisions = Array(KEYS.length).fill(0), active = new Set();
  const markers = [], regions = [], envelopes = [], handles = [];
  const milliseconds = seconds => `${(seconds * 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;
  const labels = { start: pt('Sample start'), end: pt('Sample end'), fadeIn: pt('Fade in'), fadeOut: pt('Fade out') };
  const state = () => ({ slices: slices.map(slice => slice && { ...slice }), selected, armed, playing: new Set(active) });

  function render() {
    if (disposed) return;
    waveform.classList.toggle('is-placing-pad', armed !== null);
    slices.forEach((slice, i) => {
      const current = selected === i;
      const x = slice ? timeline.percent(slice.start * 1000) : -1, end = slice ? timeline.percent(slice.end * 1000) : -1;
      markers[i].hidden = !slice || x < 0 || x > 100;
      markers[i].style.left = `${x}%`; markers[i].dataset.start = String(slice?.start ?? null);
      markers[i].classList.toggle('is-selected', current);
      regions[i].hidden = !slice || end < 0 || x > 100;
      regions[i].classList.toggle('is-selected', current);
      regions[i].style.left = `${x}%`; regions[i].style.width = `${Math.max(0, end - x)}%`;
      if (!slice) return;
      const length = slice.end - slice.start;
      regions[i].dataset.end = String(slice.end);
      regions[i].dataset.fadeIn = String(slice.fadeIn); regions[i].dataset.fadeOut = String(slice.fadeOut);
      envelopes[i].setAttribute('points', `0,100 ${slice.fadeIn / length * 1000},35 ${1000 - slice.fadeOut / length * 1000},35 1000,100`);
      for (const [kind, handle] of Object.entries(handles[i])) {
        const position = kind === 'start' ? slice.start : kind === 'end' ? slice.end :
          kind === 'fadeIn' ? slice.start + slice.fadeIn : slice.end - slice.fadeOut;
        const value = kind.startsWith('fade') ? slice[kind] : position;
        const minimum = kind.startsWith('fade') ? Math.min(.001, length / 2) : kind === 'end' ? slice.start + 1 / buffer.sampleRate : 0;
        const maximum = kind === 'fadeIn' ? length - slice.fadeOut : kind === 'fadeOut' ? length - slice.fadeIn :
          kind === 'start' ? slice.end - 1 / buffer.sampleRate : buffer.duration;
        if (kind !== 'start') handle.style.left = `${(position - slice.start) / length * 100}%`;
        handle.hidden = kind !== 'start' && (!current || timeline.percent(position * 1000) < 0 || timeline.percent(position * 1000) > 100);
        handle.setAttribute('aria-label', `${KEYS[i]} · ${labels[kind]}`);
        handle.setAttribute('aria-valuemin', String(minimum * 1000)); handle.setAttribute('aria-valuemax', String(maximum * 1000));
        handle.setAttribute('aria-valuenow', String(value * 1000)); handle.setAttribute('aria-valuetext', milliseconds(value));
        handle.dataset.scdlTooltip = `${KEYS[i]} · ${labels[kind]}: ${milliseconds(value)}`;
      }
    });
    onRender(state());
  }
  function emit() { if (!disposed) changed(slices.map(slice => slice && { ...slice })); }
  // Detected hits of the visible audio; with `force` false only empty pads are filled.
  function autoSlice(force = false) {
    if (!force && slices.some(Boolean)) return false;
    const { startMs, endMs } = timeline.viewport();
    const found = detectDrumSlices(buffer, { startMs, endMs, count: KEYS.length });
    if (!found.length) return false;
    slices.forEach((_, i) => { slices[i] = found[i] ?? null; revisions[i]++; stop(i); });
    selected = 0; armed = null; render(); emit(); return true;
  }
  function stop(i) {
    const voice = voices.get(i); if (!voice) return;
    voices.delete(i); active.delete(i);
    const now = voice.source.context.currentTime;
    voice.envelope.gain.cancelAndHoldAtTime(now);
    voice.envelope.gain.linearRampToValueAtTime(0, now + .003);
    voice.source.stop(now + .003);
  }
  async function trigger(i) {
    if (!slices[i]) return;
    const version = ++revisions[i];
    let voice;
    try {
      const context = audioContext(); await context.resume();
      if (disposed || version !== revisions[i]) return;
      stop(i);
      const slice = slices[i], length = slice.end - slice.start, now = context.currentTime;
      const source = context.createBufferSource(), envelope = context.createGain();
      source.buffer = buffer;
      scheduleDrumEnvelope(envelope.gain, slice, now);
      voice = { source, envelope, cleanup() {
        envelope.disconnect(); source.disconnect(); liveVoices.delete(voice);
        if (voices.get(i) === voice) { voices.delete(i); active.delete(i); render(); }
      } };
      liveVoices.add(voice); voices.set(i, voice); active.add(i);
      source.onended = voice.cleanup;
      source.connect(envelope).connect(output());
      source.start(now, slice.start, length); render();
    } catch (error) { voice?.cleanup(); report(error); }
  }
  function update(i, kind, time) {
    slices[i] = editDrumSlice(slices[i], kind, time, buffer);
    revisions[i]++; stop(i); render();
  }
  function makeHandle(i, kind) {
    const handle = document.createElement('button'); handle.type = 'button';
    handle.className = `stem-sample-handle stem-sample-${kind}`;
    handle.dataset.sampleHandle = kind; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-orientation', 'horizontal');
    if (kind === 'start') handle.textContent = KEYS[i];
    else handle.append(globalThis.SCIcons.create(({ end: 'fit', fadeIn: 'fade-in', fadeOut: 'fade-out' })[kind]));
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      // Freeze coordinates while dragging, including at clipped/zoomed boundaries.
      drag = { i, kind, id: event.pointerId, x: event.clientX, rect: waveform.getBoundingClientRect(), viewport: { ...timeline.viewport() }, moved: false };
      selected = i; armed = null; handle.focus({ preventScroll: true }); handle.setPointerCapture(event.pointerId); render();
    }, options);
    handle.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId || drag.selection) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x) < 2) return;
      drag.moved = true;
      update(i, kind, (drag.viewport.startMs + (event.clientX - drag.rect.left) / drag.rect.width * (drag.viewport.endMs - drag.viewport.startMs)) / 1000);
    }, options);
    const finish = event => {
      if (drag?.id !== event.pointerId || drag.selection) return;
      const moved = drag.moved; drag = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (moved) emit();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish, options);
    handle.addEventListener('click', event => { event.stopPropagation(); selected = i; armed = null; render(); }, options);
    handle.addEventListener('dblclick', event => { event.stopPropagation(); }, options);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); selected = i; armed = null;
      const slice = slices[i];
      const next = event.key === 'Home' ? Number(handle.getAttribute('aria-valuemin')) / 1000 :
        event.key === 'End' ? Number(handle.getAttribute('aria-valuemax')) / 1000 :
          slice[kind] + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1) * (event.shiftKey ? .01 : .001);
      update(i, kind, kind === 'fadeIn' ? slice.start + next : kind === 'fadeOut' ? slice.end - next : next); emit();
    }, options);
    return handle;
  }
  for (let i = 0; i < KEYS.length; i++) {
    const marker = document.createElement('span'); marker.className = 'stem-pad-marker';
    const region = document.createElement('div'); region.className = 'stem-pad-region';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const envelope = document.createElementNS(svg.namespaceURI, 'polyline'); svg.append(envelope); region.append(svg);
    const controls = Object.fromEntries(['start', 'end', 'fadeIn', 'fadeOut'].map(kind => [kind, makeHandle(i, kind)]));
    marker.append(controls.start); region.append(controls.end, controls.fadeIn, controls.fadeOut);
    waveform.append(region, marker); markers.push(marker); regions.push(region); envelopes.push(envelope); handles.push(controls);
  }
  const time = event => clamp((drag.viewport.startMs + (event.clientX - drag.rect.left) / drag.rect.width *
    (drag.viewport.endMs - drag.viewport.startMs)) / 1000, 0, buffer.duration - 1 / buffer.sampleRate);
  waveform.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.stem-sample-handle')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    drag = { selection: true, armed: armed !== null, i: armed ?? selected, id: event.pointerId, x: event.clientX, rect: waveform.getBoundingClientRect(),
      viewport: { ...timeline.viewport() }, previous: slices[armed], moved: false };
    drag.anchor = time(event); waveform.setPointerCapture(event.pointerId);
  }, options);
  waveform.addEventListener('pointermove', event => {
    if (!drag?.selection || drag.id !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.x) < 3 && !drag.moved) return;
    drag.moved = true;
    slices[drag.i] = normalizeDrumSlice({ start: Math.min(drag.anchor, time(event)), end: Math.max(drag.anchor, time(event)) }, buffer);
    render();
  }, options);
  const finishSelection = event => {
    if (!drag?.selection || drag.id !== event.pointerId) return;
    const gesture = drag; drag = null;
    if (waveform.hasPointerCapture(event.pointerId)) waveform.releasePointerCapture(event.pointerId);
    if (!gesture.moved && !gesture.armed) return;
    if (event.type === 'pointercancel') slices[gesture.i] = gesture.previous;
    else if (!gesture.moved) slices[gesture.i] = normalizeDrumSlice({ start: gesture.anchor, end: gesture.anchor + defaultLength }, buffer);
    revisions[gesture.i]++; stop(gesture.i); armed = null; render();
    if (event.type !== 'pointercancel') { emit(); trigger(gesture.i); }
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) waveform.addEventListener(type, finishSelection, options);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || document.querySelector('dialog[open]') ||
      event.target.closest?.('input,textarea,select,[contenteditable="true"]') || !keyboardActive(event)) return;
    if (event.key === 'Escape') { if (armed !== null) { armed = null; render(); } return; }
    const index = KEYS.indexOf(event.code?.startsWith('Key') ? event.code.slice(3) : event.key.toUpperCase());
    if (index < 0 || event.repeat) return;
    event.preventDefault(); selected = index; armed = null; render(); trigger(index);
  }, options);
  render();
  return {
    render, state, trigger, autoSlice,
    // Empties all eight pads; `restore` puts a previous set back (undo of Clear All).
    clearAll() {
      if (!slices.some(Boolean)) return false;
      slices.forEach((_, i) => { slices[i] = null; revisions[i]++; stop(i); });
      selected = 0; armed = null; render(); emit(); return true;
    },
    restore(saved) {
      slices.forEach((_, i) => { slices[i] = normalizeDrumSlice(saved?.[i], buffer); revisions[i]++; stop(i); });
      armed = null; render(); emit();
    },
    snapshot: () => slices.map(slice => slice ? { ...slice } : null),
    select(i) { if (Number.isInteger(i) && i >= 0 && i < KEYS.length) { selected = i; render(); } },
    // Arming waits for a click or drag on the waveform. Esc or `cancel` releases it.
    arm(i) { if (Number.isInteger(i) && i >= 0 && i < KEYS.length) { selected = i; armed = i; render(); } },
    cancel() { if (armed !== null) { armed = null; render(); } },
    focus(i = selected) { const slice = slices[i]; if (slice) timeline.focusRange(slice.start * 1000, slice.end * 1000); },
    dispose() {
      disposed = true; controller.abort();
      for (const voice of liveVoices) { voice.source.stop(); voice.cleanup(); }
      markers.forEach(marker => marker.remove()); regions.forEach(region => region.remove());
      waveform.classList.remove('is-placing-pad');
    },
  };
}
