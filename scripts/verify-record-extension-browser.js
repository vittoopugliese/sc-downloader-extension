// Load the working tree as an extension: exercise the real MAIN/isolated bridge
// and chrome-extension AudioWorklet URL, without contacting SoundCloud.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    await context.route("https://**/*", route => {
      if (route.request().url() === "https://soundcloud.com/artist/record-test") {
        return route.fulfill({ contentType: "text/html", body: `<!doctype html>
          <style>body{background:#111}.playControls__elements{position:fixed;bottom:0;left:0;display:flex;width:100%;height:48px}</style>
          <div class="playControls__elements"><div class="playControls__soundBadge"></div></div>` });
      }
      return route.abort();
    });
    const page = await context.newPage({ viewport: { width: 1100, height: 1000 } });
    await page.goto("https://soundcloud.com/artist/record-test");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-scdl-extension-record-worklet-url"));
    await page.evaluate(() => document.dispatchEvent(new Event("scdl:open-player-tools-panel")));
    const host = page.locator("#scdl-tempo-control");
    await host.locator(".record-toggle").click();
    await host.locator(".record-start").click();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot
      .querySelector(".record-section").dataset.recording === "true");
    assert.equal(await host.locator(".record-icon").evaluate(icon => icon.complete && icon.naturalWidth > 0), true);
    // Feed a real sampler through the extension's normal context/output route.
    await host.locator(".sampler-toggle").click();
    await host.locator('.drum-pad[data-drum-index="0"]').click();
    await page.waitForTimeout(600);
    await host.locator(".record-stop").click();
    await page.waitForFunction(() => !document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".record-download").disabled);
    const pending = page.waitForEvent("download");
    await host.locator(".record-download").click();
    const bytes = fs.readFileSync(await (await pending).path());
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    assert.ok(peak > 1000, "The installed extension must record its actual sampler output");
    console.log("Record extension: working-tree manifest, asset bridge, AudioWorklet, sampler and WAV download passed.");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
