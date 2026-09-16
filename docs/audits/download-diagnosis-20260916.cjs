// Diagnostic only: isolated browser profile, no account credentials or production writes.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'scdl-diagnosis-'));
  const extensionRoot = process.env.SCDL_AUDIT_ROOT || root;
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  try {
    const page = await context.newPage();
    await page.goto('https://soundcloud.com/forss/flickermood', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    const cdp = await context.browser().newBrowserCDPSession();
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: extensionRoot });
    const id = loaded.id;
    console.log('LOADED_EXTENSION', JSON.stringify(loaded));
    const bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${id}/popup.html`);
    const probe = async () => bridge.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
      try { return await chrome.tabs.sendMessage(tab.id, { type: 'GET_TRACK_DATA' }); }
      catch (error) { return { error: error.message }; }
    });
    const initial = await probe();
    console.log('BEFORE_RELOAD', JSON.stringify({ status: initial.status, error: initial.error }));
    const popup = await context.newPage();
    // A real action popup queries the SoundCloud tab, not its own test tab.
    await popup.addInitScript(() => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (options, callback) => {
        const target = options.active ? { url: 'https://soundcloud.com/*' } : options;
        return callback ? query(target, callback) : query(target);
      };
    });
    await page.bringToFront();
    const errors = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForTimeout(16000);
    console.log('POPUP_BEFORE_RELOAD', JSON.stringify(await popup.evaluate(() => ({
      loading: document.querySelector('#loadingText')?.textContent,
      status: document.querySelector('#downloadStatus')?.textContent,
      error: document.querySelector('#errorMessage')?.textContent,
      retry: document.querySelector('#retryBtn')?.textContent,
      retryVisible: document.querySelector('#retryBtn')?.classList.contains('is-visible'),
      downloadHidden: document.querySelector('#downloadBtn')?.classList.contains('is-hidden'),
    }))));
    console.log('POPUP_JS_ERRORS', JSON.stringify(errors));
    await page.reload({ waitUntil: 'domcontentloaded' });
    let state;
    for (let i = 0; i < 30; i++) {
      state = await probe();
      if (state.status === 'loaded') break;
      await page.waitForTimeout(500);
    }
    console.log('AFTER_RELOAD', JSON.stringify({ status: state.status, kind: state.kind, error: state.error,
      formats: state.data?.availableFormats, protocol: state.data?.streamProtocol }));
    if (state.status !== 'loaded') throw new Error('Control failed: reloaded track did not load');
    const downloads = path.join(profile, 'downloads');
    await fs.mkdir(downloads);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    for (const format of ['mp3', 'm4a']) {
      const result = await bridge.evaluate(async formatPreference => {
        const [tab] = await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_FORMAT_PREFERENCE', formatPreference });
        const result = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_SINGLE_TRACK', trackData: response.data, formatPreference });
        return { ...result, protocol: response.data?.streamProtocol, preset: response.data?.streamPreset };
      }, format);
      console.log('LIVE_DOWNLOAD', format, JSON.stringify(result));
    }
    const concurrent = await bridge.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_FORMAT_PREFERENCE', formatPreference: 'mp3' });
      return Promise.all([1, 2].map(() => chrome.runtime.sendMessage({ type: 'DOWNLOAD_SINGLE_TRACK', trackData: response.data, formatPreference: 'mp3' })));
    });
    console.log('CONCURRENT_DOWNLOADS', JSON.stringify(concurrent));
    console.log('FILES', JSON.stringify(await Promise.all((await fs.readdir(downloads)).map(async name => ({ name, bytes: (await fs.stat(path.join(downloads, name))).size })))));
    assert.ok(concurrent.every(result => result.success), 'Concurrent downloads must both save files');
    assert.equal(initial.status, 'loaded', 'An already open SoundCloud tab must become usable after installation');
  } finally {
    await context.close();
    if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('scdl-diagnosis-')) throw new Error('Unsafe cleanup path');
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
