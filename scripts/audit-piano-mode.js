// Focused regression coverage for the piano-mode races from the mitigation plan.
// Executes the actual functions from MAIN with controlled external dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'tempo-control-main.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 4);
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const messages = [];
  const timers = new Map();
  const starts = [];
  const audio = {
    currentTime: 0, destination: {}, resume: async () => {},
    decodeAudioData: async () => ({ decoded: true }),
    createGain: () => ({ gain: { setTargetAtTime(value) { this.value = value; }, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, value: 1 }, connect(target) { return target; }, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: { setValueAtTime(value) { this.value = value; } }, stops: [], connect(target) { return target; }, disconnect() {}, start(...args) { this.startArgs = args; starts.push(this); }, stop(time) { this.stops.push(time); } }),
  };
  const state = { effectiveRate: 1, preservePitch: false };
  const effectFields = ['schemaVersion', 'reverb', 'delay', 'flanger', 'phaser', 'bitcrusher', 'saturation',
    'reverbRoom', 'reverbSize', 'reverbDecay', 'reverbPreDelay', 'reverbTone',
    'delayTime', 'delayFeedback', 'delayTone', 'flangerRate', 'flangerDepth', 'flangerFeedback',
    'phaserRate', 'phaserDepth', 'phaserFeedback', 'bitDepth', 'sampleRateReduction',
    'saturationDrive', 'saturationTone'];
  const effectsState = Object.fromEntries(effectFields.map(field => [field, field === 'reverbRoom' ? 'hall' : 0]));
  Object.assign(effectsState, { schemaVersion: 2, bypassed: false, preset: 'custom', available: true,
    initialized: true, eq: { enabled: true, hardClip: false, bands: [] } });
  const scope = {
    performance,
    closeSamplerPresets() {},
    instrumentMode: false, instrumentOctave: 0, instrumentPreparing: false,
    instrumentBuffer: null, instrumentVoice: null, instrumentNoteRevision: 0,
    instrumentResumePromise: null, instrumentIntentVersion: 0, instrumentOperationId: null,
    instrumentSnapshot: null, instrumentVoices: new Set(), padRenderPending: false, padRequestNumber: 0,
    instrumentKeys: new Map(), instrumentCutItself: true,
    instrumentAdsrEnabled: true,
    instrumentEnvelope: { attack: 4, decay: 100, sustain: 100, release: 100 },
    instrumentSettings: { gainPercent: 100, pitchSemitones: 0, timePercent: 100 }, instrumentTimeCache: null,
    waveformDrawPreview: null,
    padRequests: new Map(), loopState: { active: true, trackIdentity: 'permalink:track', generation: 1, startMs: 0, endMs: 1000, durationMs: 10000 },
    ui: { panel: { hidden: false } }, document: { hidden: false }, hoveredDrum: null, panelOpenMode: null,
    capability: () => true, authorizePlayerTools: async () => true,
    controller: { snapshot: () => state, getActiveAudio: () => ({ paused: true }) },
    effectsController: { snapshot: () => effectsState }, effectsApi: { DEFAULTS: {} },
    EFFECT_SIGNATURE_FIELDS: effectFields,
    getDrumAudioContext: () => audio,
    renderSelectedPadControls() {}, renderPlayingNote() {}, renderLoop() {}, renderInstrumentMessage() {}, showDrumError() {},
    clearHoverTimers() {}, schedulePadCacheRelease() {}, cancelSlices() {}, cancelLoopPadSelection() {}, setPanelOpen(value) { scope.ui.panel.hidden = !value; },
    window: { postMessage: value => messages.push(value) }, location: { origin: 'https://soundcloud.com' },
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    SCSamplerCore: { playbackRateForMidi: note => 2 ** ((note - 72) / 12) },
  };
  scope.waveformDrag = null;
  scope.padEditor = null;
  vm.createContext(scope);
  for (const name of ['invalidatePendingInstrumentNotes', 'instrumentGainAt', 'scheduleInstrumentEnvelope', 'releaseInstrumentKey', 'cleanupInstrumentVoice', 'releaseInstrumentVoice',
    'stopInstrumentVoice', 'stopAllInstrumentVoices', 'setInstrumentMode', 'setInstrumentAdsrEnabled', 'loopMatchesInstrumentSnapshot',
    'normalizedInstrumentNumber', 'buildInstrumentDescriptor', 'disableInstrument', 'exitInstrument',
    'requestPad', 'cancelInstrumentRequest', 'toggleLoopInstrument', 'instrumentSelection', 'syncInstrumentSelection', 'playInstrumentNote', 'updatePadControl', 'playDrum', 'closePanel']) {
    vm.runInContext(extract(name), scope);
  }
  return { scope, audio, state, effectsState, starts, messages, timers };
}
async function main() {
  {
    const { scope, audio } = fixture();
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 4 };
    scope.instrumentSnapshot = { saved: true };
    scope.instrumentCutItself = false;
    scope.drumPads = [{ gainPercent: 100, pitchSemitones: 0, timePercent: 100 }];
    await scope.playInstrumentNote(72, 'KeyQ');
    const root = scope.instrumentVoice;
    await scope.playInstrumentNote(84, 'KeyI');
    const octave = scope.instrumentVoice;
    scope.updatePadControl(0, 'gainPercent', 70);
    assert.equal(root.padGain.gain.value, .7);
    assert.equal(octave.padGain.gain.value, .7);
    audio.currentTime = .5;
    scope.updatePadControl(0, 'pitchSemitones', 12);
    assert.equal(root.playbackRate, 2);
    assert.equal(octave.playbackRate, 4);
    assert.equal(root.sampleEndAt, 2.25);
    assert.equal(octave.sampleEndAt, 1.25);
    assert.equal(scope.drumPads[0].pitchSemitones, 0);
    assert.equal(scope.drumPads[0].gainPercent, 100);
    scope.updatePadControl(0, 'timePercent', 200);
    assert.equal(scope.instrumentSettings.timePercent, 200);
    assert.equal(scope.drumPads[0].timePercent, 100);
    console.log('Piano controls: keyboard-wide gain/pitch, preserved intervals and cursor, isolated pad settings');
  }
  {
    const { scope, audio } = fixture();
    scope.drumPads = [25, 75].map(sustain => ({ buffer: { duration: 4 }, version: 0,
      envelope: { attack: 0, decay: 0, sustain, release: sustain * 10 } }));
    scope.ui.drumButtons = scope.drumPads.map(() => ({ classList: { add() {}, remove() {} } }));
    scope.padHydration = null;
    scope.padsHydrated = true;
    scope.instrumentCutItself = false;
    await scope.playDrum(0, 'KeyZ', false);
    const first = scope.instrumentVoice;
    await scope.playDrum(1, 'KeyX', false);
    const second = scope.instrumentVoice;
    assert.equal(scope.instrumentGainAt(first, .1), .25);
    assert.equal(scope.instrumentGainAt(second, .1), .75);
    audio.currentTime = .1;
    scope.releaseInstrumentKey({ code: 'KeyZ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(first.releaseMs, 250, 'note-off uses its own pad envelope after another pad was selected');
    assert.equal(second.releasing, false);
    assert.equal(scope.instrumentEnvelope.sustain, 100, 'pad envelopes leave piano settings intact');
    console.log('Independent pad ADSR: overlapping sustain, note-off and piano isolation');
  }
  {
    const { scope, audio } = fixture();
    scope.drumPads = Array.from({ length: 8 }, () => ({ buffer: { duration: 4 }, version: 0, gainPercent: 100, pitchSemitones: 0 }));
    scope.ui.drumButtons = Array.from({ length: 8 }, () => ({ classList: { add() {}, remove() {} } }));
    scope.padHydration = null;
    scope.padsHydrated = true;
    scope.instrumentCutItself = false;
    scope.setInstrumentAdsrEnabled(false);
    scope.updatePadControl(0, 'gainPercent', 200);
    scope.updatePadControl(0, 'pitchSemitones', 12);
    await scope.playDrum(0);
    const first = scope.instrumentVoice;
    assert.equal(first.padGain.gain.value, 1.54, 'maximum gain is exactly 154%');
    assert.equal(first.sampleEndAt, 2, 'upper octave halves sample duration');
    await scope.playDrum(1);
    const second = scope.instrumentVoice;
    assert.equal(second.padGain.gain.value, 1);
    assert.equal(second.sampleEndAt, 4, 'other pads keep their original pitch');
    audio.currentTime = .5;
    scope.updatePadControl(0, 'pitchSemitones', -12);
    assert.equal(first.sampleEndAt, 6.5, 'one second of source was consumed before changing rate');
    audio.currentTime = 1.5;
    scope.updatePadControl(0, 'pitchSemitones', 0);
    assert.equal(first.sampleEndAt, 4, 'multiple changes preserve the accumulated source position');
    scope.updatePadControl(0, 'gainPercent', 50);
    assert.equal(first.padGain.gain.value, .5);
    assert.equal(second.padGain.gain.value, 1, 'live gain only changes the selected pad');
    scope.releaseInstrumentVoice(first, 100, true);
    scope.updatePadControl(0, 'pitchSemitones', -12);
    assert.equal(first.source.stops.at(-1), 1.602, 'pitch edits do not cancel note release');
    console.log('Pad controls: gain ceiling, independent voices, live pitch cursor and release');
  }
  {
    const { scope, audio, starts } = fixture();
    scope.drumPads = Array.from({ length: 8 }, () => ({ buffer: { duration: 2 }, version: 0 }));
    scope.ui.drumButtons = Array.from({ length: 8 }, () => ({ classList: { add() {}, remove() {} } }));
    scope.padHydration = null;
    scope.padsHydrated = true;
    const keyup = code => scope.releaseInstrumentKey({ code, preventDefault() {}, stopImmediatePropagation() {} });
    scope.setInstrumentAdsrEnabled(false);
    await scope.playDrum(0, 'KeyA', false);
    const first = scope.instrumentVoice;
    keyup('KeyA');
    assert.equal(first.releasing, false, 'pads play the full sample with ADSR bypassed');
    assert.equal(scope.instrumentGainAt(first, .01), 1);
    await scope.playDrum(7, 'KeyK', false);
    assert.equal(first.releasing, true, 'cut itself chokes the previous slice across pads');
    assert.equal(scope.instrumentVoice.sampleEndAt, 2);
    scope.instrumentCutItself = false;
    keyup('KeyK');
    const second = scope.instrumentVoice;
    await scope.playDrum(7, 'KeyK', false);
    assert.equal(second.releasing, false, 'cut itself off allows repeated pad one-shots to overlap');
    scope.setInstrumentAdsrEnabled(true);
    assert.equal(second.releasing, true, 'live ADSR toggle releases unheld slices');
    const held = scope.instrumentVoice;
    assert.equal(held.releasing, false);
    audio.currentTime = .1;
    keyup('KeyK');
    assert.equal(held.releaseMs, 100);
    assert.equal(held.envelopeRelease, true, 'pad keyup uses the same release as piano notes');
    assert.equal(held.source.stops.at(-1), .202);
    scope.setInstrumentAdsrEnabled(false);
    assert.equal(held.source.stops.at(-1), 2, 'bypassing release restores the remaining slice');
    const resume = deferred();
    audio.resume = () => resume.promise;
    const pending = scope.playDrum(1, 'KeyS', false);
    keyup('KeyS');
    resume.resolve();
    await pending;
    assert.equal(scope.instrumentVoice.keyReleased, true, 'quick taps survive asynchronous pad loading in one-shot mode');
    scope.setInstrumentAdsrEnabled(true);
    const count = starts.length;
    const cancelled = scope.playDrum(2, 'KeyD', false);
    keyup('KeyD');
    await cancelled;
    assert.equal(starts.length, count, 'ADSR keyup cancels a pending pad attack');
    scope.setInstrumentMode(true);
    assert.ok([...scope.instrumentVoices].every(voice => voice.releasing), 'entering piano stops pad voices');
    console.log('Pads: shared ADSR, cross-pad cut, polyphony, live bypass and pending key release');
  }
  {
    const { scope, audio, starts } = fixture();
    audio.state = 'running';
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 10 };
    Object.assign(scope.instrumentEnvelope, { attack: 5000, decay: 5000, sustain: 0, release: 2000 });
    scope.setInstrumentAdsrEnabled(false);
    await scope.playInstrumentNote(72, 'KeyQ');
    const first = scope.instrumentVoice;
    assert.equal(scope.instrumentGainAt(first, .01), 1, 'bypassed ADSR ignores saved attack and sustain');
    audio.currentTime = .1;
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(first.releasing, false, 'one-shot playback ignores keyup');
    assert.equal(first.source.stops.at(-1), 1, 'one-shot still stops at the sample boundary');
    await scope.playInstrumentNote(74, 'KeyW');
    assert.equal(first.releasing, true, 'cut itself still cuts the previous one-shot');
    assert.ok(first.source.stops.at(-1) < .12);
    scope.setInstrumentAdsrEnabled(true);
    scope.setInstrumentAdsrEnabled(false);
    assert.equal(first.releasing, true, 'ADSR toggles never revive cut voices');
    scope.stopAllInstrumentVoices();
    scope.instrumentCutItself = false;
    await scope.playInstrumentNote(72, 'KeyQ');
    const polyFirst = scope.instrumentVoice;
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    await scope.playInstrumentNote(72, 'KeyQ');
    assert.equal(polyFirst.releasing, false, 'repeated one-shots overlap when cut itself is off');
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    scope.setInstrumentAdsrEnabled(true);
    assert.equal(polyFirst.releasing, true, 'enabling ADSR releases notes whose keys are already up');
    assert.equal(scope.instrumentVoice.releasing, true);
    audio.currentTime = .2;
    scope.setInstrumentAdsrEnabled(false);
    assert.equal(scope.instrumentVoice.releasing, false, 'disabling ADSR during release restores one-shot playback');
    assert.equal(scope.instrumentVoice.source.stops.at(-1), scope.instrumentVoice.sampleEndAt);
    scope.setInstrumentMode(false);
    assert.ok(starts.every(source => source.stops.at(-1) < .22), 'leaving piano mode stops all one-shots');
    assert.equal(scope.instrumentEnvelope.attack, 5000, 'bypassing keeps knob settings');
    console.log('ADSR bypass: one-shots, cut itself, repeated-key polyphony and live toggles');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 10 };
    scope.setInstrumentAdsrEnabled(false);
    const pending = scope.playInstrumentNote(72, 'KeyQ');
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    resume.resolve();
    await pending;
    assert.equal(starts.length, 1, 'a quick one-shot tap survives pending audio resume');
    assert.equal(scope.instrumentVoice.keyReleased, true);
    assert.equal(scope.instrumentKeys.size, 0);
    scope.setInstrumentAdsrEnabled(true);
    assert.equal(scope.instrumentVoice.releasing, true);
    console.log('ADSR bypass: quick taps while audio resumes');
  }
  {
    const { scope, audio, state, starts } = fixture();
    audio.state = 'running';
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 50 };
    state.effectiveRate = 2;
    scope.instrumentSnapshot = scope.buildInstrumentDescriptor();
    scope.loopState.startMs = 2000;
    scope.loopState.endMs = 6000;
    assert.equal(scope.loopMatchesInstrumentSnapshot(), true, 'moving the selection keeps the prepared source');
    await scope.playInstrumentNote(84, 'KeyI');
    const voice = scope.instrumentVoice;
    assert.deepEqual(starts[0].startArgs, [0, 1], 'selection start maps through the prepared tempo');
    assert.equal(starts[0].stops.at(-1), 1, 'sample duration also follows note pitch');
    audio.currentTime = 0.1;
    scope.loopState.startMs = 8000;
    scope.loopState.endMs = 14000;
    scope.syncInstrumentSelection();
    assert.equal(scope.instrumentVoice, voice, 'live selection keeps the held envelope');
    assert.equal(starts[1].startArgs[1], 4.2, 'moving beyond the original sample retargets the held voice');
    assert.equal(starts[1].stops.at(-1), 1.5);
    assert.ok(starts[0].stops.at(-1) < 0.12, 'old source fades out');
    starts[0].onended();
    assert.equal(voice.cleaned, false, 'crossfade cleanup must not remove the replacement voice');
    scope.loopState.endMs = 18000;
    scope.syncInstrumentSelection();
    assert.equal(starts.length, 2, 'moving only the end reschedules without restarting');
    assert.ok(Math.abs(voice.source.stops.at(-1) - 2.5) < 1e-9);
    scope.releaseInstrumentKey({ code: 'KeyI', preventDefault() {}, stopImmediatePropagation() {} });
    scope.loopState.endMs = 20000;
    scope.syncInstrumentSelection();
    assert.ok(voice.source.stops.at(-1) < .3, 'selection edits do not revive released notes');
    scope.loopState.generation++;
    assert.equal(scope.loopMatchesInstrumentSnapshot(), false, 'a new track generation still invalidates the cache');
    console.log('Editable sample: cached full source, live retargeting, end extension and note-off');
  }
  {
    const { scope, audio } = fixture();
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    Object.assign(scope.instrumentEnvelope, { attack: 100, decay: 200, sustain: 40, release: 500 });
    await scope.playInstrumentNote(72, 'KeyQ');
    const voice = scope.instrumentVoice;
    assert.equal(scope.instrumentGainAt(voice, 0), 0);
    assert.equal(scope.instrumentGainAt(voice, 0.05), 0.5);
    assert.equal(scope.instrumentGainAt(voice, 0.1), 1);
    assert.ok(Math.abs(scope.instrumentGainAt(voice, 0.2) - 0.7) < 1e-9);
    assert.equal(scope.instrumentGainAt(voice, 1), 0.4);
    audio.currentTime = 0.05;
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(scope.instrumentGainAt(voice, 0.05), 0.5, 'release starts from the current attack level');
    assert.ok(Math.abs(scope.instrumentGainAt(voice, 0.3) - 0.25) < 1e-9);
    assert.equal(scope.instrumentGainAt(voice, 0.55), 0);
    assert.ok(Math.abs(voice.source.stops.at(-1) - 0.552) < 1e-9);
    audio.currentTime = 0.3;
    voice.releaseMs = 1000;
    scope.scheduleInstrumentEnvelope(voice);
    assert.ok(Math.abs(scope.instrumentGainAt(voice, 0.3) - 0.25) < 1e-9, 'live release preserves current gain');
    assert.equal(scope.instrumentGainAt(voice, 1.05), 0);
    scope.setInstrumentMode(false);
    assert.ok(voice.source.stops.at(-1) < 0.32, 'exit shortens long release tails');
    console.log('ADSR: attack, decay, sustain, note-off, live release and forced stop');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    scope.instrumentCutItself = false;
    const pending = [scope.playInstrumentNote(72, 'KeyQ'), scope.playInstrumentNote(76, 'KeyE')];
    resume.resolve();
    await Promise.all(pending);
    assert.equal(starts.length, 2, 'polyphony preserves pending notes during resume');
    assert.ok(starts.every(source => source.stops.length === 1));
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(starts[0].stops.length, 2);
    assert.equal(starts[1].stops.length, 1, 'note-off only releases its own key');
    scope.setInstrumentMode(false);
    assert.ok(starts.every(source => source.stops.length > 1), 'exit stops every voice');
    console.log('Polyphony: resume race, independent note-off and mode exit');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    const pending = scope.playInstrumentNote(72, 'KeyQ');
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    resume.resolve();
    await pending;
    assert.equal(starts.length, 0, 'released keys cannot start after resume');
    audio.state = 'running';
    await scope.playInstrumentNote(72, 'KeyQ');
    await scope.playInstrumentNote(74, 'KeyW');
    assert.equal(starts[0].stops.length, 2, 'cut itself stops the previous note');
    assert.equal(starts[1].stops.length, 1);
    console.log('Cut itself: latest note wins; early keyup cancels pending playback');
  }
  {
    const { scope, audio } = fixture();
    audio.state = 'running';
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    scope.instrumentCutItself = false;
    await scope.playInstrumentNote(72, 'KeyQ');
    const first = scope.instrumentVoice;
    audio.currentTime = 0.002;
    scope.instrumentEnvelope.attack = 100;
    scope.scheduleInstrumentEnvelope(first);
    assert.equal(scope.instrumentGainAt(first, 0.002), 0.5, 'live attack does not jump');
    assert.equal(scope.instrumentGainAt(first, 0.1), 1);
    audio.currentTime = 0.25;
    scope.instrumentEnvelope.sustain = 25;
    scope.scheduleInstrumentEnvelope(first);
    assert.equal(scope.instrumentGainAt(first, 0.26), 0.25, 'sustain changes on a held voice');
    await scope.playInstrumentNote(72, 'KeyK');
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(scope.instrumentVoice.releasing, false, 'duplicate pitches retain independent physical keys');
    for (let i = 0; i < 35; i++) await scope.playInstrumentNote(72, `test-${i}`);
    assert.equal(scope.instrumentVoices.size, 32, 'polyphony is bounded');
    assert.equal(first.cleaned, true, 'stolen voices disconnect');
    const last = scope.instrumentVoice;
    last.source.onended();
    assert.equal(scope.instrumentKeys.has('test-34'), false, 'natural sample end clears its key');
    console.log('Live envelopes, duplicate pitches, voice limit and natural cleanup');
  }
  {
    const { scope, effectsState } = fixture();
    const baseline = scope.buildInstrumentDescriptor().signature;
    for (const field of scope.EFFECT_SIGNATURE_FIELDS) {
      const previous = effectsState[field];
      effectsState[field] = typeof previous === 'number' ? previous + 1 : 'room';
      assert.notEqual(scope.buildInstrumentDescriptor().signature, baseline, `missing ${field}`);
      effectsState[field] = previous;
    }
    effectsState.bypassed = true;
    assert.notEqual(scope.buildInstrumentDescriptor().signature, baseline, 'missing global bypass');
    effectsState.bypassed = false;
    effectsState.eq = { enabled: true, hardClip: true, bands: [{ type: 'peaking', frequency: 1000, gain: 3, q: 1 }] };
    assert.equal(scope.buildInstrumentDescriptor().signature, baseline, 'live master EQ must not invalidate or be baked into the instrument');
    effectsState.eq = { enabled: true, hardClip: false, bands: [] };
    effectsState.preset = 'wide';
    effectsState.available = false;
    effectsState.initialized = false;
    assert.equal(scope.buildInstrumentDescriptor().signature, baseline, 'UI/runtime FX state changed content signature');
    console.log('P5: descriptor covers render inputs and excludes non-musical FX state');
  }
  {
    const { scope, messages, timers } = fixture();
    const pending = scope.toggleLoopInstrument();
    await flush();
    assert.equal(messages.length, 1);
    scope.disableInstrument();
    assert.equal(messages.length, 2);
    assert.equal(messages[1].action, 'cancel-instrument');
    assert.equal(scope.padRequests.size, 0);
    assert.equal(timers.size, 0);
    await pending;
    assert.equal(scope.instrumentMode, false);
    console.log('P1: local cancel clears request/timer and dispatches cancellation');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    const pending = scope.playInstrumentNote(72);
    scope.stopInstrumentVoice(); // Same stop used by octave change.
    resume.resolve();
    await pending;
    assert.equal(starts.length, 0);
    console.log('P3: stop invalidates a note while resume is pending');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = { duration: 100 };
    const notes = [72, 74, 76].map(note => scope.playInstrumentNote(note));
    resume.resolve();
    await Promise.all(notes);
    assert.equal(starts.length, 1);
    console.log('P3: only the last pending note starts after resume');
  }
  {
    const { scope, state, effectsState, messages } = fixture();
    scope.instrumentSnapshot = scope.buildInstrumentDescriptor();
    scope.instrumentBuffer = { original: true };
    state.effectiveRate = 2;
    state.preservePitch = true;
    effectsState.reverb = 80;
    const pending = scope.toggleLoopInstrument();
    await flush();
    assert.equal(messages.length, 1);
    scope.disableInstrument();
    await pending;
    assert.equal(scope.instrumentMode, false);
    console.log('P5: changed rate/pitch/FX require a fresh render');
  }
  {
    const { scope, messages } = fixture();
    const auth = deferred();
    scope.authorizePlayerTools = () => auth.promise;
    const first = scope.toggleLoopInstrument();
    const second = scope.toggleLoopInstrument();
    auth.resolve(true);
    await flush();
    assert.equal(messages.length, 0);
    await Promise.all([first, second]);
    assert.equal(scope.instrumentMode, false);
    console.log('P1.a: a second click cancels authorization before render dispatch');
  }
  {
    const { scope, messages } = fixture();
    const auth = deferred();
    scope.authorizePlayerTools = () => auth.promise;
    const pending = scope.toggleLoopInstrument();
    scope.closePanel();
    auth.resolve(true);
    await flush();
    assert.equal(messages.length, 0);
    await pending;
    assert.equal(scope.ui.panel.hidden, true);
    assert.equal(scope.instrumentMode, false);
    console.log('P1.b: closing during authorization prevents hidden piano mode');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
