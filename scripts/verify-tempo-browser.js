const assert = require("node:assert/strict");
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
  path.join(projectRoot, "assets", "LooperPlayerToolkit.png")
).toString("base64")}`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function main() {
  const server = http.createServer((request, response) => {
    const sampleName = /^\/assets\/drums\/(kick1|kick2|clap1|hat1|snare1|tom1)\.wav$/.exec(request.url || "");
    if (sampleName) {
      response.setHeader("Content-Type", "audio/wav");
      fs.createReadStream(path.join(projectRoot, "assets", "drums", `${sampleName[1]}.wav`)).pipe(response);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <style>
        body { margin: 0; background: #111; }
        .playControls__elements {
          position: fixed; inset: auto 0 0; height: 48px; display: flex;
          align-items: center; padding: 0 24px; background: #303030;
        }
        .playControls__soundBadge { flex: 1; }
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
      </div>
      <audio id="soundcloud-audio"></audio>`);
  });
  const port = await listen(server);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 420 } });
    page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
    await page.addInitScript({ path: path.join(__dirname, "fast-tooltips.js") });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.addScriptTag({
      path: path.join(__dirname, "tempo-control-core.js"),
    });
    for (const file of ["parametric-eq.js", "audio-effects-core.js", "parametric-eq-ui.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    await page.addScriptTag({ path: path.join(__dirname, "player-tools-policy.js") });
    await page.evaluate((logoUrl) => {
      const playerToolsSnapshot = {
        revision: 1,
        plan: "pro",
        state: "pro",
        grant: null,
        capabilities: {
          openPanel: true, beginLoop: true, editLoop: true, tempo: true, parametricEq: true,
          preservePitch: true, savePreset: true, maximizeLooper: true,
          editLoopPrecise: true, exportLoop: true, exportTrackEffects: true,
        },
      };
      document.documentElement.setAttribute(
        "data-scdl-player-tools-access",
        JSON.stringify(playerToolsSnapshot)
      );
      document.addEventListener("scdl:player-tools-request", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-player-tools-request") || "null");
        if (!request?.id) return;
        const respond = () => {
          const code = ["begin-loop", "edit-loop"].includes(request.operation)
            ? window.SCPlayerToolsPolicy.validateLoopRequest(request) : null;
          document.documentElement.setAttribute("data-scdl-player-tools-response", JSON.stringify({
            id: request.id, success: true, allowed: !window.denyAccess && !code, code, snapshot: playerToolsSnapshot,
          }));
          document.dispatchEvent(new CustomEvent("scdl:player-tools-response"));
        };
        if (window.accessResponseDelay) setTimeout(respond, window.accessResponseDelay);
        else respond();
      });
      document.documentElement.setAttribute(
        "data-scdl-extension-logo-url",
        logoUrl
      );
      document.documentElement.setAttribute(
        "data-scdl-extension-drum-samples-url",
        `${location.origin}/assets/drums/`
      );
      document.documentElement.setAttribute("data-scdl-player-waveform", JSON.stringify({
        trackUrl: "http://127.0.0.1/artist/track",
        samples: Array.from({ length: 240 }, (_, index) => 20 + Math.abs(Math.sin(index * .47) * 80)),
      }));
      window.looperGuideRequests = 0;
      window.trackDownloadRequests = [];
      window.loopDownloadRequests = [];
      window.padRenderRequests = [];
      window.savedPadSamples = {};
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (event.source !== window || data?.source !== "scdl-pad-main") return;
        let result = { success: true };
        if (data.action === "list") {
          result.pads = Object.entries(window.savedPadSamples).map(([index, pad]) => ({ index: Number(index), name: pad.name }));
        } else if (data.action === "render") {
          window.padRenderRequests.push(data);
          window.savedPadSamples[data.index] = { name: data.name, dataUrl: `${location.origin}/assets/drums/tom1.wav` };
          result.pad = { name: data.name };
        } else if (data.action === "store") {
          window.savedPadSamples[data.index] = { name: data.name, dataUrl: `${location.origin}/assets/drums/hat1.wav` };
          result.pad = { name: data.name };
        } else if (data.action === "get") {
          result.pad = window.savedPadSamples[data.index] || null;
        }
        window.postMessage({ source: "scdl-pad-content", id: data.id, result }, location.origin);
      });
      document.addEventListener("scdl:open-looper-guide", () => {
        window.looperGuideRequests += 1;
      });
      document.addEventListener("scdl:download-current-track", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-track-export-request"));
        window.trackDownloadRequests.push(request);
        document.dispatchEvent(new CustomEvent("scdl:download-current-track-result", {
          detail: { id: request.id, success: true },
        }));
      });
      document.addEventListener("scdl:download-loop", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-loop-export-request"));
        window.loopDownloadRequests.push(request);
        document.dispatchEvent(new CustomEvent("scdl:download-loop-result", {
          detail: { id: request.id, success: true },
        }));
      });
      Object.defineProperty(document.querySelector("audio"), "duration", {
        configurable: true,
        value: 120,
      });
      Object.defineProperties(document.querySelector("audio"), {
        currentSrc: { configurable: true, value: `${location.origin}/stream.mp3` },
        readyState: { configurable: true, value: 4 },
        paused: { configurable: true, value: false },
      });
    }, logoDataUrl);
    await page.addScriptTag({
      path: path.join(__dirname, "tempo-control-main.js"),
    });
    await page.addScriptTag({
      path: path.join(__dirname, "looper-core.js"),
    });
    const effectSample = await page.evaluate(async () => {
      const context = new AudioContext();
      const input = context.createBuffer(1, 2205, 44100);
      input.getChannelData(0)[0] = 1;
      const output = await SCTempoEffects.renderSample(input, {
        reverb: 40, delay: 35, reverbRoom: "room", reverbSize: 30,
        reverbDecay: 0.2, reverbPreDelay: 8, reverbTone: 70,
        delayTime: 60, delayFeedback: 20, delayTone: 70,
      });
      const channel = output.getChannelData(0);
      const tail = channel.slice(2205).reduce((sum, value) => sum + Math.abs(value), 0);
      await context.close();
      return { duration: output.duration, tail };
    });
    assert.ok(effectSample.duration > 0.2 && effectSample.tail > 0.01,
      "Rendered pad audio must include audible reverb and delay after the selected loop.");
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
        ?.querySelector(".brand-logo")?.naturalWidth === 1254
    );
    const replacedPlayerDownload = await page.evaluate(() => {
      const soundBadge = document.querySelector(".playControls__soundBadge");
      return !document.querySelector("#scdl-player-download") &&
        soundBadge?.nextElementSibling?.id === "scdl-tempo-control";
    });
    if (!replacedPlayerDownload) {
      throw new Error("Tempo control did not replace the standalone player download button.");
    }

    const panel = host.locator(".panel");
    const panelIsOpen = () => host.evaluate((element) =>
      !element.shadowRoot.querySelector(".panel").hidden
    );
    if (await host.locator(".clear-rate").isVisible()) {
      throw new Error("Reset control must stay hidden when playback, effects, and loop are neutral.");
    }

    // Hover opens after the intended dwell time, stays open while the pointer
    // is inside the panel, and closes when the pointer leaves it.
    await host.locator(".trigger").hover();
    await page.waitForTimeout(130);
    assert.deepEqual(await page.locator("#scdl-fast-tooltip").evaluate((tip) => ({
      text: tip.textContent, visible: tip.style.visibility,
    })), { text: "Playback speed 1.0x", visible: "visible" },
    "The Player Tools trigger must show a custom tooltip from its aria-label");
    await page.waitForTimeout(80);
    if (await panelIsOpen()) {
      throw new Error("Playback Speed panel opened before 254ms of hover.");
    }
    await page.waitForTimeout(55);
    if (!(await panelIsOpen())) {
      throw new Error("Playback Speed panel did not open after 254ms of hover.");
    }
    await panel.hover();
    await page.waitForTimeout(80);
    if (!(await panelIsOpen())) {
      throw new Error("Hover-opened Playback Speed panel closed while the pointer was inside it.");
    }
    await page.mouse.move(10, 10);
    await page.waitForFunction(
      () => document.querySelector("#scdl-tempo-control")?.shadowRoot?.querySelector(".panel")?.hidden === true
    );

    // A click changes the mode to persistent until an outside click closes it.
    await host.locator(".trigger").click();
    if (!(await panel.isVisible())) {
      throw new Error("Playback Speed panel did not open.");
    }
    const drumPads = host.locator(".drum-pad");
    assert.equal(await drumPads.count(), 6, "The panel must show six drum pads.");
    assert.deepEqual(await drumPads.allTextContents(), ["A", "S", "D", "F", "G", "H"]);
    assert.deepEqual(await drumPads.evaluateAll((pads) => pads.map((pad) => pad.title)),
      ["Kick", "Clap", "Hat", "Kick 2", "Snare", "Tom"].map((name) => `${name} · hold to load`));
    const drumPlacement = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const header = root.querySelector(".panel-header").getBoundingClientRect();
      const drums = root.querySelector(".drum-section").getBoundingClientRect();
      const tempo = root.querySelector(".tempo-row").getBoundingClientRect();
      return header.bottom <= drums.top && drums.bottom <= tempo.top &&
        root.querySelector(".drum-pads").scrollWidth <= root.querySelector(".drum-pads").clientWidth;
    });
    assert.equal(drumPlacement, true, "The drum row must fit between the header and tempo controls.");
    await page.evaluate(() => {
      window.drumStarts = 0;
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.drumStarts += 1;
        return originalStart.apply(this, args);
      };
    });
    await drumPads.nth(0).click();
    await page.waitForFunction(() => window.drumStarts === 1);
    await drumPads.nth(1).hover();
    await page.keyboard.press("j");
    assert.equal(await drumPads.nth(1).locator(".drum-key").textContent(), "J",
      "Hovering and pressing a key must assign it to that pad.");
    await host.locator(".brand-name").hover();
    await page.keyboard.press("j");
    await page.waitForFunction(() => window.drumStarts === 2);
    const sampleChooser = page.waitForEvent("filechooser");
    const uploadPad = await drumPads.nth(3).boundingBox();
    await page.mouse.move(uploadPad.x + uploadPad.width / 2, uploadPad.y + uploadPad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await (await sampleChooser).setFiles(path.join(projectRoot, "assets", "drums", "hat1.wav"));
    await host.locator('.drum-pad[title="hat1 · hold to load"]').waitFor();
    assert.equal(await page.evaluate(() => window.drumStarts), 2,
      "Holding a pad to upload must not also play it.");
    await drumPads.nth(3).click();
    await page.waitForFunction(() => window.drumStarts === 3);
    await host.locator(".download-track-button").hover();
    await page.waitForTimeout(130);
    assert.deepEqual(await page.locator("#scdl-fast-tooltip").evaluate((tip) => ({
      text: tip.textContent, visible: tip.style.visibility,
    })), { text: "Download current playing", visible: "visible" },
    "A Player Tools button in the shadow panel must show its custom tooltip");
    await host.locator(".clear-loop").hover();
    await page.waitForTimeout(130);
    assert.deepEqual(await page.locator("#scdl-fast-tooltip").evaluate((tip) => ({
      text: tip.textContent, visible: tip.style.visibility,
    })), { text: "Clear loop", visible: "visible" },
    "A Player Tools button without title must use its accessible label");
    await page.mouse.move(10, 10);
    if (!(await panelIsOpen())) {
      throw new Error("Click-opened Playback Speed panel did not stay open after pointer leave.");
    }
    await page.mouse.click(10, 10);
    if (await panelIsOpen()) {
      throw new Error("Click-opened Playback Speed panel did not close after an outside click.");
    }

    // Detach keeps a hover-opened panel open until it is turned off again.
    await host.locator(".trigger").hover();
    await page.waitForTimeout(275);
    await host.locator(".detach-button").click();
    await page.mouse.click(10, 10);
    if (!(await panelIsOpen())) {
      throw new Error("Detached hover-opened Playback Speed panel closed after an outside click.");
    }
    await host.locator(".detach-button").click();
    await page.mouse.move(10, 10);
    await page.waitForTimeout(100);
    if (!(await panelIsOpen())) {
      throw new Error("Hover-opened panel closed before an outside click after detach was disabled.");
    }
    await page.mouse.click(10, 10);
    if (await panelIsOpen()) {
      throw new Error("Hover-opened panel stayed open after detach was disabled and clicked outside.");
    }

    // Detach also overrides a click-opened panel.
    await host.locator(".trigger").click();
    await host.locator(".detach-button").click();
    await page.mouse.click(10, 10);
    if (!(await panelIsOpen())) {
      throw new Error("Detached Playback Speed panel closed after an outside click.");
    }
    await host.locator(".detach-button").click();
    await page.mouse.move(10, 10);
    await page.waitForTimeout(100);
    if (!(await panelIsOpen())) {
      throw new Error("Click-opened panel closed before an outside click after detach was disabled.");
    }
    await page.mouse.click(10, 10);
    if (await panelIsOpen()) {
      throw new Error("Playback Speed panel stayed open after detach was disabled and clicked outside.");
    }

    await host.locator(".trigger").click();
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

    const branding = await host.locator(".brand").evaluate((brand) => {
      const badge = brand.querySelector(".free-badge");
      const badgeStyle = getComputedStyle(badge);
      return {
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
        badge: {
          text: badge?.textContent?.trim(),
          isPro: badge?.classList.contains("is-pro"),
          ariaLabel: badge?.getAttribute("aria-label"),
          left: badgeStyle.left,
          bottom: badgeStyle.bottom,
          height: badgeStyle.height,
          fontSize: badgeStyle.fontSize,
        },
      };
    });
    if (
      branding.name !== "SCTD Player Tools" ||
      branding.logoWidth !== 32 ||
      branding.logoHeight !== 32 ||
      branding.logoHidden ||
      branding.titleFontSize !== 16 ||
      branding.badge.height !== "17px" ||
      branding.badge.fontSize !== "9px" ||
      branding.badge.text !== "PRO" ||
      !branding.badge.isPro ||
      branding.badge.ariaLabel !== "Player Tools Pro active"
    ) {
      throw new Error("Playback Speed panel branding does not reflect the active Pro plan.");
    }

    const compactStyles = await host.locator(".panel").evaluate((panel) => {
      const preset = panel.querySelector(".preset");
      const toggle = panel.querySelector(".pitch-toggle");
      const pitchLabel = panel.querySelector(".pitch-label");
      const speedStatus = panel.querySelector(".speed-status");
      const downloadTrackButton = panel.querySelector(".download-track-button");
      const downloadTrackIcon = downloadTrackButton.querySelector("svg");
      const settingsButton = panel.querySelector(".settings-button");
      const settingsIcon = settingsButton.querySelector("svg");
      const detachButton = panel.querySelector(".detach-button");
      const detachIcon = detachButton.querySelector("svg");
      const brandLogo = panel.querySelector(".brand-logo");
      const brandCopy = panel.querySelector(".brand-copy");
      const tools = panel.querySelector(".panel-tools");
      const presets = panel.querySelector(".presets");
      const header = panel.querySelector(".panel-header");
      const waveformShell = panel.querySelector(".waveform-shell");
      const waveformTitleIcon = panel.querySelector(".waveform-title svg");
      const tempoRow = panel.querySelector(".tempo-row");
      const triggerIcon = panel.getRootNode().querySelector(".trigger-icon");
      const triggerRate = panel.getRootNode().querySelector(".trigger-rate");
      const clearRate = panel.getRootNode().querySelector(".clear-rate");
      const style = getComputedStyle(panel);
      return {
        panelSize: [panel.offsetWidth, panel.offsetHeight],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        presetSize: [preset.offsetWidth, preset.offsetHeight],
        toggleSize: [toggle.offsetWidth, toggle.offsetHeight],
        pitchText: pitchLabel.textContent.trim(),
        pitchTooltip: toggle.title,
        pitchContainerWidth: pitchLabel.offsetWidth,
        downloadTrackButtonSize: [downloadTrackButton.offsetWidth, downloadTrackButton.offsetHeight],
        downloadTrackIconSize: [downloadTrackIcon.clientWidth, downloadTrackIcon.clientHeight],
        downloadTrackTooltip: downloadTrackButton.title,
        toolOrder: [...tools.children].map((element) => element.className),
        settingsButtonSize: [settingsButton.offsetWidth, settingsButton.offsetHeight],
        settingsButtonRadius: getComputedStyle(settingsButton).borderRadius,
        settingsIconSize: [settingsIcon.clientWidth, settingsIcon.clientHeight],
        detachButtonSize: [detachButton.offsetWidth, detachButton.offsetHeight],
        detachButtonRadius: getComputedStyle(detachButton).borderRadius,
        detachIconSize: [detachIcon.clientWidth, detachIcon.clientHeight],
        headerHeight: header.offsetHeight,
        headerOverflows: header.scrollWidth > header.clientWidth,
        headerRects: [brandLogo, brandCopy, presets, tools, speedStatus].map((element) => {
          const rect = element.getBoundingClientRect();
          return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)];
        }),
        waveformHeight: waveformShell.offsetHeight,
        waveformTitleIconSize: [waveformTitleIcon?.clientWidth, waveformTitleIcon?.clientHeight],
        triggerIconSize: [parseFloat(getComputedStyle(triggerIcon).width), parseFloat(getComputedStyle(triggerIcon).height)],
        triggerIconPosition: getComputedStyle(triggerIcon).position,
        triggerRateFontSize: getComputedStyle(triggerRate).fontSize,
        triggerRatePosition: getComputedStyle(triggerRate).position,
        clearRateColor: getComputedStyle(clearRate).color,
        tempoOrder: Array.from(tempoRow.children).map((child) => child.className),
        statusOrder: Array.from(speedStatus.children).map((child) => child.className),
      };
    });
    if (
      compactStyles.panelSize[0] !== 420 ||
      compactStyles.padding.join(" ") !== "7px 7px 7px 7px" ||
      compactStyles.presetSize.join("x") !== "32x12" ||
      compactStyles.toggleSize.join("x") !== "16x16" ||
      compactStyles.pitchText !== "" ||
      compactStyles.pitchTooltip !== "Keep tone" ||
      compactStyles.pitchContainerWidth !== 22 ||
      compactStyles.downloadTrackButtonSize.join("x") !== "23x20" ||
      compactStyles.downloadTrackIconSize.join("x") !== "12x12" ||
      compactStyles.downloadTrackTooltip !== "Download current playing" ||
      compactStyles.toolOrder.join("|") !== "panel-tool download-track-button|panel-tool settings-button|panel-tool detach-button|panel-tool close-button" ||
      compactStyles.settingsButtonSize.join("x") !== "23x20" ||
      compactStyles.settingsButtonRadius !== "4px" ||
      compactStyles.settingsIconSize.join("x") !== "12x12" ||
      compactStyles.detachButtonSize.join("x") !== "23x20" ||
      compactStyles.detachButtonRadius !== "4px" ||
      compactStyles.detachIconSize.join("x") !== "12x12" ||
      compactStyles.headerHeight > 38 ||
      compactStyles.headerOverflows ||
      !(compactStyles.headerRects[0][0] < compactStyles.headerRects[1][0] &&
        compactStyles.headerRects[1][2] <= compactStyles.headerRects[3][0] &&
        compactStyles.headerRects[2][1] > compactStyles.headerRects[0][3] &&
        compactStyles.headerRects[4][1] > compactStyles.headerRects[0][3] &&
        compactStyles.headerRects[0][3] >= compactStyles.headerRects[3][3]) ||
      compactStyles.waveformHeight !== 130 ||
      compactStyles.waveformTitleIconSize.join("x") !== "16x16" ||
      compactStyles.triggerIconSize.join("x") !== "20x20" ||
      compactStyles.triggerIconPosition !== "absolute" ||
      compactStyles.triggerRateFontSize !== "9px" ||
      compactStyles.triggerRatePosition !== "absolute" ||
      compactStyles.clearRateColor !== "rgb(255, 255, 255)" ||
      compactStyles.tempoOrder.join(" ") !== "slider-wrap presets pitch-label speed-status" ||
      compactStyles.statusOrder.join(" ") !== "current bypass"
    ) {
      throw new Error(`Playback Speed panel compact styling is incomplete: ${JSON.stringify(compactStyles)}`);
    }

    // Exercise a native drag while the extension's access bridge is asynchronous.
    await page.evaluate(() => { window.accessResponseDelay = 80; });
    const speedSlider = host.locator(".slider");
    const sliderBox = await speedSlider.boundingBox();
    await page.mouse.move(sliderBox.x + sliderBox.width * .3, sliderBox.y + sliderBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const firstDragRate = await page.locator("audio").evaluate((audio) => audio.playbackRate);
    await page.mouse.move(sliderBox.x + sliderBox.width * .8, sliderBox.y + sliderBox.height / 2, { steps: 8 });
    await page.waitForTimeout(180);
    const lastDragRate = await page.locator("audio").evaluate((audio) => audio.playbackRate);
    await page.mouse.up();
    if (lastDragRate <= firstDragRate + .2) {
      throw new Error(`Speed slider stopped following a held mouse drag: ${firstDragRate} -> ${lastDragRate}`);
    }
    await page.evaluate(() => { window.accessResponseDelay = 0; });
    await speedSlider.fill("1");

    // A slow older authorization must not overwrite a newer speed selection.
    await page.evaluate(() => { window.accessResponseDelay = 250; });
    await speedSlider.fill("1.5");
    await page.evaluate(() => { window.accessResponseDelay = 40; });
    await speedSlider.fill("2");
    await page.waitForTimeout(300);
    if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== 2) {
      throw new Error("An older access response overwrote the latest speed selection.");
    }
    await page.evaluate(() => { window.accessResponseDelay = 0; window.denyAccess = true; });
    await speedSlider.fill("2.5");
    if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== 2) {
      throw new Error("Speed changed despite denied authorization.");
    }
    await page.evaluate(() => { window.denyAccess = false; });
    await speedSlider.fill("1");

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
        fixedPresetCount: root.querySelectorAll(".preset:not(.custom-preset)").length,
        savedRateLabels: [...root.querySelectorAll(".custom-preset")].map((button) => button.textContent),
        hasRatingLink: Boolean(root.querySelector(".rating-link")),
        labels: [...root.querySelectorAll(".range-label")].map((node) => node.textContent),
        order: [...root.querySelector(".panel").children].map((node) => node.className),
      };
    });
    if (
      panelFeatures.customCount !== 2 ||
      panelFeatures.fixedPresetCount !== 0 ||
      panelFeatures.savedRateLabels.join("|") !== "0.500x|1.000x" ||
      panelFeatures.hasRatingLink ||
      panelFeatures.labels.join("|") !== "Tone & Velocity" ||
      panelFeatures.order.slice(0, 3).join("|") !==
        "panel-header|drum-section|tempo-row"
    ) {
      throw new Error("The combined panel layout or links are incomplete.");
    }

    const freePlaybackControls = await host.evaluate((element) => {
      const root = element.shadowRoot;
      return {
        slider: root.querySelector(".slider").disabled,
        pitch: root.querySelector(".pitch-toggle").disabled,
        presets: [...root.querySelectorAll(".preset")].some((button) => button.disabled),
      };
    });
    if (freePlaybackControls.slider || freePlaybackControls.pitch || freePlaybackControls.presets) {
      throw new Error(`Pitch and speed controls must work without a selected loop: ${JSON.stringify(freePlaybackControls)}`);
    }

    const emptyLoopActions = await host.evaluate((element) => {
      const root = element.shadowRoot;
      return {
        hidden: root.querySelector(".waveform-actions").hidden,
        clearDisabled: root.querySelector(".clear-loop").disabled,
        downloadDisabled: root.querySelector(".download-loop").disabled,
      };
    });
    if (emptyLoopActions.hidden || !emptyLoopActions.clearDisabled || !emptyLoopActions.downloadDisabled) {
      throw new Error(`Expanded loop actions must be visible and disabled without a loop: ${JSON.stringify(emptyLoopActions)}`);
    }
    assert.equal(await host.locator(".save-loop-pad").isDisabled(), true);
    await host.locator(".waveform-toggle").evaluate((button) => button.click());
    if (await host.locator(".waveform-actions").isHidden()) {
      throw new Error("Collapsed loop actions must remain visible without an active loop.");
    }
    await host.locator(".waveform-toggle").evaluate((button) => button.click());

    await host.locator(".slider").fill("0.7125");
    const custom = host.locator('.custom-preset[data-custom-index="0"]');
    await custom.dispatchEvent("pointerdown");
    await page.waitForTimeout(700);
    await custom.dispatchEvent("pointerup");
    await host.locator('.custom-preset[data-custom-index="1"]').click();
    await custom.click();
    if (
      await page.locator("audio").evaluate((audio) => audio.playbackRate) !== 0.7125 ||
      await page.evaluate(() => localStorage.getItem("scdl.tempo.savedRate.1")) !== "0.7125"
    ) {
      throw new Error("A custom speed was not saved by long press and restored by click.");
    }

    await host.locator(".slider").fill("1.25");
    await host.locator(".pitch-toggle").evaluate((toggle) => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await host.locator(".download-track-button").click();
    const masterDownload = await page.evaluate(() => window.trackDownloadRequests.at(-1));
    const activeLoopBeforeMasterDownload = await page.evaluate(() =>
      JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))?.active
    );
    if (
      activeLoopBeforeMasterDownload ||
      masterDownload?.playbackTransform?.rate !== 1.25 ||
      masterDownload?.playbackTransform?.preservePitch !== true ||
      Object.hasOwn(masterDownload || {}, "trimRange")
    ) {
      throw new Error(`Master download must export the full current track at the active speed and pitch: ${JSON.stringify(masterDownload)}`);
    }

    await page.locator("audio").evaluate((audio) => { audio.currentTime = 12.345; });
    await host.locator(".waveform-times .set-a").click();
    const draftLoop = await page.evaluate(() =>
      JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))
    );
    assert.equal(draftLoop.startMs, 12345, "Set A must retain the first marker before B exists");
    assert.equal(draftLoop.endMs, null);
    assert.equal(draftLoop.active, false, "A draft marker must not activate a loop");
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 20.678; });
    await host.locator(".waveform-times .set-b").click();
    const capturedLoop = await page.evaluate(() =>
      JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))
    );
    if (
      capturedLoop.startMs !== 12345 ||
      capturedLoop.endMs !== 20678 ||
      !capturedLoop.enabled ||
      (await host.locator(".waveform-times .set-a").textContent()).trim() !== "00:12.345" ||
      (await host.locator(".waveform-times .set-b").textContent()).trim() !== "00:20.678" ||
      !(await host.locator(".waveform-times .set-a").getAttribute("title"))?.includes("00:12.345")
    ) {
      throw new Error(`Set A/Set B did not capture the live player range or expose it in their tooltip: ${JSON.stringify({ capturedLoop, label: await host.locator(".waveform-times .set-a").textContent(), title: await host.locator(".waveform-times .set-a").getAttribute("title") })}`);
    }
    const setA = host.locator(".waveform-times .set-a");
    await setA.dispatchEvent("pointerdown", { button: 0 });
    await page.waitForTimeout(700);
    await setA.dispatchEvent("pointerup", { button: 0 });
    await setA.click();
    const partiallyClearedLoop = await page.evaluate(() =>
      JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))
    );
    if (
      partiallyClearedLoop.startMs !== null ||
      partiallyClearedLoop.endMs !== 20678 ||
      partiallyClearedLoop.active ||
      (await setA.textContent()).trim() !== "Set A" ||
      (await host.locator(".waveform-times .set-b").textContent()).trim() !== "00:20.678"
    ) {
      throw new Error(`Holding Set A must remove only A and suppress the following click: ${JSON.stringify(partiallyClearedLoop)}`);
    }
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 12.345; });
    await setA.click();
    assert.equal(await host.locator(".save-loop-pad").isDisabled(), false);
    await host.locator("#scdl-effect-reverb").evaluate((slider) => { slider.value = "24"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.locator("#scdl-effect-delay").evaluate((slider) => { slider.value = "17"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector('[data-effect-value="delay"]')?.textContent === "17%");
    await host.locator(".save-loop-pad").click();
    assert.equal(await host.locator(".drum-section").evaluate((node) => node.classList.contains("is-selecting")), true);
    await drumPads.nth(5).click();
    await host.locator('.drum-pad[title="Loop 12.3–20.7s · hold to load"]').waitFor();
    const padRender = await page.evaluate(() => window.padRenderRequests.at(-1));
    assert.equal(padRender.index, 5);
    assert.deepEqual(padRender.trimRange, { startMs: 12345, endMs: 20678, durationMs: 120000 });
    assert.equal(padRender.playbackTransform.rate, 1.25);
    assert.equal(padRender.playbackTransform.preservePitch, true);
    assert.equal(padRender.effects.reverb, 24);
    assert.equal(padRender.effects.delay, 17);
    await drumPads.nth(5).click();
    await page.waitForFunction(() => window.drumStarts === 4);
    await host.locator("#scdl-effect-reverb").evaluate((slider) => { slider.value = "0"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.locator("#scdl-effect-delay").evaluate((slider) => { slider.value = "0"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.locator(".waveform-toggle").evaluate((button) => button.click());
    await host.locator(".download-loop").click();
    await host.locator(".waveform-toggle").evaluate((button) => button.click());
    const loopDownload = await page.evaluate(() => window.loopDownloadRequests.at(-1));
    if (
      loopDownload?.trimRange?.startMs !== 12345 ||
      loopDownload?.trimRange?.endMs !== 20678 ||
      loopDownload?.playbackTransform?.rate !== 1.25 ||
      loopDownload?.playbackTransform?.preservePitch !== true
    ) {
      throw new Error(`Loop WAV download must keep exporting only A/B at the active speed and pitch: ${JSON.stringify(loopDownload)}`);
    }
    await host.locator(".download-track-button").click();
    const masterDownloadWithLoop = await page.evaluate(() => window.trackDownloadRequests.at(-1));
    if (
      await page.evaluate(() => window.trackDownloadRequests.length) !== 2 ||
      Object.hasOwn(masterDownloadWithLoop || {}, "trimRange") ||
      masterDownloadWithLoop?.playbackTransform?.rate !== 1.25 ||
      masterDownloadWithLoop?.playbackTransform?.preservePitch !== true
    ) {
      throw new Error(`Master download must ignore an existing loop selection: ${JSON.stringify(masterDownloadWithLoop)}`);
    }

    const waveformUi = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const canvas = root.querySelector(".waveform-canvas");
      const custom = root.querySelector('.custom-preset[data-custom-index="0"]');
      return {
        canvas: [canvas.width, canvas.height],
        markers: root.querySelectorAll(".waveform-marker:not([hidden])").length,
        customFits: custom.scrollWidth <= custom.clientWidth,
        setALabel: root.querySelector(".waveform-times .set-a").textContent.trim(),
        setAInFooter: root.querySelector(".waveform-times")?.contains(root.querySelector(".waveform-times .set-a")),
        headerSettersHidden: getComputedStyle(root.querySelector(".waveform-header-setters")).display === "none",
      };
    });
    if (waveformUi.canvas[0] <= 1 || waveformUi.canvas[1] <= 1 || waveformUi.markers !== 2 || !waveformUi.customFits || waveformUi.setALabel !== "00:12.345" || !waveformUi.setAInFooter || !waveformUi.headerSettersHidden) {
      throw new Error(`Interactive waveform layout is incomplete: ${JSON.stringify(waveformUi)}`);
    }

    const endMarker = host.locator(".waveform-end");
    const markerBox = await endMarker.boundingBox();
    await host.evaluate((element) => {
      const root = element.shadowRoot;
      const controls = [root.querySelector(".pitch-toggle"), ...root.querySelectorAll(".effect-bypass")];
      window.headerDisableFlashes = 0;
      window.headerDisableObserver = new MutationObserver(() => {
        if (controls.some((control) => control.disabled)) window.headerDisableFlashes += 1;
      });
      controls.forEach((control) => window.headerDisableObserver.observe(control, {
        attributes: true,
        attributeFilter: ["disabled"],
      }));
    });
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(markerBox.x - 32, markerBox.y + markerBox.height / 2, { steps: 4 });
    await page.mouse.up();
    const headerDisableFlashes = await page.evaluate(() => {
      window.headerDisableObserver.disconnect();
      return window.headerDisableFlashes;
    });
    assert.equal(headerDisableFlashes, 0,
      "Dragging the waveform must not flash Keep Tone or the FX R/D buttons through transient disabled states");
    const draggedEnd = await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session")).endMs);
    if (!(draggedEnd < 20678)) throw new Error(`Dragging marker B did not update the shared loop session: ${draggedEnd}`);

    const waveformCanvas = host.locator(".waveform-canvas");
    const canvasBox = await waveformCanvas.boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width * .8, canvasBox.y + canvasBox.height * .75);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * .2, canvasBox.y + canvasBox.height * .75, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const loop = JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session") || "null");
      return Math.abs(loop?.startMs - 24000) < 100 && Math.abs(loop?.endMs - 96000) < 100;
    });

    if (await host.locator('.waveform-toggle').getAttribute('aria-expanded') === 'false') {
      await host.locator('.waveform-toggle').click();
    }
    const headerLayout = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const rect = (selector) => root.querySelector(selector).getBoundingClientRect();
      return {
        chevronAfterBypasses: rect('.effects-chevron').left >= rect('.effect-bypasses').right,
        fxCoversHeader: rect('.effects-toggle').left === rect('.effects-header').left,
        waveformBelowHeader: rect('.waveform-stage').top >= rect('.waveform-toggle').bottom,
        waveformHeaderGap: rect('.waveform-stage').top - rect('.waveform-toggle').bottom,
        waveformHeight: rect('.waveform-stage').height,
        presetsTopPadding: getComputedStyle(root.querySelector('.effects-presets')).paddingTop,
      };
    });
    assert.deepEqual(headerLayout, {
      chevronAfterBypasses: true, fxCoversHeader: true, waveformBelowHeader: true,
      waveformHeaderGap: 3, waveformHeight: 67, presetsTopPadding: '3px',
    }, 'Headers must span the full row, place FX actions before the chevron, and keep the waveform below');
    await host.locator('.waveform-toggle').hover();
    const loopHover = await host.locator('.waveform-toggle').evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    await host.locator('.effect-bypass').first().hover();
    assert.deepEqual(await host.locator('.effects-toggle').evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    }), loopHover, 'Hovering FX actions must highlight the whole header like Loop Region');
    const waveformStage = host.locator(".waveform-stage");
    await waveformStage.hover();
    const fullEndLabel = await host.locator(".waveform-end-label").textContent();
    await page.mouse.wheel(0, -180);
    const zoomedEndLabel = await host.locator(".waveform-end-label").textContent();
    if (zoomedEndLabel === fullEndLabel) throw new Error("The player waveform did not zoom around the pointer.");

    await host.locator(".waveform-toggle").evaluate((button) => button.click());
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
        header: root.querySelector(".waveform-toggle").textContent.trim(),
        settersVisible: [...root.querySelectorAll(".waveform-header-setters .setter")].every(
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
      !collapsedLooper.header.includes("Loop Region") ||
      collapsedLooper.canvas.join("x") !== "1x1" ||
      collapsedLooper.stored !== "true" ||
      collapsedLooper.fetches !== 0
    ) {
      throw new Error(`Collapsed looper still renders or loads its waveform: ${JSON.stringify(collapsedLooper)}`);
    }

    const collapsedFx = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const shell = root.querySelector(".effects-shell");
      return {
        visible: shell.offsetHeight > 0,
        collapsed: shell.classList.contains("is-collapsed"),
        values: [...root.querySelectorAll(".effect-value")].map((value) => value.textContent),
        loopImmediatelyBefore: root.querySelector(".loop-edit").nextElementSibling === shell,
      };
    });
    if (
      !collapsedFx.visible || !collapsedFx.collapsed ||
      collapsedFx.values.join("|") !== "0%|0%" || !collapsedFx.loopImmediatelyBefore
    ) {
      throw new Error(`FX section was not compactly placed below the looper: ${JSON.stringify(collapsedFx)}`);
    }
    await host.locator(".effects-toggle").click();
    await host.locator("#scdl-effect-reverb").evaluate((slider) => {
      slider.value = "35";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await host.locator("#scdl-effect-delay").evaluate((slider) => {
      slider.value = "28";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => [...document.querySelector("#scdl-tempo-control")?.shadowRoot?.querySelectorAll(".effect-value") || []]
      .map((value) => value.textContent).join("|") === "35%|28%");
    const activeFx = await host.evaluate((element) => {
      const root = element.shadowRoot;
      return {
        expanded: root.querySelector(".effects-toggle").getAttribute("aria-expanded"),
        values: [...root.querySelectorAll(".effect-value")].map((value) => value.textContent),
        exportNoteAbsent: root.querySelector(".effects-export-note") === null,
        status: root.querySelector(".status").textContent,
      };
    });
    if (
      activeFx.expanded !== "true" || activeFx.values.join("|") !== "35%|28%" ||
      !activeFx.exportNoteAbsent || activeFx.status === "Play a track to activate FX."
    ) {
      throw new Error(`FX sliders or WAV notice failed: ${JSON.stringify(activeFx)}`);
    }
    await host.locator('[data-effect-settings="delay"]').click();
    await host.locator('#scdl-effect-delay-time').fill('400');
    await host.locator('#scdl-effect-delay-time').dispatchEvent('change');
    if (await host.locator('[data-effect-character-value="delayTime"]').textContent() !== '400ms') {
      throw new Error("FX character setting was reset while requesting authorization.");
    }
    await host.locator('[data-effect-settings="delay"]').click();
    for (const selector of ["#scdl-effect-reverb", "#scdl-effect-delay"]) {
      await host.locator(selector).evaluate((slider) => {
        slider.value = "0";
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await host.locator(".waveform-toggle").evaluate((button) => button.click());
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

    await host.locator(".clear-loop").click();
    if (await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session")).active)) {
      throw new Error("Clear did not remove the loop selection.");
    }
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 12.345; });
    await host.locator(".waveform-times .set-a").click();
    await page.locator("audio").evaluate((audio) => { audio.currentTime = 20.678; });
    await host.locator(".waveform-times .set-b").click();

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

    for (const [index, rate] of [[0, 0.7125], [1, 1]]) {
      const preset = host.locator(`.custom-preset[data-custom-index="${index}"]`);
      await preset.click();
      if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== rate ||
          await preset.getAttribute("aria-pressed") !== "true") {
        throw new Error(`Saved speed ${rate}x did not apply.`);
      }
    }
    for (const rate of [0.1, 0.125, 0.15, 0.175, 0.2, 3]) {
      await host.locator(".slider").fill(String(rate));
      if (await page.locator("audio").evaluate((audio) => audio.playbackRate) !== rate) {
        throw new Error(`Slider rate ${rate}x did not apply.`);
      }
    }
    await host.locator('.custom-preset[data-custom-index="1"]').click();
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
    await host.locator('.slider').fill('0.5');
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

    await host.locator('#scdl-effect-reverb').fill('2');
    await host.locator('#scdl-effect-reverb').dispatchEvent('change');
    if (!(await host.locator('.clear-rate').isVisible())) {
      throw new Error('Reset control must appear when any effect or playback setting is active.');
    }
    await host.locator('.clear-rate').click();
    await page.waitForFunction(() => {
      const host = document.querySelector('#scdl-tempo-control');
      const root = host?.shadowRoot;
      const loop = JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session') || 'null');
      return root?.querySelector('.slider')?.value === '1' &&
        root?.querySelector('.pitch-toggle')?.checked === false &&
        root?.querySelector('#scdl-effect-reverb')?.value === '0' &&
        root?.querySelector('#scdl-effect-delay')?.value === '0' &&
        loop?.active === false &&
        root?.querySelector('.clear-rate')?.hidden === true;
    });

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 420 });
      const headerFits = await host.locator(".panel-header").evaluate((header) => {
        const rect = (selector) => header.querySelector(selector).getBoundingClientRect();
        const logo = rect(".brand-logo");
        const title = rect(".brand-title-line");
        const tools = rect(".panel-tools");
        const presets = header.getRootNode().querySelector(".presets").getBoundingClientRect();
        const bounds = header.getBoundingClientRect();
        const root = header.getRootNode();
        const tempo = root.querySelector(".tempo-row");
        const slider = root.querySelector(".slider").getBoundingClientRect();
        const limits = root.querySelector(".limits").getBoundingClientRect();
        const pads = [...root.querySelectorAll(".drum-pad")];
        return title.right <= tools.left && slider.right <= presets.left &&
          presets.height <= slider.height + 2 &&
          logo.right <= title.left && tools.right <= bounds.right &&
          header.scrollWidth <= header.clientWidth && tempo.scrollWidth <= tempo.clientWidth &&
          limits.left >= slider.left && limits.right <= slider.right &&
          pads.every((pad) => pad.offsetHeight === 28 && pad.getBoundingClientRect().right <= bounds.right);
      });
      if (!headerFits) throw new Error(`Player Tools compact controls do not fit at ${width}px.`);
    }
    await page.setViewportSize({ width: 720, height: 420 });

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await panel.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: screenshotPath });

    // Exercise the EQ inside the real panel, including the access bridge and persistence.
    await page.setViewportSize({ width: 720, height: 780 });
    await host.locator(".peq summary").click();
    await host.locator(".peq-canvas").dblclick({ position: { x: 180, y: 130 } });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.bands[0]?.gain < 0);
    await host.locator(".peq-canvas").dblclick({ position: { x: 300, y: 55 } });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.bands[1]?.gain > 0);
    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(projectRoot, "test-results", "parametric-eq.png") });
    await host.locator(".peq-bypass").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.enabled === false);

    await page.evaluate(() => {
      const listeners = [];
      window.chrome = {
        runtime: {
          id: "test-extension",
          getURL: (file) => `chrome-extension://test-extension/${file}`,
          onMessage: { addListener: (listener) => listeners.push(listener) },
          sendMessage: async () => ({ success: true }),
        },
      };
      window.sendOffscreenTest = (message) => new Promise((resolve) => {
        listeners[0](message, {
          id: "test-extension",
          url: "chrome-extension://test-extension/scripts/background.js",
        }, resolve);
      });
    });
    for (const script of ["format-utils.js", "loop-audio-renderer.js", "download-core.js", "offscreen.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, script) });
    }
    const storedSample = await page.evaluate(async () => {
      const render = await window.sendOffscreenTest({
        type: "OFFSCREEN_PAD_RENDER", buildId: "track_pad_integration", index: 5,
        name: "Rendered Loop", streamUrl: `${location.origin}/assets/drums/tom1.wav`,
        trackData: { streamProtocol: "progressive", durationMs: 420, title: "Tom", artist: "Test" },
        trimRange: { startMs: 0, endMs: 200 },
        playbackTransform: { rate: 1.25, preservePitch: false },
        effects: { reverb: 35, delay: 20, reverbRoom: "room", reverbSize: 30, reverbDecay: 0.2,
          reverbPreDelay: 8, reverbTone: 70, delayTime: 60, delayFeedback: 20, delayTone: 70 },
      });
      if (!render.success) return render;
      const list = await window.sendOffscreenTest({ type: "OFFSCREEN_PAD_LIST" });
      const get = await window.sendOffscreenTest({ type: "OFFSCREEN_PAD_GET", index: 5 });
      const bytes = await (await fetch(get.pad.dataUrl)).arrayBuffer();
      return { render, list, name: get.pad.name, signature: String.fromCharCode(...new Uint8Array(bytes.slice(0, 4))), bytes: bytes.byteLength };
    });
    assert.equal(storedSample.render.success, true, storedSample.render.error);
    assert.equal(storedSample.name, "Rendered Loop");
    assert.equal(storedSample.signature, "RIFF");
    assert.ok(storedSample.bytes > 1000);
    assert.ok(storedSample.list.pads.some((pad) => pad.index === 5 && pad.name === "Rendered Loop"));
    await page.reload();
    const persistedName = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("scdl-player-pads", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result.transaction("samples").objectStore("samples").get(5);
        entry.onsuccess = () => resolve(entry.result?.name);
        entry.onerror = () => reject(entry.error);
      };
    }));
    assert.equal(persistedName, "Rendered Loop", "A saved pad must survive a page reload.");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-scdl-player-tools-access", JSON.stringify({
        plan: "pro", state: "pro", capabilities: { tempo: true, parametricEq: true },
      }));
    });
    for (const file of ["tempo-control-core.js", "parametric-eq.js", "audio-effects-core.js", "parametric-eq-ui.js", "tempo-control-main.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    await host.locator(".trigger").click();
    await host.locator(".peq summary").click();
    assert.equal(await host.locator(".peq-point").count(), 2, "EQ points must survive reload");
    assert.equal(await host.locator(".peq-headroom").count(), 0);
    assert.equal(await host.locator(".peq-fields").count(), 0);
    assert.equal(await host.locator(".peq-hint").count(), 0);
    assert.equal(await host.locator(".peq-bypass").getAttribute("aria-pressed"), "true", "EQ bypass must survive reload");
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
