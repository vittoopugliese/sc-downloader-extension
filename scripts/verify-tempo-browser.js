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
const eqIconDataUrl = `data:image/svg+xml;base64,${fs.readFileSync(path.join(projectRoot, "assets", "icons", "eq.svg")).toString("base64")}`;
const headerIconDataUrls = Object.fromEntries(["detach", "trash", "expand"].map((name) => [
  name,
  `data:image/svg+xml;base64,${fs.readFileSync(path.join(projectRoot, "assets", "icons", `${name}.svg`)).toString("base64")}`,
]));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function main() {
  const server = http.createServer((request, response) => {
    const sampleName = /^\/assets\/drums\/(kick1|kick2|clap1|clap2|hat1|hat2|snare1|tom1)\.wav$/.exec(request.url || "");
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
    await page.addScriptTag({ path: path.join(__dirname, "sampler-core.js") });
    for (const file of ["parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    await page.addScriptTag({ path: path.join(__dirname, "player-tools-policy.js") });
    await page.evaluate(([logoUrl, eqUrl, headerIcons]) => {
      const eqApi = globalThis.SCParametricEQ;
      window.masterEqualizers = [];
      globalThis.SCParametricEQ = Object.freeze({ ...eqApi, createGraph(context, options) {
        const graph = eqApi.createGraph(context, options);
        if (options?.analyse) window.masterEqualizers.push(graph);
        return graph;
      } });
      const playerToolsSnapshot = {
        revision: 1,
        plan: "pro",
        state: "pro",
        grant: null,
        capabilities: {
          freeEffects: true, premiumEffects: true, saveLoopPad: true, loopInstrument: true,
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
      document.documentElement.setAttribute("data-scdl-extension-eq-url", eqUrl);
      for (const [name, url] of Object.entries(headerIcons)) {
        document.documentElement.setAttribute(`data-scdl-extension-${name}-icon-url`, url);
      }
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
      window.sliceRenderRequests = [];
      window.sliceCommitRequests = [];
      window.preparedSlices = {};
      window.instrumentRenderRequests = [];
      window.savedPadSamples = {};
      window.addEventListener("message", async (event) => {
        const data = event.data;
        if (event.source !== window || data?.source !== "scdl-pad-main") return;
        let result = { success: true };
        if (data.action === "list") {
          result.pads = Object.entries(window.savedPadSamples).map(([index, pad]) => ({ index: Number(index), name: pad.name }));
        } else if (data.action === "render") {
          window.padRenderRequests.push(data);
          window.savedPadSamples[data.index] = { name: data.name, dataUrl: `${location.origin}/assets/drums/tom1.wav` };
          result.pad = { name: data.name };
        } else if (data.action === "slices") {
          window.sliceRenderRequests.push(data);
          window.preparedSlices[data.operationId] = data;
          if (window.sliceDelay) await new Promise(resolve => setTimeout(resolve, window.sliceDelay));
        } else if (data.action === "cancel-slices") {
          delete window.preparedSlices[data.operationId];
        } else if (data.action === "commit-slices") {
          window.sliceCommitRequests.push(data);
          const snapshot = window.preparedSlices[data.operationId];
          result.pads = Array.from({ length: 8 }, (_, index) => ({ index, name: `${snapshot.name} · ${index + 1}/8` }));
          result.pads.forEach(pad => { window.savedPadSamples[pad.index] = { name: pad.name, dataUrl: `${location.origin}/assets/drums/tom1.wav` }; });
        } else if (data.action === "instrument") {
          window.instrumentRenderRequests.push(data);
          const frames = Math.ceil(data.trimRange.durationMs / 1000 / data.playbackTransform.rate * 8000);
          const bytes = new Uint8Array(44 + frames * 2);
          const view = new DataView(bytes.buffer);
          const text = (at, value) => [...value].forEach((character, i) => view.setUint8(at + i, character.charCodeAt(0)));
          text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          text(36, "data"); view.setUint32(40, frames * 2, true);
          for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.sin(i * Math.PI * 440 / 8000) * 16000, true);
          const blob = new Blob([bytes], { type: "audio/wav" });
          for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
            const part = blob.slice(offset, offset + 1024 * 1024);
            const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(part); });
            window.postMessage({ source: "scdl-pad-content", operationId: data.operationId, chunk: { offset, byteLength: part.size, dataUrl } }, location.origin);
          }
          result.instrument = { name: data.name, fullTrack: true, byteLength: blob.size, mimeType: blob.type };
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
    }, [logoDataUrl, eqIconDataUrl, headerIconDataUrls]);
    await page.evaluate(() => {
      const effectsApi = globalThis.SCTempoEffects;
      globalThis.SCTempoEffects = Object.freeze({
        ...effectsApi,
        create(options) {
          const controller = effectsApi.create(options);
          return Object.freeze({
            ...controller,
            reset() {
              if (window.failEffectsReset) throw new Error("synthetic FX reset failure");
              return controller.reset();
            },
          });
        },
      });
    });
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
    await page.waitForTimeout(90);
    assert.deepEqual(await page.locator("#scdl-fast-tooltip").evaluate((tip) => ({
      text: tip.textContent, visible: tip.style.visibility,
    })), { text: "Playback speed 1.0x", visible: "visible" },
    "The Player Tools trigger must show a custom tooltip from its aria-label");
    await page.waitForTimeout(180);
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
    const samplerToggle = host.locator(".sampler-toggle");
    assert.equal(await drumPads.count(), 8, "The sampler must contain eight drum pads.");
    assert.equal(await samplerToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await drumPads.nth(0).isHidden(), true, "The sampler starts collapsed.");
    const collapsedSamplerLayout = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const section = root.querySelector("#scdl-sampler");
      const header = section.querySelector(":scope > .tool-section-header");
      const style = getComputedStyle(section);
      return {
        sectionHeight: section.getBoundingClientRect().height,
        expectedHeight: header.getBoundingClientRect().height +
          Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth),
      };
    });
    assert.ok(Math.abs(collapsedSamplerLayout.sectionHeight - collapsedSamplerLayout.expectedHeight) < 0.2,
      `A collapsed sampler must not reserve empty space below its header: ${JSON.stringify(collapsedSamplerLayout)}`);
    await samplerToggle.click();
    assert.equal(await samplerToggle.getAttribute("aria-expanded"), "true");
    {
    const padGainKnob = host.locator('.pad-knob[data-pad-control="gainPercent"]');
    const padPitchKnob = host.locator('.pad-knob[data-pad-control="pitchSemitones"]');
    assert.equal(await host.locator('.pad-knob').count(), 3);
    assert.equal(await host.locator('.time-knob').isDisabled(), true);
    await padGainKnob.focus();
    await page.keyboard.press('End');
    assert.equal(await padGainKnob.getAttribute('aria-valuenow'), '154');
    const attackKnob = host.locator('.envelope-knob[data-envelope="attack"]');
    await attackKnob.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await attackKnob.getAttribute('aria-valuenow'), '14');
    await drumPads.nth(1).click();
    assert.equal(await drumPads.nth(1).getAttribute('aria-pressed'), 'true');
    assert.equal(await padGainKnob.getAttribute('aria-valuenow'), '100');
    assert.equal(await attackKnob.getAttribute('aria-valuenow'), '4');
    await page.mouse.move(0, 0);
    await page.keyboard.press('z');
    assert.equal(await drumPads.nth(0).getAttribute('aria-pressed'), 'true');
    assert.equal(await padGainKnob.getAttribute('aria-valuenow'), '154');
    assert.equal(await attackKnob.getAttribute('aria-valuenow'), '14');
    await attackKnob.focus();
    await page.keyboard.press('ArrowDown');
    await padGainKnob.dblclick();
    assert.equal(await padGainKnob.getAttribute('aria-valuenow'), '100');
    await padPitchKnob.focus();
    await page.keyboard.press('Home');
    assert.equal(await padPitchKnob.getAttribute('aria-valuenow'), '-12');
    await page.keyboard.press('End');
    assert.equal(await padPitchKnob.getAttribute('aria-valuenow'), '12');
    await padPitchKnob.dblclick();
    assert.equal(await padPitchKnob.getAttribute('aria-valuenow'), '0');
    }
    assert.deepEqual(await drumPads.allTextContents(), ["Z", "X", "C", "V", "B", "N", "M", "L"]);
    assert.deepEqual(await drumPads.evaluateAll((pads) => pads.map((pad) => pad.title)),
      ["Kick", "Clap", "Hat", "Kick 2", "Snare", "Tom", "Clap 2", "Hat 2"].map((name) => `${name} · hold to load`));
    const drumPlacement = await host.evaluate((element) => {
      const root = element.shadowRoot;
      const header = root.querySelector(".panel-header").getBoundingClientRect();
      const tempo = root.querySelector(".tempo-row").getBoundingClientRect();
      const drums = root.querySelector(".drum-section").getBoundingClientRect();
      const loop = root.querySelector(".waveform-shell").getBoundingClientRect();
      return header.bottom <= tempo.top && tempo.bottom <= drums.top && drums.bottom <= loop.top &&
        root.querySelector(".drum-pads").scrollWidth <= root.querySelector(".drum-pads").clientWidth;
    });
    assert.equal(drumPlacement, true, "The sampler must fit between the tempo and loop controls.");
    await page.evaluate(() => {
      window.drumStarts = 0;
      window.sampleSources = [];
      const originalStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (time) {
        this.testStopAt = time;
        return originalStop.call(this, time);
      };
      window.sourcePlaybackRates = [];
      window.sourceStartArguments = [];
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.drumStarts += 1;
        window.sampleSources.push(this);
        window.lastSampleContext = this.context;
        window.sourcePlaybackRates.push(this.playbackRate.value);
        window.sourceStartArguments.push(args);
        return originalStart.apply(this, args);
      };
    });
    await drumPads.nth(0).click();
    await page.waitForFunction(() => window.drumStarts === 1);
    await page.waitForFunction(() => window.masterEqualizers.some((eq) =>
      eq.input.context === window.lastSampleContext && eq.readSpectrum().values.some((db) => db > -90)));
    await drumPads.nth(1).hover();
    await page.keyboard.press("j");
    assert.equal(await drumPads.nth(1).locator(".drum-key").textContent(), "J",
      "Hovering and pressing a key must assign it to that pad.");
    await host.locator(".brand-name").hover();
    await page.keyboard.press("j");
    await page.waitForFunction(() => window.drumStarts === 2);
    const sampleChooser = page.waitForEvent("filechooser");
    await drumPads.nth(3).press("Shift+Enter");
    await (await sampleChooser).setFiles(path.join(projectRoot, "assets", "drums", "hat1.wav"));
    await host.locator('.drum-pad[title="hat1 · hold to load"]').waitFor();
    assert.equal(await page.evaluate(() => window.drumStarts), 2,
      "Using Shift + Enter to upload must not also play it.");
    await drumPads.nth(3).click();
    await page.waitForFunction(() => window.drumStarts === 3);
    await host.locator(".download-track-button").hover();
    await page.waitForTimeout(400);
    assert.deepEqual(await page.locator("#scdl-fast-tooltip").evaluate((tip) => ({
      text: tip.textContent, visible: tip.style.visibility,
    })), { text: "Download current playing", visible: "visible" },
    "A Player Tools button in the shadow panel must show its custom tooltip");
    await host.locator(".clear-loop").hover();
    await page.waitForTimeout(400);
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
      const detachButton = panel.querySelector(".detach-button");
      const detachIcon = detachButton.querySelector(".detach-icon");
      const brandLogo = panel.querySelector(".brand-logo");
      const brandCopy = panel.querySelector(".brand-copy");
      const tools = panel.querySelector(".panel-tools");
      const presets = panel.querySelector(".presets");
      const header = panel.querySelector(".panel-header");
      const waveformShell = panel.querySelector(".waveform-shell");
      const waveformTitleIcon = panel.querySelector(".waveform-toggle .tool-section-icon");
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
        pitchTooltip: pitchLabel.getAttribute("data-scdl-tooltip"),
        pitchContainerWidth: pitchLabel.offsetWidth,
        downloadTrackButtonSize: [downloadTrackButton.offsetWidth, downloadTrackButton.offsetHeight],
        downloadTrackIconSize: [downloadTrackIcon.clientWidth, downloadTrackIcon.clientHeight],
        downloadTrackTooltip: downloadTrackButton.title,
        toolOrder: [...tools.children].map((element) => element.className),
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
      compactStyles.pitchTooltip !== "Keep tone: change playback speed without changing the pitch." ||
      compactStyles.pitchContainerWidth !== 22 ||
      compactStyles.downloadTrackButtonSize.join("x") !== "23x20" ||
      compactStyles.downloadTrackIconSize.join("x") !== "12x12" ||
      compactStyles.downloadTrackTooltip !== "Download current playing" ||
      compactStyles.toolOrder.join("|") !== "panel-tool download-track-button|panel-tool reset-tools-button|panel-tool detach-button|panel-tool visibility-button|panel-tool close-button" ||
      compactStyles.detachButtonSize.join("x") !== "23x20" ||
      compactStyles.detachButtonRadius !== "4px" ||
      compactStyles.detachIconSize.join("x") !== "13x13" ||
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

    // Continuous input must update audio before the gesture stops, without
    // disabling neighboring controls while the access bridge responds.
    const continuousRate = await host.evaluate(async (element) => {
      window.accessResponseDelay = 80;
      const root = element.shadowRoot;
      const slider = root.querySelector('.slider');
      const audio = document.querySelector('audio');
      const rates = new Set();
      let controlsDisabled = false;
      for (let index = 0; index < 25; index += 1) {
        slider.value = String(1 + index * .025);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        controlsDisabled ||= [...root.querySelectorAll('.pitch-toggle, .preset, .effect-bypass')]
          .some((control) => control.disabled);
        await new Promise((resolve) => setTimeout(resolve, 20));
        rates.add(audio.playbackRate);
      }
      return { updates: rates.size, controlsDisabled };
    });
    assert.ok(continuousRate.updates >= 3,
      'Audio speed must keep updating during continuous input, before the slider stops');
    assert.equal(continuousRate.controlsDisabled, false,
      'Speed input must not blink neighboring controls by disabling them');
    await page.waitForTimeout(120);
    assert.equal(await page.locator('audio').evaluate((audio) => audio.playbackRate), 1.6);

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
        "panel-header|tempo-row|controls-layout"
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
    assert.equal(await host.locator(".sampler-actions > .save-loop-pad").count(), 1,
      "Save loop must live in the Sampler header.");
    assert.equal(await host.locator(".sampler-actions > .loop-instrument").count(), 1,
      "Piano mode must live in the Sampler header.");
    assert.equal(await host.locator(".waveform-actions > .save-loop-pad, .waveform-actions > .loop-instrument").count(), 0,
      "Sampler actions must not consume space in the Loop Region header.");
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
      !masterDownload?.effects?.eq ||
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
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector(".waveform-times .set-b")?.textContent?.trim() === "00:20.678");
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
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector(".save-loop-pad")?.disabled === false);
    assert.equal(await host.locator(".save-loop-pad").isDisabled(), false);
    await host.locator("#scdl-effect-reverb").evaluate((slider) => { slider.value = "24"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.locator("#scdl-effect-delay").evaluate((slider) => { slider.value = "17"; slider.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector('[data-effect-value="delay"]')?.textContent === "17%");
    await samplerToggle.click();
    assert.equal(await drumPads.nth(5).isHidden(), true);
    await host.locator(".save-loop-pad").click();
    assert.equal(await samplerToggle.getAttribute("aria-expanded"), "true",
      "Choosing a loop pad must expand the sampler.");
    assert.equal(await drumPads.nth(5).isVisible(), true);
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
    assert.deepEqual(padRender.effects.eq, { enabled: false, hardClip: false, bands: [] },
      "Saved loop pads must receive the master EQ live, without baking it in twice");
    await drumPads.nth(5).click();
    await page.waitForFunction(() => window.drumStarts === 4);
    const sliceButton = host.locator(".sampler-actions > .slice-loop");
    assert.equal(await sliceButton.count(), 1);
    const originalPadTitles = await drumPads.evaluateAll(buttons => buttons.map(button => button.title));
    const originalPadKeys = await host.locator(".drum-key").allTextContents();
    await sliceButton.click();
    assert.equal(await host.locator(".slice-dialog").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await host.locator(".slice-dialog").isVisible(), false);
    assert.equal(await page.evaluate(() => window.sliceRenderRequests.length), 0, "Escape cancels before any render");
    assert.deepEqual(await drumPads.evaluateAll(buttons => buttons.map(button => button.title)), originalPadTitles);
    await sliceButton.click();
    await host.locator(".slice-replace").click();
    await page.waitForFunction(() => window.sliceCommitRequests.length === 1);
    await page.waitForFunction(() => !document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".save-loop-pad").disabled);
    const sliceRequest = await page.evaluate(() => window.sliceRenderRequests.at(-1));
    assert.equal(sliceRequest.count, 8);
    assert.deepEqual(sliceRequest.trimRange, padRender.trimRange, "slices use A–B, never the full track");
    assert.equal(sliceRequest.fullTrack, undefined);
    assert.deepEqual(sliceRequest.playbackTransform, padRender.playbackTransform);
    assert.deepEqual(await host.locator(".drum-key").allTextContents(), originalPadKeys, "slices preserve key assignments");
    assert.equal(await host.locator(".instrument-controls").isVisible(), true, "Slices retain the ADSR graph");
    assert.equal(await drumPads.nth(7).isVisible(), true, "All eight pads stay visible with ADSR");
    const padAdsr = host.getByRole("checkbox", { name: "ADSR", exact: true });
    assert.equal(await padAdsr.isChecked(), false, "Pads default to one-shot playback");
    assert.equal(await host.getByRole("checkbox", { name: "Cut itself" }).isChecked(), true);
    await padAdsr.check();
    await host.locator(".brand-name").hover();
    const sliceStarts = await page.evaluate(() => window.drumStarts);
    await page.keyboard.down(originalPadKeys[0].toLowerCase());
    await page.waitForFunction(count => window.drumStarts === count + 1, sliceStarts);
    await page.keyboard.up(originalPadKeys[0].toLowerCase());
    assert.equal(await page.evaluate(() => {
      const source = window.sampleSources.at(-1);
      return source.testStopAt <= source.context.currentTime + .11;
    }), true, "Releasing a slice key schedules the ADSR release");
    const padBox = await drumPads.nth(0).boundingBox();
    await page.mouse.move(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
    await page.mouse.down();
    await page.waitForFunction(count => window.drumStarts === count + 2, sliceStarts);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.drumStarts), sliceStarts + 2, "Pointer release does not retrigger the pad");
    await padAdsr.uncheck();
    await page.evaluate(() => { window.sliceDelay = 250; });
    await sliceButton.click();
    await host.locator(".slice-replace").click();
    await page.waitForFunction(() => window.sliceRenderRequests.length === 2);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.sliceCommitRequests.length), 1, "cancelled render never commits");
    assert.equal(await panel.isVisible(), true, "Cancelling slices must keep the panel open");
    await sliceButton.click();
    await host.locator(".slice-replace").click();
    await page.waitForFunction(() => window.sliceRenderRequests.length === 3);
    await host.locator("#scdl-effect-reverb").evaluate(slider => {
      slider.value = "25";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.sliceCommitRequests.length), 1,
      "Changing FX during preparation must discard the stale slices");
    await host.locator("#scdl-effect-reverb").evaluate(slider => {
      slider.value = "24";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot
      .querySelector('[data-effect-value="reverb"]').textContent === "24%");
    await page.evaluate(() => { window.sliceDelay = 0; });
    await page.screenshot({ path: path.join(projectRoot, "test-results", "sampler-eight-pads.png") });
    const instrumentToggle = host.locator(".loop-instrument");
    assert.equal(await instrumentToggle.isDisabled(), false,
      "Piano mode must be available while a loop selection is active.");
    await page.locator("audio").evaluate((audio) => {
      window.instrumentSourcePaused = false;
      window.instrumentPauseCalls = 0;
      Object.defineProperty(audio, "paused", { configurable: true, get: () => window.instrumentSourcePaused });
      window.originalAudioPause = audio.pause;
      audio.pause = () => { window.instrumentPauseCalls++; window.instrumentSourcePaused = true; };
    });
    await instrumentToggle.click();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector(".loop-instrument")?.getAttribute("aria-pressed") === "true");
    const instrumentRender = await page.evaluate(() => window.instrumentRenderRequests.at(-1));
    assert.equal(await page.evaluate(() => window.instrumentSourcePaused), true);
    assert.equal(await page.evaluate(() => window.instrumentPauseCalls), 1);
    assert.deepEqual(instrumentRender.trimRange, { startMs: 0, endMs: 120000, durationMs: 120000 });
    assert.equal(instrumentRender.fullTrack, true);
    assert.equal(instrumentRender.playbackTransform.rate, 1.25);
    assert.equal(instrumentRender.effects.reverb, 24);
    assert.deepEqual(instrumentRender.effects.eq, { enabled: false, hardClip: false, bands: [] },
      "Piano samples must receive the master EQ live, without baking it in twice");
    await host.locator(".brand-name").hover();
    await page.keyboard.down("q");
    await page.waitForFunction(() => window.drumStarts === 7);
    assert.equal(await page.evaluate(() => window.sourceStartArguments.at(-1)[1]), 12.345 / 1.25);
    await page.waitForFunction(() => window.masterEqualizers.some((eq) =>
      eq.input.context === window.lastSampleContext && eq.readSpectrum().values.some((db) => db > -90)));
    await page.keyboard.up("q");
    await page.keyboard.press("i");
    await page.waitForFunction(() => window.drumStarts === 8);
    assert.deepEqual(await page.evaluate(() => window.sourcePlaybackRates.slice(-2)), [1, 2],
      "Q/I must play the original loop and its upper octave without also triggering sampler pads.");
    const envelope = host.locator(".instrument-controls");
    assert.equal(await envelope.isVisible(), true);
    assert.equal(await host.locator(".sampler-body").isVisible(), false, "Fixed pads stay hidden in piano mode");
    assert.equal(await envelope.getByRole("slider").count(), 4);
    const attackKnob = envelope.getByRole("slider", { name: "Attack", exact: true });
    const graph = envelope.locator(".envelope-graph");
    for (const [target, tooltipOwner] of [
      [host.locator(".pitch-toggle"), host.locator(".pitch-label")],
      [graph, graph],
      ...await envelope.locator(".envelope-knob").all().then((knobs) => knobs.map((knob) => [knob, knob])),
    ]) {
      const help = await tooltipOwner.getAttribute("data-scdl-tooltip");
      await target.hover();
      await page.waitForFunction((text) => {
        const tip = document.querySelector("#scdl-fast-tooltip");
        return tip?.textContent === text && tip.style.visibility === "visible";
      }, help);
      assert.equal(await target.getAttribute("title"), null, "Custom tooltip targets must not show native titles");
    }
    assert.equal(await graph.locator("title").count(), 0, "The SVG must not expose a native title tooltip");
    const curveBefore = await graph.locator(".envelope-curve").getAttribute("d");
    await attackKnob.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await attackKnob.getAttribute("aria-valuenow"), "14");
    assert.notEqual(await graph.locator(".envelope-curve").getAttribute("d"), curveBefore);
    const graphBox = await graph.boundingBox();
    const releaseBox = await envelope.getByRole("slider", { name: "Release", exact: true }).boundingBox();
    assert.ok(graphBox.x > releaseBox.x + releaseBox.width, "Small graph sits beside the four knobs");
    assert.match(await host.locator(".drum-message").textContent(), /\+0/, "Knob arrows must not change octave");
    const attackBox = await attackKnob.boundingBox();
    await page.mouse.move(attackBox.x + attackBox.width / 2, attackBox.y + attackBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(attackBox.x + attackBox.width / 2, attackBox.y + attackBox.height / 2 - 30);
    await page.mouse.up();
    assert.ok(Number(await attackKnob.getAttribute("aria-valuenow")) > 14, "Dragging changes attack");
    const cutItself = host.getByRole("checkbox", { name: "Cut itself" });
    const adsrToggle = host.getByRole("checkbox", { name: "ADSR", exact: true });
    assert.equal(await adsrToggle.isChecked(), false);
    await adsrToggle.uncheck();
    assert.match(await envelope.getAttribute("class"), /is-bypassed/);
    const savedAttack = await attackKnob.getAttribute("aria-valuenow");
    await adsrToggle.check();
    assert.doesNotMatch(await envelope.getAttribute("class"), /is-bypassed/);
    assert.equal(await attackKnob.getAttribute("aria-valuenow"), savedAttack, "ADSR on/off preserves knob settings");
    assert.equal(await cutItself.isChecked(), true);
    await cutItself.uncheck();
    assert.equal(await cutItself.isChecked(), false);
    await cutItself.check();
    const cutLabel = host.locator(".instrument-cut-label");
    assert.equal((await cutLabel.textContent()).trim(), "", "Cut itself has no visible text label");
    const cutBox = await cutLabel.boundingBox();
    const adsrBox = await host.locator(".instrument-adsr-label").boundingBox();
    const currentGraphBox = await graph.boundingBox();
    assert.ok(cutBox.x >= currentGraphBox.x + currentGraphBox.width &&
      cutBox.x === adsrBox.x && adsrBox.y >= cutBox.y + cutBox.height &&
      cutBox.y >= currentGraphBox.y && adsrBox.y + adsrBox.height <= currentGraphBox.y + currentGraphBox.height,
      "Cut itself and ADSR checkboxes sit vertically beside the envelope graph");
    await cutItself.hover();
    await page.waitForFunction(() => document.querySelector("#scdl-fast-tooltip")?.textContent === "Cut itself" &&
      document.querySelector("#scdl-fast-tooltip")?.style.visibility === "visible");
    await adsrToggle.hover();
    await page.waitForFunction(() => document.querySelector("#scdl-fast-tooltip")?.textContent === "ADSR" &&
      document.querySelector("#scdl-fast-tooltip")?.style.visibility === "visible");
    await host.locator(".brand-name").hover();
    await page.screenshot({ path: path.join(projectRoot, "test-results", "sampler-adsr.png") });
    await instrumentToggle.focus();
    for (const locale of ["en", "es", "de", "ru", "pt_BR"]) {
      const messages = JSON.parse(fs.readFileSync(path.join(projectRoot, "_locales", locale, "messages.json"), "utf8"));
      const copy = { status: messages.piano_mode_status.message, help: messages.piano_mode_help.message };
      await page.evaluate((copy) => {
        document.documentElement.setAttribute("data-scdl-piano-copy", JSON.stringify(copy));
        document.dispatchEvent(new CustomEvent("scdl:extension-assets-ready"));
      }, copy);
      assert.equal(await host.locator(".drum-message").textContent(), copy.status.replace("{octave}", "+0"));
      await host.locator(".drum-message").hover();
      await page.waitForFunction(() => document.querySelector("#scdl-fast-tooltip")?.style.visibility === "visible");
      assert.equal(await page.locator("#scdl-fast-tooltip").textContent(), copy.help);
      await host.locator(".brand-name").hover();
    }
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(await instrumentToggle.getAttribute("aria-pressed"), "false");
    await host.locator(".sampler-body").waitFor({ state: "visible" });
    await envelope.waitFor({ state: "visible" });
    assert.equal(await cutItself.isVisible(), true);
    assert.equal(await adsrToggle.isVisible(), true);
    assert.equal(await host.locator(".sampler-body").isVisible(), true, "Leaving piano mode restores the fixed pads");
    assert.equal(await host.locator(".playing-note").textContent(), "");
    assert.equal(await host.locator(".drum-status").isVisible(), false,
      "An empty status row must not reserve space above the envelope controls");
    assert.equal(await panel.isVisible(), true, "Window blur must leave the panel visible while disabling piano mode.");
    await instrumentToggle.click();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector(".loop-instrument")?.getAttribute("aria-pressed") === "true");
    assert.equal(await page.evaluate(() => window.instrumentPauseCalls), 1,
      "Reactivating a cached instrument must leave an already paused source alone.");
    const startsBeforePunctuation = await page.evaluate(() => window.drumStarts);
    for (const key of ["Comma", "Period", "Shift+Slash"]) await page.keyboard.press(key);
    await page.waitForFunction((starts) => window.drumStarts === starts + 3, startsBeforePunctuation);
    const punctuationRates = await page.evaluate(() => window.sourcePlaybackRates.slice(-3));
    for (const [index, semitones] of [0, 2, 4].entries()) {
      assert.ok(Math.abs(punctuationRates[index] - 2 ** (semitones / 12)) < 1e-6);
    }
    await page.keyboard.press("Escape");
    const startsBeforeOctaves = await page.evaluate(() => window.drumStarts);
    await instrumentToggle.click();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control")?.shadowRoot
      ?.querySelector(".loop-instrument")?.getAttribute("aria-pressed") === "true");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("q");
    await page.waitForFunction((n) => window.drumStarts === n + 1, startsBeforeOctaves);
    assert.equal(await page.evaluate(() => window.sourcePlaybackRates.at(-1)), 0.5);
    assert.match(await host.locator(".drum-message").textContent(), /-1/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("q");
    await page.waitForFunction((n) => window.drumStarts === n + 2, startsBeforeOctaves);
    assert.equal(await page.evaluate(() => window.sourcePlaybackRates.at(-1)), 2);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { window.instrumentSourcePaused = false; });
    await instrumentToggle.click();
    await page.waitForFunction(() => window.instrumentPauseCalls === 2);
    assert.match(await host.locator(".drum-message").textContent(), /\+0/);
    assert.equal(await page.evaluate(() => window.instrumentRenderRequests.length), 1,
      "Cached activation must pause playback without rendering again.");
    await page.keyboard.press("Escape");
    await page.locator("audio").evaluate((audio) => {
      delete audio.paused;
      audio.pause = window.originalAudioPause;
    });
    await page.keyboard.press(originalPadKeys[0].toLowerCase());
    await page.waitForFunction(() => window.drumStarts === 14);
    await instrumentToggle.click();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".loop-instrument").getAttribute("aria-pressed") === "true");
    const editSampleTime = async (marker, time, expectedMs) => {
      await host.locator(`.loop-${marker}-time`).evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("blur"));
      }, time);
      await page.waitForFunction(({ marker, expectedMs }) => JSON.parse(document.documentElement.getAttribute("data-scdl-loop-session"))[`${marker}Ms`] === expectedMs, { marker, expectedMs });
    };
    await editSampleTime("end", "00:40.000", 40000);
    await editSampleTime("start", "00:30.000", 30000);
    assert.equal(await instrumentToggle.getAttribute("aria-pressed"), "true", "Moving outside the original sample must keep piano mode active");
    await adsrToggle.uncheck();
    await page.keyboard.press("e");
    await page.waitForTimeout(250);
    assert.equal(await host.locator(".playing-note").textContent(), "E5", "ADSR off lets a quick tap keep playing after keyup");
    await adsrToggle.check();
    await page.waitForFunction(() => document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".playing-note").textContent === "");
    await instrumentToggle.focus();
    const startsBeforeLiveEdit = await page.evaluate(() => window.drumStarts);
    await page.keyboard.down("q");
    await page.waitForFunction((n) => window.drumStarts > n, startsBeforeLiveEdit);
    assert.equal(await page.evaluate(() => window.sourceStartArguments.at(-1)[1]), 24);
    await editSampleTime("start", "00:31.000", 31000);
    await page.waitForFunction((n) => window.drumStarts > n + 1, startsBeforeLiveEdit);
    assert.ok(await page.evaluate(() => window.sourceStartArguments.at(-1)[1] >= 24.8), "Held note follows the edited sample start");
    const startsBeforeEndEdit = await page.evaluate(() => window.drumStarts);
    await editSampleTime("end", "00:41.000", 41000);
    assert.equal(await page.evaluate(() => window.drumStarts), startsBeforeEndEdit, "Editing only the end must not restart the held note");
    await page.keyboard.up("q");
    assert.equal(await page.evaluate(() => window.instrumentRenderRequests.length), 1, "Live sample edits reuse the prepared track");
    await editSampleTime("start", "00:12.345", 12345);
    await editSampleTime("end", "00:20.678", 20678);
    await page.keyboard.press("Escape");
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
      loopDownload?.playbackTransform?.preservePitch !== true ||
      !loopDownload?.effects?.eq
    ) {
      throw new Error(`Loop WAV download must keep exporting only A/B at the active speed and pitch: ${JSON.stringify(loopDownload)}`);
    }
    await host.locator(".download-track-button").click();
    const masterDownloadWithLoop = await page.evaluate(() => window.trackDownloadRequests.at(-1));
    if (
      await page.evaluate(() => window.trackDownloadRequests.length) !== 2 ||
      Object.hasOwn(masterDownloadWithLoop || {}, "trimRange") ||
      masterDownloadWithLoop?.playbackTransform?.rate !== 1.25 ||
      masterDownloadWithLoop?.playbackTransform?.preservePitch !== true ||
      !masterDownloadWithLoop?.effects?.eq
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

    await page.locator("audio").evaluate((audio) => audio.pause());
    await host.evaluate((element) => {
      const root = element.shadowRoot;
      const canvas = root.querySelector(".waveform-canvas");
      const context = canvas.getContext("2d");
      window.waveformIdleMetrics = { draws: 0, mutations: 0, originalClear: context.clearRect };
      context.clearRect = function (...args) {
        window.waveformIdleMetrics.draws += 1;
        return window.waveformIdleMetrics.originalClear.apply(this, args);
      };
      const observer = new MutationObserver((records) => { window.waveformIdleMetrics.mutations += records.length; });
      for (const target of root.querySelectorAll(".waveform-selection, .waveform-marker, .waveform-times, .waveform-actions, .loop-edit")) {
        observer.observe(target, { attributes: true, childList: true, characterData: true, subtree: true });
      }
      window.waveformIdleMetrics.observer = observer;
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.waveformIdleMetrics.draws = 0; window.waveformIdleMetrics.mutations = 0; });
    await page.waitForTimeout(1000);
    const idleMetrics = await page.evaluate(() => {
      const metrics = window.waveformIdleMetrics;
      metrics.observer.disconnect();
      const context = document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".waveform-canvas").getContext("2d");
      context.clearRect = metrics.originalClear;
      return { draws: metrics.draws, mutations: metrics.mutations };
    });
    assert.deepEqual(idleMetrics, { draws: 0, mutations: 0 },
      "Stable paused polling must not redraw the waveform or rewrite loop controls");

    const endMarker = host.locator(".waveform-end");
    await endMarker.scrollIntoViewIfNeeded();
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
    await waveformCanvas.scrollIntoViewIfNeeded();
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
        chevronAfterBypasses: rect('.effects-shell .tool-section-chevron').left >= rect('.effects-shell .tool-section-actions').right,
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
    const sectionToggles = host.locator('.sampler-toggle, .waveform-toggle, .effects-toggle, .peq-toggle');
    assert.equal(await sectionToggles.count(), 4, 'All four dropdowns must use the shared section header');
    assert.deepEqual(await sectionToggles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title'))),
      [null, null, null, null], 'Dropdown headers must not expose redundant tooltips');
    const samplerIcon = host.locator('.sampler-icon');
    await page.mouse.move(10, 10);
    const samplerFilter = await samplerIcon.evaluate((icon) => getComputedStyle(icon).filter);
    await host.locator('.sampler-toggle').hover();
    assert.notEqual(await samplerIcon.evaluate((icon) => getComputedStyle(icon).filter), samplerFilter,
      'The Sampler image icon must inherit the orange header hover treatment');
    const eqIcon = host.locator('.peq-icon');
    const eqFilter = await eqIcon.evaluate((icon) => getComputedStyle(icon).filter);
    await host.locator('.peq-toggle').hover();
    assert.notEqual(await eqIcon.evaluate((icon) => getComputedStyle(icon).filter), eqFilter,
      'The EQ image icon must inherit the orange header hover treatment');
    const visibility = host.locator('.visibility-button');
    for (const [selector, name] of [['.detach-icon', 'detach'], ['.trash-icon', 'trash']]) {
      const icon = host.locator(selector);
      assert.equal(await icon.getAttribute('src'), headerIconDataUrls[name], `${name} must load from its asset file`);
      assert.equal(await icon.isVisible(), true, `${name} icon must be visible`);
    }
    assert.equal(await visibility.getAttribute('data-state'), 'normal');
    assert.equal(await host.locator('.visibility-down-icon').isVisible(), true,
      'The normal state must use a downward chevron.');
    await visibility.click();
    await page.waitForFunction(() => [...document.querySelector("#scdl-tempo-control").shadowRoot
      .querySelectorAll('.sampler-toggle, .waveform-toggle, .effects-toggle, .peq-toggle')]
      .every((button) => button.getAttribute('aria-expanded') === 'false'));
    assert.deepEqual(await sectionToggles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-expanded'))),
      ['false', 'false', 'false', 'false']);
    assert.deepEqual(await sectionToggles.evaluateAll((buttons) => buttons.map((button) => {
      const buttonRect = button.getBoundingClientRect();
      const chevronRect = button.querySelector('.tool-section-chevron').getBoundingClientRect();
      return Math.round((chevronRect.top + chevronRect.bottom - buttonRect.top - buttonRect.bottom) * 10) / 10;
    })), [0, 0, 0, 0], 'Collapsed chevrons must remain vertically centered after rotation');
    assert.equal(await visibility.getAttribute('data-state'), 'collapsed');
    assert.equal(await host.locator('.visibility-up-icon').isVisible(), true,
      'The collapsed state must use the medium dash.');
    await visibility.click();
    assert.equal(await visibility.getAttribute('data-state'), 'hidden');
    assert.equal(await host.locator('.visibility-expand-icon').getAttribute('src'), headerIconDataUrls.expand,
      'The maximize state must load the expand asset');
    assert.equal(await host.locator('.visibility-expand-icon').isVisible(), true,
      'The maximize state must show the expand asset instead of a plus character');
    assert.equal(await host.locator('.visibility-up-icon').textContent(), '');
    assert.equal(await host.locator('.controls-hidden-message').isVisible(), true);
    assert.deepEqual(await host.locator('#scdl-sampler, #scdl-loop-region, #scdl-audio-effects, #scdl-parametric-eq').evaluateAll(
      (sections) => sections.map((section) => getComputedStyle(section).display)), ['none', 'none', 'none', 'none']);
    const singleColumnViewport = page.viewportSize();
    await page.setViewportSize({ width: 1100, height: 1000 });
    await visibility.click();
    assert.equal(await visibility.getAttribute('data-state'), 'grid');
    assert.equal(await host.locator('.visibility-grid-icon').isVisible(), true);
    await page.waitForTimeout(200);
    const gridRects = await host.locator('#scdl-sampler, #scdl-loop-region, #scdl-audio-effects, #scdl-parametric-eq').evaluateAll(
      sections => ['scdl-sampler', 'scdl-loop-region', 'scdl-audio-effects', 'scdl-parametric-eq'].map(id => {
        const { x, y, width, bottom } = sections.find(section => section.id === id).getBoundingClientRect();
        return { x, y, width, bottom };
      }));
    assert.ok(Math.abs(gridRects[0].y - gridRects[1].y) < 10, 'The first two sections share a flex row');
    assert.ok(gridRects[1].x > gridRects[0].x + gridRects[0].width, 'Sections occupy two separate columns');
    assert.ok(Math.abs(gridRects[2].x - gridRects[0].x) < 1, 'The third section wraps to the first column');
    assert.ok(Math.abs(gridRects[3].y - gridRects[1].bottom - 4) < 1, 'EQ sits immediately below Loop Region');
    assert.ok(Math.abs(gridRects[2].y - gridRects[0].bottom - 4) < 1, 'FX sits immediately below the sampler');
    assert.ok(Math.abs(gridRects[3].width - gridRects[1].width) < 1, 'EQ matches the Loop Region width');
    await page.screenshot({ path: path.join(projectRoot, 'test-results', 'controls-grid.png') });
    await page.setViewportSize({ width: 420, height: 1000 });
    const narrowSections = await host.locator('#scdl-sampler, #scdl-loop-region, #scdl-audio-effects, #scdl-parametric-eq').evaluateAll(
      sections => sections.map(section => ({ x: section.offsetLeft, width: section.offsetWidth, scroll: section.scrollWidth })));
    assert.ok(narrowSections.every(section => section.x === narrowSections[0].x && section.scroll <= section.width),
      'Narrow screens wrap to one column without section overflow');
    await page.setViewportSize(singleColumnViewport);
    await visibility.click();
    assert.equal(await visibility.getAttribute('data-state'), 'normal');
    assert.equal(await host.locator('.panel').evaluate(panel => panel.classList.contains('controls-grid')), false);
    const columnPositions = await host.locator('#scdl-sampler, #scdl-loop-region, #scdl-audio-effects, #scdl-parametric-eq').evaluateAll(
      sections => sections.map(section => section.getBoundingClientRect().x));
    assert.ok(columnPositions.every(x => Math.abs(x - columnPositions[0]) < 1), 'Exiting grid restores one column');
    await page.waitForFunction(() => [...document.querySelector("#scdl-tempo-control").shadowRoot
      .querySelectorAll('.sampler-toggle, .waveform-toggle, .effects-toggle, .peq-toggle')]
      .every((button) => button.getAttribute('aria-expanded') === 'true'));
    assert.deepEqual(await sectionToggles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-expanded'))),
      ['true', 'true', 'true', 'true']);
    await host.locator('.effects-toggle').click();
    await host.locator('.peq-toggle').click();
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
        bodyHidden: root.querySelector(".waveform-body").hidden,
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
      !collapsedLooper.bodyHidden ||
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
        loopImmediatelyBefore: Math.abs(shell.getBoundingClientRect().top - root.querySelector(".waveform-shell").getBoundingClientRect().bottom - 4) < 1,
      };
    });
    if (
      !collapsedFx.visible || !collapsedFx.collapsed ||
      collapsedFx.values.join("|") !== "0%|0%|0%|0%|0%|0%" || !collapsedFx.loopImmediatelyBefore
    ) {
      throw new Error(`FX section was not compactly placed below the looper: ${JSON.stringify(collapsedFx)}`);
    }
    await host.locator(".effects-toggle").click();
    const fxKnobLayout = await host.locator('.effect-knob-grid').evaluate(grid => {
      const knobs = [...grid.querySelectorAll('.fx-knob')].map(node => node.getBoundingClientRect());
      return knobs.length === 6 && knobs.every(box => Math.abs(box.y - knobs[0].y) < 1) && grid.scrollWidth <= grid.clientWidth;
    });
    assert.equal(fxKnobLayout, true, 'Six FX knobs share a horizontal row without overflow');
    const mixKnob = host.locator('#scdl-effect-reverb');
    assert.equal(await host.locator('.effect-settings-toggle').count(), 0);
    assert.equal(await mixKnob.getAttribute('title'), null);
    assert.match(await mixKnob.getAttribute('data-scdl-tooltip'), /Hold to open options/);
    await mixKnob.scrollIntoViewIfNeeded();
    const mixBox = await mixKnob.boundingBox();
    assert.equal(Math.round(mixBox.width + 2), 28, 'FX shell matches the 28px sampler knobs');
    await mixKnob.hover();
    await page.waitForTimeout(450);
    assert.match(await page.locator('#scdl-fast-tooltip').innerText(), /Hold to open options/);
    const initialMix = await mixKnob.inputValue();
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    assert.equal(await host.locator('[data-effect-settings-panel="reverb"]').isVisible(), true);
    assert.equal(await mixKnob.inputValue(), initialMix, 'Holding opens settings without changing the mix');
    await mixKnob.press('Enter');
    assert.equal(await host.locator('[data-effect-settings-panel="reverb"]').isVisible(), false);
    await page.mouse.move(mixBox.x + mixBox.width / 2, mixBox.y + mixBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(mixBox.x + mixBox.width / 2, mixBox.y + mixBox.height / 2 - 42, { steps: 5 });
    await page.waitForTimeout(600);
    assert.equal(await host.locator('[data-effect-settings-panel="reverb"]').isVisible(), false, 'Dragging cancels the hold gesture');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('[data-effect-value="reverb"]').textContent === '30%');
    assert.equal(await mixKnob.getAttribute('aria-valuetext'), '30%');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('[data-effect-value="reverb"]').textContent === '31%');
    await host.locator("#scdl-effect-reverb").evaluate((slider) => {
      slider.value = "35";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await host.locator("#scdl-effect-delay").evaluate((slider) => {
      slider.value = "28";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => [...document.querySelector("#scdl-tempo-control")?.shadowRoot?.querySelectorAll(".effect-value") || []]
      .map((value) => value.textContent).join("|") === "35%|28%|0%|0%|0%|0%");
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
      activeFx.expanded !== "true" || activeFx.values.join("|") !== "35%|28%|0%|0%|0%|0%" ||
      !activeFx.exportNoteAbsent || activeFx.status === "Play a track to activate FX."
    ) {
      throw new Error(`FX sliders or WAV notice failed: ${JSON.stringify(activeFx)}`);
    }
    await host.locator('[data-effect-settings="delay"]').press('Enter');
    await host.locator('#scdl-effect-delay-time').fill('400');
    await host.locator('#scdl-effect-delay-time').dispatchEvent('change');
    if (await host.locator('[data-effect-character-value="delayTime"]').textContent() !== '400ms') {
      throw new Error("FX character setting was reset while requesting authorization.");
    }
    assert.equal(await host.locator('#scdl-effect-delay-time').getAttribute('aria-valuetext'), '400ms');
    await host.locator('[data-effect-settings="reverb"]').press('Enter');
    const decayKnob = host.locator('#scdl-effect-reverb-decay');
    await decayKnob.fill('2.4');
    await decayKnob.dispatchEvent('change');
    await decayKnob.focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('[data-effect-character-value="reverbDecay"]').textContent === '2.5s');
    await host.locator('.effects-shell').screenshot({ path: path.join(projectRoot, 'test-results', 'fx-knobs.png') });
    await host.locator('[data-effect-settings="delay"]').press('Enter');
    await host.locator('[data-effect-settings="delay"]').press('Enter');
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
    await host.locator('#scdl-effect-delay').fill('48');
    await host.locator('#scdl-effect-delay').dispatchEvent('change');
    await host.locator('[data-effect-character="delayTime"]').evaluate((control) => {
      control.value = '500'; control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await host.locator('[data-effect-character="reverbRoom"]').evaluate((control) => {
      control.value = 'plate'; control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (!(await host.locator('.clear-rate').isVisible())) {
      throw new Error('Reset control must appear when any effect or playback setting is active.');
    }
    const globalVisibility = host.locator('.visibility-button');
    const padsBeforeReset = await drumPads.evaluateAll(pads => pads.map(pad => pad.title));
    if (await globalVisibility.getAttribute('data-state') === 'normal') await globalVisibility.click();
    if (await globalVisibility.getAttribute('data-state') === 'collapsed') await globalVisibility.click();
    assert.equal(await globalVisibility.getAttribute('data-state'), 'hidden');
    await page.evaluate(() => {
      window.accessResponseDelay = 120;
      window.failEffectsReset = true;
      const pitch = document.querySelector('#scdl-tempo-control').shadowRoot.querySelector('.pitch-toggle');
      pitch.checked = true;
      pitch.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await host.locator('.reset-tools-button').click();
    await page.waitForFunction(() => {
      const root = document.querySelector('#scdl-tempo-control')?.shadowRoot;
      const loop = JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session') || 'null');
      return loop?.active === false && root?.querySelector('.reset-tools-button')?.disabled === false;
    });
    await page.waitForTimeout(80);
    assert.equal(await host.locator('.pitch-toggle').isChecked(), false,
      'A pitch authorization started before reset must not restore stale state');
    assert.match(await host.locator('.status').textContent(), /synthetic FX reset failure/,
      'A failed FX reset must be reported after the independent loop cleanup completes');
    await page.evaluate(() => {
      window.accessResponseDelay = 0;
      window.failEffectsReset = false;
    });
    await host.locator('.reset-tools-button').click();
    await page.waitForFunction(() => {
      const host = document.querySelector('#scdl-tempo-control');
      const root = host?.shadowRoot;
      const loop = JSON.parse(document.documentElement.getAttribute('data-scdl-loop-session') || 'null');
      return root?.querySelector('.slider')?.value === '1' &&
        root?.querySelector('.pitch-toggle')?.checked === false &&
        root?.querySelector('#scdl-effect-reverb')?.value === '0' &&
        root?.querySelector('#scdl-effect-delay')?.value === '0' &&
        root?.querySelector('[data-effect-character="delayTime"]')?.value === '250' &&
        root?.querySelector('[data-effect-character="reverbRoom"]')?.value === 'hall' &&
        loop?.active === false &&
        root?.querySelector('.clear-rate')?.hidden === true &&
        root?.querySelector('.visibility-button')?.dataset.state === 'hidden';
    }, null, { timeout: 4_000 }).catch(async () => {
      const state = await host.evaluate((element) => {
        const root = element.shadowRoot;
        return {
          rate: root.querySelector('.slider')?.value,
          pitch: root.querySelector('.pitch-toggle')?.checked,
          reverb: root.querySelector('#scdl-effect-reverb')?.value,
          delay: root.querySelector('#scdl-effect-delay')?.value,
          delayTime: root.querySelector('[data-effect-character="delayTime"]')?.value,
          room: root.querySelector('[data-effect-character="reverbRoom"]')?.value,
          clearHidden: root.querySelector('.clear-rate')?.hidden,
          visibility: root.querySelector('.visibility-button')?.dataset.state,
          status: root.querySelector('.status')?.textContent,
        };
      });
      throw new Error(`Global reset did not settle: ${JSON.stringify(state)}`);
    });
    assert.deepEqual(await drumPads.evaluateAll(pads => pads.map(pad => pad.title)), padsBeforeReset,
      'Global reset must preserve custom Sampler assignments');
    await globalVisibility.click();
    await host.locator('.peq-toggle').click();

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
    await host.locator(".peq-toggle").click();
    assert.equal(await host.locator(".peq-icon").evaluate((icon) => icon.complete && icon.naturalWidth > 0), true,
      "The EQ header must load its packaged icon");
    assert.equal(await host.locator(".peq .tool-section-chevron").count(), 1);
    await host.locator(".peq-canvas").dblclick({ position: { x: 180, y: 130 } });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.bands[0]?.gain < 0);
    await host.locator(".peq-canvas").dblclick({ position: { x: 300, y: 55 } });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.bands[1]?.gain > 0);
    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(projectRoot, "test-results", "parametric-eq.png") });
    await host.locator(".peq-header-bypass").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.enabled === false);
    await host.locator(".peq-clip").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("scdl.parametric-eq.v1"))?.hardClip === true);

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
        type: "OFFSCREEN_PAD_RENDER", operationId: "pad_integration_001", buildId: "track_pad_integration", index: 5,
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
    const renderedInstrument = await page.evaluate(async () => {
      const result = await window.sendOffscreenTest({
        type: "OFFSCREEN_INSTRUMENT_RENDER", operationId: "instrument_integration_001", buildId: "track_instrument_integration",
        name: "Rendered Instrument", streamUrl: `${location.origin}/assets/drums/tom1.wav`,
        trackData: { streamProtocol: "progressive", durationMs: 420, title: "Tom", artist: "Test" },
        trimRange: { startMs: 0, endMs: 200 },
        playbackTransform: { rate: 1, preservePitch: false },
        effects: {},
      });
      if (!result.success) return result;
      const bytes = await (await fetch(result.instrument.dataUrl)).arrayBuffer();
      return {
        success: true,
        name: result.instrument.name,
        signature: String.fromCharCode(...new Uint8Array(bytes.slice(0, 4))),
        bytes: bytes.byteLength,
      };
    });
    assert.equal(renderedInstrument.success, true, renderedInstrument.error);
    assert.equal(renderedInstrument.name, "Rendered Instrument");
    assert.equal(renderedInstrument.signature, "RIFF");
    assert.ok(renderedInstrument.bytes > 1000);
    const fullInstrument = await page.evaluate(async () => {
      const operationId = "instrument_full_transfer_integration";
      const result = await window.sendOffscreenTest({
        type: "OFFSCREEN_INSTRUMENT_RENDER", operationId, fullTrack: true,
        streamUrl: `${location.origin}/assets/drums/tom1.wav`,
        trackData: { streamProtocol: "progressive", durationMs: 420, title: "Tom", artist: "Test" },
        trimRange: { startMs: 100, endMs: 200 }, playbackTransform: { rate: .5, preservePitch: false }, effects: {},
      });
      if (!result.success) return result;
      const parts = [];
      for (let offset = 0; offset < result.instrument.byteLength;) {
        const part = await window.sendOffscreenTest({ type: "OFFSCREEN_INSTRUMENT_READ", operationId, offset });
        if (!part.success) return part;
        parts.push(await (await fetch(part.chunk.dataUrl)).arrayBuffer());
        offset += part.chunk.byteLength;
      }
      const context = new AudioContext();
      const original = await context.decodeAudioData(await (await fetch(`${location.origin}/assets/drums/tom1.wav`)).arrayBuffer());
      const decoded = await context.decodeAudioData(await new Blob(parts).arrayBuffer());
      await context.close();
      return { success: true, originalDuration: original.duration, duration: decoded.duration };
    });
    assert.equal(fullInstrument.success, true, fullInstrument.error);
    assert.ok(Math.abs(fullInstrument.duration - fullInstrument.originalDuration * 2) < .002,
      "Full-track transfer must retain audio outside the initial selection at the prepared speed");
    await page.reload();
    const persistedName = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("scdl-player-pads", 2);
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
        plan: "pro", state: "pro", capabilities: { freeEffects: true, premiumEffects: true, saveLoopPad: true, loopInstrument: true, tempo: true, parametricEq: true },
      }));
    });
    for (const file of ["tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "tempo-control-main.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    await host.locator(".trigger").click();
    await host.locator(".peq-toggle").click();
    assert.equal(await host.locator(".peq-point").count(), 2, "EQ points must survive reload");
    assert.equal(await host.locator(".peq-headroom").count(), 0);
    assert.equal(await host.locator(".peq-fields").count(), 0);
    assert.equal(await host.locator(".peq-hint").count(), 0);
    assert.equal(await host.locator(".peq-header-bypass").getAttribute("aria-pressed"), "true", "EQ bypass must survive reload");
    assert.equal(await host.locator(".peq-header-bypass").getAttribute("aria-pressed"), "true", "EQ header bypass must match");
    assert.equal(await host.locator(".peq-clip").getAttribute("aria-pressed"), "true", "Hard clip must survive reload");
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
