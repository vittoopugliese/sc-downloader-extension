// Real pointer input against the shared number control, without audio or playlist work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<style>body{padding:200px}.ui-drag-number-value{display:inline-block;width:70px;height:32px;touch-action:none}</style>');
    const source = fs.readFileSync(path.join(__dirname, 'ui-drag-number.mjs')).toString('base64');
    await page.evaluate(async source => {
      const { createDragNumber } = await import(`data:text/javascript;base64,${source}`);
      window.changes = []; window.ends = 0;
      window.number = createDragNumber({ label: 'BPM', min: 20, max: 300, value: 120,
        onInput(value) { changes.push(value); number.show(value); }, // The host echoes its state on redraw.
        onEnd() { ends++; } });
      document.body.append(number.wrap);
    }, source);
    const bpm = page.getByRole('spinbutton', { name: 'BPM' }), box = await bpm.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const read = () => bpm.evaluate(e => ({ shown: e.textContent, value: e.getAttribute('aria-valuenow') }));
    const expectValue = async (value, message) => assert.deepEqual(await read(), { shown: String(value), value: String(value) }, message);
    await page.mouse.move(x, y); await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(x, y - step * 4);
      await expectValue(120 + step, 'Digits must follow every move while the pointer is still down');
    }
    await page.mouse.move(x, y - 24);
    await expectValue(126, 'Reversing the drag immediately lowers the displayed number');
    await page.keyboard.down('Shift'); await page.mouse.move(x, y - 40);
    await expectValue(127, 'Fine dragging shows one BPM per 16 px');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => ends), 0, 'No commit before release');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => ends), 1);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ui-drag-number-dragging')), false);
    await page.waitForTimeout(260);
    await expectValue(127, 'No stale animation changes the number after release');

    // Undo/tap/load updates may animate, but grabbing the number must catch up
    // immediately, even when show() gets the same target as a pending animation.
    await page.evaluate(() => number.show(180));
    assert.equal(await bpm.getAttribute('aria-valuenow'), '180');
    assert.notEqual(await bpm.textContent(), '180', 'External changes retain their count animation');
    await page.mouse.move(x, y); await page.mouse.down();
    await expectValue(180, 'Starting a drag finishes any pending external animation');
    await page.mouse.move(x, y - 4); await expectValue(181);
    await page.mouse.up();

    await bpm.press('ArrowDown'); await expectValue(180, 'Keyboard steps also display immediately');
    await bpm.dispatchEvent('wheel', { deltaY: -30, deltaMode: 0 }); await expectValue(181, 'Wheel steps display immediately');
    await bpm.press('End'); await expectValue(300);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y - 40); await expectValue(300, 'Dragging respects the maximum');
    await page.mouse.move(x, y - 36); await expectValue(299, 'Reversing at a limit responds immediately');
    await page.mouse.up();
    await page.evaluate(() => number.show(150, { animate: false }));
    await expectValue(150);
    await page.waitForTimeout(260); await expectValue(150, 'Explicit immediate updates cancel old animations');
    assert.deepEqual(errors, []);
    console.log('Drag number: live digits, reverse/fine drags, animation interruption, keyboard, wheel and limits passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
