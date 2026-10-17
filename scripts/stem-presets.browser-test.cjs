const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

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
    await page.locator('#save-locally:not(:disabled)').waitFor();
    assert.equal(await page.locator('#save-locally').getAttribute('aria-pressed'), 'false');
    await page.locator('#save-locally').click();
    await page.locator('#save-cancel').click();
    assert.equal(await page.locator('#save-locally').getAttribute('aria-pressed'), 'false');
    await page.locator('#save-locally').click();
    await page.locator('#save-name').fill('My saved mix');
    await page.locator('#save-confirm').click();
    await page.locator('#save-locally[aria-pressed=true]').waitFor();
    assert.equal(await page.locator('#save-locally').getAttribute('aria-pressed'), 'true');
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').inputValue();
    const stored = () => page.evaluate(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const library = await StemPresets.current();
      return library.load(document.querySelector('#stem-presets').value);
    });
    assert.equal((await stored()).record.title, 'My saved mix');
    await page.locator('.pl-stem-head[data-stem=drums] .pad-knob').press('Home');
    await page.locator('.pl-stem-head[data-stem=drums] .pad-knob').press('Shift+ArrowUp');
    await page.locator('.pl-stem-head[data-stem=drums] .stem-enable').click();
    // Pad A of the drums, cut by hand in the channel rack (right-click arms it).
    { await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
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
    await page.waitForFunction(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const record = (await (await StemPresets.current()).list())[0];
      return record.settings.rate === .5 && record.settings.keepTone && record.settings.states[0].muted && record.settings.instruments?.drums?.slices?.[0]?.start > 0 && record.settings.eq?.bands.length === 1 && record.settings.eq.hardClip;
    });
    await page.goto(url.replace('?job=test', ''));
    await page.waitForFunction(() => document.querySelector('#stem-presets').options.length === 2);
    assert.equal(await page.locator('#save-locally').getAttribute('aria-pressed'), 'false');
    await page.locator('#stem-presets').selectOption(id);
    await page.locator('.pl-stem-head[data-stem=drums] .pad-knob').waitFor();
    assert.equal(await page.evaluate(() => inferences), 0, 'Loading never starts model inference');
    assert.equal(await page.locator('#track').textContent(), 'My saved mix');
    assert.equal(await page.locator('.pl-stem-head[data-stem=drums] .pad-knob').getAttribute('aria-valuenow'), '10');
    assert.equal(await page.locator('.pl-stem-head[data-stem=drums] .stem-enable').getAttribute('aria-checked'), 'false');
    { await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
    assert.equal(Number(await page.locator('#stem-rack .stem-pad-marker').first().getAttribute('data-start')), savedStart);
    assert.deepEqual(await page.locator('#stem-rack .stem-pad-region').first().evaluate(node => ({ ...node.dataset })), savedSlice, 'Trim and both fades survive preset restoration');
    assert.equal(await page.locator('#stem-rate').inputValue(), '0.5');
    assert.equal(await page.locator('#stem-keep-tone').isChecked(), true);
    assert.equal(await page.locator('#repeat').count(), 0);
    assert.equal(await page.locator('.peq-point').count(), 1);
    assert.equal(await page.locator('.peq-clip').getAttribute('aria-pressed'), 'true');
    // Turning off never deletes a saved separation.
    await page.locator('#save-locally').click();
    await page.locator('#stem-rate').dblclick();
    assert.equal((await stored()).record.settings.rate, .5);
    // Select a different root and save the loaded audio there, retaining the DB copy.
    await page.locator('#preset-folder').click();
    await page.locator('#preset-reset').waitFor();
    await page.locator('#save-locally:not(:disabled)').waitFor();
    await page.locator('#save-locally').click();
    await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const folderId = await page.locator('#stem-presets').inputValue();
    assert.notEqual(folderId, id);
    assert.deepEqual(await page.evaluate(async id => {
      const root = await navigator.storage.getDirectory();
      const directory = await (await root.getDirectoryHandle('PlayerTools-Stems')).getDirectoryHandle(id);
      const names = []; for await (const name of directory.keys()) names.push(name); return names.sort();
    }, folderId), ['bass.wav', 'drums.wav', 'original.wav', 'other.wav', 'preset.json', 'vocals.wav']);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#stem-presets').options.length === 2);
    await page.locator('#stem-presets').selectOption(folderId);
    await page.locator('.stem').first().waitFor();
    assert.equal(await page.evaluate(() => inferences), 0);
    await page.locator('#preset-reset').click();
    await page.waitForFunction(id => [...document.querySelector('#stem-presets').options].some(o => o.value === id), id);
    assert.equal(await page.locator('#preset-reset').isVisible(), false);
    await page.locator('#stem-presets').selectOption(id);
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
    await page.locator('#stem-presets').selectOption(folderId);
    await page.locator('#status.error').waitFor();
    assert.equal(await page.locator('.pl-stem-head').count(), 5);
    assert.equal(await page.locator('#stem-rate').inputValue(), '0.5');
    // Real Signalsmith AudioWorklet, real audio: rate affects frequency only when
    // Keep Tone is off. Shared clock remains aligned through live changes/seek.
    await page.locator('#preset-reset').click();
    await page.locator('#stem-presets:not(:disabled)').waitFor();
    await page.locator('#stem-presets').selectOption(id);
    await page.locator('#save-locally[aria-pressed=true]').waitFor();
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
    assert.deepEqual(errors, []);
    console.log('Stem presets: DB/folder save, restore, automatic settings, reset, interrupted/corrupt saves, no re-inference, real Keep Tone and responsive layout passed.');
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
