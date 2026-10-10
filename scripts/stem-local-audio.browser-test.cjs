// Real file input, decoding/resampling, trimming, playback and persistence.
// Only separation inference is replaced with deterministic stems.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-results/stem-local-audio');
  fs.mkdirSync(artifacts, { recursive: true });
  // Mono 48 kHz: proves browser decoding, stereo conversion and 44.1 kHz resampling.
  const samples = 48000 * 125, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * (i < 48000 * 122 ? 3000 : 9000)), 44 + i * 2);
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ locale: 'es-AR', viewport: { width: 1200, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.inferences = 0;
      window.Worker = class {
        postMessage({ channels }) {
          inferences++;
          window.inputSummary = { length: channels[0].length, stereo: channels.length,
            identical: channels[0].every((v, i) => v === channels[1][i]), peak: channels[0].reduce((p, v) => Math.max(p, Math.abs(v)), 0) };
          this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01,
            outputs: [1, 2, 3, 4].map(() => channels.map(c => c.map(v => v / 4))) } }), 100);
        }
        terminate() { clearTimeout(this.timer); }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await page.locator('#separate').isDisabled(), true);
    const upload = () => page.locator('#audio-file').setInputFiles({ name: 'My recording.wav', mimeType: 'audio/wav', buffer: wav });
    await upload(); await page.locator('#import-dialog').waitFor();
    assert.equal(await page.locator('#import-end').inputValue(), '120');
    await page.locator('#import-end').fill('124'); await page.locator('#import-confirm').click();
    assert.match(await page.locator('#import-error').textContent(), /2 minutos/);
    await page.locator('#import-start').fill('122');
    await page.locator('#import-end').fill(await page.locator('#import-end').getAttribute('max'));
    await page.locator('#import-name').fill('Mi grabación');
    await page.screenshot({ path: path.join(artifacts, 'import-desktop.png') });
    await page.locator('#import-confirm').click();
    await page.locator('#import-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#track').textContent(), 'Mi grabación');
    assert.match(await page.locator('#track').getAttribute('data-meta'), /My recording.wav.*1 ch.*2:05/);
    assert.match(await page.locator('#track').getAttribute('data-range'), /122,00.*125,00.*3,00/);
    await page.locator('#save-locally').click(); await page.locator('#save-confirm').click();
    await page.locator('#separate:not(:disabled)').waitFor(); await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').inputValue();
    const summary = await page.evaluate(() => inputSummary);
    assert.ok(Math.abs(summary.length - 44100 * 3) <= 1); assert.equal(summary.stereo, 2); assert.equal(summary.identical, true);
    assert.ok(summary.peak > .26 && summary.peak < .3, 'Selected the loud ending, not the first 120 seconds');
    await page.locator('#stem-rate').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, '0.5');
    await page.locator('#stem-keep-tone').check();
    await page.waitForFunction(async id => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      return (await (await StemPresets.current()).load(id)).record.settings.keepTone;
    }, id);
    await upload(); await page.locator('#import-dialog').waitFor(); await page.keyboard.press('Escape');
    await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await page.locator('#stem-presets').inputValue(), id);
    assert.equal(await page.locator('.stem').count(), 4);
    await page.locator('#audio-file').setInputFiles({ name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('broken') });
    await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.equal(await page.locator('#stem-presets').inputValue(), id);
    assert.equal(await page.locator('.stem').count(), 4);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#stem-presets').options.length === 2);
    await page.locator('#stem-presets').selectOption(id); await page.locator('.stem').first().waitFor();
    assert.equal(await page.evaluate(() => inferences), 0);
    assert.equal(await page.locator('#stem-rate').inputValue(), '0.5');
    assert.equal(await page.locator('#stem-keep-tone').isChecked(), true);
    await page.locator('#play').click(); await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label').includes('Pausar'));
    await page.locator('#play').click();
    for (const width of [1200, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(artifacts, `player-${width}.png`), fullPage: true });
    }
    await upload(); await page.locator('#import-dialog').waitFor();
    await page.screenshot({ path: path.join(artifacts, 'import-mobile.png') });
    await page.locator('#import-confirm').click(); await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await page.locator('#save-locally').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#stem-rate').inputValue(), '1');
    assert.equal(await page.locator('.stem').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS local audio: decode, mono/resampling, trim, invalid file, cancel, preset reload, speed, playback and responsive UI');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
