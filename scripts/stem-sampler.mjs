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

// Pads share PCM, but own their trim and envelope; no pad depends on its neighbor.
export function mountDrumSampler({ row, actions, waveform, buffer, timeline, audioContext, output, level, changed, saved, locale, report,
  keys = KEYS, id = 'drums', keyboard = true, defaultLength = .154, title = 'Sampler' }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const slices = Array.from({ length: keys.length }, (_, i) => normalizeDrumSlice(saved?.[i], buffer));
  const controller = new AbortController(), options = { signal: controller.signal };
  let selected = null, armed = null, disposed = false, drag = null;
  const voices = new Map(), liveVoices = new Set(), revisions = Array(keys.length).fill(0);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'stem-sampler-toggle';
  toggle.title = pt(title); toggle.setAttribute('aria-label', pt(title));
  toggle.setAttribute('aria-controls', `pads-${id}`); toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  actions.insertBefore(toggle, actions.querySelector('.download'));
  const panel = document.createElement('div'); panel.className = 'stem-sampler'; panel.id = `pads-${id}`; panel.hidden = true;
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
  toolbar.append(edit);
  const markers = [], regions = [], envelopes = [], handles = [], buttons = [];
  const milliseconds = seconds => `${(seconds * 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;
  const labels = { start: pt('Sample start'), end: pt('Sample end'), fadeIn: pt('Fade in'), fadeOut: pt('Fade out') };

  function render() {
    hint.textContent = armed === null
      ? pt('A S D F G H J K to play. Edit sample to zoom; drag its edges and fades.')
      : keyboard ? pt('Pad $1: click the drum waveform to set its start. Esc cancels.', keys[armed]) : pt('Click the instruments waveform to select a sample. Drag its edges and fades.');
    hint.hidden = armed === null;
    pads.title = keyboard ? pt('A S D F G H J K to play. Edit sample to zoom; drag its edges and fades.') : pt('Select piano sample');
    waveform.classList.toggle('is-placing-pad', armed !== null);
    waveform.classList.toggle('is-sampling', !panel.hidden);
    toolbar.hidden = !slices[selected];
    if (!toolbar.hidden) {
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
    button.append(caption); button.setAttribute('aria-label', keyboard ? `${pt('Drums')} ${key}` : pt('Select piano sample'));
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
    if (!keyboard || event.defaultPrevented || row.classList.contains('is-collapsed') || event.target.closest('.stem-piano')) return;
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
      waveform.classList.remove('is-placing-pad', 'is-sampling'); panel.remove(); toggle.remove();
    },
  };
}
