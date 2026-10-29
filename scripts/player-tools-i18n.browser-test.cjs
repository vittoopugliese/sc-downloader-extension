const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-results/i18n');
  fs.mkdirSync(artifacts, { recursive: true });
  const { encodeWav } = await import('./stem-audio.mjs');
  const pcm = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i * Math.PI / 50) * .2);
  const wav = Buffer.from(encodeWav([pcm, pcm]));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/tools-fixture') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><style>body{background:#191919}.playControls__elements{position:fixed;bottom:0;left:0;right:0;display:flex;height:48px}.playControls__soundBadge{flex:1}</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div><audio></audio>');
      return;
    }
    const file = path.join(root, url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const fixtures = [
      ['en-US', 'en', 'Record', 'Keep Tone', 'Back to track', 'Import audio'],
      ['es-AR', 'es', 'Grabadora', 'Mantener tono', 'Volver a pista', 'Cargar audio del equipo'],
      ['de-DE', 'de', 'Aufnahme', 'Tonhöhe halten', 'Zurück zum Titel', 'Audio vom Computer laden'],
      ['pt-BR', 'pt-BR', 'Gravador', 'Manter tom', 'Voltar à faixa', 'Carregar áudio do computador'],
      ['ru-RU', 'ru', 'Запись', 'Сохранять тон', 'Вернуться к треку', 'Загрузить аудио с компьютера'],
    ];
    for (const [language, locale, record, tone, back] of fixtures) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1000, height: 1000 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.Worker = class {
          postMessage({ channels }) { setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01, outputs: [1, 2, 3, 4].map(() => channels.map(c => c.map(v => v / 4))) } }), 10); }
          terminate() {}
        };
      });
      await page.goto(`${origin}/stems.html`);
      await page.locator('#audio-file:not(:disabled)').waitFor({ state: 'attached' });
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.ok((await page.locator('.keep-tone').getAttribute('data-scdl-tooltip')).toLowerCase().startsWith(tone.toLowerCase()), `${locale}: Keep Tone tooltip`);
      assert.equal(await page.locator('.record-section .tool-section-title').textContent(), record);
      await page.locator('#audio-file').setInputFiles({ name: 'Track.wav', mimeType: 'audio/wav', buffer: wav });
      await page.locator('#import-name').fill('Record'); // A user title matching a catalog key must stay untouched.
      await page.locator('#import-confirm').click();
      await page.locator('#separate:not(:disabled)').click();
      await page.locator('.pl-stem-head').first().waitFor();
      assert.equal(await page.locator('#stem-presets .row-menu-value').textContent(), 'Record');
      { await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
      const copy = await page.evaluate(() => ({
        hint: SCPlayerToolsText.t('Each row is a sample in this pattern. Choose One-shot for the full sound, or Chops to sequence its selected pad.'),
        reset: SCPlayerToolsText.t('Reset speed and tone'),
        record: SCPlayerToolsText.t('Record the final mix'),
      }));
      assert.equal(await page.locator('#stem-rack .plugin-hint').textContent(), copy.hint);
      assert.equal(await page.locator('#stem-rate').getAttribute('data-scdl-tooltip'), await page.evaluate(() => SCPlayerToolsText.t('Playback speed of the whole session (0.1×–3×). Unlike BPM, it changes how fast the audio plays. Double-click to reset to 1×.')));
      assert.equal(await page.locator('.record-start').getAttribute('title'), copy.record);
      for (const width of [1000, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}: no overflow at ${width}`);
        await page.locator('.workspace-header').screenshot({ path: path.join(artifacts, `header-${locale}-${width}.png`) });
      }
      await page.setViewportSize({ width: 1000, height: 1000 });
      await page.goto(`${origin}/tools-fixture`);
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-scdl-player-tools-access', JSON.stringify({ plan: 'pro', state: 'pro', capabilities: { tempo: true, preservePitch: true, freeEffects: true, premiumEffects: true, parametricEq: true, saveLoopPad: true, loopInstrument: true, openPanel: true } }));
        window.addEventListener('message', event => {
          if (event.data?.source !== 'scdl-pad-main') return;
          window.postMessage({ source: 'scdl-pad-content', id: event.data.id, result: { success: true, pads: [], presets: [] } }, location.origin);
        });
      });
      const scripts = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts.find(entry => entry.js?.includes('scripts/tempo-control-main.js')).js;
      for (const script of scripts) await page.addScriptTag({ url: `${origin}/${script}` });
      await page.locator('#scdl-tempo-control .trigger').click();
      assert.equal(await page.locator('#scdl-tempo-control .record-section .tool-section-title').textContent(), record);
      const mainCopy = await page.evaluate(() => ({
        back: SCPlayerToolsText.t('Back to track'),
        reset: SCPlayerToolsText.t('Reset Player Tools'),
        loop: SCPlayerToolsText.t('Loop Region'),
        freeze: SCPlayerToolsText.t('Hold to Freeze'),
        sample: SCPlayerToolsText.t('Sample envelope'),
      }));
      assert.equal(mainCopy.back, back);
      assert.equal(await page.locator('.clear-rate').getAttribute('aria-label'), mainCopy.reset);
      assert.equal(await page.locator('.waveform-toggle .tool-section-title').textContent(), mainCopy.loop);
      assert.equal(await page.locator('.effect-freeze').textContent(), mainCopy.freeze);
      assert.equal(await page.locator('.instrument-controls').getAttribute('aria-label'), mainCopy.sample);
      await page.locator('.effects-toggle').press('Enter');
      const missing = await page.evaluate(() => {
        const root = document.querySelector('#scdl-tempo-control').shadowRoot;
        const { messages, locale, locales } = SCPlayerToolsText;
        const index = locales.indexOf(locale());
        const values = [...root.querySelectorAll('*')].filter(n => !n.matches('style,script')).flatMap(n => [
          ...['title', 'aria-label', 'data-scdl-tooltip', 'placeholder'].map(a => n.getAttribute(a)),
          ...[...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent.trim()),
        ]).filter(Boolean);
        const translatedValues = new Set(Object.values(messages).map(row => row[index]));
        return values.filter(value => messages[value] && messages[value][index] !== value && !translatedValues.has(value));
      });
      assert.deepEqual(missing, [], `${locale}: no untranslated catalog text in the live panel`);
      await page.locator('.panel').screenshot({ path: path.join(artifacts, `tools-${locale}.png`) });
      if (locale === 'en') {
        await page.evaluate(() => {
          document.documentElement.setAttribute('data-scdl-ui-language', 'es-AR');
          document.dispatchEvent(new CustomEvent('scdl:extension-assets-ready'));
        });
        assert.equal(await page.locator('#scdl-tempo-control').getAttribute('lang'), 'es');
        assert.equal(await page.locator('.record-section .tool-section-title').textContent(), 'Grabadora');
        assert.equal(await page.locator('.waveform-toggle .tool-section-title').textContent(), 'Región de loop');
        assert.equal(await page.locator('.sampler-preset-toggle').getAttribute('title'), 'Estados guardados del sampler');
      }
      assert.deepEqual(errors, [], `${locale}: no runtime errors`);
      await context.close();
    }
    console.log('Five-language UI passed: live Player Tools, stems, custom audio, dynamic sampler hints, recorder, accessibility and responsive headers.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
