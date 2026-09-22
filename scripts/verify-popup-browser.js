const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");
const logoDataUrl = `data:image/png;base64,${fs.readFileSync(
  path.resolve(__dirname, "..", "assets", "icon128.png")
).toString("base64")}`;
const playerToolsDataUrl = `data:image/png;base64,${fs.readFileSync(
  path.resolve(__dirname, "..", "assets", "icons", "player-toolkit.png")
).toString("base64")}`;
const likesExplorerDataUrl = `data:image/png;base64,${fs.readFileSync(
  path.resolve(__dirname, "..", "assets", "images", "likes-explorer.png")
).toString("base64")}`;
const iconDataUrls = Object.fromEntries(
  ["help.svg", "download.svg", "folder-icon.svg", "back-arrow.svg", "bypass.svg"].map((fileName) => [
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
    await page.addScriptTag({ path: path.join(__dirname, "fast-tooltips.js") });
    await page.evaluate(({ logoUrl, playerToolsUrl, likesExplorerUrl, icons }) => {
      document.querySelector("#loadingOverlay").classList.add("is-hidden");
      document.querySelector("#title").textContent = "t t o r i o - Tracks";
      document.querySelector("#artist").textContent = "t t o r i o";
      document.querySelector("#artistArtwork").src = logoUrl;
      document.querySelector(".player-tools-offer img").src = playerToolsUrl;
      document.querySelector(".likes-explorer-thumb").src = likesExplorerUrl;
      document.querySelector("#playerToolsTrialStatus").textContent = "7 days left in your free trial";
      document.querySelectorAll("img[src]").forEach((image) => {
        const fileName = image.getAttribute("src").split("/").at(-1);
        if (icons[fileName]) image.src = icons[fileName];
      });
      document.querySelector("#duration").style.display = "none";
      document.querySelector("#downloadFormat").classList.remove("is-hidden");
      document.querySelector("#downloadLimitControl").classList.remove("is-hidden");
      document.querySelector("#downloadLimit").value = "300";
      document.querySelector("#downloadLimitAll").textContent = "All · 1,632";
      document.querySelector("#downloadLimit").title = "Will download 300 of 1,632 tracks";
      document.querySelector("#chooseDownloadFolder").classList.remove("is-hidden");
      document.querySelector("#chooseDownloadFolder").classList.add("has-custom-folder");
      document.querySelector("#resetDownloadFolder").classList.remove("is-hidden");
      document.querySelector("#downloadBtn").classList.remove("is-hidden");
      const artwork = document.querySelector("#artwork");
      artwork.style.background = "linear-gradient(135deg, #6b2109, #173342)";
    }, { logoUrl: logoDataUrl, playerToolsUrl: playerToolsDataUrl, likesExplorerUrl: likesExplorerDataUrl, icons: iconDataUrls });
    if (deviceScaleFactor === 1) {
      const helpButton = page.locator("#helpBtn");
      await helpButton.hover();
      await page.waitForTimeout(410);
      const helpTooltip = await helpButton.evaluate((button) => {
        const tip = document.querySelector("#scdl-fast-tooltip");
        const rect = tip.getBoundingClientRect();
        return {
          text: tip.textContent,
          visible: tip.style.visibility,
          titleRemoved: !button.hasAttribute("title"),
          insideViewport: rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth,
        };
      });
      assert.deepEqual(helpTooltip, {
        text: "Help and settings", visible: "visible", titleRemoved: true, insideViewport: true,
      }, "The top popup button must show its custom tooltip inside the viewport");
      await page.mouse.move(425, 240);
      assert.equal(await helpButton.getAttribute("title"), "Help and settings");
      await helpButton.focus();
      await page.waitForTimeout(410);
      assert.equal(await page.locator("#scdl-fast-tooltip").textContent(), "Help and settings");
      assert.equal(await page.locator("#scdl-fast-tooltip").evaluate((tip) => tip.style.visibility), "visible");
      await page.locator("#downloadBtn").hover();
      await page.waitForTimeout(410);
      assert.equal(await page.locator("#scdl-fast-tooltip").textContent(), "Download");
      for (const [selector, label] of [
        ["#downloadFormat", "Download format"],
        ["#downloadLimit", "Will download 300 of 1,632 tracks"],
      ]) {
        const select = page.locator(selector);
        await select.hover();
        await page.waitForTimeout(410);
        assert.equal(await page.locator("#scdl-fast-tooltip").textContent(), label);
        assert.equal(await page.locator("#scdl-fast-tooltip").evaluate((tip) => tip.style.visibility), "visible");
        assert.equal(await select.getAttribute("title"), null);
        await page.mouse.move(425, 240);
        assert.equal(await select.getAttribute("title"), label);
      }
      assert.ok((await page.locator("#downloadFormat").boundingBox()).width <= 150,
        "The format selector should fit the toolbar");
    }
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
      const collectionCenters = ["#downloadFormat", "#downloadLimitControl", "#chooseDownloadFolder", "#resetDownloadFolder", "#downloadBtn"]
        .map((selector) => document.querySelector(selector).getBoundingClientRect())
        .map((rect) => Math.round(rect.top + rect.height / 2));
      return {
        settingsSize: size(document.querySelector("#helpBtn")),
        downloadSize: size(document.querySelector("#downloadBtn")),
        downloadRadius: style("#downloadBtn").borderRadius,
        controlRadius: style("#downloadFormat").borderRadius,
        titleSize: style("#title").fontSize,
        divider: style(".track-info").borderBottomStyle,
        selectionDivider: style(".selection-header").borderBottomStyle,
        offerImageSize: size(document.querySelector(".player-tools-offer img")),
        offerTitleSize: style(".player-tools-offer-title").fontSize,
        offerDetailSize: style(".player-tools-offer-detail").fontSize,
        offerTrialSize: style("#playerToolsTrialStatus").fontSize,
        offerPriceSize: style(".player-tools-offer-price").fontSize,
        likesImageSize: size(document.querySelector(".likes-explorer-thumb")),
        productColumns: style(".product-offers").gridTemplateColumns.split(" ").length,
        artworkFilter: style("#artwork").filter,
        collectionControlsAligned: Math.max(...collectionCenters) - Math.min(...collectionCenters) <= 1,
      };
    });
    assert.equal(mainTheme.likesImageSize[0], 58);
    assert.ok(mainTheme.likesImageSize[1] >= 77, "The Likes Explorer image must fill its offer card");
    delete mainTheme.likesImageSize;
    assert.deepEqual(mainTheme, {
      settingsSize: [27, 24],
      downloadSize: [42, 32],
      downloadRadius: "7px",
      controlRadius: "7px",
      titleSize: "19px",
      divider: "none",
      selectionDivider: "none",
      offerImageSize: [38, 38],
      offerTitleSize: "13px",
      offerDetailSize: "9px",
      offerTrialSize: "9px",
      offerPriceSize: "10px",
      productColumns: 2,
      artworkFilter: "brightness(0.641) blur(5px)",
      collectionControlsAligned: true,
    }, "The download popup must use the compact player-panel component system");
    await page.setViewportSize({ width: 426, height: 350 });
    const commerceFit = await page.evaluate(() => {
      const panel = document.querySelector('#commercePanel');
      document.querySelector('#commerceTitle').textContent = 'Player Tools Pro';
      panel.querySelector('.commerce-scroll > p').textContent = 'Un solo pago desbloquea tempo, Keep Tone, loops, efectos y exportaciones Pro en esta instalacion.';
      document.querySelector('#commerceBuyBtn').textContent = 'Comprar de forma segura';
      document.querySelector('#commerceRestoreBtn').textContent = 'Activar / restaurar';
      document.querySelector('#commerceCloseBtn').textContent = 'Cerrar';
      panel.hidden = false;
      const card = document.querySelector('.commerce-card').getBoundingClientRect();
      const buttons = ['#commerceBuyBtn', '#commerceRestoreBtn', '#commerceCloseBtn']
        .map((selector) => document.querySelector(selector).getBoundingClientRect());
      const scroll = document.querySelector('.commerce-scroll').getBoundingClientRect();
      const fields = ['#commerceEmail', '#commerceLicenseKey']
        .map((selector) => document.querySelector(selector).getBoundingClientRect());
      return {
        cardTop: Math.round(card.top),
        cardBottom: Math.round(card.bottom),
        buttonsVisible: buttons.every((rect) => rect.top >= 0 && rect.bottom <= innerHeight),
        fieldsVisible: fields.every((rect) => rect.top >= scroll.top && rect.bottom <= scroll.bottom),
        viewportHeight: innerHeight,
      };
    });
    assert.equal(commerceFit.buttonsVisible, true,
      `Player Tools commerce actions must remain visible inside the popup: ${JSON.stringify(commerceFit)}`);
    assert.equal(commerceFit.fieldsVisible, true,
      `Player Tools license fields must be visible without scrolling: ${JSON.stringify(commerceFit)}`);
    if (deviceScaleFactor === 1) {
      fs.mkdirSync(path.resolve(__dirname, "..", "test-results"), { recursive: true });
      await page.screenshot({ path: path.resolve(__dirname, "..", "test-results", "popup-commerce.png") });
    }
    await page.locator('#commercePanel').evaluate((panel) => { panel.hidden = true; });
    if (deviceScaleFactor === 1) {
      fs.mkdirSync(path.resolve(__dirname, "..", "test-results"), { recursive: true });
      await page.screenshot({ path: path.resolve(__dirname, "..", "test-results", "popup-main.png"), fullPage: true });
      const trackLayout = await page.evaluate(() => {
        document.querySelector("#title").textContent = "Last Piece (1)";
        document.querySelector("#artist").textContent = "Julie Hannon";
        const duration = document.querySelector("#duration");
        duration.textContent = "3:22";
        duration.style.display = "";
        document.querySelector('#downloadFormat option[value="auto"]').textContent = "Auto · MP3";
        document.querySelector("#downloadLimitControl").classList.add("is-hidden");
        document.querySelector("#resetDownloadFolder").classList.add("is-hidden");
        document.querySelector("#chooseDownloadFolder").classList.remove("has-custom-folder");
        const controls = ["#downloadFormat", "#chooseDownloadFolder", "#downloadBtn"]
          .map((selector) => document.querySelector(selector).getBoundingClientRect());
        return {
          aligned: Math.max(...controls.map((rect) => rect.top)) - Math.min(...controls.map((rect) => rect.top)) <= 1,
          durationAbove: duration.getBoundingClientRect().bottom < controls[0].top,
        };
      });
      assert.deepEqual(trackLayout, { aligned: true, durationAbove: true },
        "Single-track duration must sit above one toolbar row");
      await page.screenshot({ path: path.resolve(__dirname, "..", "test-results", "popup-track.png"), fullPage: true });
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
