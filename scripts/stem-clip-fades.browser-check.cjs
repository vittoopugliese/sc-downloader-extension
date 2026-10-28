// Fade tool and clip options beside Stretch, on the real Playlist DOM. Expects one selected
// two-second clip; every edit is undone before returning, and the draw tool is restored.
const assert = require('node:assert/strict');

module.exports = async function verifyClipFades(page, ui) {
  const state = () => page.evaluate(() => editor.snapshot());
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const clip = ui.locator('.pl-clip').first();
  const initial = (await state()).clips;
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .03, `${message}: ${actual} ≈ ${expected}`);

  // The lower panel and the fade knobs are gone; the clip options sit beside Stretch.
  assert.equal(await ui.locator('.pl-clip-settings, .pl-clip-details').count(), 0);
  assert.equal(await ui.locator('.pl-inspector .ui-knob', { hasText: 'Fade' }).count(), 0, 'Fades are edited on the clip, not with knobs');
  const options = ui.locator('.pl-clip-options');
  assert.deepEqual(await options.locator('button').evaluateAll(nodes => nodes.map(node => node.classList.contains('pl-pitch-mode') ? 'stretch' : node.classList.contains('pl-normalize') ? 'normalize' : node.classList.contains('pl-follow-tempo') ? 'tempo' : '?')),
    ['stretch', 'normalize', 'tempo']);
  // The fade tool sits between Slip and Slice.
  const order = await ui.locator('.pl-tools > button').evaluateAll(nodes => nodes.map(node => node.className));
  const index = name => order.findIndex(value => value.includes(name));
  assert.equal(index('pl-fade-tool'), index('pl-slip-tool') + 1, 'Fade follows Slip');
  assert.equal(await ui.locator('.pl-tools > button').nth(index('pl-fade-tool') + 1).getAttribute('aria-label'), 'Slice tool', 'Slice follows Fade');

  // Height of the drawn waveform in one column of the clip, in CSS pixels.
  const height = fraction => ui.evaluate((el, fraction) => {
    const canvas = el.querySelector('.pl-wave-layer'), item = el.querySelector('.pl-clip');
    const c = canvas.getBoundingClientRect(), r = item.getBoundingClientRect(), scale = canvas.width / c.width;
    const x = Math.round((r.left + r.width * fraction - c.left) * scale);
    const top = Math.max(0, Math.round((r.top + 20 - c.top) * scale)), bottom = Math.min(canvas.height, Math.round((r.bottom - c.top) * scale));
    const data = canvas.getContext('2d').getImageData(x, top, 1, bottom - top).data;
    let filled = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) filled++;
    return filled / scale;
  }, fraction);

  // Normalizing redraws the waveform at its new level, like FL Studio.
  await settle();
  const quiet = await height(.5);
  await ui.locator('.pl-normalize').click(); await settle();
  assert.equal(await ui.locator('.pl-normalize').getAttribute('aria-pressed'), 'true');
  const loud = await height(.5);
  assert.ok(quiet > 0 && loud > quiet * 4, `Normalized waveform is taller: ${quiet} → ${loud}`);
  await ui.locator('.pl-normalize').click(); await settle();
  assert.ok(Math.abs(await height(.5) - quiet) < 1, 'Turning normalization off restores the waveform');
  // A tall waveform makes the fade shape measurable next to the 1 px fade line.
  await ui.locator('.pl-normalize').click(); await settle();

  // Fade tool: dragging an edge inward fades; the clip itself does not move or trim.
  const fadeTool = ui.locator('.pl-fade-tool');
  await fadeTool.click();
  assert.equal(await fadeTool.getAttribute('aria-pressed'), 'true');
  const box = await clip.boundingBox(), perSecond = box.width / 2;
  const drag = async (target, seconds, { cancel = false } = {}) => {
    const area = await target.boundingBox(), x = area.x + area.width / 2, y = area.y + area.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + seconds * perSecond, y, { steps: 6 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await settle();
  };
  await drag(clip.locator('.pl-edge-left'), .5);
  let edited = (await state()).clips[0];
  near(edited.fadeIn, .5, 'Dragging the start inward sets the fade in');
  assert.deepEqual([edited.at, edited.in, edited.out], [initial[0].at, initial[0].in, initial[0].out], 'Fades never trim or move the clip');
  await drag(clip.locator('.pl-edge-right'), -.25);
  near((await state()).clips[0].fadeOut, .25, 'Dragging the end inward sets the fade out');
  const middle = await height(.5);
  assert.ok(await height(.05) < middle * .5, 'The waveform follows the fade in');
  assert.ok(await height(.97) < middle * .5, 'The waveform follows the fade out');
  // The fade handles keep editing the same fades, from the keyboard too.
  const fadeIn = clip.locator('.pl-fade-handle[data-fade=fadeIn]'), fadeOut = clip.locator('.pl-fade-handle[data-fade=fadeOut]');
  assert.equal(await fadeIn.isVisible(), true);
  await drag(fadeIn, .25);
  near((await state()).clips[0].fadeIn, .75, 'The fade handle moves the fade in');
  await fadeOut.focus(); await page.keyboard.press('ArrowRight');
  near((await state()).clips[0].fadeOut, .26, 'Arrow keys adjust a fade handle');
  // Escape cancels a drag; dragging the clip body in this mode changes nothing.
  const beforeCancel = (await state()).clips;
  await drag(clip.locator('.pl-edge-right'), -.5, { cancel: true });
  assert.deepEqual((await state()).clips, beforeCancel, 'Escape cancels a fade drag');
  await drag(clip.locator('.pl-clip-title'), .4);
  assert.deepEqual((await state()).clips, beforeCancel, 'The fade tool does not move clips');
  await fadeIn.dblclick();
  assert.equal((await state()).clips[0].fadeIn, 0, 'Double-click resets a fade');

  // Leave the fixture as it was: one undo per committed edit, then the draw tool.
  await ui.locator('.pl-scroll').focus();
  for (let i = 0; i < 10 && JSON.stringify((await state()).clips) !== JSON.stringify(initial); i++) await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).clips, initial, 'Every fade edit is undoable');
  await page.keyboard.press('1');
  assert.equal(await fadeTool.getAttribute('aria-pressed'), 'false');
  assert.equal(await fadeIn.isVisible(), false, 'Fade handles show only with the fade tool');
};
