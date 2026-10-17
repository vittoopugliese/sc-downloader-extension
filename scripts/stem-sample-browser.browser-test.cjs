// Sample browser in real Chromium. The folder picker returns an origin-private folder
// (a real FileSystemDirectoryHandle) filled with generated WAVs. A persistent profile is
// needed: incognito Chromium closes the page when it reads a handle back from IndexedDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, locale: 'en-US', viewport: { width: 1200, height: 1000 }, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = browser.pages()[0] || await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.pickerCalls = 0; window.pickerCancel = false;
      window.showDirectoryPicker = async options => {
        window.pickerCalls++; window.pickerOptions = options;
        if (window.pickerCancel) throw new DOMException('The user aborted a request.', 'AbortError');
        return (await navigator.storage.getDirectory()).getDirectoryHandle('Samples', { create: true });
      };
      // Every started source, with its context, to tell preview from Playlist audio.
      window.starts = [];
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = create.call(this), start = source.start.bind(source), context = this;
        source.start = (...args) => { window.starts.push({ context, duration: source.buffer?.duration, offset: args[1] || 0 }); start(...args); };
        return source;
      };
      if (sessionStorage.getItem('revoke')) {
        let granted = false;
        FileSystemHandle.prototype.queryPermission = async () => granted ? 'granted' : 'prompt';
        FileSystemHandle.prototype.requestPermission = async () => { granted = true; return 'granted'; };
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    // Fixture folder: sorted folders first, numeric file order, non-audio files hidden.
    await page.evaluate(async () => {
      const wav = (seconds, frequency) => {
        const rate = 44100, length = Math.round(rate * seconds), view = new DataView(new ArrayBuffer(44 + length * 2));
        const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
        for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 12000), true);
        return view.buffer;
      };
      const put = async (folder, name, contents) => {
        const stream = await (await folder.getFileHandle(name, { create: true })).createWritable();
        await stream.write(contents); await stream.close();
      };
      const opfs = await navigator.storage.getDirectory();
      await opfs.removeEntry('Samples', { recursive: true }).catch(() => {});
      const samples = await opfs.getDirectoryHandle('Samples', { create: true });
      await put(samples, 'tone 10.wav', wav(1.5, 330));
      await put(samples, 'tone 2.wav', wav(1, 440));
      await put(samples, 'broken.wav', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
      await put(samples, 'notes.txt', 'not audio');
      const drums = await samples.getDirectoryHandle('Drums', { create: true });
      await put(drums, 'Kick 808.wav', wav(2, 50));
      await drums.getDirectoryHandle('Sub', { create: true });
      const big = await samples.getDirectoryHandle('Big', { create: true });
      const tiny = wav(.01, 1000);
      await Promise.all(Array.from({ length: 1500 }, (_, i) => put(big, `f${i}.wav`, tiny)));
    });
    const playlist = page.locator('#playlist'), dialog = page.getByRole('dialog', { name: 'Browser' });
    const browserButton = page.locator('#transport').getByRole('button', { name: 'Sample browser', exact: true });
    const names = () => dialog.locator('.sb-row span').allTextContents();
    const row = name => dialog.locator('.sb-row', { hasText: name });
    const playButton = dialog.locator('.sb-controls .sb-icon').first();
    const lastStart = () => page.evaluate(() => window.starts.at(-1));
    assert.equal(await browserButton.getAttribute('aria-keyshortcuts'), 'F8');
    await browserButton.click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await browserButton.getAttribute('aria-pressed'), 'true');
    const choose = dialog.getByRole('button', { name: 'Choose folder' });
    await choose.waitFor();
    // Cancelling the picker keeps the previous state.
    await page.evaluate(() => { window.pickerCancel = true; });
    await choose.click();
    assert.equal(await page.evaluate(() => window.pickerCalls), 1);
    assert.equal(await choose.isVisible(), true);
    assert.equal(await dialog.locator('.sb-status').textContent(), '');
    await page.evaluate(() => { window.pickerCancel = false; });
    await choose.click();
    await row('tone 2.wav').waitFor();
    assert.equal(await page.evaluate(() => window.pickerOptions.mode), 'read');
    assert.deepEqual(await names(), ['Big', 'Drums', 'broken.wav', 'tone 2.wav', 'tone 10.wav']);
    assert.equal(await dialog.locator('.sb-root').textContent(), 'Samples');
    // A click previews on the browser's own context, with a waveform and duration.
    await row('tone 2.wav').click();
    await page.waitForFunction(() => document.querySelector('.sb-duration').textContent === '0:01.00');
    await page.waitForFunction(() => document.querySelector('.sb-controls .sb-icon').getAttribute('aria-pressed') === 'true');
    const preview = await lastStart();
    assert.equal(preview.duration, 1);
    assert.ok(await dialog.locator('.sb-wave canvas').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    }), 'The waveform is drawn');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false', 'Preview does not start the transport');
    // Frequency colors like the other waveforms, once the analysis lands.
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.sb-wave canvas'), [r, g, b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return r + g + b > 0 && !(r === 133 && g === 141 && b === 150);
    });
    // Right-click plays from that point; a click plays from the start.
    const waveBox = await dialog.locator('.sb-wave').boundingBox();
    await page.mouse.click(waveBox.x + waveBox.width / 2, waveBox.y + waveBox.height / 2, { button: 'right' });
    await page.waitForFunction(() => window.starts.at(-1).offset > 0);
    assert.ok(Math.abs((await lastStart()).offset - .5) < .03, 'Right-click starts at the middle');
    await page.mouse.click(waveBox.x + waveBox.width / 2, waveBox.y + waveBox.height / 2);
    await page.waitForFunction(() => window.starts.at(-1).offset === 0);
    // Fast selection: the previous file never starts after a newer pick.
    await page.evaluate(() => { window.starts.length = 0; });
    await page.evaluate(() => {
      // Rows are re-rendered on every selection, so each click finds its row again.
      for (const name of ['tone 10.wav', 'tone 2.wav']) [...document.querySelectorAll('.sb-row')].find(row => row.textContent === name).click();
    });
    await page.waitForFunction(() => window.starts.length > 0);
    await page.waitForTimeout(250);
    assert.deepEqual((await page.evaluate(() => window.starts.map(item => item.duration))).filter(d => d === 1.5), [], 'tone 10 never starts');
    assert.equal(await dialog.locator('.sb-name').textContent(), 'tone 2.wav');
    // Undecodable file.
    await row('broken.wav').click();
    await dialog.locator('.sb-status', { hasText: 'cannot be decoded' }).waitFor();
    assert.equal(await playButton.isDisabled(), true);
    // Folders open with a click and Backspace returns with the folder selected.
    await row('Drums').click();
    await row('Kick 808.wav').waitFor();
    assert.equal(await dialog.locator('.sb-crumb').textContent(), '/Drums');
    assert.deepEqual(await names(), ['Sub', 'Kick 808.wav']);
    await page.keyboard.press('Backspace');
    await row('tone 2.wav').waitFor();
    assert.equal(await row('Drums').getAttribute('aria-selected'), 'true');
    // Space and letters belong to the focused browser: no transport, no Playlist hotkeys.
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    assert.equal(await row('tone 2.wav').getAttribute('aria-selected'), 'true');
    await page.waitForFunction(() => document.querySelector('.sb-controls .sb-icon').getAttribute('aria-pressed') === 'true');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.sb-controls .sb-icon').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    const sliceTool = playlist.getByRole('button', { name: 'Slice tool', exact: true });
    await page.keyboard.press('c');
    assert.equal(await sliceTool.getAttribute('aria-pressed'), 'false');
    // Enter adds the selected file at the playhead without dragging.
    const clips = playlist.locator('.pl-clip');
    assert.equal(await clips.count(), 0);
    await page.keyboard.press('Enter');
    await playlist.locator('.pl-clip', { hasText: 'tone 2.wav' }).waitFor();
    // Drag a file onto a track: it lands there; the preview stops.
    await row('tone 10.wav').click();
    await page.waitForFunction(() => document.querySelector('.sb-controls .sb-icon').getAttribute('aria-pressed') === 'true');
    const lane = playlist.locator('.pl-lane').first(), laneBox = await lane.boundingBox();
    await row('tone 10.wav').dragTo(lane, { targetPosition: { x: 200, y: laneBox.height / 2 } });
    await playlist.locator('.pl-clip', { hasText: 'tone 10.wav' }).waitFor();
    assert.equal(await clips.count(), 2);
    assert.equal(await playButton.getAttribute('aria-pressed'), 'false', 'Importing stops the preview');
    const dropped = await playlist.locator('.pl-clip', { hasText: 'tone 10.wav' }).boundingBox();
    assert.ok(dropped.x > laneBox.x + 100, 'The clip lands where it was dropped');
    // Escape closes and returns focus; B opens it again from the Playlist.
    await dialog.locator('.sb-list').focus();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await browserButton.getAttribute('aria-pressed'), 'false');
    assert.equal(await browserButton.evaluate(node => node === document.activeElement), true);
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('b');
    assert.equal(await dialog.isVisible(), true);
    // F8 works from anywhere on the page.
    await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('F8');
    assert.equal(await dialog.isVisible(), false);
    await page.keyboard.press('F8');
    assert.equal(await dialog.isVisible(), true);
    // Large folders render only the visible rows.
    await row('Big').click();
    await page.waitForFunction(() => document.querySelector('.sb-row')?.getAttribute('aria-setsize') === '1500');
    assert.ok(await dialog.locator('.sb-row').count() < 60, 'Rows are virtualized');
    await page.keyboard.press('End');
    await row('f1499.wav').waitFor();
    assert.equal(await row('f1499.wav').getAttribute('aria-selected'), 'true');
    // The window moves by its header and stays non-modal.
    const before = await dialog.boundingBox(), title = await dialog.locator('.tool-section-title').boundingBox();
    await page.mouse.move(title.x + 4, title.y + 4); await page.mouse.down();
    await page.mouse.move(title.x - 196, title.y + 54, { steps: 4 }); await page.mouse.up();
    const after = await dialog.boundingBox();
    assert.ok(Math.abs(after.x - (before.x - 200)) < 2 && Math.abs(after.y - (before.y + 50)) < 2, 'The window moved');
    await playlist.locator('.pl-scroll').click({ position: { x: 300, y: 4 } });
    assert.equal(await dialog.isVisible(), true, 'Clicking the Playlist keeps the browser open');
    // Maximize fills the viewport and restores the moved rectangle.
    await dialog.getByRole('button', { name: 'Maximize' }).click();
    const full = await dialog.boundingBox();
    assert.ok(full.width > 1150 && full.height > 950, 'Maximized browser fills the page');
    await dialog.getByRole('button', { name: 'Restore size' }).click();
    assert.ok(Math.abs((await dialog.boundingBox()).x - after.x) < 2);
    // Like the other tool windows it docks under the Playlist, where its title bar collapses it.
    const docked = page.getByRole('region', { name: 'Browser' }), browserBody = docked.locator('.sb-body');
    await dialog.getByRole('button', { name: 'Dock under the Playlist' }).click();
    assert.equal(await docked.evaluate(node => node.parentElement.id), 'mix-tools');
    assert.equal(await docked.evaluate(node => getComputedStyle(node).position), 'static');
    assert.equal(await page.locator('#mixer').isVisible(), true, 'Docked plugins get their card');
    const playlistBottom = (await playlist.boundingBox()).y + (await playlist.boundingBox()).height;
    assert.ok((await page.locator('#mixer').boundingBox()).y - playlistBottom >= 16, 'The plugins card keeps its distance from the Playlist');
    const dockedTitle = await docked.locator('.tool-section-title').boundingBox();
    await page.mouse.click(dockedTitle.x + dockedTitle.width + 40, dockedTitle.y + 4);
    assert.equal(await browserBody.isVisible(), false, 'A click on the docked title bar collapses it');
    assert.equal(await docked.locator('.tool-section-toggle').getAttribute('aria-expanded'), 'false');
    await page.mouse.click(dockedTitle.x + 4, dockedTitle.y + 4);
    assert.equal(await browserBody.isVisible(), true, 'A second click expands it');
    await docked.getByRole('button', { name: 'Choose samples folder' }).evaluate(node => node.blur());
    assert.equal(await browserBody.isVisible(), true);
    await docked.getByRole('button', { name: 'Detach: float this window' }).click();
    assert.ok(Math.abs((await dialog.boundingBox()).x - after.x) < 2, 'Floating again keeps its rectangle');
    assert.equal(await page.locator('#mixer').isVisible(), false, 'Without docked plugins there is no card');
    // An open browser comes back after a reload, and the root is remembered: no picker.
    await page.reload();
    await dialog.waitFor();
    assert.equal(await browserButton.getAttribute('aria-pressed'), 'true');
    await row('tone 2.wav').waitFor();
    assert.equal(await page.evaluate(() => window.pickerCalls), 0);
    const placed = await dialog.boundingBox();
    assert.ok(Math.abs(placed.x - after.x) < 2, 'Position is remembered');
    // Lost permission asks to reconnect with a click.
    await page.evaluate(() => sessionStorage.setItem('revoke', '1'));
    await page.reload();
    await dialog.waitFor();
    const reconnect = dialog.getByRole('button', { name: 'Reconnect folder' });
    await reconnect.waitFor();
    await reconnect.click();
    await row('tone 2.wav').waitFor();
    // Rack-only import: no lane/clip is created, and the new channel is focused.
    const rack = page.locator('#stem-rack'), rackRows = rack.locator('.rack-channel');
    const addToRack = dialog.getByRole('button', { name: 'Add to channel rack only', exact: true });
    assert.equal(await addToRack.isDisabled(), true);
    const laneCount = await playlist.locator('.pl-lane').count();
    await row('tone 2.wav').click();
    await addToRack.click();
    await rack.locator('.rack-channel.is-selected', { hasText: 'tone 2.wav' }).waitFor();
    assert.equal(await clips.count(), 0);
    assert.equal(await playlist.locator('.pl-lane').count(), laneCount);
    assert.equal(await rackRows.count(), 1);
    assert.equal(await rack.locator('.rack-channel-mode').inputValue(), 'oneShot');
    assert.equal(await playButton.getAttribute('aria-pressed'), 'false');
    const firstChannel = await rackRows.first().getAttribute('data-channel');
    // Undo/redo includes the imported asset even though it has no playlist clip.
    await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !document.querySelector('.rack-channel'));
    await page.keyboard.press('Control+Shift+z');
    await rackRows.first().waitFor();
    assert.equal(await rackRows.first().getAttribute('data-channel'), firstChannel);
    assert.equal(await clips.count(), 0);
    // Arrange the two floating windows side by side for a real browser drag.
    await page.evaluate(() => {
      Object.assign(document.querySelector('.sb-window').style, { left: '8px', top: '8px', width: '360px', height: '480px' });
      Object.assign(document.querySelector('#stem-rack').style, { left: '400px', top: '8px', width: '780px', height: '470px' });
    });
    await row('tone 10.wav').dragTo(rack.locator('.rack-overview'));
    await rack.locator('.rack-channel.is-selected', { hasText: 'tone 10.wav' }).waitFor();
    assert.equal(await rackRows.count(), 2);
    assert.equal(await clips.count(), 0);
    // External files use the same importer; an invalid batch leaves no partial samples.
    const dropFiles = async names => page.evaluate(async names => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Samples');
      const dataTransfer = new DataTransfer();
      for (const name of names) dataTransfer.items.add(await (await folder.getFileHandle(name)).getFile());
      document.querySelector('#stem-rack').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, names);
    await dropFiles(['tone 2.wav', 'broken.wav']);
    await page.locator('.ui-toast-content[data-variant=error]').first().waitFor();
    assert.equal(await rackRows.count(), 2);
    await dropFiles(['tone 2.wav', 'tone 10.wav']);
    await page.waitForFunction(() => document.querySelectorAll('.rack-channel').length === 4);
    assert.equal(await clips.count(), 0);
    // A loaded library sample selects its existing rack channel without duplicating audio.
    await page.evaluate(() => {
      const source = document.querySelector('.pl-shelf button'), dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      document.querySelector('#stem-rack').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });
    assert.equal(await rackRows.count(), 4);
    assert.equal(await rack.locator('.rack-channel.is-selected').getAttribute('data-channel'), firstChannel);
    // The focused sample can immediately make a pattern, and is shared with piano roll.
    await rack.locator('.rack-channel.is-selected .rack-step').first().click();
    assert.equal(await rack.locator('.rack-channel.is-selected .rack-step').first().getAttribute('aria-pressed'), 'true');
    assert.equal(await clips.count(), 0);
    await page.keyboard.press('F7');
    await page.locator('#stem-piano-roll').waitFor();
    assert.equal(await page.locator('#stem-piano-roll .plugin-track').inputValue(), firstChannel);
    assert.equal(await page.locator('#stem-piano-roll .piano-sample').isVisible(), false, 'One-shot piano uses the whole imported sample');
    await page.keyboard.press('F7');
    await page.keyboard.press('F6');
    assert.deepEqual(errors, []);
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await row('tone 2.wav').click();
    await page.waitForFunction(() => document.querySelector('.sb-duration').textContent === '0:01.00');
    await page.screenshot({ path: path.join(artifacts, 'sample-browser.png') });
    await page.evaluate(() => sessionStorage.removeItem('revoke'));
    console.log('Sample browser test passed.');
  } finally {
    await browser?.close(); server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
