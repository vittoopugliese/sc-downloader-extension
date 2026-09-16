importScripts(
  "i18n.js",
  "format-utils.js",
  "player-tools-policy.js",
  "player-tools-access.js",
  "player-tools-commerce.js",
  "directory-storage.js",
  "soundcloud-http.js",
  "stream-selector.js",
  "download-track.js",
  "download-source.js",
  "download-destination.js",
  "track-download-execution.js",
  "bulk-job-manager.js"
);

const t = globalThis.SCDLI18n?.t || ((key) => key);

const UNINSTALL_FEEDBACK_URL = "https://sctd.vpugliese.online/";
const playerToolsCommerce = globalThis.SCPlayerToolsCommerce?.create
  ? globalThis.SCPlayerToolsCommerce.create({
      storage: chrome.storage.local,
      sessionStorage: chrome.storage.session,
      access: SCPlayerToolsAccess,
      version: chrome.runtime.getManifest().version,
    })
  // Narrow fallback for legacy verification harnesses that stub importScripts.
  : {
      getState: async () => ({ status: "free", canCheckout: false }),
      startCheckout: async () => { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
      activate: async () => { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
      track: async () => false,
    };

async function configureUninstallFeedback() {
  const url = new URL(UNINSTALL_FEEDBACK_URL);
  url.searchParams.set("view", "goodbye");
  url.searchParams.set("locale", chrome.i18n.getUILanguage());
  url.searchParams.set("version", chrome.runtime.getManifest().version);
  await chrome.runtime.setUninstallURL(url.toString());
}

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

function errorResponse(error, fallback = t("download_failed")) {
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

function hasEffectivePlaybackTransform(transform) {
  if (!transform || typeof transform !== "object") return false;
  const rate = Number(transform.rate);
  return Number.isFinite(rate) && Math.abs(rate - 1) > 0.0001;
}

async function requestTopFrameLoopTrack(tabId, trackUrl) {
  if (!Number.isInteger(tabId)) {
    throw new Error(t("soundcloud_tab_not_found"));
  }

  const response = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "RESOLVE_LOOP_TRACK_DATA", trackUrl: trackUrl || null },
      { frameId: 0 },
      (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      }
    );
  });

  if (!response?.success || !SCDownloadTrack.canDownload(response.trackData)) {
    throw new Error(
      response?.error || t("resolve_selected_loop_failed")
    );
  }
  return response.trackData;
}

async function resolveLoopTrack(request, sender) {
  if (SCDownloadTrack.canDownload(request.trackData)) {
    return SCDownloadTrack.migrate(request.trackData);
  }
  return requestTopFrameLoopTrack(sender.tab?.id, request.trackUrl);
}

async function openPlayerToolsPanel() {
  await SCPlayerToolsAccess.startTrial();
  const tabs = await chrome.tabs.query({ url: "https://soundcloud.com/*" });
  const existing = tabs.find((tab) => tab.active) || tabs[0];
  const tab = existing || await chrome.tabs.create({ url: "https://soundcloud.com/" });
  if (!Number.isInteger(tab.id)) throw new Error("Could not open a SoundCloud tab.");
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_PLAYER_TOOLS_PANEL" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Open a SoundCloud track, then try Player Tools again."));
        return;
      }
      resolve(response);
    });
  });
  playerToolsCommerce.track("player_tools_opened", { origin: "popup" }).catch(() => {});
  return { tabId: tab.id };
}

