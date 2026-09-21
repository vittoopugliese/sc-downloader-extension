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
  const API_RETRY_BUDGET_MS = 10000;
  const MAX_EXTRACTION_RETRIES = 3;
  const CLIENT_ID_TTL_MS = 60 * 60 * 1000;

  function classify(value) {
    const url = value instanceof URL ? value : new URL(value);
    if (!url.hostname.includes("soundcloud.com")) return "other";
    const segments = url.pathname.split("/").filter(Boolean);
    const second = segments[1]?.toLowerCase();
    const isTrackCommentsRoute =
      segments.length === 3 &&
      segments[2].toLowerCase() === "comments" &&
      !NON_TRACK_PATHS.has(segments[0].toLowerCase()) &&
      !NON_TRACK_PATHS.has(segments[1].toLowerCase());

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
      (isTrackCommentsRoute ||
        !segments.some((segment) => NON_TRACK_PATHS.has(segment.toLowerCase())))
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
    const now = deps.now || Date.now;
    const apiRetryBudgetMs = Number.isFinite(deps.apiRetryBudgetMs) && deps.apiRetryBudgetMs > 0
      ? deps.apiRetryBudgetMs : API_RETRY_BUDGET_MS;
    const requestTimeoutMs = Number.isFinite(deps.requestTimeoutMs) && deps.requestTimeoutMs > 0
      ? deps.requestTimeoutMs : 15000;

    let currentTrack = null;
    let currentCollection = null;
    let rawTrack = null;
    let bulkContext = null;
    let selectionCache = null;
    let formatPreference = selector.DEFAULT_PREFERENCE;
    let clientId = null;
    let clientIdAt = 0;
    let activeExtractionId = 0;
    let activeExtractionController = null;
    let extractionRetryCount = 0;
    let pendingRetry = null;
    let extracting = false;
    let extractionPageUrl = null;
    let extractionState = { status: "idle" };

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

    async function fetchWithTimeout(url, options = {}, read = (response) => response) {
      const controller = new AbortController();
      const externalSignal = options.signal;
      let timeoutId;
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      const onAbort = () => {
        controller.abort();
        const error = new Error("SoundCloud request was cancelled.");
        error.name = "AbortError";
        error.code = "request_cancelled";
        rejectAbort(error);
      };
      externalSignal?.addEventListener?.("abort", onAbort, { once: true });
      if (externalSignal?.aborted) onAbort();
      const timeout = new Promise((_, reject) => {
        timeoutId = schedule(() => {
          const error = new Error("SoundCloud request timed out.");
          error.code = "network_timeout";
          reject(error);
          controller.abort();
        }, requestTimeoutMs);
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => request(url, { ...options, signal: controller.signal }))
            .then(read),
          timeout,
          aborted,
        ]);
      } finally {
        cancel(timeoutId);
        externalSignal?.removeEventListener?.("abort", onAbort);
      }
    }

    async function resolveClientId(html, signal) {
      if (clientId && now() - clientIdAt < CLIENT_ID_TTL_MS) return clientId;
      const inline = findClientId(html);
      if (inline) {
        clientId = inline;
        clientIdAt = now();
        return inline;
      }

      const scripts = [...doc.querySelectorAll('script[src*="a-v2.sndcdn.com"]')];
      for (const script of scripts) {
        try {
          const text = await fetchWithTimeout(script.src, { cache: "force-cache", signal },
            (response) => response.text());
          const found = findClientId(text);
          if (found) {
            clientId = found;
            clientIdAt = now();
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

    async function fetchTracksByIds(ids, id, progress = {}, signal) {
      const tracks = new Map();
      let loaded = 0;
      for (let offset = 0; offset < ids.length; offset += TRACKS_BATCH_SIZE) {
        const chunk = ids.slice(offset, offset + TRACKS_BATCH_SIZE);
        const url = new URL("https://api-v2.soundcloud.com/tracks");
        url.searchParams.set("ids", chunk.join(","));
        url.searchParams.set("client_id", id);
        const values = await soundCloudHttp.json(url, {
          label: "Failed to fetch playlist tracks",
          signal,
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

    async function playlistTracks(entries, id, pageUrl, limit, progress = {}, signal) {
      const selected = entries.slice(0, limit ?? entries.length);
      const titled = selected.filter((value) => value.title).length;
      const partialIds = selected
        .filter((value) => !value.title && value.id)
        .map((value) => value.id);
      const byId = partialIds.length
        ? await fetchTracksByIds(partialIds, id, {
            ...progress,
            progressOffset: titled,
          }, signal)
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

    function waitForRetry(delay, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          const error = new Error("SoundCloud request was cancelled.");
          error.name = "AbortError";
          error.code = "request_cancelled";
          reject(error);
          return;
        }
        let timer;
        const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
        const onAbort = () => {
          cancel(timer);
          cleanup();
          const error = new Error("SoundCloud request was cancelled.");
          error.name = "AbortError";
          error.code = "request_cancelled";
          reject(error);
        };
        signal?.addEventListener?.("abort", onAbort, { once: true });
        timer = schedule(() => {
          cleanup();
          resolve();
        }, delay);
      });
    }

    async function userTracksPage(url, id, options = {}) {
      const attempt = options.attempt || 0;
      const startedAt = options.startedAt ?? now();
      const signal = options.signal;
      if (!url.searchParams.has("client_id")) url.searchParams.set("client_id", id);
      try {
        return await soundCloudHttp.json(url, {
          label: "Failed to fetch user tracks",
          signal,
        });
      } catch (error) {
        if (error.status !== 429 || attempt >= API_RETRY_LIMIT) throw error;
        const delay = Number.isFinite(error.retryAt)
          ? Math.max(0, error.retryAt - now())
          : 1000 * 2 ** attempt;
        const elapsed = Math.max(0, now() - startedAt);
        const remaining = Math.max(0, apiRetryBudgetMs - elapsed);
        if (delay >= remaining) {
          error.code = "rate_limited";
          error.retryAt ||= now() + delay;
          throw error;
        }
        await waitForRetry(delay, signal);
        return userTracksPage(url, id, { attempt: attempt + 1, startedAt, signal });
      }
    }

    async function userTracks(userId, id, pageUrl, limit, extractionId, progress = {}, signal) {
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
        if (visited.has(key)) {
          const error = new Error("SoundCloud repeated a tracks page cursor.");
          error.code = "cursor_cycle";
          throw error;
        }
        visited.add(key);
        const page = await userTracksPage(next, id, { signal });
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
        if (next && (next.origin !== "https://api-v2.soundcloud.com" ||
            next.pathname !== `/users/${userId}/tracks` || next.username || next.password)) {
          const error = new Error("SoundCloud returned an invalid tracks cursor.");
          error.code = "invalid_cursor";
          throw error;
        }
        next?.searchParams.set("client_id", id);
      }
      return Number.isFinite(cap) ? tracks.slice(0, cap) : tracks;
    }

    async function likesTracks(userId, id, pageUrl, authenticated, limit, extractionId, progress = {}, signal) {
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
        if (visited.has(key)) {
          const error = new Error("SoundCloud repeated a likes page cursor.");
          error.code = "cursor_cycle";
          throw error;
        }
        visited.add(key);
        let page;
        if (authenticated) {
          const response = await runtime.sendMessage({
            type: "GET_AUTH_LIKES_PAGE",
            userId,
            clientId: id,
            nextHref: next.toString(),
          });
          if (signal?.aborted) return null;
          if (!response?.success) {
            const error = new Error(response?.error || "Could not load your SoundCloud likes.");
            error.code = response?.code || "network_error";
            error.status = response?.status;
            throw error;
          }
          page = { collection: response.page.collection, next_href: response.page.nextHref };
        } else {
          page = await soundCloudHttp.json(next, { label: "Failed to fetch user likes", signal });
        }
        for (const item of page.collection || []) {
          const value = item?.track;
          if (tracks.length >= cap) break;
          if (!value?.id || !value.title || seen.has(value.id)) continue;
          seen.add(value.id);
          tracks.push(toTrack(value, id, pageUrl));
          progress.onProgress?.(tracks.length, progress.progressTotal);
        }
        next = page.next_href ? new URL(page.next_href) : null;
        if (next && (next.origin !== "https://api-v2.soundcloud.com" ||
            next.pathname !== `/users/${userId}/likes` || next.username || next.password)) {
          const error = new Error("SoundCloud returned an invalid likes cursor.");
          error.code = "invalid_cursor";
          throw error;
        }
        next?.searchParams.set("client_id", id);
      }
      return Number.isFinite(cap) ? tracks.slice(0, cap) : tracks;
    }

    async function loggedInOrHydratedUser(hydration, id, pageUrl, signal) {
      if (new URL(pageUrl).pathname.toLowerCase() === "/you/likes") {
        const result = await runtime.sendMessage({
          type: "GET_LOGGED_IN_USER",
          clientId: id,
        });
        if (signal?.aborted) return null;
        if (!result?.success) {
          const error = new Error(result?.error || "Sign in to SoundCloud to view your likes.");
          error.code = result?.code || "network_error";
          error.status = result?.status;
          throw error;
        }
        return result.profile?.user?.id ? { user: result.profile.user, authenticated: true } : null;
      }
      const user = hydration.find((item) => item.hydratable === "user")?.data;
      return user?.id ? { user, authenticated: false } : null;
    }

    async function buildResult(kind, hydration, id, pageUrl, extractionId, signal) {
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
        const tracks = await playlistTracks(entries, id, pageUrl, PREVIEW_LIMIT, {}, signal);
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
          userEntry.id, id, pageUrl, PREVIEW_LIMIT, extractionId, {}, signal
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

      const profile = await loggedInOrHydratedUser(hydration, id, pageUrl, signal);
      if (!profile?.user?.id) return null;
      const tracks = await likesTracks(
        profile.user.id,
        id,
        pageUrl,
        profile.authenticated,
        PREVIEW_LIMIT,
        extractionId,
        {},
        signal
      );
      if (!tracks) return null;
      const username = profile.user.username || "Unknown user";
      return {
        kind,
        bulk: {
          kind: "likes",
          userId: profile.user.id,
          clientId: id,
          authenticated: profile.authenticated,
          pageUrl,
        },
        data: {
          kind: "likes",
          sourceUserId: String(profile.user.id),
          sourceUrl: profile.user.permalink_url || pageUrl,
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
      if (capturedId == null && extracting && extractionPageUrl === currentUrl()) return null;
      const extractionId = capturedId ?? ++activeExtractionId;
      const pageUrl = currentUrl();
      if (capturedId != null && !isFresh(extractionId, pageUrl)) return null;
      const kind = classify(pageUrl);
      if (kind === "other") {
        extractionState = { status: "unsupported", code: "unsupported_page" };
        return null;
      }
      const extractionController = new AbortController();
      activeExtractionController?.abort();
      activeExtractionController = extractionController;
      const signal = extractionController.signal;
      extracting = true;
      extractionPageUrl = pageUrl;
      extractionState = { status: "loading" };

      try {
        const { response, html } = await fetchWithTimeout(win.location.href, {
          cache: "no-store",
          credentials: "include",
          signal,
        }, async (response) => ({
          response,
          html: response.ok ? await response.text() : null,
        }));
        if (!isFresh(extractionId, pageUrl)) return null;
        if (!response.ok) {
          const error = new Error(`SoundCloud page returned ${response.status}.`);
          error.status = response.status;
          throw error;
        }
        const hydration = parseHydration(html);
        if (!hydration) {
          retry(extractionId, pageUrl);
          if (!pendingRetry) extractionState = { status: "error", code: "source_unavailable", retryable: true };
          return null;
        }
        const id = await resolveClientId(html, signal);
        if (!isFresh(extractionId, pageUrl)) return null;
        if (!id) {
          extractionState = { status: "error", code: "reload_required", retryable: true };
          return null;
        }
        const result = await buildResult(kind, hydration, id, pageUrl, extractionId, signal);
        if (!isFresh(extractionId, pageUrl)) return null;
        if (!result) {
          if (!pendingRetry) extractionState = { status: "error", code: "source_unavailable", retryable: true };
          return null;
        }
        extractionRetryCount = 0;
        extractionState = { status: "loaded" };
        return publish(result);
      } catch (error) {
        if (!isFresh(extractionId, pageUrl)) return null;
        const status = error?.status;
        const code = status === 429 ? "rate_limited" :
          [401, 403].includes(status) && pageUrl.includes("/you/likes") ? "auth_required" :
          status >= 500 && status <= 599 ? "service_unavailable" :
          error?.name === "AbortError" ? "network_timeout" :
          error?.code || "network_error";
        extractionState = { status: "error", code, stage: "extract", retryable: !["auth_required", "unsupported_page"].includes(code), statusCode: status };
        return null;
      } finally {
        if (activeExtractionController === extractionController) activeExtractionController = null;
        if (extractionId === activeExtractionId) extracting = false;
      }
    }

    function read(forceRefresh = false) {
      const kind = classify(win.location.href);
      const pageUrl = currentUrl();
      if (extractionPageUrl && extractionPageUrl !== pageUrl) reset();
      const data = kind === "track" ? currentTrack : currentCollection;
      if (data && !forceRefresh && data.pageUrl === pageUrl) {
        return { status: "loaded", kind: kind === "track" ? "track" : "playlist", data };
      }
      if (kind === "other") return { status: "not_track", code: "unsupported_page" };
      if (forceRefresh) {
        reset();
        extractCurrent();
      } else if (extractionState.status === "idle") {
        extractCurrent();
      }
      return extractionState;
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
          const resolved = await fetchWithTimeout(url.toString(), {
            cache: "no-store",
            credentials: "include",
            headers: {
              Accept: "application/json",
              Origin: "https://soundcloud.com",
              Referer: "https://soundcloud.com/",
            },
          }, async (response) => response.ok ? response.json() : null);
          if (resolved) {
            const value = resolved;
            if (value?.id && value?.title && (value.media?.transcodings?.length || value.downloadable)) {
              return toTrack(value, id, normalized, "auto");
            }
          }
        } catch {
          // Hydration is the fallback when the resolve endpoint is unavailable.
        }
      }

      const { response, html } = await fetchWithTimeout(normalized, {
        cache: "no-store",
        credentials: "include",
      }, async (response) => ({
        response,
        html: response.ok ? await response.text() : null,
      }));
      if (!response.ok) throw new Error(`Could not load the current track (${response.status}).`);
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
          bulkContext.authenticated,
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

    function checkedBulkCursor(value, kind, userId) {
      if (value == null) return null;
      if (kind === "playlist") {
        const match = /^playlist:(\d+)$/.exec(value);
        if (!match) throw Object.assign(new Error("Playlist cursor is invalid."), { code: "invalid_cursor" });
        return Number(match[1]);
      }
      const url = new URL(value);
      const path = kind === "likes" ? `/users/${userId}/likes` : `/users/${userId}/tracks`;
      if (url.origin !== "https://api-v2.soundcloud.com" || url.pathname !== path || url.username || url.password) {
        throw Object.assign(new Error("SoundCloud cursor is invalid."), { code: "invalid_cursor" });
      }
      return url;
    }

    async function bulkPage(cursor = null, pageSize = USER_TRACKS_PAGE_SIZE, expectedPageUrl = null) {
      if (!bulkContext || bulkContext.pageUrl !== currentUrl() ||
          (expectedPageUrl && normalizeUrl(expectedPageUrl) !== bulkContext.pageUrl)) {
        throw Object.assign(new Error("Bulk download context changed."), { code: "stale_context" });
      }
      const signal = activeExtractionController?.signal;
      const size = Math.min(USER_TRACKS_PAGE_SIZE, Math.max(1, Number(pageSize) || USER_TRACKS_PAGE_SIZE));
      formatPreference = await selector.getStoredFormatPreference();

      if (bulkContext.kind === "playlist") {
        const offset = checkedBulkCursor(cursor, "playlist") || 0;
        const entries = bulkContext.orderedEntries.slice(offset, offset + size);
        const tracks = await playlistTracks(entries, bulkContext.clientId, bulkContext.pageUrl, null, {}, signal);
        const nextOffset = offset + entries.length;
        return {
          items: tracks,
          enumerated: entries.length,
          skipped: { unavailable: Math.max(0, entries.length - tracks.length) },
          nextCursor: nextOffset < bulkContext.orderedEntries.length ? `playlist:${nextOffset}` : null,
          done: nextOffset >= bulkContext.orderedEntries.length,
        };
      }

      const kind = bulkContext.kind;
      const userId = bulkContext.userId;
      let next = checkedBulkCursor(cursor, kind, userId);
      if (!next) {
        next = new URL(`https://api-v2.soundcloud.com/users/${userId}/${kind === "likes" ? "likes" : "tracks"}`);
        next.searchParams.set("limit", String(kind === "likes" ? LIKES_PAGE_SIZE : size));
        next.searchParams.set("linked_partitioning", "1");
      }
      next.searchParams.set("client_id", bulkContext.clientId);

      let page;
      if (kind === "likes" && bulkContext.authenticated) {
        const response = await runtime.sendMessage({
          type: "GET_AUTH_LIKES_PAGE",
          userId,
          clientId: bulkContext.clientId,
          nextHref: next.toString(),
        });
        if (!response?.success) {
          const error = new Error(response?.error || "Could not load your SoundCloud likes.");
          error.code = response?.code || "network_error";
          error.retryAt = response?.retryAt;
          throw error;
        }
        page = { collection: response.page.collection, next_href: response.page.nextHref };
      } else {
        page = kind === "likes"
          ? await soundCloudHttp.json(next, { label: "Failed to fetch user likes", signal })
          : await userTracksPage(next, bulkContext.clientId, { signal });
      }
      const values = Array.isArray(page) ? page : page.collection || [];
      const rawTracks = kind === "likes" ? values.map(item => item?.track) : values;
      const tracks = rawTracks.filter(value => value?.id && value.title)
        .map(value => toTrack(value, bulkContext.clientId, bulkContext.pageUrl));
      const nextHref = Array.isArray(page) ? null : page.next_href;
      const checkedNext = nextHref ? checkedBulkCursor(nextHref, kind, userId) : null;
      checkedNext?.searchParams.set("client_id", bulkContext.clientId);
      return {
        items: tracks,
        enumerated: values.length,
        skipped: { unavailable: Math.max(0, values.length - tracks.length) },
        nextCursor: checkedNext?.toString() || null,
        done: !checkedNext,
      };
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
      activeExtractionController?.abort();
      activeExtractionController = null;
      activeExtractionId += 1;
      currentTrack = null;
      currentCollection = null;
      rawTrack = null;
      bulkContext = null;
      selectionCache = null;
      extractionRetryCount = 0;
      extracting = false;
      extractionPageUrl = null;
      extractionState = { status: "idle" };
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
      bulkPage,
      selectionList,
      tracksByIds,
      resolveClientId: () => resolveClientId(doc.documentElement?.innerHTML || ""),
    };
  }

  return { classify, create };
})();
