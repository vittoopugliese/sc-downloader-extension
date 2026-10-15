// Channel rack, piano roll and pattern clips with deterministic PCM and a fixture separation worker.
// Real audio playback and spectral analysis; no model download/inference here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { encodeWav } = await import('./stem-audio.mjs');
  const channels = [0, 1].map(() => Float32Array.from({ length: 44100 * 3 }, (_, i) => {
    const t = i / 44100, frequency = [70, 1000, 9000][Math.floor(t)];
    return Math.sin(2 * Math.PI * frequency * t) * (.3 + .2 * Math.sin(t * 17));
  }));
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav(channels)).toString('base64')}`;
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 2, locale: 'es-AR' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://i1.sndcdn.com/stems-fixture.jpg', route => route.fulfill({ path: path.join(root, 'assets/icons/player-toolkit.png'), contentType: 'image/png' }));
    await page.route('https://tbot.xyz/lumber/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lumberjack fixture</title>' }));
    await page.addInitScript(({ dataUrl }) => {
      globalThis.stemTestSources = [];
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this);
        const start = source.start.bind(source);
        source.start = (...args) => { source.testStart = args; start(...args); };
        globalThis.stemTestSources.push(source); return source;
      };
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Midnight sessions — selected loop', trimRange: { startMs: 12000, endMs: 15000 } }
        : { success: true, instrument: { dataUrl } } } };
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async request => ({ ...await send(request), ...(request.type === 'STEM_LOOP_INFO'
        ? { artist: 'Fixture artist', durationMs: 185000, artworkUrl: 'https://i1.sndcdn.com/stems-fixture.jpg' } : {}) });
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .1,
          outputs: [1, .7, .4, .2].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 30); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=fixture`);
    await require('./stem-instruments.browser-check.cjs')(page);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