chrome.runtime.onInstalled.addListener(() => {
  configureUninstallFeedback().catch(() => {});
  BulkJobManager.recoverRunningJob().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  configureUninstallFeedback().catch(() => {});
  BulkJobManager.recoverRunningJob().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  SCPlayerToolsAccess.endTab(tabId).catch((error) => console.warn("Player Tools session cleanup failed", error.code));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BulkJobManager.KEEPALIVE_ALARM) {
    BulkJobManager.ensureJobRunning().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "BULK_JOB_UPDATE" && ["completed", "failed", "cancelled"].includes(request.job?.status)) {
    playerToolsCommerce.track("download_job_completed", {
      type: "bulk", count: Number.isSafeInteger(request.job.completed) ? request.job.completed : 0,
      result: request.job.status,
    }).catch(() => {});
    return false;
  }

  if (request.type === "GET_PLAYER_TOOLS_SNAPSHOT") {
    return respond(SCPlayerToolsAccess.getSnapshot(sender), sendResponse, (snapshot) => ({ snapshot }));
  }

  if (request.type === "START_PLAYER_TOOLS_TRIAL") {
    return respond(SCPlayerToolsAccess.startTrial(), sendResponse, (snapshot) => ({ snapshot }));
  }

  if (request.type === "GET_PLAYER_TOOLS_COMMERCE") {
    return respond(playerToolsCommerce.getState({ revalidate: request.revalidate === true }), sendResponse, (commerce) => ({ commerce }));
  }

  if (request.type === "START_PLAYER_TOOLS_CHECKOUT") {
    playerToolsCommerce.startCheckout(request.locale)
      .then(async (commerce) => {
        await chrome.tabs.create({ url: commerce.checkoutUrl });
        playerToolsCommerce.track("checkout_started", { surface: request.surface || "popup" }).catch(() => {});
        sendResponse({ success: true, commerce });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "RESTORE_PLAYER_TOOLS_LICENSE") {
    playerToolsCommerce.activate(request)
      .then((commerce) => {
        playerToolsCommerce.track("license_activated", { result: "active" }).catch(() => {});
        sendResponse({ success: true, commerce });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "TRACK_PLAYER_TOOLS_EVENT") {
    return respond(playerToolsCommerce.track(request.name, request.properties, {
      once: request.once === true, scope: request.scope === "session" ? "session" : "lifetime",
    }), sendResponse, (accepted) => ({ accepted }));
  }

  if (request.type === "AUTHORIZE_PLAYER_TOOLS") {
    const authorization = SCPlayerToolsAccess.authorize(sender, request);
    authorization.then((result) => {
      if (!result.allowed && ["pro-required", "trial-expired", "trial-exhausted"].includes(result.code)) {
        playerToolsCommerce.track("paywall_seen", { cause: result.code }, { once: true, scope: "session" }).catch(() => {});
        if (result.code === "pro-required") playerToolsCommerce.track("pro_feature_attempted", { feature: request.operation }).catch(() => {});
      } else if (result.allowed && ["set-rate", "set-effect", "set-preserve-pitch"].includes(request.operation)) {
        playerToolsCommerce.track("player_tools_value_reached", { category: request.operation }, { once: true }).catch(() => {});
      }
    }).catch(() => {});
    return respond(
      authorization,
      sendResponse,
      (result) => result
    );
  }

  if (request.type === "END_PLAYER_TOOLS_SESSION") {
    return respond(
      SCPlayerToolsAccess.endSession(sender, request),
      sendResponse,
      (result) => result
    );
  }

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
        error: t("open_popup_unsupported"),
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
    const authorization = hasEffectivePlaybackTransform(request.playbackTransform)
      ? SCPlayerToolsAccess.authorize(sender, { operation: "export-track-effects" })
      : Promise.resolve({ allowed: true });
    authorization
      .then((access) => {
        if (!access.allowed) {
          const error = new Error("Player Tools Pro is required to download a track with playback effects.");
          error.code = access.code || "pro-required";
          throw error;
        }
        return BulkJobManager.downloadSingleTrack(
          request.trackData,
          request.formatPreference || "auto",
          request.downloadDestination ?? null,
          request.playbackTransform || null
        );
      })
      .then((result) => {
        playerToolsCommerce.track("download_job_completed", { type: "single", count: 1, result: "saved" }).catch(() => {});
        sendResponse(result);
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "OPEN_PLAYER_TOOLS_PANEL") {
    return respond(openPlayerToolsPanel(), sendResponse);
  }

  if (request.type === "DOWNLOAD_LOOP") {
    SCPlayerToolsAccess.authorize(sender, { operation: "export-loop" })
      .then((access) => {
        if (access.allowed) return access;
        const error = new Error("Player Tools Pro is required to export A–B loops.");
        error.code = access.code || "pro-required";
        throw error;
      })
      .then(() => resolveLoopTrack(request, sender))
      .then((trackData) =>
        BulkJobManager.downloadLoop(
          trackData,
          request.formatPreference || trackData.formatPreference || "auto",
          request.trimRange,
          request.playbackTransform || null,
          request.downloadDestination ?? null
        )
      )
      .then((result) => {
        playerToolsCommerce.track("download_job_completed", { type: "loop", count: 1, result: "saved" }).catch(() => {});
        sendResponse(result);
      })
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
  if (request.type === "RETRY_FAILED_BULK_JOB") {
    return respond(BulkJobManager.retryFailedJob(), sendResponse);
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
