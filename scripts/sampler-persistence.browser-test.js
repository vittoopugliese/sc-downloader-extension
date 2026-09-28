const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/scripts/vendor/signalsmith/wasm-factory.mjs') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(fs.readFileSync(path.join(__dirname, 'vendor/signalsmith/wasm-factory.mjs')));
    } else if (req.url.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
      res.end(fs.readFileSync(path.join(__dirname, '../assets/drums/hat1.wav')));
    } else res.end('<!doctype html><style>.playControls__elements { position: fixed; bottom: 0; left: 0; right: 0; height: 48px; display: flex; }</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const url = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage();
    const install = async (page) => {
      await page.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (callback, ms, ...args) => original(callback, ms === 60000 ? 100 : ms, ...args);
      });
      await page.goto(url);
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-scdl-player-tools-access', JSON.stringify({ plan: 'pro', capabilities: { loopInstrument: true } }));
        window.chrome = { runtime: {
          id: 'test', getURL: file => /^(scripts\/vendor\/|assets\/drums\/)/.test(file)
            ? `${location.origin}/${file}` : `chrome-extension://test/${file}`,
          onMessage: { addListener(fn) { window.offscreenListener = fn; } }, sendMessage: async () => {},
        } };
        window.send = message => new Promise(resolve => offscreenListener(message, {
          id: 'test', url: 'chrome-extension://test/scripts/background.js',
        }, resolve));
      });
      for (const file of ['loop-audio-renderer.js', 'download-core.js', 'offscreen.js', 'tempo-control-core.js', 'sampler-core.js', 'parametric-eq.js',
        'audio-effects-core.js', 'player-tools-collapsible.js', 'parametric-eq-ui.js', 'tempo-control-main.js']) {
        await page.addScriptTag({ path: path.join(__dirname, file) });
      }
    };
    const bridge = async (page) => page.evaluate(() => {
      window.gets = 0;
      window.failList = false;
      window.addEventListener('message', async event => {
        const data = event.data;
        if (data?.source !== 'scdl-pad-main') return;
        if (data.action === 'get') gets++;
        if (data.action.startsWith('preset-')) {
          const result = await send({ ...data, type: `OFFSCREEN_SAMPLER_PRESET_${data.action.slice(7).toUpperCase()}` });
          window.postMessage({ source: 'scdl-pad-content', id: data.id, result }, location.origin);
          return;
        }
        const types = { list: 'LIST', get: 'GET', store: 'STORE', delete: 'DELETE' };
        if (!types[data.action]) return;
        const result = data.action === 'list' && failList ? { success: false, error: 'Temporary outage' }
          : await send({ ...data, type: `OFFSCREEN_PAD_${types[data.action]}` });
        window.postMessage({ source: 'scdl-pad-content', id: data.id, result }, location.origin);
      });
      document.documentElement.setAttribute('data-scdl-extension-drum-samples-url', `${location.origin}/`);
      document.dispatchEvent(new CustomEvent('scdl:extension-assets-ready'));
    });
    await install(page);
    // Seed real IndexedDB after MAIN has mounted, before the content bridge exists.
    assert.equal(await page.evaluate(async () => {
      const blob = await (await fetch('/hat1.wav')).blob();
      const base64 = await new Promise(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob);
      });
      return (await send({ type: 'OFFSCREEN_PAD_STORE', index: 7, name: 'Persistent hat', base64,
        mimeType: 'audio/wav', operationId: 'pad_persistence_seed' })).success;
    }), true);
    await bridge(page);
    const host = page.locator('#scdl-tempo-control');
    const pad = host.locator('.drum-pad').nth(7);
    await pad.waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].title.startsWith('Persistent hat'));
    assert.equal(await page.evaluate(() => gets), 0, 'Hydration must not load audio');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')));
    await host.locator('.sampler-toggle').click();
    await pad.click();
    await page.waitForFunction(() => gets === 1);
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].classList.contains('is-active'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')));
    assert.match(await pad.getAttribute('title'), /Persistent hat/);
    await pad.click();
    await page.waitForFunction(() => gets === 2); // Audio was released, persisted sample reloads.
    // A new page has no JS buffers, but shares the persisted database.
    const restored = await context.newPage();
    await install(restored);
    await bridge(restored);
    await restored.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].title.startsWith('Persistent hat'));
    await restored.evaluate(() => document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')));
    const restoredHost = restored.locator('#scdl-tempo-control');
    await restoredHost.locator('.sampler-toggle').click();
    await restoredHost.locator('.drum-pad').nth(7).click();
    await restored.waitForFunction(() => gets === 1);
    assert.equal(await restoredHost.locator('.drum-reset').count(), 0);
    const resetPad = restoredHost.locator('.drum-pad').nth(7);
    assert.match(await resetPad.getAttribute('data-scdl-tooltip'), /hold left click to restore default/);
    await resetPad.hover();
    await restored.mouse.down();
    await restored.waitForTimeout(200);
    await restored.mouse.up();
    assert.match(await resetPad.getAttribute('title'), /Persistent hat/);
    await restored.mouse.down();
    await restored.mouse.move(0, 0);
    await restored.waitForTimeout(700);
    await restored.mouse.up();
    assert.match(await resetPad.getAttribute('title'), /Persistent hat/);
    await resetPad.hover();
    await restored.mouse.down();
    await restored.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].title.startsWith('Hat 2'));
    await restored.mouse.up();
    assert.equal(await restored.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_GET', index: 7 })).pad), null);
    // A delete invalidates an older pending render and retries cannot delete a newer save.
    assert.equal(await restored.evaluate(async () => {
      await beginPadOperation(7, 'pad_pending_old_render', 'render');
      await send({ type: 'OFFSCREEN_PAD_DELETE', index: 7, operationId: 'pad_delete_receipt' });
      const stale = await finishPadOperation('pad_pending_old_render', new Blob(['old']), 'Old');
      await beginPadOperation(7, 'pad_newer_saved_audio', 'store');
      await finishPadOperation('pad_newer_saved_audio', new Blob(['new']), 'New');
      await send({ type: 'OFFSCREEN_PAD_DELETE', index: 7, operationId: 'pad_delete_receipt' });
      return stale.code === 'obsolete_pad' && (await send({ type: 'OFFSCREEN_PAD_GET', index: 7 })).pad.name === 'New';
    }), true);
    // Metadata refresh across tabs, including recovery from a transient list failure.
    await page.evaluate(() => { failList = true; document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')); });
    await host.locator('.drum-message').filter({ hasText: 'Could not restore' }).waitFor();
    await page.evaluate(() => { failList = false; document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')); });
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].title.startsWith('New'));
    // A named state keeps its own audio and per-pad settings across replacements and pages.
    const sampleFile = path.join(__dirname, '../assets/drums/hat1.wav');
    await restoredHost.locator('.drum-file').nth(0).setInputFiles(sampleFile);
    await restored.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[0].title.startsWith('hat1'));
    await restoredHost.locator('.drum-file').nth(7).setInputFiles(sampleFile);
    await restored.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.drum-pad')[7].title.startsWith('hat1'));
    await resetPad.click();
    await restoredHost.locator('[data-pad-control="gainPercent"]').press('End');
    await restoredHost.locator('[data-pad-control="pitchSemitones"]').press('ArrowUp');
    await restoredHost.locator('[data-pad-control="timePercent"]').press('End');
    await restoredHost.locator('[data-envelope="attack"]').press('End');
    const originalAudio = await restored.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_GET', index: 0 })).pad.dataUrl);
    const toggle = restoredHost.locator('.sampler-preset-toggle');
    await toggle.click();
    await restoredHost.locator('.sampler-preset-list p').filter({ hasText: 'No saved states' }).waitFor();
    await restoredHost.locator('.sampler-preset-name').fill('My <kit>');
    await restoredHost.locator('.sampler-preset-save').click();
    await restoredHost.locator('.sampler-preset-load').filter({ hasText: 'My <kit>' }).waitFor();
    assert.equal(await restoredHost.locator('.sampler-preset-list kit').count(), 0, 'Names must be plain text');
    const saved = await restored.evaluate(async () => (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_LIST' })).presets[0]);
    assert.equal(saved.name, 'My <kit>');
    await restored.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await restoredHost.locator('.panel').isVisible(), true, 'Escape closes only the dropdown');
    await restoredHost.locator('[data-pad-control="gainPercent"]').press('Home');
    await toggle.click();
    await restoredHost.locator('.sampler-preset-name').fill('Quiet kit');
    await restoredHost.locator('.sampler-preset-save').click();
    await restoredHost.locator('.sampler-preset-load').filter({ hasText: 'Quiet kit' }).waitFor();
    await restored.keyboard.press('Escape');
    await restored.evaluate(async () => {
      await send({ type: 'OFFSCREEN_PAD_DELETE', index: 0, operationId: 'pad_preset_delete_zero' });
      await send({ type: 'OFFSCREEN_PAD_DELETE', index: 7, operationId: 'pad_preset_delete_seven' });
    });
    const presetPage = await context.newPage();
    await install(presetPage);
    await bridge(presetPage);
    await presetPage.evaluate(() => document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')));
    const presetHost = presetPage.locator('#scdl-tempo-control');
    await presetHost.locator('.sampler-preset-toggle').click();
    await presetHost.locator('.sampler-preset-load').filter({ hasText: 'My <kit>' }).waitFor();
    assert.equal(await presetPage.evaluate(() => gets), 0, 'Listing presets must not decode audio');
    await presetPage.evaluate(() => beginPadOperation(0, 'pad_preset_old_render', 'render'));
    await presetHost.locator('.sampler-preset-load').filter({ hasText: 'My <kit>' }).click();
    await presetHost.locator('.drum-message').filter({ hasText: 'Sampler state restored' }).waitFor();
    assert.equal(await presetHost.locator('[data-pad-control="gainPercent"]').getAttribute('aria-valuenow'), '154');
    assert.equal(await presetHost.locator('[data-pad-control="pitchSemitones"]').getAttribute('aria-valuenow'), '1');
    assert.equal(await presetHost.locator('[data-pad-control="timePercent"]').getAttribute('aria-valuenow'), '400');
    assert.equal(await presetHost.locator('[data-envelope="attack"]').getAttribute('aria-valuenow'), '5000');
    assert.equal(await presetPage.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_GET', index: 0 })).pad.dataUrl), originalAudio);
    assert.equal(await presetPage.evaluate(async () => (await finishPadOperation('pad_preset_old_render', new Blob(['old']), 'Old')).code), 'obsolete_pad');
    assert.equal(await presetPage.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_LIST' })).pads.length), 2, 'Default pads are restored too');
    await presetHost.locator('.drum-pad').nth(0).click();
    await presetPage.waitForFunction(() => gets === 1);
    await presetHost.locator('.sampler-preset-toggle').click();
    await presetPage.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.sampler-preset-status').textContent === '');
    assert.equal(await presetHost.locator('.sampler-preset-load').count(), 2);
    fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
    await presetPage.screenshot({ path: path.join(__dirname, '../test-results/sampler-presets.png') });
    // Presets written before TIME existed must reset it to 100%, even when the
    // currently selected pad was previously stretched.
    await presetPage.evaluate(async presetId => {
      const legacy = await padTransactionFor('presets', 'readonly', store => store.get(presetId));
      legacy.settings.pads.forEach(pad => { delete pad.timePercent; });
      await padTransactionFor('presets', 'readwrite', store => store.put(legacy));
    }, saved.id);
    await presetHost.locator('.sampler-preset-load').filter({ hasText: 'My <kit>' }).click();
    await presetHost.locator('.drum-message').filter({ hasText: 'Sampler state restored' }).waitFor();
    assert.equal(await presetHost.locator('[data-pad-control="timePercent"]').getAttribute('aria-valuenow'), '100');
    await presetHost.locator('.sampler-preset-toggle').click();
    await presetPage.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.sampler-preset-status').textContent === '');
    await presetHost.locator('.sampler-preset-delete[aria-label="Delete state: My <kit>"]').click();
    await presetPage.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.sampler-preset-load').length === 1);
    assert.equal(await presetHost.locator('.sampler-preset-load').textContent(), 'Quiet kit');
    await presetHost.locator('.sampler-preset-delete').click();
    await presetHost.locator('.sampler-preset-list p').filter({ hasText: 'No saved states' }).waitFor();
    assert.equal(await presetPage.evaluate(async () => (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_LIST' })).presets.length), 0);
    assert.equal(await presetPage.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_GET', index: 0 })).pad.dataUrl), originalAudio, 'Deleting a preset preserves the current pads');
    assert.equal(await presetPage.evaluate(async presetId => (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_LOAD', presetId })).success, saved.id), false);
    await presetHost.locator('.sampler-toggle').click();
    assert.equal(await presetHost.locator('.sampler-preset-toggle').getAttribute('aria-expanded'), 'false', 'Clicking outside closes the dropdown');
    // A piano preset owns its sample, loads without a loop, and leaves the kit intact.
    assert.equal(await presetPage.evaluate(async () => {
      const audio = await new Promise(async resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(await (await fetch('/hat1.wav')).blob());
      });
      const pads = Array.from({ length: 8 }, () => ({ key: '', gainPercent: 80, pitchSemitones: 3,
        timePercent: 100, envelope: { attack: 51, decay: 127, sustain: 66, release: 166 } }));
      return (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_SAVE', presetId: 'preset_piano_fixture', name: 'Piano sample',
        settings: { kind: 'piano', selectedPadIndex: 0, adsrEnabled: true, cutItself: false,
          pads, instrument: { audio, octave: 1 } } })).success;
    }), true);
    await presetHost.locator('.sampler-preset-toggle').click();
    await presetHost.locator('.sampler-preset-load').filter({ hasText: 'Piano sample' }).click();
    await presetPage.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-instrument').getAttribute('aria-pressed') === 'true');
    assert.equal(await presetHost.locator('[data-pad-control="gainPercent"]').getAttribute('aria-valuenow'), '80');
    assert.equal(await presetHost.locator('[data-pad-control="pitchSemitones"]').getAttribute('aria-valuenow'), '3');
    assert.equal(await presetHost.locator('[data-envelope="attack"]').getAttribute('aria-valuenow'), '51');
    assert.equal(await presetHost.locator('[data-pad-control="gainPercent"]').isVisible(), true);
    assert.equal(await presetPage.evaluate(async () => (await send({ type: 'OFFSCREEN_PAD_GET', index: 0 })).pad.dataUrl), originalAudio);
    await presetHost.locator('[data-pad-control="gainPercent"]').press('ArrowUp');
    await presetHost.locator('[data-pad-control="timePercent"]').press('ArrowUp');
    await presetHost.locator('.sampler-preset-toggle').click();
    await presetHost.locator('.sampler-preset-name').fill('Jam piano');
    await presetHost.locator('.sampler-preset-save').click();
    await presetHost.locator('.sampler-preset-load').filter({ hasText: 'Jam piano' }).waitFor();
    const jam = await presetPage.evaluate(async () => {
      const preset = (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_LIST' })).presets.find(p => p.name === 'Jam piano');
      return (await send({ type: 'OFFSCREEN_SAMPLER_PRESET_LOAD', presetId: preset.id })).settings;
    });
    assert.equal(jam.instrument.gainPercent, 81);
    assert.equal(jam.instrument.timePercent, 101);
    assert.equal(jam.instrument.octave, 1);
    assert.equal(jam.cutItself, false);
    assert.equal(jam.adsrEnabled, true);
    const fresh = await context.newPage();
    await install(fresh); await bridge(fresh);
    await fresh.evaluate(() => document.dispatchEvent(new CustomEvent('scdl:open-player-tools-panel')));
    const freshHost = fresh.locator('#scdl-tempo-control');
    await freshHost.locator('.sampler-preset-toggle').click();
    await freshHost.locator('.sampler-preset-load').filter({ hasText: 'Jam piano' }).click();
    await fresh.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-instrument').getAttribute('aria-pressed') === 'true');
    assert.equal(await freshHost.locator('[data-pad-control="timePercent"]').getAttribute('aria-valuenow'), '101');
    await freshHost.locator('.sampler-preset-menu').waitFor({ state: 'hidden' });
    await fresh.bringToFront();
    await fresh.evaluate(() => {
      window.pianoHits = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) {
        pianoHits.push({ duration: this.buffer.duration, rate: this.playbackRate.value });
        return start.apply(this, args);
      };
    });
    await freshHost.locator('[data-pad-control="timePercent"]').focus();
    await fresh.keyboard.down('q');
    await fresh.waitForFunction(() => pianoHits.length > 0).catch(async error => {
      throw new Error(`${error.message}: ${await freshHost.locator('.drum-message').textContent()}`);
    });
    await fresh.keyboard.up('q');
    const hit = await fresh.evaluate(() => pianoHits.at(-1));
    assert.ok(hit.duration > 0);
    assert.ok(hit.rate > 1, 'Keyboard octave and instrument pitch apply to rendered audio');
    await freshHost.locator('.sampler-preset-toggle').click();
    await fresh.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.sampler-preset-status').textContent === '');
    await fresh.screenshot({ path: path.join(__dirname, '../test-results/sampler-piano-presets.png') });
    console.log('Sampler persistence passed: pads and independent piano audio/settings survive fresh pages, save/load/delete and legacy presets.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
