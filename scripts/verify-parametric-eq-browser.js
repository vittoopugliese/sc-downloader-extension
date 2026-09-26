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
        // Measure the final output, after the site's volume and all FX returns.
        meter = siteContext.createAnalyser();
        fx.analyseEqualizer().output.connect(meter);
        const samples = new Float32Array(meter.fftSize);
        const rms = () => { meter.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length); };
        const peak = () => { meter.getFloatTimeDomainData(samples); return samples.reduce((highest, x) => Math.max(highest, Math.abs(x)), 0); };
        await sleep(250);
        const base = rms();
        fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: 6, q: 2 }] });
        await sleep(300);
        const boost = rms();
        fx.setEqualizer({ enabled: true, bands: [{ type: "highpass", frequency: 4000, gain: 0, q: Math.SQRT1_2 }] });
        await sleep(300);
        const highpass = rms();
        const highpassResponse = fx.analyseEqualizer().response(new Float32Array([100, 10000]));
        fx.setEqualizer({ enabled: true, bands: [{ type: "lowpass", frequency: 200, gain: 0, q: Math.SQRT1_2 }] });
        await sleep(300);
        const lowpass = rms();
        const lowpassResponse = fx.analyseEqualizer().response(new Float32Array([100, 10000]));
        fx.setBypassed(true); await sleep(300); const cutoffBypass = rms();
        fx.setBypassed(false);
        fx.setEqualizer({ enabled: true, hardClip: false, bands: [{ frequency: 1000, gain: 24, q: 2 }] });
        await sleep(300);
        const unclippedPeak = peak();
        fx.setEqualizer({ enabled: true, hardClip: true, bands: [{ frequency: 1000, gain: 24, q: 2 }] });
        await sleep(300);
        const clippedPeak = peak();
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
        fx.setEqualizer({ enabled: true, bands: [] });
        fx.setCharacter("reverbDecay", 4);
        fx.set("reverb", 100);
        await sleep(600);
        player.pause();
        await sleep(350);
        const tail = rms();
        const tailSpectrum = fx.analyseEqualizer().readSpectrum().values.some((db) => db > -90);
        fx.setEqualizer({ enabled: true, bands: [{ type: "lowpass", frequency: 20, gain: 0, q: Math.SQRT1_2 }] });
        await sleep(350);
        const filteredTail = rms();
        fx.setEqualizer({ enabled: true, bands: [] });
        await sleep(350);
        const restoredTail = rms();
        fx.reset();
        fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: -12, q: 2 }] });
        // An SPA replacement must receive the saved EQ without another gesture.
        player.pause();
        const replacement = new Audio(url); replacement.loop = true; await replacement.play();
        const replacementContext = mode === "owned" ? null : new AudioContext({ sampleRate: 44100 });
        if (replacementContext) replacementContext.createMediaElementSource(replacement).connect(replacementContext.destination);
        active = replacement; fx.applyToActive(); await sleep(150);
        const replacementResponse = fx.analyseEqualizer().response(new Float32Array([1000]))[0];
        const playbackContextMatches = fx.getPlaybackContext() === (replacementContext || siteContext);
        let previousContextCut = null, combinedSpectrum = true;
        if (replacementContext) {
          const voice = siteContext.createOscillator(); voice.frequency.value = 500;
          const level = siteContext.createGain(); level.gain.value = 0.05;
          voice.connect(level).connect(siteContext.destination); voice.start();
          await sleep(350); const previousContextBase = rms();
          const spectrum = fx.analyseEqualizer().readSpectrum();
          combinedSpectrum = [500, 1000].every((hz) => spectrum.values[Math.round(hz * spectrum.fftSize / spectrum.sampleRate)] > -65);
          fx.setEqualizer({ enabled: true, bands: [{ frequency: 500, gain: -18, q: 2 }] });
          await sleep(300); previousContextCut = 20 * Math.log10(rms() / previousContextBase);
          voice.stop(); level.disconnect();
          await replacementContext.close();
        }
        replacement.pause(); player.pause(); await siteContext.close(); URL.revokeObjectURL(url);
        return { base, boost, highpass, lowpass,
          highpassResponse: [...highpassResponse], lowpassResponse: [...lowpassResponse],
          unclippedPeak, clippedPeak, cut, bypass, cutoffBypass, restored, revoked, response, replacementResponse, hasSpectrum, muted, reconnect,
          tail, tailSpectrum, filteredTail, restoredTail, playbackContextMatches, previousContextCut, combinedSpectrum };
      }, mode);
      assert.ok(result.base > 0.001, `${mode}: fixture must be audible`);
      const db = (value) => 20 * Math.log10(value / result.base);
      assert.ok(Math.abs(db(result.boost) - 6) < 0.6, `${mode}: +6 dB boost must not be reduced by automatic headroom`);
      assert.ok(db(result.highpass) < -20, `${mode}: high-pass must cut below cutoff`);
      assert.ok(db(result.lowpass) < -20, `${mode}: low-pass must cut above cutoff`);
      assert.ok(result.highpassResponse[0] < -20 && result.highpassResponse[1] > -1);
      assert.ok(result.lowpassResponse[0] > -2 && result.lowpassResponse[1] < -30);
      assert.ok(result.clippedPeak < result.unclippedPeak * 0.75,
        `${mode}: hard clip must measurably clamp boosted audio: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(db(result.cut) + 12) < 0.6, `${mode}: dry signal was not cut by 12 dB: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(db(result.bypass)) < 0.2, `${mode}: bypass must restore unity`);
      assert.ok(Math.abs(db(result.cutoffBypass)) < 0.2, `${mode}: bypass must also disable cutoff filters`);
      assert.ok(Math.abs(db(result.revoked)) < 0.2, `${mode}: revoked EQ must restore unity`);
      assert.ok(Math.abs(db(result.restored) + 12) < 0.6);
      assert.ok(Math.abs(result.response + 12) < 0.1);
      assert.ok(Math.abs(result.replacementResponse + 12) < 0.1);
      assert.ok(result.playbackContextMatches && result.combinedSpectrum, `${mode}: replaced contexts must share settings and display all sounding audio`);
      if (result.previousContextCut !== null) assert.ok(result.previousContextCut < -15, "EQ edits must also reach notes still playing in the previous context");
      assert.ok(result.hasSpectrum);
      assert.ok(result.tail > 1e-5 && result.tailSpectrum, `${mode}: reverb must remain audible and visible after pausing`);
      assert.ok(result.filteredTail < result.tail * 0.2 && result.restoredTail > result.filteredTail * 5,
        `${mode}: EQ must edit an already sounding reverb tail: ${JSON.stringify(result)}`);
      if (mode !== "owned") {
        assert.ok(result.muted < 1e-6, "Site mute must remain effective");
        assert.ok(Math.abs(db(result.reconnect) + 12) < 0.6, "Site reconnect must preserve EQ");
      }
      console.log(`Parametric EQ audio: ${mode}, cut ${db(result.cut).toFixed(2)} dB; bypass, revocation, SPA and spectrum passed.`);
      await page.close();
    }

    const samplerPage = await browser.newPage();
    await samplerPage.goto("about:blank");
    for (const file of ["parametric-eq.js", "audio-effects-core.js"]) await samplerPage.addScriptTag({ path: path.join(__dirname, file) });
    const sampler = await samplerPage.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // No track is loaded, and the sample starts before EQ is enabled.
      const fx = SCTempoEffects.create();
      const context = fx.getPlaybackContext();
      await context.resume();
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / context.sampleRate);
      const pad = context.createBufferSource();
      pad.buffer = buffer; pad.loop = true;
      const returnedDestination = pad.connect(context.destination);
      pad.start();
      fx.setEqualizerAllowed(true);
      const eq = fx.analyseEqualizer();
      const meter = context.createAnalyser(); eq.output.connect(meter);
      const samples = new Float32Array(meter.fftSize);
      const rms = () => { meter.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length); };
      for (let frame = 0; frame < 20; frame++) { await sleep(33); eq.readSpectrum(); }
      const base = rms();
      const spectrumBefore = Math.max(...eq.readSpectrum().values);
      fx.setEqualizer({ enabled: true, bands: [{ frequency: 1000, gain: -18, q: 1 }] });
      // Read at the editor's cadence so analyser smoothing can settle.
      for (let frame = 0; frame < 20; frame++) { await sleep(33); eq.readSpectrum(); }
      const cut = rms();
      const spectrumAfter = Math.max(...eq.readSpectrum().values);
      pad.stop(); pad.disconnect(context.destination, 0, 0);
      // A pitched note with an envelope uses the same final output, exactly once.
      const note = context.createBufferSource(); note.buffer = buffer; note.loop = true;
      const envelope = context.createGain(); envelope.gain.value = 0.5;
      note.connect(envelope).connect(context.destination);
      note.start(); await sleep(300);
      const noteCut = rms();
      const reconnect = [];
      for (const args of [[context.destination], [context.destination, 0], [context.destination, 0, 0], [0], []]) {
        envelope.disconnect(...args);
        await sleep(80);
        const silent = rms();
        envelope.connect(context.destination, 0, 0);
        envelope.connect(context.destination); // Duplicate connections must not double volume.
        await sleep(100);
        reconnect.push({ silent, level: rms() });
      }
      fx.setBypassed(true); await sleep(250); const bypass = rms();
      fx.setBypassed(false);
      fx.setEqualizerAllowed(false); await sleep(250); const revoked = rms();
      fx.setEqualizerAllowed(true); await sleep(250); const restored = rms();
      fx.reset(); await sleep(250); const reset = rms();
      const sameContext = fx.getPlaybackContext() === context;
      note.stop(); envelope.disconnect(); await context.close();
      return { base, cut, spectrumBefore, spectrumAfter, noteCut, reconnect, bypass, revoked, restored, reset, sameContext,
        returnsDestination: returnedDestination === context.destination };
    });
    assert.ok(sampler.base > 0.01 && sampler.sameContext && sampler.returnsDestination);
    const samplerDb = (value, base = sampler.base) => 20 * Math.log10(value / base);
    assert.ok(Math.abs(samplerDb(sampler.cut) + 18) < 0.5, `Sample EQ: ${JSON.stringify(sampler)}`);
    assert.ok(sampler.spectrumBefore > -40 && sampler.spectrumAfter < sampler.spectrumBefore - 12,
      `Sampler spectrum must show processed audio with no track loaded: ${JSON.stringify(sampler)}`);
    assert.ok(Math.abs(samplerDb(sampler.noteCut, sampler.cut) + 6.02) < 0.5, "Piano envelope and master EQ must each apply once");
    for (const value of sampler.reconnect) {
      assert.ok(value.silent < 1e-6 && Math.abs(samplerDb(value.level, sampler.noteCut)) < 0.3,
        "All destination disconnect/reconnect overloads must preserve the master EQ without doubling audio");
    }
    for (const value of [sampler.bypass, sampler.revoked, sampler.reset]) assert.ok(Math.abs(samplerDb(value) + 6.02) < 0.5);
    assert.ok(Math.abs(samplerDb(sampler.restored, sampler.noteCut)) < 0.3);
    console.log("Master EQ: standalone sampler, piano envelopes, live edits, spectrum, bypass, reset and output reconnection passed.");
    await samplerPage.close();

    const clipPage = await browser.newPage();
    await clipPage.goto("about:blank");
    await clipPage.addScriptTag({ path: path.join(__dirname, "parametric-eq.js") });
    const clipPeaks = await clipPage.evaluate(async () => {
      async function render(hardClip) {
        const context = new OfflineAudioContext(1, 4800, 48000);
        const graph = SCParametricEQ.createGraph(context);
        graph.apply({ enabled: true, hardClip, bands: [] }, false, true);
        const oscillator = context.createOscillator();
        const level = context.createGain();
        oscillator.frequency.value = 1000;
        level.gain.value = 0.8;
        oscillator.connect(level);
        level.connect(graph.input);
        graph.output.connect(context.destination);
        oscillator.start();
        const audio = await context.startRendering();
        return Math.max(...audio.getChannelData(0).map(Math.abs));
      }
      return { clean: await render(false), clipped: await render(true) };
    });
    assert.ok(clipPeaks.clean > 0.75 && clipPeaks.clipped < 0.45,
      `Hard clip must affect a normal loud signal without EQ boost: ${JSON.stringify(clipPeaks)}`);
    await clipPage.close();

    const exportPage = await browser.newPage();
    await exportPage.goto("about:blank");
    for (const file of ["parametric-eq.js", "audio-effects-core.js"]) {
      await exportPage.addScriptTag({ path: path.join(__dirname, file) });
    }
    const exportLevels = await exportPage.evaluate(async () => {
      const source = new OfflineAudioContext(1, 48000, 48000).createBuffer(1, 48000, 48000);
      const samples = source.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index * Math.PI * 2 * 1000 / 48000) * 0.05;
      const rms = (buffer) => Math.sqrt(buffer.getChannelData(0).reduce((sum, value) => sum + value * value, 0) / buffer.length);
      const settings = { eq: { enabled: true, bands: [{ type: "peaking", frequency: 1000, gain: 12, q: 2 }] } };
      const processed = await SCTempoEffects.renderSample(source, settings);
      const bypassed = await SCTempoEffects.renderSample(source, { ...settings, bypassed: true });
      const color = { saturation: 100, saturationDrive: 80, bitcrusher: 70, bitDepth: 4, sampleRateReduction: 30 };
      const cutoff = { enabled: true, bands: [{ type: "lowpass", frequency: 500, gain: 0, q: 0.707 }] };
      const colored = await SCTempoEffects.renderSample(source, color);
      const final = await SCTempoEffects.renderSample(source, { ...color, eq: cutoff });
      const reference = new OfflineAudioContext(1, colored.length, colored.sampleRate);
      const referenceSource = reference.createBufferSource(); referenceSource.buffer = colored;
      const referenceEq = SCParametricEQ.createGraph(reference); referenceEq.apply(cutoff, false, true);
      referenceSource.connect(referenceEq.input); referenceEq.output.connect(reference.destination); referenceSource.start();
      const expected = await reference.startRendering();
      const actual = final.getChannelData(0);
      const orderError = Math.max(...expected.getChannelData(0).map((sample, index) => Math.abs(sample - actual[index])));
      return { original: rms(source), processed: rms(processed), bypassed: rms(bypassed), orderError };
    });
    const exportedGainDb = 20 * Math.log10(exportLevels.processed / exportLevels.original);
    assert.ok(exportedGainDb > 10 && exportedGainDb < 16,
      `Export renderer must apply the active EQ: ${JSON.stringify({ ...exportLevels, exportedGainDb })}`);
    assert.ok(Math.abs(exportLevels.bypassed / exportLevels.original - 1) < 0.001,
      "Bypassed EQ must leave exported audio unchanged");
    assert.ok(exportLevels.orderError < 1e-5, `Export EQ must follow saturation, bitcrusher and limiter: ${exportLevels.orderError}`);
    await exportPage.close();

    const page = await browser.newPage({ viewport: { width: 420, height: 550 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://soundcloud.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<div id="container" style="width:380px"></div>' }));
    await page.goto("https://soundcloud.com/");
    for (const file of ["parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    await page.evaluate(() => {
      window.allowed = true;
      window.fx = SCTempoEffects.create();
      fx.setEqualizerAllowed(true);
      window.editor = SCParametricEQUI.mount({ container: document.querySelector("#container"), effects: fx,
        authorize: async () => window.allowed, isAllowed: () => window.allowed,
        onChange: (value) => { window.saved = JSON.parse(JSON.stringify(value)); } });
      editor.setVisible(true);
    });
    assert.equal(await page.locator(".peq-header-control").evaluateAll((buttons) => buttons.every((button) => !button.getClientRects().length)), true,
      "Minimized EQ must keep the three editing controls out of the header");
    assert.equal(await page.locator(".peq-pro").isVisible(), true, "Minimized EQ must keep the Pro badge visible");
    assert.equal(await page.locator(".peq-header-bypass").isVisible(), true, "Minimized EQ must keep the bypass visible");
    await page.locator(".peq-toggle").click();
    assert.equal(await page.locator(".peq-toolbar button").count(), 0, "EQ body must not duplicate header controls");
    assert.equal(await page.locator(".peq-header-control").count(), 3, "Expanded EQ header must show Point, hard clip and Reset");
    assert.equal(await page.locator(".peq-add svg").evaluate((icon) => getComputedStyle(icon).stroke !== "none"), true,
      "The add-point control must render its plus icon");
    assert.deepEqual(await page.locator(".tool-section-actions > *").evaluateAll((elements) => elements.map((element) => element.className)),
      ["peq-bypass peq-header-bypass", "peq-add peq-header-control", "peq-clip peq-header-control", "peq-reset peq-header-control", "peq-pro"],
      "EQ header actions must be ordered bypass, editing controls, then Pro badge");
    assert.equal(await page.locator(".peq-bypass").count(), 1, "EQ bypass must appear only in the header");
    await page.locator(".peq-canvas").dblclick({ position: { x: 180, y: 70 } });
    await page.waitForFunction(() => window.saved?.bands.length === 1);
    const point = page.locator(".peq-point");
    assert.deepEqual(await point.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderRadius, fontSize: style.fontSize, width: style.width, height: style.height };
    }), { radius: "50%", fontSize: "8px", width: "18px", height: "18px" },
    "EQ points must be circular with the compact number label");
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
    await page.locator(".peq-canvas").dblclick({ position: { x: 29, y: 85 } });
    await page.waitForFunction(() => saved.bands[0]?.type === "highpass");
    assert.ok(Math.abs(await page.evaluate(() => saved.bands[0].q) - Math.SQRT1_2) < 0.01);
    const cutoffPoint = page.locator(".peq-point");
    const cutoffQ = await page.evaluate(() => saved.bands[0].q);
    await cutoffPoint.hover(); await page.mouse.wheel(0, -100);
    await page.waitForFunction((before) => saved.bands[0].q > before, cutoffQ);
    await cutoffPoint.dblclick();
    await page.waitForFunction(() => saved.bands.length === 0);
    const canvasWidth = await page.locator(".peq-canvas").evaluate((canvas) => canvas.clientWidth);
    await page.locator(".peq-canvas").dblclick({ position: { x: canvasWidth - 15, y: 85 } });
    await page.waitForFunction(() => saved.bands[0]?.type === "lowpass");
    await page.locator(".peq-point").dblclick();
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
    await page.locator(".peq-header-bypass").click();
    await page.waitForFunction(() => saved.enabled === false);
    const bypassCurveVisible = await page.evaluate(() => {
      const band = saved.bands[0];
      const canvas = document.querySelector(".peq-canvas");
      const width = document.querySelector(".peq-stage").clientWidth;
      const x = Math.round(27 + Math.log(band.frequency / 20) / Math.log(1000) * (width - 39));
      const y = Math.round(12 + (SCParametricEQ.MAX_GAIN_DB - band.gain) / (2 * SCParametricEQ.MAX_GAIN_DB) * (172 - 34));
      const pixels = canvas.getContext("2d").getImageData(x - 3, y - 3, 7, 7).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] >= 90 && pixels[i + 1] >= 90 && pixels[i + 2] >= 90 && pixels[i + 3] >= 120) return true;
      }
      return false;
    });
    assert.ok(bypassCurveVisible, "Bypass must keep the edited response curve visible");
    await page.locator(".peq-header-bypass").click();
    await page.waitForFunction(() => saved.enabled === true);
    await page.locator(".peq-toggle").click();
    assert.equal(await page.locator(".peq-toggle").getAttribute("aria-expanded"), "false");
    await page.locator(".peq-header-bypass").click();
    await page.waitForFunction(() => saved.enabled === false);
    assert.equal(await page.locator(".peq-toggle").getAttribute("aria-expanded"), "false",
      "Header bypass must not expand the EQ");
    await page.locator(".peq-header-bypass").click();
    await page.waitForFunction(() => saved.enabled === true);
    await page.locator(".peq-toggle").click();
    await page.locator(".peq-clip").click();
    await page.waitForFunction(() => saved.hardClip === true);
    assert.equal(await page.locator(".peq-clip").getAttribute("aria-pressed"), "true");
    await page.locator(".peq-clip").click();
    await page.waitForFunction(() => saved.hardClip === false);
    for (let i = 1; i < 8; i++) await page.locator(".peq-add").click();
    assert.equal(await page.locator(".peq-point").count(), 8);
    assert.equal(await page.locator(".peq-add").isDisabled(), true);
    await page.locator(".peq-point").last().focus(); await page.keyboard.press("Delete");
    assert.equal(await page.locator(".peq-point").count(), 7);
    await page.locator(".peq-header-bypass").click();
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
    console.log("Parametric EQ editor: edge filters, double-click add/delete, drag, wheel Q, header bypass, hard clip, 8-point limit and narrow layout passed.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
