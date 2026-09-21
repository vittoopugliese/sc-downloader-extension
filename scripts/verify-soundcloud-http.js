const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console, URL, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout,
});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "soundcloud-http.js"), "utf8"),
  context
);
const create = vm.runInContext("SCSoundCloudHttp.create", context);

(async () => {
  const calls = [];
  const http = create(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 1 }) };
  });

  assert.deepEqual(await http.json(new URL("https://api.test/tracks")), { id: 1 });
  await http.json("https://api-v2.soundcloud.com/me", { oauthToken: "token" });
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers.Origin, "https://soundcloud.com");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "OAuth token");
  for (const url of ["http://api-v2.soundcloud.com/me", "https://api-v2.soundcloud.com.evil.test/me", "https://user@api-v2.soundcloud.com/me", "https://example.com/me"]) {
    await assert.rejects(http.json(url, { oauthToken: "sentinel" }), (error) => error.code === "invalid_auth_destination");
  }
  assert.equal(calls.length, 2, "Rejected destinations must never receive an authenticated request");

  const rejected = create(async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? "2" : null) },
  }));
  await assert.rejects(
    rejected.json("https://api.test/likes", { label: "Failed to fetch likes" }),
    (error) =>
      error.message === "Failed to fetch likes (429)." &&
      error.code === "rate_limited" &&
      error.status === 429 &&
      error.retryAfter === "2" &&
      Number.isFinite(error.retryAt)
  );

  const encoded = new TextEncoder().encode('{"id":2}');
  const streamed = create(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => sent ? { done: true } : (sent = true, { done: false, value: encoded }),
          cancel: async () => {},
          releaseLock: () => {},
        };
      },
    },
  }));
  assert.equal((await streamed.json("https://api.test/tracks")).id, 2);

  let cancelled = false;
  const oversized = create(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "Content-Length" ? "9" : null },
    body: { cancel: async () => { cancelled = true; } },
  }));
  await assert.rejects(
    oversized.json("https://api.test/tracks", { maxBytes: 8 }),
    (error) => error.code === "response_too_large"
  );
  assert.equal(cancelled, true);

  let bodyAborted = false;
  const stalled = create(async (_url, options) => {
    options.signal.addEventListener("abort", () => { bodyAborted = true; });
    return { ok: true, status: 200, json: () => new Promise(() => {}) };
  });
  await assert.rejects(
    stalled.json("https://api.test/tracks", { timeoutMs: 20 }),
    (error) => error.code === "network_timeout"
  );
  assert.equal(bodyAborted, true);

  const invalid = create(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("bad json"); },
  }));
  await assert.rejects(
    invalid.json("https://api.test/tracks"),
    (error) => error.code === "invalid_response"
  );

  console.log("SoundCloud HTTP verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
