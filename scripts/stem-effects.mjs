import { pluginShell } from './stem-channel-rack.mjs';
import { createKnob } from './ui-knob.mjs';

export const FX_ICON = 'plugin';

// All the Player Tools FX parameters, with the same ranges and defaults.
// Unlike the compact player panel, every character control stays visible.
const EFFECTS = [
  ['reverb', 'Reverb', [
    ['reverbSize', 'Size'], ['reverbDecay', 'Decay', .2, 12, .1, 's'],
    ['reverbPreDelay', 'Pre-delay', 0, 200, 1, 'ms'], ['reverbTone', 'Tone'],
  ]],
  ['delay', 'Echo', [
    ['delayTime', 'Time', 60, 800, 1, 'ms'], ['delayFeedback', 'Feedback'], ['delayTone', 'Tone'],
  ]],
  ['flanger', 'Flanger', [
    ['flangerRate', 'Rate', .05, 5, .05, 'Hz'], ['flangerDepth', 'Depth'], ['flangerFeedback', 'Feedback'],
  ]],
  ['phaser', 'Phaser', [
    ['phaserRate', 'Rate', .05, 5, .05, 'Hz'], ['phaserDepth', 'Depth'], ['phaserFeedback', 'Feedback'],
  ]],
  ['saturation', 'Saturation', [['saturationDrive', 'Drive'], ['saturationTone', 'Tone']]],
  ['bitcrusher', 'Bitcrusher', [['bitDepth', 'Bits', 2, 16, 1, ''], ['sampleRateReduction', 'Downsample']]],
];

