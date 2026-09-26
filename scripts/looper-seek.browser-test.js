const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://soundcloud.com/artist/track", (route) => route.fulfill({
      contentType: "text/html",
      body: '<div class="playControls__elements" style="position:fixed;bottom:0;left:0;right:0;height:48px"><div class="playControls__soundBadge"><a class="playbackSoundBadge__titleLink" href="/artist/track">Track</a></div></div><audio></audio>',
    }));
    await page.goto("https://soundcloud.com/artist/track");
    if (process.argv.includes("--effects")) await page.evaluate(() => { location.hash = "effects"; });
    for (const script of ["looper-core.js", "loop-session.js", "looper-main-bridge.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, script) });
    }
    await page.evaluate(async () => {
      const sampleRate = 44100;
      const sampleCount = sampleRate * 30;
      const buffer = new ArrayBuffer(44 + sampleCount * 2);
      const data = new DataView(buffer);
      const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
      text(0, "RIFF"); data.setUint32(4, buffer.byteLength - 8, true);
      text(8, "WAVEfmt "); data.setUint32(16, 16, true);
      data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, sampleRate, true); data.setUint32(28, sampleRate * 2, true);
      data.setUint16(32, 2, true); data.setUint16(34, 16, true);
      text(36, "data"); data.setUint32(40, sampleCount * 2, true);
      for (let i = 0; i < sampleCount; i += 1) data.setInt16(44 + i * 2, Math.sin(i / sampleRate * 440 * Math.PI * 2) * 12000, true);
      const audio = document.querySelector("audio");
      if (location.hash === "#effects") {
        const context = new AudioContext();
        context.createMediaElementSource(audio).connect(context.destination);
        await context.resume();
        window.audioContext = context;
      }
      audio.src = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      window.seekEvents = [];
      audio.addEventListener("seeking", () => window.seekEvents.push(audio.currentTime));
      await audio.play();
      window.loopCommand = (type, payload = {}) => {
        const root = document.documentElement;
        root.setAttribute("data-scdl-looper-command", JSON.stringify({ id: "seek-test", type, ...payload }));
        root.dispatchEvent(new CustomEvent("scdl-looper:command", { bubbles: true }));
        return JSON.parse(root.getAttribute("data-scdl-looper-response"));
      };
      window.loopCommand("set-loop", { startMs: 1000, endMs: 3000, startPlayback: true });
    });
    await page.waitForTimeout(400);
    if (process.argv.includes("--toolkit")) {
      await page.evaluate(() => {
        const snapshot = { plan: "pro", state: "pro", capabilities: Object.fromEntries([
          "openPanel", "beginLoop", "editLoop", "tempo", "preservePitch", "parametricEq", "freeEffects", "premiumEffects", "maximizeLooper", "editLoopPrecise",
        ].map((key) => [key, true])) };
        document.documentElement.setAttribute("data-scdl-player-tools-access", JSON.stringify(snapshot));
        document.addEventListener("scdl:player-tools-request", () => {
          const request = JSON.parse(document.documentElement.getAttribute("data-scdl-player-tools-request"));
          setTimeout(() => {
            document.documentElement.setAttribute("data-scdl-player-tools-response", JSON.stringify({ id: request.id, success: true, allowed: true, snapshot }));
            document.dispatchEvent(new CustomEvent("scdl:player-tools-response"));
          }, 20);
        });
        document.documentElement.setAttribute("data-scdl-player-waveform", JSON.stringify({ trackUrl: location.href, samples: Array.from({ length: 240 }, () => 60) }));
      });
      for (const script of ["tempo-control-core.js", "sampler-core.js", "parametric-eq.js", "audio-effects-core.js", "player-tools-collapsible.js", "parametric-eq-ui.js", "tempo-control-main.js"]) {
        await page.addScriptTag({ path: path.join(__dirname, script) });
      }
      const host = page.locator("#scdl-tempo-control");
      await host.locator(".trigger").click();
      const selection = host.locator(".waveform-selection");
      const box = await selection.boundingBox();
      assert.ok(box, "Loop selection must be visible");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(1000);
      const dragged = await page.evaluate(() => ({ loop: window.loopCommand("state").state.loop, time: document.querySelector("audio").currentTime }));
      assert.ok(dragged.loop.startMs > 6000, "Dragging the selection must move A forward");
      assert.equal(dragged.loop.endMs - dragged.loop.startMs, 2000, "Dragging must preserve the loop length");
      assert.ok(dragged.time * 1000 > dragged.loop.startMs + 100 && dragged.time * 1000 < dragged.loop.endMs,
        "Playback must advance inside the dragged selection");
      await page.evaluate(async () => {
        window.seekEvents = [];
        const audio = document.querySelector("audio");
        audio.pause();
        await audio.play();
      });
      await page.waitForTimeout(300);
      const resumedDrag = await page.evaluate(() => ({ time: document.querySelector("audio").currentTime, seeks: window.seekEvents.length }));
      assert.ok(resumedDrag.time > dragged.time + 0.1, "The dragged selection must keep playing after pause/play");
      assert.equal(resumedDrag.seeks, 0, "Resuming inside the dragged range must not cause repeated seeks");
    }
    await page.evaluate(() => {
      window.seekEvents = [];
      window.loopCommand("set-loop", { startMs: 10001, endMs: 12001, startPlayback: false });
    });
    await page.waitForTimeout(700);
    const moved = await page.evaluate(() => ({ time: document.querySelector("audio").currentTime, seeks: window.seekEvents }));
    console.log("Moved loop:", JSON.stringify(moved));
    assert.ok(moved.time > 10.2 && moved.time < 12.001, "Playback must advance inside the moved loop");
    assert.ok(moved.seeks.length < 5, "Moving the loop must not cause a persistent seek storm");
    await page.evaluate(async () => {
      const audio = document.querySelector("audio");
      audio.pause();
      await audio.play();
    });
    await page.waitForTimeout(400);
    const resumed = await page.evaluate(() => ({ time: document.querySelector("audio").currentTime, seeks: window.seekEvents.length }));
    assert.ok(resumed.time > moved.time + 0.1, "Playback must keep advancing after pause/play");
    assert.ok(resumed.seeks < 5, "Pause/play must not leave a persistent seek storm");
    console.log("Looper seek browser verification passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
