const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const messages = [];
const context = vm.createContext({
  console,
  chrome: { runtime: {} },
  SCStreamSelector: {},
});
for (const name of ["download-track.js", "download-intent.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, name), "utf8"), context);
}
const create = vm.runInContext("SCDownloadIntent.create", context);
const intent = create({
  async sendMessage(message) {
    messages.push(message);
    return message.type === "START_BULK_JOB"
      ? { success: true, job: { id: "job" } }
      : { success: true, fileName: "Track.mp3" };
  },
});

(async () => {
  await intent.downloadTrack(
    { id: 1, streamUrl: "https://api.test/stream", coverUrl: "legacy" },
    { formatPreference: "m4a", downloadDestination: { id: "music" } }
  );
  assert.equal(messages[0].type, "DOWNLOAD_SINGLE_TRACK");
  assert.equal(messages[0].trackData.artworkUrl, "legacy");
  assert.equal(messages[0].formatPreference, "m4a");

  await intent.downloadCollection(
    [{ id: 2, streamUrl: "https://api.test/stream" }],
    { title: "Set", artworkUrl: "cover", artist: "Artist" },
    { formatPreference: "opus" }
  );
  assert.equal(messages[1].type, "START_BULK_JOB");
  assert.equal(messages[1].playlistMeta.artworkUrl, "cover");
  assert.equal(messages[1].formatPreference, "opus");
  await assert.rejects(intent.downloadTrack({ id: 3 }), /No downloadable stream/);
  console.log("Download intent verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
