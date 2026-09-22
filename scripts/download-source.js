const SCDownloadSource = (() => {
  let defaultSource = null;

  function createError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function create(adapter) {
    if (!adapter?.request || !adapter?.getOAuthToken) {
      throw new Error("SoundCloud source adapter is incomplete.");
    }

    const http = SCSoundCloudHttp.create(adapter.request);

    async function authAttempts(clientId) {
      const attempts = [];
      if (clientId) attempts.push({ label: "public", clientId });

      try {
        attempts.push({
          label: "oauth",
          clientId,
          oauthToken: await adapter.getOAuthToken(),
        });
      } catch {
        // A public request remains available when there is no session cookie.
      }

      if (!attempts.length) {
        throw createError(
          "Could not obtain client_id. Reload the SoundCloud page and try again.",
          "missing_client_id"
        );
      }
      return attempts;
    }

    async function tryAuthenticated(clientId, retryStatuses, operation) {
      const attempts = await authAttempts(clientId);
      let lastError = null;

      for (const attempt of attempts) {
        try {
          return await operation(attempt);
        } catch (error) {
          lastError = error;
          if (!retryStatuses.includes(error.status)) throw error;
        }
      }
      throw lastError || createError("SoundCloud request failed.", "unknown_error");
    }

    async function resolveStream(track) {
      if (!track?.streamUrl) {
        throw new Error("No downloadable stream was found for this track.");
      }
      if (!SCSoundCloudHttp.resolverUrl(track.streamUrl)) {
        throw createError("Stream resolver destination is invalid.", "invalid_stream_destination");
      }

      return tryAuthenticated(track.clientId, [401, 403, 404], async (attempt) => {
        const url = new URL(track.streamUrl);
        if (attempt.clientId) url.searchParams.set("client_id", attempt.clientId);
        if (track.trackAuthorization) {
          url.searchParams.set("track_authorization", track.trackAuthorization);
        }
        const data = await http.json(url, { oauthToken: attempt.oauthToken });
        if (!data.url) {
          throw createError(
            "SoundCloud did not return a playable stream URL.",
            "empty_stream_url"
          );
        }
        return {
          url: data.url,
          protocol: track.streamProtocol || null,
          preset: track.streamPreset || null,
          mimeType: track.streamMimeType || null,
          authMode: attempt.label,
        };
      });
    }

    async function resolveOriginal(trackId, clientId) {
      return tryAuthenticated(clientId, [401, 403], async (attempt) => {
        const url = new URL(
          `https://api-v2.soundcloud.com/tracks/${trackId}/download`
        );
        if (attempt.clientId) url.searchParams.set("client_id", attempt.clientId);
        const data = await http.json(url, { oauthToken: attempt.oauthToken });
        const redirectUrl = data.redirectUri || data.redirect_uri;
        if (!redirectUrl) {
          throw createError(
            "SoundCloud did not return an original download URL.",
            "empty_download_url"
          );
        }
        return { url: redirectUrl, original: true, mimeType: null };
      });
    }

    async function refresh(trackId, clientId, formatPreference = "auto") {
      return tryAuthenticated(clientId, [401, 403, 404], async (attempt) => {
        const url = new URL("https://api-v2.soundcloud.com/tracks");
        url.searchParams.set("ids", String(trackId));
        if (attempt.clientId) url.searchParams.set("client_id", attempt.clientId);
        const tracks = await http.json(url, { oauthToken: attempt.oauthToken });
        if (!tracks?.[0]) throw new Error("Track metadata was not found.");
        return SCDownloadTrack.fromSoundCloud(tracks[0], {
          clientId: attempt.clientId || clientId,
          pageUrl: tracks[0].permalink_url || null,
          formatPreference,
        });
      });
    }

    function shouldRefresh(error) {
      return (
        ["forbidden", "unauthorized", "not_found"].includes(error?.code) ||
        [401, 403, 404].includes(error?.status)
      );
    }

    async function resolve(trackData, formatPreference = "auto", options = {}) {
      let track = SCDownloadTrack.migrate(trackData);
      if (options.forceRefresh) {
        if (!track.id || !track.clientId) {
          throw createError("Track metadata cannot be refreshed.", "source_unavailable");
        }
        track = await refresh(track.id, track.clientId, formatPreference);
      }
      if (
        SCStreamSelector.shouldPreferOriginal(track, formatPreference)
      ) {
        try {
          const original = await resolveOriginal(track.id, track.clientId);
          return {
            streamUrl: original.url,
            trackData: {
              ...track,
              isOriginalDownload: true,
              originalDownloadUrl: original.url,
              originalMimeType: original.mimeType || null,
            },
          };
        } catch {
          // Preserve the established original-to-transcode fallback.
        }
      }

      try {
        const stream = await resolveStream(track);
        return { streamUrl: stream.url, trackData: track };
      } catch (error) {
        if (!track.id || !track.clientId || !shouldRefresh(error)) throw error;
        track = { ...track, ...(await refresh(track.id, track.clientId, formatPreference)) };
        const stream = await resolveStream(track);
        return { streamUrl: stream.url, trackData: track };
      }
    }

    async function resolveLoggedInUser(clientId) {
      if (!clientId) throw createError("Missing client_id.", "missing_client_id");
      const oauthToken = await adapter.getOAuthToken();
      const url = new URL("https://api-v2.soundcloud.com/me");
      url.searchParams.set("client_id", clientId);
      let user;
      try {
        user = await http.json(url, { oauthToken });
      } catch (error) {
        if ([401, 403].includes(error?.status)) {
          throw createError("SoundCloud sign-in is required.", "auth_required", error.status);
        }
        throw error;
      }
      if (!user?.id) {
        throw createError("SoundCloud returned an invalid user profile.", "invalid_response");
      }
      return { user, oauthToken };
    }

    function checkedApiCursor(value, path) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "api-v2.soundcloud.com" ||
          url.pathname !== path || url.username || url.password) {
        throw createError("SoundCloud returned an invalid collection cursor.", "invalid_cursor");
      }
      return url;
    }

    async function collectionPage(descriptor, cursor = null, pageSize = 200, formatPreference = "auto") {
      const kind = descriptor?.sourceType;
      const clientId = String(descriptor?.clientId || "");
      const size = Math.min(200, Math.max(1, Number(pageSize) || 200));
      if (!clientId || !["playlist", "likes", "user_tracks"].includes(kind)) {
        throw createError("Collection source descriptor is incomplete.", "invalid_collection_source");
      }
      let values;
      let next = null;
      let collectionOauthToken = null;
      if (kind === "playlist") {
        const sourceUrl = descriptor.sourceUrl;
        const pageUrl = new URL(sourceUrl);
        if (pageUrl.origin !== "https://soundcloud.com" || pageUrl.username || pageUrl.password) {
          throw createError("Playlist source URL is invalid.", "invalid_collection_source");
        }
        const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
        resolveUrl.searchParams.set("url", pageUrl.toString());
        resolveUrl.searchParams.set("client_id", clientId);
        const playlist = await http.json(resolveUrl);
        const entries = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
        const offset = cursor == null ? 0 : Number(/^playlist:(\d+)$/.exec(cursor)?.[1]);
        if (!Number.isSafeInteger(offset) || offset < 0) throw createError("Playlist cursor is invalid.", "invalid_cursor");
        values = entries.slice(offset, offset + size);
        const following = offset + values.length;
        next = following < entries.length ? `playlist:${following}` : null;
      } else {
        const userId = String(descriptor.sourceUserId || "");
        if (!/^\d+$/.test(userId)) throw createError("Collection user is invalid.", "invalid_collection_source");
        const path = kind === "likes" ? `/users/${userId}/likes` : `/users/${userId}/tracks`;
        const url = cursor == null ? new URL(`https://api-v2.soundcloud.com${path}`) : checkedApiCursor(cursor, path);
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("limit", String(size));
        url.searchParams.set("linked_partitioning", "1");
        collectionOauthToken = descriptor.sourceAuthenticated ? await adapter.getOAuthToken() : null;
        const page = await http.json(url, { oauthToken: collectionOauthToken });
        values = (page?.collection || []).map((item) => kind === "likes" ? item?.track : item).filter(Boolean);
        if (page?.next_href) {
          const following = checkedApiCursor(page.next_href, path);
          following.searchParams.set("client_id", clientId);
          next = following.toString();
        }
      }

      const partialIds = values.filter((value) => value?.id && !(value.media?.transcodings?.length || value.downloadable)).map((value) => value.id);
      let hydrated = new Map();
      for (let offset = 0; offset < partialIds.length; offset += 50) {
        const url = new URL("https://api-v2.soundcloud.com/tracks");
        url.searchParams.set("ids", partialIds.slice(offset, offset + 50).join(","));
        url.searchParams.set("client_id", clientId);
        const records = await http.json(url, { oauthToken: collectionOauthToken });
        for (const record of records || []) hydrated.set(String(record.id), record);
      }
      const items = [];
      let unavailable = 0;
      for (const entry of values) {
        const value = hydrated.get(String(entry?.id)) || entry;
        if (!value?.id || !value.title || !(value.media?.transcodings?.length || value.downloadable)) { unavailable += 1; continue; }
        const track = SCDownloadTrack.fromSoundCloud(value, {
          clientId, pageUrl: value.permalink_url || descriptor.sourceUrl || null, formatPreference,
        });
        if (!SCDownloadTrack.canDownload(track)) { unavailable += 1; continue; }
        items.push(track);
      }
      return { items, enumerated: values.length, skipped: { unavailable }, nextCursor: next, done: next == null };
    }

    return { resolve, resolveStream, resolveOriginal, refresh, resolveLoggedInUser, collectionPage };
  }

  function configure(adapter) {
    defaultSource = create(adapter);
    return defaultSource;
  }

  function current() {
    if (!defaultSource) throw new Error("Download source is not initialized.");
    return defaultSource;
  }

  return {
    create,
    configure,
    resolve: (...args) => current().resolve(...args),
    resolveStream: (...args) => current().resolveStream(...args),
    resolveOriginal: (...args) => current().resolveOriginal(...args),
    refresh: (...args) => current().refresh(...args),
    resolveLoggedInUser: (...args) => current().resolveLoggedInUser(...args),
    collectionPage: (...args) => current().collectionPage(...args),
  };
})();
