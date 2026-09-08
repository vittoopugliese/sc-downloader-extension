// Run with SCDL_PLAYWRIGHT_PATH pointing to an installed Playwright package.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

function createMonoWav(durationSeconds = 2, sampleRate = 8000) {
  const sampleCount = durationSeconds * sampleRate;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * 220);
    bytes.writeInt16LE(Math.round(sample * 12000), 44 + index * 2);
  }
  return bytes;
}

async function waitForFile(directory, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const files = await fs.readdir(directory);
    const complete = files.find((file) => !file.endsWith(".crdownload"));
    if (complete) return path.join(directory, complete);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No completed loop WAV appeared in Downloads before timeout");
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-loop-verify-"));
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
    const worker =
      context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });

    const wav = createMonoWav();
    const audioUrl = `data:audio/wav;base64,${wav.toString("base64")}`;
    const trackUrl = "https://soundcloud.com/artist/loop-regression";
    const track = {
      id: 4242,
      title: "Loop regression",
      permalink_url: trackUrl,
      duration: 2000,
      user: { username: "Artist" },
      media: {
        transcodings: [
          {
            url: "https://api-v2.soundcloud.com/media/loop-regression",
            preset: "mp3_128",
            format: { protocol: "progressive", mime_type: "audio/mpeg" },
          },
        ],
      },
    };

    await context.route("https://soundcloud.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><style>
          .track { width: 640px; }
          .waveform { display: block; width: 600px; height: 120px; }
          .waveform svg { display: block; width: 100%; height: 100%; }
          .actions { display: flex; }
          button { width: 30px; height: 30px; }
        </style></head><body>
          <script>window.client_id="client-test-12345678901234567890";</script>
          <div class="track">
            <h1>Loop regression</h1>
            <div class="waveform-wrap">
              <div class="waveform" role="slider" aria-label="Waveform" aria-valuemax="2000">
                <svg viewBox="0 0 600 120" preserveAspectRatio="none"><rect x="0" y="20" width="4" height="80" fill="white"></rect><rect x="100" y="35" width="4" height="65" fill="white"></rect><rect x="200" y="10" width="4" height="90" fill="white"></rect><rect x="300" y="45" width="4" height="55" fill="white"></rect><rect x="400" y="25" width="4" height="75" fill="white"></rect><rect x="500" y="15" width="4" height="85" fill="white"></rect></svg>
              </div>
            </div>
            <div class="actions"><button aria-haspopup="true" aria-label="More actions">More</button></div>
          </div>
          <audio src="${audioUrl}"></audio>
        </body></html>`,
      })
    );
    await context.route("https://api-v2.soundcloud.com/resolve**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(track) })
    );
    await worker.evaluate((url) => {
      const originalFetch = fetch;
      globalThis.fetch = (input, options) =>
        String(input).includes("/media/loop-regression")
          ? Promise.resolve(new Response(JSON.stringify({ url })))
          : originalFetch(input, options);
    }, audioUrl);

    await page.goto(trackUrl);
    const loopButton = page.locator("[data-scdl-looper]");
    await loopButton.waitFor();
    await loopButton.click();
    const endMarker = page.locator('[data-scdl-loop-overlay] [data-marker="end"]');
    await endMarker.waitFor();
    const waveform = page.locator('[role="slider"][aria-label="Waveform"]');
    const waveformBox = await waveform.boundingBox();
    await waveform.evaluate((element, point) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: -100,
      });
      element.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error("Waveform wheel was not consumed");
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    const zoomedViewBox = await page.locator('.scdl-loop-zoom-waveform').getAttribute('viewBox');
    assert.ok(Number(zoomedViewBox.split(/\s+/)[2]) < 600, "Wheel up must zoom the waveform");
    assert.equal(
      await waveform.locator(":scope > svg").getAttribute("data-scdl-loop-zoom-source-hidden"),
      "true",
      "The original waveform must be hidden while the zoomed copy is visible"
    );
    assert.equal(
      await waveform.locator(":scope > svg").evaluate((element) => getComputedStyle(element).visibility),
      "hidden",
      "The source waveform must not remain visible behind the zoomed waveform"
    );
    await waveform.evaluate((element, point) => {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: 100,
      }));
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    await page.waitForFunction(() => {
      return document.querySelector('.scdl-loop-zoom-layer')?.hidden === true;
    });
    assert.equal(
      await waveform.locator(":scope > svg").getAttribute("data-scdl-loop-zoom-source-hidden"),
      null,
      "The original waveform must be restored after zooming all the way out"
    );
    assert.equal(
      await waveform.locator(":scope > svg").evaluate((element) => getComputedStyle(element).visibility),
      "visible",
      "The source waveform must become visible again after zooming out"
    );
    await endMarker.press("Shift+ArrowLeft");
    assert.equal(await endMarker.getAttribute("aria-valuenow"), "1000");

    const downloadButton = page.locator("[data-scdl-loop-download]");
    await downloadButton.click();
    try {
      await page.waitForFunction(
        () =>
          /success|error/.test(
            document.querySelector("[data-scdl-loop-download]")?.dataset
              .scdlLoopDownloadState || ""
          ),
        null,
        { timeout: 30000 }
      );
    } catch (error) {
      const state = await downloadButton.evaluate((button) => ({
        state: button.dataset.scdlLoopDownloadState,
        title: button.title,
      }));
      throw new Error(`Loop download timed out: ${JSON.stringify(state)}`, {
        cause: error,
      });
    }
    assert.equal(
      await downloadButton.getAttribute("data-scdl-loop-download-state"),
      "success",
      (await downloadButton.getAttribute("title")) || "Loop download failed"
    );

    const downloadedFile = await waitForFile(downloads);
    assert.equal(path.extname(downloadedFile), ".wav");
    const output = await fs.readFile(downloadedFile);
    assert.equal(output.toString("ascii", 0, 4), "RIFF");
    assert.equal(output.toString("ascii", 8, 12), "WAVE");
    const sampleRate = output.readUInt32LE(24);
    const blockAlign = output.readUInt16LE(32);
    const dataSize = output.readUInt32LE(40);
    assert.equal(
      dataSize / blockAlign / sampleRate,
      1,
      "A-B selection must contain exactly one second"
    );
    console.log("PASS: looper A-B click -> WAV build -> Downloads file");
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith("scdl-loop-verify-"));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
