// Live check against youtube.com: the Player Tools trigger sits left of the like
// button and opens the same panel as on SoundCloud; the waveform fills in while
// the video plays; Stems records an A–B loop and opens it in the Stem Extractor.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

const VIDEO = process.env.SEIB_YOUTUBE_VIDEO || "jNQXAC9IVRw";
const LOOP = { startMs: 2000, endMs: 5000 };

(async () => {
  const root = path.resolve(__dirname, "..");
  const results = path.join(root, "test-results", "youtube");
  await fs.mkdir(results, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "seib-youtube-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.SCDL_CHROME_PATH ? { executablePath: process.env.SCDL_CHROME_PATH } : { channel: "chromium" }),
    viewport: { width: 1400, height: 900 },
    args: ["--disable-extensions-except=" + root, "--load-extension=" + root, "--autoplay-policy=no-user-gesture-required"],
  });
  const errors = [];
  try {
    const page = context.pages()[0] || await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`https://www.youtube.com/watch?v=${VIDEO}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("ytd-menu-renderer > #scdl-tempo-control", { timeout: 30000 });
    const placement = await page.evaluate(() => {
      const host = document.getElementById("scdl-tempo-control");
      const like = document.querySelector("ytd-watch-metadata segmented-like-dislike-button-view-model");
      return { first: host.parentElement.firstElementChild === host, platform: host.dataset.platform,
        leftOfLike: !like || host.getBoundingClientRect().right <= like.getBoundingClientRect().left + 1 };
    });
    assert.deepEqual(placement, { first: true, platform: "youtube", leftOfLike: true });

    // Ads use the same <video>; wait them out before measuring the track.
    await page.waitForFunction(() => {
      const video = document.querySelector("#movie_player video");
      return video && video.readyState >= 1 && !document.getElementById("movie_player").classList.contains("ad-showing");
    }, null, { timeout: 90000 });
    await page.evaluate(() => { const video = document.querySelector("#movie_player video"); video.muted = false; video.play(); });

    await page.locator("#scdl-tempo-control .trigger").click();
    await page.waitForSelector("#scdl-tempo-control .panel:not([hidden])", { timeout: 10000 });
    const panel = await page.evaluate(() => {
      const shadow = document.getElementById("scdl-tempo-control").shadowRoot;
      const visible = (selector) => { const node = shadow.querySelector(selector); return Boolean(node && node.getClientRects().length); };
      return { brand: shadow.querySelector(".brand-name").textContent.trim(), stems: visible(".separate-stems"),
        download: visible(".download-track-button"), wav: visible(".download-loop"), slice: visible(".slice-loop"),
        badge: shadow.querySelector(".plan-badge-icon").getAttribute("name") };
    });
    assert.deepEqual(panel, { brand: "Player Tools", stems: true, download: false, wav: false, slice: false, badge: "youtube" });

    // YouTube's speed menu drives Player Tools, and Player Tools updates the menu.
    await page.evaluate(() => document.getElementById("movie_player").setPlaybackRate(1.5));
    await page.waitForFunction(() => document.querySelector("#movie_player video").playbackRate === 1.5 &&
      document.getElementById("scdl-tempo-control").getAttribute("data-scdl-tempo-rate") === "1.5", null, { timeout: 10000 });
    await page.evaluate(() => {
      const shadow = document.getElementById("scdl-tempo-control").shadowRoot;
      const preset = [...shadow.querySelectorAll(".preset, .setter")].find((button) => /^1(\.0+)?x$/.test(button.textContent.trim()));
      preset.click();
    });
    await page.waitForFunction(() => document.getElementById("movie_player").getPlaybackRate() === 1 &&
      document.querySelector("#movie_player video").playbackRate === 1, null, { timeout: 10000 });

    // The waveform canvas gains colored bars as audio is heard.
    await page.waitForFunction(() => {
      const canvas = document.getElementById("scdl-tempo-control").shadowRoot.querySelector(".waveform-canvas");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index] + data[index + 1] + data[index + 2] > 150) lit += 1;
      return lit > 200;
    }, null, { timeout: 30000, polling: 500 });
    await page.locator("#scdl-tempo-control .panel").screenshot({ path: path.join(results, "panel-waveform.png") });

    // Same command the panel sends when A and B are dragged on the waveform.
    const loop = await page.evaluate((range) => {
      const root = document.documentElement;
      root.setAttribute("data-scdl-looper-command", JSON.stringify({ id: "test-loop", type: "set-loop", ...range, enabled: true }));
      root.dispatchEvent(new CustomEvent("scdl-looper:command", { bubbles: true }));
      return JSON.parse(root.getAttribute("data-scdl-looper-response") || "null");
    }, LOOP);
    assert.equal(loop?.ok, true, `set-loop failed: ${JSON.stringify(loop)}`);
    await page.waitForFunction(() => !document.getElementById("scdl-tempo-control").shadowRoot.querySelector(".separate-stems").disabled, null, { timeout: 5000 });

    const stemsPage = context.waitForEvent("page", { predicate: (candidate) => candidate.url().includes("stems.html"), timeout: 60000 })
      .catch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return context.pages().find((candidate) => candidate.url().includes("stems.html?recording="));
      });
    await page.locator("#scdl-tempo-control .separate-stems").click();
    await page.waitForFunction(() => /Stems/.test(document.getElementById("scdl-tempo-control").shadowRoot.querySelector(".panel").textContent), null, { timeout: 5000 });
    const stems = await stemsPage;
    assert.ok(stems, "The Stem Extractor did not open");
    await stems.waitForFunction(() => /recording=/.test(location.href), null, { timeout: 30000 });
    // The stems page decodes the take and shows it as the original track.
    await stems.waitForFunction(() => document.body.textContent.includes("Me at the zoo"), null, { timeout: 60000 });
    const recording = await stems.evaluate(async () => {
      const id = new URL(location.href).searchParams.get("recording");
      const info = await chrome.runtime.sendMessage({ type: "STEM_RECORDING_INFO", recordingId: id });
      const response = await (await caches.open("scdl-recording-jobs")).match(info.audioUrl);
      const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await response.arrayBuffer());
      let peak = 0;
      for (const value of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
      return { title: info.title, trackUrl: info.trackUrl, seconds: buffer.duration, peak };
    });
    assert.equal(recording.title, "Me at the zoo");
    assert.equal(recording.trackUrl, `https://www.youtube.com/watch?v=${VIDEO}`);
    assert.ok(Math.abs(recording.seconds - (LOOP.endMs - LOOP.startMs) / 1000) < 0.15, `Loop length ${recording.seconds}s`);
    assert.ok(recording.peak > 0.01, "The recorded loop is silent");
    await stems.screenshot({ path: path.join(results, "stems.png") });

    // Client-side navigation: one trigger, and the loop belongs to the old video.
    const next = "dQw4w9WgXcQ";
    await page.bringToFront();
    await page.evaluate((videoId) => {
      document.querySelector("ytd-app").dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true,
        detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${videoId}`, webPageType: "WEB_PAGE_TYPE_WATCH" } },
          watchEndpoint: { videoId } } } }));
    }, next);
    await page.waitForFunction((videoId) => document.querySelector("ytd-watch-flexy")?.getAttribute("video-id") === videoId, next, { timeout: 30000 });
    await page.waitForSelector("ytd-menu-renderer > #scdl-tempo-control", { timeout: 15000 });
    assert.equal(await page.locator("#scdl-tempo-control").count(), 1);
    await page.waitForFunction((videoId) => {
      const root = document.documentElement;
      root.setAttribute("data-scdl-looper-command", JSON.stringify({ id: "test-state", type: "state" }));
      root.dispatchEvent(new CustomEvent("scdl-looper:command", { bubbles: true }));
      const loop = JSON.parse(root.getAttribute("data-scdl-looper-response") || "null")?.state?.loop;
      return loop && loop.trackIdentity === `youtube:${videoId}` && !loop.active;
    }, next, { timeout: 30000, polling: 500 });
    assert.deepEqual(errors, []);
    console.log(`YouTube Player Tools live verification passed: trigger, panel, live waveform and a ${recording.seconds.toFixed(2)} s loop in Stems.`);
  } finally {
    await context.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
