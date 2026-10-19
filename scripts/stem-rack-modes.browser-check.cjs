const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (page) {
  const { encodeWav } = await import('./stem-audio.mjs');
  const tone = (frequency, seconds) => Buffer.from(encodeWav([0, 1].map(() => Float32Array.from({ length: seconds * 44100 }, (_, i) => .2 * Math.sin(2 * Math.PI * frequency * i / 44100)))));
  await page.locator('#separate:not(:disabled)').click();
  await page.locator('.pl-stem-head[data-stem=vocals]').waitFor();
  await page.keyboard.press('F6');
  const rack = page.locator('#stem-rack'), piano = page.locator('#stem-piano-roll'), playlist = page.locator('#playlist');
  await rack.locator('.module-control').first().click();
  assert.equal(await rack.locator('.rack-overview').isVisible(), true);
  assert.equal(await rack.locator('.rack-channel').count(), 5);
  await page.locator('#transport input[type=file]').setInputFiles([
    { name: 'long-808.wav', mimeType: 'audio/wav', buffer: tone(55, 3) },
    { name: 'snare.wav', mimeType: 'audio/wav', buffer: tone(330, .5) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.rack-channel').length === 7);
  const row808 = rack.locator('.rack-channel').filter({ has: page.locator('.rack-channel-name', { hasText: 'long-808.wav' }) });
  const snare = rack.locator('.rack-channel').filter({ has: page.locator('.rack-channel-name', { hasText: 'snare.wav' }) });
  assert.equal(await row808.locator('.rack-channel-mode').inputValue(), 'oneShot');
  assert.equal(await snare.locator('.rack-channel-mode').inputValue(), 'oneShot', 'A second sample on the same playlist track is its own channel');
  await row808.locator('.rack-channel-name').click();
  await row808.locator('.rack-channel-root').selectOption('57');
  const before = await page.evaluate(() => stemTestSources.length);
  await row808.locator('.rack-channel-play').click();
  await page.waitForFunction(n => stemTestSources.length > n, before);
  assert.equal(await page.evaluate(() => stemTestSources.at(-1).testStart[2]), 3, 'Audition starts all three seconds, not a slice');
  await row808.locator('.rack-step').nth(0).click();
  await rack.locator('.plugin-bars').fill('2'); await rack.locator('.plugin-bars').press('Enter'); await rack.locator('.plugin-bars').blur();
  const pattern = await rack.locator('.plugin-pattern .row-menu-toggle').evaluate(node => node.value);
  await snare.locator('.rack-step').nth(4).click();
  await snare.locator('.rack-channel-name').click();
  assert.equal(await rack.locator('.plugin-pattern .row-menu-toggle').evaluate(node => node.value), pattern, 'Selecting a channel keeps the shared pattern');
  assert.equal(await playlist.locator('.pl-shelf .is-pattern').count(), 1, 'Two sources belong to one pattern');
  await rack.locator('.plugin-play').click();
  await page.waitForFunction(() => stemTestSources.some(source => source.loop && source.buffer?.duration === 4));
  const rendered = await page.evaluate(() => {
    const buffer = stemTestSources.findLast(source => source.loop && source.buffer?.duration === 4).buffer;
    const pcm = buffer.getChannelData(0), rate = buffer.sampleRate;
    const strength = (frequency, start, length) => {
      let sin = 0, cos = 0, count = Math.round(length * rate);
      for (let j = 0; j < count; j++) { const i = Math.round(start * rate) + j, phase = 2 * Math.PI * frequency * i / rate; sin += pcm[i] * Math.sin(phase); cos += pcm[i] * Math.cos(phase); }
      return 2 * Math.hypot(sin, cos) / count;
    };
    return { bass: strength(55, 2, .5), snare: strength(330, .6, .2) };
  });
  assert.ok(rendered.bass > .12 && rendered.snare > .12, `PAT renders both sources and the long tail: ${JSON.stringify(rendered)}`);
  await rack.locator('.plugin-play').click();
  await row808.locator('.rack-channel-chops').click();
  assert.equal(await rack.locator('.rack-source-mode').inputValue(), 'slices');
  await page.waitForFunction(() => document.querySelectorAll('.rack-grid .rack-pad.is-assigned').length > 0);
  const cuts = await rack.locator('.stem-pad-marker').count();
  await rack.locator('.rack-source-mode').selectOption('oneShot');
  await rack.locator('.rack-source-mode').selectOption('slices');
  assert.equal(await rack.locator('.stem-pad-marker').count(), cuts, 'Mode switching preserves cuts');
  await rack.locator('.rack-clear-slices').click();
  assert.equal(await rack.locator('.rack-pad.is-assigned').count(), 0);
  await rack.locator('.rack-source-mode').selectOption('oneShot');
  await rack.locator('.rack-view-channels').click();
  assert.equal(await row808.locator('.rack-step.is-on').count(), 1, 'Clear slices did not erase the one-shot sequence');
  await row808.locator('.rack-channel-name').click();
  await page.keyboard.press('F7');
  await piano.locator('.module-control').first().click();
  assert.equal(await piano.locator('.piano-root').inputValue(), '57');
  assert.equal(await piano.locator('.piano-sample').isVisible(), false, 'One-shot piano uses the complete sample');
  await piano.locator('.piano-root').selectOption('60');
  assert.equal(await row808.locator('.rack-channel-root').inputValue(), '60');
  const signal = await page.evaluate(async () => {
    const { normalizePattern, normalizeInstrument, renderPattern } = await import('./scripts/stem-pattern-core.mjs');
    const buffer = new AudioBuffer({ sampleRate: 44100, length: 3 * 44100, numberOfChannels: 1 });
    buffer.getChannelData(0).fill(.2);
    const pattern = normalizePattern({ id: 'test', track: 'bass', bars: 2, notes: [{ pitch: 60, start: 0, length: .5, velocity: 1 }] });
    const instrument = normalizeInstrument({ mode: 'oneShot', piano: { root: 60, sustain: true } }, buffer);
    const same = await renderPattern(pattern, instrument, buffer, 120);
    instrument.piano.root = 48;
    const high = await renderPattern(pattern, instrument, buffer, 120);
    return [same.getChannelData(0)[44100 * 2], high.getChannelData(0)[44100], high.getChannelData(0)[44100 * 2]];
  });
  assert.ok(signal[0] > .1 && signal[1] > .1 && Math.abs(signal[2]) < .001, 'One-shot ignores short note gates and transposes from root without sustain looping');
  // Removing all raw clips leaves both sources available, including the channel that
  // was never assigned as a playlist track's instrument.
  await playlist.locator('.pl-scroll').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  assert.equal(await playlist.locator('.pl-clip').count(), 0);
  assert.equal(await rack.locator('.rack-channel').count(), 7);
  await rack.locator('.rack-place').click();
  await playlist.locator('.pl-clip.is-pattern').waitFor();
  await page.locator('#save-locally').click(); await page.locator('#save-name').fill('Rack modes'); await page.locator('#save-confirm').click();
  await page.waitForFunction(() => document.querySelector('#stem-presets').value.startsWith('stem-'));
  const id = await page.locator('#stem-presets').evaluate(node => node.value);
  await page.waitForFunction(async id => {
    const { StemPresets } = await import('./scripts/stem-presets.mjs');
    return Object.keys((await (await StemPresets.current()).load(id)).samples).length === 2;
  }, id);
  await page.reload();
  // The extraction window opens on arrival; close it to use the header.
  await page.locator('#extract-dialog[open]').waitFor(); await page.keyboard.press('Escape'); await page.locator('#extract-dialog').waitFor({ state: 'hidden' });
  await page.locator('#stem-presets:not(:disabled)').click();
  await page.locator(`#stem-presets-menu .row-menu-row[data-id="${id}"] .row-menu-load`).click();
  await page.keyboard.press('F6');
  if (!await rack.isVisible()) await page.keyboard.press('F6');
  await page.waitForFunction(() => document.querySelectorAll('.rack-channel').length === 7);
  assert.equal(await row808.locator('.rack-channel-mode').inputValue(), 'oneShot');
  assert.equal(await row808.locator('.rack-step.is-on').count(), 1);
  assert.equal(await snare.locator('.rack-step.is-on').count(), 1);
  await row808.locator('.rack-channel-chops').click();
  assert.equal(await rack.locator('.rack-pad.is-assigned').count(), 0, 'Cleared chops survive save, reload and returning from one-shot');
  await rack.locator('.rack-source-mode').selectOption('oneShot'); await rack.locator('.rack-view-channels').click();
  const artifacts = path.join(__dirname, '../test-results/stem-rack-modes'); fs.mkdirSync(artifacts, { recursive: true });
  await rack.screenshot({ path: path.join(artifacts, 'channels.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rack stays within ${width}px`);
    await rack.screenshot({ path: path.join(artifacts, `channels-${width}.png`) });
  }
  console.log('Rack modes: all samples, shared pattern, one-shot duration/root, preserved chops, clip removal, reload and narrow layouts passed.');
};
