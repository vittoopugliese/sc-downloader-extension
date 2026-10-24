const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const core = `data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, 'stem-automation.mjs')).toString('base64')}`;
    const ui = fs.readFileSync(path.join(__dirname, 'stem-automation-ui.mjs'), 'utf8').replace("'./stem-automation.mjs'", JSON.stringify(core));
    const css = fs.readFileSync(path.join(__dirname, '../assets/stem-automation.css'), 'utf8');
    await page.setContent(`<html lang="es"><style>${css}body{background:#191919;padding:80px}#clip{position:relative;width:400px;height:100px;background:#142124}.pl-menu{position:fixed;background:#eee;padding:8px}.pl-menu-item{display:block}</style><div id="clip" class="pl-automation"><span>Voz · Volumen</span></div></html>`);
    await page.evaluate(async ({ ui, core }) => {
      const { mountAutomationClip } = await import(`data:text/javascript;base64,${ui}`);
      const { newAutomationClip } = await import(core);
      window.transactions = { begin: 0, commit: 0, cancel: 0, changes: 0, parentDrags: 0 };
      window.value = newAutomationClip({ id: 'a', track: 'lane', target: { track: 'voice', param: 'gain' }, duration: 4, value: 1 });
      const container = document.querySelector('#clip');
      container.addEventListener('pointerdown', () => transactions.parentDrags++);
      window.editor = mountAutomationClip({ element: container, clip: value, zoom: 100, height: 81, snap: time => Math.round(time * 4) / 4,
        onBegin() { transactions.begin++; },
        onChange(next) { value = next; transactions.changes++; editor.update(next); },
        onCommit(next) { value = next; transactions.commit++; },
        onCancel(next) { value = next; transactions.cancel++; },
      });
    }, { ui: Buffer.from(ui).toString('base64'), core });
    const envelope = page.locator('.pl-automation-envelope'), box = await envelope.boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * .25);
    assert.equal(await page.locator('[data-point]').count(), 3, 'Double-click adds a snapped point');
    assert.equal(await page.evaluate(() => value.points[1].at), 2);
    const handle = page.locator('[data-point="1"]');
    const countBefore = await page.evaluate(() => ({ ...transactions })), handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .72, box.y + box.height * .75, { steps: 8 });
    assert.equal(await page.evaluate(() => transactions.commit), countBefore.commit, 'Drag preview does not commit history');
    const during = await page.evaluate(() => ({ ...transactions, point: value.points[1] }));
    assert.equal(during.parentDrags, countBefore.parentDrags, 'Point drags do not move the outer clip');
    assert.ok(during.changes > countBefore.changes);
    assert.equal(during.point.at, 3); assert.ok(during.point.value < 1);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => transactions.commit), countBefore.commit + 1, 'One drag is one commit');
    const saved = await page.evaluate(() => structuredClone(value));
    const nextBox = await handle.boundingBox();
    await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .4, box.y + 10);
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => value), saved, 'Escape restores the gesture snapshot');
    await handle.focus(); await page.keyboard.press('ArrowUp');
    assert.ok(await page.evaluate(original => value.points[1].value > original.points[1].value, saved));
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => value.points[1].at), 2.75, 'Keyboard finds the adjacent grid step');
    await page.keyboard.press('h');
    assert.equal(await page.evaluate(() => value.points[1].curve), 'hold');
    await handle.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Lineal', exact: true }).click();
    assert.equal(await page.evaluate(() => value.points[1].curve), 'linear');
    await handle.focus(); await page.keyboard.press('Delete');
    assert.equal(await page.locator('[data-point]').count(), 2);
    await page.locator('[data-point="0"]').focus(); await page.keyboard.press('Delete');
    assert.equal(await page.locator('[data-point]').count(), 2, 'Endpoints cannot be removed');

    // Exercise real Web Audio evaluation, including a ramp and baseline reset
    // sharing the same timestamp. This catches scheduling bugs a fake param cannot.
    const rendered = await page.evaluate(async core => {
      const { scheduleAutomation } = await import(core);
      const ctx = new OfflineAudioContext(1, 5000, 10000), source = ctx.createConstantSource(), gain = ctx.createGain();
      source.offset.value = 1; source.connect(gain).connect(ctx.destination); source.start();
      scheduleAutomation(gain.gain, [{ id: 'audio', track: 'lane', target: { track: 'voice', param: 'gain' }, at: .1, duration: .2,
        points: [{ at: 0, value: 0, curve: 'linear' }, { at: .2, value: 2, curve: 'linear' }] }], { track: 'voice', param: 'gain' }, { from: 0, to: .5, when: 0, baseline: .5 });
      const result = await ctx.startRendering(), samples = result.getChannelData(0);
      return [.05, .15, .2, .25, .35].map(time => samples[Math.round(time * 10000)]);
    }, core);
    for (const [index, expected] of [.5, .5, 1, 1.5, .5].entries()) assert.ok(Math.abs(rendered[index] - expected) < .001, `Offline sample ${index}: ${rendered[index]} ≈ ${expected}`);
    await page.evaluate(() => editor.dispose());
    assert.equal(await envelope.count(), 0); assert.deepEqual(errors, []);
    console.log('Automation: add/drag/grid/keyboard/context menu/undo cancellation, pointer isolation and offline Web Audio passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
