// Real audio/DOM coverage for the passive header spectrum and its render lifecycle.
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
      window.monitorPaints = 0;
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.canvas.parentElement?.id === 'output-monitor' && args[0] === 0 && args[1] === 0) window.monitorPaints++;
        return fill.apply(this, args);
      };
    });
    const url = `http://127.0.0.1:${server.address().port}/stems.html`;
    await page.goto(url);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    const monitor = page.locator('#output-monitor');
    assert.equal(await monitor.getAttribute('role'), 'img');
    assert.equal(await monitor.getAttribute('aria-label'), 'Espectro de frecuencias de salida');
    assert.equal(await monitor.evaluate(element => element.tabIndex), -1);
    assert.equal(await monitor.evaluate(element => getComputedStyle(element).cursor), 'auto');
    assert.equal(await monitor.locator(':scope > *').count(), 1);
    const box = await monitor.boundingBox(), slot = await page.locator('.output-monitor-slot').boundingBox();
    const row = await page.locator('.workspace-toolbar').boundingBox();
    assert.ok(Math.abs(box.width - slot.width * .3125) < 1, 'The spectrum is 25% wider than the previous version');
    assert.ok(Math.abs(box.y - row.y - 6) < 1 && Math.abs(row.y + row.height - box.y - box.height - 5) < 1, 'The spectrum has 5px of vertical space inside the row border');
    const rowHeights = await monitor.evaluate(element => {
      const row = element.closest('.workspace-toolbar'), spaced = row.getBoundingClientRect().height;
      element.style.marginBlock = '-5px';
      const flush = row.getBoundingClientRect().height;
      element.style.removeProperty('margin-block');
      return { spaced, flush };
    });
    assert.equal(rowHeights.spaced, rowHeights.flush, 'The vertical gap does not increase the row height');
    assert.ok(Math.abs(box.x + box.width - row.x - row.width) < 1, 'The spectrum is flush with the right edge');
    const markup = await monitor.evaluate(element => element.outerHTML);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    await monitor.click(); await monitor.dblclick();
    assert.equal(await monitor.evaluate(element => element.outerHTML), markup, 'Clicks do not change the passive spectrum');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storage, 'Clicks write no preferences');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    await page.reload(); await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await monitor.getAttribute('aria-label'), 'Espectro de frecuencias de salida');

    const { encodeWav } = await import('./stem-audio.mjs');
    const rate = 44100, duration = 12;
    const pcm = Float32Array.from({ length: rate * duration }, (_, i) =>
      .12 * (Math.sin(i * 2 * Math.PI * 110 / rate) + Math.sin(i * 2 * Math.PI * 160 / rate) + Math.sin(i * 2 * Math.PI * 1700 / rate)));
    await page.locator('#transport input[type=file]').setInputFiles({ name: 'Spectrum tones.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([pcm, pcm])) });
    await page.locator('.pl-clip').waitFor();
    await page.locator('#play').click();
    await page.waitForTimeout(800);
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
    const mobileRow = await page.locator('.workspace-toolbar').boundingBox();
    assert.ok(mobileBox.height >= 32);
    assert.ok(Math.abs(mobileBox.width - mobileSlot.width * .3125) < 1);
    assert.ok(Math.abs(mobileBox.x + mobileBox.width - mobileRow.x - mobileRow.width) < 1);
    assert.ok(Math.abs(mobileBox.y - mobileSlot.y) < 1);
    assert.ok(Math.abs(mobileRow.y + mobileRow.height - mobileBox.y - mobileBox.height - 5) < 1);
    assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390, 'Compact spectrum fits on mobile');
    await monitor.click(); assert.deepEqual(await monitor.boundingBox(), mobileBox);
    await page.locator('.workspace-header').screenshot({ path: path.join(root, 'test-results/output-monitor-mobile.png') });
    const retina = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 1440, height: 1000 } });
    await retina.goto(url); await retina.locator('#import-audio:not(:disabled)').waitFor();
    const retinaScale = await retina.locator('#output-monitor canvas').evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
    assert.ok(retinaScale >= 3, 'The backing store preserves full density on 3x displays');
    await retina.close();
    assert.deepEqual(errors, []);
    console.log(`Output spectrum checks passed. Tones: ${JSON.stringify(pixels)}; cadence: ${JSON.stringify(cadence)}; audition: ${JSON.stringify(audition)}.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
