const SCPageIntake = (() => {
  const NON_TRACK_PATHS = new Set([
    "discover", "search", "stream", "upload", "feed", "you", "sets",
    "likes", "albums", "tracks", "reposts", "comments", "popular-tracks",
    "following", "followers", "library", "notifications", "messages",
    "settings", "signin", "signup", "pages", "stations", "charts",
    "terms-of-use", "privacy",
  ]);
  const CLIENT_ID_PATTERNS = [
    /client_id[=:]["']([A-Za-z0-9_-]{20,})["']/g,
    /["']client_id["']\s*:\s*["']([A-Za-z0-9_-]{20,})["']/g,
  ];
  const PREVIEW_LIMIT = 50;
  const TRACKS_BATCH_SIZE = 50;
  const LIKES_PAGE_SIZE = 50;
  const USER_TRACKS_PAGE_SIZE = 200;
  const API_RETRY_LIMIT = 3;
  const MAX_EXTRACTION_RETRIES = 3;
  const CLIENT_ID_TTL_MS = 60 * 60 * 1000;

  function classify(value) {
    const url = value instanceof URL ? value : new URL(value);
    if (!url.hostname.includes("soundcloud.com")) return "other";
    const segments = url.pathname.split("/").filter(Boolean);
    const second = segments[1]?.toLowerCase();

    if (segments.length === 2 && second === "likes") return "likes";
    if (segments.length === 3 && second === "sets") return "playlist";
    if (
      segments.length === 2 &&
      second === "tracks" &&
      !NON_TRACK_PATHS.has(segments[0].toLowerCase())
    ) {
      return "user_tracks";
    }
    if (
      segments.length >= 2 &&
      segments.length <= 3 &&
      !segments.some((segment) => NON_TRACK_PATHS.has(segment.toLowerCase()))
    ) {
      return "track";
    }
    return "other";
  }

  function create(deps) {
    const win = deps.window;
    const doc = deps.document;
    const request = deps.fetch;
    const soundCloudHttp =
      deps.soundCloudHttp || SCSoundCloudHttp.create(request);
    const runtime = deps.runtime;
    const selector = deps.streamSelector;
    const downloadTrack = deps.downloadTrack;
    const onInline = deps.onInline || (() => {});
    const onRemoveInline = deps.onRemoveInline || (() => {});
    const onData = deps.onData || (() => {});
    const schedule = deps.timers?.setTimeout || setTimeout;
    const cancel = deps.timers?.clearTimeout || clearTimeout;

    let currentTrack = null;
    let currentCollection = null;
    let rawTrack = null;
    let bulkContext = null;
    let selectionCache = null;
    let formatPreference = selector.DEFAULT_PREFERENCE;
    let clientId = null;
    let clientIdAt = 0;
    let activeExtractionId = 0;
    let extractionRetryCount = 0;
    let pendingRetry = null;
    let extracting = false;

    selector.getStoredFormatPreference().then((value) => {
      formatPreference = value;
    });

    function currentUrl() {
      const url = new URL(win.location.href);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    }

    function normalizeUrl(value) {
      if (!value) return null;
      const url = new URL(value, win.location.origin);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    }

    function isFresh(extractionId, pageUrl) {
      return extractionId === activeExtractionId && currentUrl() === pageUrl;
    }

    function parseHydration(html) {
      const match = html.match(
        /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/
      );
      return match ? JSON.parse(match[1]) : null;
    }

    function findClientId(text) {
      for (const pattern of CLIENT_ID_PATTERNS) {
        pattern.lastIndex = 0;
        let match = pattern.exec(text);
        while (match) {
          if (match[1] && match[1] !== "MISSING_CLIENT_ID") return match[1];
          match = pattern.exec(text);
        }
      }
      return null;
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
      const controller = new AbortController();
      const timeoutId = schedule(() => controller.abort(), timeoutMs);
      try {
        return await request(url, { ...options, signal: controller.signal });
      } finally {
        cancel(timeoutId);
      }
    }

    async function resolveClientId(html) {
      if (clientId && Date.now() - clientIdAt < CLIENT_ID_TTL_MS) return clientId;
      const inline = findClientId(html);
      if (inline) {
        clientId = inline;
        clientIdAt = Date.now();
        return inline;
      }

      const scripts = [...doc.querySelectorAll('script[src*="a-v2.sndcdn.com"]')];
      for (const script of scripts) {
        try {
          const text = await fetchWithTimeout(script.src, { cache: "force-cache" })
            .then((response) => response.text());
          const found = findClientId(text);
          if (found) {
            clientId = found;
            clientIdAt = Date.now();
            return found;
          }
        } catch {
          // Continue with the remaining SoundCloud bundles.
        }
      }
      return null;
    }

    function toTrack(raw, id, pageUrl, preference = formatPreference) {
      return downloadTrack.fromSoundCloud(raw, {
        clientId: id,
        pageUrl,
        formatPreference: preference,
      });
    }

    function scheduleRetry(extractionId, pageUrl, delay) {
      if (pendingRetry) cancel(pendingRetry);
      pendingRetry = schedule(() => {
        pendingRetry = null;
        if (isFresh(extractionId, pageUrl)) extractCurrent(extractionId);
      }, delay);
    }

    function retry(extractionId, pageUrl, delay = 2000) {
      if (extractionRetryCount >= MAX_EXTRACTION_RETRIES) return;
      extractionRetryCount += 1;
      scheduleRetry(extractionId, pageUrl, delay);
    }

    async function fetchTracksByIds(ids, id, progress = {}) {
      const tracks = new Map();
      let loaded = 0;
      for (let offset = 0; offset < ids.length; offset += TRACKS_BATCH_SIZE) {
        const chunk = ids.slice(offset, offset + TRACKS_BATCH_SIZE);
        const url = new URL("https://api-v2.soundcloud.com/tracks");
        url.searchParams.set("ids", chunk.join(","));
        url.searchParams.set("client_id", id);
        const values = await soundCloudHttp.json(url, {
          label: "Failed to fetch playlist tracks",
        });
        for (const value of values) if (value?.id) tracks.set(value.id, value);
        loaded += chunk.length;
        progress.onProgress?.(
          (progress.progressOffset || 0) + loaded,
          progress.progressTotal
        );
      }
      return tracks;
    }

    async function playlistTracks(entries, id, pageUrl, limit, progress = {}) {
      const selected = entries.slice(0, limit ?? entries.length);
      const titled = selected.filter((value) => value.title).length;
      const partialIds = selected
        .filter((value) => !value.title && value.id)
        .map((value) => value.id);
      const byId = partialIds.length
        ? await fetchTracksByIds(partialIds, id, {
            ...progress,
            progressOffset: titled,
          })
        : new Map();
      if (!partialIds.length) progress.onProgress?.(titled, progress.progressTotal);

      const result = [];
      for (const value of selected) {
        const full = value.title ? value : byId.get(value.id);
        if (full?.title) result.push(toTrack(full, id, pageUrl));
        progress.onProgress?.(result.length, progress.progressTotal);
      }
      return result;
    }

    async function userTracksPage(url, id, attempt = 0) {
      if (!url.searchParams.has("client_id")) url.searchParams.set("client_id", id);
      try {
        return await soundCloudHttp.json(url, {
          label: "Failed to fetch user tracks",
        });
      } catch (error) {
        if (error.status !== 429 || attempt >= API_RETRY_LIMIT) throw error;
        const retryAfter = Number(error.retryAfter);
        const delay = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 10000)
          : 1000 * 2 ** attempt;
        await new Promise((resolve) => schedule(resolve, delay));
        return userTracksPage(url, id, attempt + 1);
      }
    }

    async function userTracks(userId, id, pageUrl, limit, extractionId, progress = {}) {
      const tracks = [];
      const seen = new Set();
      const visited = new Set();
      const cap = limit ?? Infinity;
      let next = new URL(`https://api-v2.soundcloud.com/users/${userId}/tracks`);
      next.searchParams.set("client_id", id);
      next.searchParams.set(
        "limit",
        String(Number.isFinite(cap) ? Math.min(USER_TRACKS_PAGE_SIZE, cap) : USER_TRACKS_PAGE_SIZE)
      );
      next.searchParams.set("linked_partitioning", "1");

      while (next && tracks.length < cap) {
        if (
          currentUrl() !== pageUrl ||
          (extractionId !== null && extractionId !== activeExtractionId)
        ) return null;
        const key = next.toString();
        if (visited.has(key)) break;
        visited.add(key);
        const page = await userTracksPage(next, id);
        const values = Array.isArray(page) ? page : page.collection || [];
        for (const value of values) {
          if (tracks.length >= cap) break;
          if (!value?.id || !value.title || seen.has(value.id)) continue;
          seen.add(value.id);
          tracks.push(toTrack(value, id, pageUrl));
          progress.onProgress?.(tracks.length, progress.progressTotal);
        }
        const nextHref = Array.isArray(page) ? null : page.next_href;
        next = nextHref ? new URL(nextHref) : null;
        next?.searchParams.set("client_id", id);
      }
      return Number.isFinite(cap) ? tracks.slice(0, cap) : tracks;
    }

    async function likesTracks(userId, id, pageUrl, oauthToken, limit, extractionId, progress = {}) {
      const tracks = [];
      const seen = new Set();
      const visited = new Set();
      const cap = limit ?? Infinity;
      let next = new URL(`https://api-v2.soundcloud.com/users/${userId}/likes`);
      next.searchParams.set("client_id", id);
      next.searchParams.set("limit", String(LIKES_PAGE_SIZE));
      next.searchParams.set("linked_partitioning", "1");

      while (next && tracks.length < cap) {
        if (extractionId !== null && !isFresh(extractionId, pageUrl)) return null;
        const key = next.toString();
        if (visited.has(key)) break;
        visited.add(key);
        const page = await soundCloudHttp.json(next, {
          label: "Failed to fetch user likes",
          oauthToken,
        });
        for (const item of page.collection || []) {
          const value = item?.track;
          if (tracks.length >= cap) break;
          if (!value?.id || !value.title || seen.has(value.id)) continue;
          seen.add(value.id);
          tracks.push(toTrack(value, id, pageUrl));
          progress.onProgress?.(tracks.length, progress.progressTotal);
        }
        next = page.next_href ? new URL(page.next_href) : null;
        next?.searchParams.set("client_id", id);
      }
      return Number.isFinite(cap) ? tracks.slice(0, cap) : tracks;
    }

    async function loggedInOrHydratedUser(hydration, id, pageUrl) {
      if (new URL(pageUrl).pathname.toLowerCase() === "/you/likes") {
        const result = await runtime.sendMessage({
          type: "GET_LOGGED_IN_USER",
          clientId: id,
        });
        return result?.success && result.profile?.user?.id
          ? result.profile
          : null;
      }
      const user = hydration.find((item) => item.hydratable === "user")?.data;
      return user?.id ? { user, oauthToken: null } : null;
    }

    async function buildResult(kind, hydration, id, pageUrl, extractionId) {
      if (kind === "track") {
        const raw = hydration.find((item) => item.hydratable === "sound")?.data;
        if (!raw) return null;
        const permalink = normalizeUrl(raw.permalink_url);
        if (permalink && permalink !== pageUrl) {
          retry(extractionId, pageUrl, 1000);
          return null;
        }
        return { kind, data: toTrack(raw, id, pageUrl), raw };
      }

      if (kind === "playlist") {
        const playlist = hydration.find((item) => item.hydratable === "playlist")?.data;
        if (!playlist) return null;
        const entries = playlist.tracks || [];
        const tracks = await playlistTracks(entries, id, pageUrl, PREVIEW_LIMIT);
        return {
          kind,
          bulk: { kind, orderedEntries: entries, clientId: id, pageUrl },
          data: {
            kind,
            title: playlist.title,
            trackCount: tracks.length,
            totalCount: playlist.track_count || entries.length,
            clientId: id,
            tracks,
            pageUrl,
            artworkUrl:
              downloadTrack.normalizeArtwork(playlist.artwork_url) ||
              tracks[0]?.artworkUrl || null,
            artist: playlist.user?.username || tracks[0]?.artist || "",
            artistUrl: playlist.user?.permalink_url || tracks[0]?.artistUrl || "",
            artistImageUrl:
              playlist.user?.avatar_url || tracks[0]?.artistImageUrl || null,
          },
        };
      }

      const userEntry = hydration.find((item) => item.hydratable === "user")?.data;
      if (kind === "user_tracks") {
        if (!userEntry?.id) {
          retry(extractionId, pageUrl);
          return null;
        }
        const tracks = await userTracks(
          userEntry.id, id, pageUrl, PREVIEW_LIMIT, extractionId
        );
        if (!tracks) return null;
        const username = userEntry.username || "Unknown user";
        return {
          kind,
          bulk: { kind, userId: userEntry.id, clientId: id, pageUrl },
          data: {
            kind,
            title: `${username} - Tracks`,
            trackCount: tracks.length,
            totalCount: Math.max(Number(userEntry.track_count) || 0, tracks.length),
            clientId: id,
            tracks,
            pageUrl,
            artworkUrl:
              downloadTrack.normalizeArtwork(userEntry.avatar_url) ||
              tracks[0]?.artworkUrl || null,
            artist: username,
            artistUrl: userEntry.permalink_url || "",
            artistImageUrl: userEntry.avatar_url || null,
          },
        };
      }

      const profile = await loggedInOrHydratedUser(hydration, id, pageUrl);
      if (!profile?.user?.id) return null;
      const tracks = await likesTracks(
        profile.user.id,
        id,
        pageUrl,
        profile.oauthToken,
        PREVIEW_LIMIT,
        extractionId
      );
      if (!tracks) return null;
      const username = profile.user.username || "Unknown user";
      return {
        kind,
        bulk: {
          kind: "likes",
          userId: profile.user.id,
          clientId: id,
          oauthToken: profile.oauthToken || null,
          pageUrl,
        },
        data: {
          kind: "likes",
          title: `${username} - Likes`,
          trackCount: tracks.length,
          totalCount:
            profile.user.public_likes_count ??
            profile.user.likes_count ??
            PREVIEW_LIMIT,
          clientId: id,
          tracks,
          pageUrl,
          artworkUrl: tracks[0]?.artworkUrl || null,
          artist: username,
          artistUrl: profile.user.permalink_url || "",
          artistImageUrl: profile.user.avatar_url || null,
        },
      };
    }

    function publish(result) {
      if (result.kind === "track") {
        const changed = JSON.stringify(currentTrack) !== JSON.stringify(result.data);
        currentTrack = result.data;
        rawTrack = result.raw;
        currentCollection = null;
        bulkContext = null;
        if (changed) onData("TRACK_DATA", currentTrack);
        onInline(currentTrack);
        return currentTrack;
      }

      const changed = JSON.stringify(currentCollection) !== JSON.stringify(result.data);
      currentCollection = result.data;
      currentTrack = null;
      rawTrack = null;
      bulkContext = result.bulk;
      if (changed) onData("PLAYLIST_DATA", currentCollection);
      onInline();
      return currentCollection;
    }

    async function extractCurrent(capturedId) {
      const extractionId = capturedId ?? ++activeExtractionId;
      const pageUrl = currentUrl();
      const kind = classify(pageUrl);
      if (kind === "other") return null;
      extracting = true;

      try {
        const response = await request(win.location.href, {
          cache: "no-store",
          credentials: "include",
        });
        const html = await response.text();
        if (!isFresh(extractionId, pageUrl)) return null;
        const hydration = parseHydration(html);
        if (!hydration) {
          retry(extractionId, pageUrl);
          return null;
        }
        const id = await resolveClientId(html);
        if (!id || !isFresh(extractionId, pageUrl)) return null;
        const result = await buildResult(kind, hydration, id, pageUrl, extractionId);
        if (!result || !isFresh(extractionId, pageUrl)) return null;
        extractionRetryCount = 0;
        return publish(result);
      } catch (error) {
        console.error("SC Track Downloader Error:", error);
        return null;
      } finally {
        if (extractionId === activeExtractionId) extracting = false;
      }
    }

    function read(forceRefresh = false) {
      const kind = classify(win.location.href);
      const pageUrl = currentUrl();
      const data = kind === "track" ? currentTrack : currentCollection;
      if (data && !forceRefresh && data.pageUrl === pageUrl) {
        return { status: "loaded", kind: kind === "track" ? "track" : "playlist", data };
      }
      if (kind === "other") return { status: "not_track" };
      if (forceRefresh || !extracting) extractCurrent();
      return { status: "loading" };
    }

    async function resolvePlayerTrack(trackUrl) {
      const normalized = normalizeUrl(trackUrl);
      if (!normalized) throw new Error("The current player track could not be identified.");
      if (currentTrack && normalizeUrl(currentTrack.permalink) === normalized && rawTrack) {
        return toTrack(rawTrack, currentTrack.clientId, normalized, "auto");
      }

      const id = await resolveClientId(doc.documentElement?.innerHTML || "");
      if (id) {
        try {
          const url = new URL("https://api-v2.soundcloud.com/resolve");
          url.searchParams.set("url", normalized);
          url.searchParams.set("client_id", id);
          const response = await fetchWithTimeout(url.toString(), {
            cache: "no-store",
            credentials: "include",
            headers: {
              Accept: "application/json",
              Origin: "https://soundcloud.com",
              Referer: "https://soundcloud.com/",
            },
          });
          if (response.ok) {
            const value = await response.json();
            if (value?.id && value?.title && (value.media?.transcodings?.length || value.downloadable)) {
              return toTrack(value, id, normalized, "auto");
            }
          }
        } catch {
          // Hydration is the fallback when the resolve endpoint is unavailable.
        }
      }

      const response = await fetchWithTimeout(normalized, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Could not load the current track (${response.status}).`);
      const html = await response.text();
      const hydration = parseHydration(html);
      const sound = hydration?.find((item) => {
        if (item?.hydratable !== "sound" || !item.data) return false;
        const permalink = normalizeUrl(item.data.permalink_url);
        return !permalink || permalink === normalized;
      })?.data;
      if (!sound) throw new Error("The current player item is not a downloadable track.");
      const hydrationClientId = id || (await resolveClientId(html));
      if (!hydrationClientId) throw new Error("SoundCloud client information is unavailable.");
      return toTrack(sound, hydrationClientId, normalized, "auto");
    }

    async function resolveBulk(limit, options = {}) {
      if (!bulkContext || bulkContext.pageUrl !== currentUrl()) {
        throw new Error("Bulk download context is not available for this page.");
      }
      formatPreference = await selector.getStoredFormatPreference();
      const total =
        options.progressTotal ??
        (bulkContext.kind === "playlist"
          ? bulkContext.orderedEntries.length
          : currentCollection?.totalCount ?? Infinity);
      const progress = { onProgress: options.onProgress, progressTotal: total };
      if (bulkContext.kind === "playlist") {
        return playlistTracks(
          bulkContext.orderedEntries,
          bulkContext.clientId,
          bulkContext.pageUrl,
          limit,
          progress
        );
      }
      if (bulkContext.kind === "likes") {
        const tracks = await likesTracks(
          bulkContext.userId,
          bulkContext.clientId,
          bulkContext.pageUrl,
          bulkContext.oauthToken,
          limit,
          null,
          progress
        );
        if (tracks === null) throw new Error("Bulk likes fetch was interrupted.");
        return tracks;
      }
      const tracks = await userTracks(
        bulkContext.userId,
        bulkContext.clientId,
        bulkContext.pageUrl,
        limit,
        null,
        progress
      );
      if (tracks === null) throw new Error("User track fetch was interrupted.");
      return tracks;
    }

    function selectionProjection(tracks) {
      const width = String(tracks.length).length;
      return tracks.map((value, index) => ({
        id: value.id,
        index: index + 1,
        title: value.title || "Untitled",
        duration: value.duration || "",
        indexLabel: String(index + 1).padStart(width, "0"),
      }));
    }

    async function selectionList(options = {}) {
      const tracks = await resolveBulk(null, options);
      selectionCache = { pageUrl: currentUrl(), tracks };
      return { total: tracks.length, items: selectionProjection(tracks) };
    }

    async function tracksByIds(ids, options = {}) {
      if (!selectionCache || selectionCache.pageUrl !== currentUrl()) {
        await selectionList(options);
      }
      let byId = new Map(selectionCache.tracks.map((value) => [value.id, value]));
      let tracks = ids.map((id) => byId.get(id)).filter(Boolean);
      if (tracks.length !== ids.length) {
        await selectionList(options);
        byId = new Map(selectionCache.tracks.map((value) => [value.id, value]));
        tracks = ids.map((id) => byId.get(id)).filter(Boolean);
      }
      return tracks;
    }

    function applyFormat(preference) {
      formatPreference = selector.normalizePreference
        ? selector.normalizePreference(preference)
        : preference || selector.DEFAULT_PREFERENCE;
      if (!rawTrack || !currentTrack?.pageUrl) return null;
      currentTrack = toTrack(
        rawTrack,
        currentTrack.clientId,
        currentTrack.pageUrl,
        formatPreference
      );
      onInline(currentTrack);
      onData("TRACK_DATA", currentTrack);
      return currentTrack;
    }

    function reset() {
      activeExtractionId += 1;
      currentTrack = null;
      currentCollection = null;
      rawTrack = null;
      bulkContext = null;
      selectionCache = null;
      extractionRetryCount = 0;
      extracting = false;
      if (pendingRetry) cancel(pendingRetry);
      pendingRetry = null;
      onRemoveInline();
    }

    return {
      classify: (value = win.location.href) => classify(value),
      read,
      extractCurrent,
      reset,
      applyFormat,
      getTrack: () => currentTrack,
      getCollection: () => currentCollection,
      resolvePlayerTrack,
      resolveBulk,
      selectionList,
      tracksByIds,
    };
  }

  return { classify, create };
})();
