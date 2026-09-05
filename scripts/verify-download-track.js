const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
});
for (const name of ["stream-selector.js", "download-track.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, name), "utf8"), context);
}
const api = vm.runInContext("SCDownloadTrack", context);
const selector = vm.runInContext("SCStreamSelector", context);
const raw = {
  id: 7,
  title: "Track",
  user: { username: "Artist", permalink_url: "https://soundcloud.com/artist" },
  duration: 61000,
  artwork_url: "https://i.test/image-large.jpg",
  permalink_url: "https://soundcloud.com/artist/track",
  publisher_metadata: { album_title: "Album", isrc: "TEST123" },
  downloadable: true,
  has_downloads_left: true,
  track_authorization: "auth",
  media: {
    transcodings: [{
      url: "https://api.test/stream",
      preset: "mp3_128",
      format: { protocol: "progressive", mime_type: "audio/mpeg" },
    }],
  },
};

const hydration = api.fromSoundCloud(raw, {
  clientId: "client",
  pageUrl: raw.permalink_url,
  formatPreference: "auto",
});
const refresh = api.fromSoundCloud(JSON.parse(JSON.stringify(raw)), {
  clientId: "client",
  pageUrl: raw.permalink_url,
  formatPreference: "auto",
});
assert.deepEqual(JSON.parse(JSON.stringify(hydration)), JSON.parse(JSON.stringify(refresh)));
assert.equal(hydration.artworkUrl, "https://i.test/image-t500x500.jpg");
assert.equal(hydration.duration, "1:01");
assert.equal("artwork_url" in hydration, false);
assert.equal("coverUrl" in hydration, false);

const durable = api.toDurable({
  ...hydration,
  artworkUrl: null,
  coverUrl: "https://legacy.test/cover.jpg",
}, "Fallback album");
assert.equal(durable.artworkUrl, "https://legacy.test/cover.jpg");
assert.equal("coverUrl" in durable, false);
assert.equal(api.canDownload(durable), true);

const formats = {
  ...raw,
  downloadable: false,
  media: {
    transcodings: [
      ...raw.media.transcodings,
      { url: "https://api.test/aac", preset: "aac_160k", format: { protocol: "hls", mime_type: "audio/mp4" } },
      { url: "https://api.test/opus", preset: "opus_0_0", format: { protocol: "hls", mime_type: "audio/ogg; codecs=opus" } },
    ],
  },
};
assert.equal(api.fromSoundCloud(formats, { formatPreference: "m4a" }).streamUrl, "https://api.test/aac");
assert.equal(api.fromSoundCloud(formats, { formatPreference: "opus" }).streamUrl, "https://api.test/opus");
assert.equal(api.fromSoundCloud(formats).streamUrl, "https://api.test/stream");
assert.equal(selector.normalizePreference("unsupported"), "auto");
assert.equal(selector.shouldPreferOriginal(hydration, "auto"), true);
assert.equal(selector.shouldPreferOriginal(hydration, "mp3"), false);

const rankedM4a = {
  media: {
    transcodings: [
      { url: "https://api.test/aac-96", preset: "aac_96k", format: { protocol: "hls", mime_type: "audio/mp4" } },
      { url: "https://api.test/aac-160", preset: "aac_160k", format: { protocol: "hls", mime_type: "audio/mp4" } },
    ],
  },
};
assert.equal(
  selector.extractStreamInfo(rankedM4a, "m4a").url,
  "https://api.test/aac-160"
);
console.log("Download Track verification passed.");
