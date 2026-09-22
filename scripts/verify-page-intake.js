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

function harness(pageUrl, hydration, api, runtimeReply, overrides = {}) {
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
    ...overrides,
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
  assert.equal(
    track.intake.classify("https://soundcloud.com/artist/track-1/comments"),
    "track",
    "A SoundCloud track comments route must remain classified as a track"
  );

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
  const selectionPage = await playlist.intake.selectionPage(null, 2);
  assert.equal(selectionPage.items.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(selectionPage.items.map((value) => value.id))), [1, 2]);
  assert.deepEqual(
    JSON.parse(JSON.stringify((await playlist.intake.tracksByIds([2, 1])).map((value) => value.id))),
    [2, 1]
  );
  assert.equal((await playlist.intake.resolveBulk(1)).length, 1);
  const playlistPage1 = await playlist.intake.bulkPage(null, 1);
  const playlistPage2 = await playlist.intake.bulkPage(playlistPage1.nextCursor, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify([playlistPage1.items[0].id, playlistPage2.items[0].id])),
    [1, 2]
  );
  assert.equal(playlistPage1.nextCursor, "playlist:1");
  assert.equal(playlistPage2.nextCursor, null);
  assert.equal(playlistPage2.done, true);
  await assert.rejects(playlist.intake.bulkPage("playlist:bad", 1), error => error.code === "invalid_cursor");

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
  assert.equal(repeatedLikes.intake.read().code, "cursor_cycle");

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
      if (message.type === "GET_AUTH_LIKES_PAGE") {
        return { success: true, page: {
          collection: [{ track: rawTrack(3) }], nextHref: null,
        } };
      }
      personalProfileRequested = message.type === "GET_LOGGED_IN_USER";
      return {
        success: true,
        profile: {
          user: { id: 6, username: "Me", likes_count: 1 },
        },
      };
    }
  );
  await personalLikes.intake.extractCurrent();
  assert.equal(personalProfileRequested, true);
  assert.equal(personalLikes.intake.getCollection().tracks[0].id, 3);

  let resolveOldProfile;
  const accountChanged = harness(
    "https://soundcloud.com/you/likes",
    [],
    () => { throw new Error("Unexpected API call"); },
    () => new Promise((resolve) => { resolveOldProfile = resolve; })
  );
  const oldAccountExtraction = accountChanged.intake.extractCurrent();
  await new Promise((resolve) => setImmediate(resolve));
  accountChanged.intake.reset();
  resolveOldProfile({
    success: true,
    profile: { user: { id: 6, username: "Old account", likes_count: 0 } },
  });
  await oldAccountExtraction;
  assert.equal(
    accountChanged.intake.getCollection(),
    null,
    "An account response from the invalidated generation was published"
  );

  const loggedOut = harness("https://soundcloud.com/you/likes", [],
    () => { throw new Error("Unexpected API call"); },
    () => ({ success: false, code: "auth_required", error: "No oauth_token cookie" }));
  await loggedOut.intake.extractCurrent();
  assert.equal(loggedOut.intake.read().code, "auth_required");
  assert.equal(loggedOut.intake.read().status, "error", "A terminal auth error must not restart on poll");

  for (const code of ["network_error", "network_timeout", "rate_limited", "service_unavailable", "invalid_response"]) {
    const failedProfile = harness("https://soundcloud.com/you/likes", [],
      () => { throw new Error("Unexpected API call"); },
      () => ({ success: false, code, error: code }));
    await failedProfile.intake.extractCurrent();
    assert.equal(failedProfile.intake.read().code, code, `Profile error ${code} was rewritten as another cause`);
  }

  const limited = harness("https://soundcloud.com/listener/likes",
    [{ hydratable: "user", data: { id: 6, username: "Listener" } }],
    async () => ({ ok: false, status: 429, headers: { get: () => "60" } }));
  await limited.intake.extractCurrent();
  assert.equal(limited.intake.read().code, "rate_limited");

  let longRetryCalls = 0;
  const longRetry = harness("https://soundcloud.com/artist/tracks",
    [{ hydratable: "user", data: { id: 8, username: "Artist", track_count: 1 } }],
    async () => {
      longRetryCalls += 1;
      return { ok: false, status: 429, headers: { get: name => name === "Retry-After" ? "60" : null } };
    });
  await longRetry.intake.extractCurrent();
  assert.equal(longRetry.intake.read().code, "rate_limited");
  assert.equal(longRetryCalls, 1, "A long Retry-After must not be shortened into an early retry");

  let retryNow = 1000;
  let budgetRetryCalls = 0;
  const retryDelays = [];
  const retryBudget = harness(
    "https://soundcloud.com/artist/tracks",
    [{ hydratable: "user", data: { id: 8, username: "Artist", track_count: 1 } }],
    () => { throw new Error("The injected HTTP adapter should handle API calls"); },
    null,
    {
      now: () => retryNow,
      soundCloudHttp: {
        async json() {
          budgetRetryCalls += 1;
          const error = new Error("wait");
          error.status = 429;
          error.code = "rate_limited";
          error.retryAt = retryNow + 4000;
          throw error;
        },
      },
      timers: {
        setTimeout(callback, delay) {
          if (delay < 15000) {
            retryDelays.push(delay);
            retryNow += delay;
            queueMicrotask(callback);
          }
          return { delay };
        },
        clearTimeout() {},
      },
    }
  );
  await retryBudget.intake.extractCurrent();
  assert.deepEqual(retryDelays, [4000, 4000]);
  assert.equal(budgetRetryCalls, 3, "Retries exceeded the total interactive time budget");
  assert.equal(retryBudget.intake.read().code, "rate_limited");

  let retryWaitCallback = null;
  let retryWaitCancelled = false;
  let cancelledRetryCalls = 0;
  const cancelledRetry = harness(
    "https://soundcloud.com/artist/tracks",
    [{ hydratable: "user", data: { id: 8, username: "Artist", track_count: 1 } }],
    () => { throw new Error("The injected HTTP adapter should handle API calls"); },
    null,
    {
      soundCloudHttp: {
        async json() {
          cancelledRetryCalls += 1;
          const error = new Error("wait");
          error.status = 429;
          error.code = "rate_limited";
          throw error;
        },
      },
      timers: {
        setTimeout(callback, delay) {
          const timer = { delay };
          if (delay === 1000) retryWaitCallback = callback;
          return timer;
        },
        clearTimeout(timer) {
          if (timer?.delay === 1000) retryWaitCancelled = true;
        },
      },
    }
  );
  const waitingRetry = cancelledRetry.intake.extractCurrent();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof retryWaitCallback, "function", "The retry wait was not reached");
  cancelledRetry.intake.reset();
  await waitingRetry;
  retryWaitCallback();
  await Promise.resolve();
  assert.equal(retryWaitCancelled, true, "Reset did not clean the retry timer");
  assert.equal(cancelledRetryCalls, 1, "Abort during retry wait emitted another request");

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

  let releaseBulkPage;
  let bulkRequestAborted = false;
  let bulkRequestCount = 0;
  const staleBulk = harness(
    "https://soundcloud.com/artist/tracks",
    [{ hydratable: "user", data: { id: 8, username: "Artist", track_count: 2 } }],
    () => { throw new Error("The injected HTTP adapter should handle API calls"); },
    null,
    {
      soundCloudHttp: {
        async json(_url, options) {
          bulkRequestCount += 1;
          if (bulkRequestCount === 1) {
            return { collection: [rawTrack(1)], next_href: null };
          }
          options.signal?.addEventListener("abort", () => { bulkRequestAborted = true; });
          return new Promise((resolve) => { releaseBulkPage = resolve; });
        },
      },
    }
  );
  await staleBulk.intake.extractCurrent();
  const pendingBulkPage = staleBulk.intake.bulkPage();
  await new Promise((resolve) => setImmediate(resolve));
  staleBulk.intake.reset();
  assert.equal(bulkRequestAborted, true, "Reset did not abort the pending bulk request");
  releaseBulkPage({ collection: [rawTrack(2)], next_href: null });
  await assert.rejects(pendingBulkPage, error => error.code === "stale_context");

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
  let stalePageAborted = false;
  const oldUrl = "https://soundcloud.com/artist/track-1";
  const stale = harness(oldUrl, [], () => { throw new Error("Unexpected API call"); });
  stale.intake.reset();
  let pageCalls = 0;
  const originalFetch = stale.windowObject.location;
  const staleIntake = create({
    window: { location: originalFetch },
    document: { documentElement: { innerHTML: "" }, querySelectorAll: () => [] },
    fetch: async (url, options) => {
      pageCalls += 1;
      if (pageCalls === 1) {
        options.signal.addEventListener("abort", () => { stalePageAborted = true; });
        return new Promise((resolve) => { firstPageResolve = resolve; });
      }
      return { ok: true, text: async () => html([{ hydratable: "sound", data: rawTrack(2) }]) };
    },
    runtime: { sendMessage: async () => ({}) },
    streamSelector: selector,
    downloadTrack: trackModule,
  });
  const oldExtraction = staleIntake.extractCurrent();
  await Promise.resolve();
  originalFetch.href = "https://soundcloud.com/artist/track-2";
  originalFetch.pathname = "/artist/track-2";
  staleIntake.reset();
  assert.equal(stalePageAborted, true, "Navigation did not abort the previous page request");
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

  let bodyAborted = false;
  const stalledBody = create({
    window: { location: { href: oldUrl, origin: "https://soundcloud.com",
      hostname: "soundcloud.com", pathname: "/artist/track-1" } },
    document: { documentElement: { innerHTML: "" }, querySelectorAll: () => [] },
    fetch: async (_url, options) => {
      options.signal?.addEventListener("abort", () => { bodyAborted = true; });
      return { ok: true, text: () => new Promise(() => {}) };
    },
    runtime: { sendMessage: async () => ({}) },
    streamSelector: selector,
    downloadTrack: trackModule,
    requestTimeoutMs: 20,
  });
  await Promise.race([
    stalledBody.extractCurrent(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("HTML body hung past timeout")), 200)),
  ]);
  assert.equal(bodyAborted, true);
  assert.equal(stalledBody.read().code, "network_timeout");

  const unavailablePage = create({
    window: { location: { href: oldUrl, origin: "https://soundcloud.com",
      hostname: "soundcloud.com", pathname: "/artist/track-1" } },
    document: { documentElement: { innerHTML: "" }, querySelectorAll: () => [] },
    fetch: async () => ({ ok: false, status: 503, text: () => new Promise(() => {}) }),
    runtime: { sendMessage: async () => ({}) },
    streamSelector: selector,
    downloadTrack: trackModule,
    requestTimeoutMs: 20,
  });
  await unavailablePage.extractCurrent();
  assert.equal(unavailablePage.read().code, "service_unavailable");
  console.log("Page Intake verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
