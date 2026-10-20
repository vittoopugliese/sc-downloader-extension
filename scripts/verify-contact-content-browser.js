const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const image = fs.readFileSync(path.join(root, "extension-content/images/promo-v1.png"));
const content = {
  schemaVersion: 1,
  revision: "browser-fixture",
  enabled: true,
  title: "Support",
  description: "Fixture content",
  link: { label: "Contact", url: "https://soundcloud.com/sc-downloader" },
  image: { url: "https://sctd.vpugliese.online/extension-content/images/promo-v1.png", alt: "Promotion" },
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 426, height: 580 } });
    await page.route(content.image.url, (route) => route.fulfill({ body: image, contentType: "image/png" }));
    // The popup no longer mounts remote Contact content; exercise the loader independently.
    await page.setContent(`<style>body{margin:10px;font:13px system-ui}img{display:block;max-width:100%;height:auto}</style>
      <section id="contactContent" hidden>
        <h3 id="contactContentTitle"></h3><p id="contactContentDescription" hidden></p>
        <a id="contactContentLink" hidden></a><img id="contactContentImage" alt="" hidden>
      </section>`);
    await page.evaluate((remote) => {
      chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
      fetch = async (url) => ({
        ok: true, url, headers: { get: () => null }, body: null,
        text: async () => JSON.stringify(remote)
      });
    }, content);
    await page.addScriptTag({ path: path.join(__dirname, "contact-content.js") });
    await page.evaluate(() => SCContactContent.load());
    await page.locator("#contactContentImage:not([hidden])").waitFor();
    const layout = await page.evaluate(() => {
      const ids = ["contactContentTitle", "contactContentDescription", "contactContentLink",
        "contactContentImage"];
      const elements = ids.map((id) => document.getElementById(id));
      const image = elements[3];
      return {
        tops: elements.map((el) => el.getBoundingClientRect().top),
        imageWidth: image.getBoundingClientRect().width,
        contentWidth: document.getElementById("contactContent").getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth
      };
    });
    assert.deepEqual([...layout.tops].sort((a, b) => a - b), layout.tops, "Contact order changed");
    assert.ok(layout.imageWidth <= layout.contentWidth, "Image overflows Contact");
    assert.equal(layout.scrollWidth, layout.viewportWidth, "Popup overflows horizontally");
    console.log("Contact browser layout checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
