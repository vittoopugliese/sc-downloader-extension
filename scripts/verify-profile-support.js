const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const location = {
  origin: "https://soundcloud.com",
  hostname: "soundcloud.com",
  pathname: "/tttorio/tracks",
  href: "https://soundcloud.com/tttorio/tracks",
};
const pages = [
  {
    collection: [
      { id: 1, title: "Первый", user: { username: "tttorio" } },
      { id: 2, title: "Second", user: { username: "tttorio" } },
    ],
    next_href: "https://api-v2.soundcloud.com/users/10/tracks?cursor=next",
  },
  {
    collection: [
      { id: 2, title: "Second", user: { username: "tttorio" } },
      { id: 3, title: "第三", user: { username: "tttorio" } },
    ],
    next_href: null,
  },
];
let pageIndex = 0;
const hydration = JSON.stringify([
  {
    hydratable: "user",
    data: { id: 10, username: "tttorio", track_count: 3 },
  },
]);

const context = vm.createContext({
  console,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  setInterval,
  location,
  window: { location },
  document: {
    documentElement: { innerHTML: "" },
    querySelectorAll: () => [],
  },
  MutationObserver: class { observe() {} },
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve({ success: true }),
    },
  },
  SCStreamSelector: {
    DEFAULT_PREFERENCE: "auto",
    getStoredFormatPreference: () => Promise.resolve("auto"),
    extractStreamInfo: () => null,
    getStreamFormatLabel: () => "",
    getAvailableFormats: () => ({}),
  },
  ensureInlineDownloadButton() {},
  removeInlineDownloadButton() {},
  fetch: async (url) => {
    if (String(url).startsWith("https://soundcloud.com/")) {
      return {
        ok: true,
        text: async () =>
          `<script>window.__sc_hydration = ${hydration};</script><script>client_id=\"client-test-12345678901234567890\"</script>`,
      };
    }
    const page = pages[pageIndex++];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => page,
    };
  },
});

for (const name of ["soundcloud-http.js", "download-track.js", "page-intake.js"]) {
  const file = path.resolve(__dirname, name);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}
const contentPath = path.resolve(__dirname, "content.js");
const content = fs
  .readFileSync(contentPath, "utf8")
  .replace(/\ninitScript\(\);\s*$/, "\n");
vm.runInContext(content, context, { filename: contentPath });

(async () => {
  assert.equal(vm.runInContext("isSoundCloudUserTracksPage()", context), true);
  location.pathname = "/you/tracks";
  location.href = "https://soundcloud.com/you/tracks";
  assert.equal(vm.runInContext("isSoundCloudUserTracksPage()", context), false);
  location.pathname = "/tttorio/tracks";
  location.href = "https://soundcloud.com/tttorio/tracks";

  await vm.runInContext("intake.extractCurrent()", context);
  const preview = vm.runInContext("window.SCDL.getPlaylistData()", context);
  assert.equal(preview.totalCount, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(preview.tracks.map((track) => track.id))),
    [1, 2, 3]
  );

  pageIndex = 0;
  const tracks = await vm.runInContext("window.SCDL.resolveBulkTracks(null)", context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(tracks.map((track) => track.id))),
    [1, 2, 3]
  );
  assert.equal(pageIndex, 2, "Pagination should follow next_href exactly once");
  console.log("Profile support verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
