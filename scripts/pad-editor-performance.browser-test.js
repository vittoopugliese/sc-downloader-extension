const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const rate = 48000;
  const wav = Buffer.alloc(44 + rate * 8 * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let frame = 0; frame < rate * 8; frame++) for (let channel = 0; channel < 2; channel++) {
    wav.writeInt16LE(Math.sin(frame / rate * 440 * Math.PI * 2) * 12000, 44 + frame * 4 + channel * 2);
  }
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('.wav')) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); }
    else res.end('<!doctype html><html lang="en"><style>.playControls__elements{position:fixed;bottom:0;display:flex;width:100%;height:48px}</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-scdl-extension-drum-samples-url', location.origin + '/');
      window.padRecords = Array.from({ length: 8 }, (_, index) => ({ index, name: `Slice ${index}`,
        updatedAt: 1, audioId: 'shared-source', sourceDurationMs: 8000,
        trim: { startMs: index * 1000, endMs: (index + 1) * 1000 } }));
      window.padRequests = [];
      window.pendingTrims = [];
      window.addEventListener('message', event => {
        const data = event.data;
        if (data?.source !== 'scdl-pad-main') return;
        padRequests.push(data);
        const result = { success: true };
        if (data.action === 'list') result.pads = padRecords;
        if (data.action === 'get') result.pad = { ...padRecords[data.index], dataUrl: location.origin + '/source.wav' };
        const reply = () => {
          if (data.action === 'trim') padRecords[data.index].trim = data.trim;
          window.postMessage({ source: 'scdl-pad-content', id: data.id, result }, location.origin);
        };
        if (data.action === 'trim' && window.holdTrims) pendingTrims.push(reply);
        else reply();
      });
    });
    for (const file of ['tempo-control-core.js', 'looper-core.js', 'sampler-core.js', 'parametric-eq.js',
      'audio-effects-core.js', 'player-tools-collapsible.js', 'parametric-eq-ui.js', 'tempo-control-main.js']) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    await page.evaluate(() => document.dispatchEvent(new Event('scdl:open-player-tools-panel')));
    const host = page.locator('#scdl-tempo-control');
    await host.locator('.sampler-toggle').click();
    await host.locator('.drum-pad[title^="Slice 0"]').waitFor();
    const metrics = await page.evaluate(async () => {
      const root = document.querySelector('#scdl-tempo-control').shadowRoot;
      const pads = [...root.querySelectorAll('.drum-pad')];
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const settle = async () => { await frame(); await frame(); };
      let triggerAt, started, stats, lastStart, lastSource, lastStops;
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (stats) stats.latencies.push(performance.now() - triggerAt);
        lastStart = args;
        lastSource = this;
        lastStops = [];
        originalStart.apply(this, args);
        started?.();
      };
      const originalStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        if (this === lastSource) lastStops.push(args[0]);
        return originalStop.apply(this, args);
      };
      const ctx = root.querySelector('.waveform-canvas').getContext('2d');
      const fill = ctx.fillRect;
      ctx.fillRect = function (...args) { if (stats) stats.paintCalls++; return fill.apply(this, args); };
      for (const knob of root.querySelectorAll('.instrument-controls button')) {
        if (!knob.renderControl) continue;
        const render = knob.renderControl;
        knob.renderControl = () => { if (stats) stats.controlRenders++; render(); };
      }
      const hit = async index => {
        const played = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Pad did not start within five seconds')), 5000);
          started = () => { clearTimeout(timeout); resolve(); };
        });
        const key = pads[index].querySelector('.drum-key').textContent.toLowerCase();
        triggerAt = performance.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        await played;
        await settle();
      };
      for (let i = 0; i < 8; i++) await hit(i);
      const measure = async () => {
        stats = { latencies: [], paintCalls: 0, controlRenders: 0 };
        const requests = padRequests.length;
        for (let i = 0; i < 32; i++) await hit(i % 8);
        const result = { ...stats, requests: padRequests.length - requests };
        stats = null;
        return result;
      };
      const normal = await measure();
      for (let i = 0; i < 8; i++) {
        pads[i].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        const label = 'Pad ' + pads[i].querySelector('.drum-key').textContent + ' B';
        while (root.querySelector('.waveform-end').getAttribute('aria-label') !== label) await frame();
      }
      const editing = await measure();
      pads[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await settle();
      window.holdTrims = true;
      const marker = root.querySelector('.waveform-start');
      for (let i = 0; i < 6; i++) marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const nextHit = hit(0);
      const immediate = await Promise.race([nextHit.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 250))]);
      const offset = lastStart?.[1];
      // More moves while the first write is in flight must replace the pending
      // range, and a rapid switch away/back must retain those unsaved bounds.
      for (let i = 0; i < 2; i++) marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      root.querySelector('.waveform-end').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      if (immediate) { await hit(1); await hit(0); }
      const newestOffset = lastStart?.[1];
      const latestEndApplied = lastStops.some(when => Math.abs(when - lastStart[0] - .1) < .002);
      window.holdTrims = false;
      pendingTrims.splice(0).forEach(reply => reply());
      await nextHit;
      await settle();
      return { normal, editing, trim: { immediate, offset, newestOffset, latestEndApplied,
        savedStart: padRecords[0].trim.startMs, savedEnd: padRecords[0].trim.endMs,
        writes: padRequests.filter(request => request.action === 'trim').length } };
    });
    for (const [mode, result] of Object.entries(metrics)) {
      if (mode === 'trim') { console.log('trim:', result); continue; }
      const sorted = [...result.latencies].sort((a, b) => a - b);
      console.log(`${mode}: median=${sorted[16].toFixed(2)}ms p95=${sorted[30].toFixed(2)}ms paints=${result.paintCalls} controls=${result.controlRenders} requests=${result.requests}`);
    }
    assert.deepEqual(errors, []);
    assert.ok(metrics.trim.immediate, 'The very next hit must play the new bounds while saving is still pending');
    assert.equal(metrics.trim.offset, .6, 'The next hit must use the latest start, not an older queued edit');
    assert.equal(metrics.trim.newestOffset, .8, 'Switching pads must preserve unsaved live bounds');
    assert.equal(metrics.trim.savedStart, 800, 'Persistence must eventually store the newest range');
    assert.equal(metrics.trim.savedEnd, 900);
    assert.ok(metrics.trim.latestEndApplied, 'The next hit must also stop at the unsaved end boundary');
    assert.ok(metrics.trim.writes <= 2, 'Pointer moves must not create a backlog of obsolete writes');
    assert.equal(metrics.editing.requests, 0, 'Warm pad switching must not request audio or metadata');
    assert.equal(metrics.editing.paintCalls, 0, 'Changing only slice bounds must reuse the painted waveform');
    assert.ok(metrics.editing.controlRenders <= metrics.normal.controlRenders, 'Editing must not duplicate sampler control rendering');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
