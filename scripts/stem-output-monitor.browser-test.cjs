// Real audio/DOM coverage for the passive header spectrum and its render lifecycle.
const assert = require('node:assert/strict');
const { dropAudio } = require('./drop-audio.test-helper.cjs');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ locale: 'es-AR', viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.monitorPaints = 0;
      window.sampleMeterReads = 0;
      const readSamples = AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData = function (...args) { window.sampleMeterReads++; return readSamples.apply(this, args); };
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.canvas.parentElement?.id === 'output-monitor' && args[0] === 0 && args[1] === 0) window.monitorPaints++;
        return fill.apply(this, args);
      };
    });
    const url = `http://127.0.0.1:${server.address().port}/stems.html`;
    await page.goto(url);
    await page.locator('#audio-file:not(:disabled)').waitFor({ state: 'attached' });
    const monitor = page.locator('#output-monitor');
    assert.equal(await monitor.getAttribute('role'), 'img');
    assert.equal(await monitor.getAttribute('aria-label'), 'Espectro de frecuencias de salida');
    assert.equal(await monitor.evaluate(element => element.tabIndex), -1);
    assert.equal(await monitor.evaluate(element => getComputedStyle(element).cursor), 'auto');
    assert.equal(await monitor.locator(':scope > *').count(), 1);
    // Second header row: the spectrum follows the editing tools and fills the rest of the row.
    const box = await monitor.boundingBox(), slot = await page.locator('.output-monitor-slot').boundingBox();
    const tempo = await page.locator('.workspace-header .stem-tempo').boundingBox();
    const tools = await page.locator('.workspace-header .pl-tools').boundingBox();
    assert.deepEqual([box.x, box.width, box.height], [slot.x, slot.width, 30], 'The spectrum occupies exactly one control row');
    const deck = await page.locator('.daw-deck').boundingBox();
    assert.ok(box.x >= tools.x + tools.width && box.x - tools.x - tools.width <= 12, 'The spectrum follows the tools');
    assert.ok(Math.abs(deck.x + deck.width - 10 - box.x - box.width) < 2, 'The spectrum fills the rest of the row');
    assert.ok(box.y >= tempo.y + tempo.height, 'The spectrum sits below the transport');
    assert.ok((await page.locator('.preset-menu').boundingBox()).width <= 150, 'The project dropdown does not stretch');
    const markup = await monitor.evaluate(element => element.outerHTML);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    await monitor.click(); await monitor.dblclick();
    assert.equal(await monitor.evaluate(element => element.outerHTML), markup, 'Clicks do not change the passive spectrum');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storage, 'Clicks write no preferences');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    await page.reload(); await page.locator('#audio-file:not(:disabled)').waitFor({ state: 'attached' });
    assert.equal(await monitor.getAttribute('aria-label'), 'Espectro de frecuencias de salida');

    const { encodeWav } = await import('./stem-audio.mjs');
    const rate = 44100, duration = 12;
    const pcm = Float32Array.from({ length: rate * duration }, (_, i) =>
      .12 * (Math.sin(i * 2 * Math.PI * 110 / rate) + Math.sin(i * 2 * Math.PI * 160 / rate) + Math.sin(i * 2 * Math.PI * 1700 / rate)));
    await dropAudio(page, { name: 'Spectrum tones.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([pcm, pcm])) });
    await page.locator('.pl-clip').waitFor();
    await page.locator('#play').click();
    await page.waitForTimeout(800);
    const sample = page.locator('.pl-hbar-corner .pl-shelf button').first();
    assert.ok(await sample.evaluate(e => Number(e.style.getPropertyValue('--sample-level'))) > .4, 'Playing audio lights its library border');
    assert.equal(await sample.evaluate(e => getComputedStyle(e, '::after').boxShadow), 'none', 'The level strip has no glow');
    assert.equal(await sample.evaluate(e => getComputedStyle(e, '::before').content), 'none', 'No reactive border overlay remains');
    assert.equal(await sample.evaluate(e => getComputedStyle(e).borderLeftColor), 'rgb(69, 66, 62)', 'Even selected samples have a neutral frame; only the moving strip is colored');
    const pixels = await monitor.locator('canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
      const rect = canvas.getBoundingClientRect(), scale = width / rect.width, scaleY = height / rect.height;
      const data = ctx.getImageData(0, 0, width, height).data;
      const at = frequency => {
        const x = Math.round((2 + Math.log(frequency / 25) / Math.log(20000 / 25) * (rect.width - 4)) * scale);
        let top = height;
        for (let y = Math.ceil(scaleY); y < height - 2 * scaleY; y++) {
          if (data[(y * width + x) * 4] > 150) { top = y; break; }
        }
        return (height - top) / scaleY;
      };
      return { bass: at(110), secondBass: at(160), valley: at(133), treble: at(1700), scale };
    });
    assert.ok(pixels.bass > pixels.valley + 3 && pixels.secondBass > pixels.valley + 3, `Adjacent bass tones remain distinct: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.treble > 6, `The same spectrum includes the upper frequencies: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.scale >= 2, 'Canvas is supersampled even on a 1x display');
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await monitor.screenshot({ path: path.join(root, 'test-results/output-monitor-spectrum.png') });
    await page.mouse.move(0, 0);
    await page.locator('.workspace-header').screenshot({ path: path.join(root, 'test-results/output-monitor-header.png') });
    async function measureCadence() {
      await page.evaluate(() => {
        window.monitorPaints = 0; window.displayFrames = 0;
        const count = () => { window.displayFrames++; window.frameCounter = requestAnimationFrame(count); };
        window.frameCounter = requestAnimationFrame(count);
      });
      await page.waitForTimeout(1000);
      const cadence = await page.evaluate(() => {
        cancelAnimationFrame(window.frameCounter);
        return { paints: window.monitorPaints, frames: window.displayFrames };
      });
      assert.ok(cadence.frames > 30 && cadence.paints >= cadence.frames * .85 && cadence.paints <= cadence.frames + 2,
        `Paints follow display frames: ${JSON.stringify(cadence)}`);
      return cadence;
    }
    const cadence = await measureCadence();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // This passive signal display must retain its timing even when the OS reduces animations.
    await measureCadence();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#header-pin').click();
    await page.evaluate(() => { document.body.style.paddingBottom = '2000px'; window.scrollTo(0, 1500); });
    await page.waitForTimeout(200);
    const hiddenPaints = await page.evaluate(() => window.monitorPaints);
    const hiddenReads = await page.evaluate(() => window.sampleMeterReads);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.monitorPaints), hiddenPaints, 'No drawing outside viewport');
    assert.equal(await page.evaluate(() => window.sampleMeterReads), hiddenReads, 'Invisible sample buttons do not read audio levels');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(180);
    assert.ok(await page.evaluate(() => window.monitorPaints) > hiddenPaints);
    await page.locator('#play').click();
    await page.waitForTimeout(2200);
    assert.equal(await sample.evaluate(e => Number(e.style.getPropertyValue('--sample-level'))), 0, 'The library border settles back to idle after pause');
    const idlePaints = await page.evaluate(() => window.monitorPaints);
    const idleReads = await page.evaluate(() => window.sampleMeterReads);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.monitorPaints), idlePaints, 'No animation loop after audio becomes idle');
    assert.equal(await page.evaluate(() => window.sampleMeterReads), idleReads, 'Paused sample meters do not analyse audio');

    // Real sample meters: independent sources, stereo phase, live faders, mute/solo and stop.
    const sampleMeters = await page.evaluate(async () => {
      const { createPlaylistEngine } = await import('./scripts/stem-playlist-audio.mjs');
      const { emptyArrangement, newClip } = await import('./scripts/stem-playlist-core.mjs');
      const context = new AudioContext({ sampleRate: 44100 }); await context.resume();
      const makeAsset = (id, amplitude) => {
        const buffer = context.createBuffer(2, 44100 * 2, 44100);
        for (let c = 0; c < 2; c++) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin(i * 2 * Math.PI * 440 / 44100) * (c ? -1 : 1);
        }
        return { id, buffer };
      };
      const loud = makeAsset('loud', .3), quiet = makeAsset('quiet', .03), unused = makeAsset('unused', .6);
      const assets = new Map([loud, quiet, unused].map(asset => [asset.id, asset]));
      const engine = createPlaylistEngine({ context, output: context.destination, assets: () => assets,
        cache: { has: () => true, lookup: () => null } });
      const state = emptyArrangement(); state.clips = [newClip(loud, state.tracks[0].id), newClip(quiet, state.tracks[1].id)];
      const transport = { rate: 1, loop: { start: 0, end: 2 } };
      const read = async () => { await new Promise(resolve => setTimeout(resolve, 180)); return Object.fromEntries(engine.sampleLevels()); };
      try {
        engine.play(state, 0, transport); const initial = await read();
        state.tracks[0].gain = .1; engine.update(state, transport); const attenuated = await read();
        state.tracks[0].mute = true; engine.update(state, transport); const muted = await read();
        state.tracks[0].mute = false; state.tracks[0].solo = true; engine.update(state, transport); const solo = await read();
        state.tracks[0].solo = false; state.clips[0].mute = true; engine.update(state, transport); const clipMuted = await read();
        state.clips[0].mute = false; state.clips[0].gain = .5; state.clips[0].normalizationGain = 2;
        engine.update(state, transport); const normalized = await read();
        // Measure the read/peak work on sixteen independent stereo sources during live playback.
        state.tracks = Array.from({ length: 16 }, (_, i) => ({ id: `meter-track-${i}`, name: `Track ${i}`, gain: 1, mute: false, solo: false }));
        state.clips = state.tracks.map((track, i) => {
          const asset = makeAsset(`meter-sample-${i}`, .1); assets.set(asset.id, asset); return newClip(asset, track.id);
        });
        engine.play(state, 0, transport); await read();
        const durations = [];
        for (let i = 0; i < 90; i++) {
          await new Promise(requestAnimationFrame);
          const start = performance.now(); engine.sampleLevels(); durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        const timing = { sources: 16, medianMs: durations[45], p95Ms: durations[85] };
        const filtered = Object.keys(Object.fromEntries(engine.sampleLevels(new Set(['meter-sample-0']))));
        engine.stop(); const stopped = await read();
        return { initial, attenuated, muted, solo, clipMuted, normalized, stopped, timing, filtered };
      } finally { engine.dispose(); await context.close(); }
    });
    assert.ok(Math.abs(sampleMeters.initial.loud - .3) < .01, 'Opposite-phase stereo still meters at its real peak');
    assert.ok(Math.abs(sampleMeters.initial.quiet - .03) < .005, 'Quiet audio has its own lower level');
    assert.equal(sampleMeters.initial.unused, undefined, 'Unused audio never lights up with another sample');
    assert.ok(Math.abs(sampleMeters.attenuated.loud - .03) < .005, 'The live track fader scales the source meter');
    assert.ok((sampleMeters.muted.loud || 0) < .0001 && sampleMeters.muted.quiet > .02, 'Mute extinguishes only its source');
    assert.ok((sampleMeters.solo.quiet || 0) < .0001 && sampleMeters.solo.loud > .02, 'Solo extinguishes other channels');
    assert.ok((sampleMeters.clipMuted.loud || 0) < .0001, 'Muted clips do not light their source');
    assert.ok(Math.abs(sampleMeters.normalized.loud - .03) < .005, 'Clip gain and normalization feed the meter');
    assert.deepEqual(sampleMeters.stopped, {}, 'Stopped playback returns no source activity');
    assert.deepEqual(sampleMeters.filtered, ['meter-sample-0'], 'Only requested visible samples are analysed');

    // Measure actual changes in the drawn signal, including bass attack/release.
    // A repaint count alone cannot detect a delayed analysis window.
    const audition = await page.evaluate(async () => {
      const { mountOutputMonitor } = await import('./scripts/stem-output-monitor.mjs');
      const { createEqualizedOutput } = await import('./scripts/local-audio-output.mjs');
      const element = document.querySelector('#output-monitor').cloneNode(true);
      element.id = 'audition-monitor'; element.style.cssText = 'width:200px;height:42px;margin:0'; document.body.prepend(element);
      let created = 0;
      const output = createEqualizedOutput({ audioContext: () => { created++; return new AudioContext({ sampleRate: 44100 }); } });
      const view = mountOutputMonitor({ element, output });
      const lazy = created === 0, context = output.getPlaybackContext(); await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(output.input()); oscillator.start(); view.setActive(true);
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = element.querySelector('canvas'), ctx = canvas.getContext('2d');
      const dpr = canvas.width / canvas.clientWidth, responses = [];
      for (const frequency of [110, 2000]) {
        oscillator.frequency.value = frequency;
        const x = Math.floor((2 + Math.log(frequency / 25) / Math.log(20000 / 25) * (canvas.clientWidth - 4)) * dpr);
        const level = () => {
          const data = ctx.getImageData(x, 0, 1, canvas.height).data;
          for (let y = Math.ceil(dpr); y < canvas.height - 2 * dpr; y++) {
            if (data[y * 4] > 150) return (canvas.height - y) / dpr - 2;
          }
          return 0;
        };
        gain.gain.setValueAtTime(.3, context.currentTime);
        await new Promise(resolve => setTimeout(resolve, 450));
        const full = level();
        gain.gain.setValueAtTime(0, context.currentTime);
        await new Promise(resolve => setTimeout(resolve, 450));
        const onset = context.currentTime + .1, offset = onset + .35;
        gain.gain.setValueAtTime(.3, onset); gain.gain.setValueAtTime(0, offset);
        const response = await new Promise(resolve => {
          let attackMs = null;
          function check() {
            const time = context.currentTime, height = level();
            if (attackMs === null && time >= onset && height >= full * .85) attackMs = (time - onset) * 1000;
            if (time >= offset && height <= full * .2) resolve({ frequency, full, attackMs, releaseMs: (time - offset) * 1000 });
            else if (time > offset + 1) resolve({ frequency, full, attackMs, releaseMs: Infinity });
            else requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
        responses.push(response);
      }
      let detached = 0;
      output.observeOutput((_, source) => {
        const disconnect = source.disconnect.bind(source);
        source.disconnect = node => { detached++; return disconnect(node); };
      });
      view.dispose();
      const monitorDetached = detached;
      oscillator.stop(); output.dispose(); await context.close(); element.remove();
      return { lazy, responses, detached: monitorDetached };
    });
    assert.equal(audition.lazy, true, 'Mounting the monitor does not initialize audio');
    for (const response of audition.responses) {
      assert.ok(response.full > 15, `The ${response.frequency} Hz reference is visible`);
      assert.ok(response.attackMs !== null && response.attackMs < (response.frequency < 200 ? 110 : 80), `Fast attack: ${JSON.stringify(response)}`);
      assert.ok(response.releaseMs >= 110 && response.releaseMs < 280, `Short sounds linger briefly before fading: ${JSON.stringify(response)}`);
    }
    assert.equal(audition.detached, 2, 'Disposal disconnects both analysis windows');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileBox = await monitor.boundingBox(), mobileSlot = await page.locator('.output-monitor-slot').boundingBox();
    assert.ok(mobileBox.height >= 30);
    assert.ok(Math.abs(mobileBox.width - mobileSlot.width) < 1, 'The spectrum fills its slot on mobile');
    assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390, 'Compact spectrum fits on mobile');
    await monitor.click(); assert.deepEqual(await monitor.boundingBox(), mobileBox);
    await page.locator('.workspace-header').screenshot({ path: path.join(root, 'test-results/output-monitor-mobile.png') });
    const retina = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 1440, height: 1000 } });
    await retina.goto(url); await retina.locator('#audio-file:not(:disabled)').waitFor({ state: 'attached' });
    const retinaScale = await retina.locator('#output-monitor canvas').evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
    assert.ok(retinaScale >= 3, 'The backing store preserves full density on 3x displays');
    await retina.close();
    for (const width of [1440, 1280, 1200, 1199, 1000, 800, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { header: rect('.workspace-header'), monitor: rect('#output-monitor'), library: rect('.pl-library'), playlist: rect('#playlist'), tools: rect('.pl-tools'), scrollbar: rect('.pl-hbar-row'), project: rect('.preset-menu'), transport: rect('.daw-transport'), load: rect('.preset-toolbar'), windows: rect('.daw-windows'), inspector: rect('.pl-inspector'), knob: rect('.pl-inspector .ui-knob-dial'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.overflow, false, `No horizontal page overflow at ${width}px`);
      assert.equal(layout.monitor.height, 30, `Spectrum keeps one-row height at ${width}px`);
      assert.ok(layout.project.width <= 150, `The project dropdown stays compact at ${width}px`);
      assert.ok(layout.library.x >= layout.playlist.x && layout.library.right <= layout.playlist.right && layout.library.y >= layout.scrollbar.y, `The used sounds sit beside the playlist scrollbar at ${width}px`);
      if (width >= 1200) {
        assert.ok(Math.abs(layout.monitor.y + layout.monitor.height / 2 - layout.tools.y - layout.tools.height / 2) < 2, 'The spectrum shares the tools row');
        assert.equal(layout.transport.y, layout.load.y, 'Play follows the project controls on the first row');
        assert.ok(layout.transport.x >= layout.load.right, 'Play is to the right of the project controls');
        assert.ok(layout.transport.x - layout.load.right <= 12, 'Play immediately follows the project controls without an expanding gap');
        assert.ok(Math.abs(layout.windows.y + layout.windows.height / 2 - layout.transport.y - layout.transport.height / 2) < 2, 'Every window button and header option shares the transport row');
        assert.ok(Math.abs(layout.windows.right - layout.monitor.right) < 2, 'The spectrum reaches the end of the button row');
        assert.equal(layout.knob.width, 22, 'Clip knobs are smaller');
        assert.ok(layout.inspector.height < 45 && layout.header.height < 100, `Only two compact rows at ${width}px`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Output spectrum checks passed. Tones: ${JSON.stringify(pixels)}; cadence: ${JSON.stringify(cadence)}; audition: ${JSON.stringify(audition)}; sample meter cost: ${JSON.stringify(sampleMeters.timing)}.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
