importScripts(
  "format-utils.js",
  "directory-storage.js",
  "stream-selector.js",
  "bulk-job-manager.js"
);

chrome.runtime.onInstalled.addListener(() => {
  BulkJobManager.recoverRunningJob();
});

chrome.runtime.onStartup.addListener(() => {
  BulkJobManager.recoverRunningJob();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BulkJobManager.KEEPALIVE_ALARM) {
    BulkJobManager.ensureJobRunning().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OPEN_EXTENSION_POPUP") {
    if (typeof chrome.action.openPopup !== "function") {
      sendResponse({
        success: false,
        error: "This browser cannot open the extension popup automatically.",
      });
      return false;
    }

    const popupOptions = sender.tab?.windowId
      ? { windowId: sender.tab.windowId }
      : undefined;

    try {
      const openPopup = popupOptions
        ? chrome.action.openPopup(popupOptions)
        : chrome.action.openPopup();

      Promise.resolve(openPopup)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error.message || "Could not open the extension popup.",
          })
        );
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message || "Could not open the extension popup.",
      });
    }
    return true;
  }

  if (request.type === "GET_MP3_URL" || request.type === "GET_STREAM_URL") {
    resolveStreamUrl(
      request.streamUrl,
      request.clientId,
      request.trackAuthorization,
      request.streamProtocol,
      request.streamPreset,
      request.streamMimeType
    )
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
          code: error.code || "unknown_error",
          status: error.status,
        })
      );

    return true;
  }

  if (request.type === "GET_ORIGINAL_DOWNLOAD") {
    resolveOriginalDownload(request.trackId, request.clientId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
          code: error.code || "unknown_error",
          status: error.status,
        })
      );

    return true;
  }

  if (request.type === "GET_LOGGED_IN_USER") {
    resolveLoggedInUserProfile(request.clientId)
      .then((profile) => sendResponse({ success: true, profile }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );

    return true;
  }

  if (request.type === "START_BULK_JOB") {
    BulkJobManager.createJob(
      request.tracks,
      request.playlistTitle,
      request.playlistMeta || {},
      request.formatPreference || "auto",
      request.downloadDestination ?? null
    )
      .then((job) => sendResponse({ success: true, job }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "DOWNLOAD_SINGLE_TRACK") {
    BulkJobManager.downloadSingleTrack(
      request.trackData,
      request.formatPreference || "auto",
      request.downloadDestination ?? null
    )
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message || "Download failed.",
        })
      );
    return true;
  }

  if (request.type === "GET_JOB_STATUS") {
    BulkJobManager.getStatus().then(sendResponse);
    return true;
  }

  if (request.type === "PAUSE_BULK_JOB") {
    BulkJobManager.pauseJob().then(sendResponse);
    return true;
  }

  if (request.type === "RESUME_BULK_JOB") {
    BulkJobManager.resumeJob().then(sendResponse);
    return true;
  }

  if (request.type === "CANCEL_BULK_JOB") {
    BulkJobManager.cancelJob().then(sendResponse);
    return true;
  }

  if (request.type === "REFRESH_TRACK") {
    refreshTrackMetadata(
      request.trackId,
      request.clientId,
      request.formatPreference || "auto"
    )
      .then((trackData) => sendResponse({ success: true, trackData }))
      .catch((error) =>
        sendResponse({ success: false, error: error.message })
      );
    return true;
  }

  return false;
});

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      { url: "https://soundcloud.com", name: "oauth_token" },
      (cookie) => {
        if (cookie?.value) {
          resolve(cookie.value);
        } else {
          reject(new Error("No oauth_token cookie"));
        }
      }
    );
  });
}

function buildStreamError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getHttpErrorMessage(status) {
  if (status === 401) {
    return "SoundCloud rejected the request (401). This track may require login.";
  }

  if (status === 403) {
    return "Access denied (403). This track may be private or region-restricted.";
  }

  if (status === 404) {
    return "Stream link expired (404). Play the track on SoundCloud, then try again.";
  }

  return `HTTP error! status: ${status}`;
}

