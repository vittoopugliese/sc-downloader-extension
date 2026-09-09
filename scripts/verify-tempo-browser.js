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
    await page.evaluate(() => {
      document.documentElement.setAttribute(
        "data-scdl-extension-logo-url",
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      );
      window.looperGuideRequests = 0;
      document.addEventListener("scdl:open-looper-guide", () => {
        window.looperGuideRequests += 1;
      });
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

    const compactSlider = await host.locator(".slider-wrap").evaluate((wrapper) => {
      const labels = wrapper.querySelector(".limits");
      const slider = wrapper.querySelector(".slider");
      const wrapperBounds = wrapper.getBoundingClientRect();
      const labelsBounds = labels?.getBoundingClientRect();
      const sliderBounds = slider?.getBoundingClientRect();
      return {
        labelsAreInsideSliderWrapper:
          labels?.parentElement === wrapper &&
          labelsBounds.top >= wrapperBounds.top &&
          labelsBounds.bottom <= wrapperBounds.bottom,
        wrapperMatchesSlider:
          sliderBounds.top === wrapperBounds.top &&
          sliderBounds.bottom === wrapperBounds.bottom,
        labelsIgnorePointerInput: getComputedStyle(labels).pointerEvents === "none",
      };
    });
    if (
      !compactSlider.labelsAreInsideSliderWrapper ||
      !compactSlider.wrapperMatchesSlider ||
      !compactSlider.labelsIgnorePointerInput
    ) {
      throw new Error("Playback speed limits are not compactly overlaid inside the slider.");
    }

    const branding = await host.locator(".brand").evaluate((brand) => ({
      name: brand.querySelector(".brand-name")?.textContent?.trim(),
      logoWidth: parseFloat(
        getComputedStyle(brand.querySelector(".brand-logo")).width
      ),
      logoHeight: parseFloat(
        getComputedStyle(brand.querySelector(".brand-logo")).height
      ),
      logoHidden: brand.querySelector(".brand-logo")?.hidden,
      titleFontSize: parseFloat(
        getComputedStyle(brand.querySelector(".brand-name")).fontSize
      ),
    }));
    if (
      branding.name !== "SoundCloud Track Downloader" ||
      branding.logoWidth !== 48 ||
      branding.logoHeight !== 48 ||
      branding.logoHidden ||
      branding.titleFontSize !== 17
    ) {
      throw new Error("Playback Speed panel branding is missing or incorrectly sized.");
    }

    const compactStyles = await host.locator(".panel").evaluate((panel) => {
      const preset = panel.querySelector(".preset");
      const toggle = panel.querySelector(".pitch-toggle");
      const pitchLabel = panel.querySelector(".pitch-label");
      const speedStatus = panel.querySelector(".speed-status");
      const style = getComputedStyle(panel);
      return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        presetSize: [preset.offsetWidth, preset.offsetHeight],
        toggleSize: [toggle.offsetWidth, toggle.offsetHeight],
        pitchText: pitchLabel.textContent.trim(),
        pitchFontSize: parseFloat(getComputedStyle(pitchLabel).fontSize),
        statusOrder: Array.from(speedStatus.children).map((child) => child.className),
      };
    });
    if (
      compactStyles.padding.join(" ") !== "9px 8.5px 10px 8.5px" ||
      compactStyles.presetSize.join("x") !== "44x30" ||
      compactStyles.toggleSize.join("x") !== "18x18" ||
      compactStyles.pitchText !== "Keep Tone" ||
      compactStyles.pitchFontSize !== 15 ||
      compactStyles.statusOrder.join(" ") !== "current bypass"
    ) {
      throw new Error("Playback Speed panel compact styling is incomplete.");
    }

    await host.locator(".brand-name").click();
    const looperGuideRequested = await page.evaluate(
      () => window.looperGuideRequests
    );
    if (looperGuideRequested !== 1) {
      throw new Error("Playback Speed panel did not request the Looper guide.");
    }

    await host.locator(".slider").evaluate((slider) => {
      slider.value = "0.875";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const speed = await page.locator("audio").evaluate((audio) => audio.playbackRate);
    if (speed !== 0.875) {
      throw new Error(`Expected audio at 0.875x, received ${speed}x.`);
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
    if (guardedSpeed !== 0.875) {
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

    for (const rate of [1, 2, 0.5, 1.5]) {
      const preset = host.locator(`.preset[data-rate="${rate}"]`);
      await preset.click();
      if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== rate ||
          await preset.getAttribute("aria-pressed") !== "true") {
        throw new Error(`Preset ${rate}x did not apply.`);
      }
    }
    for (const rate of [0.1, 0.125, 0.15, 0.175, 0.2, 4]) {
      await host.locator(".slider").fill(String(rate));
      if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== rate) {
        throw new Error(`Slider rate ${rate}x did not apply.`);
      }
    }
    await host.locator('.preset[data-rate="1"]').click();
    await host.locator('.preset[data-rate="0.5"]').click();
    await host.locator('.bypass').click();
    if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== 1 ||
        await host.locator('.slider').inputValue() !== '0.5' ||
        !(await host.locator('.pitch-toggle').isChecked()) ||
        await host.getAttribute('data-scdl-tempo-rate') !== '1') {
      throw new Error('Bypass must apply 1x while retaining speed and pitch settings.');
    }
    await host.locator('.bypass').click();
    if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== 0.5 ||
        await host.locator('.bypass').getAttribute('aria-pressed') !== 'false') {
      throw new Error('Disabling bypass must restore the selected speed.');
    }

    await host.locator('.slider').fill('1.3');
    let stableLayout;
    for (const [rate, label] of [[1.3, '1.300x'], [1.3125, '1.312x'], [1.325, '1.325x']]) {
      if (rate !== 1.3) await host.locator('.slider').press('ArrowRight');
      if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== rate ||
          await host.locator('.slider').inputValue() !== String(rate) ||
          await host.locator('.current').textContent() !== label ||
          await host.locator('.trigger-rate').textContent() !== label) {
        throw new Error(`Half-step playback or three-decimal display failed at ${rate}.`);
      }
      const layout = await host.evaluate((element) =>
        ['.current', '.bypass', '.trigger-rate'].map((selector) => {
          const rect = element.shadowRoot.querySelector(selector).getBoundingClientRect();
          return [rect.x, rect.width];
        })
      );
      if (stableLayout && JSON.stringify(layout) !== stableLayout) {
        throw new Error('Speed indicators shifted while stepping playback rate.');
      }
      stableLayout = JSON.stringify(layout);
    }
    await host.locator('.bypass').click();
    if (await host.locator('.current').textContent() !== '1.000x') {
      throw new Error('Bypass display must keep three decimal places.');
    }
    await host.locator('.bypass').click();

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
