const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    await context.route('https://**/*', route => route.request().url() === 'https://soundcloud.com/artist/controls-test'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <script>
          window.nativeKeys = [];
          for (const type of ['keydown', 'keypress', 'keyup']) {
            window.addEventListener(type, event => {
              if (/^[lq]$/i.test(event.key)) nativeKeys.push(type + ':' + event.key);
            }, true);
          }
        </script>
        <style>.playControls__elements{position:fixed;bottom:0;left:0;display:flex;width:100%;height:48px}</style>
        <input id="search" aria-label="Search">
        <div class="playControls__elements"><div class="playControls__soundBadge"></div></div>` })
      : route.abort());
    const page = await context.newPage();
    await page.goto('https://soundcloud.com/artist/controls-test');
    const host = page.locator('#scdl-tempo-control');
    await host.waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('scdl:open-player-tools-panel')));
    await host.locator('.sampler-toggle').click();
    await host.locator('.sampler-toggle').focus();
    await page.keyboard.press('l');
    await page.keyboard.down('q');
    await page.keyboard.down('q');
    await page.keyboard.up('q');
    assert.deepEqual(await page.evaluate(() => nativeKeys), [], 'Sampler keys must not trigger native like/queue handlers, including repeats and keyup');

    await host.locator('.current').click();
    const input = host.locator('.rate-input');
    await input.fill('1.25');
    await host.locator('.panel').screenshot({ path: path.join(root, 'test-results', 'sampler-controls.png') });
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.slider').value === '1.25');
    assert.equal(await host.locator('.current').textContent(), '1.250x');
    await host.locator('.current').click();
    await input.fill('2');
    await input.press('Escape');
    assert.equal(await host.locator('.panel').isVisible(), true, 'Escape cancels editing without closing the panel');
    assert.equal(await host.locator('.slider').inputValue(), '1.25');
    await host.locator('.current').click();
    await input.fill('');
    await input.press('Tab');
    assert.equal(await host.locator('.slider').inputValue(), '1.25', 'Empty edits leave the rate unchanged');
    await host.locator('.current').click();
    await input.fill('9');
    await input.press('Tab');
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.slider').value === '3');

    await host.locator('.detach-button').click();
    await page.locator('#search').fill('lq');
    assert.equal(await page.locator('#search').inputValue(), 'lq', 'Text fields remain editable');
    await host.locator('.close-button').click();
    await page.evaluate(() => { nativeKeys.length = 0; document.activeElement?.blur(); });
    await page.keyboard.press('l');
    assert.ok((await page.evaluate(() => nativeKeys)).includes('keydown:l'), 'Native shortcuts return when the panel closes');
    console.log('Sampler controls passed: native shortcut isolation, editable rate, cancel, limits and text input.');
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