async function requestStreamUrl(streamUrl, options) {
  const { clientId, oauthToken, trackAuthorization } = options;
  const requestUrl = new URL(streamUrl);

  if (clientId) {
    requestUrl.searchParams.set("client_id", clientId);
  } else if (!oauthToken) {
    throw buildStreamError(
      "Could not obtain client_id. Reload the SoundCloud page and try again.",
      "missing_client_id"
    );
  }

  if (trackAuthorization) {
    requestUrl.searchParams.set("track_authorization", trackAuthorization);
  }

  const headers = {
    Accept: "application/json",
    Origin: "https://soundcloud.com",
    Referer: "https://soundcloud.com/",
  };

  if (oauthToken) {
    headers.Authorization = `OAuth ${oauthToken}`;
  }

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw buildStreamError(
      getHttpErrorMessage(response.status),
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not_found"
            : "http_error",
      response.status
    );
  }

  const streamData = await response.json();

  if (!streamData.url) {
    throw buildStreamError(
      "SoundCloud did not return a playable stream URL.",
      "empty_stream_url"
    );
  }

  return streamData.url;
}

async function resolveStreamUrl(
  streamUrl,
  clientId,
  trackAuthorization,
  streamProtocol,
  streamPreset,
  streamMimeType
) {
  const attempts = [];

  if (clientId) {
    attempts.push({
      label: "public",
      clientId,
      trackAuthorization,
    });
  }

  let oauthToken = null;
  try {
    oauthToken = await getOAuthToken();
    attempts.push({
      label: "oauth",
      oauthToken,
      clientId,
      trackAuthorization,
    });
  } catch {
    // No logged-in session available.
  }

  if (!attempts.length) {
    throw buildStreamError(
      "Could not obtain client_id. Reload the SoundCloud page and try again.",
      "missing_client_id"
    );
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const url = await requestStreamUrl(streamUrl, attempt);

      return {
        url,
        protocol: streamProtocol || null,
        preset: streamPreset || null,
        mimeType: streamMimeType || null,
        authMode: attempt.label,
      };
    } catch (error) {
      lastError = error;

      if (![401, 403, 404].includes(error.status)) {
        throw error;
      }
    }
  }

  if (lastError?.status === 404) {
    throw buildStreamError(
      "Stream link expired (404). Play the track on SoundCloud, then try again.",
      "not_found",
      404
    );
  }

  if (lastError?.status === 403) {
    throw buildStreamError(
      "Could not download this track. It may be private, region-restricted, or require login.",
      "forbidden",
      403
    );
  }

  if (lastError?.status === 401) {
    throw buildStreamError(
      "Could not access the stream without login. Try signing in to SoundCloud.",
      "unauthorized",
      401
    );
  }

  throw lastError || buildStreamError("Could not resolve stream URL.", "unknown_error");
}

async function requestOriginalDownloadUrl(trackId, options) {
  const { clientId, oauthToken } = options;

  if (!clientId && !oauthToken) {
    throw buildStreamError(
      "Could not obtain client_id. Reload the SoundCloud page and try again.",
      "missing_client_id"
    );
  }

  const requestUrl = new URL(
    `https://api-v2.soundcloud.com/tracks/${trackId}/download`
  );

  if (clientId) {
    requestUrl.searchParams.set("client_id", clientId);
  }

  const headers = {
    Accept: "application/json",
    Origin: "https://soundcloud.com",
    Referer: "https://soundcloud.com/",
  };

  if (oauthToken) {
    headers.Authorization = `OAuth ${oauthToken}`;
  }

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw buildStreamError(
      getHttpErrorMessage(response.status),
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : "http_error",
      response.status
    );
  }

  const downloadData = await response.json();
  const url = downloadData.redirectUri || downloadData.redirect_uri;

  if (!url) {
    throw buildStreamError(
      "SoundCloud did not return an original download URL.",
      "empty_download_url"
    );
  }

  return url;
}

