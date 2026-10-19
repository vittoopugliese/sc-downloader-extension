const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (page) {
  // A SoundCloud loop arrives as the session Original. Delete must be selectable
  // before the loop is decoded, and must survive saving/restoring the separation.
  assert.equal(await page.locator('#extract-when option[value=delete]').evaluate(n => n.hidden || n.disabled), false);
  await page.locator('#extract-when').selectOption('delete');
  await page.locator('#separate:not(:disabled)').click();
  await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
  assert.equal(await page.locator('.pl-stem-head[data-stem=original]').count(), 0);
  await page.keyboard.press('F6');
  const rack = page.locator('#stem-rack'), piano = page.locator('#stem-piano-roll');
  await rack.locator('.module-control').first().click();
  const drums = rack.locator('.rack-channel[data-channel=drums]');
  await drums.locator('.rack-channel-name').click();
  await page.waitForFunction(() => !document.querySelector('.rack-channel[data-channel=drums] .rack-step').disabled);
  const length = async value => {
    await rack.locator('.plugin-bars').fill(String(value)); await rack.locator('.plugin-bars').press('Enter'); await rack.locator('.plugin-bars').blur();
  };
  await length(4);
  assert.equal(await drums.locator('.rack-step').count(), 64);
  assert.equal(await rack.locator('.rack-bar').count(), 0);
  assert.ok(await rack.locator('.rack-overview').evaluate(n => n.scrollWidth > n.clientWidth));
  for (const interval of [2, 4, 8]) {
    await drums.locator('.rack-channel-name').click({ button: 'right' });
    await page.getByRole('menuitem', { name: `Llenar cada ${interval} pasos`, exact: true }).click();
    assert.equal(await drums.locator('.rack-step.is-on').count(), 64 / interval);
    assert.equal(await drums.locator(`.rack-step[data-step="${64 - interval}"]`).getAttribute('aria-pressed'), 'true');
  }
  await drums.locator('.rack-step[data-step="63"]').click();
  assert.equal(await drums.locator('.rack-step[data-step="63"]').getAttribute('aria-pressed'), 'true');
  await rack.locator('.rack-view-chops').click();
  assert.equal(await rack.locator('.rack-grid .rack-step').count(), 8 * 64);
  await rack.locator('.rack-view-channels').click();
  await length(1);
  await page.keyboard.press('F7');
  await piano.locator('.module-control').first().click();
  await piano.locator('.piano-sustain').check();
  await piano.locator('.piano-keyboard').click();
  const sourceCount = () => page.evaluate(() => stemTestSources.length);
  let before = await sourceCount();
  await page.keyboard.down('q');
  await page.waitForFunction(n => stemTestSources.length === n + 1, before);
  assert.equal(await piano.locator('.piano-key[data-pitch="72"]').getAttribute('class'), 'piano-key is-active');
  assert.equal(await page.evaluate(() => stemTestSources.at(-1).playbackRate.value), 2);
  await page.keyboard.down('q');
  assert.equal(await sourceCount(), before + 1, 'Auto-repeat creates no extra voices');
  await page.keyboard.down('z');
  await page.waitForFunction(n => stemTestSources.length === n + 2, before);
  assert.equal(await piano.locator('.piano-key.is-active').count(), 2, 'Polyphonic held notes');
  assert.equal(await page.evaluate(() => stemTestSources.at(-1).testStops?.length || 0), 0, 'Sustain has no fixed preview timeout');
  await page.keyboard.up('z'); await page.keyboard.up('q');
  assert.equal(await piano.locator('.piano-key.is-active').count(), 0);
  assert.equal(await page.evaluate(() => stemTestSources.at(-1).testStops.length), 1, 'Keyup releases the note');
  before = await sourceCount();
  await piano.locator('.plugin-bars').focus(); await page.keyboard.press('1');
  assert.equal(await sourceCount(), before, 'Typing in a form never triggers notes');
  await piano.locator('.plugin-bars').fill('1'); await piano.locator('.plugin-bars').press('Enter'); await piano.locator('.plugin-bars').blur();
  await piano.locator('.piano-grid').focus();
  await page.keyboard.down('q');
  await page.waitForFunction(() => document.querySelector('.piano-key.is-active'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('q');
  assert.equal(await piano.locator('.piano-key.is-active').count(), 0, 'Blur clears held notes');

  // Cut itself changes actual audio, both held/live voices and offline PAT audio.
  await drums.locator('.rack-channel-name').click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: /Cortar sonido anterior/ }).click();
  await piano.locator('.piano-grid').focus();
  before = await sourceCount();
  await page.keyboard.down('z'); await page.keyboard.down('x');
  await page.waitForFunction(n => stemTestSources.length >= n + 2, before);
  assert.ok(await page.evaluate(n => stemTestSources[n].testStops.length >= 1, before), 'New pitch chokes the previous channel voice');
  await page.keyboard.up('z'); await page.keyboard.up('x');
  const levels = await page.evaluate(async () => {
    const { normalizePattern, normalizeInstrument, renderPattern } = await import('./scripts/stem-pattern-core.mjs');
    const buffer = new AudioBuffer({ sampleRate: 44100, length: 44100, numberOfChannels: 1 }); buffer.getChannelData(0).fill(.2);
    const pattern = normalizePattern({ id: 'cut', track: 'drums', hits: [1, 0, 1] });
    const instrument = normalizeInstrument({ mode: 'oneShot' }, buffer);
    const overlap = await renderPattern(pattern, instrument, buffer, 120);
    instrument.cutSelf = true;
    const cut = await renderPattern(pattern, instrument, buffer, 120);
    return [overlap.getChannelData(0)[22050], cut.getChannelData(0)[22050]];
  });
  assert.ok(Math.abs(levels[0] - 2 * levels[1]) < .001, `Cut itself removes overlapping tails: ${levels}`);

  // Record into the existing loop, with the playlist playing as accompaniment.
  await piano.locator('.piano-record').click();
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(120);
  await page.keyboard.down('q'); await page.waitForTimeout(220); await page.keyboard.up('q');
  const overdubSources = await sourceCount();
  await page.waitForFunction(n => stemTestSources.length > n, overdubSources, { timeout: 3500 });
  await page.keyboard.press('Space');
  assert.equal(await piano.locator('.piano-record').getAttribute('aria-pressed'), 'false');
  const notes = piano.locator('.piano-note');
  assert.equal(await notes.count(), 1);
  assert.ok(Number(await notes.first().getAttribute('data-length')) >= 1);
  await piano.locator('.piano-undo').click(); assert.equal(await notes.count(), 0);
  await piano.locator('.piano-redo').click(); assert.equal(await notes.count(), 1);
  // Free recording keeps the accompaniment looping and grows the take.
  await piano.locator('.piano-record-mode').selectOption('extend');
  await piano.locator('.piano-record').click();
  await page.waitForTimeout(2300);
  await page.keyboard.down('x'); await page.waitForTimeout(180); await page.keyboard.up('x');
  await piano.locator('.piano-record').click();
  assert.equal(await notes.count(), 2);
  assert.ok(Number(await notes.last().getAttribute('data-start')) >= 16);
  assert.equal(await piano.locator('.plugin-bars').inputValue(), '2');
  await notes.last().click({ button: 'right' });
  await piano.locator('.piano-trim').click();
  assert.equal(await piano.locator('.plugin-bars').inputValue(), '1');
  await piano.locator('.piano-undo').click();
  assert.equal(await piano.locator('.plugin-bars').inputValue(), '2', 'Undo restores the take length');
  await piano.locator('.piano-undo').click(); assert.equal(await notes.count(), 2);
  // A channel change finalizes a held note on its original channel.
  await piano.locator('.piano-backing').selectOption('pattern');
  await piano.locator('.piano-record').click();
  await page.waitForTimeout(100);
  await page.keyboard.down('e'); await page.waitForTimeout(150);
  await rack.locator('.plugin-track').selectOption('bass');
  await page.keyboard.up('e');
  assert.equal(await piano.locator('.piano-record').getAttribute('aria-pressed'), 'false');
  await rack.locator('.plugin-track').selectOption('drums');
  assert.equal(await notes.count(), 3);

  const artifacts = path.join(__dirname, '../test-results/stem-note-workflow'); fs.mkdirSync(artifacts, { recursive: true });
  await piano.screenshot({ path: path.join(artifacts, 'piano.png') });
  await rack.screenshot({ path: path.join(artifacts, 'rack.png') });
  await page.locator('#save-locally').click(); await page.locator('#save-name').fill('Recorded notes'); await page.locator('#save-confirm').click();
  await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
  const id = await page.locator('#stem-presets').evaluate(n => n.value);
  const saved = await page.evaluate(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs'); return (await (await StemPresets.current()).load(id)).record.settings;
  }, id);
  assert.equal(saved.original.removed, true); assert.equal(saved.instruments.drums.cutSelf, true);
  assert.equal(saved.patterns[0].notes.length, 3); assert.equal(saved.patterns[0].bars, 2);
  await page.reload();
  await page.locator('#extract-dialog[open]').waitFor(); await page.keyboard.press('Escape');
  await page.locator('#stem-presets:not(:disabled)').click();
  await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
  await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
  assert.equal(await page.locator('.pl-stem-head[data-stem=original]').count(), 0);
  await page.keyboard.press('F7');
  if (!await piano.isVisible()) await page.keyboard.press('F7');
  await piano.locator('.plugin-track').selectOption('drums');
  assert.equal(await notes.count(), 3);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Piano stays within ${width}px`);
  }
  console.log('Note workflow: SoundCloud source removal, continuous bars, fills, cut-self audio, held keys, recording, free takes, trim/undo, channel changes and preset reload passed.');
};
