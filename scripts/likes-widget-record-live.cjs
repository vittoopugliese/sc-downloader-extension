// Optional public-track smoke test for the Likes Explorer mini recorder.
// Fresh browser, no personal profile. The real tap runs inside w.soundcloud.com;
// only its worklet URL check accepts a data: URL here (no extension is loaded,
// and Playwright cannot route worklet requests).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const MODULE_URL = 'data:text/javascript;base64,' + Buffer.from(read('record-processor.js')).toString('base64');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext();
    const tap = read('widget-record-tap.js').replace(/const MODULE = .*;/, () => 'const MODULE = /^data:text\\/javascript;base64,[A-Za-z0-9+/=]+$/;');
    assert.ok(tap.includes('const MODULE = /^data:text'), 'the test must replace the module check');
    await context.addInitScript(source => {
      if (location.hostname === 'w.soundcloud.com' && location.search.includes('scdl_likes_player=1')) (0, eval)(source);
    }, tap);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://soundcloud.com/forss/flickermood', { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (const file of ['record-core.js', 'widget-record-source.js', 'likes-player.js']) await page.evaluate(read(file));
    await page.evaluate(moduleUrl => {
      window.widgetProgress = 0;
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;top:80px;right:24px;width:600px;height:80px;z-index:2147483647';
      document.body.append(container);
      window.player = SCLikesPlayer.create({ container, title: 'Explorer playback', onState() {}, onFinish() {} });
      window.player.load({ itemId: '293', title: 'Flickermood' });
      window.addEventListener('message', event => {
        if (event.origin !== 'https://w.soundcloud.com' || typeof event.data !== 'string') return;
        try { const data = JSON.parse(event.data); if (data.method === 'playProgress') widgetProgress = Math.max(widgetProgress, Number(data.value?.currentPosition) || 0); } catch {}
      });
      window.source = SCWidgetRecordSource.create({ getFrame: () => window.player.frame(), moduleUrl });
      window.states = [];
      window.recorder = SCRecord.create({ source: window.source, maxSeconds: 2, onChange: state => window.states.push(state.state) });
    }, MODULE_URL);
    try { await page.waitForFunction(() => widgetProgress > 1000, null, { timeout: 20000 }); }
    catch {
      const widget = page.frames().find(frame => frame.url().startsWith('https://w.soundcloud.com/player/'));
      await widget?.locator('.playButton').first().click();
      await page.waitForFunction(() => widgetProgress > 1000, null, { timeout: 15000 });
    }

    // Manual take: Rec, ~1.2 s, Stop.
    const manual = await page.evaluate(async () => {
      await recorder.prepare(); await recorder.start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      await recorder.stop();
      const state = recorder.snapshot();
      let peak = 0;
      for (const [min, max] of recorder.peaks()) peak = Math.max(peak, -min, max);
      const wav = recorder.exportWav();
      return { ...state, peak, wavBytes: wav.size };
    });
    assert.equal(manual.state, 'ready');
    assert.ok(manual.duration > .9 && manual.duration < 1.8, `manual take lasts ~1.2 s (${manual.duration})`);
    assert.ok(manual.peak > .05, `the take contains the widget audio, not silence (peak ${manual.peak})`);
    assert.equal(manual.wavBytes, 44 + manual.frames * 4);

    // Limit: the take stops itself at maxSeconds.
    const limited = await page.evaluate(async () => {
      await recorder.start();
      await new Promise(resolve => setTimeout(resolve, 3200));
      return recorder.snapshot();
    });
    assert.equal(limited.state, 'ready');
    assert.ok(Math.abs(limited.duration - 2) < .05, `limit stops at 2 s (${limited.duration})`);
    assert.match(limited.message, /limit/i);

    // Loading another track mid-take keeps what was recorded.
    const interrupted = await page.evaluate(async () => {
      await recorder.start();
      await new Promise(resolve => setTimeout(resolve, 700));
      player.destroy(); source.interrupt();
      await new Promise(resolve => setTimeout(resolve, 100));
      return recorder.snapshot();
    });
    assert.equal(interrupted.state, 'ready');
    assert.ok(interrupted.duration > .3 && interrupted.duration < 1.2, `interrupted take is kept (${interrupted.duration})`);
    assert.deepEqual(errors, []);
    console.log('Live widget recorder passed:', JSON.stringify({ manual: manual.duration, peak: +manual.peak.toFixed(3), limited: limited.duration, interrupted: interrupted.duration, sampleRate: manual.sampleRate }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
