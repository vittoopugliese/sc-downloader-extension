// Live stretch: a stretched clip sounds at once, at its own pitch, before its render lands,
// and keeps sounding when the render takes over. A tempo change while playing is heard at once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    const result = await page.evaluate(async () => {
      const { createStretchCache, createPlaylistEngine } = await import('./scripts/stem-playlist-audio.mjs');
      const context = new AudioContext({ sampleRate: 44100 }); await context.resume();
      const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.connect(context.destination);
      // Two minutes of a 440 Hz tone: its render takes far longer than the first check.
      const buffer = new AudioBuffer({ numberOfChannels: 2, length: 44100 * 120, sampleRate: 44100 });
      for (let c = 0; c < 2; c++) { const data = buffer.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * .5; }
      const cache = createStretchCache(), assets = new Map([['a', { id: 'a', buffer, version: 0 }]]), problems = [];
      const engine = createPlaylistEngine({ context, output: analyser, cache, assets: () => assets, onError: error => problems.push(error.message) });
      await new Promise(resolve => setTimeout(resolve, 800));
      const clip = { id: 'c', asset: 'a', track: 't', at: 0, in: 0, out: 120, pitch: 0, cents: 0, speed: .8, keepLength: true, gain: 1, mute: false, reverse: false, fadeIn: 0, fadeOut: 0 };
      const state = { version: 1, bpm: 120, tracks: [{ id: 't', name: 'T', gain: 1, mute: false, solo: false }], clips: [clip] };
      const level = () => { const data = new Float32Array(2048); analyser.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
      const peak = () => { const data = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(data); let best = 1; for (let i = 1; i < data.length; i++) if (data[i] > data[best]) best = i; return best * 44100 / 2048; };
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      engine.play(state, 0, { rate: 1, loop: null });
      await wait(300);
      const early = { level: level(), peak: peak(), rendered: cache.has(clip, assets.get('a')) };
      // A new speed while playing (a tempo change on a locked clip) is heard at once too.
      const faster = { ...state, clips: [{ ...clip, speed: 1.25 }] };
      engine.update(faster, { rate: 1, loop: null });
      await wait(300);
      const changed = { level: level(), peak: peak(), rendered: cache.has(faster.clips[0], assets.get('a')) };
      for (let waited = 0; !cache.has(faster.clips[0], assets.get('a')) && waited < 30000; waited += 200) await wait(200);
      await wait(400);
      const late = { level: level(), peak: peak() };
      engine.dispose(); await context.close();
      return { early, changed, late, problems };
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.early.rendered, false, 'The first check runs before the render lands');
    assert.ok(result.early.level > .3, `The clip sounds before its render: ${result.early.level}`);
    assert.ok(Math.abs(result.early.peak - 440) < 25, `Live stretch keeps the pitch: ${result.early.peak} Hz`);
    assert.equal(result.changed.rendered, false);
    assert.ok(result.changed.level > .3 && Math.abs(result.changed.peak - 440) < 25, `A speed change is heard at once, at the same pitch: ${JSON.stringify(result.changed)}`);
    assert.ok(result.late.level > .3 && Math.abs(result.late.peak - 440) < 25, `The render takes over without a gap: ${JSON.stringify(result.late)}`);
    assert.deepEqual(errors, []);
    console.log('Live stretch browser test passed.', result);
  } finally {
    await browser?.close(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
