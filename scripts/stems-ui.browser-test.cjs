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
    await page.addInitScript(({ dataUrl }) => {
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Midnight sessions — selected loop', trimRange: { startMs: 12000, endMs: 15000 } }
        : { success: true, instrument: { dataUrl } } } };
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .1,
          outputs: [1, .7, .4, .2].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 30); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=fixture`);
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelectorAll('.stem canvas').length === 4);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.stem canvas');
      return canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[1] > 100;
    });
    assert.equal(await page.locator('.brand img').evaluate(node => node.complete && node.naturalWidth > 0), true);
    assert.equal(await page.locator('canvas').count(), 5);
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
      await page.screenshot({ path: path.join(artifacts, `mobile-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Stems UI: spectral colors, five synchronized playheads, play/pause, waveform seek, solo, comparison, WAV download and responsive layout passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
