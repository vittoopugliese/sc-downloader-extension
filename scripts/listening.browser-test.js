const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");
const root = path.join(__dirname, "..");
const messages = JSON.parse(fs.readFileSync(path.join(root, "_locales/en/messages.json")));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route("https://**/*", (route) => route.fulfill({ contentType: "image/png", body: fs.readFileSync(path.join(root, "assets/icon128.png")) }));
    page.on("pageerror", (error) => { throw error; });
    await page.setContent(`<style>.playControls{position:fixed;bottom:0}.playbackSoundBadge__avatar{display:inline-block;width:48px;height:48px;background:#613867}</style>
      <main><button id="outside">Outside</button></main><div class="playControls">
      <a class="playbackSoundBadge__avatar" href="#track"><span style="background-image:url(https://i1.sndcdn.com/art-t50x50.jpg)"></span></a>
      <a class="playbackSoundBadge__titleLink" title="Current track">Current track</a><a class="playbackSoundBadge__lightLink">Artist</a>
      <button class="playControl">Play</button><button class="skipControl__previous">Previous</button><button class="skipControl__next">Next</button>
      <div class="playbackTimeline__timePassed"><span class="sc-visuallyhidden">Current time: 1:30</span><span aria-hidden="true">1:30</span></div>
      <div class="playbackTimeline__duration"><span aria-hidden="true">3:00</span></div></div>`);
    await page.evaluate((messages) => {
      window.SCDLI18n = { t: (key) => messages[key]?.message || key };
      window.chrome = { runtime: { onMessage: { addListener: (handler) => { window.playerMessage = handler; } } } };
      document.querySelector(".playControl").onclick = (event) => event.currentTarget.classList.toggle("playing");
      document.querySelector(".skipControl__next").onclick = () => {
        document.querySelector(".playbackSoundBadge__titleLink").setAttribute("title", "Next track");
      };
    }, messages);
    await page.addScriptTag({ path: path.join(__dirname, "listening-view.js") });
    await page.addScriptTag({ path: path.join(__dirname, "listening-content.js") });
    const cover = page.locator(".playbackSoundBadge__avatar");
    await cover.hover();
    assert.equal(await cover.getAttribute("data-scdl-cinema-hint"), "Open cinema mode");
    await cover.focus();
    await cover.press("Enter");
    const cinema = page.locator("#scdl-cinema");
    assert.equal(await cinema.evaluate((dialog) => dialog.matches(":modal")), true);
    assert.equal(await cinema.locator(".title").textContent(), "Current track");
    assert.equal(await cinema.locator("progress").evaluate((el) => el.value), 0.5);
    assert.match(await cinema.locator(".cover").getAttribute("style"), /t500x500/);
    await cinema.getByRole("button", { name: "Play", exact: true }).click();
    await cinema.getByRole("button", { name: "Pause", exact: true }).waitFor();
    assert.equal(await page.locator(".playControl").evaluate((el) => el.classList.contains("playing")), true);
    await cinema.getByRole("button", { name: "Next track", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#scdl-cinema > div").shadowRoot.querySelector(".title").textContent === "Next track");
    await page.keyboard.press("Escape");
    assert.equal(await cinema.count(), 0);
    assert.equal(await cover.evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator(".playControl").evaluate((el) => el.classList.contains("playing")), true, "Closing must preserve playback");
    await cover.click();
    await cinema.getByRole("button", { name: "Close cinema mode" }).click();
    assert.equal(await cinema.count(), 0);
    await cover.click({ modifiers: ["Control"] });
    assert.equal(await cinema.count(), 0, "Modified link clicks keep native behavior");
    await page.evaluate(() => { const player = document.querySelector(".playControls"); player.replaceWith(player.cloneNode(true)); });
    await cover.click();
    assert.equal(await cinema.count(), 1, "SPA replacement retains cinema entry");
    const state = await page.evaluate(() => new Promise((resolve) => playerMessage({ type: "SCDL_LISTENING_STATE" }, {}, resolve)));
    fs.mkdirSync(path.join(root, "test-results/listening"), { recursive: true });
    await page.screenshot({ path: path.join(root, "test-results/listening/cinema.png") });
    await page.evaluate(() => document.querySelector(".playControls").remove());
    await cinema.waitFor({ state: "detached" });

    const popup = await browser.newPage({ viewport: { width: 426, height: 600 } });
    await popup.route("https://**/*", (route) => route.fulfill({ contentType: "image/png", body: fs.readFileSync(path.join(root, "assets/icon128.png")) }));
    await popup.setContent(fs.readFileSync(path.join(root, "popup.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
    await popup.evaluate(({ messages, state }) => {
      window.SCDLI18n = { t: (key) => messages[key]?.message || key };
      window.playerState = state.state;
      window.calls = [];
      window.chrome = { tabs: {
        query: async () => [{ id: 42, url: "https://soundcloud.com/artist/different-track" }],
        sendMessage: async (id, request) => { calls.push({ id, ...request }); return { state: playerState, success: true }; },
        update: async () => {},
      } };
      document.querySelector("#loadingOverlay").classList.add("is-hidden");
      document.querySelector("#title").textContent = "Different download target";
      document.querySelector("#artist").textContent = "Download artist";
      document.querySelector("#downloadBtn").classList.remove("is-hidden");
      document.querySelector("#downloadFormat").classList.remove("is-hidden");
    }, { messages, state });
    await popup.addScriptTag({ path: path.join(__dirname, "listening-view.js") });
    await popup.addScriptTag({ path: path.join(__dirname, "listening-popup.js") });
    await popup.locator("body.listening-active").waitFor();
    assert.equal(await popup.locator("#listeningPlayer .title").textContent(), "Next track");
    assert.equal(await popup.locator("#title").textContent(), "Different download target");
    await popup.getByRole("button", { name: "Previous track" }).click();
    assert.equal(await popup.evaluate(() => calls.some((call) => call.id === 42 && call.action === "previous")), true);
    for (const classes of ["offers-pending", "pro-active", "", "restricted-downloads", "restricted-downloads pro-active"]) {
      await popup.evaluate((classes) => { document.body.className = `listening-active ${classes}`; document.querySelector(".product-offers").hidden = classes.includes("pro-active") || classes.includes("offers-pending"); }, classes);
      assert.equal(await popup.evaluate(() => document.body.scrollHeight <= document.body.clientHeight), true, `No clipped content: ${classes}`);
    }
    await popup.screenshot({ path: path.join(root, "test-results/listening/popup.png") });
    await popup.evaluate(() => { document.body.classList.add("selection-mode"); });
    assert.equal(await popup.locator("#listeningPlayer").isVisible(), false);
    await popup.evaluate(() => { document.body.classList.remove("selection-mode"); playerState = null; });
    await popup.locator("body:not(.listening-active)").waitFor();
    assert.equal(await popup.locator("#listeningPlayer").isVisible(), false);
    console.log("Listening browser checks passed: cinema lifecycle, native controls, SPA, popup state and layout.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
