const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
});
for (const name of [
  "soundcloud-http.js",
  "stream-selector.js",
  "download-track.js",
  "page-intake.js",
]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, name), "utf8"), context);
}
const create = vm.runInContext("SCPageIntake.create", context);
const trackModule = vm.runInContext("SCDownloadTrack", context);
const selector = vm.runInContext("SCStreamSelector", context);
const CLIENT = "client-test-12345678901234567890";

function rawTrack(id, title = `Track ${id}`) {
  return {
    id,
    title,
    duration: 60000,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
    user: { username: "Artist", permalink_url: "https://soundcloud.com/artist" },
    media: {
      transcodings: [{
        url: `https://api.test/stream-${id}`,
        preset: "mp3_128",
        format: { protocol: "progressive", mime_type: "audio/mpeg" },
      }],
    },
  };
}

function html(hydration) {
  return `<script>window.__sc_hydration = ${JSON.stringify(hydration)};</script>` +
    `<script>client_id=\"${CLIENT}\"</script>`;
}

function harness(pageUrl, hydration, api, runtimeReply) {
  const parsed = new URL(pageUrl);
  const windowObject = {
    location: {
      href: pageUrl,
      origin: parsed.origin,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
    },
  };
  const published = [];
  const intake = create({
    window: windowObject,
    document: {
      documentElement: { innerHTML: `client_id=\"${CLIENT}\"` },
      querySelectorAll: () => [],
    },
    fetch: async (url, options) => {
      if (String(url) === windowObject.location.href) {
        return { ok: true, text: async () => html(hydration) };
      }
      return api(String(url), options);
    },
    runtime: {
      sendMessage: async (message) => runtimeReply?.(message),
    },
    streamSelector: selector,
    downloadTrack: trackModule,
    onData: (type, data) => published.push({ type, data }),
  });
  return { intake, windowObject, published };
}

