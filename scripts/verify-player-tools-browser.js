const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    await page.route("https://soundcloud.com/**", route => route.fulfill({ contentType: "text/html", body:
      '<style>.playControls__elements{position:fixed;bottom:0;height:48px;display:flex}</style><div class="playControls__elements"><div class="playControls__soundBadge"></div></div>' }));
    await page.goto("https://soundcloud.com/");
    for (const file of ["player-tools-policy.js", "player-tools-access.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    await page.evaluate(() => {
      const policy = SCPlayerToolsPolicy;
      const key = SCPlayerToolsAccess.STORAGE_KEY;
      const state = policy.startTrial(policy.normalize(), Date.now());
      // All 20 loops consumed: the seven-day feature trial must still work.
      state.trial.used = 20;
      window.accessData = { [key]: state };
      const changed = [];
      window.testAccess = SCPlayerToolsAccess.create({
        storage: {
          async get() { return structuredClone(window.accessData); },
          async set(value) { Object.assign(window.accessData, structuredClone(value)); changed.forEach(fn => fn(value, "local")); },
        },
        authority: { async startTrial() { return state.trial; }, async consumeTrial() { throw Error("Unexpected loop consumption"); },
          async validateTrial(value) { return { status: Date.now() < value.expiresAt ? "valid" : "expired" }; } },
      });
      const sender = { tab: { id: 1 }, frameId: 0, documentId: "qa" };
      window.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(request) {
        if (request.type === "AUTHORIZE_PLAYER_TOOLS") return { success: true, ...await testAccess.authorize(sender, request) };
        if (request.type === "START_PLAYER_TOOLS_TRIAL") await testAccess.startTrial();
        return { success: true, snapshot: await testAccess.getSnapshot(sender) };
      } }, storage: { onChanged: { addListener(fn) { changed.push(fn); } } } };
      document.addEventListener("scdl-looper:command", () => {
        const request = JSON.parse(document.documentElement.getAttribute("data-scdl-looper-command"));
        document.documentElement.setAttribute("data-scdl-looper-response", JSON.stringify({ id: request.id, state: {
          available: true, currentTimeMs: 1000, durationMs: 10000,
          loop: { active: true, enabled: true, startMs: 1000, endMs: 2000, generation: 1, trackIdentity: "track", durationMs: 10000 },
        } }));
      });
    });
    for (const file of ["player-tools-client.js", "tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "tempo-control-main.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const host = page.locator("#scdl-tempo-control");
    await host.locator(".trigger").click();
    await host.locator(".effects-toggle").click();
    for (const name of ["reverb", "delay", "flanger", "phaser", "saturation", "bitcrusher"]) {
      await expect(host.locator(`#scdl-effect-${name}`)).toBeEnabled();
    }
    await expect(host.locator(".save-loop-pad")).toBeEnabled();
    await expect(host.locator(".loop-instrument")).toBeEnabled();
    await host.locator("#scdl-effect-flanger").fill("30");
    await expect(host.locator('[data-effect-value="flanger"]')).toHaveText("30%");
    await page.clock.fastForward(7 * 86400000 + 100);
    await expect(host.locator("#scdl-effect-flanger")).toBeDisabled();
    await expect(host.locator('[data-effect-value="flanger"]')).toHaveText("0%");
    for (const name of ["phaser", "saturation", "bitcrusher"]) await expect(host.locator(`#scdl-effect-${name}`)).toBeDisabled();
    await expect(host.locator(".save-loop-pad")).toBeDisabled();
    await expect(host.locator(".loop-instrument")).toBeDisabled();
    for (const name of ["reverb", "delay"]) {
      await expect(host.locator(`#scdl-effect-${name}`)).toBeEnabled();
      await host.locator(`#scdl-effect-${name}`).fill("25");
      await expect(host.locator(`[data-effect-value="${name}"]`)).toHaveText("25%");
    }
    const snapshot = await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-scdl-player-tools-access")));
    assert.equal(snapshot.trial.expired, true);
    assert.equal(snapshot.capabilities.parametricEq, false);
    assert.equal(snapshot.capabilities.likesExplorer, false);
    await page.evaluate(async () => {
      await testAccess.setEntitlement({ status: "active", licenseId: "qa", expiresAt: Date.now() + 86400000 });
    });
    await expect(host.locator("#scdl-effect-flanger")).toBeEnabled();
    await expect(host.locator(".save-loop-pad")).toBeEnabled();
    await expect(host.locator(".loop-instrument")).toBeEnabled();
    assert.deepEqual(errors, []);
    console.log("Browser access QA passed: seven-day expiry without reload, exhausted loops, free FX, sampler locks and Pro activation.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
