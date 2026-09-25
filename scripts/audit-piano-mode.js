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
  const params = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, value: 1 };
  const audio = {
    currentTime: 0, destination: {}, resume: async () => {},
    decodeAudioData: async () => ({ decoded: true }),
    createGain: () => ({ gain: params, connect() {} }),
    createBufferSource: () => ({ playbackRate: {}, connect() { return { connect() {} }; }, start() { starts.push(this); }, stop() {} }),
  };
  const state = { effectiveRate: 1, preservePitch: false };
  const scope = {
    instrumentMode: false, instrumentOctave: 0, instrumentPreparing: false,
    instrumentBuffer: null, instrumentVoice: null, instrumentNoteRevision: 0,
    instrumentResumePromise: null, instrumentIntentVersion: 0,
    instrumentSnapshot: null, instrumentVoices: new Set(), padRenderPending: false, padRequestNumber: 0,
    padRequests: new Map(), loopState: { active: true, trackIdentity: 'permalink:track', generation: 1, startMs: 0, endMs: 1000, durationMs: 10000 },
    ui: { panel: { hidden: false } }, document: { hidden: false }, hoveredDrum: null, panelOpenMode: null,
    capability: () => true, authorizePlayerTools: async () => true,
    controller: { snapshot: () => state, getActiveAudio: () => ({ paused: true }) },
    effectsController: { snapshot: () => ({ reverb: 0 }) },
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
  for (const name of ['invalidatePendingInstrumentNotes', 'cleanupInstrumentVoice', 'releaseInstrumentVoice',
    'stopInstrumentVoice', 'stopAllInstrumentVoices', 'setInstrumentMode', 'loopMatchesInstrumentSnapshot',
    'disableInstrument', 'exitInstrument', 'requestPad', 'toggleLoopInstrument', 'playInstrumentNote', 'closePanel']) {
    vm.runInContext(extract(name), scope);
  }
  return { scope, audio, state, starts, messages, timers };
}
async function main() {
  {
    const { scope, messages, timers } = fixture();
    const pending = scope.toggleLoopInstrument();
    await flush();
    assert.equal(messages.length, 1);
    scope.disableInstrument();
    assert.equal(messages.length, 1); // No cancel message.
    assert.equal(scope.padRequests.size, 1);
    assert.equal(timers.size, 1);
    const request = [...scope.padRequests.values()][0];
    request.resolve({ instrument: { dataUrl: 'unused' } });
    await pending;
    assert.equal(scope.instrumentMode, false); // Late success is correctly ignored.
    console.log('P1: local cancel leaves request/timer and sends no cancellation; late result is ignored');
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
    const { scope, state, messages } = fixture();
    scope.instrumentSnapshot = { ...scope.loopState };
    scope.instrumentBuffer = { original: true };
    state.effectiveRate = 2;
    state.preservePitch = true;
    scope.effectsController.snapshot = () => ({ reverb: 80 });
    await scope.toggleLoopInstrument();
    assert.equal(scope.instrumentMode, true);
    assert.equal(messages.length, 0);
    console.log('P5: changed rate/pitch/FX reuse the old buffer without a render');
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
