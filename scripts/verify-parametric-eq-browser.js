const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["owned", "shared", "constructor"]) {
      const page = await browser.newPage();
      await page.goto("about:blank");
      for (const file of ["parametric-eq.js", "audio-effects-core.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
      const result = await page.evaluate(async (mode) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const bytes = new ArrayBuffer(44 + 48000 * 2);
        const view = new DataView(bytes);
        const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
        text(8, "WAVEfmt "); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, "data"); view.setUint32(40, 96000, true);
        for (let i = 0; i < 48000; i++) view.setInt16(44 + i * 2, Math.sin(i * Math.PI * 2 * 1000 / 48000) * 5000, true);
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        const player = new Audio(url);
        player.loop = true;
        await player.play();
        let siteSource, siteContext, volume, meter;
        if (mode !== "owned") {
          siteContext = new AudioContext();
          siteSource = mode === "constructor" ? new MediaElementAudioSourceNode(siteContext, { mediaElement: player }) : siteContext.createMediaElementSource(player);
          volume = siteContext.createGain(); volume.gain.value = 0.25;
          meter = siteContext.createAnalyser();
          siteSource.connect(volume); volume.connect(meter); meter.connect(siteContext.destination);
        } else {
          const native = AudioContext.prototype.createMediaElementSource;
          AudioContext.prototype.createMediaElementSource = function (audio) {
            const source = native.call(this, audio);
            siteContext = this; siteSource = source;
            return source;
          };
        }
        let active = player;
        const fx = SCTempoEffects.create({ getActiveAudio: () => active });
        fx.setEqualizerAllowed(true);
        fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: 0, q: 1 }] });
        if (!meter) {
          meter = siteContext.createAnalyser();
          siteSource.connect(meter);
        }
        const rms = () => { const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length); };
        await sleep(250);
        const base = rms();
        fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: 6, q: 2 }] });
        await sleep(300);
        const boost = rms();
        fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: -12, q: 2 }] });
        await sleep(300);
        const cut = rms();
        const eqGraph = fx.analyseEqualizer();
        const response = eqGraph.response(new Float32Array([1000]))[0];
        const hasSpectrum = eqGraph.readSpectrum().values.some((db) => db > -70);
        fx.setBypassed(true); await sleep(300); const bypass = rms();
        fx.setBypassed(false); await sleep(300); const restored = rms();
        fx.setEqualizerAllowed(false); await sleep(300); const revoked = rms();
        fx.setEqualizerAllowed(true); await sleep(300);
        let muted = null, reconnect = null;
        if (volume) {
          volume.gain.value = 0; await sleep(150); muted = rms();
          volume.gain.value = 0.25;
          siteSource.disconnect(volume); await sleep(150);
          siteSource.connect(volume); await sleep(150); reconnect = rms();
        }
        // An SPA replacement must receive the saved EQ without another gesture.
        player.pause();
        const replacement = new Audio(url); replacement.loop = true; await replacement.play();
        active = replacement; fx.applyToActive(); await sleep(150);
        const replacementResponse = fx.analyseEqualizer().response(new Float32Array([1000]))[0];
        replacement.pause(); player.pause(); await siteContext.close(); URL.revokeObjectURL(url);
        return { base, boost, cut, bypass, restored, revoked, response, replacementResponse, hasSpectrum, muted, reconnect };
      }, mode);
      assert.ok(result.base > 0.001, `${mode}: fixture must be audible`);
      const db = (value) => 20 * Math.log10(value / result.base);
      assert.ok(Math.abs(db(result.boost) - 6) < 0.6, `${mode}: +6 dB boost must not be reduced by automatic headroom`);
      assert.ok(Math.abs(db(result.cut) + 12) < 0.6, `${mode}: dry signal was not cut by 12 dB: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(db(result.bypass)) < 0.2, `${mode}: bypass must restore unity`);
      assert.ok(Math.abs(db(result.revoked)) < 0.2, `${mode}: revoked EQ must restore unity`);
      assert.ok(Math.abs(db(result.restored) + 12) < 0.6);
      assert.ok(Math.abs(result.response + 12) < 0.1);
      assert.ok(Math.abs(result.replacementResponse + 12) < 0.1);
      assert.ok(result.hasSpectrum);
      if (mode !== "owned") {
        assert.ok(result.muted < 1e-6, "Site mute must remain effective");
        assert.ok(Math.abs(db(result.reconnect) + 12) < 0.6, "Site reconnect must preserve EQ");
      }
      console.log(`Parametric EQ audio: ${mode}, cut ${db(result.cut).toFixed(2)} dB; bypass, revocation, SPA and spectrum passed.`);
      await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 420, height: 550 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://soundcloud.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<div id="container" style="width:380px"></div>' }));
    await page.goto("https://soundcloud.com/");
    for (const file of ["parametric-eq.js", "audio-effects-core.js", "parametric-eq-ui.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    await page.evaluate(() => {
      window.allowed = true;
      window.fx = SCTempoEffects.create();
      fx.setEqualizerAllowed(true);
      window.editor = SCParametricEQUI.mount({ container: document.querySelector("#container"), effects: fx,
        authorize: async () => window.allowed, isAllowed: () => window.allowed,
        onChange: (value) => { window.saved = JSON.parse(JSON.stringify(value)); } });
      editor.setVisible(true);
    });
    await page.locator("summary").click();
    await page.locator(".peq-canvas").dblclick({ position: { x: 180, y: 70 } });
    await page.waitForFunction(() => window.saved?.bands.length === 1);
    const point = page.locator(".peq-point");
    const beforeQ = await page.evaluate(() => saved.bands[0].q);
    await point.hover(); await page.mouse.wheel(0, -100);
    await page.waitForFunction((before) => saved.bands[0].q > before, beforeQ);
    const bounds = await point.boundingBox();
    await page.mouse.move(bounds.x + 9, bounds.y + 9); await page.mouse.down();
    await page.mouse.move(bounds.x + 50, bounds.y + 30, { steps: 4 }); await page.mouse.up();
    const moved = await page.evaluate(() => saved.bands[0]);
    assert.ok(moved.gain < 0, "Dragging down must cut the selected band");
    await point.dblclick();
    await page.waitForFunction(() => saved.bands.length === 0);
    await page.locator(".peq-canvas").dblclick({ position: { x: 210, y: 105 } });
    await page.waitForFunction(() => saved.bands.length === 1 && saved.bands[0].gain < 0);
    const cutPreviewDb = await page.evaluate(() => {
      const preview = SCParametricEQ.createGraph(new OfflineAudioContext(1, 1, 48000));
      preview.apply(saved, false, true);
      return preview.response(new Float32Array([saved.bands[0].frequency]))[0];
    });
    assert.ok(Math.abs(cutPreviewDb - await page.evaluate(() => saved.bands[0].gain)) < 0.2,
      "Paused preview must show the edited filter cut");
    await page.locator(".peq-bypass").click();
    await page.waitForFunction(() => saved.enabled === false);
    const bypassCurveVisible = await page.evaluate(() => {
      const band = saved.bands[0];
      const canvas = document.querySelector(".peq-canvas");
      const width = document.querySelector(".peq-stage").clientWidth;
      const x = Math.round(27 + Math.log(band.frequency / 20) / Math.log(1000) * (width - 39));
      const y = Math.round(12 + (18 - band.gain) / 36 * (172 - 34));
      const pixels = canvas.getContext("2d").getImageData(x - 3, y - 3, 7, 7).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] >= 90 && pixels[i + 1] >= 90 && pixels[i + 2] >= 90 && pixels[i + 3] >= 120) return true;
      }
      return false;
    });
    assert.ok(bypassCurveVisible, "Bypass must keep the edited response curve visible");
    await page.locator(".peq-bypass").click();
    await page.waitForFunction(() => saved.enabled === true);
    for (let i = 1; i < 8; i++) await page.locator(".peq-add").click();
    assert.equal(await page.locator(".peq-point").count(), 8);
    assert.equal(await page.locator(".peq-add").isDisabled(), true);
    await page.locator(".peq-point").last().focus(); await page.keyboard.press("Delete");
    assert.equal(await page.locator(".peq-point").count(), 7);
    await page.locator(".peq-bypass").click();
    await page.waitForFunction(() => saved.enabled === false);
    await page.setViewportSize({ width: 320, height: 500 });
    await page.locator("#container").evaluate((node) => { node.style.width = "290px"; });
    assert.ok(await page.locator(".peq").evaluate((node) => node.scrollWidth <= node.clientWidth), "EQ must fit a narrow player");
    await page.evaluate(() => { allowed = false; fx.setEqualizerAllowed(false); editor.sync(); });
    assert.equal(await page.locator(".peq-add").isDisabled(), true);
    assert.equal(await page.locator(".peq-point").first().isDisabled(), true);
    await page.evaluate(() => { allowed = true; fx.setEqualizerAllowed(true); editor.sync(); });
    await page.locator(".peq-reset").click();
    await page.waitForFunction(() => saved.bands.length === 0 && saved.enabled);
    assert.deepEqual(errors, []);
    console.log("Parametric EQ editor: double-click add/delete, drag, wheel Q, paused response, 8-point limit, bypass, Pro and narrow layout passed.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