async function resolveOriginalDownload(trackId, clientId) {
  const attempts = [];

  if (clientId) {
    attempts.push({ clientId });
  }

  let oauthToken = null;
  try {
    oauthToken = await getOAuthToken();
    attempts.push({
      clientId,
      oauthToken,
    });
  } catch {
    // No logged-in session available.
  }

  if (!attempts.length) {
    throw buildStreamError(
      "Could not obtain client_id. Reload the SoundCloud page and try again.",
      "missing_client_id"
    );
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const url = await requestOriginalDownloadUrl(trackId, attempt);

      return {
        url,
        original: true,
        mimeType: null,
      };
    } catch (error) {
      lastError = error;

      if (![401, 403].includes(error.status)) {
        throw error;
      }
    }
  }

  if (lastError?.status === 403) {
    throw buildStreamError(
      "Original download is not available for this track.",
      "forbidden",
      403
    );
  }

  if (lastError?.status === 401) {
    throw buildStreamError(
      "Original download requires login. Sign in to SoundCloud and try again.",
      "unauthorized",
      401
    );
  }

  throw lastError || buildStreamError("Could not resolve original download.", "unknown_error");
}

async function refreshTrackMetadata(trackId, clientId, formatPreference = "auto") {
  const attempts = [];

  if (clientId) {
    attempts.push({ clientId });
  }

  try {
    const oauthToken = await getOAuthToken();
    attempts.push({ clientId, oauthToken });
  } catch {
    // No logged-in session available.
  }

  if (!attempts.length) {
    throw new Error("Could not obtain client_id for track refresh.");
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const requestUrl = new URL("https://api-v2.soundcloud.com/tracks");
      requestUrl.searchParams.set("ids", String(trackId));

      if (attempt.clientId) {
        requestUrl.searchParams.set("client_id", attempt.clientId);
      }

      const headers = {
        Accept: "application/json",
        Origin: "https://soundcloud.com",
        Referer: "https://soundcloud.com/",
      };

      if (attempt.oauthToken) {
        headers.Authorization = `OAuth ${attempt.oauthToken}`;
      }

      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const error = new Error(
          `Failed to refresh track metadata (${response.status}).`
        );
        error.status = response.status;

        if ([401, 403, 404].includes(response.status) && attempts.length > 1) {
          lastError = error;
          continue;
        }

        throw error;
      }

      const tracks = await response.json();
      const track = tracks?.[0];

      if (!track) {
        throw new Error("Track metadata was not found.");
      }

      const streamInfo = SCStreamSelector.extractStreamInfo(track, formatPreference);

      return {
        id: track.id,
        title: track.title,
        artist: track.user?.username || "Unknown Artist",
        coverUrl: track.artwork_url?.replace("-large", "-t500x500") || null,
        album: track.publisher_metadata?.album_title || null,
        genre: track.genre || null,
        year:
          track.release_year ||
          (track.created_at ? new Date(track.created_at).getFullYear() : null),
        isrc: track.publisher_metadata?.isrc || null,
        streamUrl: streamInfo?.url || null,
        streamProtocol: streamInfo?.protocol || null,
        streamPreset: streamInfo?.preset || null,
        streamMimeType: streamInfo?.mimeType || null,
        trackAuthorization: track.track_authorization || null,
        downloadable: track.downloadable === true,
        hasDownloadsLeft: track.has_downloads_left !== false,
        clientId: attempt.clientId || clientId,
      };
    } catch (error) {
      lastError = error;

      if ([401, 403, 404].includes(error.status) && attempts.length > 1) {
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error("Could not refresh track metadata.");
}

async function resolveLoggedInUserProfile(clientId) {
  if (!clientId) {
    throw new Error("Missing client_id.");
  }

  const oauthToken = await getOAuthToken();
  const requestUrl = new URL("https://api-v2.soundcloud.com/me");
  requestUrl.searchParams.set("client_id", clientId);

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Origin: "https://soundcloud.com",
      Referer: "https://soundcloud.com/",
      Authorization: `OAuth ${oauthToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      "Could not resolve logged-in user. Sign in to SoundCloud and try again."
    );
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("SoundCloud did not return a logged-in user profile.");
  }

  return { user, oauthToken };
}

BulkJobManager.setStreamDependencies({
  resolveStreamUrl,
  resolveOriginalDownload,
  refreshTrackMetadata,
});
