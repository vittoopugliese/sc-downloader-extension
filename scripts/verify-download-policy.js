const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { create } = require("./download-policy.js");

(async () => {
  let flag = true;
  let policyReads = 0;
  let currentTime = 1_000;
  const cacheWindow = 5 * 60 * 1000;
  const fiveMinutes = 5 * 60 * 1000;
  const stored = {};
  const storage = { get: async key => ({ [key]: stored[key] }), set: async value => Object.assign(stored, structuredClone(value)) };
  const configuration = { storage, apiBaseUrl: "https://service.test/api/player-tools", request: async (url, options) => {
    policyReads += 1;
    assert.equal(url, "https://service.test/api/player-tools/download-policy");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ allDownloadsActivated: flag }) };
  }, now: () => currentTime };
  const policy = create(configuration);
  const initial = await Promise.all(Array.from({ length: 200 }, () => policy.getPolicy()));
  assert.ok(initial.every(value => value.allDownloadsActivated));
  flag = false;
  assert.equal((await policy.getPolicy()).allDownloadsActivated, true, "Policy should reuse its five-minute cache");
  currentTime += cacheWindow - 1;
  assert.equal((await create(configuration).getPolicy()).allDownloadsActivated, true, "Worker restart must preserve a fresh policy");
  assert.equal(policyReads, 1, "Cached policy should avoid repeated Worker and D1 reads");
  currentTime += 1;
  assert.equal((await policy.getPolicy()).allDownloadsActivated, false, "Policy should refresh after the cache window");
  assert.equal(policyReads, 2);
  flag = true;
  currentTime += fiveMinutes - 1;
  assert.equal((await policy.getPolicy()).allDownloadsActivated, false);
  assert.equal((await create(configuration).getPolicy()).allDownloadsActivated, false,
    "Restricted policy must survive restarts without extending its five-minute window");
  assert.equal(policyReads, 2);
  currentTime += 1;
  const activated = create(configuration);
  const refreshed = await Promise.all(Array.from({ length: 200 }, () => activated.getPolicy()));
  assert.ok(refreshed.every(value => value.allDownloadsActivated), "The next use after five minutes must observe activation");
  assert.equal(policyReads, 3, "Concurrent reads at expiry must share a single refresh");
  flag = false;
  currentTime += cacheWindow - 1;
  assert.equal((await create(configuration).getPolicy()).allDownloadsActivated, true,
    "An activated policy must switch to the five-minute cache window");
  assert.equal(policyReads, 3);
  currentTime += 1;
  assert.equal((await create(configuration).getPolicy()).allDownloadsActivated, false);
  assert.equal(policyReads, 4);
  for (const value of ["true", 1, null, undefined]) {
    flag = value;
    currentTime += fiveMinutes;
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

  flag = true;
  currentTime += cacheWindow;
  await policy.getPolicy();
  currentTime += cacheWindow;
  let failures = 0;
  const offline = { ...configuration, request: async () => { failures++; throw new Error("offline"); } };
  assert.equal((await create(offline).getPolicy()).allDownloadsActivated, false, "Expired unrestricted policy must fail closed");
  currentTime += fiveMinutes - 1;
  assert.equal((await create(offline).getPolicy()).allDownloadsActivated, false);
  assert.equal(failures, 1, "Failed checks must also persist across restarts");
  currentTime += 1;
  assert.equal((await create(configuration).getPolicy()).allDownloadsActivated, true, "Retry after five minutes can recover");
  const otherService = create({ ...configuration, apiBaseUrl: "https://other.test", request: async () => ({ ok: true, json: async () => ({ allDownloadsActivated: false }) }) });
  assert.equal((await otherService.getPolicy()).allDownloadsActivated, false, "Different environments must not share flags");

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
  const enumeratedTrack = (await source.collectionPage(descriptor)).items[0];
  assert.equal(Number.isFinite(enumeratedTrack.downloadEligibilityCheckedAt), true);
  const readsAfterEnumeration = metadataReads;
  downloadable = false;
  assert.equal((await source.resolve(enumeratedTrack, "mp3", { reuseEligibilitySnapshot: true })).streamUrl,
    "https://cdn.test/stream.mp3");
  assert.equal(metadataReads, readsAfterEnumeration,
    "Bulk downloads should reuse SoundCloud metadata already checked during enumeration");
  await assert.rejects(source.resolve(enumeratedTrack, "mp3"), error => error.code === "download_not_permitted");
  downloadable = true;
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
  const fixed = create({ ...configuration, fixedRestricted: true, request: async () => { throw new Error("Tools edition must not read the remote policy"); } });
  flag = true;
  assert.equal((await fixed.getPolicy()).allDownloadsActivated, false, "Tools edition keeps downloads restricted regardless of the remote flag");
  console.log("Download policy verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
