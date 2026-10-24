// Integrated channel operations, envelope editing and save/reopen through the real workspace.
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
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/stems.html`);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    await page.evaluate(async () => {
      const { mountPlaylist } = await import('./scripts/stem-playlist.mjs');
      const main = document.createElement('main'), container = document.createElement('div');
      for (const child of document.body.children) child.hidden = true;
      main.append(container); document.body.append(main); container.id = 'upgrade-fixture';
      window.editor = mountPlaylist({ container });
      window.source = new AudioBuffer({ numberOfChannels: 2, length: 88200, sampleRate: 44100 });
      source.getChannelData(0).fill(.1); source.getChannelData(1).fill(.05);
      window.sources = [{ id: 'audio-original', stem: 'original', name: 'Original', buffer: source }];
      editor.setSession({ sources });
    });
    const ui = page.locator('#upgrade-fixture');
    const state = () => page.evaluate(() => editor.snapshot());
    const undo = async () => { await ui.locator('.pl-scroll').focus(); await page.keyboard.press('Control+z'); };
    const action = value => page.locator('#channel-action-dialog[open] [data-action=' + value + ']').click();
    await ui.locator('.pl-clip').click();
    await ui.locator('.pl-clip-settings').click(); await ui.locator('.pl-normalize').click();
    const normalized = (await state()).clips[0].normalizationGain;
    assert.ok(Math.abs(normalized - 8.9125) < .001);
    await undo(); assert.equal((await state()).clips[0].normalizationGain, undefined);
    await page.evaluate(() => editor.createAutomation({ track: 'track-original', param: 'gain' }));
    const automation = ui.locator('.pl-automation-clip');
    assert.equal(Math.round((await automation.boundingBox()).height), 65, 'Automation has a bounded clip body');
    const envelopeBox = await automation.locator('svg').boundingBox();
    assert.ok(envelopeBox.height >= 40 && envelopeBox.height <= 46, 'Points use the visible envelope height');
    await automation.locator('svg').dblclick({ position: { x: envelopeBox.width / 2, y: 15 } });
    assert.equal((await state()).automation[0].points.length, 3, 'Integrated pointer adds a point');
    await undo();
    await automation.locator('[data-point="0"]').focus(); await page.keyboard.press('Home');
    await automation.locator('[data-point="1"]').focus(); await page.keyboard.press('End');
    const curve = (await state()).automation[0];
    assert.deepEqual(curve.points.map(point => point.value), [0, 2]);
    await automation.focus(); await page.keyboard.press('Control+d');
    assert.equal((await state()).automation.length, 2);
    await page.keyboard.press('Delete'); assert.equal((await state()).automation.length, 1);
    await undo(); assert.equal((await state()).automation.length, 2);
    await undo(); assert.equal((await state()).automation.length, 1);
    await page.evaluate(() => { window.consolidating = editor.consolidateTrack('original'); });
    await action('cancel'); assert.equal((await state()).samples.length, 0);
    await page.evaluate(() => { window.consolidating = editor.consolidateTrack('original'); });
    await action('keep'); await page.evaluate(() => consolidating);
    let saved = await state();
    assert.equal(saved.samples.length, 1);
    assert.equal(await page.evaluate(() => editor.track('original').mute), true);
    const samples = await page.evaluate(() => {
      const b = editor.samples()[0].buffer;
      return [b.getChannelData(0)[22050], b.getChannelData(0)[66150], b.getChannelData(1)[66150]];
    });
    for (const [i, expected] of [.05, .15, .075].entries()) assert.ok(Math.abs(samples[i] - expected) < .001, `Consolidation bakes automation and stereo balance: ${samples}`);
    assert.equal(saved.userTracks.find(track => track.source)?.gain, 1);
    await undo(); assert.equal((await state()).samples.length, 0);
    assert.equal(await page.evaluate(() => editor.track('original').mute), false);
    await page.evaluate(() => { window.consolidating = editor.consolidateTrack('original'); });
    await action('replace'); await page.evaluate(() => consolidating);
    saved = await state();
    assert.ok(saved.deletedSources.includes('audio-original'));
    assert.equal(saved.automation.length, 0, 'Baked automation is removed with the old channel');
    assert.equal(await ui.locator('.pl-shelf [data-asset="audio-original"]').count(), 0);
    await undo(); assert.equal((await state()).automation.length, 1);
    assert.equal(await ui.locator('.pl-shelf [data-asset="audio-original"]').count(), 1);
    // Persisted metadata recreates editable envelopes, including point values.
    await page.evaluate(() => { const saved = editor.snapshot(); editor.setSession({ sources, saved }); });
    assert.deepEqual((await state()).automation[0].points, curve.points);
    await page.evaluate(async () => { const { dismissToast } = await import('./scripts/ui-toast.mjs'); for (const node of document.querySelectorAll('.ui-toast-content button')) node.click(); dismissToast('task'); });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No document overflow at ${width}`);
      fs.mkdirSync(path.join(root, 'test-results', 'stem-editor-upgrade'), { recursive: true });
      await ui.screenshot({ path: path.join(root, 'test-results', 'stem-editor-upgrade', `${width}.png`) });
    }
    await page.evaluate(() => editor.dispose());

    // Real workspace project lifecycle: original deletion, save, reopen, then delete every stem.
    const { encodeWav } = await import('./stem-audio.mjs');
    const pcm = new Float32Array(44100).fill(.05);
    const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav([pcm, pcm])).toString('base64')}`;
    await page.addInitScript(({ dataUrl }) => {
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Upgrade fixture', trimRange: { startMs: 0, endMs: 1000 } }
        : { success: true, instrument: { dataUrl } } } };
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01,
          outputs: [1, .5, .25, .1].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 20); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/stems.html?job=upgrade`);
    await page.locator('#separate:not(:disabled)').click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    const deleteChannel = async stem => {
      await page.locator(`.pl-stem-head[data-stem=${stem}] .stem-more`).click();
      await page.getByRole('menuitem', { name: 'Delete channel…', exact: true }).click();
      await action('delete');
      await page.locator(`.pl-stem-head[data-stem=${stem}]`).waitFor({ state: 'detached' });
    };
    await deleteChannel('original');
    await page.locator('#save-project').click(); await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').evaluate(node => node.value);
    const reopen = async () => {
      await page.goto(`${origin}/stems.html`);
      await page.locator('#stem-presets:not(:disabled)').click();
      await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
      await page.waitForFunction(id => document.querySelector('#stem-presets').value === id && !document.querySelector('#stem-presets').disabled && !document.querySelector('#save-project').disabled, id);
    };
    await reopen();
    assert.equal(await page.locator('.pl-stem-head[data-stem=original]').count(), 0);
    assert.equal(await page.locator('.pl-stem-head').count(), 4);
    for (const stem of ['drums', 'bass', 'other', 'vocals']) await deleteChannel(stem);
    await page.locator('#save-project').click();
    await page.waitForFunction(() => !document.querySelector('#save-project').classList.contains('has-changes') && !document.querySelector('#save-project').disabled);
    await reopen();
    assert.equal(await page.locator('.pl-stem-head').count(), 0);
    assert.equal(await page.locator('.pl-shelf [data-asset^="audio-"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Editor upgrade: normalization, integrated automation, consolidation keep/replace/cancel/undo, stereo render, responsive layout and destructive stem save/reopen passed.');
  } finally { await browser?.close(); server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
