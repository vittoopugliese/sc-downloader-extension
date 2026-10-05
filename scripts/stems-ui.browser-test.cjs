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
    res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
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
    assert.equal(await page.locator('canvas').count(), 5);
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
    await page.locator('#original-waveform canvas').click({ position: { x: 450, y: 30 } });
    assert.ok(parseFloat(await page.locator('.waveform-playhead').first().evaluate(node => node.style.left)) > 45);
    await page.locator('.stem button').nth(1).click();
    assert.equal(await page.locator('.stem.is-silent').count(), 3);
    await page.locator('#original').click();
    assert.equal(await page.locator('.stem.is-silent').count(), 4);
    await page.locator('#mix').click();
    const download = page.waitForEvent('download'); await page.locator('.download').first().click();
    assert.match((await download).suggestedFilename(), /_drums.wav$/);
    const artifacts = path.join(root, 'test-results/stems-ui'); fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(80);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
      assert.ok(await page.locator('.stem').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), `Stem controls fit their cards at ${width}px`);
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
    console.log('Stems UI: spectral colors, five synchronized playheads, play/pause, waveform seek, solo, comparison, WAV download and responsive layout passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
