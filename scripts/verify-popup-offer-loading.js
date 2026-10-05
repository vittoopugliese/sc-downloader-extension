const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const source = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
    const sync = source.slice(source.indexOf('async function syncPlayerToolsOffer('),
      source.indexOf('playerToolsProBtn.addEventListener("click", openCommercePanel)'));
    for (const restricted of [false, true]) {
      for (const plan of ['pro', 'free']) {
        const page = await browser.newPage();
        await page.setContent(html);
    await page.evaluate(() => document.body.classList.remove("policy-pending"));
        await page.evaluate((restricted) => {
          document.body.classList.toggle('restricted-downloads', restricted);
          document.getElementById('loadingOverlay').classList.add('is-hidden');
          window.productOffers = document.querySelector('.product-offers');
          window.playerToolsOfferExpiryTimer = null;
          window.t = (key) => key;
          window.chrome = { runtime: { sendMessage: () => new Promise((resolve) => {
            window.resolveOffer = resolve;
          }) }, i18n: { getUILanguage: () => 'en' } };
        }, restricted);
        await page.addScriptTag({ content: sync });
        await page.evaluate(() => { window.offerSync = syncPlayerToolsOffer({ startTrial: false }); });
        const before = await page.locator('body').boundingBox();
        assert.equal(await page.locator('.product-offers').isVisible(), false,
          'Banners must stay hidden while the license response is pending');
        await page.evaluate(async (plan) => {
          chrome.runtime.sendMessage = async () => ({ success: true, snapshot: { plan } });
          resolveOffer({ success: true, commerce: { status: plan === 'pro' ? 'active' : 'inactive' } });
          await offerSync;
        }, plan);
        assert.equal(await page.locator('.product-offers').isVisible(), plan === 'free');
        if (plan === 'pro') {
          assert.equal((await page.locator('body').boundingBox()).height, before.height,
            'Resolving Pro must not resize the popup');
          await page.evaluate(async () => {
            chrome.runtime.sendMessage = async () => { throw new Error('offline'); };
            await syncPlayerToolsOffer({ startTrial: false });
          });
          assert.equal(await page.locator('.product-offers').isVisible(), false,
            'A failed refresh must not show banners to an existing Pro user');
        }
        await page.close();
      }
    }
    console.log('Popup offer loading verification passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