export function mountEffects({ container, effects, changed, pauseForFreeze, report, t, onAutomationRequest }) {
  const pt = globalThis.SCPlayerToolsText.t;
  const shell = pluginShell({ container, id: 'stem-fx', title: 'FXs · Master', icon: FX_ICON, className: 'stem-fx' });
  shell.setCollapsed(false);
  const knobs = new Map(), toggles = new Map(), presets = new Map(), cards = new Map(), wetMemory = new Map();
  const defaults = globalThis.SCTempoEffects.DEFAULTS;
  let resume = null;
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (className, text, action) => {
    const node = element('button', className, text); node.type = 'button'; node.onclick = action; return node;
  };
  function change(action) {
    try { action(); sync(); changed(); } catch (error) { report(error); }
  }
  const toolbar = element('div', 'fx-toolbar');
  const presetGroup = element('div', 'fx-presets');
  presetGroup.setAttribute('role', 'group'); presetGroup.setAttribute('aria-label', pt('FX presets'));
  for (const name of Object.keys(globalThis.SCTempoEffects.PRESETS)) {
    const control = button('fx-preset', pt(name[0].toUpperCase() + name.slice(1)), () => change(() => { release(); effects.applyPreset(name); }));
    control.dataset.fxPreset = name; presets.set(name, control); presetGroup.append(control);
  }
  const bypass = button('fx-bypass', t('Bypass FXs', 'Omitir FXs'), () => change(() => { release(); effects.setBypassed(!effects.snapshot().bypassed); }));
  bypass.prepend(globalThis.SCIcons.create('bypass'));
  const reset = button('fx-reset', t('Reset FXs', 'Restablecer FXs'), () => change(() => { release(); effects.reset(); wetMemory.clear(); }));
  toolbar.append(presetGroup, bypass, reset);
  const grid = element('div', 'fx-grid');
  let room, freeze;
  for (const [name, title, parameters] of EFFECTS) {
    const card = element('section', 'fx-card'); card.dataset.effect = name; cards.set(name, card);
    card.setAttribute('aria-label', pt(title));
    const heading = element('div', 'fx-card-heading');
    const toggle = button('fx-enable', pt(title), () => change(() => {
      if (name === 'delay') release();
      effects.set(name, effects.snapshot()[name] > 0 ? 0 : wetMemory.get(name) || 35);
    }));
    toggle.prepend(globalThis.SCIcons.create('bypass'));
    toggle.dataset.effectBypass = name; toggles.set(name, toggle); heading.append(toggle);
    card.append(heading);
    const controls = element('div', 'fx-parameters');
    for (const [key, label, min = 0, max = 100, step = 1, unit = '%'] of [[name, 'Mix'], ...parameters]) {
      const apply = value => change(() => {
        if (key === 'delay' && value === 0) release();
        if (key === name) effects.set(key, value); else effects.setCharacter(key, value);
      });
      const knob = createKnob({ label: pt(label), min, max, step, coarse: step * 10, value: defaults[key], reset: defaults[key],
        format: value => `${value}${unit}`, hint: pt('$1: drag vertically · Shift for fine adjustment', pt(label)),
        onInput: apply, onCommit: apply });
      knob.dial.setAttribute('aria-label', `${pt(title)} · ${pt(label)}`);
      knob.dial.dataset.fxSetting = key; knobs.set(key, knob); controls.append(knob.wrap);
      if (key === name && onAutomationRequest) {
        knob.dial.addEventListener('contextmenu', event => {
          event.preventDefault(); event.stopPropagation(); onAutomationRequest(event, name, effects.snapshot()[name]);
        });
      }
    }
    if (name === 'reverb') {
      const label = element('label', 'fx-room', pt('Room'));
      room = element('select', ''); room.dataset.fxSetting = 'reverbRoom';
      for (const name of Object.keys(globalThis.SCTempoEffects.REVERB_ROOMS)) room.add(new Option(pt(name[0].toUpperCase() + name.slice(1)), name));
      room.onchange = () => change(() => effects.setCharacter('reverbRoom', room.value));
      label.append(room); controls.append(label);
    }
    if (name === 'delay') {
      freeze = button('fx-freeze', pt('Hold to Freeze'), () => {});
      freeze.onpointerdown = event => {
        if (event.button !== 0 || freeze.disabled) return;
        event.preventDefault(); freeze.focus(); freeze.setPointerCapture(event.pointerId); startFreeze();
      };
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) freeze.addEventListener(event, () => release());
      freeze.onkeydown = event => {
        if (![' ', 'Enter'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) startFreeze();
      };
      freeze.onkeyup = event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } };
      controls.append(freeze);
    }
    card.append(controls); grid.append(card);
  }
  shell.body.append(toolbar, grid);
  function startFreeze() {
    if (effects.isDelayFrozen() || !effects.setDelayFreeze(true)) return;
    resume = pauseForFreeze(); sync();
  }
  function release(resumePlayback = true) {
    effects.setDelayFreeze(false);
    const restore = resume; resume = null;
    if (resumePlayback) restore?.();
    sync();
  }
  function sync() {
    const state = effects.snapshot();
    for (const [key, knob] of knobs) { knob.show(state[key]); knob.dial.disabled = !state.available; }
    room.value = state.reverbRoom;
    for (const [name, control] of toggles) {
      if (state[name] > 0) wetMemory.set(name, state[name]);
      control.setAttribute('aria-pressed', String(state[name] > 0));
      control.dataset.scdlTooltip = pt(state[name] > 0 ? 'Disable $1 ($2% wet)' : 'Enable $1 ($2% wet)', control.textContent, state[name] || wetMemory.get(name) || 35);
      cards.get(name).classList.toggle('is-active', state[name] > 0 && !state.bypassed);
    }
    for (const [name, control] of presets) control.setAttribute('aria-pressed', String(state.preset === name));
    bypass.setAttribute('aria-pressed', String(state.bypassed));
    freeze.disabled = !state.available || state.bypassed || !state.delay;
    freeze.setAttribute('aria-pressed', String(effects.isDelayFrozen()));
    freeze.textContent = pt(effects.isDelayFrozen() ? 'Frozen — release' : 'Hold to Freeze');
  }
  const blur = () => release();
  const visibility = () => { if (document.hidden) release(); };
  window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  sync();
  return {
    section: shell.section, sync,
    cancelFreeze: () => release(false),
    reset() { release(false); wetMemory.clear(); sync(); },
    setVisible(open) { if (!open) release(); },
    dispose() { release(false); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); },
  };
}
