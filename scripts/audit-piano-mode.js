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
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, value: 1 }, connect() {} }),
    createBufferSource: () => ({ playbackRate: {}, stops: [], connect() { return { connect() {} }; }, start() { starts.push(this); }, stop(time) { this.stops.push(time); } }),
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
    instrumentMode: false, instrumentOctave: 0, instrumentPreparing: false,
    instrumentBuffer: null, instrumentVoice: null, instrumentNoteRevision: 0,
    instrumentResumePromise: null, instrumentIntentVersion: 0, instrumentOperationId: null,
    instrumentSnapshot: null, instrumentVoices: new Set(), padRenderPending: false, padRequestNumber: 0,
    instrumentKeys: new Map(), instrumentCutItself: true,
    instrumentEnvelope: { attack: 4, decay: 100, sustain: 100, release: 100 },
    padRequests: new Map(), loopState: { active: true, trackIdentity: 'permalink:track', generation: 1, startMs: 0, endMs: 1000, durationMs: 10000 },
    ui: { panel: { hidden: false } }, document: { hidden: false }, hoveredDrum: null, panelOpenMode: null,
    capability: () => true, authorizePlayerTools: async () => true,
    controller: { snapshot: () => state, getActiveAudio: () => ({ paused: true }) },
    effectsController: { snapshot: () => effectsState }, effectsApi: { DEFAULTS: {} },
    EFFECT_SIGNATURE_FIELDS: effectFields,
    getDrumAudioContext: () => audio,
    renderPlayingNote() {}, renderLoop() {}, renderInstrumentMessage() {}, showDrumError() {},
    clearHoverTimers() {}, cancelLoopPadSelection() {}, setPanelOpen(value) { scope.ui.panel.hidden = !value; },
    window: { postMessage: value => messages.push(value) }, location: { origin: 'https://soundcloud.com' },
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    SCSamplerCore: { playbackRateForMidi: note => 2 ** ((note - 72) / 12) },
  };
  vm.createContext(scope);
  for (const name of ['invalidatePendingInstrumentNotes', 'instrumentGainAt', 'scheduleInstrumentEnvelope', 'releaseInstrumentKey', 'cleanupInstrumentVoice', 'releaseInstrumentVoice',
    'stopInstrumentVoice', 'stopAllInstrumentVoices', 'setInstrumentMode', 'loopMatchesInstrumentSnapshot',
    'normalizedInstrumentNumber', 'buildInstrumentDescriptor', 'disableInstrument', 'exitInstrument',
    'requestPad', 'cancelInstrumentRequest', 'toggleLoopInstrument', 'playInstrumentNote', 'closePanel']) {
    vm.runInContext(extract(name), scope);
  }
  return { scope, audio, state, effectsState, starts, messages, timers };
}
async function main() {
  {
    const { scope, audio } = fixture();
    scope.instrumentMode = true;
    scope.instrumentBuffer = {};
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
    scope.instrumentBuffer = {};
    scope.instrumentCutItself = false;
    const pending = [scope.playInstrumentNote(72, 'KeyQ'), scope.playInstrumentNote(76, 'KeyE')];
    resume.resolve();
    await Promise.all(pending);
    assert.equal(starts.length, 2, 'polyphony preserves pending notes during resume');
    assert.ok(starts.every(source => source.stops.length === 0));
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(starts[0].stops.length, 1);
    assert.equal(starts[1].stops.length, 0, 'note-off only releases its own key');
    scope.setInstrumentMode(false);
    assert.ok(starts.every(source => source.stops.length > 0), 'exit stops every voice');
    console.log('Polyphony: resume race, independent note-off and mode exit');
  }
  {
    const { scope, audio, starts } = fixture();
    const resume = deferred();
    audio.resume = () => resume.promise;
    scope.instrumentMode = true;
    scope.instrumentBuffer = {};
    const pending = scope.playInstrumentNote(72, 'KeyQ');
    scope.releaseInstrumentKey({ code: 'KeyQ', preventDefault() {}, stopImmediatePropagation() {} });
    resume.resolve();
    await pending;
    assert.equal(starts.length, 0, 'released keys cannot start after resume');
    audio.state = 'running';
    await scope.playInstrumentNote(72, 'KeyQ');
    await scope.playInstrumentNote(74, 'KeyW');
    assert.equal(starts[0].stops.length, 1, 'cut itself stops the previous note');
    assert.equal(starts[1].stops.length, 0);
    console.log('Cut itself: latest note wins; early keyup cancels pending playback');
  }
  {
    const { scope, audio } = fixture();
    audio.state = 'running';
    scope.instrumentMode = true;
    scope.instrumentBuffer = {};
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
    assert.notEqual(scope.buildInstrumentDescriptor().signature, baseline, 'missing EQ');
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
    scope.instrumentBuffer = {};
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
    scope.instrumentBuffer = {};
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
