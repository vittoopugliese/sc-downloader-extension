const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const image = fs.readFileSync(path.join(root, "extension-content/images/promo-v1.png"));
const content = JSON.parse(fs.readFileSync(path.join(root, "extension-content/contact.json"), "utf8"));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 426, height: 580 } });
    await page.route(content.image.url, (route) => route.fulfill({ body: image, contentType: "image/png" }));
    const html = fs.readFileSync(path.join(root, "popup.html"), "utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    await page.setContent(html);
    await page.evaluate((remote) => {
      document.getElementById("loadingOverlay").classList.add("is-hidden");
      document.body.classList.add("help-mode");
      document.getElementById("helpPanel").classList.add("is-visible");
      document.getElementById("downloadsHelp").hidden = true;
      document.getElementById("supportHelp").hidden = false;
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
        "contactContentImage", "supportHelp"];
      const elements = ids.map((id) => document.getElementById(id));
      const image = elements[3];
      const card = document.querySelector("#supportHelp > .help-section");
      const credit = document.querySelector("#supportHelp > .help-credit");
      return {
        tops: [...elements.slice(0, 4), card, credit].map((el) => el.getBoundingClientRect().top),
        imageWidth: image.getBoundingClientRect().width,
        contentWidth: document.getElementById("contactContent").getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        contactLinks: card.querySelectorAll("a").length,
        creditVisible: !credit.hidden
      };
    });
    assert.deepEqual([...layout.tops].sort((a, b) => a - b), layout.tops, "Contact order changed");
    assert.ok(layout.imageWidth <= layout.contentWidth, "Image overflows Contact");
    assert.equal(layout.scrollWidth, layout.viewportWidth, "Popup overflows horizontally");
    assert.equal(layout.contactLinks, 3);
    assert.equal(layout.creditVisible, true);
    console.log("Contact browser layout checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
