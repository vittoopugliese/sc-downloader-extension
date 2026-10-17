const assert = require('node:assert/strict');

// Channel rack and piano roll as FL Studio plugins: one focused track and pattern,
// patterns as repeating playlist clips, project tempo from the playlist.
module.exports = async function verifyInstruments(page) {
  await page.locator('#separate:not(:disabled)').click();
  await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
  const rack = page.locator('#stem-rack'), piano = page.locator('#stem-piano-roll'), playlist = page.locator('#playlist');
  // Five modules, including FXs: closed until opened from the toolbar, a key or a track menu.
  assert.equal(await page.locator('.module-window').count(), 5);
  assert.equal(await page.locator('.module-window:visible').count(), 0, 'Windows start closed');
  // Docked windows keep the old order under the playlist: rack and piano roll before EQ and recorder.
  const dock = async section => { await section.locator('.module-control').first().click(); assert.equal(await section.evaluate(node => node.parentElement.id), 'mix-tools'); };
  for (const removed of ['.piano-bpm', '.piano-half', '.piano-double', '.piano-align', '.piano-velocity', '.piano-mode', '.seq-bpm'])
    assert.equal(await page.locator(removed).count(), 0, `${removed} is gone`);

  // Focusing a whole bass stem slices it at once and exposes eight playable pads.
  { await page.locator('.pl-stem-head[data-stem=bass] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
  assert.equal(await rack.evaluate(node => node.classList.contains('is-floating')), true, 'The track menu opens a floating channel rack');
  await dock(rack);
  await rack.locator('.rack-view-chops').click();
  assert.equal(await rack.locator('.plugin-track').inputValue(), 'bass');
  const wave = rack.locator('.rack-wave'), pads = rack.locator('.rack-pad');
  await page.waitForFunction(() => document.querySelectorAll('#stem-rack .rack-pad.is-assigned').length > 0, null, { timeout: 5000 });
  assert.ok(await rack.locator('.rack-pad.is-assigned').count() >= 2, 'Opening an untouched track slices it into pads');
  // Right-click arms pad K; a drag on the rack's waveform cuts its sample there.
  await pads.nth(7).click({ button: 'right' });
  assert.equal(await pads.nth(7).evaluate(node => node.classList.contains('is-armed')), true);
  let box = await wave.boundingBox();
  await page.mouse.move(box.x + box.width * .1, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .2, box.y + 40, { steps: 5 }); await page.mouse.up();
  assert.equal(await pads.nth(7).evaluate(node => node.classList.contains('is-assigned')), true);
  // Pads A–J are filled by auto-slice or by hand, so every row can hold hits.
  for (let row = 0; row < 7; row++) if (!await pads.nth(row).evaluate(node => node.classList.contains('is-assigned'))) {
    await pads.nth(row).click();
    await wave.click({ position: { x: 20 + row * 30, y: 40 } });
  }
  assert.equal(await rack.locator('.rack-pad.is-assigned').count(), 8);
  const before = await page.evaluate(() => stemTestSources.length);
  await page.locator('body').press('a');
  assert.equal(await page.evaluate(() => stemTestSources.length), before + 1, 'The A key plays pad A of the focused track');

  // A first hit creates the pattern; dragging a hit changes its velocity.
  const cell = (row, column) => rack.locator(`.rack-step[data-row="${row}"][data-column="${column}"]`);
  await cell(0, 0).click();
  assert.equal(await rack.locator('.plugin-pattern .row-menu-value').textContent(), 'Pat 1');
  assert.equal(await cell(0, 0).getAttribute('data-velocity'), '0.8');
  box = await cell(0, 0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 4 }); await page.mouse.up();
  assert.equal(await cell(0, 0).getAttribute('data-velocity'), '0.3', 'Drag down lowers the velocity');
  await cell(1, 4).click();
  assert.equal(await cell(1, 4).getAttribute('data-velocity'), '0.3', 'New hits take the last velocity');
  await cell(2, 8).click(); await cell(2, 8).click({ button: 'right' });
  assert.equal(await cell(2, 8).getAttribute('data-velocity'), '0', 'Right-click removes a hit');
  const shelf = playlist.locator('.pl-shelf button.is-pattern');
  assert.deepEqual(await shelf.allTextContents(), ['Bajo · Pat 1']);

  // PAT: the rack previews its pattern alone; the playlist stays stopped.
  await rack.locator('.plugin-play').click();
  await page.waitForFunction(() => document.querySelector('#stem-rack .plugin-play').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => document.querySelector('#stem-rack .rack-beat.is-current'));
  assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#stem-rack .plugin-play').getAttribute('aria-pressed') === 'false');
  await page.locator('#play').click();

  // SONG: the pattern becomes a clip on a free track and repeats when stretched.
  await rack.locator('.rack-place').click();
  const clip = playlist.locator('.pl-clip.is-pattern');
  assert.equal(await clip.count(), 1);
  const single = await clip.boundingBox();
  const edge = clip.locator('.pl-edge-right'), grip = await edge.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(grip.x + 2, grip.y + 10); await page.mouse.down();
  await page.mouse.move(grip.x + 2 + single.width * 2, grip.y + 10, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Alt');
  const repeated = await clip.boundingBox();
  assert.ok(Math.abs(repeated.width - single.width * 3) < 4, `Stretched clip repeats the pattern: ${single.width} → ${repeated.width}`);
  const playing = await page.evaluate(async () => {
    const start = stemTestSources.length; document.querySelector('#play').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    const sources = stemTestSources.slice(start).filter(source => source.testStart && source.buffer?.duration < 5);
    document.querySelector('#play').click();
    return sources.length;
  });
  assert.ok(playing >= 1, 'The pattern clip plays in the song');

  // Tempo lives in the playlist: pattern clips keep their bars.
  const tempo = page.locator('#transport .pl-toolbar input[type=number]');
  await tempo.fill('60'); await tempo.press('Enter');
  const slow = await clip.boundingBox();
  assert.ok(Math.abs(slow.width - repeated.width * 2) < 6, `Half tempo doubles the clip: ${repeated.width} → ${slow.width}`);
  await page.locator('#playlist .pl-tools button[aria-keyshortcuts="Control+Z"]').click();
  assert.equal(await tempo.inputValue(), '120');

  // Piano roll: same track and pattern; the next note copies the last clicked one.
  { await page.locator('.pl-stem-head[data-stem=bass] .stem-more').click(); await page.locator('.pl-menu-item').nth(1).click(); }
  await dock(piano);
  assert.deepEqual(await page.locator('#mix-tools > section:visible').evaluateAll(nodes => nodes.map(node => node.id)), ['stem-rack', 'stem-piano-roll']);
  assert.equal(await piano.locator('.plugin-track').inputValue(), 'bass');
  assert.equal(await piano.locator('.plugin-pattern .row-menu-value').textContent(), 'Pat 1');
  const grid = piano.locator('.piano-grid');
  async function at(pitch, step) {
    await grid.locator(`.piano-pitch-row[data-pitch="${pitch}"]`).scrollIntoViewIfNeeded();
    const rect = await grid.boundingBox();
    return { x: rect.x + rect.width * (step + .3) / 16, y: rect.y + (72 - pitch) * 22 + 11 };
  }
  let point = await at(60, 0);
  await page.mouse.click(point.x, point.y);
  const notes = piano.locator('.piano-note');
  assert.equal(await notes.count(), 1);
  assert.equal(await notes.first().getAttribute('data-length'), '1');
  let end = await notes.first().locator('.piano-note-end').boundingBox(), width = (await grid.boundingBox()).width;
  await page.mouse.move(end.x + 3, end.y + 10); await page.mouse.down();
  await page.mouse.move(end.x + 3 + width / 16 * 3, end.y + 10, { steps: 4 }); await page.mouse.up();
  assert.equal(await notes.first().getAttribute('data-length'), '4');
  point = await at(64, 4); await page.mouse.click(point.x, point.y);
  assert.equal(await notes.nth(1).getAttribute('data-length'), '4', 'A new note takes the length of the last edited note');
  // Alt + drag up on a note raises its velocity; the note shows it.
  const first = await notes.first().boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(first.x + 12, first.y + 10); await page.mouse.down();
  await page.mouse.move(first.x + 12, first.y - 10, { steps: 4 }); await page.mouse.up();
  await page.keyboard.up('Alt');
  assert.equal(await notes.first().getAttribute('data-velocity'), '0.97');
  assert.equal(await notes.first().getAttribute('data-pitch'), '60', 'Velocity drags never change the pitch');
  assert.equal(await notes.first().evaluate(node => node.style.getPropertyValue('--note-velocity')), '0.97');
  // Clicking a note (no drag) makes it the template for the next one.
  await notes.nth(1).evaluate(node => node.scrollIntoView({ block: 'center' }));
  const second = await notes.nth(1).boundingBox();
  await page.mouse.click(second.x + 8, second.y + 10);
  point = await at(67, 9); await page.mouse.click(point.x, point.y);
  assert.deepEqual([await notes.nth(2).getAttribute('data-length'), await notes.nth(2).getAttribute('data-velocity')], ['4', '0.8']);
  assert.equal(await notes.count(), 3);
  await piano.locator('.piano-undo').click();
  assert.equal(await notes.count(), 2);

  const artifacts = require('node:path').join(__dirname, '../test-results/stem-instruments'); require('node:fs').mkdirSync(artifacts, { recursive: true });
  await rack.screenshot({ path: require('node:path').join(artifacts, 'rack.png') });
  await piano.screenshot({ path: require('node:path').join(artifacts, 'piano.png') });
  await playlist.screenshot({ path: require('node:path').join(artifacts, 'playlist.png') });
  // Changing channel keeps the pattern; creating another is an explicit action.
  await rack.locator('.plugin-track').selectOption('drums');
  assert.notEqual(await rack.locator('.plugin-pattern .row-menu-toggle').evaluate(node => node.value), '');
  await rack.locator('.plugin-new').click();
  await page.waitForFunction(() => document.querySelectorAll('#stem-rack .rack-pad.is-assigned').length > 0, null, { timeout: 5000 }).catch(() => {});
  if (!await rack.locator('.rack-pad.is-assigned').count()) { await pads.first().click(); await wave.click({ position: { x: 30, y: 40 } }); }
  const assigned = Number(await rack.locator('.rack-pad.is-assigned').first().evaluate(node => [...node.parentElement.querySelectorAll('.rack-pad')].indexOf(node)));
  await cell(assigned, 2).click();
  assert.deepEqual(await shelf.allTextContents(), ['Bajo · Pat 1', 'Batería · Pat 2']);
  // Patterns are deleted from their row in the menu, without opening them.
  await rack.locator('.plugin-pattern .row-menu-toggle').click();
  await rack.locator('.plugin-pattern .row-menu-row').last().locator('.row-menu-delete').click();
  assert.deepEqual(await shelf.allTextContents(), ['Bajo · Pat 1']);

  // Clear All empties every pad of the focused track; a second click restores them, and a
  // cleared track is not auto-sliced again when it is focused later.
  const clearAll = rack.locator('.rack-clear-slices');
  assert.equal(await clearAll.getAttribute('title'), 'Borrar todos los cortes');
  await clearAll.click();
  assert.equal(await rack.locator('.rack-pad.is-assigned').count(), 0);
  assert.equal(await clearAll.getAttribute('aria-pressed'), 'true');
  await clearAll.click();
  assert.ok(await rack.locator('.rack-pad.is-assigned').count() > 0, 'Restore brings the slices back');
  await clearAll.click();
  await rack.locator('.plugin-track').selectOption('bass'); await rack.locator('.plugin-track').selectOption('drums');
  await page.waitForTimeout(300);
  assert.equal(await rack.locator('.rack-pad.is-assigned').count(), 0, 'A cleared track stays empty');

  // An imported one-shot (an 808) is stored with the separation.
  const rate = 44100, kick = Buffer.alloc(44 + rate * 2);
  kick.write('RIFF'); kick.writeUInt32LE(kick.length - 8, 4); kick.write('WAVEfmt ', 8); kick.writeUInt32LE(16, 16); kick.writeUInt16LE(1, 20); kick.writeUInt16LE(1, 22);
  kick.writeUInt32LE(rate, 24); kick.writeUInt32LE(rate * 2, 28); kick.writeUInt16LE(2, 32); kick.writeUInt16LE(16, 34); kick.write('data', 36); kick.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) kick.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 55 * i / rate) * 20000 * Math.exp(-i / rate * 3)), 44 + i * 2);
  await page.locator('#transport input[type=file]').setInputFiles({ name: '808.wav', mimeType: 'audio/wav', buffer: kick });
  await playlist.locator('.pl-shelf button', { hasText: '808.wav' }).waitFor();

  // Presets keep instruments, patterns and their clips.
  await page.locator('#save-locally').click(); await page.locator('#save-name').fill('Patterns');
  await page.locator('#save-confirm').click();
  await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
  const id = await page.locator('#stem-presets').evaluate(node => node.value);
  const saved = await page.evaluate(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    return (await (await StemPresets.current()).load(id)).record.settings;
  }, id);
  assert.equal(saved.patterns.length, 1); assert.equal(saved.patterns[0].notes.length, 2);
  assert.equal(saved.instruments.bass.slices.filter(Boolean).length, 8);
  assert.equal(saved.instruments.drums.slices.filter(Boolean).length, 0); assert.equal(saved.instruments.drums.sliced, true, 'Cleared pads are saved as cleared');
  assert.equal(saved.playlist.clips.filter(clip => clip.asset.startsWith('pattern:')).length, 1);
  assert.deepEqual(saved.playlist.samples.map(sample => sample.name), ['808.wav']);
  // Its audio is written next to the stems, before the page can go away.
  await page.waitForFunction(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    return Object.keys((await (await StemPresets.current()).load(id)).samples).length === 1;
  }, id);
  await page.reload();
  await page.locator('#stem-presets:not(:disabled)').waitFor(); await page.locator('#stem-presets').click(); await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
  // Off-screen clips are virtualized: bring the user track into view.
  await page.locator('.pl-user-head').waitFor(); await page.locator('.pl-user-head').scrollIntoViewIfNeeded();
  await playlist.locator('.pl-clip.is-pattern').waitFor();
  await playlist.locator('.pl-shelf button', { hasText: '808.wav' }).waitFor();
  assert.ok(await playlist.locator('.pl-clip', { hasText: '808.wav' }).count() >= 1, 'The imported sample comes back with its clip');
  // Zoom fits the session on load: compare with the 3 s stem clip instead of pixels.
  const stemClip = await playlist.locator('.pl-clip:not(.is-pattern)').first().boundingBox();
  const restored = await playlist.locator('.pl-clip.is-pattern').boundingBox();
  assert.ok(Math.abs(restored.width / stemClip.width - 2) < .05, `The 3-bar clip (6 s) survives a fresh page: ${restored.width / stemClip.width}`);
  { await page.locator('.pl-stem-head[data-stem=bass] .stem-more').click(); await page.locator('.pl-menu-item').nth(1).click(); }
  assert.equal(await piano.locator('.piano-note').count(), 2);
  { await page.locator('.pl-stem-head[data-stem=bass] .stem-more').click(); await page.locator('.pl-menu-item').nth(0).click(); }
  assert.equal(await rack.locator('.rack-grid .rack-step.is-on').count(), 2);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Plugins fit ${width}px`);
    await rack.screenshot({ path: require('node:path').join(artifacts, `rack-${width}.png`) });
  }
  console.log('Instruments: auto-sliced pads, keyboard, step velocity drags, PAT preview, repeating pattern clips, tempo retiming, piano note template, Alt velocity, per-track patterns and presets passed.');
};
