const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ console });
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
  await http.json("https://api.test/me", { oauthToken: "token" });
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers.Origin, "https://soundcloud.com");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "OAuth token");

  const rejected = create(async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? "2" : null) },
  }));
  await assert.rejects(
    rejected.json("https://api.test/likes", { label: "Failed to fetch likes" }),
    (error) =>
      error.message === "Failed to fetch likes (429)." &&
      error.code === "http_error" &&
      error.status === 429 &&
      error.retryAfter === "2"
  );

  console.log("SoundCloud HTTP verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
