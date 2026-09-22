const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-limit-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium",
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    let total = 0;
    await context.route("https://soundcloud.com/**", route => {
      const tracks = Array.from({ length: Math.min(total, 50) }, (_, index) => ({
        id: index + 1, title: `Track ${index + 1}`,
        permalink_url: `https://soundcloud.com/artist/track-${index + 1}`,
        user: { username: "Artist" },
        media: { transcodings: [{ url: "https://api-v2.soundcloud.com/media/test", preset: "mp3_128", format: { protocol: "progressive", mime_type: "audio/mpeg" } }] },
      }));
      return route.fulfill({ contentType: "text/html", body:
        `<script>window.__sc_hydration = ${JSON.stringify([{ hydratable: "playlist", data: {
          title: "Collection", track_count: total, tracks, user: { username: "Artist" },
        } }])};</script><script>client_id="client-test-12345678901234567890"</script>` });
    });
    const soundcloud = await context.newPage();
    await soundcloud.goto("https://soundcloud.com/artist/sets/test");
    for (const count of [0, 1, 25, 26, 49, 50, 51, 200, 1000]) {
      total = count;
      await soundcloud.reload();
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      if (count > 0) {
        await popup.waitForFunction(() => !document.querySelector("#downloadLimitControl").classList.contains("is-hidden"));
        const state = await popup.evaluate((count) => ({
          value: document.querySelector("#downloadLimit").value,
          allLabel: document.querySelector("#downloadLimitAll").textContent,
          selectLabel: document.querySelector("#downloadLimitSelect").textContent,
          totalLabel: new Intl.NumberFormat(chrome.i18n.getUILanguage()).format(count),
          parsed: selectedDownloadLimit(),
        }), count);
        const expected = count > 50 ? 50 : "all";
        assert.equal(state.parsed, expected, `Default for ${count}`);
        assert(state.value === "50" || state.value.length > 0, `Default must be visible for ${count}`);
        assert(state.allLabel.endsWith(` · ${state.totalLabel}`),
          `All must show the total for ${count}`);
        assert(state.selectLabel.length > 0, "Select must be available");
        if (count === 1000) {
          await popup.locator("#downloadLimit").focus();
          assert.equal(await popup.locator("#downloadLimitMenu").isVisible(), true);
          await fs.mkdir(path.join(root, "test-results"), { recursive: true });
          await popup.locator("body").screenshot({ path: path.join(root, "test-results", "popup-amount-menu.png") });
          await popup.locator("#downloadLimit").fill("32");
          const selected = await popup.evaluate(() => {
            const control = document.querySelector("#downloadLimit");
            const total = new Intl.NumberFormat(chrome.i18n.getUILanguage()).format(1000);
            const amount = new Intl.NumberFormat(chrome.i18n.getUILanguage()).format(32);
            return {
              amount: selectedDownloadLimit(),
              tooltip: control.title,
              expectedTooltip: t("download_part_count", [amount, total]),
              buttonTooltip: document.querySelector("#downloadBtn").title,
            };
          });
          assert.equal(selected.amount, 32);
          assert.equal(selected.tooltip, selected.expectedTooltip);
          assert.equal(selected.buttonTooltip, selected.expectedTooltip);
          await popup.locator("#downloadLimit").fill("99999");
          assert.equal(await popup.evaluate(() => selectedDownloadLimit()), 1000,
            "Typed amounts must stop at the collection total");
          await popup.locator("#downloadLimit").fill("0");
          assert.equal(await popup.evaluate(() => selectedDownloadLimit()), 0);
          assert.equal(await popup.locator("#downloadBtn").isDisabled(), true);
          await popup.locator("#downloadLimitAll").click();
          assert.equal(await popup.evaluate(() => selectedDownloadLimit()), "all");
          assert.equal(await popup.locator("#downloadBtn").isEnabled(), true);
        }
        if (count === 25) {
          await popup.evaluate(() => {
            currentDownloadDestination = { id: "test", name: "Music" };
            renderDownloadDestination();
            enterSelectionMode(Array.from({ length: 8 }, (_, index) => ({
              id: index + 1, index: index + 1, title: `Track ${index + 1}`, duration: "3:00",
            })));
          });
          const layout = await popup.evaluate(() => {
            const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
            const header = ["#selectionBackBtn", "#downloadFormat", "#chooseDownloadFolder", "#resetDownloadFolder", "#clearAllBtn", "#selectAllBtn", "#helpBtn"]
              .map((selector) => rect(selector));
            return {
              height: document.body.offsetHeight,
              headerAligned: Math.max(...header.map((item) => item.top)) - Math.min(...header.map((item) => item.top)) <= 3,
              formatWidth: rect("#downloadFormat").width,
              offersVisible: rect(".product-offers").bottom < rect(".selection-header").top,
              downloadBelowList: rect("#downloadBtn").top > rect("#selectionViewport").bottom,
              footerVisible: rect(".download-button-container").bottom <= rect("body").bottom,
              helpInHeader: document.querySelector("#helpBtn").closest(".selection-header") !== null,
            };
          });
          assert.equal(layout.height, 580);
          assert.equal(layout.headerAligned, true);
          assert(layout.formatWidth <= 85);
          assert.equal(layout.offersVisible, true);
          assert.equal(layout.downloadBelowList, true);
          assert.equal(layout.footerVisible, true);
          assert.equal(layout.helpInHeader, true);
          await fs.mkdir(path.join(root, "test-results"), { recursive: true });
          await popup.locator("body").screenshot({ path: path.join(root, "test-results", "popup-selection.png") });
        }
      }
      await popup.close();
    }
    console.log("Real popup bulk limits passed for 0, 1, 25, 26, 49, 50, 51, 200 and 1000 tracks.");
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
