// stems.html?recording=<id> loads a Likes Explorer take as the Original without separating it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  require('./record-core.js');
  const frames = 48000 * 2;
  const channels = [0, 1].map(channel => Float32Array.from({ length: frames }, (_, i) => Math.sin(i / (channel ? 30 : 20)) * .4));
  const wav = Buffer.from(await SCRecord.encodeWav([channels], frames, 48000).arrayBuffer()).toString('base64');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'es-AR' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const audioUrl = `https://scdl-recordings.invalid/recording/${id}`;
    await page.goto(`${origin}/assets/stems.css`);
    await page.evaluate(async ({ wav, audioUrl }) => {
      const bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0));
      await (await caches.open('scdl-recording-jobs')).put(audioUrl, new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } }));
    }, { wav, audioUrl });
    await page.addInitScript(({ id, audioUrl }) => {
      globalThis.stemRequests = []; globalThis.workerRuns = 0;
      globalThis.chrome = { runtime: { sendMessage: async request => {
        stemRequests.push(request.type);
        if (request.type === 'STEM_RECORDING_INFO' && request.recordingId === id) {
          return { success: true, title: 'Set largo (grabación)', artist: 'DJ Fixture', artworkUrl: '', trackUrl: 'https://soundcloud.com/dj/set', durationMs: 2000, audioUrl };
        }
        return { success: false, error: 'unexpected' };
      } } };
      globalThis.Worker = class { postMessage() { workerRuns++; } terminate() {} };
    }, { id, audioUrl });
    await page.goto(`${origin}/stems.html?recording=${id}`);
    await page.waitForFunction(() => !document.querySelector('#separate').disabled);
    assert.equal(await page.locator('#stem-presets .row-menu-value').textContent(), 'Set largo (grabación)');
    assert.match(await page.locator('#track').getAttribute('data-scdl-tooltip'), /Grabación del Likes Explorer/);
    assert.match(await page.locator('#track').getAttribute('data-scdl-tooltip'), /A 0,00 s → B 2,00 s/);
    assert.equal(await page.locator('#audition').evaluate(node => node.hidden), false, 'the audition area is revealed as for imported audio');
    assert.equal(await page.locator('#extract-dialog').isVisible(), true);
    assert.ok(await page.locator('[data-stem="original"]').count() > 0, 'the take is the Original track');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => workerRuns), 0, 'loading never starts the separation');
    assert.deepEqual(await page.evaluate(() => stemRequests), ['STEM_RECORDING_INFO'], 'no loop render is requested');
    assert.deepEqual(errors, []);
    console.log('Stems recording: Likes Explorer take loads as the Original, ready to separate, without starting the separation.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
