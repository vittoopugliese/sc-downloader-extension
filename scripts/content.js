let lastUrl = location.href;
let observerRegistered = false;
let urlCheckInterval = null;
let urlChangeTimeout = null;
let lastBulkProgressAt = 0;

const intake = SCPageIntake.create({
  window,
  document,
  fetch: (...args) => fetch(...args),
  runtime: chrome.runtime,
  streamSelector: SCStreamSelector,
  downloadTrack: SCDownloadTrack,
  onData(type, data) {
    chrome.runtime.sendMessage({ type, data }).catch(() => {});
  },
  onInline(trackData) {
    ensureInlineDownloadButton(trackData);
  },
  onRemoveInline() {
    removeInlineDownloadButton();
  },
});

function isSoundCloudLikesPage() {
  return intake.classify() === "likes";
}

function isPersonalLikesPage() {
  return new URL(window.location.href).pathname.toLowerCase() === "/you/likes";
}

function isSoundCloudPlaylistPage() {
  return intake.classify() === "playlist";
}

function isSoundCloudUserTracksPage() {
  return intake.classify() === "user_tracks";
}

function isSoundCloudTrackPage() {
  return intake.classify() === "track";
}

function isSoundCloudCollectionPage() {
  return ["likes", "playlist", "user_tracks"].includes(intake.classify());
}

function reportBulkFetchProgress(loaded, total) {
  const now = Date.now();
  if (now - lastBulkProgressAt < 150) return;
  lastBulkProgressAt = now;
  chrome.runtime
    .sendMessage({
      type: "BULK_FETCH_PROGRESS",
      loaded,
      total: Number.isFinite(total) ? total : loaded,
    })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TRACK_DATA") {
    sendResponse(intake.read(request.forceRefresh === true));
    return true;
  }

  if (request.type === "RESOLVE_LOOP_TRACK_DATA") {
    const pendingTrack = request.trackUrl
      ? intake.resolvePlayerTrack(request.trackUrl)
      : Promise.resolve(intake.getTrack() || intake.extractCurrent());
    pendingTrack
      .then((trackData) => {
        if (!SCDownloadTrack.canDownload(trackData)) {
          throw new Error("The selected loop track has no downloadable source.");
        }
        sendResponse({ success: true, trackData });
      })
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || "Could not resolve the selected loop track.",
        })
      );
    return true;
  }

  if (request.type === "GET_BULK_TRACKS") {
    intake
      .resolveBulk(request.limit ?? null)
      .then((tracks) => sendResponse({ success: true, tracks }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "GET_BULK_SELECTION_LIST") {
    intake
      .selectionList({
        onProgress: reportBulkFetchProgress,
        progressTotal: request.total ?? intake.getCollection()?.totalCount ?? null,
      })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "GET_BULK_TRACKS_BY_IDS") {
    intake
      .tracksByIds(request.ids || [], {
        onProgress: reportBulkFetchProgress,
        progressTotal: intake.getCollection()?.totalCount ?? null,
      })
      .then((tracks) => {
        if (!tracks.length) {
          sendResponse({
            success: false,
            error: "No matching tracks were found for the current selection.",
          });
          return;
        }
        sendResponse({ success: true, tracks });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === "APPLY_FORMAT_PREFERENCE") {
    const data = intake.applyFormat(request.formatPreference);
    sendResponse({ success: true, data });
    return true;
  }

  return false;
});

function scheduleCurrentPageExtraction(delay) {
  if (urlChangeTimeout) clearTimeout(urlChangeTimeout);
  urlChangeTimeout = setTimeout(() => {
    urlChangeTimeout = null;
    if (intake.classify() !== "other") intake.extractCurrent();
  }, delay);
}

function handleUrlChange() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  intake.reset();
  scheduleCurrentPageExtraction(2000);
}

const observer = new MutationObserver(handleUrlChange);

function initScript() {
  if (!observerRegistered) {
    observer.observe(document, { subtree: true, childList: true });
    observerRegistered = true;
  }
  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(handleUrlChange, 750);
  }
  if (intake.classify() !== "other") scheduleCurrentPageExtraction(1254);
}

window.SCDL = {
  getTrackData: () => intake.getTrack(),
  getPlaylistData: () => intake.getCollection(),
  resolvePlayerTrackData: (url) => intake.resolvePlayerTrack(url),
  isTrackPage: isSoundCloudTrackPage,
  isCollectionPage: isSoundCloudCollectionPage,
  isProfileTracksPage: isSoundCloudUserTracksPage,
  resolveBulkTracks: (limit) => intake.resolveBulk(limit),
};

initScript();
