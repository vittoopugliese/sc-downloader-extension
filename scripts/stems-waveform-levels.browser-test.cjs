// Exercise the actual stem canvas and playback with known output levels.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const { encodeWav } = await import('./stem-audio.mjs');
  const channels = [0, 1].map(() => Float32Array.from({ length: 44100 }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / 44100)));
  const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav(channels)).toString('base64')}`;
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
    await page.addInitScript(({ dataUrl }) => {
      globalThis.testSources = [];
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this);
        globalThis.testSources.push(source);
        return source;
      };
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Waveform levels', trimRange: { startMs: 0, endMs: 1000 } }
        : { success: true, instrument: { dataUrl } } } };
      globalThis.Worker = class {
        postMessage({ channels }) {
          this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: 0,
            outputs: [1, .25, .00001, 0].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 0);
        }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html?job=levels`);
    await page.evaluate(() => {
      globalThis.testAnalyzed = 0;
      const analyze = SCSpectralWaveform.analyze;
      SCSpectralWaveform.analyze = async (...args) => {
        const result = await analyze(...args);
        globalThis.testAnalyzed++;
        return result;
      };
    });
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelectorAll('.stem canvas').length === 4);
    // Wait for asynchronous spectral analysis on all five buffers.
    await page.waitForFunction(() => globalThis.testAnalyzed === 5);
    await page.locator('#play').click();
    await page.waitForFunction(() => globalThis.testSources.length === 5);
    const peaks = await page.evaluate(() => testSources.map(source => source.buffer.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)));
    const heights = await page.locator('#original-waveform canvas, .stem canvas').evaluateAll(canvases => canvases.map(canvas => {
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let rows = 0;
      for (let y = 0; y < height; y++) {
        let colored = 0;
        for (let x = Math.floor(width * .2); x < width * .8; x++) {
          const at = (y * width + x) * 4;
          if (Math.max(data[at], data[at + 1], data[at + 2]) > 50) colored++;
        }
        if (colored > width * .25) rows++;
      }
      return rows / height;
    }));
    console.log(JSON.stringify({ playbackPeaks: peaks, waveformHeightFractions: heights }));
    assert.ok(peaks[3] > 0 && peaks[3] < .00001, 'Near-silent output reaches playback unchanged');
    assert.equal(peaks[4], 0, 'Digital silence stays silent');
    assert.ok(heights[1] > .3, 'Audible stem has a visible waveform');
    assert.ok(heights[3] < .03, 'Near-silent stem must not be drawn as a loud waveform');
    assert.equal(heights[4], 0, 'Digital silence has no waveform');
    assert.ok(Math.abs(heights[2] / heights[1] - .25) < .06, 'Stem heights preserve relative PCM amplitude');
    console.log('Stem waveform levels passed.');
  } finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
