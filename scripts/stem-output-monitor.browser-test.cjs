// Real audio/DOM coverage for header mode switching, stereo taps and idle rendering.
const assert = require('node:assert/strict');
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
      window.monitorPaints = 0; window.monitorPaintTimes = [];
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.canvas.classList.contains('output-monitor-canvas') && args[0] === 0 && args[1] === 0 && args[2] > 200) {
          window.monitorPaints++; window.monitorPaintTimes.push(performance.now());
        }
        return fill.apply(this, args);
      };
    });
    const url = `http://127.0.0.1:${server.address().port}/stems.html`;
    await page.goto(url);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    const monitor = page.locator('#output-monitor');
    assert.equal(await monitor.getAttribute('data-mode'), 'combined');
    assert.match(await monitor.getAttribute('aria-label'), /Clic para cambiar/);
    const box = await monitor.boundingBox();
    for (const mode of ['stems', 'spectrum', 'waveform', 'combined']) {
      await monitor.click();
      assert.equal(await monitor.getAttribute('data-mode'), mode);
      assert.deepEqual(await monitor.boundingBox(), box, 'Every mode occupies the same header area');
    }
    await monitor.focus(); await page.keyboard.press('Space');
    assert.equal(await monitor.getAttribute('data-mode'), 'stems');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Enter');
    await page.reload(); await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await monitor.getAttribute('data-mode'), 'spectrum', 'View persists');
    await monitor.click(); await monitor.click();

    const { encodeWav } = await import('./stem-audio.mjs');
    const rate = 44100, duration = 3;
    const pcm = Float32Array.from({ length: rate * duration }, (_, i) =>
      (.23 * Math.sin(i * 2 * Math.PI * 110 / rate) + .12 * Math.sin(i * 2 * Math.PI * 1700 / rate)) * (.65 + .35 * Math.sin(i / 2200)));
    const quiet = pcm.map(value => value * .12);
    await page.locator('#transport input[type=file]').setInputFiles({ name: 'Monitor stereo.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([pcm, quiet])) });
    await page.locator('.pl-clip').waitFor();
    await page.locator('#play').click();
    await page.waitForTimeout(800);
    const pixels = await monitor.locator('canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d'), dpr = canvas.width / canvas.clientWidth;
      const width = canvas.clientWidth, height = canvas.clientHeight, half = Math.floor((width - 5) / 2);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const bright = (x, y) => data[(Math.floor(y * dpr) * canvas.width + Math.floor(x * dpr)) * 4] > 150;
      let spectrum = 0, wave = 0;
      for (let x = 4; x < half - 4; x++) for (let y = 4; y < height - 4; y++) if (bright(x, y)) spectrum++;
      for (let x = half + 9; x < width - 110; x++) for (let y = 4; y < height - 4; y++) if (bright(x, y)) wave++;
      let l = 0, r = 0;
      for (let x = width - 95; x < width - 4; x++) { if (bright(x, 8)) l++; if (bright(x, 25)) r++; }
      return { spectrum, wave, l, r };
    });
    assert.ok(pixels.spectrum > 20 && pixels.wave > 20, JSON.stringify(pixels));
    assert.ok(pixels.l > pixels.r + 10, `Stereo channels have independent levels: ${JSON.stringify(pixels)}`);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await monitor.screenshot({ path: path.join(root, 'test-results/output-monitor-combined.png') });
    await page.evaluate(() => { window.monitorPaints = 0; window.monitorPaintTimes = []; });
    await page.waitForTimeout(1000);
    const paints = await page.evaluate(() => window.monitorPaints);
    assert.ok(paints > 5 && paints <= 62, `At most two background fills per 30 FPS frame: ${paints}`);
    for (const mode of ['stems', 'spectrum', 'waveform']) {
      await monitor.click(); await page.waitForTimeout(180);
      assert.equal(await monitor.getAttribute('data-mode'), mode);
      await monitor.screenshot({ path: path.join(root, `test-results/output-monitor-${mode}.png`) });
    }
    await page.locator('#header-pin').click();
    await page.evaluate(() => { document.body.style.paddingBottom = '2000px'; window.scrollTo(0, 1500); });
    await page.waitForTimeout(200);
    const hiddenPaints = await page.evaluate(() => window.monitorPaints);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.monitorPaints), hiddenPaints, 'No drawing outside viewport');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(180);
    assert.ok(await page.evaluate(() => window.monitorPaints) > hiddenPaints);
    await page.locator('#play').click();
    await page.waitForTimeout(2200);
    const idlePaints = await page.evaluate(() => window.monitorPaints);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.monitorPaints), idlePaints, 'No animation loop after audio becomes idle');
    // A separate mono source must reach both stereo meters, just as it reaches both speakers.
    await page.evaluate(async () => {
      const { mountOutputMonitor } = await import('./scripts/stem-output-monitor.mjs');
      const { createEqualizedOutput } = await import('./scripts/local-audio-output.mjs');
      const element = document.querySelector('#output-monitor').cloneNode(true);
      element.id = 'mono-monitor'; element.style.cssText = 'width:600px;height:40px'; document.body.prepend(element);
      let created = 0;
      const output = createEqualizedOutput({ audioContext: () => { created++; return new AudioContext(); } });
      const view = mountOutputMonitor({ element, output, trackLevel: () => 0 });
      window.monoWasLazy = created === 0;
      const context = output.getPlaybackContext(); await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain(); gain.gain.value = .2;
      oscillator.connect(gain).connect(output.input()); oscillator.start(); view.setActive(true);
      window.monoCleanup = () => { view.dispose(); oscillator.stop(); output.dispose(); context.close(); element.remove(); };
    });
    assert.equal(await page.evaluate(() => window.monoWasLazy), true, 'Mounting the monitor does not initialize audio');
    await page.waitForTimeout(200);
    const monoLevels = await page.locator('#mono-monitor canvas').evaluate(canvas => {
      const context = canvas.getContext('2d'); let l = 0, r = 0;
      const dpr = canvas.width / canvas.clientWidth;
      for (let x = 505; x < 596; x++) {
        if (context.getImageData(x * dpr, 8 * dpr, 1, 1).data[0] > 150) l++;
        if (context.getImageData(x * dpr, 25 * dpr, 1, 1).data[0] > 150) r++;
      }
      return { l, r };
    });
    assert.ok(monoLevels.l > 20 && Math.abs(monoLevels.l - monoLevels.r) <= 1, JSON.stringify(monoLevels));
    await page.evaluate(() => window.monoCleanup());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileBox = await monitor.boundingBox();
    for (let i = 0; i < 4; i++) {
      await monitor.click(); assert.deepEqual(await monitor.boundingBox(), mobileBox);
      if (await monitor.getAttribute('data-mode') === 'stems') {
        assert.ok(await monitor.evaluate(element => {
          const box = element.getBoundingClientRect();
          return [...element.querySelectorAll('.preview-track')].every(row => row.getBoundingClientRect().bottom <= box.bottom);
        }), 'Both rows of stems fit the compact header');
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Output monitor browser checks passed. Stereo pixels: ${JSON.stringify(pixels)}; background fills/sec: ${paints}.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
