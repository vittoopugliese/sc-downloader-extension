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

const waveformSamplers = new WeakMap();
// Pads share PCM, but own their trim and envelope; no pad depends on its neighbor.
export function mountDrumSampler({ row, actions, waveform, buffer, timeline, audioContext, output, level, changed, saved, locale, report,
  keys = KEYS, id = 'drums', keyboard = true, keyboardActive = () => true, autoSlice = keyboard, defaultLength = .154, title = 'Sampler' }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const slices = Array.from({ length: keys.length }, (_, i) => normalizeDrumSlice(saved?.[i], buffer));
  const controller = new AbortController(), options = { signal: controller.signal };
  let selected = null, armed = null, disposed = false, drag = null, sliced = null;
  const voices = new Map(), liveVoices = new Set(), revisions = Array(keys.length).fill(0);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'stem-sampler-toggle';
  toggle.title = pt(title); toggle.setAttribute('aria-label', pt(title));
  toggle.setAttribute('aria-controls', `pads-${id}`); toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  actions.insertBefore(toggle, actions.querySelector('.download'));
  const panel = document.createElement('div'); panel.className = 'stem-sampler'; panel.id = `pads-${id}`; panel.hidden = true;
  if (!keyboard) { toggle.className = 'stem-piano-sample-toggle'; toggle.hidden = true; }
  const peers = waveformSamplers.get(waveform) || new Set(); waveformSamplers.set(waveform, peers);
  const activity = () => ({ visible: !panel.hidden, armed: armed !== null }); peers.add(activity);
  function renderActivity() {
    waveform.classList.toggle('is-placing-pad', [...peers].some(peer => peer().armed));
    waveform.classList.toggle('is-sampling', [...peers].some(peer => peer().visible));
  }
  const pads = document.createElement('div'); pads.className = 'drum-pads stem-pads';
  const hint = document.createElement('p'); hint.className = 'stem-sampler-hint'; hint.setAttribute('role', 'status');
  const toolbar = document.createElement('div'); toolbar.className = 'stem-sample-tools'; toolbar.hidden = true;
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'stem-sample-edit';
  edit.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/></svg>';
  edit.setAttribute('aria-label', pt('Edit sample'));
  edit.onclick = () => {
    const slice = slices[selected]; if (!slice) return;
    armed = null; timeline.focusRange(slice.start * 1000, slice.end * 1000); render();
  };
  const auto = document.createElement('button'); auto.type = 'button'; auto.className = 'stem-sample-edit stem-sample-auto';
  auto.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21 15 9M14 4v3M19 9h3M17.5 5.5l2-2M10 6.5 8 4.5M17.5 12.5l2 2"/></svg>';
  auto.title = pt('Auto-slice the loop'); auto.setAttribute('aria-label', auto.title);
  auto.hidden = !autoSlice; auto.onclick = () => slice(true);
  toolbar.append(edit, auto);
  const markers = [], regions = [], envelopes = [], handles = [], buttons = [];
  const milliseconds = seconds => `${(seconds * 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;
  const labels = { start: pt('Sample start'), end: pt('Sample end'), fadeIn: pt('Fade in'), fadeOut: pt('Fade out') };

  function render() {
    hint.textContent = armed === null
      ? pt('A S D F G H J K to play. Edit sample to zoom; drag its edges and fades.')
      : keyboard ? pt('Pad $1: click the waveform of this track to set its start. Esc cancels.', keys[armed]) : pt('Click the waveform of this track to select a sample. Drag its edges and fades.');
    hint.hidden = armed === null;
    pads.title = keyboard ? pt('A S D F G H J K to play. Edit sample to zoom; drag its edges and fades.') : pt('Select piano sample');
    renderActivity();
    edit.hidden = !slices[selected]; toolbar.hidden = edit.hidden && !autoSlice;
    if (!edit.hidden) {
      const slice = slices[selected];
      edit.title = `${pt('Edit sample')} · ${keys[selected]} · ${milliseconds(slice.end - slice.start)} · ${labels.fadeIn} ${milliseconds(slice.fadeIn)} · ${labels.fadeOut} ${milliseconds(slice.fadeOut)}`;
    }
    buttons.forEach((button, i) => {
      const slice = slices[i], active = selected === i;
      button.classList.toggle('is-selected', active); button.classList.toggle('is-assigned', !!slice);
      button.classList.toggle('is-armed', armed === i);
      button.setAttribute('aria-pressed', String(active));
      button.title = `${keys[i]}: ${slice ? `${slice.start.toLocaleString(locale, { maximumFractionDigits: 3 })} s · ${milliseconds(slice.end - slice.start)}` : pt('Unassigned')}`;
      const x = slice ? timeline.percent(slice.start * 1000) : -1, end = slice ? timeline.percent(slice.end * 1000) : -1;
      markers[i].hidden = panel.hidden || x < 0 || x > 100;
      markers[i].style.left = `${x}%`; markers[i].dataset.start = String(slice?.start ?? null);
      markers[i].classList.toggle('is-selected', active);
      regions[i].hidden = panel.hidden || !slice || end < 0 || x > 100;
      regions[i].classList.toggle('is-selected', active);
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
        handle.hidden = kind !== 'start' && (!active || timeline.percent(position * 1000) < 0 || timeline.percent(position * 1000) > 100);
        handle.setAttribute('aria-label', `${keys[i]} · ${labels[kind]}`);
        handle.setAttribute('aria-valuemin', String(minimum * 1000)); handle.setAttribute('aria-valuemax', String(maximum * 1000));
        handle.setAttribute('aria-valuenow', String(value * 1000)); handle.setAttribute('aria-valuetext', milliseconds(value));
        handle.title = `${keys[i]} · ${labels[kind]}: ${milliseconds(value)}`;
      }
    });
  }
  // The A–B loop is the slicing range; without one, the visible part of the waveform.
  function sliceRange() {
    const loop = timeline.range();
    return loop.endMs - loop.startMs < buffer.duration * 1000 - 1 ? loop : timeline.viewport();
  }
  // Opening the pads slices empty pads, and re-slices pads that are still an untouched
  // auto-slice of another range. Edited or saved pads are never overwritten.
  function slice(force = false) {
    const { startMs, endMs } = sliceRange(), key = `${Math.round(startMs)}:${Math.round(endMs)}`;
    const untouched = sliced && slices.every((value, i) => value === sliced.slices[i]);
    if (!force && !slices.every(value => !value) && !(untouched && sliced.key !== key)) return;
    const found = detectDrumSlices(buffer, { startMs, endMs, count: keys.length });
    if (!found.length) return;
    buttons.forEach((_, i) => { slices[i] = found[i] ?? null; revisions[i]++; stop(i); });
    sliced = { key, slices: [...slices] }; selected = 0; armed = null; render(); changed();
  }
  function stop(i) {
    const voice = voices.get(i); if (!voice) return;
    voices.delete(i); buttons[i].classList.remove('is-active');
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
      if (disposed || panel.hidden || version !== revisions[i]) return;
      stop(i);
      const slice = slices[i], length = slice.end - slice.start, now = context.currentTime;
      const source = context.createBufferSource(), gain = context.createGain(), envelope = context.createGain();
      source.buffer = buffer;
      scheduleDrumEnvelope(envelope.gain, slice, now);
      gain.gain.value = level();
      voice = { source, gain, envelope, cleanup() {
        envelope.disconnect(); source.disconnect(); gain.disconnect(); liveVoices.delete(voice);
        if (voices.get(i) === voice) { voices.delete(i); buttons[i].classList.remove('is-active'); }
      } };
      liveVoices.add(voice); voices.set(i, voice);
      source.onended = voice.cleanup;
      source.connect(envelope).connect(gain).connect(output());
      source.start(now, slice.start, length); buttons[i].classList.add('is-active');
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
    if (kind === 'start') handle.textContent = keys[i];
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      // Freeze coordinates while dragging, including at clipped/zoomed boundaries.
      drag = { i, kind, id: event.pointerId, x: event.clientX, rect: waveform.getBoundingClientRect(), viewport: { ...timeline.viewport() }, moved: false };
      selected = i; armed = null; handle.focus({ preventScroll: true }); handle.setPointerCapture(event.pointerId); render();
    }, options);
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x) < 2) return;
      drag.moved = true;
      update(i, kind, (drag.viewport.startMs + (event.clientX - drag.rect.left) / drag.rect.width * (drag.viewport.endMs - drag.viewport.startMs)) / 1000);
    }, options);
    const finish = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const moved = drag.moved; drag = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (moved) changed();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(event, finish, options);
    handle.addEventListener('click', event => { event.stopPropagation(); selected = i; armed = null; render(); }, options);
    handle.addEventListener('dblclick', event => { event.stopPropagation(); }, options);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); selected = i; armed = null;
      const slice = slices[i];
      const next = event.key === 'Home' ? Number(handle.getAttribute('aria-valuemin')) / 1000 :
        event.key === 'End' ? Number(handle.getAttribute('aria-valuemax')) / 1000 :
          slice[kind] + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1) * (event.shiftKey ? .01 : .001);
      update(i, kind, kind === 'fadeIn' ? slice.start + next : kind === 'fadeOut' ? slice.end - next : next); changed();
    }, options);
    return handle;
  }
  for (const [i, key] of [...keys].entries()) {
    const slot = document.createElement('div'); slot.className = 'drum-slot';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'drum-pad';
    const caption = document.createElement('span'); caption.className = 'drum-key'; caption.textContent = key;
    button.append(caption); button.setAttribute('aria-label', keyboard ? `${pt('Sampler')} ${key}` : pt('Select piano sample'));
    button.onclick = () => { selected = i; armed = i; render(); trigger(i); };
    const marker = document.createElement('span'); marker.className = 'stem-pad-marker';
    const region = document.createElement('div'); region.className = 'stem-pad-region';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const envelope = document.createElementNS(svg.namespaceURI, 'polyline'); svg.append(envelope); region.append(svg);
    const controls = Object.fromEntries(['start', 'end', 'fadeIn', 'fadeOut'].map(kind => [kind, makeHandle(i, kind)]));
    marker.append(controls.start); region.append(controls.end, controls.fadeIn, controls.fadeOut);
    waveform.append(region, marker); markers.push(marker); regions.push(region); envelopes.push(envelope); handles.push(controls);
    buttons.push(button); slot.append(button); pads.append(slot);
  }
  toggle.onclick = () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); armed = null;
    if (panel.hidden) buttons.forEach((_, i) => { revisions[i]++; stop(i); }); render();
    // Slice after the panel paints; a whole song costs one long frame.
    if (!panel.hidden && autoSlice) requestAnimationFrame(() => setTimeout(() => { if (!disposed && !panel.hidden) slice(); }));
  };
  // The melodic selector captures a drag as a sample cut, independently of A–B.
  // Drum pads retain their existing click-to-place and drag-to-loop behavior.
  if (!keyboard) {
    const capture = { ...options, capture: true };
    const time = event => clamp((drag.viewport.startMs + (event.clientX - drag.rect.left) / drag.rect.width *
      (drag.viewport.endMs - drag.viewport.startMs)) / 1000, 0, buffer.duration - 1 / buffer.sampleRate);
    waveform.addEventListener('pointerdown', event => {
      if (armed === null || panel.hidden || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag = { selection: true, i: armed, id: event.pointerId, x: event.clientX, rect: waveform.getBoundingClientRect(),
        viewport: { ...timeline.viewport() }, previous: slices[armed], moved: false };
      drag.anchor = time(event); waveform.setPointerCapture(event.pointerId);
    }, capture);
    waveform.addEventListener('pointermove', event => {
      if (!drag?.selection || drag.id !== event.pointerId) return;
      event.stopImmediatePropagation();
      if (Math.abs(event.clientX - drag.x) < 3 && !drag.moved) return;
      drag.moved = true;
      slices[drag.i] = normalizeDrumSlice({ start: Math.min(drag.anchor, time(event)), end: Math.max(drag.anchor, time(event)) }, buffer);
      render();
    }, capture);
    const finishSelection = event => {
      if (!drag?.selection || drag.id !== event.pointerId) return;
      event.stopImmediatePropagation();
      const gesture = drag; drag = null;
      if (event.type === 'pointercancel') slices[gesture.i] = gesture.previous;
      else if (!gesture.moved) slices[gesture.i] = normalizeDrumSlice({ start: gesture.anchor, end: gesture.anchor + defaultLength }, buffer);
      revisions[gesture.i]++; stop(gesture.i); armed = null; render();
      if (waveform.hasPointerCapture(event.pointerId)) waveform.releasePointerCapture(event.pointerId);
      if (event.type !== 'pointercancel') changed();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) waveform.addEventListener(type, finishSelection, capture);
  }
  document.addEventListener('keydown', event => {
    if (panel.hidden || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') ||
      event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { armed = null; render(); return; }
    if (!keyboard || !keyboardActive() || row.hidden || event.defaultPrevented || row.classList.contains('is-collapsed') || event.target.closest('.stem-piano')) return;
    const index = keys.indexOf(event.code?.startsWith('Key') ? event.code.slice(3) : event.key.toUpperCase());
    if (index < 0 || event.repeat) return;
    event.preventDefault(); selected = index; armed = null; render(); trigger(index);
  }, options);
  panel.append(pads, toolbar, hint); row.append(panel); render();
  return {
    render, snapshot: () => slices.map(slice => slice ? { ...slice } : null),
    cancelPlacement() { armed = null; render(); },
    assignPad(i) {
      if (!Number.isInteger(i) || i < 0 || i >= keys.length) return;
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); selected = i; armed = i; render();
    },
    editPad(i) {
      if (!Number.isInteger(i) || i < 0 || i >= keys.length) return;
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      selected = i; armed = slices[i] ? null : i;
      if (slices[i]) timeline.focusRange(slices[i].start * 1000, slices[i].end * 1000);
      render();
    },
    place(seconds) {
      if (armed === null || panel.hidden || !Number.isFinite(seconds)) return false;
      const start = clamp(seconds, 0, buffer.duration - 1 / buffer.sampleRate);
      slices[armed] = normalizeDrumSlice({ start, end: start + defaultLength }, buffer);
      revisions[armed]++; stop(armed); armed = null; render(); changed(); return true;
    },
    updateGain() { for (const voice of liveVoices) voice.gain.gain.value = level(); },
    dispose() {
      disposed = true; controller.abort();
      for (const voice of liveVoices) { voice.source.stop(); voice.cleanup(); }
      markers.forEach(marker => marker.remove()); regions.forEach(region => region.remove());
      peers.delete(activity); renderActivity(); panel.remove(); toggle.remove();
    },
  };
}
