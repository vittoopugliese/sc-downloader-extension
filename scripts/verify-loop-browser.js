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

    const wav = createMonoWav(20);
    const audioUrl = `data:audio/wav;base64,${wav.toString("base64")}`;
    const trackUrl = "https://soundcloud.com/artist/loop-regression";
    const track = {
      id: 4242,
      title: "Loop regression",
      permalink_url: trackUrl,
      duration: 20000,
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
          .waveform { position: relative; display: block; width: 600px; height: 120px; }
          .waveform svg { display: block; width: 100%; height: 100%; }
          .native-playhead { position: absolute; top: 0; left: 25%; width: 1px; height: 100%; background: white; }
          .actions { display: flex; }
          button { width: 30px; height: 30px; }
        </style></head><body>
          <script>window.client_id="client-test-12345678901234567890";</script>
          <div class="track">
            <h1>Loop regression</h1>
            <div class="waveform-wrap">
              <div class="waveform" role="slider" aria-label="Waveform" aria-valuemax="20000">
                <svg id="fixture-waveform" viewBox="0 0 600 120" preserveAspectRatio="none"></svg>
                <div class="native-playhead" role="presentation"></div>
              </div>
            </div>
            <div class="actions"><button aria-haspopup="true" aria-label="More actions">More</button></div>
          </div>
          <audio src="${audioUrl}"></audio>
          <script>
            const fixtureWaveform = document.getElementById("fixture-waveform");
            for (let index = 0; index < 2000; index += 1) {
              const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              const amplitude = 18 + (index * 37 % 82);
              bar.setAttribute("x", String(index * 0.3));
              bar.setAttribute("y", String((120 - amplitude) / 2));
              bar.setAttribute("width", "0.22");
              bar.setAttribute("height", String(amplitude));
              bar.setAttribute("fill", "white");
              fixtureWaveform.appendChild(bar);
            }
            window.commentModeOpenCount = 0;
            const waveformElement = document.querySelector(".waveform");
            const actionsElement = document.querySelector(".actions");
            const createMoreButton = () => {
              const button = document.createElement("button");
              button.setAttribute("aria-haspopup", "true");
              button.setAttribute("aria-label", "More actions");
              button.textContent = "More";
              return button;
            };
            window.enterFixtureCommentMode = () => {
              window.commentModeOpenCount += 1;
              const closeButton = document.createElement("button");
              closeButton.className = "comment-close";
              closeButton.textContent = "×";
              closeButton.addEventListener("click", () => {
                actionsElement.replaceChildren(createMoreButton());
              });
              actionsElement.replaceChildren(closeButton);
            };
            waveformElement.addEventListener("click", (event) => {
              const rect = waveformElement.getBoundingClientRect();
              if (event.clientY > rect.top + rect.height / 2) {
                window.enterFixtureCommentMode();
              }
            });
          </script>
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
    await page.waitForFunction(() => Number.isFinite(document.querySelector("audio")?.duration));
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 5; });
    const loopButton = page.locator("[data-scdl-looper]");
    await loopButton.waitFor();
    await loopButton.click();
    const startMarker = page.locator('[data-scdl-loop-overlay] [data-marker="start"]');
    const endMarker = page.locator('[data-scdl-loop-overlay] [data-marker="end"]');
    await endMarker.waitFor();
    const waveform = page.locator('[role="slider"][aria-label="Waveform"]');
    const waveformBox = await waveform.boundingBox();
    const selection = page.locator(".scdl-loop-selection");
    const selectionBox = await selection.boundingBox();
    const selectionClickPoint = {
      x: selectionBox.x + selectionBox.width / 2,
      y: selectionBox.y + selectionBox.height * 0.8,
    };
    await page.mouse.click(selectionClickPoint.x, selectionClickPoint.y);
    assert.equal(
      await page.evaluate(() => window.commentModeOpenCount),
      0,
      "Clicks inside the A-B selection must not open SoundCloud comment mode"
    );

    const rangeBeforeCommentMode = {
      start: await startMarker.getAttribute("aria-valuenow"),
      end: await endMarker.getAttribute("aria-valuenow"),
    };
    await page.evaluate(() => window.enterFixtureCommentMode());
    await page.locator(".comment-close").click();
    await page.locator("[data-scdl-looper]").waitFor({ state: "visible" });
    await page.locator("[data-scdl-loop-download]").waitFor({ state: "visible" });
    assert.deepEqual(
      {
        start: await startMarker.getAttribute("aria-valuenow"),
        end: await endMarker.getAttribute("aria-valuenow"),
      },
      rangeBeforeCommentMode,
      "Closing comment mode must remount the looper controls without losing A-B"
    );
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
    const zoomBurst = await waveform.evaluate(async (element, point) => {
      const zoomSvg = document.querySelector(".scdl-loop-zoom-waveform");
      let renders = 0;
      let rectReads = 0;
      const originalGetBoundingClientRect = element.getBoundingClientRect;
      element.getBoundingClientRect = function () {
        rectReads += 1;
        return originalGetBoundingClientRect.call(this);
      };
      const observer = new MutationObserver((records) => {
        renders += records.filter(
          (record) => record.type === "attributes" && record.attributeName === "viewBox"
        ).length;
      });
      observer.observe(zoomSvg, { attributes: true, attributeFilter: ["viewBox"] });
      for (let index = 0; index < 20; index += 1) {
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          deltaY: index % 2 === 0 ? -10 : 10,
        }));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect();
      delete element.getBoundingClientRect;
      return { renders, rectReads };
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    assert.ok(
      zoomBurst.renders <= 2,
      `A wheel burst must render at most once per frame; observed ${zoomBurst.renders} updates`
    );
    assert.ok(
      zoomBurst.rectReads <= 1,
      `A wheel burst must read waveform layout once; observed ${zoomBurst.rectReads} reads`
    );
    assert.equal(
      await waveform.locator(".native-playhead").evaluate((element) => getComputedStyle(element).visibility),
      "hidden",
      "The native full-track playhead must be hidden while zoomed"
    );
    await waveform.evaluate((element) => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:absolute;inset:0;pointer-events:none";
      const replacement = document.createElement("div");
      replacement.className = "native-playhead";
      replacement.setAttribute("role", "presentation");
      wrapper.appendChild(replacement);
      element.querySelector(".native-playhead").replaceWith(wrapper);
    });
    await page.waitForFunction(() =>
      document.querySelector(".native-playhead")?.hasAttribute(
        "data-scdl-loop-native-playhead-hidden"
      )
    );
    assert.equal(
      await waveform.locator(".native-playhead").evaluate((element) => getComputedStyle(element).visibility),
      "hidden",
      "A nested native playhead mounted during zoom must also be hidden"
    );
    const zoomPlayhead = page.locator(".scdl-loop-zoom-playhead");
    await page.waitForFunction(() => {
      const playhead = document.querySelector(".scdl-loop-zoom-playhead");
      return playhead && !playhead.hidden;
    });
    assert.ok(
      Math.abs(await zoomPlayhead.evaluate((element) => parseFloat(element.style.left)) - 18.75) < 0.1,
      "The zoom playhead must map current time through the visible viewport"
    );
    assert.ok(
      Math.abs(await startMarker.evaluate((element) => parseFloat(element.style.left)) - 18.75) < 0.1,
      "Marker A must use the same visible viewport as the waveform"
    );
    assert.ok(
      Math.abs(await endMarker.evaluate((element) => parseFloat(element.style.left)) - 81.25) < 0.1,
      "Marker B must use the same visible viewport as the waveform"
    );
    const zoomInteraction = page.locator(".scdl-loop-zoom-interaction");
    const outsideRangeSeekMs = await zoomInteraction.evaluate((element, point) => {
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }));
      return document.querySelector("audio").currentTime * 1000;
    }, {
      x: waveformBox.x + waveformBox.width * 0.1,
      y: waveformBox.y + waveformBox.height * 0.75,
    });
    assert.ok(
      Math.abs(outsideRangeSeekMs - 3600) < 25,
      "Zoom seeking must use the whole visible viewport, including outside A-B"
    );
    const insideRangeSeekMs = await selection.evaluate((element, point) => {
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }));
      return document.querySelector("audio").currentTime * 1000;
    }, {
      x: waveformBox.x + waveformBox.width * 0.25,
      y: waveformBox.y + waveformBox.height * 0.75,
    });
    assert.ok(
      Math.abs(insideRangeSeekMs - 6000) < 25,
      "The A-B interaction layer must keep zoom-aware seeking without leaking the click"
    );
    const endMarkerBox = await endMarker.boundingBox();
    await page.mouse.move(
      endMarkerBox.x + endMarkerBox.width / 2,
      endMarkerBox.y + endMarkerBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      waveformBox.x + waveformBox.width * 0.75,
      waveformBox.y + waveformBox.height / 2
    );
    await page.mouse.up();
    assert.ok(
      Math.abs(Number(await endMarker.getAttribute("aria-valuenow")) - 14000) < 25,
      "Dragging marker B while zoomed must resolve through the visible viewport"
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
    assert.equal(
      await waveform.locator(".native-playhead").evaluate((element) => getComputedStyle(element).visibility),
      "visible",
      "The native playhead must be restored after zooming out"
    );
    assert.equal(await zoomPlayhead.getAttribute("hidden"), "", "The zoom playhead must be hidden after zooming out");
    assert.equal(await zoomInteraction.getAttribute("hidden"), "", "Zoom-aware seeking must be disabled after zooming out");

    await waveform.locator(":scope > svg").evaluate((source) => {
      const invalidSource = source.cloneNode(true);
      invalidSource.setAttribute("viewBox", "invalid");
      source.replaceWith(invalidSource);
    });
    await waveform.evaluate((element, point) => {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: -100,
      }));
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    ));
    assert.equal(
      await page.locator(".scdl-loop-zoom-layer").getAttribute("hidden"),
      "",
      "An invalid replacement SVG must not expose a stale zoom visual"
    );
    assert.equal(
      await zoomPlayhead.getAttribute("hidden"),
      "",
      "The zoom playhead must stay hidden after zoom rendering fails"
    );
    await waveform.locator(":scope > svg").evaluate((source) => {
      source.setAttribute("viewBox", "0 0 600 120");
    });
    await waveform.evaluate((element, point) => {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: -100,
      }));
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    await page.waitForFunction(() =>
      document.querySelector(".scdl-loop-zoom-layer")?.hidden === false
    );
    await waveform.evaluate((element, point) => {
      for (let index = 0; index < 10; index += 1) {
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          deltaY: 100,
        }));
      }
    }, {
      x: waveformBox.x + waveformBox.width / 2,
      y: waveformBox.y + waveformBox.height / 2,
    });
    await page.waitForFunction(() =>
      document.querySelector(".scdl-loop-zoom-layer")?.hidden === true
    );
    for (let step = 0; step < 8; step += 1) {
      await endMarker.press("Shift+ArrowLeft");
    }
    assert.equal(await endMarker.getAttribute("aria-valuenow"), "6000");

    for (let step = 0; step < 7; step += 1) {
      await endMarker.press("ArrowLeft");
    }
    assert.equal(await endMarker.getAttribute("aria-valuenow"), "5300");
    const narrowStartBefore = Number(await startMarker.getAttribute("aria-valuenow"));
    const narrowEndBefore = Number(await endMarker.getAttribute("aria-valuenow"));
    const narrowSelectionBox = await selection.boundingBox();
    await page.mouse.move(
      narrowSelectionBox.x + narrowSelectionBox.width / 2,
      narrowSelectionBox.y + 12
    );
    await page.mouse.down();
    await page.mouse.move(
      narrowSelectionBox.x + narrowSelectionBox.width / 2 + 60,
      narrowSelectionBox.y + 12
    );
    await page.mouse.up();
    const narrowStartAfter = Number(await startMarker.getAttribute("aria-valuenow"));
    const narrowEndAfter = Number(await endMarker.getAttribute("aria-valuenow"));
    assert.ok(
      Math.abs(narrowStartAfter - narrowStartBefore - 2000) < 25 &&
        Math.abs(narrowEndAfter - narrowEndBefore - 2000) < 25,
      "A narrow selection must remain draggable as a whole from its top grip"
    );
    for (let step = 0; step < 7; step += 1) {
      await endMarker.press("ArrowRight");
    }

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
