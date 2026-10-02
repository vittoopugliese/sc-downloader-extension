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
      window.decodeCount = 0;
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (...args) {
        decodeCount++;
        return decode.apply(this, args);
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        this.testStart = args;
        played.push(this);
        return start.apply(this, args);
      };
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        (this.testStops ||= []).push(args[0]);
        return stop.apply(this, args);
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
    const pad = host.locator('.drum-pad').nth(0);
    const end = host.locator('.waveform-end');
    const startMarker = host.locator('.waveform-start');
    const waitEnd = value => page.waitForFunction(value => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.waveform-end').getAttribute('aria-valuenow') === String(value), value);
    await pad.click();
    assert.equal(await host.locator('.editor-track').isVisible(), false, 'Playback does not enter editing');
    await pad.click({ button: 'right' });
    await waitEnd(2000);
    assert.equal(await host.locator('.set-a, .set-b, .header-set-a, .header-set-b, .loop-time, .editor-pad, .editor-reset').count(), 0);
    assert.equal(await host.locator('.waveform-header .editor-track').count(), 1);
    const decoded = await page.evaluate(() => decodeCount);
    await host.locator('.editor-track').click();
    await waitEnd(9000);
    await pad.click({ button: 'right' });
    await waitEnd(2000);
    assert.equal(await page.evaluate(() => decodeCount), decoded, 'Reopening unchanged pad must reuse decoded waveform');
    // Boundaries remain keyboard-accessible as well as draggable.
    await end.press('Shift+ArrowLeft');
    await end.press('ArrowLeft');
    await end.press('ArrowLeft');
    await waitEnd(800);
    await pad.click();
    await page.waitForFunction(() => played.at(-1).testStops?.some(when => Math.abs(when - played.at(-1).testStart[0] - .8) < .002));
    assert.equal(await host.locator('.waveform-playhead').isVisible(), false);
    // A key can play a different sample while a boundary gesture remains pinned.
    const marker = await end.boundingBox();
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    const nextKey = await host.locator('.drum-pad').nth(1).locator('.drum-key').textContent();
    await page.keyboard.press(nextKey.toLowerCase());
    assert.match(await end.getAttribute('aria-label'), /Pad Z/);
    await page.mouse.move(marker.x + marker.width / 2 + 20, marker.y + marker.height / 2);
    await page.mouse.up();
    await host.locator('.editor-track').click();
    await waitEnd(9000);
    assert.equal(await startMarker.getAttribute('aria-valuenow'), '5000');
    assert.equal(await page.evaluate(() => commands.includes('set-loop') || commands.includes('seek')), false);
    await pad.click({ button: 'right' });
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.waveform-end').getAttribute('aria-label') === 'Pad Z B');
    const previousPlays = await page.evaluate(() => played.length);
    await pad.click();
    await page.waitForFunction(count => played.length > count, previousPlays);
    // Playback leaves the editor pinned, including after multiple other pads.
    await page.mouse.move(1000, 100);
    const pinnedStart = await startMarker.getAttribute('aria-valuenow');
    const pinnedEnd = await end.getAttribute('aria-valuenow');
    assert.match(await pad.getAttribute('data-scdl-tooltip'), /Right-click.*looper.*start\/end/);
    for (let index = 1; index < 8; index++) {
      const otherPad = host.locator('.drum-pad').nth(index);
      const plays = await page.evaluate(() => played.length);
      await otherPad.click();
      await page.waitForFunction(count => played.length > count, plays);
      await page.keyboard.press((await otherPad.locator('.drum-key').textContent()).toLowerCase());
      assert.equal(await end.getAttribute('aria-label'), 'Pad Z B');
      assert.equal(await startMarker.getAttribute('aria-valuenow'), pinnedStart);
      assert.equal(await end.getAttribute('aria-valuenow'), pinnedEnd);
    }
    // Only right-click switches the editor, reusing the original waveform.
    await host.locator('.drum-pad').nth(1).click({ button: 'right' });
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.waveform-end').getAttribute('aria-label') !== 'Pad Z B');
    const beforeReturn = await page.evaluate(() => decodeCount);
    await pad.click({ button: 'right' });
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.waveform-end').getAttribute('aria-label') === 'Pad Z B');
    assert.equal(await page.evaluate(() => decodeCount), beforeReturn);
    // Draw a fresh range solely through the waveform.
    const stage = await host.locator('.waveform-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width * .1, stage.y + stage.height * .7);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * .3, stage.y + stage.height * .7);
    await page.mouse.up();
    const savedStart = await startMarker.getAttribute('aria-valuenow');
    const savedEnd = await end.getAttribute('aria-valuenow');
    await pad.click();
    await page.waitForFunction(() => played.length > 0);
    await host.locator('.waveform-toggle').click({ position: { x: 30, y: 12 } });
    await host.locator('.editor-track').waitFor({ state: 'hidden' });
    assert.equal(await host.locator('.editor-track').isVisible(), false);
    await host.locator('.waveform-toggle').click({ position: { x: 30, y: 12 } });
    await host.locator('.editor-track').waitFor({ state: 'visible' });
    assert.equal(await host.locator('.editor-track').isVisible(), true);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-scdl-extension-drum-samples-url'));
    await setup();
    if (!await pad.isVisible()) await host.locator('.sampler-toggle').click();
    await host.locator('.drum-pad[title^="Editor tone"]').waitFor();
    await pad.click({ button: 'right' });
    await waitEnd(Number(savedEnd));
    assert.equal(await startMarker.getAttribute('aria-valuenow'), savedStart);
    await page.mouse.move(1000, 100);
    await host.locator('.panel').screenshot({ path: path.join(root, 'test-results', 'pad-editor.png') });
    assert.deepEqual(errors, []);
    console.log('Pad editor passed: shared looper, isolated track bounds, playback crop, drag pinning, waveform reuse, compact controls and reload persistence.');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
