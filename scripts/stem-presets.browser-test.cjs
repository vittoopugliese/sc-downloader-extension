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
  const pcm = [0, 1].map(() => Float32Array.from({ length: 44100 * 120 }, (_, i) => .25 * Math.sin(2 * Math.PI * 440 * i / 44100)));
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav(pcm)).toString('base64')}`;
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, locale: 'en-US', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    await context.addInitScript(({ dataUrl }) => {
      // This suite checks the modules in their docked place under the Playlist.
      for (const id of ['rack', 'piano', 'eq', 'recorder']) localStorage.setItem(`stem-module-${id}`, JSON.stringify({ open: true, docked: true }));
      window.inferences = 0;
      window.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Saved 440 Hz loop', artist: 'Test artist', trimRange: { startMs: 2000, endMs: 122000 } }
        : { success: true, instrument: { dataUrl } } } };
      window.Worker = class {
        postMessage({ channels }) {
          inferences++;
          this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01,
            outputs: [.25, .25, .25, .25].map(gain => channels.map(channel => channel.map(v => v * gain))) } }), 30);
        }
        terminate() { clearTimeout(this.timer); }
      };
      // Real persistent FileSystemDirectoryHandles, without opening an OS picker.
      window.showDirectoryPicker = () => navigator.storage.getDirectory();
    }, { dataUrl });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/stems.html?job=test`;
    await page.goto(url);
    await page.locator('#save-project:not(:disabled)').waitFor();
    await closeExtract(page);
    // Opens a saved project from the menu and waits until it has loaded (the menu is
    // disabled while it loads).
    const openProject = async key => {
      const done = page.evaluate(() => new Promise(resolve => {
        const toggle = document.querySelector('#stem-presets'); let seen = false;
        const observer = new MutationObserver(() => { if (toggle.disabled) seen = true; else if (seen) { observer.disconnect(); resolve(); } });
        observer.observe(toggle, { attributes: true, attributeFilter: ['disabled'] });
      }));
      await page.locator('#stem-presets').click(); await page.locator(`#stem-presets-menu .row-menu-row[data-id="${key}"] .row-menu-load`).click();
      await done;
    };
    const modified = () => page.locator('#save-project').evaluate(node => node.classList.contains('has-changes'));
    const stored = (key = null) => page.evaluate(async key => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      return (await StemPresets.current()).load(key || document.querySelector('#stem-presets').value);
    }, key);
    const storedIds = () => page.evaluate(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      return (await (await StemPresets.current()).list()).map(record => record.id);
    });
    assert.equal(await modified(), false, 'A freshly loaded loop has nothing to save yet');
    // Saving is by hand. The first save asks for a name; Cancel stores nothing.
    await page.locator('#save-project').click();
    await page.locator('#save-cancel').click();
    assert.deepEqual(await storedIds(), []);
    await page.locator('#save-project').click();
    await page.locator('#save-name').fill('My saved mix');
    await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').evaluate(node => node.value);
    assert.equal((await stored()).record.title, 'My saved mix');
    assert.equal((await stored()).blobs.length, 1, 'Saved before separation: the original alone');
    // Separating marks the project as modified (* by its name); Ctrl+S adds the stems to it.
    await reopenExtract(page);
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelector('#save-project').classList.contains('has-changes'));
    assert.equal(await page.locator('#stem-presets .row-menu-modified').isVisible(), true);
    assert.equal((await stored()).blobs.length, 1, 'Nothing is saved automatically');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.querySelector('#save-project').classList.contains('has-changes'));
    assert.equal((await stored(id)).blobs.length, 5, 'Save writes the stems into the same project');
    assert.deepEqual(await storedIds(), [id]);
    // Rack-only audio is saved with the project, despite having no arrangement clip.
    const clipsBeforeRackImport = (await stored()).record.settings.playlist.clips.length;
    await page.evaluate(async () => {
      const { encodeWav } = await import('./scripts/stem-audio.mjs');
      const pcm = Float32Array.from({ length: 4410 }, (_, i) => .2 * Math.sin(i * 2 * Math.PI * 220 / 44100));
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([encodeWav([pcm, pcm])], 'rack-only.wav', { type: 'audio/wav' }));
      document.querySelector('#stem-rack').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });
    const rackSample = page.locator('.rack-channel', { hasText: 'rack-only.wav' });
    await rackSample.waitFor();
    const rackSampleKey = await rackSample.getAttribute('data-channel'), rackSampleId = rackSampleKey.slice('sample-'.length);
    assert.deepEqual(Object.keys((await stored()).samples), [], 'Imported samples wait for Save');
    await page.locator('#save-project').click();
    await page.waitForFunction(async sampleId => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const saved = await (await StemPresets.current()).load(document.querySelector('#stem-presets').value);
      return saved.samples[sampleId]?.size > 44 && saved.record.settings.playlist.samples.some(sample => sample.id === sampleId);
    }, rackSampleId);
    assert.equal((await stored()).record.settings.playlist.clips.length, clipsBeforeRackImport);
    await page.locator('.pl-stem-head[data-stem=drums] .ui-knob-dial').press('Home');
    await page.locator('.pl-stem-head[data-stem=drums] .ui-knob-dial').press('Shift+ArrowUp');
    await page.locator('.pl-stem-head[data-stem=drums] .stem-enable').click();
    // Pad A of the drums, cut by hand in the channel rack (right-click arms it).
    { await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
    await page.locator('#stem-rack .rack-view-chops').click();
    await page.locator('#stem-rack .rack-pad').first().click({ button: 'right' });
    await page.locator('#stem-rack .rack-wave').click({ position: { x: 100, y: 30 } });
    const savedStart = Number(await page.locator('#stem-rack .stem-pad-marker').first().getAttribute('data-start'));
    await page.locator('#stem-rack .stem-sample-fadeIn').first().press('Shift+ArrowRight');
    await page.locator('#stem-rack .stem-sample-fadeOut').first().press('Shift+ArrowRight');
    await page.locator('#stem-rack .stem-sample-end').first().press('Shift+ArrowRight');
    const savedSlice = await page.locator('#stem-rack .stem-pad-region').first().evaluate(node => ({ ...node.dataset }));
    await page.locator('#stem-rate').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, '0.5');
    await page.locator('#stem-keep-tone').check();
    await page.locator('.peq-add').click();
    await page.locator('.peq-clip').click();
    assert.equal((await stored()).record.settings.rate, 1, 'Edits stay unsaved until Save');
    await page.locator('#save-project').click();
    await page.waitForFunction(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const record = (await (await StemPresets.current()).list())[0];
      return record.settings.rate === .5 && record.settings.keepTone && record.settings.states[0].muted && record.settings.instruments?.drums?.slices?.[0]?.start > 0 && record.settings.eq?.bands.length === 1 && record.settings.eq.hardClip;
    });
    // Leaving with unsaved edits shows Chrome's "Leave site?" warning; leaving drops them.
    await page.locator('#stem-keep-tone').uncheck();
    const warned = new Promise(resolve => page.once('dialog', dialog => { resolve(dialog.type()); dialog.accept(); }));
    await page.goto(url.replace('?job=test', ''));
    assert.equal(await warned, 'beforeunload');
    await page.waitForFunction(() => document.querySelectorAll('#stem-presets-menu .row-menu-row').length === 2);
    assert.equal(await page.locator('#stem-presets-menu .row-menu-row').first().textContent(), 'Empty project');
    await openProject(id);
    assert.equal(await modified(), false, 'An opened project has no changes');
    assert.equal(await page.evaluate(() => inferences), 0, 'Loading never starts model inference');
    assert.equal(await page.locator('#stem-presets .row-menu-value').textContent(), 'My saved mix');
    assert.equal(await rackSample.getAttribute('data-channel'), rackSampleKey, 'Rack-only sample survives reopening');
    assert.equal(await rackSample.locator('.rack-channel-one-shot').getAttribute('aria-pressed'), 'true');
    assert.equal((await stored()).record.settings.playlist.clips.length, clipsBeforeRackImport);
    assert.equal(await page.locator('.pl-stem-head[data-stem=drums] .ui-knob-dial').getAttribute('aria-valuenow'), '10');
    assert.equal(await page.locator('.pl-stem-head[data-stem=drums] .stem-enable').getAttribute('aria-checked'), 'false');
    { await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
    assert.equal(Number(await page.locator('#stem-rack .stem-pad-marker').first().getAttribute('data-start')), savedStart);
    assert.deepEqual(await page.locator('#stem-rack .stem-pad-region').first().evaluate(node => ({ ...node.dataset })), savedSlice, 'Trim and both fades survive preset restoration');
    assert.equal(await page.locator('#stem-rate').inputValue(), '0.5');
    assert.equal(await page.locator('#stem-keep-tone').isChecked(), true);
    assert.equal(await page.locator('#repeat').count(), 0);
    assert.equal(await page.locator('.peq-point').count(), 1);
    assert.equal(await page.locator('.peq-clip').getAttribute('aria-pressed'), 'true');
    // Empty project: unsaved changes ask first. Cancel stays; Don't save starts over and
    // keeps the stored copy.
    const emptyProject = async () => { await page.locator('#stem-presets').click(); await page.locator('#stem-presets-menu .row-menu-row[data-id="new-project"] .row-menu-load').click(); };
    await page.locator('#stem-rate').dblclick();
    await emptyProject(); await page.locator('#unsaved-cancel').click();
    assert.equal(await page.locator('#stem-rate').inputValue(), '1', 'Cancel keeps the session');
    await emptyProject();
    await Promise.all([page.waitForNavigation(), page.locator('#unsaved-discard').click()]);
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('.pl-stem-head').count(), 0, 'The page starts empty');
    assert.equal((await stored(id)).record.settings.rate, .5, "Don't save leaves the stored project as it was");
    await page.waitForFunction(() => document.querySelectorAll('#stem-presets-menu .row-menu-row').length === 2);
    await openProject(id);
    // Select a different root and save the loaded audio there, retaining the DB copy.
    await page.locator('#preset-folder').click();
    await page.locator('#preset-reset').waitFor();
    await page.locator('#save-project:not(:disabled)').waitFor();
    await page.locator('#save-project').click();
    await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const folderId = await page.locator('#stem-presets').evaluate(node => node.value);
    assert.notEqual(folderId, id);
    assert.deepEqual(await page.evaluate(async id => {
      const root = await navigator.storage.getDirectory();
      const directory = await (await root.getDirectoryHandle('PlayerTools-Stems')).getDirectoryHandle(id);
      const names = []; for await (const name of directory.keys()) names.push(name); return names.sort();
    }, folderId), ['bass.wav', 'drums.wav', 'original.wav', 'other.wav', 'preset.json', `sample-${rackSampleId}.wav`, 'vocals.wav']);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#stem-presets-menu .row-menu-row').length === 2);
    await openProject(folderId);
    await page.locator('.pl-stem-head').first().waitFor();
    assert.equal(await rackSample.getAttribute('data-channel'), rackSampleKey, 'Rack-only sample survives folder restoration');
    assert.equal(await page.evaluate(() => inferences), 0);
    await page.locator('#preset-reset').click();
    await page.waitForFunction(id => !!document.querySelector(`#stem-presets-menu .row-menu-row[data-id="${id}"]`), id);
    assert.equal(await page.locator('#preset-reset').isVisible(), false);
    await openProject(id);
    await page.waitForFunction(() => document.querySelector('#stem-rate').value === '0.5');
    // Interrupted folder saves must not appear in the list; prior data survives.
    assert.equal(await page.evaluate(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const directory = await navigator.storage.getDirectory();
      const library = new StemPresets(directory);
      const saved = await library.list(), loaded = await library.load(saved[0].id);
      const root = await library.root();
      library.root = async () => ({ getDirectoryHandle: async (...args) => {
        const child = await root.getDirectoryHandle(...args);
        return { getFileHandle: async name => { if (name === 'bass.wav') throw new DOMException('Full', 'QuotaExceededError'); return child.getFileHandle(name, { create: true }); } };
      } });
      try { await library.save(loaded.record.info, loaded.record.settings, loaded.blobs); } catch {}
      return (await new StemPresets(directory).list()).length;
    }), 1);
    // Corrupt/missing WAV must leave the current player untouched.
    await page.evaluate(async id => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const directory = await (await new StemPresets(await navigator.storage.getDirectory()).root()).getDirectoryHandle(id);
      const stream = await (await directory.getFileHandle('drums.wav')).createWritable();
      await stream.write('broken'); await stream.close();
    }, folderId);
    await page.locator('#preset-folder').click();
    await page.locator('#stem-presets:not(:disabled)').waitFor();
    await openProject(folderId);
    await page.locator('.ui-toast-content[data-variant=error]').first().waitFor();
    assert.equal(await page.locator('.pl-stem-head').count(), 5);
    assert.equal(await page.locator('#stem-rate').inputValue(), '0.5');
    // Real Signalsmith AudioWorklet, real audio: rate affects frequency only when
    // Keep Tone is off. Shared clock remains aligned through live changes/seek.
    await page.locator('#preset-reset').click();
    await page.locator('#stem-presets:not(:disabled)').waitFor();
    await openProject(id);
    await page.locator('.peq-reset').click();
    await page.locator('.pl-stem-head[data-stem=original] .stem-enable').click({ button: 'right' });
    await page.evaluate(() => {
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        // The tone output now feeds the EQ input rather than the speakers.
        if (this instanceof AudioWorkletNode && this.context.sampleRate === 44100) {
          window.analyser = this.context.createAnalyser(); analyser.fftSize = 16384; analyser.smoothingTimeConstant = 0;
          connect.call(this, analyser);
        }
        return connect.call(this, destination, ...args);
      };
    });
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label') === 'Pause');
    for (const [rate, keep, frequency] of [[.5, false, 220], [.5, true, 440], [2, true, 440], [2, false, 880], [.1, true, 440], [3, true, 440]]) {
      await page.locator('#stem-rate').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, String(rate));
      await page.locator('#stem-keep-tone').setChecked(keep);
      await page.waitForTimeout(650);
      const measured = await page.evaluate(() => {
        const data = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(data);
        let index = 0; for (let i = 1; i < data.length; i++) if (data[i] > data[index]) index = i;
        return index * analyser.context.sampleRate / analyser.fftSize;
      });
      console.log(`rate=${rate} keepTone=${keep}: ${measured.toFixed(1)} Hz`);
      assert.ok(Math.abs(measured - frequency) < 22, `Expected ${frequency} Hz, got ${measured}`);
      const positions = await page.locator('.waveform-playhead').evaluateAll(nodes => nodes.map(n => n.style.left));
      assert.ok(positions.every(value => value === positions[0]));
    }
    await page.locator('#play').click();
    for (const width of [1200, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const target = path.join(root, 'test-results/stem-presets'); fs.mkdirSync(target, { recursive: true });
      await page.screenshot({ path: path.join(target, `${width}.png`), fullPage: true });
    }
    // Imported samples live beside the stems in both destinations and can be dropped.
    assert.deepEqual(await page.evaluate(async id => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const sample = new Blob([new Uint8Array(100)], { type: 'audio/wav' }), results = [];
      const database = await StemPresets.current(), { record, blobs } = await database.load(id);
      const folder = new StemPresets(await navigator.storage.getDirectory()), copy = await folder.save(record.info, record.settings, blobs);
      for (const [library, key] of [[database, id], [folder, copy.id]]) {
        await library.saveSamples(key, { 'kick-808': sample });
        results.push(Object.keys((await library.load(key)).samples));
        await library.removeSamples(key, ['kick-808']);
        results.push(Object.keys((await library.load(key)).samples));
      }
      await folder.remove(copy.id);
      return results;
    }, id), [[rackSampleId, 'kick-808'], [rackSampleId], ['kick-808'], []]);
    // Delete from the menu: two steps, never opens the row; the open session stays, now
    // unsaved. The folder destination removes only that preset's folder.
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.locator('#stem-presets').click();
    const removeRow = page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-delete`);
    await removeRow.click();
    assert.equal(await removeRow.textContent(), 'Delete?');
    await removeRow.click();
    await page.waitForFunction(id => !document.querySelector(`#stem-presets-menu .row-menu-row[data-id="${id}"]`), id);
    assert.equal(await modified(), true, 'The open session is unsaved again');
    assert.equal(await page.locator('.pl-stem-head').count(), 5, 'The open session stays');
    assert.equal(await page.evaluate(async id => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      return (await (await StemPresets.current()).list()).some(record => record.id === id);
    }, id), false);
    assert.deepEqual(await page.evaluate(async id => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const root = await navigator.storage.getDirectory(), library = new StemPresets(root);
      await library.remove(id);
      const names = []; for await (const name of (await root.getDirectoryHandle('PlayerTools-Stems')).keys()) names.push(name);
      return names.includes(id);
    }, folderId), false);
    assert.deepEqual(errors, []);
    console.log('Stem projects: manual save (original alone, then stems), unsaved marker, Leave-site warning, empty project, DB/folder save, restore, reset, interrupted/corrupt saves, no re-inference, real Keep Tone and responsive layout passed.');
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
