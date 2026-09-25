const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let workletRequests = 0;
    const workletSource = require("node:fs").readFileSync(path.join(__dirname, "bitcrusher-processor.js"), "utf8");
    await page.route("https://soundcloud.com/**", (route) => {
      if (route.request().url().endsWith("/bitcrusher-processor.js")) {
        workletRequests += 1;
        return route.fulfill({ contentType: "application/javascript", body: workletSource });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<style>.playControls__elements { position:fixed; bottom:0; left:0; right:0; height:48px; display:flex; }</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>',
      });
    });
    await page.goto("https://soundcloud.com/");
    await page.evaluate(async (workletSource) => {
      const snapshot = { plan: "pro", state: "pro", capabilities: { freeEffects: true, premiumEffects: true, tempo: true, preservePitch: true, savePreset: true, parametricEq: true } };
      document.documentElement.setAttribute("data-scdl-extension-bitcrusher-worklet-url", URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" })));
      // Worklet fetches are not consistently intercepted by page.route.
      const probe = new AudioContext();
      const prototype = Object.getPrototypeOf(probe.audioWorklet);
      const addModule = prototype.addModule;
      window.workletLoads = 0;
      prototype.addModule = async function (...args) {
        const result = await addModule.apply(this, args);
        window.workletLoads += 1;
        return result;
      };
      await probe.close();
      document.documentElement.setAttribute("data-scdl-player-tools-access", JSON.stringify(snapshot));
      document.addEventListener("scdl:player-tools-request", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-player-tools-request"));
        document.documentElement.setAttribute("data-scdl-player-tools-response", JSON.stringify({ id: request.id, success: true, allowed: true, snapshot }));
        document.dispatchEvent(new CustomEvent("scdl:player-tools-response"));
      });
    }, workletSource);
    for (const file of ["tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "tempo-control-main.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const offline = await page.evaluate(async () => {
      const context = new AudioContext();
      const input = context.createBuffer(1, 4096, 44100);
      input.getChannelData(0)[0] = 0.75;
      input.getChannelData(0)[128] = -0.5;
      const output = await SCTempoEffects.renderSample(input, {
        flanger: 35, flangerRate: 0.8, flangerDepth: 65, flangerFeedback: 20,
        phaser: 30, phaserRate: 0.4, phaserDepth: 55, phaserFeedback: 15,
        bitcrusher: 40, bitDepth: 6, sampleRateReduction: 55,
        saturation: 32, saturationDrive: 45, saturationTone: 60,
      });
      const samples = output.getChannelData(0);
      const finite = samples.every(Number.isFinite);
      const energy = samples.reduce((sum, value) => sum + value * value, 0);
      await context.close();
      return { finite, energy, sameLength: output.length === input.length };
    });
    assert.deepEqual(offline.sameLength, true, "Motion and color FX must not add an export tail");
    assert.equal(offline.finite, true, "Offline FX output must contain only finite samples");
    assert.ok(offline.energy > 0, "Offline FX output must remain audible");
    await page.evaluate(async (shared) => {
      // A real detached player, like SoundCloud's new Audio() player.
      const bytes = new ArrayBuffer(44 + 16000);
      const view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
      text(8, "WAVEfmt "); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, "data"); view.setUint32(40, 16000, true);
      for (let i = 0; i < 8000; i++) view.setInt16(44 + i * 2, Math.sin(i * .2) * 8000, true);
      window.player = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
      player.loop = true;
      await player.play();
      // The site may already own the player's Web Audio source (e.g. volume processing).
      if (shared) {
        window.siteContext = new AudioContext();
        window.siteSource = shared === 'constructor'
          ? new MediaElementAudioSourceNode(siteContext, { mediaElement: player })
          : siteContext.createMediaElementSource(player);
        siteSource.connect(siteContext.destination);
      }
      window.fxSources = [];
      const nativeCompressor = AudioContext.prototype.createDynamicsCompressor;
      AudioContext.prototype.createDynamicsCompressor = function () {
        const node = nativeCompressor.call(this);
        window.fxMeter = this.createAnalyser();
        node.connect(fxMeter);
        return node;
      };
      const native = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (audio) {
        fxSources.push(audio);
        return native.call(this, audio);
      };
    }, process.argv.includes('--constructor') ? 'constructor' : process.argv.includes('--shared'));
    const host = page.locator("#scdl-tempo-control");
    await host.locator(".trigger").click();
    await host.locator('[data-effect-bypass="reverb"]').click();
    assert.equal(await host.locator('[data-effect-value="reverb"]').textContent(), "20%",
      "The compact reverb toggle must enable its default wet amount");
    await host.locator('[data-effect-bypass="reverb"]').click();
    assert.equal(await host.locator('[data-effect-value="reverb"]').textContent(), "0%",
      "The compact reverb toggle must bypass by setting wet to zero");
    await host.locator('[data-effect-bypass="reverb"]').click();
    assert.equal(await host.locator('[data-effect-value="reverb"]').textContent(), "20%",
      "The compact reverb toggle must restore its previous wet amount");
    await host.locator(".effects-toggle").click();
    for (const [name, amount] of [["reverb", 35], ["delay", 28], ["flanger", 24], ["phaser", 22], ["saturation", 18], ["bitcrusher", 16]]) {
      await host.locator(`#scdl-effect-${name}`).fill(String(amount));
      assert.equal(await host.locator(`[data-effect-value="${name}"]`).textContent(), `${amount}%`,
        "FX must apply to the current track without creating a loop or acquiring a session");
      assert.equal(await host.locator(`#scdl-effect-${name}`).isDisabled(), false,
        await host.locator('.status').textContent());
    }
    assert.equal(await page.evaluate(() => window.siteSource
      ? fxSources.length === 0 && siteContext.state === 'running'
      : fxSources.length === 1 && fxSources[0] === player), true);
    await page.waitForFunction(() => {
      const data = new Float32Array(fxMeter.fftSize);
      fxMeter.getFloatTimeDomainData(data);
      return data.some(value => Math.abs(value) > 0.0001);
    });
    await host.locator(".bypass").evaluate((button) => button.click());
    assert.equal(await host.locator(".bypass").getAttribute("aria-pressed"), "true");
    if (process.argv.includes('--shared')) {
      await page.waitForFunction(() => {
        const data = new Float32Array(fxMeter.fftSize);
        fxMeter.getFloatTimeDomainData(data);
        return data.every(value => Math.abs(value) < 0.00001);
      });
    }
    assert.equal(await host.locator('[data-effect-value="reverb"]').textContent(), "35%");
    await host.locator(".bypass").evaluate((button) => button.click());
    assert.equal(await host.locator(".bypass").getAttribute("aria-pressed"), "false");
    await host.locator(".effects-toggle").click();
    assert.equal(await host.locator(".effects-body").isVisible(), false);
    await host.locator(".effects-toggle").click();
    await host.locator('[data-effect-settings="reverb"]').click();
    assert.equal(await host.locator('[data-effect-settings-panel="reverb"]').isVisible(), true);
    await host.locator('#scdl-effect-reverb-room').selectOption('plate');
    await host.locator('#scdl-effect-reverb-size').fill('85');
    assert.equal(await host.locator('[data-effect-character-value="reverbSize"]').textContent(), '85%');
    await host.locator('#scdl-effect-reverb-decay').fill('6.5');
    assert.equal(await host.locator('[data-effect-character-value="reverbDecay"]').textContent(), '6.5s');
    await host.locator('#scdl-effect-reverb-predelay').fill('80');
    assert.equal(await host.locator('[data-effect-character-value="reverbPreDelay"]').textContent(), '80ms');
    await host.locator('[data-effect-settings="flanger"]').click();
    await host.locator('[data-effect-character="flangerRate"]').fill('1.25');
    assert.equal(await host.locator('[data-effect-character-value="flangerRate"]').textContent(), '1.25Hz');
    await host.locator('[data-effect-settings="bitcrusher"]').click();
    await host.locator('[data-effect-character="bitDepth"]').fill('7');
    assert.equal(await host.locator('[data-effect-character-value="bitDepth"]').textContent(), '7bit');
    await page.waitForFunction(() => window.workletLoads >= 1);
    await host.locator('[data-effect-settings="delay"]').click();
    await host.locator('[data-effect-freeze]').dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    assert.equal(await host.locator('[data-effect-freeze]').getAttribute('aria-pressed'), 'true');
    await host.locator('[data-effect-freeze]').dispatchEvent('pointerup', { button: 0, pointerId: 1 });
    assert.equal(await host.locator('[data-effect-freeze]').getAttribute('aria-pressed'), 'false');
    await host.locator('[data-fx-preset="dub"]').click();
    assert.equal(await host.locator('#scdl-effect-delay-feedback').inputValue(), '60');
    assert.equal(await host.locator('[data-effect-value="reverb"]').textContent(), "12%");
    await host.locator(".effects-toggle").click();
    await host.locator(".effects-toggle").click();
    for (const name of ["reverb", "delay", "flanger", "phaser", "saturation", "bitcrusher"]) {
      await host.locator(`#scdl-effect-${name}`).fill("0");
      assert.equal(await host.locator(`[data-effect-value="${name}"]`).textContent(), "0%");
    }
    console.log("Current-track FX dropdown verification passed (no loop, detached audio).");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
