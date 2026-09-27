const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("http://tooltips.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<div class="playControls__elements"></div><button id="native" title="Native help">Native</button><audio></audio>',
    }));
    const scripts = ["fast-tooltips", "tempo-control-core", "sampler-core", "parametric-eq", "audio-effects-core", "player-tools-collapsible", "parametric-eq-ui", "tempo-control-main"];
    await context.addInitScript({ path: path.join(__dirname, "fast-tooltips.js") });
    // Explicit injection preserves dependency order across reloads.
    const page = await context.newPage();
    async function load(target) {
      await target.goto("http://tooltips.test/");
      for (const name of scripts.slice(1)) await target.addScriptTag({ path: path.join(__dirname, `${name}.js`) });
      await target.waitForSelector("#scdl-tempo-control");
    }
    await load(page);
    const toggle = page.locator(".tooltips-button");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await toggle.evaluate((el) => el.previousElementSibling.classList.contains("download-track-button") && el.nextElementSibling.classList.contains("reset-tools-button")), true);
    await page.locator("#native").hover();
    await page.waitForFunction(() => document.querySelector("#scdl-fast-tooltip")?.style.visibility === "visible");
    await toggle.evaluate((el) => el.click());
    assert.equal(await page.locator("#scdl-fast-tooltip").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("#native").getAttribute("title"), "");
    await page.evaluate(() => {
      const root = document.querySelector("#scdl-tempo-control").shadowRoot;
      const button = document.createElement("button");
      button.id = "dynamic-help";
      button.title = "Dynamic help";
      root.append(button);
    });
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot.querySelector("#dynamic-help").title === "");
    await page.locator("#dynamic-help").evaluate((el) => { el.title = "Updated help"; el.focus(); });
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#dynamic-help").getAttribute("title"), "");
    // Detached shadow controls must restore without an observer feedback loop,
    // then become suppressed again when reinserted.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "nested-host";
      host.attachShadow({ mode: "open" }).innerHTML = '<button title="Nested help">Help</button>';
      document.body.append(host);
    });
    assert.equal(await page.locator("#nested-host button").getAttribute("title"), "");
    await page.evaluate(() => {
      window.detachedHelp = document.querySelector("#nested-host");
      window.detachedHelp.remove();
    });
    assert.equal(await page.evaluate(() => window.detachedHelp.shadowRoot.querySelector("button").title), "Nested help");
    await page.evaluate(() => document.body.append(window.detachedHelp));
    assert.equal(await page.locator("#nested-host button").getAttribute("title"), "");
    await toggle.evaluate((el) => el.click());
    assert.equal(await page.locator("#dynamic-help").getAttribute("title"), "Updated help");
    assert.equal(await page.locator("#native").getAttribute("title"), "Native help");
    // A queued show must not resurrect a disabled tooltip.
    await page.locator("#native").focus();
    await toggle.evaluate((el) => el.click());
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#scdl-fast-tooltip").evaluate((el) => getComputedStyle(el).display), "none");
    await load(page);
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#scdl-fast-tooltip").evaluate((el) => getComputedStyle(el).display), "none");
    const second = await context.newPage();
    await load(second);
    await second.locator(".tooltips-button").evaluate((el) => el.click());
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".tooltips-button").getAttribute("aria-pressed") === "true");
    await page.locator("#native").hover();
    await page.waitForFunction(() => document.querySelector("#scdl-fast-tooltip").style.visibility === "visible");
    console.log("Tooltip toggle: default, header order, immediate hide, native/dynamic titles, pending timer, reload and tab sync passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
