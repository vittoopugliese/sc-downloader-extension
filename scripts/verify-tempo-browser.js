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
const logoDataUrl = `data:image/png;base64,${fs.readFileSync(
  path.join(projectRoot, "assets", "icon128.png")
).toString("base64")}`;

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
        .volume__sliderWrapper {
          position: fixed; right: 16px; bottom: 64px; z-index: 1;
          width: 30px; height: 150px; border: 1px solid #777; background: #292929;
        }
        .volume__sliderProgress { position: absolute; right: 13px; bottom: 10px; width: 4px; background: #f50; }
        .volume__sliderHandle { position: absolute; right: 7px; width: 16px; height: 16px; border-radius: 50%; background: #f50; }
      </style>
      <div class="playControls__elements">
        <div class="playControls__soundBadge"><a class="playbackSoundBadge__titleLink" href="/artist/track">Track</a></div>
        <div class="volume__sliderWrapper" role="slider" aria-valuemin="0" aria-valuemax="1" aria-label="Volume" aria-valuenow="0.5">
          <div class="volume__sliderBackground"></div>
          <div class="volume__sliderProgress" style="height: 60px;"></div>
          <div class="volume__sliderHandle" style="top: 70px;"></div>
        </div>
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
    await page.evaluate((logoUrl) => {
      document.documentElement.setAttribute(
        "data-scdl-extension-logo-url",
        logoUrl
      );
      document.documentElement.setAttribute("data-scdl-player-waveform", JSON.stringify({
        trackUrl: "http://127.0.0.1/artist/track",
        samples: Array.from({ length: 240 }, (_, index) => 20 + Math.abs(Math.sin(index * .47) * 80)),
      }));
      window.looperGuideRequests = 0;
      document.addEventListener("scdl:open-looper-guide", () => {
        window.looperGuideRequests += 1;
      });
      Object.defineProperty(document.querySelector("audio"), "duration", {
        configurable: true,
        value: 120,
      });
    }, logoDataUrl);
    await page.addScriptTag({
      path: path.join(__dirname, "tempo-control-main.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "looper-core.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "loop-session.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "looper-main-bridge.js"),
    });

    const host = page.locator("#scdl-tempo-control");
    await host.waitFor();
    await page.waitForFunction(() =>
      document.querySelector("#scdl-tempo-control")?.shadowRoot
        ?.querySelector(".brand-logo")?.naturalWidth === 128
    );
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
    const volumeLayering = await page.evaluate(() => {
      const volume = document.querySelector(".volume__sliderWrapper");
      const rect = volume?.getBoundingClientRect();
      const topElement = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const panelRect = document.querySelector("#scdl-tempo-control")?.shadowRoot?.querySelector(".panel")?.getBoundingClientRect();
      return {
        isAbove: topElement?.closest(".volume__sliderWrapper") === volume,
        panel: panelRect && [panelRect.left, panelRect.top, panelRect.right, panelRect.bottom],
        volume: rect && [rect.left, rect.top, rect.right, rect.bottom],
        volumeZIndex: volume && getComputedStyle(volume).zIndex,
      };
    });
    if (!volumeLayering.isAbove) {
      throw new Error("The native volume slider is hidden behind the tempo panel.");
    }
    await page.waitForTimeout(300);

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
        sliderIsInset:
          sliderBounds.top > wrapperBounds.top &&
          sliderBounds.bottom < wrapperBounds.bottom,
        roundedContainer: parseFloat(getComputedStyle(wrapper).borderRadius) > 0,
        labelsIgnorePointerInput: getComputedStyle(labels).pointerEvents === "none",
      };
    });
    if (
      !compactSlider.labelsAreInsideSliderWrapper ||
      !compactSlider.sliderIsInset ||
      !compactSlider.roundedContainer ||
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
      branding.logoWidth !== 54 ||
      branding.logoHeight !== 54 ||
      branding.logoHidden ||
      branding.titleFontSize !== 20
    ) {
      throw new Error("Playback Speed panel branding is missing or incorrectly sized.");
    }

    const compactStyles = await host.locator(".panel").evaluate((panel) => {
      const preset = panel.querySelector(".preset");
      const toggle = panel.querySelector(".pitch-toggle");
      const pitchLabel = panel.querySelector(".pitch-label");
      const speedStatus = panel.querySelector(".speed-status");
      const waveformShell = panel.querySelector(".waveform-shell");
      const tempoRow = panel.querySelector(".tempo-row");
      const style = getComputedStyle(panel);
      return {
        panelSize: [panel.offsetWidth, panel.offsetHeight],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        presetSize: [preset.offsetWidth, preset.offsetHeight],
        toggleSize: [toggle.offsetWidth, toggle.offsetHeight],
        pitchText: pitchLabel.textContent.trim(),
        pitchTooltip: toggle.title,
        pitchContainerWidth: pitchLabel.offsetWidth,
        waveformHeight: waveformShell.offsetHeight,
        tempoOrder: Array.from(tempoRow.children).map((child) => child.className),
        statusOrder: Array.from(speedStatus.children).map((child) => child.className),
      };
    });
    if (
      compactStyles.panelSize[0] !== 480 ||
      compactStyles.padding.join(" ") !== "7px 7px 7px 7px" ||
      compactStyles.presetSize.join("x") !== "42x27" ||
      compactStyles.toggleSize.join("x") !== "16x16" ||
      compactStyles.pitchText !== "" ||
      compactStyles.pitchTooltip !== "Keep tone" ||
      compactStyles.pitchContainerWidth !== 22 ||
      compactStyles.waveformHeight !== 130 ||
      compactStyles.tempoOrder.join(" ") !== "slider-wrap pitch-label" ||
      compactStyles.statusOrder.join(" ") !== "current bypass"
    ) {
      throw new Error(`Playback Speed panel compact styling is incomplete: ${JSON.stringify(compactStyles)}`);
    }

    await host.locator(".brand-name").click();
    const looperGuideRequested = await page.evaluate(
      () => window.looperGuideRequests
    );
    if (looperGuideRequested !== 1) {
      throw new Error("Playback Speed panel did not request the Looper guide.");
    }

    const panelFeatures = await host.evaluate((element) => {
      const root = element.shadowRoot;
      return {
        customCount: root.querySelectorAll(".custom-preset").length,
        reviewHref: root.querySelector(".rating-link")?.href,
        labels: [...root.querySelectorAll(".range-label")].map((node) => node.textContent),
        order: [...root.querySelector(".panel").children].map((node) => node.className),
      };
    });
    if (
      panelFeatures.customCount !== 2 ||
      !panelFeatures.reviewHref.endsWith("/reviews") ||
      panelFeatures.labels.join("|") !== "Tone & Velocity" ||
      panelFeatures.order.slice(0, 3).join("|") !==
        "panel-header|tempo-row|waveform-shell"
    ) {
      throw new Error("The combined panel layout or links are incomplete.");
    }

    await host.locator(".slider").fill("0.7125");
    const custom = host.locator('.custom-preset[data-custom-index="0"]');
    await custom.dispatchEvent("pointerdown");
    await page.waitForTimeout(700);
    await custom.dispatchEvent("pointerup");
    await host.locator('.preset[data-rate="2"]').click();
    await custom.click();
    if (
      await page.locator("audio").evaluate((audio) => audio.playbackRate) !== 0.7125 ||
      await page.evaluate(() => localStorage.getItem("scdl.tempo.customRate.1")) !== "0.7125"
    ) {
      throw new Error("A custom speed was not saved by long press and restored by click.");
    }

    await page.locator("audio").evaluate((audio) => { audio.currentTime = 12.345; });
    await host.locator(".set-a").click();
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 20.678; });
    await host.locator(".set-b").click();
    const capturedLoop = await page.evaluate(() =>
      JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))
    );
    if (
      capturedLoop.startMs !== 12345 ||
      capturedLoop.endMs !== 20678 ||
      !capturedLoop.enabled ||
      (await host.locator(".set-a").textContent()).trim() !== "00:12.345"
    ) {
      throw new Error(`Set A/Set B did not capture and display the live player range: ${JSON.stringify({ capturedLoop, label: await host.locator(".set-a").textContent() })}`);
    }

    const waveformUi = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const canvas = root.querySelector(".waveform-canvas");
      const custom = root.querySelector('.custom-preset[data-custom-index="0"]');
      return {
        canvas: [canvas.width, canvas.height],
        markers: root.querySelectorAll(".waveform-marker:not([hidden])").length,
        customFits: custom.scrollWidth <= custom.clientWidth,
        setALabel: root.querySelector(".set-a").textContent.trim(),
      };
    });
    if (waveformUi.canvas[0] <= 1 || waveformUi.canvas[1] <= 1 || waveformUi.markers !== 2 || !waveformUi.customFits || waveformUi.setALabel.includes("Set A")) {
      throw new Error(`Interactive waveform layout is incomplete: ${JSON.stringify(waveformUi)}`);
    }

    const endMarker = host.locator(".waveform-end");
    const markerBox = await endMarker.boundingBox();
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(markerBox.x - 32, markerBox.y + markerBox.height / 2, { steps: 4 });
    await page.mouse.up();
    const draggedEnd = await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session")).endMs);
    if (!(draggedEnd < 20678)) throw new Error(`Dragging marker B did not update the shared loop session: ${draggedEnd}`);

    const waveformStage = host.locator(".waveform-stage");
    await waveformStage.hover();
    const fullEndLabel = await host.locator(".waveform-end-label").textContent();
    await page.mouse.wheel(0, -180);
    const zoomedEndLabel = await host.locator(".waveform-end-label").textContent();
    if (zoomedEndLabel === fullEndLabel) throw new Error("The player waveform did not zoom around the pointer.");

    await host.locator(".waveform-toggle").click();
    await page.evaluate(() => {
      window.waveformFetches = 0;
      window.originalFetch = window.fetch;
      window.fetch = async (resource, options) => {
        if (String(resource).includes("lazy-waveform")) {
          window.waveformFetches += 1;
          return { json: async () => ({ samples: [15, 40, 75, 30, 60] }) };
        }
        return window.originalFetch(resource, options);
      };
      document.documentElement.setAttribute("data-scdl-player-waveform", JSON.stringify({
        trackUrl: "http://127.0.0.1/artist/next-track",
        waveformUrl: "https://example.test/lazy-waveform.json",
      }));
      document.dispatchEvent(new CustomEvent("scdl:player-waveform-ready"));
    });
    await page.waitForTimeout(220);
    const collapsedLooper = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const shell = root.querySelector(".waveform-shell");
      const canvas = root.querySelector(".waveform-canvas");
      return {
        collapsed: shell.classList.contains("is-collapsed"),
        height: shell.offsetHeight,
        stageDisplay: getComputedStyle(root.querySelector(".waveform-stage")).display,
        settersVisible: [...root.querySelectorAll(".waveform-setters .setter")].every(
          (button) => button.offsetWidth > 0 && button.offsetHeight > 0
        ),
        canvas: [canvas.width, canvas.height],
        stored: localStorage.getItem("scdl.tempo.waveformCollapsed"),
        fetches: window.waveformFetches,
      };
    });
    if (
      !collapsedLooper.collapsed ||
      collapsedLooper.height !== 32 ||
      collapsedLooper.stageDisplay !== "none" ||
      !collapsedLooper.settersVisible ||
      collapsedLooper.canvas.join("x") !== "1x1" ||
      collapsedLooper.stored !== "true" ||
      collapsedLooper.fetches !== 0
    ) {
      throw new Error(`Collapsed looper still renders or loads its waveform: ${JSON.stringify(collapsedLooper)}`);
    }

    await host.locator(".waveform-toggle").click();
    await page.waitForFunction(() => window.waveformFetches === 1);
    await page.waitForTimeout(220);
    const expandedLooper = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const canvas = root.querySelector(".waveform-canvas");
      return {
        collapsed: root.querySelector(".waveform-shell").classList.contains("is-collapsed"),
        canvas: [canvas.width, canvas.height],
        stored: localStorage.getItem("scdl.tempo.waveformCollapsed"),
      };
    });
    if (expandedLooper.collapsed || expandedLooper.canvas.some((size) => size <= 1) || expandedLooper.stored !== "false") {
      throw new Error(`Expanded looper did not lazily render its waveform: ${JSON.stringify(expandedLooper)}`);
    }

    await host.locator(".set-a").dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
    await page.waitForTimeout(700);
    await host.locator(".set-a").dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
    await host.locator(".set-a").click();
    if (await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session")).active)) {
      throw new Error("Holding Set A did not clear the loop selection.");
    }
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 12.345; });
    await host.locator(".set-a").click();
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 20.678; });
    await host.locator(".set-b").click();

    await host.locator(".slider").evaluate((slider) => {
      slider.value = "0.875";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const speed = await page.locator("audio").evaluate((audio) => audio.playbackRate);
    if (speed !== 0.875) {
      throw new Error(`Expected audio at 0.875x, received ${speed}x.`);
    }

    await host.locator(".pitch-toggle").evaluate((toggle) => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
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
    for (const rate of [0.1, 0.125, 0.15, 0.175, 0.2, 3]) {
      await host.locator(".slider").fill(String(rate));
      if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== rate) {
        throw new Error(`Slider rate ${rate}x did not apply.`);
      }
    }
    await host.locator('.preset[data-rate="1"]').click();
    if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== 1) {
      throw new Error('A preset must apply to audio immediately while its label animates.');
    }
    await page.waitForTimeout(80);
    const midAnimation = await host.evaluate((element) => {
      const root = element.shadowRoot;
      return {
        current: root.querySelector('.current').textContent,
        trigger: root.querySelector('.trigger-rate').textContent,
      };
    });
    if (
      midAnimation.current === '1.000x' ||
      midAnimation.trigger === '1.0x'
    ) {
      throw new Error('Speed indicators did not animate during a preset change.');
    }
    await page.waitForTimeout(180);
    if (
      await host.locator('.current').textContent() !== '1.000x' ||
      await host.locator('.trigger-rate').textContent() !== '1.0x'
    ) {
      throw new Error('Preset animation did not settle on the selected speed.');
    }
    await host.locator('.preset[data-rate="0.5"]').click();
    await host.locator('.bypass').click();
    await page.waitForTimeout(240);
    const bypassVisualAndLoop = await host.evaluate((element) => ({
      logoFilter: getComputedStyle(element.shadowRoot.querySelector('.brand-logo')).filter,
      loop: JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session')),
    }));
    if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== 1 ||
        await host.locator('.slider').inputValue() !== '0.5' ||
        !(await host.locator('.pitch-toggle').isChecked()) ||
        await host.getAttribute('data-scdl-tempo-rate') !== '1' ||
        bypassVisualAndLoop.loop.effectiveEnabled ||
        bypassVisualAndLoop.logoFilter === 'none') {
      throw new Error('Bypass must disable loop/effects, retain settings, and gray the logo.');
    }
    await host.locator('.bypass').click();
    if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== 0.5 ||
        await host.locator('.bypass').getAttribute('aria-pressed') !== 'false' ||
        !(await page.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session')).effectiveEnabled))) {
      throw new Error('Disabling bypass must restore the selected speed and loop.');
    }

    await host.locator('.slider').fill('1.3');
    let stableLayout;
    for (const [rate, label] of [[1.3, '1.300x'], [1.3125, '1.312x'], [1.325, '1.325x']]) {
      if (rate !== 1.3) await host.locator('.slider').press('ArrowRight');
      if (await page.locator('audio').evaluate((audio) => audio.playbackRate) !== rate ||
          await host.locator('.slider').inputValue() !== String(rate) ||
          await host.locator('.current').textContent() !== label ||
          await host.locator('.trigger-rate').textContent() !== '1.3x') {
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
    await page.waitForTimeout(240);
    if (await host.locator('.current').textContent() !== '1.000x') {
      throw new Error('Bypass display must keep three decimal places.');
    }
    await host.locator('.bypass').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await host.locator('.slider').fill('3');
    if (
      await host.locator('.current').textContent() !== '3.000x' ||
      await host.locator('.trigger-rate').textContent() !== '3.0x'
    ) {
      throw new Error('Reduced motion must show the selected speed immediately.');
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
