const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const server = http.createServer((req, res) => {
    if (/^\/assets\/drums\/(kick1|kick2|clap1|clap2|hat1|hat2|snare1|tom1)\.wav$/.test(req.url)) {
      res.setHeader("Content-Type", "audio/wav");
      res.end(fs.readFileSync(path.join(__dirname, "..", req.url))); return;
    }
    if (req.url === "/record-processor.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(__dirname, "record-processor.js")));
    } else res.end('<!doctype html><style>body{background:#111;padding:30px;font:12px system-ui}#tools{width:380px}</style><div id="tools"></div>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["owned", "shared", "constructor", "free"]) {
      const page = await browser.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      for (const file of ["parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "record-core.js", "record-ui.js"]) {
        await page.addScriptTag({ path: path.join(__dirname, file) });
      }
      const result = await page.evaluate(async mode => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.documentElement.setAttribute("data-scdl-extension-record-worklet-url", `${location.origin}/record-processor.js`);
        const rate = 48000;
        const channels = [new Float32Array(rate), new Float32Array(rate)];
        for (let i = 0; i < rate; i++) channels[0][i] = channels[1][i] = .2 * Math.sin(i * Math.PI * 2 * 400 / rate);
        const url = URL.createObjectURL(SCRecord.encodeWav([channels], rate, rate));
        const player = new Audio(url); player.loop = true; await player.play();
        let site;
        if (["shared", "constructor"].includes(mode)) {
          site = new AudioContext();
          const source = mode === "shared" ? site.createMediaElementSource(player) : new MediaElementAudioSourceNode(site, { mediaElement: player });
          source.connect(site.destination);
        }
        let active = player;
        const effects = SCTempoEffects.create({ getActiveAudio: () => active });
        effects.setEqualizerAllowed(mode !== "free");
        effects.setEqualizer({ enabled: true, bands: [{ frequency: 400, gain: -12, q: 8 }] });
        const context = effects.getPlaybackContext();
        // A stereo sampler voice travels through the same destination/EQ route.
        const pad = context.createOscillator(); pad.frequency.value = 1200;
        const volume = context.createGain(); volume.gain.value = .1;
        const pan = context.createStereoPanner(); pan.pan.value = 1;
        pad.connect(volume).connect(pan).connect(context.destination); pad.start();
        const recorder = SCRecord.create({ effects });
        await recorder.start(); await sleep(800); await recorder.stop();
        const blob = recorder.exportWav();
        const bytes = await blob.arrayBuffer(), header = new DataView(bytes);
        const decoded = await context.decodeAudioData(bytes.slice(0));
        function amplitude(buffer, channel, hz) {
          const data = buffer.getChannelData(channel);
          const start = Math.floor(buffer.sampleRate * .2), end = Math.min(data.length, start + Math.floor(buffer.sampleRate * .3));
          let re = 0, im = 0;
          for (let i = start; i < end; i++) { re += data[i] * Math.cos(i * 2 * Math.PI * hz / buffer.sampleRate); im += data[i] * Math.sin(i * 2 * Math.PI * hz / buffer.sampleRate); }
          return 2 * Math.hypot(re, im) / (end - start);
        }
        const track = amplitude(decoded, 0, 400), padLeft = amplitude(decoded, 0, 1200), padRight = amplitude(decoded, 1, 1200);
        const state = recorder.snapshot();
        await recorder.play(); await sleep(80); const playing = recorder.snapshot().state;
        recorder.stopPreview(); const position = recorder.position();
        const afterPreview = new Uint8Array(await recorder.exportWav().arrayBuffer());
        if (afterPreview.length !== bytes.byteLength || afterPreview.some((value, i) => value !== new Uint8Array(bytes)[i])) {
          throw new Error('Preview must preserve every captured sample for WAV export');
        }
        if (Math.abs(recorder.sampleAt(2049, 0) - decoded.getChannelData(0)[2049]) > .001) {
          throw new Error('Waveform samples must survive preview PCM compaction');
        }
        recorder.seek(.3); const seek = recorder.position();
        // A context replacement during the take must add the new track while old pads keep sounding.
        await recorder.start();
        const replacement = new Audio(url); replacement.loop = true;
        const nextContext = new AudioContext({ sampleRate: 44100 });
        nextContext.createMediaElementSource(replacement).connect(nextContext.destination);
        player.pause(); active = replacement; await replacement.play(); effects.applyToActive();
        await sleep(850); await recorder.stop();
        const replaced = await context.decodeAudioData(await recorder.exportWav().arrayBuffer());
        const replacementTrack = amplitude(replaced, 0, 400), oldPad = amplitude(replaced, 1, 1200);
        recorder.clear(); const cleared = recorder.snapshot().frames;
        recorder.dispose(); pad.stop(); player.pause(); replacement.pause();
        await nextContext.close(); await context.close(); URL.revokeObjectURL(url);
        return { track, padLeft, padRight, replacementTrack, oldPad, state, playing, position, seek, cleared,
          channels: decoded.numberOfChannels, bits: header.getUint16(34, true), dataSize: header.getUint32(40, true), bytes: bytes.byteLength };
      }, mode);
      assert.ok(result.track > (mode === "free" ? .17 : .04) && result.track < (mode === "free" ? .23 : .065), `${mode}: capture must contain post-EQ track: ${JSON.stringify(result)}`);
      assert.ok(result.padLeft < .002 && result.padRight > .085, `${mode}: stereo sampler must be included once`);
      assert.ok(result.oldPad > .085 && result.replacementTrack > .04, `${mode}: old and new contexts must be mixed`);
      assert.equal(result.channels, 2); assert.equal(result.bits, 16);
      assert.equal(result.dataSize, result.bytes - 44);
      assert.ok(result.state.duration > .6 && result.state.duration < 1.2);
      assert.equal(result.playing, "playing"); assert.ok(result.position > .03);
      assert.equal(result.seek, .3); assert.equal(result.cleared, 0);
      assert.deepEqual(errors, []);
      console.log(`Record ${mode}: post-EQ track, stereo pads, context replacement, WAV and preview passed.`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 460, height: 400 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const file of ["parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "record-core.js", "record-ui.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    const icon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, "../assets/icons/record.svg")).toString("base64")}`;
    await page.evaluate(icon => {
      document.documentElement.setAttribute("data-scdl-extension-record-url", icon);
      document.documentElement.setAttribute("data-scdl-extension-record-worklet-url", `${location.origin}/record-processor.js`);
      const effects = SCTempoEffects.create();
      const context = effects.getPlaybackContext();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 150; gain.gain.value = .35;
      oscillator.connect(gain).connect(context.destination); oscillator.start();
      window.recordUI = SCRecordUI.mount({ container: document.querySelector("#tools"), effects });
      recordUI.setVisible(true);
    }, icon);
    await page.locator(".record-toggle").click();
    assert.equal(await page.locator(".record-icon").evaluate(icon => icon.complete && icon.naturalWidth > 0), true);
    await page.locator(".record-start").click();
    await page.waitForTimeout(250);
    await page.locator(".record-toggle").click();
    await page.waitForTimeout(350);
    await page.locator(".record-toggle").click();
    await page.locator(".record-stop").click();
    await page.waitForFunction(() => !document.querySelector(".record-download").disabled);
    const downloadEvent = page.waitForEvent("download");
    await page.locator(".record-download").click();
    const download = await downloadEvent;
    const wav = fs.readFileSync(await download.path());
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.ok(wav.length > 48000, "Collapsing must not stop recording");
    await page.locator(".record-play").click();
    await page.waitForTimeout(90);
    assert.equal(await page.locator(".record-play").getAttribute("aria-label"), "Pause recorded sample");
    await page.locator(".record-stop").click();
    assert.equal(await page.locator(".record-zoom, .record-scroll, .record-message").count(), 0);
    assert.match(await page.locator(".record-download").getAttribute("title"), /Up to 5 minutes per take\. Download to keep your sample\.$/);
    const canvas = page.locator(".record-canvas");
    await canvas.focus(); await page.keyboard.press("Home");
    assert.equal(await canvas.getAttribute("aria-valuenow"), "0");
    await canvas.hover();
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => document.querySelector(".record-canvas").classList.contains("is-zoomed"));
    const rect = await canvas.boundingBox();
    const position = async () => Number(await canvas.getAttribute("aria-valuenow"));
    const clickLeft = () => canvas.click({ position: { x: rect.width * .1, y: rect.height / 2 } });
    await clickLeft();
    const zoomedPosition = await position();
    const duration = Number(await canvas.getAttribute("aria-valuemax"));
    assert.ok(zoomedPosition > duration * .2, "Wheel zoom must stay anchored at the pointer");
    await page.mouse.move(rect.x + rect.width * .65, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.equal(await position(), zoomedPosition, "Dragging the view must not seek the recording");
    await clickLeft();
    const pannedPosition = await position();
    assert.ok(pannedPosition > zoomedPosition, "Dragging left must reveal later audio");
    await page.keyboard.down("Shift"); await page.mouse.wheel(0, -180); await page.keyboard.up("Shift");
    await page.waitForTimeout(60);
    await clickLeft();
    assert.ok(await position() < pannedPosition, "Shift + wheel must scroll independently of zoom");
    await page.keyboard.press("0");
    await clickLeft();
    assert.ok(Math.abs(await position() / duration - .1) < .01, "Reset must restore the full sample view");
    await page.keyboard.press("Home");
    assert.equal(await canvas.getAttribute("aria-valuenow"), "0");
    fs.mkdirSync(path.join(__dirname, "../test-results"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../test-results/record-panel.png") });
    await page.locator(".record-clear").click();
    assert.equal(await page.locator(".record-download").isDisabled(), true);
    console.log("Record UI: collapse while recording, WAV download, transport, zoom, keyboard seek and clear passed.");
    await page.close();

    // Mount the actual Player Tools adapter and capture a real built-in pad.
    const integrated = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const integrationErrors = [];
    integrated.on("pageerror", error => integrationErrors.push(error.message));
    await integrated.goto(`http://127.0.0.1:${server.address().port}`);
    await integrated.evaluate(icon => {
      document.body.innerHTML = '<div class="playControls__elements" style="position:fixed;bottom:0;left:0;display:flex;width:100%;height:48px"><div class="playControls__soundBadge"></div></div>';
      const attrs = {
        "record-url": icon, "eq-url": icon,
        "record-worklet-url": `${location.origin}/record-processor.js`,
        "drum-samples-url": `${location.origin}/assets/drums/`,
      };
      for (const [key, value] of Object.entries(attrs)) document.documentElement.setAttribute(`data-scdl-extension-${key}`, value);
      const snapshot = { revision: 1, state: "pro", plan: "pro", capabilities: Object.fromEntries([
        "tempo", "openPanel", "parametricEq", "freeEffects", "premiumEffects", "maximizeLooper", "preservePitch", "savePreset", "loopInstrument",
      ].map(key => [key, true])) };
      document.documentElement.setAttribute("data-scdl-player-tools-access", JSON.stringify(snapshot));
      document.addEventListener("scdl:player-tools-request", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-player-tools-request"));
        document.documentElement.setAttribute("data-scdl-player-tools-response", JSON.stringify({ id: request.id, success: true, allowed: true, snapshot }));
        document.dispatchEvent(new Event("scdl:player-tools-response"));
      });
      window.addEventListener("message", ({ data }) => {
        if (data?.source === "scdl-pad-main" && data.action === "list") window.postMessage({ source: "scdl-pad-content", id: data.id, result: { success: true, pads: [] } }, location.origin);
      });
    }, icon);
    for (const file of ["tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "record-core.js", "record-ui.js", "tempo-control-main.js"]) {
      await integrated.addScriptTag({ path: path.join(__dirname, file) });
    }
    const host = integrated.locator("#scdl-tempo-control");
    await integrated.evaluate(() => document.dispatchEvent(new Event("scdl:open-player-tools-panel")));
    await host.locator(".sampler-toggle").click();
    await host.locator(".record-toggle").click();
    assert.equal(await host.locator(".record-section").evaluate(section => section.previousElementSibling.classList.contains("effects-shell")), true);
    await host.locator(".record-start").click();
    await integrated.waitForTimeout(120);
    await host.locator('.drum-pad[data-drum-index="0"]').click();
    await integrated.waitForTimeout(350);
    await host.locator('.drum-pad[data-drum-index="1"]').click();
    await integrated.waitForTimeout(350);
    await host.locator(".record-stop").click();
    await integrated.waitForFunction(() => !document.querySelector("#scdl-tempo-control").shadowRoot.querySelector(".record-download").disabled);
    const integratedDownload = integrated.waitForEvent("download");
    await host.locator(".record-download").click();
    const recorded = fs.readFileSync(await (await integratedDownload).path());
    let peak = 0;
    for (let i = 44; i < recorded.length; i += 2) peak = Math.max(peak, Math.abs(recorded.readInt16LE(i)));
    assert.ok(peak > 1000, "Actual sampler pads must be audible in the recorded WAV");
    const visibility = host.locator(".visibility-button");
    await visibility.click();
    assert.equal(await host.locator(".record-toggle").getAttribute("aria-expanded"), "false");
    await visibility.click();
    assert.equal(await host.locator(".record-section").isHidden(), true);
    await visibility.click();
    const rects = await host.evaluate(element => [".effects-shell", ".record-section"].map(selector => {
      const r = element.shadowRoot.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom };
    }));
    assert.ok(Math.abs(rects[0].x - rects[1].x) < 1 && Math.abs(rects[1].y - rects[0].bottom - 4) < 1, "Record must follow FX in the two-column layout");
    await integrated.screenshot({ path: path.join(__dirname, "../test-results/record-player-tools.png") });
    await integrated.setViewportSize({ width: 420, height: 1000 });
    assert.equal(await host.locator(".record-section").evaluate(section => section.scrollWidth <= section.clientWidth), true, "Record must fit narrow layouts");
    await integrated.setViewportSize({ width: 1100, height: 1000 });
    for (const toggle of await host.locator(".tool-section-toggle").all()) {
      if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
    }
    const columnIds = () => host.evaluate(element => [...element.shadowRoot.querySelectorAll(".controls-column")]
      .map(column => [...column.children].map(section => section.id)));
    const dragSection = async (source, target, { cancel = false } = {}) => {
      await host.locator(`${source} .tool-section-toggle`).hover({ position: { x: 60, y: 12 } });
      const from = await host.locator(`${source} .tool-section-toggle`).boundingBox();
      const to = await host.locator(`${target} .tool-section-toggle`).boundingBox();
      await integrated.mouse.move(from.x + 60, from.y + from.height / 2);
      await integrated.mouse.down();
      await integrated.mouse.move(to.x + 60, to.y + 3, { steps: 8 });
      assert.equal(await host.locator(".section-drop-marker").isVisible(), true, JSON.stringify(await host.evaluate(element => {
        const root = element.shadowRoot, marker = root.querySelector(".section-drop-marker");
        return { layout: root.querySelector(".controls-layout").className, marker: marker?.outerHTML, bounds: root.querySelector(".controls-layout").getBoundingClientRect().toJSON() };
      })));
      if (cancel) await integrated.keyboard.press("Escape");
      await integrated.mouse.up();
    };
    await dragSection("#scdl-record", "#scdl-sampler");
    assert.deepEqual((await columnIds())[0], ["scdl-record", "scdl-sampler", "scdl-audio-effects"]);
    assert.equal(await host.locator(".record-toggle").getAttribute("aria-expanded"), "false", "Dragging must not toggle the disclosure");
    await host.locator(".record-toggle").click();
    assert.equal(await host.locator(".record-toggle").getAttribute("aria-expanded"), "true", "The next normal click must still expand Record");
    assert.equal(await host.locator(".record-download").isEnabled(), true, "Reordering must retain the recorded take");
    await host.locator(".record-toggle").click();
    await dragSection("#scdl-record", "#scdl-parametric-eq");
    assert.deepEqual(await columnIds(), [["scdl-sampler", "scdl-audio-effects"], ["scdl-loop-region", "scdl-record", "scdl-parametric-eq"]]);
    const beforeCancel = await columnIds();
    await dragSection("#scdl-record", "#scdl-sampler", { cancel: true });
    assert.deepEqual(await columnIds(), beforeCancel, "Escape must cancel a move");
    assert.equal(await host.locator(".panel").isVisible(), true, "Cancelling a drag must not close Player Tools");
    await host.locator(".peq-bypass").click();
    assert.equal(await host.locator(".peq-bypass").getAttribute("aria-pressed"), "true", "Header actions must retain their click handlers");
    assert.equal(await host.locator(".peq-toggle").getAttribute("aria-expanded"), "false");
    await integrated.setViewportSize({ width: 420, height: 1000 });
    await dragSection("#scdl-record", "#scdl-sampler");
    const visualOrder = () => host.locator(".controls-column > section").evaluateAll(sections => sections
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(section => section.id));
    assert.equal((await visualOrder())[0], "scdl-record", "Dragging must also reorder the narrow/single column layout");
    const savedOrder = await visualOrder();
    await integrated.screenshot({ path: path.join(__dirname, "../test-results/controls-reordered.png") });
    await integrated.reload();
    for (const file of ["tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "record-core.js", "record-ui.js"]) {
      await integrated.addScriptTag({ path: path.join(__dirname, file) });
    }
    await integrated.evaluate(() => {
      document.body.innerHTML = '<div class="playControls__elements" style="position:fixed;bottom:0;display:flex;height:48px"><div class="playControls__soundBadge"></div></div>';
    });
    await integrated.addScriptTag({ path: path.join(__dirname, "tempo-control-main.js") });
    await integrated.evaluate(() => document.dispatchEvent(new Event("scdl:open-player-tools-panel")));
    assert.deepEqual(await visualOrder(), savedOrder, "Saved order must survive a page reload");
    assert.deepEqual(integrationErrors, []);
    console.log("Player Tools integration: pads recorded, collapse/hide, responsive layout, drag between columns, preserved clicks/take, Escape and saved order passed.");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
