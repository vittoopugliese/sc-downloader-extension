const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const rate = 48000;
  const wav = Buffer.alloc(44 + rate * 30 * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('.wav')) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); }
    else res.end('<!doctype html><html lang="en"><style>.playControls__elements{position:fixed;bottom:0;display:flex;width:100%;height:48px}</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  async function test(name, run, shared = true) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(shared => {
        document.documentElement.setAttribute('data-scdl-extension-drum-samples-url', location.origin + '/');
        window.records = Array.from({ length: 8 }, (_, index) => ({ index, name: `Slice ${index}`,
          updatedAt: 1, trimRevision: 0, audioId: shared ? 'shared' : `source-${index}`,
          sourceDurationMs: 30000, trim: { startMs: 0, endMs: 30000 } }));
        window.requests = [];
        window.pendingGets = [];
        window.played = [];
        window.decodeCount = 0;
        const decode = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = function (...args) { decodeCount++; return decode.apply(this, args); };
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) { played.push(args); return start.apply(this, args); };
        window.addEventListener('message', event => {
          const data = event.data;
          if (data?.source !== 'scdl-pad-main') return;
          requests.push(data);
          const reply = () => {
            let result = { success: true };
            if (data.action === 'list') result.pads = records;
            if (data.action === 'get') result.pad = { ...records[data.index],
              ...(data.metadataOnly ? {} : { dataUrl: location.origin + '/source.wav' }) };
            if (data.action === 'trim') {
              const record = records[data.index];
              if (data.expectedTrimRevision !== undefined && data.expectedTrimRevision !== record.trimRevision) {
                result = { success: false, error: 'The sample bounds changed. Reopen the pad and try again.' };
              } else {
                record.trim = data.trim;
                result.trimRevision = ++record.trimRevision;
              }
            }
            window.postMessage({ source: 'scdl-pad-content', id: data.id, result }, location.origin);
          };
          if (data.action === 'get' && window.holdGets) pendingGets.push(reply);
          else reply();
        });
      }, shared);
      for (const file of ['tempo-control-core.js', 'looper-core.js', 'sampler-core.js', 'parametric-eq.js',
        'audio-effects-core.js', 'player-tools-collapsible.js', 'parametric-eq-ui.js', 'tempo-control-main.js']) {
        if (file !== 'tempo-control-main.js') await page.addScriptTag({ path: path.join(__dirname, file) });
        else {
          // Inspect retained AudioBuffers without adding production debug exports.
          const source = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\}\)\(\);\s*$/, `
            window.inspectPadEditor = () => ({ pending: padEditorPending, index: padEditor?.index ?? null });
            window.inspectPadCache = async () => {
              const values = await Promise.all([...padWaveformSources.values()].map(entry => entry.promise || entry));
              const buffers = [...new Set([...drumPads.map(p => p.buffer), ...values.map(p => p.buffer),
                ...[...padEditorCache.values()].map(p => p.buffer), padEditor?.buffer].filter(Boolean))];
              return buffers.reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0);
            };
          })();`);
          await page.addScriptTag({ content: source });
        }
      }
      await page.evaluate(() => document.dispatchEvent(new Event('scdl:open-player-tools-panel')));
      const host = page.locator('#scdl-tempo-control');
      await host.locator('.sampler-toggle').click();
      await host.locator('.drum-pad[title^="Slice 0"]').waitFor();
      const edit = async index => {
        await host.locator('.drum-pad').nth(index).dispatchEvent('contextmenu');
        await page.waitForFunction(index => {
          const root = document.querySelector('#scdl-tempo-control').shadowRoot;
          const editor = inspectPadEditor();
          return !editor.pending && editor.index === index && root.querySelector('.waveform-end').getAttribute('aria-label') ===
            'Pad ' + root.querySelectorAll('.drum-key')[index].textContent + ' B';
        }, index);
      };
      await run({ page, host, edit });
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
    finally { await page.close(); }
  }
  try {
    await test('closing invalidates a pending first editor', async ({ page, host }) => {
      await page.evaluate(() => { window.holdGets = true; });
      await host.locator('.drum-pad').nth(0).dispatchEvent('contextmenu');
      await page.waitForFunction(() => pendingGets.length > 0);
      await page.mouse.click(1000, 100);
      await host.locator('.panel').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => inspectPadEditor()), { pending: false, index: null });
      await page.evaluate(() => { window.holdGets = false; pendingGets.splice(0).forEach(reply => reply()); });
      await page.waitForTimeout(250);
      await page.evaluate(() => document.dispatchEvent(new Event('scdl:open-player-tools-panel')));
      assert.equal(await host.locator('.editor-track').isVisible(), false);
    });
    await test('reopening refreshes externally edited bounds without decoding again', async ({ page, host, edit }) => {
      await edit(0);
      const decodes = await page.evaluate(() => decodeCount);
      await host.locator('.editor-track').dispatchEvent('click');
      await page.evaluate(() => { records[0].trim = { startMs: 400, endMs: 900 }; records[0].trimRevision++; });
      await edit(0);
      await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot
        .querySelector('.waveform-start').getAttribute('aria-valuenow') === '400');
      assert.equal(await host.locator('.waveform-start').getAttribute('aria-valuenow'), '400');
      assert.equal(await host.locator('.waveform-end').getAttribute('aria-valuenow'), '900');
      assert.equal(await page.evaluate(() => decodeCount), decodes);
    });
    await test('closing during audio decode cannot revive the editor or its cache', async ({ page, host }) => {
      await page.evaluate(() => {
        const decode = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = async function (...args) {
          const buffer = await decode.apply(this, args);
          await new Promise(resolve => { window.releaseDecode = resolve; });
          return buffer;
        };
      });
      await host.locator('.drum-pad').nth(0).dispatchEvent('contextmenu');
      await page.waitForFunction(() => window.releaseDecode);
      await page.mouse.click(1000, 100);
      await host.locator('.panel').waitFor({ state: 'hidden' });
      await page.evaluate(async () => { releaseDecode(); await inspectPadCache(); });
      assert.deepEqual(await page.evaluate(() => inspectPadEditor()), { pending: false, index: null });
      assert.equal(await page.evaluate(() => inspectPadCache()), 0);
      await page.evaluate(() => document.dispatchEvent(new Event('scdl:open-player-tools-panel')));
      assert.equal(await host.locator('.editor-track').isVisible(), false);
    });
    await test('concurrent trims cannot silently overwrite another tab', async ({ page, host, edit }) => {
      await edit(0);
      await page.evaluate(() => { records[0].trim = { startMs: 400, endMs: 900 }; records[0].trimRevision++; });
      await host.locator('.waveform-start').dispatchEvent('keydown', { key: 'ArrowRight' });
      await page.waitForFunction(() => requests.some(r => r.action === 'trim'));
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => records[0].trim), { startMs: 400, endMs: 900 });
      await host.locator('.editor-track').waitFor({ state: 'hidden' });
    });
    await test('eight shared slices transfer their original only once', async ({ page, edit }) => {
      for (let i = 0; i < 8; i++) await edit(i);
      assert.equal(await page.evaluate(() => requests.filter(r => r.action === 'get' && r.original && !r.metadataOnly).length), 1);
      assert.equal(await page.evaluate(() => decodeCount), 1);
    });
    await test('repeated hits on the selected pad do not redraw its controls', async ({ page, host }) => {
      await host.locator('.drum-pad').nth(0).click();
      await page.waitForFunction(() => played.length > 0);
      await page.evaluate(() => {
        window.controlRenders = 0;
        for (const knob of document.querySelector('#scdl-tempo-control').shadowRoot.querySelectorAll('.instrument-controls button')) {
          if (!knob.renderControl) continue;
          const render = knob.renderControl;
          knob.renderControl = () => { controlRenders++; render(); };
        }
      });
      for (let i = 0; i < 5; i++) await host.locator('.drum-pad').nth(0).click();
      assert.equal(await page.evaluate(() => controlRenders), 0);
    });
    await test('switching pads refreshes controls after a direct knob edit', async ({ host }) => {
      const gain = host.locator('[data-pad-control="gainPercent"]');
      await gain.press('ArrowUp');
      assert.equal(await gain.getAttribute('aria-valuenow'), '101');
      await host.locator('.drum-pad').nth(1).click();
      assert.equal(await gain.getAttribute('aria-valuenow'), '100');
      await host.locator('.drum-pad').nth(0).click();
      assert.equal(await gain.getAttribute('aria-valuenow'), '101');
    });
    await test('playback and waveform caches share a 64 MiB PCM budget', async ({ page, host, edit }) => {
      for (let i = 0; i < 8; i++) {
        await host.locator('.drum-pad').nth(i).click();
        await page.waitForFunction(count => played.length === count, i + 1);
      }
      for (let i = 0; i < 8; i++) await edit(i);
      const bytes = await page.evaluate(() => inspectPadCache());
      console.log(`Retained PCM: ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
      assert.ok(bytes <= 64 * 1024 * 1024, `${bytes} bytes retained`);
      await edit(0);
      await host.locator('.drum-pad').nth(0).click();
      await page.waitForFunction(() => played.length === 9);
      assert.ok(await page.evaluate(() => inspectPadCache()) <= 64 * 1024 * 1024);
    }, false);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(failures, [], 'Pad editor regressions');
})().catch(error => { console.error(error); process.exitCode = 1; });