(async () => {
  const track = harness(
    "https://soundcloud.com/artist/track-1",
    [{ hydratable: "sound", data: rawTrack(1) }],
    () => { throw new Error("Unexpected API call"); }
  );
  await track.intake.extractCurrent();
  assert.equal(track.intake.getTrack().id, 1);
  assert.equal(track.published[0].type, "TRACK_DATA");

  const playlist = harness(
    "https://soundcloud.com/artist/sets/set",
    [{
      hydratable: "playlist",
      data: {
        title: "Set",
        track_count: 2,
        tracks: [rawTrack(1), { id: 2 }],
        user: { username: "Artist" },
      },
    }],
    async (url) => {
      assert.match(url, /api-v2\.soundcloud\.com\/tracks/);
      return { ok: true, status: 200, json: async () => [rawTrack(2)] };
    }
  );
  await playlist.intake.extractCurrent();
  assert.deepEqual(
    JSON.parse(JSON.stringify(playlist.intake.getCollection().tracks.map((value) => value.id))),
    [1, 2]
  );
  const selection = await playlist.intake.selectionList();
  assert.deepEqual(
    JSON.parse(JSON.stringify(selection.items.map((value) => value.id))),
    [1, 2]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify((await playlist.intake.tracksByIds([2, 1])).map((value) => value.id))),
    [2, 1]
  );
  assert.equal((await playlist.intake.resolveBulk(1)).length, 1);

  const publicLikes = harness(
    "https://soundcloud.com/listener/likes",
    [{ hydratable: "user", data: { id: 5, username: "Listener", public_likes_count: 2 } }],
    async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          collection: [{ track: rawTrack(1) }, { track: rawTrack(2) }],
          next_href: null,
        }),
      };
    }
  );
  await publicLikes.intake.extractCurrent();
  assert.equal(publicLikes.intake.getCollection().totalCount, 2);

  let repeatedLikesPages = 0;
  const repeatedLikes = harness(
    "https://soundcloud.com/listener/likes",
    [
      {
        hydratable: "user",
        data: { id: 7, username: "Listener", public_likes_count: 1 },
      },
    ],
    async () => {
      repeatedLikesPages += 1;
      if (repeatedLikesPages > 2) {
        throw new Error("Repeated likes cursor was requested again");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          collection: [{ track: rawTrack(1) }],
          next_href: "https://api-v2.soundcloud.com/users/7/likes?cursor=repeated",
        }),
      };
    }
  );
  await repeatedLikes.intake.extractCurrent();
  assert.equal(
    repeatedLikesPages,
    2,
    "Likes pagination did not stop at a repeated cursor"
  );
  assert.equal(repeatedLikes.intake.getCollection().tracks.length, 1);

  let personalProfileRequested = false;
  const personalLikes = harness(
    "https://soundcloud.com/you/likes",
    [],
    async (_url, options) => {
      assert.equal(options.headers.Authorization, "OAuth oauth-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({ collection: [{ track: rawTrack(3) }], next_href: null }),
      };
    },
    (message) => {
      personalProfileRequested = message.type === "GET_LOGGED_IN_USER";
      return {
        success: true,
        profile: {
          user: { id: 6, username: "Me", likes_count: 1 },
          oauthToken: "oauth-token",
        },
      };
    }
  );
  await personalLikes.intake.extractCurrent();
  assert.equal(personalProfileRequested, true);
  assert.equal(personalLikes.intake.getCollection().tracks[0].id, 3);

  let userPage = 0;
  const userTracks = harness(
    "https://soundcloud.com/artist/tracks",
    [{ hydratable: "user", data: { id: 8, username: "Artist", track_count: 3 } }],
    async () => {
      const pages = [
        { collection: [rawTrack(1), rawTrack(2)], next_href: "https://api-v2.soundcloud.com/users/8/tracks?cursor=2" },
        { collection: [rawTrack(2), rawTrack(3)], next_href: null },
      ];
      return { ok: true, status: 200, json: async () => pages[userPage++] };
    }
  );
  await userTracks.intake.extractCurrent();
  assert.deepEqual(
    JSON.parse(JSON.stringify(userTracks.intake.getCollection().tracks.map((value) => value.id))),
    [1, 2, 3]
  );

  const player = harness(
    "https://soundcloud.com/discover",
    [],
    async (url) => {
      assert.match(url, /api-v2\.soundcloud\.com\/resolve/);
      return { ok: true, status: 200, json: async () => rawTrack(4) };
    }
  );
  const playerTrack = await player.intake.resolvePlayerTrack(rawTrack(4).permalink_url);
  assert.equal(playerTrack.id, 4);

  let firstPageResolve;
  const oldUrl = "https://soundcloud.com/artist/track-1";
  const stale = harness(oldUrl, [], () => { throw new Error("Unexpected API call"); });
  stale.intake.reset();
  let pageCalls = 0;
  const originalFetch = stale.windowObject.location;
  const staleIntake = create({
    window: { location: originalFetch },
    document: { documentElement: { innerHTML: "" }, querySelectorAll: () => [] },
    fetch: async (url) => {
      pageCalls += 1;
      if (pageCalls === 1) {
        return new Promise((resolve) => { firstPageResolve = resolve; });
      }
      return { ok: true, text: async () => html([{ hydratable: "sound", data: rawTrack(2) }]) };
    },
    runtime: { sendMessage: async () => ({}) },
    streamSelector: selector,
    downloadTrack: trackModule,
  });
  const oldExtraction = staleIntake.extractCurrent();
  originalFetch.href = "https://soundcloud.com/artist/track-2";
  originalFetch.pathname = "/artist/track-2";
  staleIntake.reset();
  await staleIntake.extractCurrent();
  firstPageResolve({ ok: true, text: async () => html([{ hydratable: "sound", data: rawTrack(1) }]) });
  await oldExtraction;
  assert.equal(staleIntake.getTrack().id, 2, "A stale extraction replaced the current page");

  let retryCalls = 0;
  const retryWindow = {
    location: {
      href: oldUrl,
      origin: "https://soundcloud.com",
      hostname: "soundcloud.com",
      pathname: "/artist/track-1",
    },
  };
  const retryIntake = create({
    window: retryWindow,
    document: { documentElement: { innerHTML: "" }, querySelectorAll: () => [] },
    fetch: async () => ({
      ok: true,
      text: async () => ++retryCalls === 1 ? "no hydration" : html([{ hydratable: "sound", data: rawTrack(1) }]),
    }),
    runtime: { sendMessage: async () => ({}) },
    streamSelector: selector,
    downloadTrack: trackModule,
    timers: {
      setTimeout(callback, delay) {
        if (delay < 15000) queueMicrotask(callback);
        return delay;
      },
      clearTimeout() {},
    },
  });
  await retryIntake.extractCurrent();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retryIntake.getTrack().id, 1);
  assert.equal(retryCalls, 2);
  console.log("Page Intake verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
