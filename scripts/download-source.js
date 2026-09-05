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

    async function resolve(trackData, formatPreference = "auto") {
      let track = SCDownloadTrack.migrate(trackData);
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
      if (!clientId) throw new Error("Missing client_id.");
      const oauthToken = await adapter.getOAuthToken();
      const url = new URL("https://api-v2.soundcloud.com/me");
      url.searchParams.set("client_id", clientId);
      const user = await http.json(url, { oauthToken });
      if (!user?.id) {
        throw new Error("SoundCloud did not return a logged-in user profile.");
      }
      return { user, oauthToken };
    }

    return { resolve, resolveStream, resolveOriginal, refresh, resolveLoggedInUser };
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
  };
})();
