const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");
const logoDataUrl = `data:image/png;base64,${fs.readFileSync(
  path.resolve(__dirname, "..", "assets", "icon128.png")
).toString("base64")}`;
const iconDataUrls = Object.fromEntries(
  ["settings.svg", "download.svg", "folder-icon.svg", "back-arrow.svg", "bypass.svg"].map((fileName) => [
    fileName,
    `data:image/svg+xml;base64,${fs.readFileSync(path.resolve(__dirname, "..", "assets", "icons", fileName)).toString("base64")}`,
  ])
);

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
    await page.evaluate(({ logoUrl, icons }) => {
      document.querySelector("#loadingOverlay").classList.add("is-hidden");
      document.querySelector("#title").textContent = "t t o r i o - Tracks";
      document.querySelector("#artist").textContent = "t t o r i o";
      document.querySelector("#artistArtwork").src = logoUrl;
      document.querySelectorAll("img[src]").forEach((image) => {
        const fileName = image.getAttribute("src").split("/").at(-1);
        if (icons[fileName]) image.src = icons[fileName];
      });
      document.querySelector("#duration").textContent = "1632 tracks";
      document.querySelector("#streamFormat").style.display = "none";
      document.querySelector("#downloadFormat").classList.remove("is-hidden");
      document.querySelector("#downloadLimit").classList.remove("is-hidden");
      document.querySelector("#chooseDownloadFolder").classList.remove("is-hidden");
      document.querySelector("#downloadBtn").classList.remove("is-hidden");
      const artwork = document.querySelector("#artwork");
      artwork.style.background = "linear-gradient(135deg, #6b2109, #173342)";
    }, { logoUrl: logoDataUrl, icons: iconDataUrls });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: Math.max(innerHeight, document.body.offsetHeight),
      scrollHeight: document.documentElement.scrollHeight,
    }));
    console.log(dimensions);
    assert.equal(dimensions.scrollWidth, dimensions.width, "Popup must not overflow its right edge");
    assert.equal(dimensions.scrollHeight, dimensions.height, "Popup must not overflow its bottom edge");
    const mainTheme = await page.evaluate(() => {
      const size = (element) => [element.offsetWidth, element.offsetHeight];
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      const collectionCenters = ["#duration", "#metaSep", "#downloadFormat", "#downloadLimit", "#chooseDownloadFolder"]
        .map((selector) => document.querySelector(selector).getBoundingClientRect())
        .map((rect) => Math.round(rect.top + rect.height / 2));
      return {
        settingsSize: size(document.querySelector("#helpBtn")),
        downloadSize: size(document.querySelector("#downloadBtn")),
        downloadRadius: style("#downloadBtn").borderRadius,
        controlRadius: style("#downloadFormat").borderRadius,
        titleSize: style("#title").fontSize,
        divider: style(".track-info").borderBottomStyle,
        artworkFilter: style("#artwork").filter,
        collectionControlsAligned: Math.max(...collectionCenters) - Math.min(...collectionCenters) <= 1,
      };
    });
    assert.deepEqual(mainTheme, {
      settingsSize: [27, 24],
      downloadSize: [44, 32],
      downloadRadius: "7px",
      controlRadius: "7px",
      titleSize: "19px",
      divider: "solid",
      artworkFilter: "brightness(0.641) blur(5px)",
      collectionControlsAligned: true,
    }, "The download popup must use the compact player-panel component system");
    if (deviceScaleFactor === 1) {
      fs.mkdirSync(path.resolve(__dirname, "..", "test-results"), { recursive: true });
      await page.screenshot({ path: path.resolve(__dirname, "..", "test-results", "popup-main.png") });
    }
    await page.setViewportSize({ width: 432, height: 252 });
    await page.evaluate(() => {
      const artwork = document.querySelector("#artwork");
      artwork.style.background = "rgb(200, 100, 150)";
      artwork.style.filter = "none";
    });
    const backgroundCoverage = await page.locator(".container").evaluate((container) => {
      const overlay = getComputedStyle(container, "::before");
      return [overlay.position, overlay.top, overlay.right, overlay.bottom, overlay.left, overlay.backgroundColor];
    });
    assert.deepEqual(
      backgroundCoverage.slice(0, 5),
      ["fixed", "0px", "0px", "0px", "0px"],
      "The popup background overlay must cover the full viewport",
    );
    assert.notEqual(backgroundCoverage[5], "rgba(0, 0, 0, 0)", "The popup background overlay must remain visible");
    await page.setViewportSize({ width: 426, height: 580 });
    const source = fs.readFileSync(path.resolve(__dirname, "popup.js"), "utf8");
    const selectTab = source.slice(source.indexOf("function selectHelpTab("), source.indexOf("async function openRequestedPopupView"));
    await page.evaluate((selectTab) => {
      window.helpPanel = document.getElementById("helpPanel");
      document.body.classList.add("help-mode");
      helpPanel.classList.add("is-visible");
      window.eval(selectTab);
    }, selectTab);
    for (const id of ["downloadsTab", "speedTab", "looperTab", "supportTab"]) {
      await page.evaluate((id) => selectHelpTab(document.getElementById(id)), id);
      await page.waitForTimeout(180);
      assert.equal(await page.locator('#helpPanel [role="tabpanel"]:visible').count(), 1);
      assert.equal(await page.locator(`#${id}`).getAttribute("aria-selected"), "true");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 426);
      const helpTheme = await page.locator(`#${id}`).evaluate((tab) => {
        const tabStyle = getComputedStyle(tab);
        const cardStyle = getComputedStyle(document.querySelector('#helpPanel [role="tabpanel"]:not([hidden]) .help-section'));
        return {
          tabHeight: tab.offsetHeight,
          tabRadius: tabStyle.borderRadius,
          tabBorder: tabStyle.borderColor,
          cardRadius: cardStyle.borderRadius,
          cardBorder: cardStyle.borderColor,
        };
      });
      assert.deepEqual(helpTheme, {
        tabHeight: 27,
        tabRadius: "7px",
        tabBorder: "rgb(255, 85, 0)",
        cardRadius: "10px",
        cardBorder: "rgb(52, 52, 52)",
      }, `Help tab ${id} must share the player-panel controls and surfaces`);
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
