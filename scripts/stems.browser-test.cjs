// Real ONNX inference in the loaded MV3 extension. SoundCloud audio/metadata are
// deterministic fixtures; no account or live track is needed for this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-results/stems');
  fs.mkdirSync(artifacts, { recursive: true });
  const model = process.env.STEM_MODEL_PATH || path.join(artifacts, 'htdemucs_fp16weights.onnx');
  assert.ok(fs.existsSync(model), 'Download the pinned model into test-results/stems or set STEM_MODEL_PATH (see docs/loop-stems.md).');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex'), 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a');
  const { encodeWav } = await import('./stem-audio.mjs');
  // A repeatable 2 s musical fixture: kick-like transients, bass and a chord.
  const frames = 88200;
  const channels = [0, 1].map(c => Float32Array.from({ length: frames }, (_, i) => {
    const t = i / 44100, beat = t % .5;
    const kick = Math.sin(2 * Math.PI * (55 * beat + 5 * (1 - Math.exp(-beat * 40)))) * Math.exp(-beat * 18) * .4;
    const bass = Math.sin(2 * Math.PI * 110 * t) * .13;
    const chord = [261.63, 329.63, 392].reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t + c * .2), 0) * .035;
    return (kick + bass + chord) * Math.min(1, t * 100, (2 - t) * 100);
  }));
  const wav = Buffer.from(encodeWav(channels));
  fs.writeFileSync(path.join(artifacts, 'input.wav'), wav);
  const fullAudio = Buffer.from(encodeWav(channels.map(channel => {
    const full = Float32Array.from({ length: 9 * 44100 }, (_, i) => .05 * Math.sin(2 * Math.PI * 1800 * i / 44100));
    full.set(channel, 3 * 44100);
    return full;
  })));
  // Stream the large model over HTTP instead of embedding 166 MB in a CDP
  // route.fulfill JSON message (which can disconnect Chromium).
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(model).size,
      'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(model).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, locale: 'es-AR', acceptDownloads: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'],
  });
  context.setDefaultTimeout(30000);
  let heartbeat;
  const errors = [];
  try {
    await context.route('https://**/*', route => {
      const url = route.request().url();
      if (url.includes('htdemucs_fp16weights.onnx')) return route.fulfill({ status: 302, headers: {
        location: `http://127.0.0.1:${server.address().port}/model.onnx`, 'access-control-allow-origin': '*',
      } });
      if (url.startsWith('https://api-v2.soundcloud.com/media/stem-test')) return route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ url: 'https://cf-media.sndcdn.com/stem-test.wav' }),
      });
      if (url === 'https://cf-media.sndcdn.com/stem-test.wav') return route.fulfill({ contentType: 'audio/wav',
        headers: { 'access-control-allow-origin': '*' }, body: fullAudio });
      if (url === 'https://soundcloud.com/artist/stem-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{background:#111}.playControls__elements{position:fixed;bottom:0;left:0;display:flex;width:100%;height:48px}</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>` });
      return route.abort();
    });
    const background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    background.on('console', item => { if (item.type() === 'error') console.log('[background]', item.text()); });
    const fixture = await context.newPage();
    await fixture.goto(`chrome-extension://${new URL(background.url()).host}/popup.html`);
    const fixtureUrl = await fixture.evaluate(base64 => URL.createObjectURL(new Blob([
      Uint8Array.from(atob(base64), character => character.charCodeAt(0)),
    ], { type: 'audio/wav' })), fullAudio.toString('base64'));
    await background.evaluate(fixtureUrl => {
      // Substitute SoundCloud metadata/network only. The renderer remains real:
      // resolve progressive media, offscreen decode, A-B trim and PCM transfer.
      requestTopFrameLoopTrack = async () => ({ title: 'Drums + bass + chord', artist: 'Fixture', id: 444, durationMs: 9000,
        streamUrl: 'https://api-v2.soundcloud.com/media/stem-test', streamProtocol: 'progressive', clientId: 'fixture-client' });
      const originalFetch = fetch;
      globalThis.fetch = (input, options) => String(input).includes('/media/stem-test')
        ? Promise.resolve(new Response(JSON.stringify({ url: fixtureUrl }))) : originalFetch(input, options);
      const render = BulkJobManager.renderLoopInstrument.bind(BulkJobManager);
      BulkJobManager.renderLoopInstrument = async (...args) => {
        globalThis.stemRenderArgs = args;
        const result = await render(...args);
        globalThis.stemRenderedAudio = result.instrument.dataUrl;
        return result;
      };
    }, fixtureUrl);
    const source = await context.newPage();
    await source.goto('https://soundcloud.com/artist/stem-test');
    await source.waitForFunction(() => document.documentElement.getAttribute('data-scdl-extension-record-worklet-url'));
    await source.evaluate(() => {
      document.addEventListener('scdl-looper:command', () => {
        const root = document.documentElement;
        const command = JSON.parse(root.getAttribute('data-scdl-looper-command') || '{}');
        if (command.type === 'state') root.setAttribute('data-scdl-looper-response', JSON.stringify({ id: command.id, success: true, state: {
          available: true, durationMs: 9000, currentTimeMs: 3000,
          loop: { active: true, enabled: true, trackIdentity: 'permalink:https://soundcloud.com/artist/stem-test', generation: 1, startMs: 3000, endMs: 5000, durationMs: 9000 },
        } }));
      });
      document.dispatchEvent(new Event('scdl:open-player-tools-panel'));
      document.dispatchEvent(new Event('scdl-loop-session:changed'));
    });
    const button = source.locator('#scdl-tempo-control .separate-stems');
    await button.waitFor();
    await source.waitForFunction(() => !document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.separate-stems').disabled);
    console.log('Selected loop is ready; opening Stems through the real content bridge.');
    const opened = context.waitForEvent('page', { predicate: async candidate => {
      try { await candidate.waitForURL('**/stems.html?job=*', { waitUntil: 'commit', timeout: 15000 }); return true; }
      catch { return false; }
    } }).catch(async error => {
      console.log(await source.locator('#scdl-tempo-control').innerText()); throw error;
    });
    await button.click();
    const page = await opened;
    console.log('Analyzer tab created:', page.url());
    console.log('Tabs:', await background.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url }))));
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => console.error('Analyzer renderer crashed.'));
    page.on('console', item => { if (item.type() === 'error') console.log('[page]', item.text()); });
    await page.waitForURL('**/stems.html?job=*', { timeout: 30000 }).catch(async error => {
      console.log('Tab URL:', page.url()); console.log(await source.locator('#scdl-tempo-control').innerText()); throw error;
    });
    await page.waitForFunction(() => !document.getElementById('separate').disabled || document.getElementById('status').classList.contains('error'), null, { timeout: 30000 }).catch(async error => {
      console.log('Page status:', await page.locator('#status').textContent(), errors); throw error;
    });
    assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), false, await page.locator('#status').textContent());
    assert.match(await page.locator('#range').textContent(), /3\.00.*5\.00/);
    await page.locator('#separate').click();
    heartbeat = setInterval(() => page.locator('#status').textContent().then(value => console.log(`[Stems] ${value}`)).catch(() => {}), 15000);
    await page.waitForFunction(() => document.querySelectorAll('.stem').length === 4 || document.getElementById('status').classList.contains('error'), null, { timeout: 900000 });
    assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), false, await page.locator('#status').textContent());
    clearInterval(heartbeat);
    const args = await background.evaluate(() => globalThis.stemRenderArgs);
    assert.deepEqual(args.slice(1, 4), [{ startMs: 3000, endMs: 5000 }, { rate: 1, preservePitch: false }, {}]);
    const actualFrames = Math.round(Number(await page.locator('#original-waveform .waveform').getAttribute('aria-valuemax')) * 44100);
    assert.ok(Math.abs(actualFrames - frames) <= 1, 'Browser resampling may round the boundary by one sample.');
    const renderedAudio = await background.evaluate(() => globalThis.stemRenderedAudio);
    const trimError = await page.evaluate(async ({ renderedAudio, expected }) => {
      const decoder = new OfflineAudioContext(2, 1, 44100);
      const buffers = await Promise.all([renderedAudio, expected].map(async url => decoder.decodeAudioData(await (await fetch(url)).arrayBuffer())));
      let squared = 0, count = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(buffers[0].length, buffers[1].length); i++) {
        squared += (buffers[0].getChannelData(c)[i] - buffers[1].getChannelData(c)[i]) ** 2; count++;
      }
      return Math.sqrt(squared / count);
    }, { renderedAudio, expected: `data:audio/wav;base64,${wav.toString('base64')}` });
    assert.ok(trimError < .006, `A-B must contain the selected music, not the tone outside it (RMSE ${trimError}).`);
    const stats = [];
    for (let index = 0; index < 4; index++) {
      const download = page.waitForEvent('download');
      await page.locator('.stem .download').nth(index).click();
      const file = await download;
      const destination = path.join(artifacts, file.suggestedFilename());
      await file.saveAs(destination);
      const bytes = fs.readFileSync(destination);
      assert.equal(bytes.readUInt32LE(24), 44100);
      assert.equal(bytes.readUInt16LE(22), 2);
      assert.equal(bytes.length, 44 + actualFrames * 8);
      let peak = 0, energy = 0;
      for (let at = 44; at < bytes.length; at += 4) {
        const value = bytes.readFloatLE(at); assert.ok(Number.isFinite(value));
        peak = Math.max(peak, Math.abs(value)); energy += value * value;
      }
      stats.push({ name: file.suggestedFilename(), peak, rms: Math.sqrt(energy / (actualFrames * 2)) });
    }
    assert.ok(stats[0].rms > .005 && stats[1].rms > .005, 'Real model must produce non-silent drum and bass stems.');
    assert.notEqual(stats[0].rms.toFixed(5), stats[1].rms.toFixed(5));
    await page.locator('#play').click();
    await page.waitForTimeout(250);
    await page.locator('#original').click();
    assert.equal(await page.locator('#original').getAttribute('aria-pressed'), 'true');
    await page.locator('.stem button').nth(1).click();
    assert.equal(await page.locator('#mix').getAttribute('aria-pressed'), 'true');
    await page.locator('#play').click();
    await page.screenshot({ path: path.join(artifacts, 'stems-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'stems-mobile.png'), fullPage: true });
    const completed = await page.locator('#status').textContent();
    await page.locator('#separate').click();
    await page.locator('#cancel').click();
    await page.waitForFunction(() => document.getElementById('cancel').hidden);
    assert.equal(await page.locator('.stem').count(), 4, 'Cancelling a retry preserves the previous stems.');
    assert.equal(await page.locator('#separate').isEnabled(), true);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'verification.json'), JSON.stringify({ completed, actualFrames, trimError, stats, errors }, null, 2));
    console.log(JSON.stringify({ completed, actualFrames, trimError, stats }, null, 2));
    console.log('Stems MV3: selected-loop bridge, pinned model SHA-256, real WASM inference, four WAVs, playback controls, cancellation and responsive layout passed.');
  } finally { clearInterval(heartbeat); await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
