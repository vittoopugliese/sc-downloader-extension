importScripts(
  "format-utils.js",
  "directory-storage.js",
  "soundcloud-http.js",
  "stream-selector.js",
  "download-track.js",
  "download-source.js",
  "download-destination.js",
  "track-download-execution.js",
  "bulk-job-manager.js"
);

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      { url: "https://soundcloud.com", name: "oauth_token" },
      (cookie) =>
        cookie?.value
          ? resolve(cookie.value)
          : reject(new Error("No oauth_token cookie"))
    );
  });
}

const downloadSource = SCDownloadSource.configure({
  request: (url, options) => fetch(url, options),
  getOAuthToken,
});

function errorResponse(error, fallback = "Download failed.") {
  return {
    success: false,
    error: error?.message || fallback,
    code: error?.code || "unknown_error",
    status: error?.status,
  };
}

function respond(promise, sendResponse, project = (value) => value) {
  promise
    .then((value) => sendResponse({ success: true, ...project(value) }))
    .catch((error) => sendResponse(errorResponse(error)));
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  BulkJobManager.recoverRunningJob().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  BulkJobManager.recoverRunningJob().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BulkJobManager.KEEPALIVE_ALARM) {
    BulkJobManager.ensureJobRunning().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OFFSCREEN_KEEPALIVE") {
    sendResponse({ success: true });
    return false;
  }

  if (request.type === "OFFSCREEN_BUILD_PROGRESS") {
    return respond(
      BulkJobManager.reportBuildProgress(request.buildId, request.statusText),
      sendResponse,
      (handled) => ({ handled })
    );
  }

  if (request.type === "OPEN_EXTENSION_POPUP") {
    if (typeof chrome.action.openPopup !== "function") {
      sendResponse({
        success: false,
        error: "This browser cannot open the extension popup automatically.",
      });
      return false;
    }

    const options = sender.tab?.windowId
      ? { windowId: sender.tab.windowId }
      : undefined;
    try {
      Promise.resolve(
        options ? chrome.action.openPopup(options) : chrome.action.openPopup()
      )
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse(errorResponse(error)));
    } catch (error) {
      sendResponse(errorResponse(error));
    }
    return true;
  }

  // Compatibility for content/popup instances that outlive a worker upgrade.
  if (request.type === "GET_MP3_URL" || request.type === "GET_STREAM_URL") {
    return respond(
      downloadSource.resolveStream(
        SCDownloadTrack.migrate({
          streamUrl: request.streamUrl,
          clientId: request.clientId,
          trackAuthorization: request.trackAuthorization,
          streamProtocol: request.streamProtocol,
          streamPreset: request.streamPreset,
          streamMimeType: request.streamMimeType,
        })
      ),
      sendResponse
    );
  }

  if (request.type === "GET_ORIGINAL_DOWNLOAD") {
    return respond(
      downloadSource.resolveOriginal(request.trackId, request.clientId),
      sendResponse
    );
  }

  if (request.type === "GET_LOGGED_IN_USER") {
    return respond(
      downloadSource.resolveLoggedInUser(request.clientId),
      sendResponse,
      (profile) => ({ profile })
    );
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
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "DOWNLOAD_SINGLE_TRACK") {
    BulkJobManager.downloadSingleTrack(
      request.trackData,
      request.formatPreference || "auto",
      request.downloadDestination ?? null
    )
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "GET_JOB_STATUS") {
    return respond(BulkJobManager.getStatus(), sendResponse);
  }
  if (request.type === "PAUSE_BULK_JOB") {
    return respond(BulkJobManager.pauseJob(), sendResponse);
  }
  if (request.type === "RESUME_BULK_JOB") {
    return respond(BulkJobManager.resumeJob(), sendResponse);
  }
  if (request.type === "CANCEL_BULK_JOB") {
    return respond(BulkJobManager.cancelJob(), sendResponse);
  }

  if (request.type === "REFRESH_TRACK") {
    return respond(
      downloadSource.refresh(
        request.trackId,
        request.clientId,
        request.formatPreference || "auto"
      ),
      sendResponse,
      (trackData) => ({ trackData })
    );
  }

  return false;
});
