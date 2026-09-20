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
        await popup.waitForFunction(() => !document.querySelector("#downloadLimit").classList.contains("is-hidden"));
        const state = await popup.evaluate(() => ({
          value: document.querySelector("#downloadLimit").value,
          options: [...document.querySelector("#downloadLimit").options].map(option => option.value),
          parsed: selectedDownloadLimit(),
        }));
        const expected = count > 50 ? "50" : "all";
        assert.equal(state.value, expected, `Default for ${count}`);
        assert(state.options.includes(state.value), `Default must be a real option for ${count}`);
        assert(state.parsed === "all" || state.parsed > 0, `Invalid limit for ${count}`);
      }
      await popup.close();
    }
    console.log("Real popup bulk limits passed for 0, 1, 25, 26, 49, 50, 51, 200 and 1000 tracks.");
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
