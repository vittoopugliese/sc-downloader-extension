const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(fetch, delays = []) {
  const context = vm.createContext({
    console, URL, Blob, AbortController, DOMException, TextEncoder, TextDecoder,
    ArrayBuffer, Uint8Array, DataView, Float32Array,
    fetch,
    setTimeout(callback, delay) {
      if (delay >= 30000) return setTimeout(callback, delay);
      delays.push(delay);
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout,
  });
  for (const name of ["format-utils.js", "download-core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  }
  return vm.runInContext("SCDownload", context);
}

const mp3 = new Uint8Array(32);
mp3.set([0x49, 0x44, 0x33], 0);
const direct = { streamProtocol: "progressive", artist: "A", title: "B" };
function body(chunks, onCancel = () => {}) {
  let index = 0;
  return { getReader() { return {
    async read() {
      const next = chunks[index++];
      if (next instanceof Error) throw next;
      return next ? { done: false, value: next } : { done: true };
    },
    async cancel() { onCancel(); },
    releaseLock() {},
  }; } };
}
function response(chunks, onCancel) {
  return { ok: true, headers: { get: () => null }, body: body(chunks, onCancel) };
}

(async () => {
  let calls = 0;
  const delays = [];
  const retry = load(async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => "2" } };
    if (calls === 2) return response([new Error("body cut")]);
    return response([mp3]);
  }, delays);
  const built = await retry.buildTrackBlob("https://cdn.test/file", direct);
  assert.equal(built.blob.size, mp3.byteLength);
  assert.equal(calls, 3);
  assert.equal(delays.filter((value) => value === 2000).length, 1);

  calls = 0;
  const late = load(async () => {
    calls += 1;
    return { ok: false, status: 429, headers: { get: () => new Date(Date.now() + 60000).toUTCString() } };
  });
  await assert.rejects(late.buildTrackBlob("https://cdn.test/file", direct),
    (error) => error.code === "rate_limited" && error.retryAt > Date.now());
  assert.equal(calls, 1, "A long Retry-After must not trigger an early retry");

  const requested = [];
  let drained = 0;
  const hls = load(async (url, options) => {
    const name = String(url).split("/").at(-1);
    requested.push(name);
    if (name === "playlist.m3u8") {
      return response([new TextEncoder().encode("#EXTM3U\n" + Array.from({ length: 7 }, (_, i) => `s${i + 1}`).join("\n"))]);
    }
    if (name === "s1") return { ok: false, status: 403, headers: { get: () => null } };
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        drained += 1;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  });
  await assert.rejects(hls.buildTrackBlob("https://cdn.test/playlist.m3u8", { streamProtocol: "hls" }),
    (error) => error.status === 403);
  assert(!requested.some((name) => ["s5", "s6", "s7"].includes(name)));
  assert.equal(drained, 3);

  let cancelled = false;
  let accepted = 0;
  const oversized = load(async () => ({ ok: true, headers: { get: () => null }, body: {
    getReader() { return {
      async read() { accepted += 1; return { done: false, value: new Uint8Array(1024 * 1024) }; },
      async cancel() { cancelled = true; }, releaseLock() {},
    }; },
  } }));
  await assert.rejects(oversized.buildTrackBlob("https://cdn.test/large", direct),
    (error) => error.code === "memory_budget_exceeded");
  assert.equal(cancelled, true);
  assert(accepted <= 129, "The reader must stop before accepting an unbounded body");
  console.log("Download reliability verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
