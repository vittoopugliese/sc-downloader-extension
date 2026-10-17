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
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    await page.locator('#import-audio:not(:disabled)').waitFor();
    assert.equal(await page.locator('.studio-card, .workspace-edition, #workspace-title, .pl-notes, #status').count(), 0);
    assert.equal(await page.locator('#header-pin').evaluate(e => e.nextElementSibling.id), 'toggle-game');
    assert.equal(await page.getByRole('spinbutton', { name: 'BPM', exact: true }).evaluate(e => e.getBoundingClientRect().height), 32);
    const dials = await page.locator('#playlist .ui-knob-dial').evaluateAll(nodes => nodes.map(e => ({ width: e.offsetWidth, height: e.offsetHeight, radius: getComputedStyle(e).borderRadius })));
    assert.ok(dials.length > 0 && dials.every(d => d.width === d.height && d.radius === '50%'));
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => notifications.toast({ title: 'A long message', message: 'A detailed explanation that wraps safely in a small viewport without making the page wider.', duration: -1 }));
    await page.waitForTimeout(450); // Toast entry transition.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.locator('.ui-toast.on').first().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= await page.locator('.workspace-header').evaluate(e => e.getBoundingClientRect().bottom));
    fs.mkdirSync(path.join(root, 'test-results/workspace'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/workspace/mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(root, 'test-results/workspace/desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Workspace: toast updates, safe text, modal dismissal, expiry, stable layout and narrow viewport passed.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
