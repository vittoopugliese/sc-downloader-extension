// FX window, complete parameter parity, saved separations, live output tap and WAVs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

// The extraction window opens on arrival and blocks the page, like FL Studio's. Close it to
// use the header; reopen it from the Original clip's right-click menu.
async function closeExtract(page) { await page.locator('#extract-dialog[open]').waitFor(); await page.keyboard.press('Escape'); await page.locator('#extract-dialog').waitFor({ state: 'hidden' }); }
async function reopenExtract(page) {
  const title = page.locator('.pl-grid-row:has([data-stem="original"]) .pl-clip-title').first();
  await title.scrollIntoViewIfNeeded(); const box = await title.boundingBox();
  await page.mouse.click(box.x + Math.min(box.width - 10, 240), box.y + 5, { button: 'right' });
  await page.locator('.pl-menu-item', { hasText: /Extract stems|Separar stems/ }).click();
  await page.locator('#extract-dialog[open]').waitFor();
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const { encodeWav } = await import('./stem-audio.mjs');
  const pcm = Float32Array.from({ length: 44100 }, (_, i) => i < 4410 ? .08 * Math.sin(2 * Math.PI * 440 * i / 44100) : 0);
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav([pcm, pcm])).toString('base64')}`;
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: 'en-US', acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ dataUrl }) => {
      globalThis.fxWorklets = [];
      globalThis.AudioWorkletNode = new Proxy(AudioWorkletNode, {
        construct(target, args) { fxWorklets.push(args[1]); return Reflect.construct(target, args); },
      });
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'FX fixture', trimRange: { startMs: 0, endMs: 1000 } }
        : { success: true, instrument: { dataUrl } } } };
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01,
          outputs: [1, 0, 0, 0].map(gain => channels.map(channel => channel.map(v => v * gain))) } }), 20); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    const url = `http://127.0.0.1:${server.address().port}/stems.html?job=fx-fixture`;
    await page.goto(url);
    await page.locator('#separate:not(:disabled)').click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    const fx = page.locator('#stem-fx');
    assert.equal(await fx.isVisible(), false);
    await page.locator('#transport').getByRole('button', { name: 'FXs', exact: true }).click();
    assert.equal(await fx.isVisible(), true);
    const parity = await page.evaluate(() => ({
      expected: Object.keys(SCTempoEffects.DEFAULTS).filter(key => !['preset', 'schemaVersion'].includes(key)).sort(),
      actual: [...document.querySelectorAll('#stem-fx [data-fx-setting]')].map(node => node.dataset.fxSetting).sort(),
    }));
    assert.deepEqual(parity.actual, parity.expected, 'Every Player Tools FX setting is exposed');
    await fx.getByRole('button', { name: 'Dock under the Playlist' }).click();
    const setting = key => fx.locator(`[data-fx-setting="${key}"]`);
    const value = key => setting(key).getAttribute('aria-valuenow');
    await fx.locator('[data-fx-preset=studio]').click();
    assert.equal(await value('reverb'), '35');
    await fx.locator('[data-effect-bypass=reverb]').click();
    assert.equal(await value('reverb'), '0');
    await fx.locator('[data-effect-bypass=reverb]').click();
    assert.equal(await value('reverb'), '35', 'Switch remembers wet level');
    await fx.getByRole('button', { name: 'Reset FXs', exact: true }).click();
    // Keyboard editing covers every parameter, including room selection.
    for (const key of parity.expected.filter(key => key !== 'reverbRoom')) {
      await setting(key).focus(); await page.keyboard.press('ArrowUp');
      assert.notEqual(Number(await value(key)), await page.evaluate(key => SCTempoEffects.DEFAULTS[key], key), key);
    }
    await setting('reverbRoom').selectOption('plate');
    await page.waitForFunction(() => fxWorklets.includes('scdl-bitcrusher'));
    // Presets and all character values survive the saved separation path.
    await page.locator('#save-project').click(); await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').evaluate(node => node.value);
    const savedValues = await fx.locator('[data-fx-setting]').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.fxSetting, n.value || n.getAttribute('aria-valuenow')])));
    await page.reload();
    await closeExtract(page);
    await page.locator('#stem-presets:not(:disabled)').waitFor();
    await page.locator('#stem-presets').click();
    await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    const restored = await fx.locator('[data-fx-setting]').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.fxSetting, n.value || n.getAttribute('aria-valuenow')])));
    assert.deepEqual(restored, savedValues);
    await fx.getByRole('button', { name: 'Reset FXs', exact: true }).click();
    await setting('delay').focus(); await page.keyboard.press('End');
    // Echo Freeze pauses and resumes the transport, and releasing/closing cannot stick it.
    await page.locator('#play').click();
    await page.waitForTimeout(80);
    const freeze = fx.locator('.fx-freeze');
    await freeze.focus(); await page.keyboard.down('Enter');
    assert.equal(await freeze.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    await page.keyboard.up('Enter');
    await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true');
    await page.locator('#play').click();
    async function exported() {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#transport').getByLabel('Export WAV').click()]);
      return page.evaluate(async bytes => {
        const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(new Uint8Array(bytes).buffer);
        const data = buffer.getChannelData(0);
        const rms = (a, b) => Math.sqrt(data.slice(a, b).reduce((sum, v) => sum + v * v, 0) / (b - a));
        return { duration: buffer.duration, echo: rms(12000, 15000), dry: rms(1000, 3000) };
      }, [...fs.readFileSync(await download.path())]);
    }
    const wet = await exported();
    assert.ok(wet.echo > .01 && wet.duration > 1, `WAV includes echo and tail: ${JSON.stringify(wet)}`);
    await fx.getByRole('button', { name: 'Bypass FXs', exact: true }).click();
    const dry = await exported();
    assert.ok(dry.echo < .00001 && Math.abs(dry.duration - 1) < .001, 'Bypass removes FX from the WAV');
    // Test the owned live graph with deterministic offline timing and a post-EQ
    // output observer, the same tap the recorder consumes. No media element needed.
    const audio = await page.evaluate(async () => {
      const { createEqualizedOutput } = await import('./scripts/local-audio-output.mjs');
      async function render(bypass) {
        const context = new OfflineAudioContext(2, 44100, 44100);
        const output = createEqualizedOutput({ audioContext: () => context });
        output.effects.set('delay', 100); output.effects.setBypassed(bypass);
        const tap = context.createAnalyser(); let observed = false;
        const unobserve = output.observeOutput((ctx, node) => { observed = ctx === context; node.connect(tap); });
        const source = context.createBufferSource(); source.buffer = context.createBuffer(2, 4410, 44100);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 4410; i++) source.buffer.getChannelData(c)[i] = .08 * Math.sin(2 * Math.PI * 440 * i / 44100);
        source.connect(output.input()); source.start(.05);
        const buffer = await context.startRendering(), data = buffer.getChannelData(0);
        const rms = (a, b) => Math.sqrt(data.slice(a, b).reduce((sum, v) => sum + v * v, 0) / (b - a));
        unobserve(); output.dispose();
        return { echo: rms(15000, 17000), dry: rms(3000, 5000), observed };
      }
      return { wet: await render(false), dry: await render(true) };
    });
    assert.ok(audio.wet.observed && audio.dry.observed);
    assert.ok(audio.wet.echo > .01 && audio.dry.echo < .00001, 'Local FX reach the master output and bypass cleanly');
    assert.ok(Math.abs(audio.dry.dry - .08 / Math.sqrt(2)) < .001, 'Dry bypass has unity gain, without a duplicated route');
    // Layout and window lifecycle, including small viewport scrolling.
    await fx.getByRole('button', { name: 'Detach: float this window' }).click();
    await fx.getByRole('button', { name: 'Maximize', exact: true }).click();
    assert.ok((await fx.boundingBox()).width > 1240);
    await fx.getByRole('button', { name: 'Restore size' }).click();
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await fx.screenshot({ path: path.join(artifacts, 'stem-fx.png') });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 780 });
      assert.equal(await fx.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      assert.equal(await fx.locator('.stem-plugin-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await setting('bitDepth').scrollIntoViewIfNeeded();
      assert.ok(await setting('bitDepth').isVisible());
    }
    await page.screenshot({ path: path.join(artifacts, 'stem-fx-mobile.png') });
    await page.keyboard.press('F4'); assert.equal(await fx.isVisible(), false);
    await page.keyboard.press('F4'); assert.equal(await fx.isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Stem FX test passed.', { wet, dry, audio });
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
