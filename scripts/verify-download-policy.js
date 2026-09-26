const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { create } = require("./download-policy.js");

(async () => {
  let flag = true;
  const policy = create({ apiBaseUrl: "https://service.test/api/player-tools", request: async (url, options) => {
    assert.equal(url, "https://service.test/api/player-tools/download-policy");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ allDownloadsActivated: flag }) };
  } });
  assert.equal((await policy.getPolicy()).allDownloadsActivated, true);
  flag = false;
  assert.equal((await policy.getPolicy()).allDownloadsActivated, false, "Enabled state must not persist");
  for (const value of ["true", 1, null, undefined]) {
    flag = value;
    assert.equal((await policy.getPolicy()).allDownloadsActivated, false);
  }
  for (const request of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error("invalid JSON"); } }),
    (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")))),
  ]) {
    assert.equal((await create({ apiBaseUrl: "https://service.test", request, timeoutMs: 5 }).getPolicy()).allDownloadsActivated, false);
  }

  const context = vm.createContext({ console, URL, AbortController, setTimeout, clearTimeout });
  for (const name of ["soundcloud-http.js", "stream-selector.js", "download-track.js", "download-source.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), "utf8"), context);
  }
  const makeSource = vm.runInContext("SCDownloadSource.create", context);
  const resolver = "https://api-v2.soundcloud.com/media/soundcloud:tracks:10/stream";
  let enabled = false;
  let downloadable = false;
  let hasDownloadsLeft = true;
  let originalStatus = 200;
  let streamStatus = 200;
  let metadataReads = 0;
  let streamReads = 0;
  const raw = () => ({ id: 10, title: "Track", downloadable, has_downloads_left: hasDownloadsLeft,
    media: { transcodings: [{ url: resolver, preset: "mp3_0_1", format: { protocol: "progressive", mime_type: "audio/mpeg" } }] } });
  const adapter = {
    getDownloadPolicy: async () => ({ allDownloadsActivated: enabled }),
    getOAuthToken: async () => { throw new Error("no session"); },
    request: async url => {
      const value = new URL(url);
      let status = 200;
      let data;
      if (value.pathname === "/tracks") { metadataReads++; data = [raw()]; }
      else if (value.pathname === "/tracks/10/download") { status = originalStatus; data = { redirectUri: "https://cdn.test/original.wav" }; }
      else if (value.pathname === "/users/1/likes") { data = { collection: [{ track: raw() }] }; }
      else { streamReads++; status = streamStatus; data = { url: "https://cdn.test/stream.mp3" }; }
      return { ok: status === 200, status, json: async () => data };
    },
  };
  const source = makeSource(adapter);
  const track = { id: 10, clientId: "client", streamUrl: resolver, downloadable: true, hasDownloadsLeft: true };
  await assert.rejects(source.resolve(track), error => error.code === "download_not_permitted");
  assert.equal(streamReads, 0, "Stale client permission must not allow streaming-only download");
  await assert.rejects(source.resolveDownloadStream(track), error => error.code === "download_not_permitted");
  const descriptor = { sourceType: "likes", sourceUserId: "1", clientId: "client" };
  assert.equal((await source.collectionPage(descriptor)).items.length, 0);
  downloadable = true;
  assert.equal((await source.resolve(track)).trackData.isOriginalDownload, true);
  assert.equal((await source.resolve(track, "mp3")).streamUrl, "https://cdn.test/stream.mp3");
  assert.equal((await source.collectionPage(descriptor)).items.length, 1);
  hasDownloadsLeft = false;
  await assert.rejects(source.resolve(track), error => error.code === "download_not_permitted");
  hasDownloadsLeft = true;
  originalStatus = 403;
  assert.equal((await source.resolve(track)).streamUrl, "https://cdn.test/stream.mp3", "Eligible tracks retain original-to-stream fallback");
  // Permission can change during a retry: recheck refreshed metadata.
  const revoked = makeSource({ ...adapter, request: async (url, options) => {
    if (String(url).includes("/media/")) { downloadable = false; streamStatus = 403; }
    return adapter.request(url, options);
  } });
  await assert.rejects(revoked.resolve(track, "mp3"), error => error.code === "download_not_permitted");
  streamStatus = 200;
  enabled = true;
  const readsBefore = metadataReads;
  assert.equal((await source.resolve(track, "mp3")).streamUrl, "https://cdn.test/stream.mp3");
  assert.equal(metadataReads, readsBefore, "Unrestricted mode preserves current resolution");
  assert.equal((await source.collectionPage(descriptor)).items.length, 1);
  enabled = false;
  await assert.rejects(source.resolve(track, "mp3"), error => error.code === "download_not_permitted");
  assert.equal((await source.resolveForPlayback(track, "mp3")).streamUrl, "https://cdn.test/stream.mp3",
    "Restricted downloads must not disable in-memory Player Tools playback");
  for (const getDownloadPolicy of [undefined, async () => { throw new Error("offline"); }]) {
    await assert.rejects(makeSource({ ...adapter, getDownloadPolicy }).resolve(track), error => error.code === "download_not_permitted");
  }
  console.log("Download policy verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
