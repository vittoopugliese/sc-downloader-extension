// Real Web Audio allocation/timing probe. --baseline compares the HEAD implementation.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<audio></audio>');
    await page.evaluate(async bytes => {
      const audio = document.querySelector('audio');
      const ready = new Promise(resolve => { audio.onloadedmetadata = resolve; });
      audio.src = `data:audio/wav;base64,${bytes}`;
      await ready;
    }, fs.readFileSync(path.join(__dirname, '../assets/drums/hat1.wav')).toString('base64'));
    const baseline = process.argv.includes('--baseline');
    await page.addScriptTag({ content: baseline
      ? execFileSync('git', ['show', 'HEAD:scripts/audio-effects-core.js'], { encoding: 'utf8' })
      : fs.readFileSync(path.join(__dirname, 'audio-effects-core.js'), 'utf8') });
    console.log(JSON.stringify(await page.evaluate(() => {
      const effects = SCTempoEffects.create({ getActiveAudio: () => document.querySelector('audio') });
      effects.set('delay', 10);
      if (!effects.snapshot().initialized) throw new Error('Graph initialization failed');
      effects.setCharacter('reverbDecay', 12);
      let bytes = 0, count = 0;
      const original = AudioContext.prototype.createBuffer;
      AudioContext.prototype.createBuffer = function (channels, frames, rate) {
        bytes += channels * frames * 4; count++;
        return original.call(this, channels, frames, rate);
      };
      const start = performance.now();
      for (let i = 0; i < 30; i++) effects.setCharacter('delayTime', 200 + i);
      return { averageMs: (performance.now() - start) / 30, buffers: count, allocatedMiB: bytes / 1024 ** 2 };
    })));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
