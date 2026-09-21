const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let listener;
let buildCount = 0;
let saveCount = 0;
let failSave = false;
let finishBuild;
const context = vm.createContext({
  console, AbortController, Blob, setInterval, clearInterval,
  URL: { createObjectURL: () => "blob:built", revokeObjectURL() {} },
  chrome: { runtime: {
    id: "test-extension",
    getURL: (file) => `chrome-extension://test-extension/${file}`,
    onMessage: { addListener(callback) { listener = callback; } },
    sendMessage: async () => {},
  } },
  SCDownload: { async buildTrackBlob() {
    buildCount += 1;
    await new Promise((resolve) => { finishBuild = resolve; });
    return { blob: new Blob(["audio"]), fileName: "Track.mp3" };
  } },
  SCDownloadDirectory: { async saveBlob() {
    saveCount += 1;
    if (failSave) throw Object.assign(new Error("Folder access expired during write."), { code: "ambiguous_save" });
    return "Track.mp3";
  } },
  fetch: async () => ({ ok: true, blob: async () => new Blob(["audio"]) }),
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "offscreen.js"), "utf8"), context);
const sender = { id: "test-extension", url: "chrome-extension://test-extension/scripts/background.js" };
function send(message) {
  return new Promise((resolve) => listener(message, sender, resolve));
}

(async () => {
  const build = { type: "OFFSCREEN_BUILD", buildId: "track_test_0", streamUrl: "https://cdn.test/audio",
    trackData: { id: 1 } };
  const first = send(build);
  const second = send({ ...build });
  assert.equal(buildCount, 1);
  assert.equal((await send({ ...build, streamUrl: "https://cdn.test/other" })).code, "operation_conflict");
  finishBuild();
  assert.deepEqual(await first, await second);
  assert.equal((await send(build)).blobUrl, "blob:built");
  assert.equal(buildCount, 1);

  const save = { type: "OFFSCREEN_SAVE_TO_DIRECTORY", operationId: "track_test", blobUrl: "blob:built",
    fileName: "Track.mp3", directoryId: "music" };
  const firstSave = send(save); // Simulate a caller that loses this response.
  const secondSave = send(save);
  const saved = await secondSave;
  assert.deepEqual(await firstSave, saved);
  assert.equal(saved.success, true);
  assert.deepEqual(await send(save), saved);
  assert.equal(saveCount, 1);
  assert.equal((await send({ ...save, fileName: "Other.mp3" })).code, "operation_conflict");
  failSave = true;
  const uncertainSave = await send({ ...save, operationId: "track_uncertain" });
  assert.equal(uncertainSave.success, false);
  assert.equal(uncertainSave.code, "ambiguous_save");
  console.log("Offscreen idempotency verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
