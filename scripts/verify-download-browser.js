// Run with SCDL_PLAYWRIGHT_PATH pointing to an installed Playwright package.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-verify-"));
  const downloads = path.join(profile, "downloads");
  await fs.mkdir(downloads);
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.SCDL_CHROME_PATH
      ? { executablePath: process.env.SCDL_CHROME_PATH }
      : { channel: "chromium" }),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    acceptDownloads: true,
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    const track = {
      id: 42, title: "Regression track", permalink_url: "https://soundcloud.com/artist/regression",
      user: { username: "Artist" }, duration: 1000,
      media: { transcodings: [{ url: "https://api-v2.soundcloud.com/media/test",
        preset: "mp3_128", format: { protocol: "progressive", mime_type: "audio/mpeg" } }] },
    };
    await context.route("https://soundcloud.com/**", route => route.fulfill({
      contentType: "text/html", body: `<html><head><style>
        .sc-button { box-sizing: border-box; border: 1px solid #ccc; padding: 2px 11px; line-height: 20px; }
        .sc-button-medium { height: 26px; }
        .sc-button-icon { min-width: 26px; }
        .sc-button-responsive > div { display: inline-block; margin-right: 5px; }
        .playControls__elements { display: flex; align-items: center; height: 46px; }
      </style></head><body><script>window.client_id="client-test-12345678901234567890";</script>
      <div class="playControls__elements"><div class="playControls__soundBadge">
      <a class="playbackSoundBadge__titleLink" href="${track.permalink_url}">Track</a>
      </div></div></body></html>`,
    }));
    await context.route("https://api-v2.soundcloud.com/resolve**", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify(track),
    }));
    // Stub only external network responses; keep the extension and browser APIs real.
    const audio = Buffer.alloc(417 * 4);
    for (let offset = 0; offset < audio.length; offset += 417) audio.set([0xff, 0xfb, 0x90, 0x00], offset);
    await worker.evaluate(audioUrl => {
      const originalFetch = fetch;
      globalThis.fetch = (url, options) => String(url).includes("/media/test")
        ? Promise.resolve(new Response(JSON.stringify({ url: audioUrl })))
        : originalFetch(url, options);
    }, `data:audio/mpeg;base64,${audio.toString("base64")}`);
    await page.goto("https://soundcloud.com/discover");
    const button = page.locator("#scdl-player-download");
    await button.waitFor();
    assert.match(await button.locator("img").getAttribute("src"), /assets\/icon48\.png$/);
    await button.click();
    await page.waitForFunction(() => {
      const button = document.getElementById("scdl-player-download");
      return button.classList.contains("is-success") || button.classList.contains("is-error");
    }, null, { timeout: 25000 });
    assert.match(await button.getAttribute("class"), /is-success/, await button.getAttribute("title"));
    const files = await fs.readdir(downloads);
    assert.equal(files.length, 1, "Player must create an actual file in Downloads");
    assert.ok((await fs.stat(path.join(downloads, files[0]))).size >= audio.length);
    console.log("PASS: player → resolver → offscreen → chrome.downloads → file on disk");

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/offscreen.html`);
    await extensionPage.evaluate(async () => {
      const handle = await navigator.storage.getDirectory();
      const request = indexedDB.open("scdl_download_directories", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("handles", "readwrite");
        transaction.objectStore("handles").put(handle, "test-directory");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      await chrome.storage.local.set({ downloadDestination: { id: "test-directory", name: "Test folder" } });
    });
    // Do not leave a second offscreen listener competing with the real worker.
    await extensionPage.goto(`chrome-extension://${extensionId}/index.html`);
    await page.waitForFunction(() => !document.getElementById("scdl-player-download").classList.contains("is-success"));
    await button.click();
    await page.waitForFunction(() => /is-success|is-error/.test(document.getElementById("scdl-player-download").className), null, { timeout: 25000 });
    assert.match(await button.getAttribute("class"), /is-success/, await button.getAttribute("title"));
    const saved = await extensionPage.evaluate(async () => {
      const handle = await navigator.storage.getDirectory();
      const sizes = [];
      for await (const entry of handle.values()) sizes.push((await entry.getFile()).size);
      return sizes;
    });
    assert.equal(saved.length, 1, "Remembered directory must contain the file");
    assert.ok(saved[0] >= audio.length);
    console.log("PASS: remembered directory handle → persisted audio bytes");

    await extensionPage.evaluate(async () => {
      await chrome.storage.local.set({
        downloadDestination: { id: "expired-directory", name: "Expired folder" },
      });
    });
    await page.waitForFunction(() => !document.getElementById("scdl-player-download").classList.contains("is-success"));
    await button.click();
    await page.waitForFunction(() => /is-success|is-error/.test(document.getElementById("scdl-player-download").className), null, { timeout: 25000 });
    assert.match(await button.getAttribute("class"), /is-success/, await button.getAttribute("title"));
    const fallbackFiles = await fs.readdir(downloads);
    assert.equal(fallbackFiles.length, 2, "An unavailable folder must fall back to browser Downloads");
    console.log("PASS: unavailable remembered folder → browser Downloads fallback");

    const centers = await button.evaluate(element => {
      const button = element.getBoundingClientRect();
      const icon = element.querySelector("img").getBoundingClientRect();
      return { x: icon.x + icon.width / 2 - button.x - button.width / 2,
        y: icon.y + icon.height / 2 - button.y - button.height / 2 };
    });
    assert.ok(Math.abs(centers.x) < 0.5 && Math.abs(centers.y) < 0.5, `Icon is off center: ${JSON.stringify(centers)}`);
    assert.equal(await button.evaluate(element => getComputedStyle(element).height), "46px");
    assert.equal(await button.evaluate(element => getComputedStyle(element).marginLeft), "24px");
    assert.equal(await button.locator("img").evaluate(element => getComputedStyle(element).borderRadius), "100%");
    console.log("PASS: player icon centered under host button styles");
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith("scdl-verify-"));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
