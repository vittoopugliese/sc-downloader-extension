const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const server = http.createServer((_request, response) => response.end("<!doctype html><title>Slice test</title>"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const request = indexedDB.open("scdl-player-pads", 2);
      request.onupgradeneeded = () => {
        for (const [name, keyPath] of [["samples", "index"], ["claims", "index"], ["operations", "id"]]) {
          request.result.createObjectStore(name, { keyPath });
        }
      };
      const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      await new Promise(resolve => {
        const tx = db.transaction("samples", "readwrite");
        for (let index = 0; index < 6; index++) tx.objectStore("samples").put({ index, name: `Original ${index}`, blob: new Blob([`original-${index}`]) });
        tx.oncomplete = resolve;
      });
      db.close();
      window.chrome = { runtime: {
        id: "test", getURL: file => `chrome-extension://test/${file}`,
        onMessage: { addListener(callback) { window.offscreenListener = callback; } }, sendMessage: async () => {},
      } };
      window.send = message => new Promise(resolve => window.offscreenListener(message, {
        id: "test", url: "chrome-extension://test/scripts/background.js",
      }, resolve));
    });
    for (const file of ["format-utils.js", "loop-audio-renderer.js", "parametric-eq.js", "audio-effects-core.js",
      "download-core.js", "sampler-core.js", "sampler-slices.js", "offscreen.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const results = await page.evaluate(async () => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const source = new OfflineAudioContext(2, 24000, 8000).createBuffer(2, 24000, 8000);
      for (let channel = 0; channel < 2; channel++) {
        const data = source.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame++) {
          // Eight distinct levels within A–B; the rest of the track is negative.
          data[frame] = frame >= 8000 && frame < 16000 ? (1 + Math.floor((frame - 8000) / 1000)) / 12 * (channel ? .5 : 1) : -.8;
        }
      }
      const bytes = new ArrayBuffer(44 + source.length * 4);
      const wav = new DataView(bytes);
      for (const [at, value] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]]) {
        [...value].forEach((letter, index) => wav.setUint8(at + index, letter.charCodeAt(0)));
      }
      wav.setUint32(4, bytes.byteLength - 8, true); wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, 8000, true);
      wav.setUint32(28, 32000, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true);
      wav.setUint32(40, bytes.byteLength - 44, true);
      for (let frame = 0; frame < source.length; frame++) for (let channel = 0; channel < 2; channel++) {
        wav.setInt16(44 + frame * 4 + channel * 2, source.getChannelData(channel)[frame] * 32767, true);
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const trackData = { streamProtocol: "progressive", title: "Signal", artist: "Test", durationMs: 3000 };
      const originalFetch = window.fetch;
      let builds = 0;
      window.fetch = async (...args) => {
        if (args[0] === url) {
          builds++;
          if (window.buildGate) await window.buildGate;
          if (window.failBuild) throw new Error("Synthetic render failure");
        }
        return originalFetch(...args);
      };
      const owner = "tab:1:document:one";
      const input = { count: 8, trackIdentity: "permalink:https://soundcloud.com/test/track", generation: 1,
        trimRange: { startMs: 1000, endMs: 2000, durationMs: 3000 },
        playbackTransform: { rate: 1, preservePitch: false }, effects: {}, name: "Selected" };
      const call = (type, id, extra = {}) => send({ type: `OFFSCREEN_SLICES_${type}`, operationId: `pad_slice_test_${id}`, owner, ...extra });
      const list = async () => (await send({ type: "OFFSCREEN_PAD_LIST" })).pads;
      const begin = id => call("BEGIN", id, { input });
      const render = id => call("RENDER", id, { streamUrl: url, trackData });
      const original = JSON.stringify(await list());
      check((await list()).length === 6, "v2 samples survive unchanged");
      check((await begin("first")).success, "begin");
      const first = await render("first");
      check(first.success, JSON.stringify(first));
      check(builds === 1, "one render for all eight slices");
      check(JSON.stringify(await list()) === original, "preparation must not replace pads");
      check((await call("BEGIN", "first", { input: { ...input, name: "Changed" } })).code === "operation_conflict", "signature conflicts");
      check((await call("COMMIT", "first", { owner: "another-tab" })).code === "operation_conflict", "owner isolation");
      const committed = await call("COMMIT", "first");
      check(committed.success && committed.pads.length === 8, "atomic eight-pad commit");
      check(JSON.stringify(await call("COMMIT", "first")) === JSON.stringify(committed), "commit idempotency");
      check((await render("first")).success && builds === 1, "render receipt prevents repeated downloads");
      let totalFrames = 0;
      let sampleRate;
      for (let index = 0; index < 8; index++) {
        const get = await send({ type: "OFFSCREEN_PAD_GET", index });
        const data = new DataView(await (await fetch(get.pad.dataUrl)).arrayBuffer());
        const channels = data.getUint16(22, true);
        const frames = data.getUint32(40, true) / channels / 2;
        sampleRate = data.getUint32(24, true);
        totalFrames += frames;
        const middle = 44 + Math.floor(frames / 2) * channels * 2;
        check(Math.abs(data.getInt16(middle, true) / 32767 - (index + 1) / 12) < .003, `slice ${index} contains only its selected region`);
        check(Math.abs(data.getInt16(middle + 2, true) / 32767 - (index + 1) / 24) < .003, "stereo preserved");
        check(data.getInt16(44, true) === 0 && data.getInt16(44 + (frames - 1) * channels * 2, true) === 0, "edge fades");
      }
      check(totalFrames === sampleRate, "all selected frames covered once");
      const saved = JSON.stringify(await list());
      await call("CANCEL", "queued");
      check(!(await begin("queued")).success, "cancel before begin is sticky");
      await begin("cancelled");
      let release;
      window.buildGate = new Promise(resolve => { release = resolve; });
      const pending = render("cancelled");
      await new Promise(resolve => setTimeout(resolve, 30));
      await call("CANCEL", "cancelled");
      window.buildGate = null;
      release();
      check(!(await pending).success, "late render cannot revive cancelled batch");
      check(!(await call("COMMIT", "cancelled")).success, "cancelled batch cannot commit");
      check(JSON.stringify(await list()) === saved, "cancel leaves all pads unchanged");
      await begin("fail");
      window.failBuild = true;
      check(!(await render("fail")).success, "failed render");
      window.failBuild = false;
      check(JSON.stringify(await list()) === saved, "render failure leaves pads unchanged");
      await begin("collision");
      await render("collision");
      await send({ type: "OFFSCREEN_PAD_STORE", index: 7, name: "Newer upload", operationId: "pad_upload_newer_001", base64: btoa("upload") });
      check(!(await call("COMMIT", "collision")).success, "one conflicting slot invalidates entire batch");
      check((await list()).find(pad => pad.index === 0).name === "Selected · 1/8", "no partial replacements");
      const beforeQuota = JSON.stringify(await list());
      await begin("quota");
      await render("quota");
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(record, ...args) {
        if (this.name === "samples" && record.index === 4) throw new DOMException("Synthetic quota failure", "QuotaExceededError");
        return put.call(this, record, ...args);
      };
      const quota = await call("COMMIT", "quota");
      IDBObjectStore.prototype.put = put;
      check(!quota.success, "quota failure reported");
      check(JSON.stringify(await list()) === beforeQuota, "transaction rollback restores even the first four writes");
      check((await call("COMMIT", "quota")).success, "prepared batch can retry after aborted transaction");
      const processedInput = { ...input, trimRange: { startMs: 1123, endMs: 1900, durationMs: 3000 },
        playbackTransform: { rate: 1.25, preservePitch: false },
        effects: { reverb: 25, delay: 20, reverbDecay: .5, delayTime: 100, delayFeedback: 20 } };
      check((await call("BEGIN", "processed", { input: processedInput })).success, "processed begin");
      const processed = await render("processed");
      check(processed.success, JSON.stringify(processed));
      check((await call("COMMIT", "processed")).success, "processed commit");
      const lengths = [];
      for (let index = 0; index < 8; index++) {
        const get = await send({ type: "OFFSCREEN_PAD_GET", index });
        const wav = new DataView(await (await fetch(get.pad.dataUrl)).arrayBuffer());
        lengths.push(wav.getUint32(40, true) / wav.getUint16(32, true));
        sampleRate = wav.getUint32(24, true);
      }
      check(lengths.reduce((sum, length) => sum + length, 0) ===
        Math.ceil((Math.ceil(1.9 * sampleRate) - Math.floor(1.123 * sampleRate)) / 1.25), "FX tails never extend the transformed A–B range");
      check(Math.max(...lengths) - Math.min(...lengths) <= 1, "fractional duration is split equally to the nearest frame");
      await begin("restart");
      await render("restart");
      // Leave a prepared batch for a fresh offscreen document to commit.
      URL.revokeObjectURL(url);
      return { totalFrames, sampleRate, builds };
    });
    assert.equal(results.totalFrames, results.sampleRate);
    await page.reload();
    await page.evaluate(() => { window.chrome = { runtime: { onMessage: { addListener() {} } } }; });
    for (const file of ["sampler-core.js", "sampler-slices.js", "offscreen.js"]) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const restarted = await page.evaluate(() => SCSamplerSlices.handle({ type: "OFFSCREEN_SLICES_COMMIT",
      operationId: "pad_slice_test_restart", owner: "tab:1:document:one" }, openPadDatabase));
    assert.equal(restarted.success, true);
    assert.equal(restarted.pads.length, 8);
    console.log("Slices browser QA passed: actual A–B audio, stereo, fades, one render, v2 preservation, atomic writes, owner/signature checks, cancellation, conflicts, quota rollback and restart.");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
