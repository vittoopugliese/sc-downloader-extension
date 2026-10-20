const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const { names } = require('./build-icons.cjs').build(root, { check: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<style>body{background:#25282c;color:#ddd;font:12px system-ui}main{display:grid;grid-template-columns:repeat(10,1fr);gap:12px}article{text-align:center;padding:10px;border:1px solid #42484e}sc-icon{width:26px;height:26px;margin-bottom:6px}</style><main></main>');
    await page.addScriptTag({ path: path.join(__dirname, 'icons.js') });
    await page.evaluate(names => {
      for (const name of names) {
        const cell = document.createElement('article'); cell.append(SCIcons.create(name), document.createElement('br'), name);
        document.querySelector('main').append(cell);
      }
    }, Object.keys(names));
    const result = await page.evaluate(() => {
      const icons = [...document.querySelectorAll('sc-icon')];
      const invalid = icons.filter(node => !SCIcons.has(node.getAttribute('name')) || !node.shadowRoot?.querySelector('svg path') || node.getBoundingClientRect().width < 1).map(node => node.getAttribute('name'));
      icons[0].setAttribute('name', 'play');
      const before = icons[0].shadowRoot.firstChild;
      icons[0].setAttribute('name', 'play');
      const stable = before === icons[0].shadowRoot.firstChild;
      icons[0].setAttribute('name', 'pause');
      const changed = before !== icons[0].shadowRoot.firstChild;
      icons[0].setAttribute('hidden', '');
      const hidden = getComputedStyle(icons[0]).display === 'none';
      icons[0].removeAttribute('hidden'); icons[0].setAttribute('name', 'play');
      icons[0].style.color = 'rgb(255, 85, 0)';
      const color = getComputedStyle(icons[0].shadowRoot.querySelector('path')).fill;
      const host = document.createElement('div'); document.body.append(host);
      host.attachShadow({ mode: 'open' }).innerHTML = SCIcons.html('folder');
      const nested = !!host.shadowRoot.querySelector('sc-icon').shadowRoot?.querySelector('path');
      host.remove();
      return { invalid, stable, changed, hidden, color, nested };
    });
    assert.deepEqual(result, { invalid: [], stable: true, changed: true, hidden: true, color: 'rgb(255, 85, 0)', nested: true });
    await page.screenshot({ path: path.join(root, 'test-results/icons-catalog.png'), fullPage: true });
    // Every drawing is 20% smaller, including explicit sizing and nested roots.
    await page.evaluate(() => {
      for (const size of [16, 24, 42]) {
        const host = document.createElement('div'); document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const icon = SCIcons.create('play'); shadow.append(icon);
        icon.style.setProperty('--icon-size', size + 'px');
        const box = icon.getBoundingClientRect();
        const drawing = icon.shadowRoot.querySelector('svg').getBoundingClientRect();
        if (Math.abs(box.width - size) > 0.01 || Math.abs(drawing.width / box.width - 0.8) > 0.001) throw Error('Global icon scale failed');
        host.remove();
      }
      for (const icon of document.querySelectorAll('sc-icon')) {
        const ratio = icon.shadowRoot.querySelector('svg').getBoundingClientRect().width / icon.getBoundingClientRect().width;
        if (Math.abs(ratio - 0.8) > 0.001) throw Error('Explicit CSS size bypassed global scale');
      }
    });
    // Unselected original names are absent; arbitrary input cannot become markup.
    await page.evaluate(() => {
      const node = SCIcons.create('cursor:0041'); document.body.append(node);
      if (SCIcons.has('cursor:0041')) throw Error('Unused catalog leaked into runtime');
      node.setAttribute('name', '"><img src=x onerror=alert(1)>');
      if (node.shadowRoot.querySelector('img') || !node.shadowRoot.querySelector('path')) throw Error('Fallback failed');
      node.remove();
    });
    const hearts = await page.evaluate(() => ['heart', 'bypass'].map(name => {
      const icon = document.querySelector(`sc-icon[name="${name}"]`);
      icon.style.color = 'rgb(255, 85, 0)';
      const path = icon.shadowRoot.querySelector('path');
      return { drawing: icon.shadowRoot.innerHTML, fill: getComputedStyle(path).fill, stroke: getComputedStyle(path).stroke };
    }));
    assert.deepEqual(hearts[0], hearts[1], 'Credit and bypass must use the same restored heart');
    assert.equal(hearts[0].fill, 'none', 'The original heart keeps its outline');
    assert.equal(hearts[0].stroke, 'rgb(255, 85, 0)', 'The heart inherits the control state color');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  // Real extension registration: MAIN and ISOLATED worlds must both render, even after reinjection.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scdl-icons-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
    await context.route('https://soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><div class="playControls"><div class="playControls__elements"><button class="playControl">Play</button></div></div></body>' }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://soundcloud.com/you/likes');
    await page.waitForFunction(() => !!globalThis.SCIcons);
    const main = await page.evaluate(() => {
      const icon = SCIcons.create('play'); document.body.append(icon);
      return !!icon.shadowRoot?.querySelector('path');
    });
    assert.equal(main, true);
    await page.locator('sc-icon[name="likes"]').first().waitFor({ state: 'attached', timeout: 10000 }).catch(async error => {
      console.error('Extension errors:', errors, await page.locator('body').innerHTML()); throw error;
    });
    assert.equal(await page.locator('sc-icon[name="likes"]').count() > 0, true, 'Isolated-world Likes launcher renders');
    assert.equal(await page.locator('sc-icon[name="likes"] path').count() > 0, true, 'Isolated-world vector upgraded');
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    assert.equal(path.dirname(profile), os.tmpdir());
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log('Icons: catalog, names, state changes, color, hidden state, nested shadow roots and real extension worlds passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
