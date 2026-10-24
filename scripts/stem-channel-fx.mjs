// A channel owns one lazy Player Tools insert. Opening its editor allocates no DSP;
// the same settings and insertion order are used by auditions and the playlist.
export function normalizeTrackFx(saved) {
  const core = globalThis.SCTempoEffects;
  if (!core) return null;
  const settings = { ...core.DEFAULTS, bypassed: saved?.bypassed === true };
  for (const [key, fallback] of Object.entries(core.DEFAULTS)) {
    if (key === 'schemaVersion') continue;
    if (key === 'preset') { settings[key] = Object.hasOwn(core.PRESETS, saved?.[key]) ? saved[key] : 'custom'; continue; }
    if (key === 'reverbRoom') { settings[key] = Object.hasOwn(core.REVERB_ROOMS, saved?.[key]) ? saved[key] : fallback; continue; }
    const value = Number(saved?.[key]);
    if (saved?.[key] == null || !Number.isFinite(value)) continue;
    const [min, max, precision] = key === 'reverbDecay' ? [.2, 12, 10]
      : ['flangerRate', 'phaserRate'].includes(key) ? [.05, 5, 100]
      : key === 'delayTime' ? [60, 800, 1] : key === 'bitDepth' ? [2, 16, 1]
      : [0, key === 'reverbPreDelay' ? 200 : 100, 1];
    settings[key] = Math.round(Math.max(min, Math.min(max, value)) * precision) / precision;
  }
  return settings;
}

export function activeTrackFx(settings) {
  return settings?.bypassed !== true && !!globalThis.SCTempoEffects?.EFFECT_NAMES.some(name => Number(settings?.[name]) > 0);
}

export function createChannelFx({ context, output, settings = null }) {
  const input = context.createGain();
  input.connect(output);
  let controller = null, current = normalizeTrackFx(settings), automated = false;
  function prepare() {
    if (controller) return controller;
    input.disconnect(output);
    controller = globalThis.SCTempoEffects.create({
      localAudio: () => ({ context, input, output }),
      bitcrusherModuleUrl: new URL('./bitcrusher-processor.js', import.meta.url).href,
    });
    // Character settings precede activation, avoiding an expensive default impulse
    // rebuild for each persisted parameter on project load.
    for (const key of Object.keys(globalThis.SCTempoEffects.DEFAULTS)) {
      if (!['preset', 'schemaVersion', ...globalThis.SCTempoEffects.EFFECT_NAMES].includes(key)) controller.setCharacter(key, current[key]);
    }
    for (const name of globalThis.SCTempoEffects.EFFECT_NAMES) if (current[name]) controller.set(name, current[name]);
    controller.getPlaybackContext();
    controller.setBypassed(current.bypassed);
    return controller;
  }
  function release() {
    controller?.dispose(); controller = null; automated = false;
    input.disconnect(); input.connect(output);
  }
  function apply(value) {
    const next = normalizeTrackFx(value), previous = current; current = next;
    if (!next || (!activeTrackFx(next) && !automated)) { if (controller) release(); return; }
    if (!controller) { prepare(); return; }
    for (const key of Object.keys(globalThis.SCTempoEffects.DEFAULTS)) {
      if (key === 'preset' || key === 'schemaVersion' || next[key] === previous?.[key]) continue;
      if (globalThis.SCTempoEffects.EFFECT_NAMES.includes(key)) controller.set(key, next[key]);
      else controller.setCharacter(key, next[key]);
    }
    if (next.bypassed !== previous?.bypassed) controller.setBypassed(next.bypassed);
  }
  apply(settings);
  return {
    input, apply,
    snapshot: () => ({ ...current, available: true, initialized: !!controller }),
    isDelayFrozen: () => controller?.isDelayFrozen() || false,
    setDelayFreeze: value => controller?.setDelayFreeze(value) || false,
    schedule(name, events) {
      if (current?.bypassed || !events.length) return;
      automated = true; prepare().schedule(name, events);
    },
    cancelAutomation(at = context.currentTime) {
      controller?.cancelAutomation(at); automated = false;
      if (controller && !activeTrackFx(current)) release();
    },
    dispose() { controller?.dispose(); controller = null; input.disconnect(); },
  };
}
