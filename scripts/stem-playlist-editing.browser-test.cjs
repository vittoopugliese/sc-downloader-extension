// Real Playlist DOM, pointer gestures and canvas coordinates at desktop/mobile sizes.
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
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    // Mount the production module with deterministic audio, keeping the page's real CSS.
    await page.evaluate(async () => {
      const { mountPlaylist } = await import('./scripts/stem-playlist.mjs');
      document.documentElement.lang = 'en';
      const main = document.createElement('main'), container = document.createElement('div');
      main.append(container); document.body.append(main);
      for (const child of [...document.body.children]) if (child !== main) child.hidden = true;
      container.id = 'editing-fixture';
      window.editor = mountPlaylist({ container });
      const buffer = new AudioBuffer({ length: 4410, sampleRate: 44100 });
      buffer.getChannelData(0).fill(.6);
      editor.setSession({ sources: [{ id: 'audio-snare', stem: 'snare', name: 'Snare', buffer }] });
      editor.edit(state => { state.clips[0].at = .5; });
    });
    const ui = page.locator('#editing-fixture'), scroll = ui.locator('.pl-scroll');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settle();
    // Minimum zoom must still fill the lane viewport and leave the fixed headers in place.
    for (let i = 0; i < 15; i++) { await ui.getByLabel('Zoom out', { exact: true }).click(); await settle(); }
    const geometry = () => ui.evaluate(el => {
      const scroll = el.querySelector('.pl-scroll'), lane = el.querySelector('.pl-lane');
      const head = el.querySelector('.pl-track-head'), grid = el.querySelector('.pl-grid'), canvas = el.querySelector('.pl-wave-layer');
      const s = scroll.getBoundingClientRect(), l = lane.getBoundingClientRect(), h = head.getBoundingClientRect();
      return { viewport: scroll.clientWidth, grid: grid.getBoundingClientRect().width, scrollWidth: scroll.scrollWidth,
        scrollLeft: scroll.scrollLeft, head: h.width, headX: h.x, scrollX: s.x, laneRight: l.right, scrollRight: s.right,
        waveX: canvas.getBoundingClientRect().x, laneX: l.x };
    });
    const low = await geometry(); console.log('Minimum zoom geometry:', low);
    assert.ok(low.laneRight >= low.scrollRight - 2, 'Grid covers the entire visible timeline at minimum zoom');
    assert.ok(low.scrollWidth <= low.viewport + 1, 'Minimum zoom has no phantom horizontal overflow');
    assert.ok(Math.abs(low.headX - low.scrollX - 1) < 1, 'Headers stay pinned at the left edge');
    assert.equal(low.head, 165, 'Channel headers are 30% narrower');
    assert.equal(await page.locator('main:not([hidden])').evaluate(el => getComputedStyle(el).maxWidth), '1294px');
    // Zoom in, pan far right, then shrink: a stale viewport canvas must not keep the
    // scroll extent alive or let sticky headers slide away from their fixed column.
    for (let i = 0; i < 9; i++) { await ui.getByLabel('Zoom in', { exact: true }).click(); await settle(); }
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; }); await settle();
    for (let i = 0; i < 12; i++) { await ui.getByLabel('Zoom out', { exact: true }).click(); await settle(); }
    const afterPan = await geometry();
    assert.equal(afterPan.scrollLeft, 0, 'Zooming out after panning clamps to the real timeline');
    assert.ok(afterPan.scrollWidth <= afterPan.viewport + 1, 'Canvas cannot create phantom scroll space');
    assert.ok(Math.abs(afterPan.waveX - afterPan.scrollX - 1) < 1, 'Wave canvas stays aligned with its viewport');
    // Drawing: library click selects without adding, blank click places, existing clip
    // remains draggable; all copies use the source audio and clip settings.
    assert.equal(await ui.locator('.pl-tools > button').first().getAttribute('aria-label'), 'Draw tool');
    assert.equal(await ui.getByLabel('Draw tool', { exact: true }).getAttribute('aria-pressed'), 'true');
    for (let i = 0; i < 7; i++) { await ui.getByLabel('Zoom in', { exact: true }).click(); await settle(); }
    await scroll.evaluate(el => { el.scrollLeft = 0; }); await settle();
    const state = () => page.evaluate(() => editor.snapshot());
    const lanePoint = async (seconds, row = 0, dy = 36) => {
      const box = await ui.locator('.pl-lane').nth(row).boundingBox();
      const zoom = await ui.locator('.pl-grid').evaluate(el => parseFloat(el.style.getPropertyValue('--beat')) * 2);
      return { x: box.x + seconds * zoom, y: box.y + dy };
    };
    const clickAt = async (seconds, row = 0) => {
      let p = await lanePoint(seconds, row); const view = await scroll.boundingBox();
      if (p.x >= view.x + view.width - 2 || p.x < view.x + 165) {
        await scroll.evaluate((el, delta) => { el.scrollLeft += delta; }, p.x - view.x - view.width / 2); await settle(); p = await lanePoint(seconds, row);
      }
      await page.mouse.click(p.x, p.y); await settle();
    };
    const range = async (start, end, row = 0, lastRow = row) => {
      const a = await lanePoint(start, row), b = await lanePoint(end, lastRow);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await settle();
    };
    await ui.locator('.pl-shelf button').first().click();
    assert.equal((await state()).clips.length, 1, 'Selecting a library sample does not place an extra clip');
    await clickAt(1);
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1]);
    await ui.getByRole('slider', { name: 'Pitch', exact: true }).press('ArrowUp');
    await clickAt(1.5);
    assert.equal((await state()).clips.at(-1).pitch, 1, 'Drawing a selected clip retains its pitch');
    await scroll.focus(); await page.keyboard.press('Control+z');
    assert.equal((await state()).clips.length, 2, 'Drawing is one undo step');
    await page.keyboard.press('Control+y'); assert.equal((await state()).clips.length, 3);
    await page.keyboard.press('Control+z');
    // Dragging a clip sticks its start to the 1/8 grid (.25 s at 120 BPM); Alt moves it freely.
    const dragClip = async (from, to, alt) => {
      const a = await lanePoint(from), b = await lanePoint(to);
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
      await settle();
    };
    // Zoomed in so the 0.1 s clip is wider than its two trim handles.
    for (let i = 0; i < 3; i++) { await ui.getByLabel('Zoom in', { exact: true }).click(); await settle(); }
    await scroll.evaluate(el => { el.scrollLeft = 0; }); await settle();
    await dragClip(1.05, 1.42, false);
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1.25], 'The clip lands on the grid');
    await dragClip(1.3, 1.37, true);
    assert.ok(Math.abs((await state()).clips[1].at - 1.32) < .01, 'Alt places the clip freely: ' + (await state()).clips[1].at);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1]);
    for (let i = 0; i < 3; i++) { await ui.getByLabel('Zoom out', { exact: true }).click(); await settle(); }
    await scroll.evaluate(el => { el.scrollLeft = 0; }); await settle();
    // Range 0..2 has silence on both sides of the snares; repeat it twice.
    await ui.getByLabel('Time selection tool', { exact: true }).click();
    await range(0, 2);
    assert.equal(await ui.locator('.pl-marquee:not([hidden])').count(), 1, 'Time selection remains visible after release');
    await page.keyboard.press('Control+d');
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1, 2.5, 3]);
    await page.keyboard.press('Control+d');
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1, 2.5, 3, 4.5, 5]);
    await page.keyboard.press('Control+c');
    await clickAt(6);
    await page.keyboard.press('Control+v');
    assert.deepEqual((await state()).clips.map(c => c.at), [.5, 1, 2.5, 3, 4.5, 5, 6.5, 7]);
    await page.keyboard.press('Control+z'); assert.equal((await state()).clips.length, 6);
    await page.keyboard.press('Control+y'); assert.equal((await state()).clips.length, 8);
    // Copying with nothing selected keeps the previous copy.
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    assert.equal((await state()).clips.length, 10, 'An empty Ctrl+C does not clear the clipboard');
    await page.keyboard.press('Control+z'); assert.equal((await state()).clips.length, 8);
    // Whole groups duplicate with their spacing even without an explicit time range.
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+d');
    assert.equal((await state()).clips.length, 16, 'Duplicate applies to every selected clip');
    await page.keyboard.press('Control+z');
    // Cross-track range copying keeps relative rows, leading silence and pitch.
    await ui.getByLabel('Draw tool', { exact: true }).click();
    await ui.locator('.pl-shelf button').first().click(); await clickAt(.75, 1);
    await ui.getByLabel('Time selection tool', { exact: true }).click(); await range(0, 2, 0, 1);
    await page.keyboard.press('Control+c'); await clickAt(8, 0); await page.keyboard.press('Control+v');
    const multi = (await state()).clips.slice(-3);
    assert.deepEqual(multi.map(c => c.at), [8.5, 9, 8.75]);
    assert.equal(new Set(multi.map(c => c.track)).size, 2);
    assert.equal(multi[1].pitch, 1);
    // Canceling a range gesture restores the prior range and selection.
    const beforeCancel = await ui.locator('.pl-marquee').getAttribute('style');
    const p = await lanePoint(3); await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y);
    await ui.locator('.pl-lane').first().dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
    assert.equal(await ui.locator('.pl-marquee').getAttribute('style'), beforeCancel);
    // Selecting only silence still carries a duration and can be repeated or copied.
    await scroll.evaluate(el => { el.scrollLeft = 0; }); await settle();
    const countBeforeSilence = (await state()).clips.length;
    await range(2, 4, 1);
    const rangeSize = () => ui.locator('.pl-marquee').evaluate(el => ({ left: parseFloat(el.style.left), width: parseFloat(el.style.width) }));
    const emptyRange = await rangeSize();
    await page.keyboard.press('Control+d');
    const repeatedSilence = await rangeSize();
    assert.ok(Math.abs(repeatedSilence.left - emptyRange.left - emptyRange.width) < .01);
    await page.keyboard.press('Control+c'); await clickAt(6, 1); await page.keyboard.press('Control+v');
    assert.equal((await state()).clips.length, countBeforeSilence, 'Copying silence does not manufacture a sample');
    assert.ok(Math.abs((await rangeSize()).width - emptyRange.width) < .01, 'Silent range retains its duration on paste');
    // Partial audio selections really crop the copied sound at both edges.
    await page.evaluate(() => {
      editor.setPatterns([{ id: 'long-pattern', name: 'Long pattern', buffer: new AudioBuffer({ length: 88200, sampleRate: 44100 }) }]);
      editor.edit(state => { state.clips[0].asset = 'long-pattern'; state.clips[0].out = 2; });
    });
    await scroll.evaluate(el => { el.scrollLeft = 0; }); await settle();
    await range(.75, 1, 0); await page.keyboard.press('Control+c'); await clickAt(3, 1); await page.keyboard.press('Control+v');
    const cropped = (await state()).clips.at(-1);
    assert.deepEqual([cropped.at, cropped.in, cropped.out], [3, .25, .5]);
    // A paste that exceeds the arrangement limit is atomic and reports the problem.
    const beforeLimit = (await state()).clips;
    await page.evaluate(() => editor.seek(300)); await scroll.focus(); await page.keyboard.press('Control+v');
    assert.deepEqual((await state()).clips, beforeLimit);
    assert.match(await page.locator('.ui-toast-title').filter({ hasText: '5 minutes' }).first().textContent(), /5 minutes/);
    // Global modes work without a selection and apply only when an edit is made.
    await page.evaluate(() => {
      const buffer = new AudioBuffer({ length: 176400, sampleRate: 44100 });
      editor.edit(state => { state.clips = []; });
      editor.setSession({ sources: ['drums', 'bass'].map(stem => ({ id: `audio-${stem}`, stem, name: stem, buffer })) });
      editor.edit(state => { for (const clip of state.clips) { clip.at = .5; clip.in = .5; clip.out = 2.5; } });
    });
    await ui.getByLabel('Show the whole arrangement', { exact: true }).click(); await settle();
    for (let i = 0; i < 2; i++) { await ui.getByLabel('Zoom out', { exact: true }).click(); await settle(); }
    await scroll.focus(); await page.keyboard.press('Escape');
    const editMode = ui.locator('.pl-edit-mode'), pitchMode = ui.locator('.pl-pitch-mode');
    assert.equal(await editMode.isEnabled(), true);
    assert.equal(await pitchMode.isEnabled(), true);
    const unedited = (await state()).clips;
    for (const mode of ['slip', 'stretch', 'move']) {
      await editMode.click(); assert.equal(await editMode.getAttribute('data-mode'), mode);
    }
    await pitchMode.click(); assert.equal(await pitchMode.textContent(), 'Resample');
    await page.keyboard.press('h'); assert.equal(await pitchMode.textContent(), 'Stretch');
    await page.keyboard.press('e'); assert.equal(await editMode.getAttribute('data-mode'), 'slip');
    for (const [key, mode] of [['3', 'stretch'], ['2', 'slip'], ['1', 'move']]) {
      await page.keyboard.press(key); assert.equal(await editMode.getAttribute('data-mode'), mode);
    }
    for (const [key, mode] of [['5', 'resample'], ['4', 'stretch']]) {
      await page.keyboard.press(key); assert.equal(await pitchMode.getAttribute('data-mode'), mode);
    }
    assert.deepEqual((await state()).clips, unedited, 'Mode selection never changes clips');
    await page.keyboard.press('Control+z');
    assert.ok((await state()).clips.every(clip => clip.in === 0), 'Mode changes do not add undo entries');
    await page.keyboard.press('Control+y');
    // The hotkeys must not steal numeric input, modified browser shortcuts or key repeats.
    await ui.evaluate(el => { const input = document.createElement('input'); input.id = 'mode-input-check'; el.append(input); input.focus(); });
    await page.keyboard.press('2');
    assert.equal(await editMode.getAttribute('data-mode'), 'move');
    await ui.locator('#mode-input-check').evaluate(el => el.remove()); await scroll.focus();
    await page.keyboard.press('Alt+2');
    assert.equal(await editMode.getAttribute('data-mode'), 'move');
    await scroll.dispatchEvent('keydown', { key: 'e', repeat: true });
    assert.equal(await editMode.getAttribute('data-mode'), 'move');
    await page.keyboard.press('c'); await page.keyboard.press('2');
    assert.equal(await ui.getByLabel('Slice tool', { exact: true }).getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('q'); await page.keyboard.press('3');
    assert.equal(await ui.getByLabel('Time selection tool', { exact: true }).getAttribute('aria-pressed'), 'false');
    const gesture = async (row, edge, seconds, cancel = false) => {
      const clip = ui.locator('.pl-clip').nth(row), target = edge ? clip.locator(`[data-edge="${edge}"]`) : clip;
      const box = await target.boundingBox(), a = await lanePoint(0), b = await lanePoint(seconds);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + b.x - a.x, y, { steps: 6 });
      if (cancel) await clip.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up(); await settle();
    };
    await page.keyboard.press('2'); await gesture(0, null, .25);
    let edited = (await state()).clips;
    assert.ok(Math.abs(edited[0].in - .75) < .01 && Math.abs(edited[0].out - 2.75) < .01, 'Slip shifts the source window');
    assert.equal(edited[0].at, .5, 'Slip retains the timeline position');
    assert.deepEqual(edited[1], unedited[1], 'Slip leaves the other track intact');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('1'); await gesture(0, 'right', -.25);
    edited = (await state()).clips;
    assert.equal(edited[0].out, 2.25, 'Move / trim trims the source edge');
    assert.equal(edited[0].speed, 1);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('3'); await page.keyboard.press('5');
    await gesture(0, 'right', .5, true);
    assert.deepEqual((await state()).clips, unedited, 'Canceling stretch restores the source, mode and speed');
    await gesture(0, 'right', .5);
    edited = (await state()).clips;
    assert.equal(edited[0].keepLength, false, 'The gesture applies the global Resample mode');
    assert.ok(Math.abs(edited[0].speed - .8) < .001);
    assert.equal(edited[0].out, 2.5, 'Stretch retains the source range');
    assert.deepEqual(edited[1], unedited[1], 'Stretch leaves the other track intact');
    await page.keyboard.press('4');
    assert.deepEqual((await state()).clips, edited, 'Changing pitch mode does not retroactively alter audio');
    await gesture(1, 'right', .5);
    let both = (await state()).clips;
    assert.equal(both[1].keepLength, true, 'The same tool applies the new global mode on another track');
    assert.ok(Math.abs(both[1].speed - .8) < .001);
    assert.deepEqual(both[0], edited[0]);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.deepEqual((await state()).clips, unedited, 'One undo restores each gesture including its pitch mode');
    // Pitch, fine pitch and speed knobs also use the chosen global mode.
    await page.keyboard.press('1'); await page.keyboard.press('5');
    await ui.locator('.pl-clip').first().click();
    await ui.getByRole('slider', { name: 'Pitch', exact: true }).press('ArrowUp');
    both = (await state()).clips;
    assert.equal(both[0].keepLength, false); assert.equal(both[0].pitch, 1);
    assert.deepEqual(both[1], unedited[1]);
    await page.keyboard.press('4');
    await ui.getByRole('slider', { name: 'Fine pitch', exact: true }).press('ArrowUp');
    assert.equal((await state()).clips[0].keepLength, true);
    await page.keyboard.press('5'); await page.keyboard.press('Control+a');
    await ui.getByRole('slider', { name: 'Speed', exact: true }).press('ArrowUp');
    assert.ok((await state()).clips.every(clip => !clip.keepLength && clip.speed === 1.01), 'Multi-selection edits apply the chosen mode to every target');
    // Repaint after resizing even if the CSS header breakpoint did not change.
    for (let i = 0; i < 14; i++) { await ui.getByLabel('Zoom out', { exact: true }).click(); await settle(); }
    for (const width of [1000, 1400, 390, 320, 1600]) {
      await page.setViewportSize({ width, height: 1100 }); await settle();
      const g = await geometry();
      assert.ok(g.laneRight >= g.scrollRight - 2, `Grid covers viewport at ${width}px`);
      assert.ok(Math.abs(g.headX - g.scrollX - 1) < 1, `Headers pinned at ${width}px`);
    }
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await ui.screenshot({ path: path.join(artifacts, 'playlist-editing-min-zoom.png') });
    assert.deepEqual(errors, []);
    console.log('Playlist editing browser test passed.');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
