// Real shelf menus and shared rack/piano state, including unplaced patterns.
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
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    await page.evaluate(async () => {
      const { mountPlaylist } = await import('./scripts/stem-playlist.mjs');
      const { createInstruments } = await import('./scripts/stem-instruments.mjs');
      const { newClip } = await import('./scripts/stem-playlist-core.mjs');
      document.documentElement.lang = 'es';
      const main = document.createElement('main'), container = document.createElement('div');
      container.id = 'usage-fixture'; main.append(container); document.body.append(main);
      for (const child of [...document.body.children]) if (child !== main) child.hidden = true;
      window.editor = mountPlaylist({ container, getUsedSampleIds: () => rack.usedSampleIds() });
      const buffer = new AudioBuffer({ length: 4410, sampleRate: 44100 });
      const samples = ['unused', 'retained', 'playlist', 'rack', 'chops', 'piano', 'empty'].map(id => ({ id, name: id, buffer }));
      editor.setSession({ sources: [{ id: 'audio-original', stem: 'original', name: 'Original', buffer }], samples });
      editor.edit(state => {
        const track = state.tracks.find(track => !track.stem); track.source = 'retained'; track.mute = true;
        state.clips = [{ ...newClip(samples.find(s => s.id === 'playlist'), track.id, 0), mute: true }];
      });
      window.rack = createInstruments({ playlist: editor, tracks: () => editor.instrumentSources(), rate: () => 1 });
      rack.on(kind => { if (!kind.startsWith('before')) editor.refreshSampleUsage(); });
      rack.restore({ patterns: [
        { id: 'inactive', name: 'Inactive pattern', track: 'sample-rack', hits: [1], channels: {
          'sample-chops': { steps: [[.5]] },
          'sample-piano': { notes: [{ pitch: 60, start: 0, length: 1 }] },
          'sample-empty': {},
        } },
        { id: 'focused', name: 'Empty pattern', track: 'sample-empty' },
      ] });
      rack.focus('sample-empty', 'focused');
    });
    const ui = page.locator('#usage-fixture'), shelf = ui.locator('.pl-shelf');
    const marked = () => shelf.locator('button.is-unused').evaluateAll(items => items.map(item => item.dataset.asset).sort());
    const snapshots = () => page.evaluate(() => ({ playlist: editor.snapshot(), instruments: rack.snapshot() }));
    const scan = async () => {
      await shelf.locator('[data-asset="unused"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Revisar sonidos sin uso', exact: true }).click();
    };
    const before = await snapshots();
    await scan();
    assert.deepEqual(await marked(), ['empty', 'unused'], 'Protect playlist clips, assigned sources, original, hits, chops and notes in any pattern');
    assert.deepEqual(await snapshots(), before, 'Checking usage only changes the marks');
    assert.deepEqual(await shelf.locator('.pl-unused-label').allTextContents(), ['Sin uso', 'Sin uso']);
    await scan();
    assert.equal(await shelf.locator('.pl-unused-label').count(), 2, 'Repeated scans do not duplicate badges');
    await page.evaluate(() => rack.editPattern(pattern => { pattern.hits[0] = 1; }, 'sample-unused'));
    assert.deepEqual(await marked(), ['empty'], 'Rack edits immediately clear a stale unused mark');
    await page.evaluate(() => rack.deletePattern('inactive'));
    assert.deepEqual(await marked(), ['chops', 'empty', 'piano', 'rack'], 'Deleting an unplaced pattern makes its sounds unused');
    await page.evaluate(() => editor.place('empty'));
    assert.deepEqual(await marked(), ['chops', 'piano', 'rack']);
    await ui.locator('.pl-scroll').focus(); await page.keyboard.press('Control+z');
    assert.deepEqual(await marked(), ['chops', 'empty', 'piano', 'rack'], 'Undo refreshes usage marks');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await marked(), ['chops', 'piano', 'rack'], 'Redo refreshes usage marks');
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await shelf.screenshot({ path: path.join(artifacts, 'unused-samples.png') });
    await page.evaluate(() => {
      const saved = editor.snapshot(), samples = editor.samples(), source = editor.trackSource('original');
      editor.setSession({ sources: [{ ...source, stem: 'original' }], samples, saved });
    });
    assert.deepEqual(await marked(), [], 'Opening a project clears the previous check even with the same shelf');
    assert.deepEqual(errors, []);
    await page.evaluate(() => { rack.dispose(); editor.dispose(); });
    console.log('Unused samples browser test passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
