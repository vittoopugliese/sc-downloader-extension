// Channel Rack, Piano Roll, EQ and Recorder as FL Studio style windows in real Chromium:
// toolbar buttons and F-keys toggle them; they float, move, come to the front, dock under
// the Playlist and float again, never collapse, close with X or Escape and are remembered.
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
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/stems.html`);
    const tools = page.locator('#playlist .pl-tools');
    const windows = { rack: ['Channel rack', '#stem-rack', 'F6'], piano: ['Piano roll', '#stem-piano-roll', 'F7'], eq: ['Parametric EQ', '#scdl-parametric-eq', 'F9'], recorder: ['Recorder', '#scdl-record', 'F10'] };
    const section = id => page.locator(windows[id][1]);
    const button = id => tools.getByRole('button', { name: windows[id][0], exact: true });
    const z = id => section(id).evaluate(node => Number(node.style.zIndex));
    // Nothing is open, and nothing is a collapsible any more.
    for (const id of Object.keys(windows)) {
      assert.equal(await section(id).isVisible(), false, `${id} starts closed`);
      assert.equal(await button(id).getAttribute('aria-keyshortcuts'), windows[id][2]);
      assert.match(await button(id).getAttribute('title'), new RegExp(`^${windows[id][0]} \\(${windows[id][2]}\\): `));
    }
    // A button opens a floating window; F-keys open the others from anywhere.
    await button('rack').click();
    assert.equal(await section('rack').isVisible(), true);
    assert.equal(await button('rack').getAttribute('aria-pressed'), 'true');
    assert.equal(await section('rack').evaluate(node => getComputedStyle(node).position), 'fixed');
    for (const id of ['piano', 'eq', 'recorder']) {
      await page.keyboard.press(windows[id][2]);
      assert.equal(await section(id).isVisible(), true, `${windows[id][2]} opens ${id}`);
    }
    assert.ok(await z('recorder') > await z('rack'), 'The last opened window is on top');
    assert.equal(await page.locator('.module-window .tool-section-chevron:visible').count(), 0);
    // Clicking the title bar brings a window to the front and never collapses it.
    const body = section('rack').locator('.stem-plugin-body');
    const title = await section('rack').locator('.tool-section-title').boundingBox();
    await page.mouse.click(title.x + 4, title.y + 4);
    assert.ok(await z('rack') > await z('recorder'));
    assert.equal(await body.isVisible(), true, 'The title bar does not collapse');
    // The title bar moves it.
    const before = await section('rack').boundingBox();
    await page.mouse.move(title.x + 4, title.y + 4); await page.mouse.down();
    await page.mouse.move(title.x + 84, title.y + 64, { steps: 4 }); await page.mouse.up();
    const after = await section('rack').boundingBox();
    assert.ok(Math.abs(after.x - before.x - 80) < 2 && Math.abs(after.y - before.y - 60) < 2, 'The window moved');
    // F-key on a window behind others brings it forward first, then closes it.
    await page.keyboard.press('F7');
    assert.equal(await section('piano').isVisible(), true);
    assert.ok(await z('piano') > await z('rack'));
    await page.keyboard.press('F7');
    assert.equal(await section('piano').isVisible(), false);
    assert.equal(await button('piano').getAttribute('aria-pressed'), 'false');
    // Dock under the Playlist, then float again at the same place.
    await section('rack').getByRole('button', { name: 'Dock under the Playlist' }).click();
    assert.equal(await section('rack').evaluate(node => node.parentElement.id), 'mix-tools');
    assert.equal(await section('rack').evaluate(node => getComputedStyle(node).position), 'static');
    await section('rack').getByRole('button', { name: 'Detach: float this window' }).click();
    assert.equal(await section('rack').evaluate(node => getComputedStyle(node).position), 'fixed');
    const again = await section('rack').boundingBox();
    assert.ok(Math.abs(again.x - after.x) < 2 && Math.abs(again.y - after.y) < 2, 'Floating keeps its last rectangle');
    // Escape closes the focused floating window; X closes too.
    await section('eq').locator('.module-control').first().focus();
    await page.keyboard.press('Escape');
    assert.equal(await section('eq').isVisible(), false);
    await page.keyboard.press('F10');
    assert.equal(await section('recorder').isVisible(), true, 'F10 brings the covered recorder forward');
    await section('recorder').getByRole('button', { name: 'Close' }).click();
    assert.equal(await section('recorder').isVisible(), false);
    const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'module-windows.png') });
    // Open windows and their places survive a reload.
    await page.reload();
    assert.equal(await section('rack').isVisible(), true);
    assert.equal(await section('eq').isVisible(), false);
    const restored = await section('rack').boundingBox();
    assert.ok(Math.abs(restored.x - after.x) < 2, 'Position is remembered');
    assert.deepEqual(errors, []);
    console.log('Module windows test passed.');
  } finally {
    await browser?.close(); server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
