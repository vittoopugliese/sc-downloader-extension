const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 260 }, deviceScaleFactor: 2 });
    await page.setContent('<style>body{background:#171a1e;color:#ddd;font:14px sans-serif;padding:24px}canvas{display:block;width:660px;height:110px;margin:18px 0}span{margin-right:45px}</style><b>Waveform · frequency analysis</b><canvas></canvas><span style="color:#f57777">Bass · 60 Hz</span><span style="color:#8cdd82">Mids · 1 kHz</span><span style="color:#8da9fa">Treble · 10 kHz</span>');
    await page.addScriptTag({ path: path.join(__dirname, 'spectral-waveform.js') });
    const source = fs.readFileSync(path.join(__dirname, 'tempo-control-main.js'), 'utf8');
    const draw = source.slice(source.indexOf('  function drawWaveform()'), source.indexOf('  function renderWaveformPlayhead()'));
    const result = await page.evaluate(async draw => {
      const sampleRate = 48000;
      const pcm = Float32Array.from({ length: sampleRate * 3 }, (_, i) => {
        const frequency = [60, 1000, 10000][Math.floor(i / sampleRate)];
        return (.35 + .4 * Math.abs(Math.sin(i / sampleRate * 13))) * Math.sin(2 * Math.PI * frequency * i / sampleRate);
      });
      const spectrum = await SCSpectralWaveform.analyze({ sampleRate, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm });
      const canvas = document.querySelector('canvas');
      const render = new Function('spectrum', 'canvas', 'selection', 'zoom', `
        const ui = { waveformCanvas: canvas, panel: { hidden: false } };
        const waveformCollapsed = false, waveformRevision = 1, waveformSamples = [];
        const waveformSpectrum = spectrum, waveformDrawPreview = null;
        let waveformStaticKey = '';
        const loopState = { durationMs: 3000, ...selection };
        const visibleWaveformWindow = () => zoom || ({ startMs: 0, endMs: 3000 });
        const loopPercentInWindow = (time, range) => (time - range.startMs) / (range.endMs - range.startMs) * 100;
        ${draw}
        drawWaveform();
      `);
      const read = x => Array.from(canvas.getContext('2d').getImageData(Math.floor(canvas.width * x), canvas.height / 2, 1, 1).data).slice(0, 3);
      render(spectrum, canvas, {});
      const colors = [.15, .5, .85].map(read);
      render(spectrum, canvas, { startMs: 0, endMs: 3000 });
      const selected = [.15, .5, .85].map(read);
      render(spectrum, canvas, {}, { startMs: 1000, endMs: 2000 });
      const zoomed = read(.5);
      render(spectrum, canvas, {});
      return { colors, selected, zoomed, width: canvas.width };
    }, draw);
    result.colors.forEach((rgb, band) => assert.equal(rgb.indexOf(Math.max(...rgb)), band));
    assert.deepEqual(result.selected, result.colors, 'Loop selection preserves frequency colors');
    assert.equal(result.zoomed.indexOf(Math.max(...result.zoomed)), 1, 'Zoom uses the correct source interval');
    assert.equal(result.width, 1320, 'Waveform uses physical pixels on high-DPI displays');
    fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'spectral-waveform.png') });
    console.log('Spectral waveform browser rendering passed: RGB bands, selection, zoom and HiDPI.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
