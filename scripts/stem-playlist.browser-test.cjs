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
    const playlist = page.locator('#playlist'), transport = page.locator('#transport'), inspector = page.locator('.workspace-header .pl-inspector');
    // One workspace, including before source import.
    assert.equal(await page.locator('#tab-playlist').count(), 0);
    assert.equal(await playlist.isVisible(), true);
    await transport.locator('input[type=file]').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
    await playlist.locator('.pl-clip').first().waitFor();
    // Import selects the drawing source immediately; no extra library click is needed.
    const initialLane = await playlist.locator('.pl-lane').first().boundingBox();
    await page.mouse.click(initialLane.x + 3 * 48, initialLane.y + 36);
    assert.equal(await playlist.locator('.pl-clip').count(), 2, 'Clicking the grid draws the imported sample');
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('Control+z');
    assert.equal(await playlist.locator('.pl-clip').count(), 1);
    assert.equal(await transport.locator('.pl-toolbar [aria-label="Loop A"], .pl-toolbar [aria-label="Loop B"]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Clear A–B loop' }).count(), 0);
    // The transport bar lives in the header: the header play button is the only one.
    assert.equal(await page.locator('.pl-play').count(), 0);
    assert.equal(await transport.locator('#stem-rate').count(), 1, 'Speed sits next to the tempo controls');
    for (const name of ['Import audio files', 'Sample browser', 'Add track', 'Export WAV']) {
      const host = name === 'Export WAV' || name === 'Sample browser' ? transport : inspector.locator('.pl-tools');
      const control = host.getByRole('button', { name, exact: true });
      assert.equal(await control.textContent(), '');
      assert.equal(await control.locator('svg').count(), 1);
      assert.match(await control.getAttribute('data-scdl-tooltip'), new RegExp('^' + name + (name === 'Export WAV' ? '' : ' \\([A-Z]\\d*\\)') + ': '));
    }
    // Twenty editing actions, split between selected-clip actions and general tools.
    const tools = inspector.locator('.pl-tools > button, .pl-clip-options > .pl-key');
    // Stretch is an additional selection toggle with its own shortcut.
    assert.equal(await tools.count(), 21);
    assert.equal(await transport.locator('.pl-window-tool').count(), 6);
    assert.match(await transport.locator('.pl-window-tool').first().evaluate(e => getComputedStyle(e).backgroundImage), /linear-gradient/, 'Window buttons share the accent button');
    // All editing buttons share one compact row at this desktop width.
    const tops = await inspector.locator('.pl-clip-options > button, .pl-tools > button').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1);
    assert.equal(await tools.evaluateAll(nodes => nodes.filter(n => n.getAttribute('aria-keyshortcuts')).length), 21);
    assert.equal(await inspector.locator('.pl-tools').evaluate(e => getComputedStyle(e).borderLeftWidth), '1px');
    assert.match(await transport.locator('.pl-export').evaluate(e => getComputedStyle(e).backgroundImage), /linear-gradient/);
    // Every header button shares one size.
    assert.deepEqual([...new Set(await transport.locator('button.ui-btn--icon').evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => n.offsetWidth + 'x' + n.offsetHeight)))], ['28x32']);
    const ruler = playlist.locator('.pl-ruler'), band = playlist.locator('.pl-loop-band');
    assert.match(await ruler.getAttribute('data-scdl-tooltip'), /drag inside.*edges.*double-click/i);
    const dragRuler = async (from, to) => {
      const bounds = await ruler.boundingBox();
      await page.mouse.move(bounds.x + from, bounds.y + 14); await page.mouse.down();
      await page.mouse.move(bounds.x + to, bounds.y + 14, { steps: 5 }); await page.mouse.up();
    };
    const selection = () => band.evaluate(e => ({ left: parseFloat(e.style.left), width: parseFloat(e.style.width) }));
    // At the initial 48 px/s zoom, create .5–1.5, move to 1–2, then resize both edges.
    await dragRuler(24, 72);
    assert.deepEqual(await selection(), { left: 24, width: 48 });
    await dragRuler(48, 72);
    assert.deepEqual(await selection(), { left: 48, width: 48 });
    await dragRuler(48, 36);
    assert.deepEqual(await selection(), { left: 36, width: 60 });
    await dragRuler(96, 84);
    assert.deepEqual(await selection(), { left: 36, width: 48 });
    // The grid (1/8 by default: 12 px at 120 BPM and 48 px/s) applies to the ruler; Alt is free.
    const gridButton = inspector.locator('.pl-grid-snap');
    assert.equal(await gridButton.getAttribute('aria-label'), 'Grid: 1/8');
    assert.equal(await gridButton.locator('.ui-btn-label').count(), 0, 'The grid shows only its icon');
    assert.equal(await gridButton.getAttribute('aria-pressed'), 'true');
    // Each check starts from no loop (double-click clears it), so the drag creates one.
    const freshLoop = async () => { await ruler.dblclick({ position: { x: 400, y: 14 } }); await dragRuler(151, 185); };
    await freshLoop();
    assert.deepEqual(await selection(), { left: 156, width: 24 }, 'Loop edges stick to 1/8');
    await page.keyboard.down('Alt'); await freshLoop(); await page.keyboard.up('Alt');
    assert.deepEqual(await selection(), { left: 151, width: 34 }, 'Alt drags the loop freely');
    await gridButton.click();
    assert.equal(await gridButton.getAttribute('aria-label'), 'Grid: 1/16');
    await freshLoop();
    assert.deepEqual(await selection(), { left: 150, width: 36 }, 'Loop edges stick to 1/16');
    await gridButton.click();
    assert.equal(await gridButton.getAttribute('aria-pressed'), 'false');
    await freshLoop();
    assert.deepEqual(await selection(), { left: 151, width: 34 }, 'Without a grid the loop is free');
    await gridButton.click();
    assert.equal(await gridButton.getAttribute('aria-label'), 'Grid: 1/8', 'The grid cycles back to 1/8');
    await ruler.dblclick({ position: { x: 400, y: 14 } });
    await dragRuler(36, 84);
    // The marker follows the loop start, then the last ruler click; it stays when the loop is cleared.
    const marker = () => playlist.locator('.pl-marker').evaluate(e => parseFloat(e.style.left));
    assert.equal(await marker(), 36);
    await ruler.dblclick({ position: { x: 12, y: 14 } });
    assert.equal(await band.isVisible(), false);
    assert.equal(await marker(), 12);
    // Without a loop, double-clicking the ruler clears the marker and plays from the top;
    // the whole arrangement keeps looping automatically.
    const startsBeforeLoop = await page.evaluate(() => window.playlistStarts);
    await ruler.dblclick({ position: { x: 60, y: 14 } });
    assert.equal(await marker(), 0);
    await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true');
    await page.waitForTimeout(2300);
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true', 'Playback continues past the end without a selection');
    assert.ok(await page.evaluate(count => window.playlistStarts >= count + 2, startsBeforeLoop), 'Audio starts again on the next loop');
    await page.locator('#play').click();
    await dragRuler(0, 96);
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await playlist.screenshot({ path: path.join(artifacts, 'playlist-toolbar.png') });
    // Playback starts on the press: no full mix render before the first sound.
    const before = Date.now();
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true' && window.playlistStarts > 0);
    assert.ok(Date.now() - before < 1500, 'playback starts immediately');
    const time = () => transport.locator('.pl-time').textContent();
    const t0 = await time(); await page.waitForTimeout(300);
    assert.notEqual(await time(), t0, 'transport advances');
    // Pitch +12 in Stretch mode while playing: the clip stretches in the worker,
    // keeps its length, and playback keeps running.
    await playlist.locator('.pl-clip').first().click();
    const width = (await playlist.locator('.pl-clip').first().boundingBox()).width;
    // Shift + ArrowUp on the pitch knob is one octave.
    await inspector.getByRole('slider', { name: 'Pitch', exact: true }).press('Shift+ArrowUp');
    assert.equal(await inspector.getByRole('slider', { name: 'Pitch', exact: true }).getAttribute('aria-valuenow'), '12');
    // The clip has its own volume, first in the inspector; the track knob stays the channel master.
    const clipVolume = inspector.getByRole('slider', { name: 'Volume', exact: true });
    assert.equal(await inspector.locator('.ui-knob-dial').first().getAttribute('aria-label'), 'Volume');
    await clipVolume.press('Shift+ArrowDown');
    assert.equal(await clipVolume.getAttribute('aria-valuenow'), '90');
    await clipVolume.dblclick();
    assert.equal(await clipVolume.getAttribute('aria-valuenow'), '100');
    await page.waitForFunction(() => !document.querySelector('.pl-clip.is-stretching'), null, { timeout: 15000 });
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true', 'still playing after the edit');
    assert.ok(Math.abs((await playlist.locator('.pl-clip').first().boundingBox()).width - width) < 1, 'stretch keeps the clip length');
    // Like FL Studio: a plain wheel over the tracks scrolls the page, over the ruler it zooms; Shift pans.
    const scroller = playlist.locator('.pl-scroll'), box = await scroller.boundingBox();
    await page.mouse.move(box.x + 400, box.y + 120);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await playlist.locator('.pl-clip').first().boundingBox()).width - width) < 1, 'wheel over tracks does not zoom');
    const wheelRuler = await playlist.locator('.pl-ruler').boundingBox();
    await page.mouse.move(box.x + 400, wheelRuler.y + wheelRuler.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction(clipWidth => document.querySelector('.pl-clip').getBoundingClientRect().width > clipWidth * 1.4, width);
    await page.mouse.move(box.x + 400, box.y + 120);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift');
    await page.waitForFunction(() => document.querySelector('.pl-scroll').scrollLeft > 0);
    await inspector.getByRole('button', { name: 'Show the whole arrangement' }).click();
    // Track volume is a knob too.
    assert.equal(await playlist.getByRole('slider', { name: /^Volume / }).count(), 4);
    // Moving the clip while playing reschedules instead of stopping.
    const starts = await page.evaluate(() => window.playlistStarts);
    await playlist.locator('.pl-clip').first().press('ArrowRight');
    await page.waitForFunction(count => window.playlistStarts > count, starts);
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
    await page.locator('#play').click();
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    // Export uses the same clip scheduling and cached stretch as playback.
    const [download] = await Promise.all([page.waitForEvent('download'), transport.getByLabel('Export WAV').click()]);
    const file = await download.path();
    const result = await page.evaluate(async bytes => {
      const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(new Uint8Array(bytes).buffer);
      const data = buffer.getChannelData(0), first = data.findIndex(v => Math.abs(v) > .01);
      let crossings = 0;
      for (let i = first + 22051; i < first + 66150; i++) if (data[i - 1] < 0 && data[i] >= 0) crossings++;
      return { duration: buffer.duration, first: first / buffer.sampleRate, frequency: crossings / 1 };
    }, [...fs.readFileSync(file)]);
    assert.ok(Math.abs(result.duration - 2.25) < .01, `export length ${result.duration}`);
    assert.ok(Math.abs(result.first - .25) < .01, `clip moved by one grid step (1/8): ${result.first}`);
    assert.ok(Math.abs(result.frequency - 880) < 20, `exported pitch ${result.frequency}`);
    // The timeline scrollbar spans the lanes only; channel headers cover clips and the playhead.
    const [scrollBox, barBox] = await Promise.all([playlist.locator('.pl-scroll').boundingBox(), playlist.locator('.pl-hbar').boundingBox()]);
    const head = await playlist.locator('.pl-track-head').first().boundingBox();
    assert.ok(Math.abs(barBox.x - (scrollBox.x + 1 + head.width)) <= 2, 'Scrollbar starts after the channel headers');
    assert.equal(await playlist.locator('.pl-scroll').evaluate(e => e.offsetHeight - e.clientHeight), 2, 'No native scrollbar under the headers');
    assert.ok(await page.evaluate(() => +getComputedStyle(document.querySelector('.pl-track-head')).zIndex > +getComputedStyle(document.querySelector('.pl-playhead')).zIndex));
    // Help and status lines expire.
    await playlist.locator('.pl-hint').waitFor({ state: 'hidden', timeout: 12000 });
    // Right-click menus contain actions on the target; stretch settings stay beside the knobs.
    const menu = page.locator('.pl-menu');
    await page.locator('.workspace-header .pl-shelf button', { hasText: 'tone.wav' }).first().click({ button: 'right' });
    assert.deepEqual(await menu.locator('.pl-menu-label').allTextContents(), ['Extract stems…', 'Duplicate', 'Check unused sounds', 'Delete from project']);
    assert.equal(await menu.locator('.pl-menu-item.is-danger .pl-menu-label').textContent(), 'Delete from project');
    assert.equal(await menu.locator('.pl-menu-item svg').count(), 4);
    assert.equal(await menu.locator('.pl-menu-item.is-danger').evaluate(e => getComputedStyle(e).color), 'rgb(255, 107, 107)');
    await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
    assert.equal(await menu.count(), 0, 'Choosing an item closes the menu');
    const copy = page.locator('.workspace-header .pl-shelf button', { hasText: 'tone.wav (2)' });
    await copy.waitFor();
    await copy.click({ button: 'right' }); await menu.getByRole('menuitem', { name: 'Check unused sounds' }).click();
    assert.equal(await copy.locator('.pl-unused-label').textContent(), 'Unused', 'A library-only duplicate is marked in the real workspace');
    assert.equal(await page.locator('.workspace-header .pl-shelf button.is-unused').count(), 1, 'The assigned original is still used');
    await copy.click({ button: 'right' }); await menu.getByRole('menuitem', { name: 'Delete from project' }).click();
    await page.locator('#channel-action-dialog [data-action=delete]').click();
    await copy.waitFor({ state: 'detached' });
    // Like FL Studio: right click on the name bar opens the menu, on the waveform removes the clip.
    const clipHeader = playlist.locator('.pl-clip .pl-clip-title').first();
    await clipHeader.click({ button: 'right' });
    assert.equal(await menu.getByRole('menuitemradio').count(), 0, 'Stretch modes are absent from the clip menu');
    assert.deepEqual(await menu.locator('.pl-menu-label').allTextContents(), ['Duplicate', 'Split at cursor', 'Mute clip', 'Reverse', 'Normalize audio', 'Extract stems…', 'Remove from playlist']);
    assert.equal(await inspector.getByLabel('Draw tool', { exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await inspector.locator('.pl-tools .ui-btn-label').count(), 0, 'Tool buttons show only icons');
    assert.equal(await inspector.getByRole('button', { name: 'Stretch', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(artifacts, 'playlist-clip-menu.png') });
    await page.keyboard.press('Escape'); assert.equal(await menu.count(), 0);
    // Export/unused-sample notices can cover the waveform after the header reflow.
    await page.waitForFunction(() => !document.querySelector('.toastify'));
    const clipBox = await playlist.locator('.pl-clip').first().boundingBox();
    await page.mouse.click(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height - 6, { button: 'right' });
    assert.equal(await menu.count(), 0, 'Right click on the waveform opens no menu');
    assert.equal(await playlist.locator('.pl-clip').count(), 0, 'Right click on the waveform removes the clip');
    await page.keyboard.press('Control+z');
    assert.equal(await playlist.locator('.pl-clip').count(), 1, 'Undo brings the clip back');
    // A touch long-press on the waveform opens the menu instead of deleting.
    await playlist.locator('.pl-clip').first().evaluate(item => {
      const box = item.getBoundingClientRect();
      item.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: box.left + box.width / 2, clientY: box.bottom - 6 }));
    });
    assert.equal(await menu.count(), 1, 'Touch long-press opens the clip menu');
    assert.equal(await playlist.locator('.pl-clip').count(), 1, 'Touch long-press never deletes the clip');
    await page.keyboard.press('Escape'); assert.equal(await menu.count(), 0);
    // Space twice rewinds to the loop start and plays, like FL Studio.
    await playlist.locator('.pl-scroll').focus();
    await page.keyboard.press('Space'); await page.waitForTimeout(900);
    await page.keyboard.press('Space'); await page.keyboard.press('Space');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(100); const restarted = await time();
    assert.ok(Number(restarted.split(':')[1]) < .4, 'Restarted from the loop start: ' + restarted);
    await page.keyboard.press('Space');
    // Several selected clips split together at the playhead.
    const clips = playlist.locator('.pl-clip'), clipCount = () => clips.count();
    await clips.first().click(); await page.keyboard.press('Control+d');
    // Off-screen clips are not drawn: wait for the fitted view to show the copy.
    await inspector.getByLabel('Show the whole arrangement').click(); await clips.nth(1).waitFor();
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('Control+a');
    assert.equal(await clipCount(), 2);
    const pressed = () => playlist.locator('.pl-clip[aria-pressed=true]').count();
    assert.equal(await pressed(), 2);
    assert.equal(await playlist.locator('.pl-selected').count(), 0, 'No selection name shifts the knobs');
    for (const index of [0, 1]) await clips.nth(index).click({ modifiers: ['Control'] });
    assert.equal(await playlist.locator('.pl-clip[aria-pressed=true]').count(), 0, 'Ctrl+click toggles clips off');
    const [laneBox, firstBox, secondBox] = await Promise.all([playlist.locator('.pl-lane').first().boundingBox(), clips.nth(0).boundingBox(), clips.nth(1).boundingBox()]);
    const timelineBox = await playlist.locator('.pl-scroll').boundingBox();
    await page.mouse.move(timelineBox.x + timelineBox.width - 6, laneBox.y + 3); await page.mouse.down();
    await page.mouse.move(Math.min(firstBox.x, secondBox.x) + 4, laneBox.y + laneBox.height - 4, { steps: 5 }); await page.mouse.up();
    assert.equal(await pressed(), 2, 'A box drag on empty space selects clips');
    const target = firstBox.x < secondBox.x ? firstBox : secondBox, rulerBox = await ruler.boundingBox();
    await page.mouse.click(target.x + target.width / 2, rulerBox.y + 14);
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('s');
    assert.equal(await clipCount(), 3);
    assert.equal(await pressed(), 3, 'Both halves stay selected');
    // The slice tool cuts at the mouse, without moving the playhead.
    const sliceTool = inspector.getByRole('button', { name: 'Slice tool', exact: true });
    await page.keyboard.press('c');
    assert.equal(await sliceTool.getAttribute('aria-pressed'), 'true');
    assert.equal(await sliceTool.evaluate(n => n.getAnimations({ subtree: true }).filter(a => a.effect?.pseudoElement === '::after').length), 1, 'The hotkey flashes its button');
    assert.equal(await sliceTool.evaluate(n => getComputedStyle(n).getPropertyValue('--key-color')), '#ff5d8f');
    const headAt = await time(), piece = await clips.last().boundingBox();
    await page.mouse.move(piece.x + piece.width * .3, piece.y + piece.height / 2);
    assert.equal(await playlist.locator('.pl-slice-line').isVisible(), true);
    await page.mouse.down(); await page.mouse.up();
    assert.equal(await clipCount(), 4);
    assert.equal(await time(), headAt, "The playhead stays put");
    await page.keyboard.press('Escape');
    assert.equal(await sliceTool.getAttribute('aria-pressed'), 'false');
    // Removing every clip from the playlist keeps the sample as its track's instrument.
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
    assert.equal(await clipCount(), 0);
    await page.keyboard.press('F6');
    const rackTracks = page.locator('#stem-rack .plugin-track option');
    assert.ok(await rackTracks.count() >= 1, 'The track keeps its instrument without clips');
    // Deleting the sample from the project lets the instrument go; undo brings it back.
    await page.keyboard.press('F6');
    await page.locator('.workspace-header .pl-shelf button', { hasText: 'tone.wav' }).first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Delete from project' }).click();
    await page.locator('#channel-action-dialog [data-action=delete]').click();
    assert.equal(await page.locator('.workspace-header .pl-shelf button', { hasText: 'tone.wav' }).count(), 0);
    assert.equal(await rackTracks.count(), 0, 'No track has an instrument any more');
    // No click on the timeline first: the playlist keeps its hotkeys after the menu closes.
    await page.keyboard.press('Control+z');
    await page.locator('.workspace-header .pl-shelf button', { hasText: 'tone.wav' }).first().waitFor();
    assert.ok(await rackTracks.count() >= 1, 'Undo restores the sample and the instrument');
    assert.deepEqual(errors, []);
    console.log('Playlist browser test passed.', result);
  } finally {
    await browser?.close(); server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
