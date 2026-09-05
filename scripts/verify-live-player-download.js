const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

const TRACK_URL = process.env.SCDL_LIVE_TRACK_URL ||
  "https://soundcloud.com/forss/flickermood";

async function waitForDownloadedFile(downloadDirectory, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const files = await fs.readdir(downloadDirectory);
    const completeFile = files.find(file => !file.endsWith(".crdownload"));
    if (completeFile) {
      return path.join(downloadDirectory, completeFile);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("No completed file appeared in Downloads before timeout");
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-live-"));
  const downloads = path.join(profile, "downloads");
  await fs.mkdir(downloads);
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.SCDL_CHROME_PATH,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    acceptDownloads: true,
  });

  try {
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    await page.goto(TRACK_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/index.html`);
    const result = await extensionPage.evaluate(async trackUrl => {
      const [tab] = await chrome.tabs.query({ url: `${new URL(trackUrl).origin}/*` });
      if (!tab?.id) {
        throw new Error("SoundCloud tab not found");
      }

      let trackData = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: "GET_TRACK_DATA",
            forceRefresh: attempt === 0,
          });
          if (response?.status === "loaded" && response.kind === "track") {
            trackData = response.data;
            break;
          }
        } catch {
          // The tab can finish navigation before the content script is attached.
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!trackData) {
        throw new Error("Content script did not resolve the live track");
      }

      return chrome.runtime.sendMessage({
        type: "DOWNLOAD_SINGLE_TRACK",
        trackData,
        formatPreference: "auto",
      });
    }, TRACK_URL);
    assert.equal(result?.success, true, result?.error || "Live download failed");
    const downloadedFile = await waitForDownloadedFile(downloads, 180000);
    const file = await fs.stat(downloadedFile);
    assert.ok(file.size > 10000, `Downloaded file is unexpectedly small: ${file.size}`);
    console.log(`Live player download passed: ${path.basename(downloadedFile)} (${file.size} bytes)`);
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith("scdl-live-"));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
