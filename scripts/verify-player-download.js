const fs = require("fs");
const path = require("path");
const vm = require("vm");

const contentPath = path.resolve(__dirname, "content.js");
const contentCode = fs
  .readFileSync(contentPath, "utf8")
  .replace(/\ninitScript\(\);\s*$/, "\n");

const location = {
  origin: "https://soundcloud.com",
  hostname: "soundcloud.com",
  pathname: "/discover",
  href: "https://soundcloud.com/discover",
};

const calls = [];
const messageCalls = [];
const context = vm.createContext({
  console,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  setInterval,
  window: { location },
  location,
  document: {
    documentElement: { innerHTML: 'window.client_id="client-test-12345678901234567890"' },
    querySelectorAll: () => [],
  },
  MutationObserver: class {
    observe() {}
  },
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: (message) => {
        messageCalls.push(message);
        return Promise.resolve({ success: true });
      },
    },
  },
  SCStreamSelector: {
    DEFAULT_PREFERENCE: "auto",
    getStoredFormatPreference: () => Promise.resolve("auto"),
    extractStreamInfo: (track) => ({
      url: track.media.transcodings[0].url,
      protocol: "progressive",
      preset: "mp3_128",
      mimeType: "audio/mpeg",
    }),
    getStreamFormatLabel: () => "Progressive MP3",
    getAvailableFormats: () => ({ mp3: true }),
  },
  ensureInlineDownloadButton() {},
  removeInlineDownloadButton() {},
  fetch: async (url) => {
    calls.push(String(url));
    if (String(url).includes("api-v2.soundcloud.com/resolve")) {
      return {
        ok: true,
        json: async () => ({
          id: 42,
          title: "Current track",
          permalink_url: "https://soundcloud.com/artist/current-track",
          user: { username: "Artist" },
          duration: 1000,
          media: { transcodings: [{ url: "https://cdn.test/current.mp3" }] },
        }),
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  },
});

vm.runInContext(contentCode, context, { filename: contentPath });

const playerButton = {
  classList: { add() {}, remove() {} },
  setAttribute() {},
};
context.document.getElementById = (id) =>
  id === "scdl-player-download" ? playerButton : null;

const inlinePath = path.resolve(__dirname, "inline-button.js");
const inlineCode = fs
  .readFileSync(inlinePath, "utf8")
  .replace(/\nstartToolbarObserver\(\);\s*ensurePlayerDownloadButton\(\);\s*$/, "\n");
vm.runInContext(inlineCode, context, { filename: inlinePath });

(async () => {
  const track = await vm.runInContext(
    `resolvePlayerTrackData("https://soundcloud.com/artist/current-track")`,
    context
  );

  if (track.id !== 42 || track.streamUrl !== "https://cdn.test/current.mp3") {
    throw new Error("Current player track was not resolved to a downloadable source.");
  }

  if (!calls.some((url) => url.includes("api-v2.soundcloud.com/resolve"))) {
    throw new Error("The player resolver did not call the SoundCloud resolve endpoint.");
  }

  await vm.runInContext(
    `playerTrackUrl = "https://soundcloud.com/artist/current-track"; handlePlayerDownloadClick()`,
    context
  );

  const downloadMessage = messageCalls.find(
    (message) => message.type === "DOWNLOAD_SINGLE_TRACK"
  );
  if (!downloadMessage?.trackData || downloadMessage.formatPreference !== "auto") {
    throw new Error("The player click did not start the single-track download flow.");
  }

  console.log("Player download verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
