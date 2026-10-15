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
    assert.equal(await page.locator('#clear-cache').textContent(), 'Eliminar modelo');
    assert.equal(await page.locator('#track').getAttribute('data-meta'), 'Fixture artist · 3:05');
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
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    const playlist = page.locator('#playlist'), drumHead = page.locator('.pl-stem-head[data-stem=drums]');
    const stemEnables = page.locator('.pl-stem-head:not([data-stem=original]) .stem-enable');
    const artifacts = path.join(root, 'test-results/stems-ui'); fs.mkdirSync(artifacts, { recursive: true });
    assert.equal(await page.locator('.pl-stem-head').count(), 5);
    assert.equal(await playlist.locator('canvas').count(), 1, 'One shared waveform canvas');
    assert.equal(await page.locator('.pl-clip canvas').count(), 0, 'No duplicate waveform per track');
    assert.equal(await page.locator('#original-waveform').isVisible(), false);
    // Channel rack waveform, EQ and recorder.
    assert.equal(await page.locator('#mix-tools canvas').count(), 3);
    const checkAlignment = async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Workspace fits viewport');
      const view = await playlist.locator('.pl-scroll').boundingBox();
      const headers = await page.locator('.pl-stem-head').all();
      for (const head of headers) { const box = await head.boundingBox(); assert.ok(Math.abs(box.x - view.x - 1) < 2); }
      const canvas = await playlist.locator('canvas').boundingBox();
      assert.ok(canvas.width <= view.width && canvas.height <= await page.evaluate(() => innerHeight), 'Canvas is bounded to the viewport');
    };
    await checkAlignment();
    const knob = drumHead.locator('.pad-knob');
    await knob.press('Home'); assert.equal(await knob.getAttribute('aria-valuenow'), '0');
    await knob.press('ArrowUp'); assert.equal(await knob.getAttribute('aria-valuenow'), '1');
    await knob.dblclick(); assert.equal(await knob.getAttribute('aria-valuenow'), '100');
    const ruler = playlist.locator('.pl-ruler');
    const selectLoop = async (start, end) => {
      const bounds = await ruler.boundingBox();
      const scale = (await playlist.locator('.pl-clip').first().boundingBox()).width / 3;
      await page.keyboard.down('Alt');
      await page.mouse.move(bounds.x + start * scale, bounds.y + 14); await page.mouse.down();
      await page.mouse.move(bounds.x + end * scale, bounds.y + 14, { steps: 5 }); await page.mouse.up();
      await page.keyboard.up('Alt');
    };
    await selectLoop(0, 3);
    await page.locator('#play').click(); await page.waitForTimeout(250);
    assert.equal(await playlist.locator('.pl-play').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(3100); assert.match(await page.locator('#play').getAttribute('aria-label'), /Pausar/);
    await page.locator('#play').press('Space'); assert.equal(await playlist.locator('.pl-play').getAttribute('aria-pressed'), 'false');
    await stemEnables.first().click(); assert.equal(await stemEnables.first().getAttribute('aria-checked'), 'false');
    await stemEnables.first().click({ button: 'right' });
    assert.deepEqual(await stemEnables.evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-checked'))), ['true', 'false', 'false', 'false']);
    await page.locator('#original').click(); assert.equal(await page.locator('.pl-stem-head[data-stem=original]').evaluate(n => n.classList.contains('is-silent')), false);
    await page.locator('#mix').click();
    // A-B is created and cleared directly on the playlist ruler.
    await ruler.dblclick({ position: { x: 10, y: 14 } });
    await selectLoop(.75, 1.8);
    assert.equal(await playlist.locator('.pl-loop-band').isVisible(), true);
    await page.locator('#play').click(); await page.waitForTimeout(1400);
    const at = Number((await playlist.locator('.pl-time').textContent()).split(':')[1]);
    assert.ok(at >= .75 && at < 1.8, 'Transport wraps within A-B');
    await page.locator('#play').click(); await ruler.dblclick({ position: { x: 10, y: 14 } });
    // Header identity survives mix edits, keeping focused knobs and drags attached.
    await drumHead.evaluate(n => { window.savedHead = n; });
    await knob.press('ArrowDown');
    assert.ok(await page.evaluate(() => savedHead === document.querySelector('.pl-stem-head[data-stem=drums]')));
    await knob.dblclick();
    await drumHead.locator('.stem-rack-focus').click();
    assert.equal(await page.locator('#stem-rack .plugin-track').inputValue(), 'drums', 'The header button focuses its track in the rack');
    const downloadEvent = page.waitForEvent('download'); await drumHead.locator('.download').click();
    assert.match((await downloadEvent).suggestedFilename(), /drums\.wav$/);
    // One frame: opening the rack scrolls smoothly, so separate reads could straddle a scroll.
    const [eqBounds, recorderBounds, playlistBounds] = await page.evaluate(() => ['.peq', '.record-section', '#playlist']
      .map(selector => { const { y, height, width } = document.querySelector(selector).getBoundingClientRect(); return { y, height, width }; }));
    assert.ok(eqBounds.y >= playlistBounds.y + playlistBounds.height, 'EQ and recorder are below playlist');
    assert.equal(eqBounds.y, recorderBounds.y, 'EQ and recorder sit side by side');
    assert.ok(Math.abs(eqBounds.width - recorderBounds.width) < 1, 'Both cards have equal width');
    // Record the audible mix through the real worklet and inspect downloaded PCM.
    // Isolate the quiet vocal stem to avoid clipping, then compare all-OFF and EQ.
    await stemEnables.last().click({ button: 'right' });
    await page.locator('#stem-rate').dblclick();
    if (await page.locator('#play').getAttribute('aria-label').then(value => value.includes('Pausar'))) await page.locator('#play').click();
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
    await stemEnables.last().click();
    await page.waitForTimeout(200);
    const mutedRms = await captureRms();
    assert.ok(mutedRms < .0001, `Disabled stems are silent in the WAV: ${mutedRms}`);
    await stemEnables.last().click();
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
      ['en-US', 'en', 'Stem Extractor · Player Tools', 'Remove model', 'Separation'],
      ['de-DE', 'de', 'Stem-Extraktor · Player Tools', 'Modell entfernen', 'Stem-Trennung'],
      ['pt-BR', 'pt-BR', 'Separador de stems · Player Tools', 'Remover modelo', 'Separação'],
      ['ru-RU', 'ru', 'Разделение на стемы · Player Tools', 'Удалить модель', 'Разделение'],
      ['fr-FR', 'en', 'Stem Extractor · Player Tools', 'Remove model', 'Separation'],
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
    console.log('Stems UI: spectral colors, five synchronized playheads, play/pause, waveform seek, mute, channel focus, shared zoom/pan, loop gestures, WAV download and responsive layout passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
