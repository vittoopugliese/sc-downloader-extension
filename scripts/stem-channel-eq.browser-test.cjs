// Per-channel EQ in real Chromium with a fixture separation: the EQ window edits the
// master or one channel, a channel's EQ leaves the master untouched, and the WAV export
// applies the channel insert.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { encodeWav } = await import('./stem-audio.mjs');
  // 70 Hz, then 1 kHz, then 9 kHz: one second each.
  const channels = [0, 1].map(() => Float32Array.from({ length: 44100 * 3 }, (_, i) => {
    const t = i / 44100, frequency = [70, 1000, 9000][Math.floor(t)];
    return Math.sin(2 * Math.PI * frequency * t) * .3;
  }));
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav(channels)).toString('base64')}`;
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: 'en-US', acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ dataUrl }) => {
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Fixture loop', trimRange: { startMs: 0, endMs: 3000 } }
        : { success: true, instrument: { dataUrl } } } };
      // Drums carry the mix; the original channel starts muted beside the stems.
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .1,
          outputs: [.8, .05, .05, .05].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 30); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=fixture`);
    await page.locator('#separate:not(:disabled)').click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    // Treble against bass of the exported mix: the 9 kHz second over the 70 Hz second.
    async function trebleRatio() {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#transport').getByLabel('Download WAV').click()]);
      const bytes = [...fs.readFileSync(await download.path())];
      return page.evaluate(async bytes => {
        const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(new Uint8Array(bytes).buffer);
        const data = buffer.getChannelData(0), rms = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += data[i] ** 2; return Math.sqrt(sum / (to - from)); };
        return rms(97020, 123480) / rms(8820, 35280);
      }, bytes);
    }
    const flat = await trebleRatio();
    assert.ok(flat > .7, `Flat mix keeps the treble: ${flat}`);
    // The track menu opens the EQ on that channel.
    await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click();
    await page.getByRole('menuitem', { name: 'Channel EQ' }).click();
    const eq = page.locator('#scdl-parametric-eq'), target = eq.getByLabel('EQ channel');
    assert.equal(await eq.isVisible(), true);
    assert.equal(await target.inputValue(), 'drums');
    assert.match(await eq.locator('.tool-section-title').textContent(), /Parametric EQ · /);
    assert.deepEqual(await target.locator('option').allTextContents().then(list => list.length), 7, 'Master, five stems and the empty user track');
    // A low-pass on the drums channel only.
    const stage = await eq.locator('.peq-stage').boundingBox();
    await eq.locator('.peq-canvas').dblclick({ position: { x: stage.width - 15, y: 70 } });
    await eq.locator('.peq-point').focus();
    for (let i = 0; i < 65; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    assert.equal(await eq.locator('.peq-point').count(), 1);
    // The master is a separate EQ.
    await target.selectOption('master');
    assert.equal(await eq.locator('.peq-point').count(), 0, 'The master EQ is untouched');
    assert.match(await eq.locator('.tool-section-title').textContent(), /Master$/);
    await target.selectOption('drums');
    assert.equal(await eq.locator('.peq-point').count(), 1, 'The channel keeps its band');
    // The export applies the channel insert.
    const filtered = await trebleRatio();
    assert.ok(filtered < flat * .5, `The channel low-pass reaches the WAV: ${filtered} < ${flat}`);
    // Playback through the channel inserts runs without errors.
    await page.locator('#play').click(); await page.waitForTimeout(400); await page.locator('#play').click();
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await eq.screenshot({ path: path.join(artifacts, 'channel-eq.png') });
    assert.deepEqual(errors, []);
    console.log('Channel EQ test passed.', { flat, filtered });
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
