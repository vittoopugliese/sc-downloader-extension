const assert = require('node:assert/strict');
const path = require('node:path');

// Called by the existing browser harness: real Web Audio, fixture separation.
module.exports = async function verifyPiano(page, root) {
  await page.setViewportSize({ width: 1200, height: 1100 });
  await page.goto(page.url());
  await page.locator('#separate:not(:disabled)').click();
  const other = page.locator('.stem[data-stem=other]');
  await other.locator('.stem-piano-toggle').click();
  const piano = other.locator('.stem-piano'), grid = piano.locator('.piano-grid');
  assert.equal(await piano.isVisible(), true);
  assert.equal(await piano.locator('.piano-play').isDisabled(), true);
  const wave = await other.locator('.waveform').boundingBox();
  await page.mouse.move(wave.x + wave.width * .1, wave.y + 35); await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * .25, wave.y + 35, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.locator('.stem-loop-selection:visible').count(), 0, 'Sample selection does not change A–B');
  const start = Number(await other.locator('.stem-pad-marker').getAttribute('data-start'));
  const end = Number(await other.locator('.stem-pad-region').getAttribute('data-end'));
  assert.ok(Math.abs(start - .3) < .01 && Math.abs(end - .75) < .01, 'Own melodic sample can be drawn on the instruments waveform');
  await piano.locator('.piano-root').selectOption('60');
  async function point(pitch, step) {
    await grid.locator(`.piano-pitch-row[data-pitch="${pitch}"]`).scrollIntoViewIfNeeded();
    const rect = await grid.boundingBox();
    const steps = Number(await piano.locator('.piano-bars').inputValue()) * 16;
    return { x: rect.x + rect.width * (step + .2) / steps, y: rect.y + (72 - pitch) * 22 + 11 };
  }
  async function draw(pitch, step, length = 1) {
    const at = await point(pitch, step), rect = await grid.boundingBox();
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    if (length > 1) await page.mouse.move(at.x + (length - 1) / 16 * rect.width, at.y, { steps: 5 });
    await page.mouse.up();
  }
  await draw(60, 0, 4); await draw(64, 0, 4); await draw(67, 0, 4);
  assert.equal(await piano.locator('.piano-note').count(), 3, 'Polyphonic chords');
  assert.equal(await piano.locator('.piano-mode').inputValue(), 'layer');
  const selected = piano.locator('.piano-note.is-selected');
  await selected.press('Shift+ArrowRight');
  assert.equal(Number(await selected.getAttribute('data-length')), 5);
  await selected.press('ArrowRight'); await selected.press('ArrowDown');
  assert.equal(await selected.getAttribute('data-start'), '1');
  assert.equal(await selected.getAttribute('data-pitch'), '66');
  await piano.locator('.piano-velocity').fill('45');
  assert.equal(await selected.getAttribute('data-velocity'), '0.45');
  await piano.locator('.piano-duplicate').click();
  assert.equal(await piano.locator('.piano-note').count(), 4);
  await piano.locator('.piano-delete').click();
  assert.equal(await piano.locator('.piano-note').count(), 3);
  await piano.locator('.piano-undo').click();
  assert.equal(await piano.locator('.piano-note').count(), 4);
  await piano.locator('.piano-redo').click();
  assert.equal(await piano.locator('.piano-note').count(), 3);
  // Pointer movement/resizing, beyond the keyboard path.
  let note = piano.locator('.piano-note').first();
  await note.scrollIntoViewIfNeeded();
  let rect = await note.boundingBox();
  const width = (await grid.boundingBox()).width;
  await page.mouse.move(rect.x + 5, rect.y + 10); await page.mouse.down();
  await page.mouse.move(rect.x + 5 + width / 16 * 4, rect.y + 10, { steps: 4 }); await page.mouse.up();
  assert.equal(await note.getAttribute('data-start'), '4');
  rect = await note.locator('.piano-note-end').boundingBox();
  await page.mouse.move(rect.x + 3, rect.y + 10); await page.mouse.down();
  await page.mouse.move(rect.x + 3 + width / 16 * 2, rect.y + 10, { steps: 4 }); await page.mouse.up();
  assert.equal(await note.getAttribute('data-length'), '6');
  // Both editors read/write the same grid and shared speed slider.
  await page.locator('.stem[data-stem=drums] .stem-sequencer-toggle').click();
  await piano.locator('.piano-bpm').fill('180'); await piano.locator('.piano-bpm').press('Tab');
  await page.waitForFunction(() => document.querySelector('.seq-bpm').value === '180');
  assert.equal(await page.locator('#stem-rate').inputValue(), '1.5');
  await page.locator('#stem-rate').dblclick();
  await piano.locator('.piano-double').click();
  assert.equal(await page.locator('.seq-bpm').inputValue(), '240');
  await piano.locator('.piano-bars').selectOption('2');
  assert.equal(await page.locator('.seq-bars').inputValue(), '2');
  await page.locator('.seq-bars').selectOption('1');
  assert.equal(await piano.locator('.piano-bars').inputValue(), '1');
  await page.locator('.seq-half').click();
  assert.equal(await piano.locator('.piano-bpm').inputValue(), '120');
  await piano.locator('.piano-play').click();
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label') === 'Pausar');
  const sources = await page.evaluate(() => stemTestSources.filter(source => source.loop && source.testStart).slice(-6)
    .map(source => ({ when: source.testStart[0], duration: source.buffer.duration, offset: source.testStart[1] })));
  assert.equal(sources.length, 6);
  assert.ok(sources.every(source => source.when === sources[0].when), 'Piano and stems start on exactly the same audio clock');
  assert.equal(sources.at(-1).duration, 2);
  await page.waitForFunction(() => !document.querySelector('.piano-cursor').hidden);
  // Edits replace derived audio while the transport keeps running.
  await piano.locator('.piano-root').selectOption('57');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Pausar');
  await piano.locator('.piano-play').click();
  await piano.locator('.piano-mode').selectOption('replace');
  await piano.locator('.piano-sustain').check();
  // A preset stores only notes and sample offsets, retaining the immutable WAVs.
  await page.locator('#save-locally').click();
  await page.locator('#save-name').fill('Melodic test'); await page.locator('#save-confirm').click();
  await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
  const id = await page.locator('#stem-presets').inputValue();
  const saved = await page.evaluate(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    return (await (await StemPresets.current()).load(id)).record.settings.piano;
  }, id);
  assert.equal(saved.notes.length, 3); assert.equal(saved.root, 57); assert.equal(saved.sustain, true);
  assert.equal(saved.mode, 'replace'); assert.ok(Math.abs(saved.sample.end - end) < .001);
  await page.goto(page.url().replace(/\?.*/, ''));
  await page.locator('#stem-presets:not(:disabled)').waitFor(); await page.locator('#stem-presets').selectOption(id);
  await piano.locator('.piano-note').first().waitFor();
  assert.equal(await piano.locator('.piano-note').count(), 3);
  assert.equal(await piano.locator('.piano-root').inputValue(), '57');
  assert.equal(await piano.locator('.piano-mode').inputValue(), 'replace');
  assert.equal(await piano.locator('.piano-sustain').isChecked(), true);
  await other.locator('.stem-collapse').click();
  assert.equal(await piano.isVisible(), false);
  await other.locator('.stem-collapse').click();
  for (const width of [1200, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Piano fits ${width}px`);
    await other.screenshot({ path: path.join(root, `test-results/stems-ui/piano-${width}.png`) });
  }
  // Isolate a sustained octave-up melody from the fixture's 70 Hz opening.
  // This measures the real common tone processor, not a mocked pitch result.
  await page.evaluate(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    const library = await StemPresets.current(), { record } = await library.load(id);
    record.settings.states.forEach((state, i) => { state.muted = i !== 2; state.gain = 1; });
    record.settings.piano = { root: 69, mode: 'replace', sustain: true, sample: { start: .1, end: .3 },
      notes: [{ pitch: 81, start: 0, length: 16, velocity: 1 }] };
    await library.update(id, record.settings);
  }, id);
  await page.reload(); await page.locator('#stem-presets:not(:disabled)').waitFor();
  await page.locator('#stem-presets').selectOption(id); await piano.locator('.piano-play:not(:disabled)').waitFor();
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof AudioWorkletNode && this.context.sampleRate === 44100) {
        window.pianoAnalyser = this.context.createAnalyser(); pianoAnalyser.fftSize = 16384; pianoAnalyser.smoothingTimeConstant = 0;
        connect.call(this, pianoAnalyser);
      }
      return connect.call(this, destination, ...args);
    };
  });
  await piano.locator('.piano-play').click();
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label') === 'Pausar');
  for (const [speed, keep, expected] of [[1, false, 140], [.5, false, 70], [.5, true, 140], [2, true, 140], [2, false, 280]]) {
    await page.locator('#stem-rate').evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, speed);
    await page.locator('#stem-keep-tone').setChecked(keep); await page.waitForTimeout(700);
    const frequency = await page.evaluate(() => {
      const data = new Float32Array(pianoAnalyser.frequencyBinCount); pianoAnalyser.getFloatFrequencyData(data);
      let max = 0; for (let i = 1; i < data.length; i++) if (data[i] > data[max]) max = i;
      return max * pianoAnalyser.context.sampleRate / pianoAnalyser.fftSize;
    });
    assert.ok(Math.abs(frequency - expected) < 12, `Piano rate=${speed}, Keep Tone=${keep}: ${frequency} Hz, expected ${expected}`);
  }
  await page.locator('#stem-rate').dblclick(); await page.locator('#stem-keep-tone').uncheck();
  await other.locator('.waveform').click({ position: { x: 80, y: 35 } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Pausar', 'Seeking restarts all lanes together');
  const times = await page.evaluate(() => stemTestSources.filter(source => source.loop).slice(-6).map(source => source.testStart[0]));
  assert.ok(times.every(time => time === times[0]));
  await other.locator('.stem-enable').click(); await page.waitForTimeout(100);
  const rms = await page.evaluate(() => {
    const data = new Float32Array(pianoAnalyser.fftSize); pianoAnalyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
  });
  // The FFT window includes the last 370 ms; allow it to clear after muting.
  if (rms > .0001) await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => {
    const data = new Float32Array(pianoAnalyser.fftSize); pianoAnalyser.getFloatTimeDomainData(data);
    return data.every(sample => Math.abs(sample) < .0001);
  }), 'Instrument mute also silences the piano');
  await piano.locator('.piano-play').click();
  // Numerical validation uses real OfflineAudioContext output, including a
  // transposed tail across the seam and the actual length of gated/sustained notes.
  const measured = await page.evaluate(async () => {
    const { renderPianoPattern } = await import('./scripts/stem-piano-core.mjs');
    const sampleRate = 44100, buffer = new AudioBuffer({ length: sampleRate * 4, sampleRate, numberOfChannels: 2 });
    for (let c = 0; c < 2; c++) buffer.copyToChannel(Float32Array.from({ length: buffer.length }, (_, i) => .25 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), c);
    const state = { root: 69, sample: { start: .1, end: .3, fadeIn: .003, fadeOut: .01 },
      notes: [{ pitch: 81, start: 0, length: 4, velocity: 1 }, { pitch: 57, start: 8, length: 4, velocity: .5 }] };
    const grid = { bpm: 120, bars: 1, start: 0 };
    const oneShot = await renderPianoPattern(state, grid, buffer);
    const held = await renderPianoPattern({ ...state, sustain: true }, grid, buffer);
    const seam = await renderPianoPattern({ ...state, sustain: true, notes: [{ pitch: 69, start: 15, length: 4, velocity: 1 }] }, grid, buffer);
    const frequency = (audio, start, end) => {
      const pcm = audio.getChannelData(0); let crossings = 0;
      for (let i = Math.ceil(start * sampleRate); i < end * sampleRate; i++) if (pcm[i - 1] < 0 && pcm[i] >= 0) crossings++;
      return crossings / (end - start);
    };
    const rms = (audio, start, end) => {
      const pcm = audio.getChannelData(0).subarray(Math.round(start * sampleRate), Math.round(end * sampleRate));
      return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
    };
    return { frequency: [frequency(oneShot, .02, .08), frequency(oneShot, 1.03, 1.3)],
      oneShotAfterEnd: rms(oneShot, .15, .3), sustained: rms(held, .2, .4), heldAfterGate: rms(held, .6, .8),
      wrappedTail: rms(seam, .01, .2), wrappedEnd: rms(seam, .4, .6), length: held.length,
      stereo: held.getChannelData(0).every((value, i) => value === held.getChannelData(1)[i]),
      finite: held.getChannelData(0).every(Number.isFinite) };
  });
  assert.ok(Math.abs(measured.frequency[0] - 880) < 20 && Math.abs(measured.frequency[1] - 220) < 10, JSON.stringify(measured));
  assert.ok(measured.oneShotAfterEnd < 1e-6 && measured.sustained > .05 && measured.heldAfterGate < 1e-6);
  assert.ok(measured.wrappedTail > .05 && measured.wrappedEnd < 1e-6);
  assert.equal(measured.length, 88200); assert.ok(measured.stereo && measured.finite);
  console.log('Piano: sample selection, chords, drag/resize, velocity, undo/redo, shared grid/transport, presets, responsive layout and real pitched audio passed.');
};
