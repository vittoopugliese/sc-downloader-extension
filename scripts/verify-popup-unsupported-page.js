const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-popup-page-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.SCDL_CHROME_PATH ? { executablePath: process.env.SCDL_CHROME_PATH } : { channel: "chromium" }),
    args: ["--disable-extensions-except=" + root, "--load-extension=" + root],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    await fs.mkdir(path.join(root, "test-results"), { recursive: true });
    for (const mode of [false, true, "offline", "malformed"]) {
      for (const onSoundCloud of [false, true]) {
        const page = await context.newPage();
        await page.addInitScript(({ mode, onSoundCloud }) => {
          window.popupMessages = [];
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = (message, ...args) => {
            popupMessages.push(message.type);
            if (message.type === "GET_DOWNLOAD_POLICY") return new Promise((resolve, reject) => {
              window.resolvePolicy = () => mode === "offline" ? reject(new Error("offline")) : resolve({ policy: { allDownloadsActivated: mode } });
            });
            return send(message, ...args);
          };
          chrome.tabs.query = (_query, callback) => {
            const tabs = [{ id: 1, url: onSoundCloud ? "https://soundcloud.com/test/track" : "https://example.com" }];
            return callback ? callback(tabs) : Promise.resolve(tabs);
          };
        }, { mode, onSoundCloud });
        await page.goto("chrome-extension://" + extensionId + "/popup.html");
        await page.waitForFunction(() => typeof resolvePolicy === "function");
        assert.equal(await page.locator("#downloadBtn").isVisible(), false, "Downloader must not flash before policy resolves");
        await page.evaluate(() => resolvePolicy());
        await page.waitForFunction(() => !document.body.classList.contains("policy-pending"));
        if (mode !== true) {
          assert.equal(await page.locator("#helpPanel").isVisible(), true);
          assert.equal(await page.locator("#helpBackBtn").isVisible(), false);
          assert.equal(await page.locator("#speedTab").getAttribute("aria-selected"), "true");
          assert.equal(await page.evaluate(() => document.activeElement.id), "speedTab");
          if (mode === false && !onSoundCloud) {
            await page.locator("body").screenshot({ path: path.join(root, "test-results", "popup-help-home.png") });
          }
          assert.equal(await page.locator("#errorOverlay").isVisible(), false);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#helpPanel").isVisible(), true);
          await page.locator("#likesHelpTab").click();
          assert.equal(await page.locator("#likesHelp a").getAttribute("href"), "https://soundcloud.com/you/likes#scdl-explore");
          await page.locator("#downloadsTab").click();
          assert.equal(await page.locator(".permitted-downloads-guide").isVisible(), true);
          assert.equal(await page.locator('[data-i18n="help_collection"]').isVisible(), false);
          assert.deepEqual(await page.evaluate(() => popupMessages), ["GET_DOWNLOAD_POLICY"], "Help home must not start downloader jobs or track polling");
          await page.locator("#speedTab").focus();
          await page.keyboard.press("ArrowRight");
          assert.equal(await page.locator("#looperTab").getAttribute("aria-selected"), "true");
        } else if (!onSoundCloud) {
          await page.waitForFunction(() => document.getElementById("errorOverlay").classList.contains("is-visible"));
          assert.equal(await page.locator("#helpPanel").isVisible(), false);
          await page.evaluate(() => openHelp());
          assert.equal(await page.locator("#helpBackBtn").isVisible(), true);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#helpPanel").isVisible(), false);
        }
        await page.close();
      }
    }
    await worker.evaluate(() => chrome.storage.local.set({ "scdl.popup.startView": "looper" }));
    const page = await context.newPage();
    await page.addInitScript(() => {
      chrome.runtime.sendMessage = async () => ({ policy: { allDownloadsActivated: false } });
    });
    await page.goto("chrome-extension://" + extensionId + "/popup.html");
    await page.waitForFunction(() => document.getElementById("looperTab").getAttribute("aria-selected") === "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#helpPanel").isVisible(), true);
    console.log("Popup policy, help home, keyboard, deep-link and unsupported-page verification passed.");
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
