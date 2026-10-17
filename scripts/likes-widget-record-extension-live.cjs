// Optional live check with the unpacked extension: Chrome injects widget-record-tap.js
// into the Explorer's widget only, and the widget loads the recorder worklet from
// chrome-extension:// (web_accessible_resources). Public track, throwaway profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scdl-widget-record-'));
  const extensionPath = path.resolve(__dirname, '..');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto('https://soundcloud.com/forss/flickermood', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate(() => {
      for (const flag of ['1', '0']) {
        const frame = document.createElement('iframe'); frame.allow = 'autoplay'; frame.width = 400; frame.height = 120;
        frame.dataset.flag = flag;
        frame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://api.soundcloud.com/tracks/293')}&auto_play=${flag === '1'}${flag === '1' ? '&scdl_likes_player=1' : ''}`;
        document.body.append(frame);
      }
    });
    const frames = () => page.frames().filter(frame => frame.url().startsWith('https://w.soundcloud.com/player/'));
    await page.waitForFunction(() => document.querySelectorAll('iframe[data-flag]').length === 2);
    await page.waitForTimeout(8000);
    const tapped = await Promise.all(frames().map(async frame => ({ explorer: frame.url().includes('scdl_likes_player=1'),
      tap: await frame.evaluate(() => globalThis.__scdlWidgetRecordTap === true) })));
    assert.deepEqual(tapped.sort((a, b) => a.explorer - b.explorer), [{ explorer: false, tap: false }, { explorer: true, tap: true }],
      'only the Explorer widget gets the tap');
    const explorer = frames().find(frame => frame.url().includes('scdl_likes_player=1'));
    if (await explorer.evaluate(() => !document.querySelector('.playButton.playing'))) await explorer.locator('.playButton').first().click().catch(() => {});
    await page.waitForTimeout(2000);
    const result = await page.evaluate(async moduleUrl => {
      const target = document.querySelector('iframe[data-flag="1"]').contentWindow;
      const id = crypto.randomUUID(), seen = { started: false, chunks: 0, peak: 0, stopped: false, error: null };
      addEventListener('message', event => {
        const data = event.data;
        if (event.source !== target || data?.scdl !== 'widget-record' || data.id !== id) return;
        if (data.type === 'started') seen.started = true;
        if (data.type === 'error') seen.error = data.message || data.code;
        if (data.type === 'stopped') seen.stopped = true;
        if (data.type === 'chunk') { seen.chunks++; for (const value of data.channels[0]) seen.peak = Math.max(seen.peak, Math.abs(value)); }
      });
      target.postMessage({ scdl: 'widget-record', type: 'start', id, moduleUrl, maxSeconds: 120 }, 'https://w.soundcloud.com');
      await new Promise(resolve => setTimeout(resolve, 1500));
      target.postMessage({ scdl: 'widget-record', type: 'stop', id }, 'https://w.soundcloud.com');
      await new Promise(resolve => setTimeout(resolve, 500));
      return seen;
    }, `chrome-extension://${extensionId}/scripts/record-processor.js`);
    assert.equal(result.error, null);
    assert.ok(result.started && result.stopped, JSON.stringify(result));
    assert.ok(result.chunks > 10 && result.peak > .05, `real audio arrives (${JSON.stringify(result)})`);
    console.log('Extension widget recorder passed:', JSON.stringify(result));
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
