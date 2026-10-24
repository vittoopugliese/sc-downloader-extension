// Real Web Audio evidence for isolated channel inserts, export tails and automation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    if (req.url === '/audio-test') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script src="/scripts/parametric-eq.js"></script><script src="/scripts/audio-effects-core.js"></script>'); return;
    }
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/audio-test`);
    const measured = await page.evaluate(async () => {
      const { renderArrangement, createPlaylistEngine } = await import('./scripts/stem-playlist-audio.mjs');
      const { createChannelFx } = await import('./scripts/stem-channel-fx.mjs');
      const { newClip } = await import('./scripts/stem-playlist-core.mjs');
      const rms = (buffer, channel, from, to) => {
        const data = buffer.getChannelData(channel), a = Math.round(from * buffer.sampleRate), b = Math.min(data.length, Math.round(to * buffer.sampleRate));
        let sum = 0; for (let i = a; i < b; i++) sum += data[i] ** 2; return Math.sqrt(sum / Math.max(1, b - a));
      };
      const signal = (side, continuous = false) => {
        const buffer = new AudioBuffer({ numberOfChannels: 2, length: 44100, sampleRate: 44100 });
        for (let i = 0; i < (continuous ? 44100 : 4410); i++) buffer.getChannelData(side)[i] = .08 * Math.sin(2 * Math.PI * 440 * i / 44100);
        return buffer;
      };
      const a = { id: 'a', buffer: signal(0) }, b = { id: 'b', buffer: signal(1) }, assets = new Map([['a', a], ['b', b]]);
      const state = { version: 1, bpm: 120, tracks: [
        { id: 'left', name: 'Left', gain: 1, mute: false, solo: false, fx: { delay: 100 } },
        { id: 'right', name: 'Right', gain: 1, mute: false, solo: false },
      ], clips: [newClip(a, 'left'), newClip(b, 'right')], automation: [] };
      const cache = { has: () => true, retain() {}, busy: () => 0 };
      const summary = buffer => ({ duration: buffer.duration, echoLeft: rms(buffer, 0, .27, .32), echoRight: rms(buffer, 1, .27, .32), dry: rms(buffer, 0, .025, .075) });
      const wet = summary(await renderArrangement(state, assets, cache));
      state.tracks[0].fx.bypassed = true;
      const dry = summary(await renderArrangement(state, assets, cache));
      state.tracks[0].fx = { delay: 0 };
      state.automation = [{ id: 'echo', track: 'left', at: 0, duration: 1, target: { track: 'left', param: 'fx.delay' }, points: [
        { at: 0, value: 0, curve: 'linear' }, { at: .2, value: 100, curve: 'hold' }, { at: 1, value: 100, curve: 'hold' },
      ] }];
      const animated = summary(await renderArrangement(state, assets, cache));
      const context = new OfflineAudioContext(2, 44100 * 2, 44100);
      const engine = createPlaylistEngine({ context, output: context.destination, assets: () => assets, cache, onError: error => { throw error; } });
      engine.play(state, 0, { rate: 1 });
      const live = await context.startRendering(); engine.dispose();
      const liveEcho = rms(live, 0, .3, .35);
      // A dry channel allocates no controller. Starting an audition and returning
      // to bypass keeps a single unity route, even after repeated FX edits.
      const directContext = new OfflineAudioContext(2, 44100, 44100);
      const insert = createChannelFx({ context: directContext, output: directContext.destination });
      const initiallyLazy = !insert.snapshot().initialized;
      insert.apply({ delay: 100 }); insert.apply({ delay: 100, bypassed: true });
      const bypassLazy = !insert.snapshot().initialized;
      const source = directContext.createBufferSource(); source.buffer = signal(0, true); source.connect(insert.input); source.start();
      const audition = await directContext.startRendering(); insert.dispose();
      state.automation = [{ id: 'fade', track: 'left', at: 0, duration: 1, target: { track: 'left', param: 'gain' }, points: [{ at: 0, value: 0, curve: 'linear' }, { at: 1, value: 1, curve: 'linear' }] }];
      a.buffer = signal(0, true);
      const volume = await renderArrangement(state, assets, cache);
      state.automation = []; state.clips[0].normalizationGain = 5;
      const normalized = await renderArrangement(state, assets, cache, { normalize: false });
      // Multi-channel rack patterns bake each source channel's inserts before mixing.
      const { createInstruments } = await import('./scripts/stem-instruments.mjs');
      const instrumentContext = new AudioContext();
      const rackTracks = [{ key: 'left', name: 'Left', buffer: signal(0) }, { key: 'right', name: 'Right', buffer: signal(1) }];
      let patternAssets = [];
      const rack = createInstruments({
        playlist: { bpm: () => 120, pause() {}, setPatterns: list => { patternAssets = list; }, trackEq: () => null, trackFx: key => key === 'left' ? { delay: 100 } : null },
        tracks: () => rackTracks,
        audio: async () => ({ context: instrumentContext, output: instrumentContext.destination }), rate: () => 1,
      });
      rack.restore({ instruments: { left: { mode: 'oneShot' }, right: { mode: 'oneShot' } },
        patterns: [{ id: 'stereo-pattern', track: 'left', name: 'Stereo', bars: 1, hits: [1], channels: { right: { hits: [1] } } }] });
      rack.focusPattern('stereo-pattern'); await rack.play();
      const patternBuffer = rack.focused().pattern;
      // Publishing a rendered buffer is normally done by the scheduled sync pass.
      rack.sync();
      await new Promise(resolve => setTimeout(resolve, 100));
      const rackAudio = patternAssets.find(asset => asset.id === `pattern:${patternBuffer.id}`).buffer;
      const rackEcho = [rms(rackAudio, 0, .27, .32), rms(rackAudio, 1, .27, .32)];
      rack.dispose(); await instrumentContext.close();
      return { wet, dry, animated, liveEcho, initiallyLazy, bypassLazy, auditionDry: rms(audition, 0, .1, .2),
        volumeEarly: rms(volume, 0, .05, .1), volumeLate: rms(volume, 0, .8, .9), normalized: rms(normalized, 0, .1, .2), rackEcho };
    });
    assert.ok(measured.wet.echoLeft > .02 && measured.wet.echoRight < 1e-6, `FX stay on their channel: ${JSON.stringify(measured)}`);
    assert.ok(measured.wet.duration > 1 && measured.dry.duration === 1, 'Channel effects include tails; bypass has no tail');
    assert.ok(measured.dry.echoLeft < 1e-6 && measured.animated.echoLeft > .02 && measured.liveEcho > .02, 'Automated zero-baseline echo reaches export and playback');
    assert.ok(measured.initiallyLazy && measured.bypassLazy, 'Inactive channel effects allocate no DSP');
    assert.ok(Math.abs(measured.auditionDry - .08 / Math.sqrt(2)) < .0001, 'Audition bypass has exactly unity gain');
    assert.ok(measured.volumeLate > measured.volumeEarly * 8, 'Playlist volume automation changes rendered audio');
    assert.ok(Math.abs(measured.normalized - .4 / Math.sqrt(2)) < .001, 'Normalization gain reaches the rendered audio');
    assert.ok(measured.rackEcho[0] > .01 && measured.rackEcho[1] < 1e-6, `Multi-channel patterns keep source FX isolated: ${measured.rackEcho}`);
    const { encodeWav } = await import('./stem-audio.mjs');
    const pcm = Float32Array.from({ length: 44100 }, (_, i) => i < 4410 ? .08 * Math.sin(2 * Math.PI * 440 * i / 44100) : 0);
    const dataUrl = `data:audio/wav;base64,${Buffer.from(encodeWav([pcm, pcm])).toString('base64')}`;
    await page.addInitScript(({ dataUrl }) => {
      globalThis.chrome = { runtime: { sendMessage: async ({ type }) => type === 'STEM_LOOP_INFO'
        ? { success: true, title: 'Channel FX fixture', trimRange: { startMs: 0, endMs: 1000 } }
        : { success: true, instrument: { dataUrl } } } };
      globalThis.Worker = class {
        postMessage({ channels }) { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .01,
          outputs: [1, 0, 0, 0].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), 20); }
        terminate() { clearTimeout(this.timer); }
      };
    }, { dataUrl });
    await page.goto(`${origin}/stems.html?job=channel-fx`);
    await page.locator('#separate:not(:disabled)').click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    await page.locator('.pl-stem-head[data-stem=drums] .stem-more').click();
    await page.getByRole('menuitem', { name: 'Channel FX', exact: true }).click();
    const fx = page.locator('#stem-fx'), target = fx.getByLabel('FX channel');
    const knob = key => fx.locator(`[data-fx-setting="${key}"]`);
    assert.equal(await target.inputValue(), 'drums');
    await knob('delay').focus(); await page.keyboard.press('End');
    await knob('saturationDrive').focus(); await page.keyboard.press('ArrowUp');
    await target.selectOption('master'); assert.equal(await knob('delay').getAttribute('aria-valuenow'), '0', 'Channel edits leave master untouched');
    await target.selectOption('vocals'); assert.equal(await knob('delay').getAttribute('aria-valuenow'), '0', 'Channel edits leave other stems untouched');
    await target.selectOption('drums'); assert.equal(await knob('delay').getAttribute('aria-valuenow'), '100');
    await page.locator('#save-project').click(); await page.locator('#save-confirm').click();
    await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
    const id = await page.locator('#stem-presets').evaluate(node => node.value);
    await page.reload(); await page.locator('#extract-dialog[open]').waitFor(); await page.keyboard.press('Escape');
    await page.locator('#stem-presets:not(:disabled)').click();
    await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
    await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
    if (!(await fx.isVisible())) await page.keyboard.press('F4');
    await target.selectOption('drums');
    assert.equal(await knob('delay').getAttribute('aria-valuenow'), '100', 'Channel FX persist in the saved project');
    assert.equal(await knob('saturationDrive').getAttribute('aria-valuenow'), '26', 'Character settings persist per channel');
    await knob('delay').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create automation clip', exact: true }).click();
    await page.locator('.pl-automation-clip').first().waitFor();
    assert.equal(await target.locator('option').count(), 7, 'Automation lanes are not audio insert targets');
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await fx.screenshot({ path: path.join(artifacts, 'channel-fx.png') });
    assert.deepEqual(errors, []);
    console.log('Channel FX, realtime/export automation and normalization audio test passed.', measured);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
