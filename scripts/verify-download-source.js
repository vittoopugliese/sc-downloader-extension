const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  URL,
  SCStreamSelector: {
    extractStreamInfo: (track) => ({
      url: track.media.transcodings[0].url,
      protocol: track.media.transcodings[0].format.protocol,
      preset: track.media.transcodings[0].preset,
      mimeType: track.media.transcodings[0].format.mime_type,
    }),
    getStreamFormatLabel: () => "MP3",
    getAvailableFormats: () => ({ mp3: true }),
    shouldPreferOriginal: (track, preference = "auto") =>
      (preference === "auto" || preference === "original") &&
      track.downloadable === true &&
      track.hasDownloadsLeft !== false &&
      Boolean(track.id),
  },
});
for (const name of ["soundcloud-http.js", "download-track.js", "download-source.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, name), "utf8"), context);
}
const create = vm.runInContext("SCDownloadSource.create", context);

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

(async () => {
  for (const protocol of ["progressive", "hls"]) {
    for (const status of [401, 403, 404]) {
      const calls = [];
      const source = create({
        getOAuthToken: async () => "oauth",
        request: async (url, options) => {
          calls.push({ url: String(url), auth: options.headers.Authorization || null });
          return options.headers.Authorization
            ? response(200, { url: `https://cdn.test/${protocol}` })
            : response(status, {});
        },
      });
      const result = await source.resolveStream({
        streamUrl: "https://api.test/stream",
        streamProtocol: protocol,
        streamPreset: protocol === "hls" ? "aac_160k" : "mp3_128",
        clientId: "client",
      });
      assert.equal(result.protocol, protocol);
      assert.deepEqual(calls.map((call) => call.auth), [null, "OAuth oauth"]);
    }
  }

  for (const status of [401, 403]) {
    const auth = [];
    const source = create({
      getOAuthToken: async () => "oauth",
      request: async (_url, options) => {
        auth.push(options.headers.Authorization || null);
        return options.headers.Authorization
          ? response(200, { redirectUri: "https://cdn.test/original.wav" })
          : response(status, {});
      },
    });
    const original = await source.resolveOriginal(9, "client");
    assert.equal(original.original, true);
    assert.deepEqual(auth, [null, "OAuth oauth"]);
  }

  const notFoundCalls = [];
  const notFoundSource = create({
    getOAuthToken: async () => "oauth",
    request: async (_url, options) => {
      notFoundCalls.push(options.headers.Authorization || null);
      return response(404, {});
    },
  });
  await assert.rejects(notFoundSource.resolveOriginal(9, "client"), (error) => error.status === 404);
  assert.deepEqual(notFoundCalls, [null]);

  const oauthOnly = create({
    getOAuthToken: async () => "oauth",
    request: async (_url, options) => {
      assert.equal(options.headers.Authorization, "OAuth oauth");
      return response(200, { url: "https://cdn.test/oauth" });
    },
  });
  assert.equal(
    (await oauthOnly.resolveStream({ streamUrl: "https://api.test/private" })).authMode,
    "oauth"
  );

  const refreshCalls = [];
  const refreshing = create({
    getOAuthToken: async () => "oauth",
    request: async (url, options) => {
      const value = String(url);
      refreshCalls.push(value);
      if (value.includes("api-v2.soundcloud.com/tracks?")) {
        return response(200, [{
          id: 20,
          title: "Fresh",
          user: { username: "Artist" },
          media: { transcodings: [{
            url: "https://api.test/fresh",
            preset: "mp3_128",
            format: { protocol: "progressive", mime_type: "audio/mpeg" },
          }] },
        }]);
      }
      if (value.startsWith("https://api.test/stale")) return response(404, {});
      if (value.startsWith("https://api.test/fresh")) return response(200, { url: "https://cdn.test/fresh" });
      throw new Error(`Unexpected request: ${value} ${options.headers.Authorization || "public"}`);
    },
  });
  const refreshed = await refreshing.resolve({
    id: 20,
    title: "Stale",
    clientId: "client",
    streamUrl: "https://api.test/stale",
  }, "mp3");
  assert.equal(refreshed.streamUrl, "https://cdn.test/fresh");
  assert.equal(refreshCalls.filter((url) => url.includes("api-v2.soundcloud.com/tracks?")).length, 1);

  const originalPreferred = create({
    getOAuthToken: async () => {
      throw new Error("No session");
    },
    request: async (url) => {
      assert.match(String(url), /tracks\/30\/download/);
      return response(200, { redirectUri: "https://cdn.test/original.flac" });
    },
  });
  const originalResult = await originalPreferred.resolve({
    id: 30,
    title: "Original",
    clientId: "client",
    downloadable: true,
    hasDownloadsLeft: true,
    streamUrl: "https://api.test/transcode",
  });
  assert.equal(originalResult.streamUrl, "https://cdn.test/original.flac");
  assert.equal(originalResult.trackData.isOriginalDownload, true);

  let refreshAttempted = false;
  const nonRetryable = create({
    getOAuthToken: async () => "oauth",
    request: async (url) => {
      if (String(url).includes("api-v2.soundcloud.com/tracks?")) refreshAttempted = true;
      throw new Error("Network offline");
    },
  });
  await assert.rejects(
    nonRetryable.resolve({ id: 21, clientId: "client", streamUrl: "https://api.test/error" }, "mp3"),
    /Network offline/
  );
  assert.equal(refreshAttempted, false, "Non-retryable errors triggered refresh");

  for (const status of [400, 429, 500]) {
    let httpRefreshAttempted = false;
    const source = create({
      getOAuthToken: async () => "oauth",
      request: async (url) => {
        if (String(url).includes("api-v2.soundcloud.com/tracks?")) {
          httpRefreshAttempted = true;
        }
        return response(status, {});
      },
    });
    await assert.rejects(
      source.resolve(
        { id: status, clientId: "client", streamUrl: `https://api.test/${status}` },
        "mp3"
      ),
      (error) => error.status === status
    );
    assert.equal(
      httpRefreshAttempted,
      false,
      `HTTP ${status} incorrectly triggered metadata refresh`
    );
  }
  console.log("Download Source verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
