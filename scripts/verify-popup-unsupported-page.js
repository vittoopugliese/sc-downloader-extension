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
    ...(process.env.SCDL_CHROME_PATH
      ? { executablePath: process.env.SCDL_CHROME_PATH }
      : { channel: "chromium" }),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });

  try {
    const worker =
      context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();

    await popup.addInitScript(() => {
      chrome.tabs.query = (_queryInfo, callback) => {
        callback([{ id: 1, url: "https://example.com/not-soundcloud" }]);
      };
    });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await assert.doesNotReject(
      popup.waitForFunction(
        () =>
          document.getElementById("loadingOverlay").classList.contains("is-hidden") &&
          document.getElementById("errorOverlay").classList.contains("is-visible"),
        null,
        { timeout: 1500 },
      ),
      "Opening the popup outside SoundCloud must immediately replace loading with the unsupported-page error",
    );

    console.log("Popup unsupported-page verification passed.");
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
