const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const screenshotPath = path.join(
  projectRoot,
  "test-results",
  "tempo-control.png"
);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function main() {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <style>
        body { margin: 0; background: #111; }
        .playControls__elements {
          position: fixed; inset: auto 0 0; height: 48px; display: flex;
          align-items: center; padding: 0 24px; background: #303030;
        }
        .playControls__soundBadge { flex: 1; }
        #scdl-player-download { width: 32px; height: 32px; }
      </style>
      <div class="playControls__elements">
        <div class="playControls__soundBadge"></div>
        <button id="scdl-player-download">D</button>
        <audio></audio>
      </div>`);
  });
  const port = await listen(server);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 420 } });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.addScriptTag({
      path: path.join(__dirname, "tempo-control-core.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "tempo-control-main.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "looper-main-bridge.js"),
    });

    const host = page.locator("#scdl-tempo-control");
    await host.waitFor();
    const placedBesideDownload = await page.evaluate(() => {
      const download = document.querySelector("#scdl-player-download");
      return download?.nextElementSibling?.id === "scdl-tempo-control";
    });
    if (!placedBesideDownload) {
      throw new Error("Tempo control was not mounted beside the player download button.");
    }

    await host.locator(".trigger").click();
    const panel = host.locator(".panel");
    if (!(await panel.isVisible())) {
      throw new Error("Playback Speed panel did not open.");
    }

    await host.locator(".slider").evaluate((slider) => {
      slider.value = "0.85";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const speed = await page.locator("audio").evaluate((audio) => audio.playbackRate);
    if (speed !== 0.85) {
      throw new Error(`Expected audio at 0.85x, received ${speed}x.`);
    }

    await host.locator(".pitch-toggle").check();
    const pitch = await page
      .locator("audio")
      .evaluate((audio) => audio.preservesPitch);
    if (!pitch) {
      throw new Error("Preserve Pitch was not applied to the audio element.");
    }

    const guardedSpeed = await page.locator("audio").evaluate((audio) => {
      audio.playbackRate = 1.25;
      return audio.playbackRate;
    });
    if (guardedSpeed !== 0.85) {
      throw new Error("SoundCloud-style host write escaped the playback-rate guard.");
    }

    const bridgeStillOwnsMedia = await page.locator("audio").evaluate((audio) => {
      audio.play().catch(() => {});
      const root = document.createElement("div");
      root.setAttribute(
        "data-scdl-looper-command",
        JSON.stringify({ id: "tempo-interop", type: "state" })
      );
      document.body.append(root);
      root.dispatchEvent(new CustomEvent("scdl-looper:command", { bubbles: true }));
      return JSON.parse(root.getAttribute("data-scdl-looper-response") || "null")
        ?.state?.available;
    });
    if (!bridgeStillOwnsMedia) {
      throw new Error("Tempo control broke the existing looper media bridge.");
    }

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath });
    console.log(`Tempo browser verification passed: ${screenshotPath}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
