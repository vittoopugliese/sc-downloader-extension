const fs = require("fs");
const path = require("path");
const vm = require("vm");

const contentPath = path.resolve(__dirname, "content.js");
const contentCode = fs
  .readFileSync(contentPath, "utf8")
  .replace(/\ninitScript\(\);\s*$/, "\n");

const location = {
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

const context = vm.createContext({
  console,
  URL,
  window: { location },
  location,
  document: {
    querySelectorAll: () => [],
  },
  MutationObserver: class {
    observe() {}
  },
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve(),
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
  fetch: async () => {
    const page = pages[pageIndex++];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => page,
    };
  },
  setTimeout,
  clearTimeout,
  setInterval,
});

vm.runInContext(contentCode, context, { filename: contentPath });

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(evaluate("isSoundCloudUserTracksPage()") === true, "Expected a user tracks page");
location.pathname = "/you/tracks";
assert(evaluate("isSoundCloudUserTracksPage()") === false, "Reserved routes must be excluded");
location.pathname = "/tttorio/sets/demo";
assert(evaluate("isSoundCloudUserTracksPage()") === false, "Playlist routes are not profiles");
location.pathname = "/tttorio/tracks";

(async () => {
  const tracks = await evaluate(
    `fetchUserTracks(10, "client", "https://soundcloud.com/tttorio/tracks", null)`
  );

  assert(tracks.length === 3, "Pagination should collect and deduplicate every track");
  assert(tracks.map((track) => track.id).join(",") === "1,2,3", "Track order changed");
  assert(pageIndex === 2, "Pagination did not follow next_href exactly once");
  console.log("Profile support verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
