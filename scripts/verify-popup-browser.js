const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) {
    const page = await browser.newPage({
      viewport: { width: 426, height: 244 }, deviceScaleFactor,
    });
    // Exercise the popup's real layout without SoundCloud or extension API calls.
    const html = fs.readFileSync(path.resolve(__dirname, "..", "popup.html"), "utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    await page.setContent(html);
    await page.evaluate(() => {
      document.querySelector("#loadingOverlay").classList.add("is-hidden");
      document.querySelector("#waveformCanvas").style.display = "none";
      document.querySelector("#title").textContent = "t t o r i o - Tracks";
    });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: Math.max(innerHeight, document.body.offsetHeight),
      scrollHeight: document.documentElement.scrollHeight,
    }));
    console.log(dimensions);
    assert.equal(dimensions.scrollWidth, dimensions.width, "Popup must not overflow its right edge");
    assert.equal(dimensions.scrollHeight, dimensions.height, "Popup must not overflow its bottom edge");
    await page.setViewportSize({ width: 432, height: 252 });
    await page.evaluate(() => {
      const artwork = document.querySelector("#artwork");
      artwork.style.background = "rgb(200, 100, 150)";
      artwork.style.filter = "none";
    });
    // Four CSS pixels align to whole device pixels at all tested scales.
    const corner = await page.screenshot({ clip: { x: 0, y: 0, width: 4, height: 4 } });
    for (const [x, y] of [[428, 0], [0, 248], [428, 248]]) {
      assert.deepEqual(
        await page.screenshot({ clip: { x, y, width: 4, height: 4 } }),
        corner,
        `The popup background must cover the viewport at ${x},${y}`,
      );
    }
    await page.setViewportSize({ width: 426, height: 580 });
    const source = fs.readFileSync(path.resolve(__dirname, "popup.js"), "utf8");
    const selectTab = source.slice(source.indexOf("function selectHelpTab("), source.indexOf("async function openRequestedPopupView"));
    await page.evaluate((selectTab) => {
      window.helpPanel = document.getElementById("helpPanel");
      document.body.classList.add("help-mode");
      helpPanel.classList.add("is-visible");
      window.eval(selectTab);
    }, selectTab);
    for (const id of ["downloadsTab", "looperTab", "supportTab"]) {
      await page.evaluate((id) => selectHelpTab(document.getElementById(id)), id);
      assert.equal(await page.locator('#helpPanel [role="tabpanel"]:visible').count(), 1);
      assert.equal(await page.locator(`#${id}`).getAttribute("aria-selected"), "true");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 426);
      if (deviceScaleFactor === 1) {
        fs.mkdirSync(path.resolve(__dirname, "..", "test-results"), { recursive: true });
        await page.screenshot({ path: path.resolve(__dirname, "..", "test-results", `help-${id}.png`) });
      }
    }
    await page.close();
    console.log(`Popup browser verification passed at scale ${deviceScaleFactor}.`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
