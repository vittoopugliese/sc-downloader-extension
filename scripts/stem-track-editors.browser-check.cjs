const assert = require('node:assert/strict');

module.exports = async function verifyTrackEditors(page) {
  await page.locator('#separate:not(:disabled)').click();
  await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
  const head = key => page.locator(`.pl-track-head[data-stem="${key}"]`);
  const drawer = key => page.locator(`.pl-drawer[data-stem="${key}"]`);
  for (const key of ['original', 'drums', 'bass', 'other', 'vocals']) {
    assert.equal(await head(key).locator('.stem-sequencer-toggle:enabled').count(), 1);
    assert.equal(await head(key).locator('.stem-piano-toggle:enabled').count(), 1);
  }
  async function melody(key, pitch = 60) {
    await head(key).locator('.stem-piano-toggle').click();
    const wave = page.locator(`.pl-source-wave[data-stem="${key}"]`);
    await wave.scrollIntoViewIfNeeded();
    const rect = await wave.boundingBox();
    await page.mouse.move(rect.x + rect.width * .1, rect.y + 35); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .2, rect.y + 35, { steps: 5 }); await page.mouse.up();
    const grid = drawer(key).locator('.piano-grid');
    await grid.locator(`[data-pitch="${pitch}"]`).scrollIntoViewIfNeeded();
    const bounds = await grid.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 32, bounds.y + (72 - pitch) * 22 + 11);
    assert.equal(await drawer(key).locator('.piano-note').count(), 1);
  }
  await melody('bass'); await melody('drums', 64);
  assert.equal(await drawer('other').locator('.piano-note').count(), 0, 'Notes belong to their track');
  await drawer('bass').locator('.piano-double').click();
  assert.equal(await drawer('bass').locator('.seq-bpm').inputValue(), '240');
  assert.equal(await drawer('drums').locator('.seq-bpm').inputValue(), '120', 'Grid edits do not change another track');
  await head('vocals').locator('.stem-sequencer-toggle').click();
  await drawer('vocals').locator('.seq-pad').first().click();
  await page.locator('.pl-source-wave[data-stem=vocals]').click({ position: { x: 40, y: 35 } });
  await drawer('vocals').locator('.seq-step').first().click();
  assert.equal(await drawer('bass').locator('.seq-step[aria-pressed=true]').count(), 0);

  await page.getByRole('button', { name: 'Agregar pista', exact: true }).click();
  const user = page.locator('.pl-user-head').last(), key = await user.getAttribute('data-stem');
  assert.equal(await user.locator('.stem-sequencer-toggle').isDisabled(), true);
  assert.equal(await user.locator('.stem-piano-toggle').isDisabled(), true);
  // Drop a shared source on the new lane: editors become usable without a reload.
  const lane = page.locator(`.pl-lane[data-track="${key}"]`);
  await lane.evaluate(element => {
    const dataTransfer = new DataTransfer(); dataTransfer.setData('application/x-stem-sample', 'audio-bass');
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: element.getBoundingClientRect().left + 1, dataTransfer }));
  });
  assert.equal(await head(key).locator('.stem-piano-toggle').isEnabled(), true);
  await melody(key, 67);
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  assert.equal(new Set(ids).size, ids.length, 'Each editor and sample panel has a unique ID');
  await head(key).locator('.pl-track-name').fill('My melody');
  await head(key).locator('.pl-track-name').press('Tab');
  assert.equal(await drawer(key).locator('.piano-note').count(), 1, 'Renaming retains editor state');

  await page.locator('#save-locally').click(); await page.locator('#save-name').fill('All track editors');
  await page.locator('#save-confirm').click();
  await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
  const id = await page.locator('#stem-presets').inputValue();
  const saved = await page.evaluate(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    return (await (await StemPresets.current()).load(id)).record.settings;
  }, id);
  assert.equal(saved.trackEditors.bass.piano.notes[0].pitch, 60);
  assert.equal(saved.trackEditors.drums.piano.notes[0].pitch, 64);
  assert.equal(saved.trackEditors[key].piano.notes[0].pitch, 67);
  await page.reload();
  await page.locator('#stem-presets:not(:disabled)').waitFor(); await page.locator('#stem-presets').selectOption(id);
  await drawer(key).locator('.piano-note').waitFor();
  assert.equal(await head(key).locator('.pl-track-name').inputValue(), 'My melody');
  assert.equal(await drawer(key).locator('.piano-note').getAttribute('data-pitch'), '67', 'New track notes survive a fresh page');
  assert.equal(await drawer('bass').locator('.piano-note').getAttribute('data-pitch'), '60');

  // Multiple open samplers route shortcuts to the active track only.
  for (const name of ['bass', 'drums']) {
    await head(name).locator('.stem-sampler-toggle').click();
    await drawer(name).locator('.stem-sampler').first().locator('.drum-pad').first().click();
    await page.locator(`.pl-source-wave[data-stem=${name}]`).click({ position: { x: 30, y: 35 } });
  }
  const beforeKey = await page.evaluate(() => stemTestSources.length);
  await drawer('drums').locator('.stem-sampler').first().locator('.drum-pad').first().press('a');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => stemTestSources.length), beforeKey + 1, 'One key plays only the active track');

  // Imported mono audio uses the same editors, without assuming stereo stem PCM.
  const empty = page.locator('.pl-user-head:has(.stem-piano-toggle:disabled)').first();
  const importedKey = await empty.getAttribute('data-stem');
  const mono = Buffer.alloc(44 + 32000 * 3 * 2);
  mono.write('RIFF'); mono.writeUInt32LE(mono.length - 8, 4); mono.write('WAVEfmt ', 8);
  mono.writeUInt32LE(16, 16); mono.writeUInt16LE(1, 20); mono.writeUInt16LE(1, 22);
  mono.writeUInt32LE(32000, 24); mono.writeUInt32LE(64000, 28); mono.writeUInt16LE(2, 32); mono.writeUInt16LE(16, 34);
  mono.write('data', 36); mono.writeUInt32LE(mono.length - 44, 40);
  for (let i = 44; i < mono.length; i += 2) mono.writeInt16LE(Math.round(Math.sin((i - 44) / 2 / 32000 * 440 * 2 * Math.PI) * 5000), i);
  await page.locator('#playlist input[type=file]').setInputFiles({ name: 'mono.wav', mimeType: 'audio/wav', buffer: mono });
  await head(importedKey).locator('.stem-piano-toggle:enabled').waitFor();
  await melody(importedKey);

  // Playback and WAV rendering must resolve shared samples independently per track.
  const isolated = await page.evaluate(async () => {
    const { mountPlaylist } = await import('./scripts/stem-playlist.mjs');
    const container = document.createElement('div'); document.body.append(container);
    const source = new AudioBuffer({ numberOfChannels: 2, length: 44100, sampleRate: 44100 });
    source.getChannelData(0).fill(.1); source.getChannelData(1).fill(.1);
    const replacement = new AudioBuffer({ numberOfChannels: 2, length: 44100, sampleRate: 44100 });
    replacement.getChannelData(0).fill(.3); replacement.getChannelData(1).fill(.3);
    const playlist = mountPlaylist({ container });
    playlist.setSession({ sources: [{ id: 'audio-bass', stem: 'bass', name: 'Bass', buffer: source }] });
    const other = playlist.tracks().find(track => !track.stem);
    playlist.edit(state => state.clips.push({ ...state.clips[0], id: 'copy', track: other.id }));
    playlist.setTrackBuffer(other.id, 'audio-bass', replacement);
    const before = stemTestSources.length; await playlist.toggle();
    await new Promise(resolve => setTimeout(resolve, 50));
    const values = stemTestSources.slice(before).filter(source => source.testStart).map(source => source.buffer.getChannelData(0)[100]);
    playlist.pause();
    window.trackTestPlaylist = playlist; window.trackTestContainer = container;
    return { values, shelf: [...container.querySelectorAll('.pl-shelf button')].map(button => button.textContent) };
  });
  assert.ok(isolated.values.length >= 2);
  assert.deepEqual([...new Set(isolated.values.map(value => Math.round(value * 10)))].sort(), [1, 3], 'Shared sample audio stays independent');
  assert.deepEqual(isolated.shelf, ['Bass'], 'Generated patterns do not leak into the sample library');
  const download = page.waitForEvent('download');
  await page.locator('.pl-export').last().click();
  const fs = require('node:fs'), wav = fs.readFileSync(await (await download).path());
  assert.ok(Math.abs(wav.readFloatLE(44 + 1000 * 8) - .4) < .001, 'Export includes both independent track buffers');
  await page.evaluate(() => { trackTestPlaylist.dispose(); trackTestContainer.remove(); });
  console.log('Track editors: all stems, new tracks, independent notes/grids/audio, unique IDs, preset metadata and WAV export passed.');
};
