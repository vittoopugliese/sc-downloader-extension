const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    await context.route('https://**/*', route => route.request().url() === 'https://soundcloud.com/artist/pad-editor'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es">
        <style>.playControls__elements{position:fixed;bottom:0;display:flex;width:100%;height:48px}</style>
        <div class="playControls__elements"><div class="playControls__soundBadge"></div></div></html>` })
      : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://soundcloud.com/artist/pad-editor');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-scdl-extension-drum-samples-url'));
    const setup = async () => page.evaluate(() => {
      window.played = [];
      window.commands = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        played.push(this);
        return start.apply(this, args);
      };
      document.documentElement.addEventListener('scdl-looper:command', () => {
        const command = JSON.parse(document.documentElement.getAttribute('data-scdl-looper-command'));
        if (!command) return;
        commands.push(command.type);
        document.documentElement.setAttribute('data-scdl-looper-response', JSON.stringify({ id: command.id, ok: true,
          state: { available: true, durationMs: 20000, currentTimeMs: 6000,
            loop: { active: true, enabled: true, startMs: 5000, endMs: 9000, durationMs: 20000,
              trackIdentity: 'permalink:https://soundcloud.com/artist/pad-editor', generation: 1 } } }));
      });
      document.dispatchEvent(new Event('scdl:open-player-tools-panel'));
    });
    await setup();
    const host = page.locator('#scdl-tempo-control');
    await host.locator('.sampler-toggle').click();
    // Upload a two-second WAV, exercising legacy standalone sample editing.
    const rate = 8000;
    const wav = Buffer.alloc(44 + rate * 2 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < rate * 2; i++) wav.writeInt16LE(Math.sin(i / rate * 440 * 2 * Math.PI) * 10000, 44 + i * 2);
    await host.locator('.drum-file').nth(0).setInputFiles({ name: 'Editor tone.wav', mimeType: 'audio/wav', buffer: wav });
    await host.locator('.drum-pad[title^="Editor tone"]').waitFor();
    if (!await host.locator('.editor-pad').isVisible()) await host.locator('.waveform-toggle').click();
    await host.locator('.editor-pad').click();
    const end = host.locator('.loop-end-time');
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-end-time').value === '00:02.000');
    assert.match(await host.locator('.editor-track').textContent(), /Volver a pista/);
    await end.fill('00:00.800');
    await end.press('Enter');
    await host.locator('.drum-pad').nth(0).click();
    await page.waitForFunction(() => played.length > 0).catch(async error => {
      console.log(await host.locator('.drum-message').textContent(), errors);
      throw error;
    });
    assert.ok(Math.abs(await page.evaluate(() => played.at(-1).buffer.duration) - .8) < .002);
    assert.equal(await host.locator('.waveform-playhead').isVisible(), false);
    // A key can play a different sample while a boundary gesture remains pinned.
    const marker = await host.locator('.waveform-end').boundingBox();
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    const nextKey = await host.locator('.drum-pad').nth(1).locator('.drum-key').textContent();
    await page.keyboard.press(nextKey.toLowerCase());
    assert.match(await host.locator('.editor-pad').textContent(), /Pad Z/);
    await page.mouse.move(marker.x + marker.width / 2 + 20, marker.y + marker.height / 2);
    await page.mouse.up();
    await host.locator('.editor-track').click();
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-start-time').value === '00:05.000');
    assert.equal(await end.inputValue(), '00:09.000');
    assert.equal(await page.evaluate(() => commands.includes('set-loop') || commands.includes('seek')), false);
    await host.locator('.editor-pad').click();
    await host.locator('.editor-reset').click();
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-end-time').value === '00:02.000');
    await end.fill('00:00.600'); await end.press('Enter');
    await host.locator('.drum-pad').nth(0).click();
    await page.waitForFunction(() => Math.abs(played.at(-1).buffer.duration - .6) < .002);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-scdl-extension-drum-samples-url'));
    await setup();
    await host.locator('.editor-pad').click();
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.loop-end-time').value === '00:00.600');
    await host.locator('.panel').screenshot({ path: path.join(root, 'test-results', 'pad-editor.png') });
    assert.deepEqual(errors, []);
    console.log('Pad editor passed: shared looper, isolated track bounds, playback crop, drag pinning, reset and reload persistence.');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
