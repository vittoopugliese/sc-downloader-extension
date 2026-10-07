const KEYS = 'ASDFGHJK';

// The drum stem owns one buffer; pads are just sample offsets into that buffer.
export function mountDrumSampler({ row, actions, waveform, buffer, timeline, audioContext, output, level, changed, saved, locale, report }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const starts = Array.from({ length: 8 }, (_, i) => Number.isFinite(saved?.[i]) && saved[i] >= 0 && saved[i] < buffer.duration ? saved[i] : null);
  const controller = new AbortController(), options = { signal: controller.signal };
  let selected = null, armed = null, disposed = false;
  const voices = new Map(), revisions = Array(8).fill(0);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'stem-sampler-toggle';
  toggle.title = pt('Sampler'); toggle.setAttribute('aria-label', pt('Sampler'));
  toggle.setAttribute('aria-controls', 'pads-drums'); toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  actions.insertBefore(toggle, actions.querySelector('.download'));
  const panel = document.createElement('div'); panel.className = 'stem-sampler'; panel.id = 'pads-drums'; panel.hidden = true;
  const pads = document.createElement('div'); pads.className = 'drum-pads stem-pads';
  const hint = document.createElement('p'); hint.className = 'stem-sampler-hint'; hint.setAttribute('role', 'status');
  const markers = [], buttons = [];
  function render() {
    hint.textContent = armed === null
      ? pt('Click a pad to set its start. A S D F G H J K to play. Drag for the loop.')
      : pt('Pad $1: click the drum waveform to set its start. Esc cancels.', KEYS[armed]);
    waveform.classList.toggle('is-placing-pad', armed !== null);
    buttons.forEach((button, i) => {
      button.classList.toggle('is-selected', selected === i); button.classList.toggle('is-assigned', starts[i] !== null);
      button.setAttribute('aria-pressed', String(selected === i));
      button.title = `${KEYS[i]}: ${starts[i] === null ? pt('Unassigned') : starts[i].toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' s'}`;
      const x = starts[i] === null ? -1 : timeline.percent(starts[i] * 1000);
      markers[i].hidden = panel.hidden || x < 0 || x > 100;
      markers[i].style.left = `${x}%`; markers[i].dataset.start = String(starts[i]);
      markers[i].classList.toggle('is-selected', selected === i);
    });
  }
  function stop(i) {
    const voice = voices.get(i); if (!voice) return;
    voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); voices.delete(i);
    buttons[i].classList.remove('is-active');
  }
  async function trigger(i) {
    if (starts[i] === null) return;
    const version = ++revisions[i];
    try {
      const context = audioContext(); await context.resume();
      if (disposed || panel.hidden || version !== revisions[i]) return;
      stop(i);
      const start = starts[i], end = Math.min(buffer.duration, ...starts.filter(value => value !== null && value > start));
      const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer;
      const length = end - start, fade = Math.min(.003, length / 3), now = context.currentTime;
      // Short edge fades prevent clicks without modifying the shared PCM.
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(1, now + fade);
      envelope.gain.setValueAtTime(1, now + length - fade); envelope.gain.linearRampToValueAtTime(0, now + length);
      gain.gain.value = level(); source.connect(envelope).connect(gain).connect(output());
      const voice = { source, gain }; voices.set(i, voice); buttons[i].classList.add('is-active');
      source.onended = () => { envelope.disconnect(); source.disconnect(); gain.disconnect();
        if (voices.get(i) === voice) { voices.delete(i); buttons[i].classList.remove('is-active'); } };
      source.start(now, start, length);
    } catch (error) { report(error); }
  }
  for (const [i, key] of [...KEYS].entries()) {
    const slot = document.createElement('div'); slot.className = 'drum-slot';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'drum-pad';
    button.innerHTML = `<span class="drum-key">${key}</span>`; button.setAttribute('aria-label', `${pt('Drums')} ${key}`);
    button.onclick = () => { selected = i; armed = i; render(); trigger(i); };
    const marker = document.createElement('span'); marker.className = 'stem-pad-marker'; marker.textContent = key;
    marker.setAttribute('aria-hidden', 'true'); waveform.append(marker); markers.push(marker);
    buttons.push(button); slot.append(button); pads.append(slot);
  }
  toggle.onclick = () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); armed = null;
    if (panel.hidden) buttons.forEach((_, i) => { revisions[i]++; stop(i); }); render();
  };
  document.addEventListener('keydown', event => {
    if (panel.hidden || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') ||
      event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { armed = null; render(); return; }
    const index = KEYS.indexOf(event.code?.startsWith('Key') ? event.code.slice(3) : event.key.toUpperCase());
    if (index < 0 || event.repeat) return;
    event.preventDefault(); selected = index; armed = null; render(); trigger(index);
  }, options);
  panel.append(pads, hint); row.append(panel); render();
  return {
    render, snapshot: () => [...starts],
    place(seconds) {
      if (armed === null || panel.hidden) return false;
      starts[armed] = Math.min(buffer.duration - 1 / buffer.sampleRate, Math.round(seconds * buffer.sampleRate) / buffer.sampleRate);
      revisions[armed]++; stop(armed); armed = null; render(); changed(); return true;
    },
    updateGain() { for (const voice of voices.values()) voice.gain.gain.value = level(); },
    dispose() { disposed = true; controller.abort(); buttons.forEach((_, i) => stop(i)); markers.forEach(marker => marker.remove()); panel.remove(); toggle.remove(); },
  };
}
