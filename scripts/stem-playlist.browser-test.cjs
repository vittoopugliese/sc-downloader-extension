// Playlist realtime engine in real Chromium: immediate playback, edits while
// playing, worker stretch cache and an export that matches the playback path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const rate = 44100, seconds = 2;
  const wav = Buffer.alloc(44 + rate * seconds * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(rate * seconds * 2, 40);
  for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), 44 + i * 2);
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1200, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // Count every source the playlist starts, to prove playback runs on clip nodes.
      window.playlistStarts = 0;
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = create.call(this), start = source.start.bind(source);
        source.start = (...args) => { window.playlistStarts++; start(...args); };
        return source;
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    const playlist = page.locator('#playlist');
    // Stems is the default view; the Playlist tab swaps the panel.
    assert.equal(await playlist.isVisible(), false);
    await page.locator('#tab-playlist').click();
    assert.equal(await page.locator('#tab-playlist').getAttribute('aria-selected'), 'true');
    assert.equal(await playlist.isVisible(), true);
    await playlist.locator('input[type=file]').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
    await playlist.locator('.pl-clip').first().waitFor();
    // Playback starts on the press: no full mix render before the first sound.
    const before = Date.now();
    await playlist.locator('.pl-play').click();
    await page.waitForFunction(() => document.querySelector('.pl-play').getAttribute('aria-pressed') === 'true' && window.playlistStarts > 0);
    assert.ok(Date.now() - before < 1500, 'playback starts immediately');
    const time = () => playlist.locator('.pl-time').textContent();
    const t0 = await time(); await page.waitForTimeout(300);
    assert.notEqual(await time(), t0, 'transport advances');
    // Pitch +12 in Stretch mode while playing: the clip stretches in the worker,
    // keeps its length, and playback keeps running.
    await playlist.locator('.pl-clip').first().click();
    const width = (await playlist.locator('.pl-clip').first().boundingBox()).width;
    // Shift + ArrowUp on the pitch knob is one octave.
    await playlist.getByRole('slider', { name: 'Pitch' }).press('Shift+ArrowUp');
    assert.equal(await playlist.getByRole('slider', { name: 'Pitch' }).getAttribute('aria-valuenow'), '12');
    await page.waitForFunction(() => !document.querySelector('.pl-clip.is-stretching'), null, { timeout: 15000 });
    assert.equal(await playlist.locator('.pl-play').getAttribute('aria-pressed'), 'true', 'still playing after the edit');
    assert.ok(Math.abs((await playlist.locator('.pl-clip').first().boundingBox()).width - width) < 1, 'stretch keeps the clip length');
    // Wheel zooms the timeline around the pointer, like the stem waveforms; Shift pans.
    const scroller = playlist.locator('.pl-scroll'), box = await scroller.boundingBox();
    await page.mouse.move(box.x + 400, box.y + 120);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction(clipWidth => document.querySelector('.pl-clip').getBoundingClientRect().width > clipWidth * 1.5, width);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift');
    await page.waitForFunction(() => document.querySelector('.pl-scroll').scrollLeft > 0);
    await playlist.getByRole('button', { name: 'Show the whole arrangement' }).click();
    // Track volume is a knob too.
    assert.equal(await playlist.getByRole('slider', { name: /^Volume / }).count(), 4);
    // Moving the clip while playing reschedules instead of stopping.
    const starts = await page.evaluate(() => window.playlistStarts);
    await playlist.locator('.pl-clip').first().press('ArrowRight');
    await page.waitForFunction(count => window.playlistStarts > count, starts);
    assert.equal(await playlist.locator('.pl-play').getAttribute('aria-pressed'), 'true');
    await playlist.locator('.pl-play').click();
    assert.equal(await playlist.locator('.pl-play').getAttribute('aria-pressed'), 'false');
    // Export uses the same clip scheduling and cached stretch as playback.
    const [download] = await Promise.all([page.waitForEvent('download'), playlist.getByLabel('Export playlist mix as WAV').click()]);
    const file = await download.path();
    const result = await page.evaluate(async bytes => {
      const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(new Uint8Array(bytes).buffer);
      const data = buffer.getChannelData(0), first = data.findIndex(v => Math.abs(v) > .01);
      let crossings = 0;
      for (let i = first + 22051; i < first + 66150; i++) if (data[i - 1] < 0 && data[i] >= 0) crossings++;
      return { duration: buffer.duration, first: first / buffer.sampleRate, frequency: crossings / 1 };
    }, [...fs.readFileSync(file)]);
    assert.ok(Math.abs(result.duration - 2.125) < .01, `export length ${result.duration}`);
    assert.ok(Math.abs(result.first - .125) < .01, `clip moved by one 1/16 step: ${result.first}`);
    assert.ok(Math.abs(result.frequency - 880) < 20, `exported pitch ${result.frequency}`);
    assert.deepEqual(errors, []);
    console.log('Playlist browser test passed.', result);
  } finally {
    await browser?.close(); server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
