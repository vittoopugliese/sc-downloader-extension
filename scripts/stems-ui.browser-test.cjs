// UI regression with deterministic PCM and a fixture separation worker.
// Real audio playback and spectral analysis; no model download/inference here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { encodeWav } = await import('./stem-audio.mjs');
  const channels = [0, 1].map(() => Float32Array.from({ length: 44100 * 3 }, (_, i) => {
    const t = i / 44100, frequency = [70, 1000, 9000][Math.floor(t)];
    return Math.sin(2 * Math.PI * frequency * t) * (.3 + .2 * Math.sin(t * 17));
  }));
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav(channels)).toString('base64')}`;
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 2, locale: 'es-AR' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://i1.sndcdn.com/stems-fixture.jpg', route => route.fulfill({ path: path.join(root, 'assets/icons/player-toolkit.png'), contentType: 'image/png' }));
    await page.route('https://tbot.xyz/lumber/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lumberjack fixture</title>' }));
    await page.addInitScript(({ dataUrl }) => {
      globalThis.stemTestSources = [];
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this);
        const start = source.start.bind(source);
        source.start = (...args) => { source.testStart = args; start(...args); };
        globalThis.stemTestSources.push(source); return source;
      };
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Midnight sessions — selected loop', trimRange: { startMs: 12000, endMs: 15000 } }
        : { success: true, instrument: { dataUrl } } } };
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async request => ({ ...await send(request), ...(request.type === 'STEM_LOOP_INFO'
        ? { artist: 'Fixture artist', durationMs: 185000, artworkUrl: 'https://i1.sndcdn.com/stems-fixture.jpg' } : {}) });
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .1,
          outputs: [1, .7, .4, .2].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 30); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=fixture`);
    await page.waitForFunction(() => document.querySelector('#artwork').naturalWidth > 0);
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    assert.equal(await page.title(), 'Separador de stems · Player Tools');
    assert.equal(await page.locator('.prepare').getAttribute('aria-label'), 'Separación');
    assert.equal(await page.locator('#audition').getAttribute('aria-label'), 'Escuchar y comparar');
    assert.equal(await page.locator('.comparison').getAttribute('aria-label'), 'Comparar');
    assert.equal(await page.locator('#clear-cache').textContent(), 'Eliminar modelo de la caché');
    assert.equal(await page.locator('#track-meta').textContent(), 'Fixture artist · 3:05');
    assert.equal(await page.locator('#artwork-fallback').isVisible(), false);
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage;
      let fail = true;
      chrome.runtime.sendMessage = request => {
        if (request.type === 'STEM_LOOP_RENDER' && fail) {
          fail = false;
          return Promise.resolve({ success: false, code: 'not_found', status: 404,
            error: 'Stream link expired (404). https://media.test/audio?token=secret' });
        }
        return send(request);
      };
    });
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    const preparationError = await page.locator('#status').textContent();
    assert.match(preparationError, /Stream link expired \(404\)/, 'Preparation errors retain the backend reason');
    assert.doesNotMatch(preparationError, /media\.test|token=secret/, 'Signed media URLs are not displayed');
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelectorAll('.stem canvas').length === 4);
    assert.equal(await page.locator('#toggle-game').textContent(), 'Jugar a Lumberjack');
    assert.equal(await page.locator('.utility-actions').evaluate(node => [...node.children].map(child => child.id).join(',')), 'clear-cache,toggle-game');
    const clearCacheBounds = await page.locator('#clear-cache').boundingBox();
    const gameButtonBounds = await page.locator('#toggle-game').boundingBox();
    assert.ok(gameButtonBounds.x >= clearCacheBounds.x + clearCacheBounds.width, 'Lumberjack button sits to the right of the cache button');
    await page.locator('#toggle-game').click();
    const gameBounds = await page.locator('#game-panel iframe').boundingBox();
    assert.deepEqual({ width: gameBounds.width, height: gameBounds.height }, { width: 300, height: 450 });
    assert.equal(await page.locator('#game-panel iframe').getAttribute('title'), 'Juego Lumberjack');
    await page.locator('#toggle-game').click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.stem canvas');
      return canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[1] > 100;
    });
    assert.equal(await page.locator('.brand img').evaluate(node => node.complete && node.naturalWidth > 0), true);
    assert.equal(await page.locator('#original-waveform canvas, .stem canvas').count(), 5);
    assert.equal(await page.locator('#mix-tools canvas').count(), 2);
    const checkAlignment = async () => {
      const original = await page.locator('#original-waveform canvas').boundingBox();
      for (const canvas of await page.locator('.stem canvas').all()) {
        const bounds = await canvas.boundingBox();
        assert.ok(Math.abs(bounds.x - original.x) < 1 && Math.abs(bounds.width - original.width) < 1, 'Stem timelines align with original');
      }
      const wav = await page.locator('.download').first().boundingBox();
      const volume = await page.locator('.pad-knob').first().boundingBox();
      assert.ok(volume.x >= wav.x + wav.width, 'Volume sits to the right of WAV');
    };
    await checkAlignment();
    const knob = page.locator('.pad-knob').first();
    await knob.press('Home');
    assert.equal(await knob.getAttribute('aria-valuenow'), '0');
    assert.equal(await page.locator('.stem').first().evaluate(row => row.classList.contains('is-silent')), true);
    await knob.press('ArrowUp');
    assert.equal(await knob.getAttribute('aria-valuenow'), '1');
    await knob.dblclick();
    assert.equal(await knob.getAttribute('aria-valuenow'), '100');
    const bounds = await knob.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 70); await page.mouse.up();
    assert.equal(await knob.getAttribute('aria-valuenow'), '50');
    await knob.dblclick();
    const colors = await page.locator('#original-waveform canvas').evaluate(canvas => [.15, .5, .85].map(x => Array.from(canvas.getContext('2d').getImageData(canvas.width * x, canvas.height / 2, 1, 1).data).slice(0, 3)));
    colors.forEach((rgb, band) => assert.equal(rgb.indexOf(Math.max(...rgb)), band));
    await page.locator('#play').click();
    await page.waitForTimeout(300);
    const positions = await page.locator('.waveform-playhead').evaluateAll(nodes => nodes.map(node => parseFloat(node.style.left)));
    assert.ok(positions[0] > 0); assert.ok(positions.every(value => value === positions[0]));
    await page.locator('#play').click();
    const stopped = await page.locator('.waveform-playhead').first().getAttribute('style');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.waveform-playhead').first().getAttribute('style'), stopped);
    assert.equal(await page.locator('#repeat').count(), 0, 'Repeat is always enabled and has no toggle');
    await page.locator('#play').press('Space');
    await page.waitForTimeout(3200);
    assert.match(await page.locator('#play').textContent(), /Pausar/, 'The full sample keeps playing past its end');
    assert.ok(await page.evaluate(() => stemTestSources.slice(-5).every(source => source.loop && source.loopStart === 0 && source.loopEnd === 3)));
    await page.locator('#play').dispatchEvent('keydown', { code: 'Space', key: ' ', repeat: true });
    assert.match(await page.locator('#play').textContent(), /Pausar/, 'Holding Space does not toggle repeatedly');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'shortcut-text-fixture'; document.body.append(input); input.focus();
    });
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#shortcut-text-fixture').inputValue(), ' ');
    assert.match(await page.locator('#play').textContent(), /Pausar/, 'Typing does not pause audio');
    await page.locator('#shortcut-text-fixture').evaluate(input => input.remove());
    await page.keyboard.press('Space');
    assert.match(await page.locator('#play').textContent(), /Reproducir/);
    await page.locator('#original-waveform canvas').click({ position: { x: 450, y: 30 } });
    assert.ok(parseFloat(await page.locator('.waveform-playhead').first().evaluate(node => node.style.left)) > 45);
    await page.locator('.stem-enable').first().click();
    assert.equal(await page.locator('.stem.is-silent').count(), 1);
    await page.locator('.stem-enable').first().click({ button: 'right' });
    assert.deepEqual(await page.locator('.stem-enable').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-checked'))), ['true', 'false', 'false', 'false']);
    assert.equal(await page.locator('.stem.is-silent').count(), 3);
    await page.locator('.stem-enable').nth(1).click({ button: 'right' });
    assert.deepEqual(await page.locator('.stem-enable').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-checked'))), ['false', 'true', 'false', 'false']);
    // Ordinary clicks can add tracks back to the mix after isolating one.
    await page.locator('.stem-enable').nth(2).click();
    await page.locator('.stem-enable').nth(3).click();
    assert.equal(await page.locator('.stem.is-silent').count(), 1);
    await page.locator('#original').click();
    assert.equal(await page.locator('.stem.is-silent').count(), 4);
    await page.locator('#mix').click();
    const download = page.waitForEvent('download'); await page.locator('.download').first().click();
    assert.match((await download).suggestedFilename(), /_drums.wav$/);
    assert.equal(await page.locator('.stem-sampler-toggle').count(), 1);
    assert.equal(await page.locator('.stem-mute').count(), 0);
    for (const row of await page.locator('.stem[data-stem=drums]').all()) {
      const toggle = row.locator('.stem-sampler-toggle');
      await toggle.click();
      assert.equal(await row.locator('.drum-pad:visible').count(), 8);
      assert.equal(await row.locator('.drum-key').allTextContents().then(keys => keys.join('')), 'ASDFGHJK');
      await row.locator('.drum-pad').first().click();
      await toggle.click(); await toggle.click();
      assert.equal(await row.locator('.drum-pad.is-selected').count(), 1);
    }
    assert.equal(await page.locator('.download').first().textContent(), '');
    assert.match(await page.locator('.download').first().getAttribute('title'), /WAV/);
    assert.equal(await page.locator('.stem-solo').first().getAttribute('aria-checked'), 'false');
    const waveform = await page.locator('#original-waveform .waveform').boundingBox();
    await page.mouse.move(waveform.x + waveform.width * .25, waveform.y + 35);
    await page.mouse.down();
    await page.mouse.move(waveform.x + waveform.width * .6, waveform.y + 35, { steps: 8 });
    await page.mouse.up();
    const ranges = await page.locator('.stem-loop-selection').evaluateAll(nodes => nodes.map(node => [node.style.left, node.style.width]));
    assert.equal(ranges.length, 5); assert.ok(ranges.every(range => JSON.stringify(range) === JSON.stringify(ranges[0])));
    await page.locator('#play').click();
    const sources = await page.evaluate(() => stemTestSources.slice(-5).map(source => [source.loop, source.loopStart, source.loopEnd]));
    assert.equal(sources.length, 5);
    for (const [repeat, start, end] of sources) { assert.equal(repeat, true); assert.ok(Math.abs(start - .75) < .02); assert.ok(Math.abs(end - 1.8) < .02); }
    await page.waitForTimeout(1500);
    const loopPosition = parseFloat(await page.locator('.waveform-playhead').first().evaluate(node => node.style.left));
    assert.ok(loopPosition >= 24 && loopPosition < 61, 'Playback wraps inside A-B');
    await page.locator('#play').press('Space');
    assert.match(await page.locator('#play').textContent(), /Reproducir/, 'Space pauses the selected loop');
    await page.locator('.stem-loop-end').last().press('ArrowLeft');
    assert.ok(await page.locator('.stem-loop-end').evaluateAll(nodes => nodes.every(node => Number(node.getAttribute('aria-valuenow')) < 1.75)));
    await page.locator('#original-waveform canvas').dblclick({ position: { x: 30, y: 40 } });
    assert.equal(await page.locator('.stem-loop-selection:visible').count(), 0);
    await page.locator('.stem-enable').first().click();
    const drums = page.locator('.stem[data-stem=drums]');
    const drumWave = drums.locator('.waveform');
    const drumBounds = await drumWave.boundingBox();
    for (let i = 0; i < 8; i++) {
      await drums.locator('.drum-pad').nth(i).click();
      await drumWave.click({ position: { x: drumBounds.width * (.1 + i * .1), y: 40 } });
    }
    assert.equal(await drums.locator('.stem-pad-marker:visible').count(), 8);
    assert.equal(await page.locator('.stem-loop-selection:visible').count(), 0, 'Pad clicks do not create loops');
    const starts = await drums.locator('.stem-pad-marker').evaluateAll(nodes => nodes.map(node => Number(node.dataset.start)));
    for (let i = 0; i < 8; i++) assert.ok(Math.abs(starts[i] - (.3 + i * .3)) < .02);
    await page.keyboard.press('a');
    await page.waitForTimeout(30);
    const sample = await page.evaluate(() => stemTestSources.at(-1).testStart);
    assert.ok(Math.abs(sample[1] - starts[0]) < .001);
    assert.ok(Math.abs(sample[2] - (starts[1] - starts[0])) < .001, 'Pad stops at next marker');
    await page.keyboard.press('k'); await page.waitForTimeout(30);
    const lastSample = await page.evaluate(() => stemTestSources.at(-1).testStart);
    assert.ok(Math.abs(lastSample[2] - (3 - starts[7])) < .001, 'Last pad plays to the end');
    await drumWave.hover(); await page.mouse.wheel(0, -100); await page.waitForTimeout(100);
    const windows = await page.locator('.waveform').evaluateAll(nodes => nodes.map(node => [Number(node.dataset.viewportStart), Number(node.dataset.viewportEnd)]));
    assert.ok(windows.every(window => JSON.stringify(window) === JSON.stringify(windows[0])));
    assert.ok(windows[0][1] - windows[0][0] < 3000, 'All five waveforms zoom together');
    await drums.locator('.drum-pad').first().click();
    await drumWave.click({ position: { x: drumBounds.width * .4, y: 40 } });
    const moved = Number(await drums.locator('.stem-pad-marker').first().getAttribute('data-start'));
    assert.ok(Math.abs(moved * 1000 - (windows[0][0] + .4 * (windows[0][1] - windows[0][0]))) < 10, 'Assignment uses the zoomed timeline');
    await drumWave.hover(); await page.keyboard.down('Shift'); await page.mouse.wheel(0, 100); await page.keyboard.up('Shift'); await page.waitForTimeout(100);
    assert.ok(Number(await drumWave.getAttribute('data-viewport-start')) > windows[0][0]);
    await page.locator('.stem-zoom-tools button').last().click();
    assert.equal(Number(await drumWave.getAttribute('data-viewport-start')), 0);
    await drums.locator('.drum-pad').first().click();
    await page.keyboard.press('Escape');
    assert.equal(await drumWave.evaluate(node => node.classList.contains('is-placing-pad')), false);
    await drums.locator('.drum-pad').first().click();
    const beforeDrag = await drums.locator('.stem-pad-marker').first().getAttribute('data-start');
    const dragBounds = await drumWave.boundingBox();
    await page.mouse.move(dragBounds.x + dragBounds.width * .2, dragBounds.y + 40);
    await page.mouse.down(); await page.mouse.move(dragBounds.x + dragBounds.width * .7, dragBounds.y + 40, { steps: 6 }); await page.mouse.up();
    assert.equal(await drums.locator('.stem-pad-marker').first().getAttribute('data-start'), beforeDrag, 'Dragging while armed changes the loop, not the pad');
    assert.equal(await page.locator('.stem-loop-selection:visible').count(), 5);
    await page.keyboard.press('Escape');
    await page.locator('#original-waveform .waveform').dblclick({ position: { x: 10, y: 40 } });
    const artifacts = path.join(root, 'test-results/stems-ui'); fs.mkdirSync(artifacts, { recursive: true });
    const eqBounds = await page.locator('.peq').boundingBox();
    const recorderBounds = await page.locator('.record-section').boundingBox();
    assert.equal(eqBounds.y, recorderBounds.y, 'EQ and recorder sit side by side');
    assert.ok(Math.abs(eqBounds.width - recorderBounds.width) < 1, 'Both cards have equal width');
    // Record the audible mix through the real worklet and inspect downloaded PCM.
    // Isolate the quiet vocal stem to avoid clipping, then compare all-OFF and EQ.
    await page.locator('.stem-enable').last().click({ button: 'right' });
    await page.locator('#stem-rate-reset').click();
    if (await page.locator('#play').textContent().then(value => value.includes('Pausar'))) await page.locator('#play').click();
    await page.locator('#play').click();
    async function captureRms() {
      await page.locator('.record-start').click();
      await page.waitForFunction(() => document.querySelector('.record-section').dataset.recording === 'true');
      await page.waitForTimeout(3300);
      await page.locator('.record-stop').click();
      await page.waitForFunction(() => !document.querySelector('.record-download').disabled);
      const downloadEvent = page.waitForEvent('download');
      await page.locator('.record-download').click();
      const wav = fs.readFileSync(await (await downloadEvent).path());
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt32LE(24), 48000);
      // Trim tap setup and stop transients.
      let sum = 0, samples = 0;
      for (let i = 44 + 48000 * 4 / 4; i < wav.length - 48000 * 4 / 4; i += 2) {
        sum += (wav.readInt16LE(i) / 32768) ** 2; samples++;
      }
      assert.ok(samples > 48000, 'Recorder exports a complete take');
      return Math.sqrt(sum / samples);
    }
    const dryRms = await captureRms();
    assert.ok(dryRms > .025 && dryRms < .08, `Only the enabled vocal stem is captured: ${dryRms}`);
    await page.locator('.stem-enable').last().click();
    await page.waitForTimeout(200);
    const mutedRms = await captureRms();
    assert.ok(mutedRms < .0001, `Disabled stems are silent in the WAV: ${mutedRms}`);
    await page.locator('.stem-enable').last().click();
    // A low-pass near the left edge rejects the fixture's mid/high tones.
    const eqStage = await page.locator('.peq-stage').boundingBox();
    await page.locator('.peq-canvas').dblclick({ position: { x: eqStage.width - 15, y: 70 } });
    const cutoff = page.locator('.peq-point');
    await cutoff.focus();
    for (let i = 0; i < 65; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    const filteredRms = await captureRms();
    assert.ok(filteredRms < dryRms * .8, `Recorder captures post-EQ audio: ${filteredRms} < ${dryRms}`);
    await page.locator('#play').click();
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(80);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
      assert.ok(await page.locator('.stem').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), `Stem controls fit their cards at ${width}px`);
      const eq = await page.locator('.peq').boundingBox(), recorder = await page.locator('.record-section').boundingBox();
      assert.ok(recorder.y >= eq.y + eq.height, `EQ and recorder stack at ${width}px`);
      await checkAlignment();
      await page.screenshot({ path: path.join(artifacts, `mobile-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => document.querySelector('#artwork').dispatchEvent(new Event('error')));
    assert.equal(await page.locator('#artwork-fallback').isVisible(), true);
    assert.equal(await page.locator('#artwork').isVisible(), false);
    const localeChecks = [
      ['en-US', 'en', 'Stem Extractor · Player Tools', 'Remove cached model', 'Separation'],
      ['de-DE', 'de', 'Stem-Extraktor · Player Tools', 'Modell aus Cache entfernen', 'Stem-Trennung'],
      ['pt-BR', 'pt-BR', 'Separador de stems · Player Tools', 'Remover modelo do cache', 'Separação'],
      ['ru-RU', 'ru', 'Разделение на стемы · Player Tools', 'Удалить модель из кеша', 'Разделение'],
      ['fr-FR', 'en', 'Stem Extractor · Player Tools', 'Remove cached model', 'Separation'],
    ];
    for (const [browserLocale, documentLocale, localizedTitle, clearCache, separationLabel] of localeChecks) {
      const context = await browser.newContext({ locale: browserLocale, viewport: { width: 320, height: 844 } });
      const localizedPage = await context.newPage();
      const localizedErrors = []; localizedPage.on('pageerror', error => localizedErrors.push(error.message));
      await localizedPage.addInitScript(() => { globalThis.chrome = { runtime: { sendMessage: async () => ({
        success: true, title: 'Fixture', trimRange: { startMs: 0, endMs: 3000 },
      }) } }; });
      await localizedPage.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=locale-fixture`);
      await localizedPage.waitForFunction(() => !document.querySelector('#separate').disabled);
      assert.equal(await localizedPage.locator('html').getAttribute('lang'), documentLocale);
      assert.equal(await localizedPage.title(), localizedTitle);
      assert.equal(await localizedPage.locator('#clear-cache').textContent(), clearCache);
      assert.equal(await localizedPage.locator('.prepare').getAttribute('aria-label'), separationLabel);
      await localizedPage.locator('#toggle-game').evaluate(node => { node.hidden = false; });
      assert.ok(await localizedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${browserLocale} has no horizontal overflow`);
      assert.deepEqual(localizedErrors, []);
      await context.close();
    }
    console.log('Stems UI: spectral colors, five synchronized playheads, play/pause, waveform seek, mute, drum slice assignment/playback, shared zoom/pan, loop gestures, WAV download and responsive layout passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
