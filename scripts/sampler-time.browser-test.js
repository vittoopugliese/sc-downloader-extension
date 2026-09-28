// Exercise the installed extension, including MAIN -> content -> worker ->
// offscreen, the packaged WASM engine, and the actual buffer played by each pad.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

function toneWav() {
  const rate = 48000;
  const bytes = Buffer.alloc(44 + rate * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(rate * 4, 40);
  for (let i = 0; i < rate; i++) {
    for (let channel = 0; channel < 2; channel++) {
      bytes.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * (channel ? 660 : 440) * i / rate)),
        44 + i * 4 + channel * 2);
    }
  }
  return bytes;
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    await context.route('https://**/*', route => route.request().url() === 'https://soundcloud.com/artist/time-test'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <style>.playControls__elements{position:fixed;bottom:0;left:0;display:flex;width:100%;height:48px}</style>
        <div class="playControls__elements"><div class="playControls__soundBadge"></div></div>` })
      : route.abort());
    const page = await context.newPage();
    await page.goto('https://soundcloud.com/artist/time-test');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-scdl-extension-drum-samples-url'));
    await page.evaluate(() => {
      window.played = [];
      window.timeRequests = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        played.push(this);
        return start.apply(this, args);
      };
      window.addEventListener('message', event => {
        if (event.data?.source === 'scdl-pad-main' && event.data.action === 'get') timeRequests++;
      });
      document.dispatchEvent(new Event('scdl:open-player-tools-panel'));
    });
    const host = page.locator('#scdl-tempo-control');
    await host.locator('.sampler-toggle').click();
    const pad = host.locator('.drum-pad').nth(0);
    const time = host.locator('[data-pad-control="timePercent"]');
    const setTime = value => time.evaluate((knob, value) => {
      const current = Number(knob.getAttribute('aria-valuenow'));
      for (let i = 0; i < Math.abs(value - current); i++) {
        knob.dispatchEvent(new KeyboardEvent('keydown', { key: value > current ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
      }
    }, value);
    const hit = async () => {
      const count = await page.evaluate(() => played.length);
      await pad.click();
      await page.waitForFunction(count => played.length === count + 1, count);
      return page.evaluate(() => {
        const source = played.at(-1);
        const buffer = source.buffer;
        const frequencies = Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
          const samples = buffer.getChannelData(channel);
          const crossings = [];
          for (let i = Math.floor(samples.length * .25); i < samples.length * .75; i++) {
            if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i);
          }
          return (crossings.length - 1) * buffer.sampleRate / (crossings.at(-1) - crossings[0]);
        });
        return { duration: buffer.duration, frequencies, rate: source.playbackRate.value };
      });
    };
    const original = await hit();
    await setTime(200);
    const stretchedDefault = await hit();
    assert.ok(Math.abs(stretchedDefault.duration / original.duration - 2) < .005, 'Default pads stretch too');
    assert.equal(stretchedDefault.rate, 1);

    await host.locator('.drum-file').nth(0).setInputFiles({ name: 'Stereo tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await host.locator('.drum-pad[title^="Stereo tone ·"]').waitFor();
    for (const percent of [200, 50, 25, 400, 137]) {
      await setTime(percent);
      const result = await hit();
      assert.ok(Math.abs(result.duration - percent / 100) < .005, `${percent}% duration: ${result.duration}`);
      result.frequencies.forEach((hz, channel) => assert.ok(Math.abs(hz - (channel ? 660 : 440)) < 12,
        `${percent}% channel ${channel} must keep its tone, got ${hz} Hz`));
      assert.equal(result.rate, 1, 'TIME must not change source playbackRate');
    }
    const requests = await page.evaluate(() => timeRequests);
    await hit();
    assert.equal(await page.evaluate(() => timeRequests), requests, 'Repeated hits reuse prepared audio');
    assert.equal(await page.evaluate(() => played.at(-1).buffer === played.at(-2).buffer), true);
    await host.locator('[data-pad-control="pitchSemitones"]').press('End');
    assert.equal((await hit()).rate, 2, 'PITCH remains independently adjustable');
    assert.equal(await time.getAttribute('aria-valuenow'), '137');
    await host.locator('[data-pad-control="pitchSemitones"]').dblclick();
    await time.dblclick();
    assert.ok(Math.abs((await hit()).duration - 1) < .001, 'Reset reloads the unmodified original');

    // Hold the first prepared buffer at the decode boundary while the user edits TIME.
    await page.evaluate(() => {
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = async function (...args) {
        AudioContext.prototype.decodeAudioData = decode;
        const buffer = await decode.apply(this, args);
        await new Promise(resolve => { window.releaseTimeDecode = resolve; });
        return buffer;
      };
    });
    await setTime(200);
    const before = await page.evaluate(() => played.length);
    await pad.click();
    await page.waitForFunction(() => window.releaseTimeDecode);
    await setTime(50);
    assert.ok(Math.abs((await hit()).duration - .5) < .001);
    await page.evaluate(() => releaseTimeDecode());
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => played.length), before + 1, 'An obsolete preparation must never start a note');
    assert.ok(Math.abs((await hit()).duration - .5) < .001, 'An obsolete preparation must not replace the cache');

    for (const invalid of [0, 401, 50.5, '200']) {
      const result = await page.evaluate(timePercent => new Promise(resolve => {
        const id = `time_test_${crypto.randomUUID()}`;
        const listener = event => {
          if (event.data?.source !== 'scdl-pad-content' || event.data.id !== id) return;
          window.removeEventListener('message', listener);
          resolve(event.data.result);
        };
        window.addEventListener('message', listener);
        window.postMessage({ source: 'scdl-pad-main', action: 'get', id, index: 0, timePercent }, location.origin);
      }), invalid);
      assert.equal(result.success, false, 'Invalid TIME settings must be rejected');
    }
    console.log('Sampler TIME passed: installed bridge, default/custom samples, stereo pitch, duration, cache, reset, separate PITCH and stale renders.');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
