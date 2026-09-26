const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");

(async () => {
  const extension = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-free-pro-"));
  const context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const result = await page.evaluate(async () => {
      await chrome.storage.local.set({ "scdl.playerTools.access.v1": { obsolete: true },
        "scdl.playerTools.commerce.v1": { status: "revoked" } });
      return {
        access: await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_SNAPSHOT" }),
        trial: await chrome.runtime.sendMessage({ type: "START_PLAYER_TOOLS_TRIAL" }),
        commerce: await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_COMMERCE", revalidate: true }),
      };
    });
    assert.equal(result.access.snapshot.plan, "pro");
    assert.equal(result.trial.snapshot.plan, "pro");
    assert.ok(Object.values(result.access.snapshot.capabilities).every(Boolean));
    assert.equal(result.commerce.commerce.canCheckout, false);
    for (const selector of [".product-offers", "#playerToolsProBtn", "#commercePanel"]) {
      assert.equal(await page.locator(selector).count(), 1, "Commercial markup must remain present");
      assert.equal(await page.locator(selector).isVisible(), false, selector);
    }
    assert.equal(await page.locator("#downloadBtn").count(), 1);
    assert.deepEqual(errors, []);
    console.log("Free Pro browser passed: packaged worker, old stored state, full capabilities, hidden commerce UI.");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
