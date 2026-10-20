// Workspace integration: real DOM/styles, deterministic audio and separation outputs.
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
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      globalThis.workerDelay = 30;
      globalThis.Worker = class {
        postMessage({ channels }) {
          this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'complete', seconds: .1,
            outputs: [1, .7, .4, .2].map(gain => channels.map(channel => channel.map(value => value * gain))) } }), globalThis.workerDelay);
        }
        terminate() { clearTimeout(this.timer); }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await page.locator('.studio-card, .workspace-edition, #workspace-title, .pl-notes, #status').count(), 0);
    assert.equal(await page.locator('#header-pin').evaluate(e => e.nextElementSibling.id), 'toggle-game');
    // Help, tooltips and pin are ghost buttons, in that order; every tooltip is the shared one.
    const headerEnd = await page.locator('#header-pin').evaluate(pin => [pin.previousElementSibling.previousElementSibling, pin.previousElementSibling, pin]
      .map(e => [e.getAttribute('aria-label'), e.classList.contains('ui-btn--ghost')]));
    assert.deepEqual(headerEnd, [['Playlist shortcuts', true], ['Toggle tooltips', true], ['Pin header', true]]);
    const nativeTitles = await page.evaluate(() => [...document.querySelectorAll('main [title], dialog [title]')]
      .filter(e => e.tagName !== 'IFRAME').map(e => e.className || e.id));
    assert.deepEqual(nativeTitles, [], 'Stem Extractor controls use data-scdl-tooltip, never a native title');
    const tip = page.locator('#scdl-fast-tooltip');
    await page.locator('.tooltips-toggle').hover();
    await page.waitForFunction(() => document.querySelector('#scdl-fast-tooltip')?.style.visibility === 'visible');
    assert.equal(await tip.textContent(), 'Toggle tooltips');
    await page.locator('#play').hover();
    await page.waitForFunction(() => document.querySelector('#scdl-fast-tooltip')?.textContent.startsWith('Play'));
    await page.mouse.down(); assert.equal(await tip.evaluate(e => e.style.visibility), 'hidden', 'A press hides the tooltip'); await page.mouse.up();
    await page.locator('#play').click();
    await page.locator('.tooltips-toggle').click();
    assert.equal(await page.locator('.tooltips-toggle').getAttribute('aria-pressed'), 'false');
    await page.locator('#header-pin').hover(); await page.waitForTimeout(450);
    assert.equal(await tip.evaluate(e => getComputedStyle(e).display), 'none', 'Off hides every tooltip');
    assert.equal(await page.locator('#header-pin').getAttribute('title'), null, 'No native title replaces it');
    await page.locator('.tooltips-toggle').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('scdl.tooltips.enabled')), 'true');
    assert.equal(await page.getByRole('spinbutton', { name: 'BPM', exact: true }).evaluate(e => e.getBoundingClientRect().height), 32);
    { // BPM is a drag number like FL Studio's: 4 px up is +1, whole numbers only; one drag is one undo step.
      const bpm = page.getByRole('spinbutton', { name: 'BPM', exact: true }), box = await bpm.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      assert.ok(await page.evaluate(() => document.documentElement.classList.contains('ui-drag-number-dragging')), 'A drag keeps the up/down cursor');
      for (let y = 1; y <= 40; y += 3) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - y);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40); await page.mouse.up();
      assert.equal(await bpm.getAttribute('aria-valuenow'), '130');
      await page.waitForTimeout(300); assert.equal(await bpm.textContent(), '130', 'The number counts to the new value');
      await page.locator('.workspace-header .pl-tools button[aria-keyshortcuts="Control+Z"]').click();
      assert.equal(await bpm.getAttribute('aria-valuenow'), '120', 'One drag is one undo step');
    }
    const inspector = page.locator('.workspace-header > .pl-inspector');
    const dials = await inspector.locator('.ui-knob-dial').evaluateAll(nodes => nodes.map(e => ({ width: e.offsetWidth, height: e.offsetHeight, radius: getComputedStyle(e).borderRadius })));
    assert.ok(dials.length > 0 && dials.every(d => d.width === d.height && d.radius === '50%'));
    assert.equal(await page.locator('#playlist').evaluate(e => e.firstElementChild.className), 'pl-library', 'Playlist starts at the sample selector');
    // Moved controls keep keyboard ownership, and one key press runs exactly once.
    const snap = inspector.locator('.pl-grid-snap');
    await snap.focus(); await page.keyboard.press('g');
    assert.equal(await snap.getAttribute('aria-label'), 'Grid: 1/16');
    await page.keyboard.press('g'); await page.keyboard.press('g');
    assert.equal(await snap.getAttribute('aria-label'), 'Grid: 1/8');
    // All three rows follow the same pin state when the page scrolls.
    await page.evaluate(() => { document.body.style.paddingBottom = '1200px'; window.scrollTo(0, 300); });
    await page.waitForFunction(() => window.scrollY === 300);
    assert.equal(await page.locator('.workspace-header').evaluate(e => Math.round(e.getBoundingClientRect().top)), 0);
    assert.ok((await inspector.boundingBox()).y >= 0);
    await page.locator('#header-pin').click();
    await page.evaluate(() => window.scrollTo(0, 500));
    assert.ok(await inspector.evaluate(e => e.getBoundingClientRect().bottom < 0), 'Unpinned clip controls scroll away with the header');
    await page.evaluate(() => { window.scrollTo(0, 0); document.body.style.paddingBottom = ''; });
    await page.locator('#header-pin').click();
    const top = await page.locator('#playlist').evaluate(e => e.getBoundingClientRect().top);
    await page.evaluate(async () => {
      window.notifications = await import('./scripts/ui-toast.mjs');
      notifications.toast({ id: 'check', title: 'Reading sample', variant: 'loading', progress: .1 });
      notifications.toast({ id: 'check', title: 'Reading sample', variant: 'loading', progress: .8 });
    });
    assert.equal(await page.locator('.ui-toast-title', { hasText: 'Reading sample' }).count(), 1);
    assert.equal(await page.locator('.ui-toast-content[data-variant=loading] .ui-toast-progress').evaluate(e => e.style.getPropertyValue('--toast-progress')), '0.8');
    await page.evaluate(() => {
      notifications.toast({ id: 'check', title: '<img src=x onerror=alert(1)>', variant: 'success' });
      document.querySelector('#extract-dialog').showModal();
    });
    await page.locator('dialog .ui-toast-viewport:popover-open').waitFor();
    const result = page.locator('.ui-toast-content[data-variant=success]');
    assert.equal(await result.locator('img').count(), 0, 'Toast text is never interpreted as HTML');
    await result.locator('button').click();
    await result.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#playlist').evaluate(e => e.getBoundingClientRect().top), top, 'Notifications never move the playlist');
    await page.evaluate(() => notifications.toast({ id: 'expiry', title: 'Temporary message', duration: 100 }));
    await page.locator('.ui-toast-title', { hasText: 'Temporary message' }).waitFor({ state: 'detached' });
    const { encodeWav } = await import('./stem-audio.mjs');
    const pcm = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 44100) * .2);
    await page.locator('#transport input[type=file]').setInputFiles({ name: 'Library tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([pcm, pcm])) });
    await page.locator('.pl-clip').waitFor();
    const stretch = inspector.getByRole('button', { name: 'Stretch', exact: true });
    assert.equal(await stretch.evaluate(e => e.previousElementSibling.classList.contains('ui-knob')), true, 'The Stretch toggle sits beside the clip knobs');
    assert.equal(await stretch.getAttribute('aria-pressed'), 'true');
    const onColor = await stretch.evaluate(e => getComputedStyle(e).backgroundColor);
    await stretch.click();
    assert.equal(await stretch.getAttribute('aria-pressed'), 'false');
    assert.notEqual(await stretch.evaluate(e => getComputedStyle(e).backgroundColor), onColor, 'On and off have different button colors');
    await page.keyboard.press('h');
    assert.equal(await stretch.getAttribute('aria-pressed'), 'true', 'The detached inspector handles each hotkey once');
    await page.locator('#playlist').focus(); await page.keyboard.press('Delete');
    assert.equal(await page.locator('.pl-clip').count(), 0);
    const initialTracks = await page.locator('.pl-grid-row').count();
    const sample = page.locator('.pl-shelf button', { hasText: /^Library tone\.wav$/ });
    await sample.click({ button: 'right' });
    await page.locator('.pl-menu-item', { hasText: 'Extract stems' }).click();
    assert.equal(await page.locator('#separate').isEnabled(), true, 'Library samples can be separated without an Original or any clip');
    // The tooltip sits in the top layer, above the modal window.
    await page.locator('.extract-close').hover();
    await page.waitForFunction(() => document.querySelector('#scdl-fast-tooltip')?.style.visibility === 'visible');
    assert.deepEqual(await page.locator('#scdl-fast-tooltip').evaluate(e => [e.matches(':popover-open'), e.textContent]), [true, 'Close']);
    for (const input of await page.locator('[name=extract-stem]').all()) await input.uncheck();
    assert.equal(await page.locator('#separate').isDisabled(), true, 'At least one output must be chosen');
    await page.locator('[name=extract-stem][value=drums]').check();
    await page.locator('[name=extract-stem][value=bass]').check();
    await page.locator('[name=extract-stem][value=other]').uncheck();
    await page.locator('[name=extract-stem][value=vocals]').uncheck();
    await page.locator('#separate').click();
    await page.locator('#extract-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.pl-grid-row').count(), initialTracks + 2);
    assert.equal(await page.locator('.pl-clip').count(), 2);
    await page.locator('#playlist').focus(); await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.pl-grid-row').count(), initialTracks);
    assert.equal(await page.locator('.pl-clip').count(), 0, 'One undo removes the generated tracks and clips');
    await sample.dblclick();
    await sample.click({ button: 'right' });
    await page.locator('.pl-menu-item', { hasText: 'Extract stems' }).click();
    await page.locator('#separate').click();
    await page.locator('#extract-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.pl-clip.is-muted').count(), 1, 'Mute source silences existing instances of the library sample');
    const beforeCancel = await page.locator('.pl-clip').count();
    await sample.click({ button: 'right' });
    await page.locator('.pl-menu-item', { hasText: 'Extract stems' }).click();
    await page.evaluate(() => { workerDelay = 5000; });
    await page.locator('#separate').click();
    await page.locator('#cancel').click();
    assert.equal(await page.locator('#separate').isEnabled(), true);
    assert.equal(await page.locator('.pl-clip').count(), beforeCancel, 'Cancelling keeps the existing arrangement');
    assert.equal(await page.locator('#extract-progress, #progress').count(), 0, 'Progress shows as the library spinner, not bars');
    // Stems separated together share one library color, apart from the source sample's.
    const edge = name => page.locator('.pl-shelf button', { hasText: name }).first().evaluate(e => [getComputedStyle(e).borderLeftColor, getComputedStyle(e).borderLeftWidth]);
    const [drumsEdge, bassEdge, sourceEdge] = [await edge(/^Drums · Library tone/), await edge(/^Bass · Library tone/), await edge(/^Library tone\.wav$/)];
    assert.deepEqual(drumsEdge, bassEdge);
    assert.notEqual(drumsEdge[0], sourceEdge[0]);
    assert.equal(drumsEdge[1], '2px');
    // Remove source leaves only the stems: the sample and its clip leave the project; undo brings them back.
    await page.evaluate(() => { workerDelay = 30; });
    await page.locator('#extract-when').selectOption('delete');
    await page.locator('#separate').click();
    await page.locator('#extract-dialog').waitFor({ state: 'hidden' });
    assert.equal(await sample.count(), 0, 'Remove source deletes the library sample');
    assert.equal(await page.locator('.pl-clip').count(), beforeCancel + 1, 'The source clip goes, two stem clips come');
    await page.locator('#playlist').focus(); await page.keyboard.press('Control+z');
    assert.equal(await sample.count(), 1);
    assert.equal(await page.locator('.pl-clip').count(), beforeCancel);
    await page.evaluate(() => localStorage.removeItem('stems.extractOptions'));
    await page.keyboard.press('Escape');
    await page.locator('.pl-clip').first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => notifications.toast({ title: 'A long message', message: 'A detailed explanation that wraps safely in a small viewport without making the page wider.', duration: -1 }));
    await page.waitForTimeout(450); // Toast entry transition.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const stretchBounds = await stretch.boundingBox();
    assert.ok(stretchBounds.x >= 0 && stretchBounds.x + stretchBounds.width <= 390, 'The Stretch toggle fits the mobile header');
    const bounds = await page.locator('.ui-toast.on').first().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    // On phones the three-row header can exceed half the viewport; toasts cap their
    // offset there so notifications remain on screen.
    assert.ok(bounds.y >= await page.locator('.workspace-header').evaluate(e => Math.min(innerHeight / 2, e.getBoundingClientRect().bottom)));
    fs.mkdirSync(path.join(root, 'test-results/workspace'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/workspace/mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(root, 'test-results/workspace/desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Workspace: shared controls, header layout, modal-safe toasts, library stem extraction without Original, output selection, mute, undo, cancellation and narrow viewport passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
