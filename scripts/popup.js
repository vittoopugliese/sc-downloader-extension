const LOADING_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const JOB_POLL_INTERVAL_MS = 1000;
const NOT_TRACK_RETRY_DELAY_MS = 600;
const MAX_NOT_TRACK_RETRIES = 2;
const t = globalThis.SCDLI18n?.t || ((key) => key);
const DEFAULT_DOWNLOAD_STATUS = t("ready_to_download");
const DOWNLOAD_ERROR_STATUS = t("error_retry");
const DOWNLOAD_PRESETS = [10, 25, 50, 100, 150, 200, 300];
const DOWNLOAD_WARN_THRESHOLD = 200;
const SELECT_WARN_THRESHOLD = 1000;
const ROW_HEIGHT = 40;
const MAX_SELECTION_HEIGHT = 8 * ROW_HEIGHT;
const OVERSCAN = 6;
const POPUP_START_VIEW_KEY = "scdl.popup.startView";
// Keep true while reviewing the Pro layout; set false to hide product banners for active Pro users.
const SHOW_PRODUCT_OFFERS_FOR_PRO = true;

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const retryBtn = document.getElementById("retryBtn");
const errorOverlay = document.getElementById("errorOverlay");
const errorRetryBtn = document.getElementById("errorRetryBtn");
const errorTitle = document.getElementById("errorTitle");
const errorMessage = document.getElementById("errorMessage");
const errorHint = document.getElementById("errorHint");
const artwork = document.getElementById("artwork");
const titleEl = document.getElementById("title");
const artistUrl = document.getElementById("artistUrl");
const artistArtwork = document.getElementById("artistArtwork");
const artistEl = document.getElementById("artist");
const durationEl = document.getElementById("duration");
const metaSep = document.getElementById("metaSep");
const streamFormat = document.getElementById("streamFormat");
const downloadFormat = document.getElementById("downloadFormat");
const downloadLimit = document.getElementById("downloadLimit");
const downloadBtn = document.getElementById("downloadBtn");
const jobControls = document.getElementById("jobControls");
const pauseJobBtn = document.getElementById("pauseJobBtn");
const resumeJobBtn = document.getElementById("resumeJobBtn");
const retryFailedJobBtn = document.getElementById("retryFailedJobBtn");
const cancelJobBtn = document.getElementById("cancelJobBtn");
const downloadStatus = document.getElementById("downloadStatus");
const downloadAnnouncement = document.getElementById("downloadAnnouncement");
const jobHint = document.getElementById("jobHint");
const failedSummary = document.getElementById("failedSummary");
const failedDetails = document.getElementById("failedDetails");
const chooseDownloadFolder = document.getElementById("chooseDownloadFolder");
const resetDownloadFolder = document.getElementById("resetDownloadFolder");
const downloadFolderName = document.getElementById("downloadFolderName");
const downloadFormatSlot = document.getElementById("downloadFormatSlot");
const downloadFolderSlot = document.getElementById("downloadFolderSlot");
const selectionPanel = document.getElementById("selectionPanel");
const selectionBackBtn = document.getElementById("selectionBackBtn");
const selectionHeaderOptions = document.getElementById("selectionHeaderOptions");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const selectionViewport = document.getElementById("selectionViewport");
const selectionSpacer = document.getElementById("selectionSpacer");
const selectionRows = document.getElementById("selectionRows");
const helpBtn = document.getElementById("helpBtn");
const helpPanel = document.getElementById("helpPanel");
const helpBackBtn = document.getElementById("helpBackBtn");
const looperPanel = document.getElementById("looperPanel");
const productOffers = document.querySelector(".product-offers");
const playerToolsOffer = document.getElementById("playerToolsOffer");
const playerToolsProBtn = document.getElementById("playerToolsProBtn");
const playerToolsTrialStatus = document.getElementById("playerToolsTrialStatus");
const commercePanel = document.getElementById("commercePanel");
const commerceBuyBtn = document.getElementById("commerceBuyBtn");
const commerceRestoreBtn = document.getElementById("commerceRestoreBtn");
const commerceCloseBtn = document.getElementById("commerceCloseBtn");
const commerceEmail = document.getElementById("commerceEmail");
const commerceLicenseKey = document.getElementById("commerceLicenseKey");
const commerceStatus = document.getElementById("commerceStatus");
const playerToolsReferencePrice = document.getElementById("playerToolsReferencePrice");
const playerToolsPrice = document.getElementById("playerToolsPrice");
const commerceReferencePrice = document.getElementById("commerceReferencePrice");
const commercePrice = document.getElementById("commercePrice");

function setArtistArtwork(image, imageUrl) {
  const fallbackUrl = "./assets/images/default_avatar.png";
  image.onerror = null;

  if (!imageUrl) {
    image.src = fallbackUrl;
    return;
  }

  image.onerror = () => {
    image.onerror = null;
    image.src = fallbackUrl;
  };
  image.src = imageUrl;
}

let isDownloading = false;
let isSelectionMode = false;
let isOpeningSelection = false;
let selectionItems = [];
let selectedIds = new Set();
let previousDownloadLimitValue = "50";
let selectionScrollRaf = null;
let selectionRowsListenerAttached = false;
let activeTabId = null;
let pollIntervalId = null;
let jobPollIntervalId = null;
let loadingStartTime = 0;
let currentTrackData = null;
let currentPlaylistData = null;
let hasRenderedTrack = false;
let downloadListenerAttached = false;
let activeBulkJob = null;
let lastAnnouncedDownloadStatus = "";
let lastAnnouncedBulkState = "";
let notTrackRetryCount = 0;
let currentFormatPreference = SCStreamSelector.DEFAULT_PREFERENCE;
let currentDownloadDestination = null;
let isTestProActive = false;
let helpReturnFocus = null;
let helpSelectionScrollTop = 0;
const popupDownloadIntent = SCDownloadIntent.create(chrome.runtime);

function announceDownloadStatus(message) {
  const text = String(message || "").trim();
  if (!text || text === lastAnnouncedDownloadStatus) return;
  lastAnnouncedDownloadStatus = text;
  downloadAnnouncement.textContent = text;
}

function openHelp() {
  helpReturnFocus = document.activeElement;
  helpSelectionScrollTop = selectionViewport.scrollTop;
  helpPanel.classList.add("is-visible");
  document.body.classList.add("help-mode");
  helpBackBtn.focus();
}

function closeHelp() {
  if (!helpPanel.classList.contains("is-visible")) return;
  helpPanel.classList.remove("is-visible");
  document.body.classList.remove("help-mode");
  if (isSelectionMode) {
    selectionViewport.scrollTop = helpSelectionScrollTop;
    renderVisibleSelectionRows();
  }
  helpReturnFocus?.focus?.();
  helpReturnFocus = null;
}

function trapHelpFocus(event) {
  if (event.key !== "Tab" || !helpPanel.classList.contains("is-visible")) return;
  const focusable = [...helpPanel.querySelectorAll(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length && element.tabIndex >= 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openLooperExplainer() {
  openHelp();
  selectHelpTab(document.getElementById("looperTab"));
}

function selectHelpTab(selected) {
  helpPanel.querySelectorAll('[role="tab"]').forEach((tab) => {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.dataset.helpTab).hidden = !active;
  });
  helpPanel.querySelector(".help-content").scrollTop = 0;
}

async function openRequestedPopupView() {
  try {
    const stored = await chrome.storage.local.get(POPUP_START_VIEW_KEY);
    if (!["looper", "pro"].includes(stored[POPUP_START_VIEW_KEY])) return;
    const requested = stored[POPUP_START_VIEW_KEY];
    await chrome.storage.local.remove(POPUP_START_VIEW_KEY);
    if (requested === "pro") openCommercePanel();
    else openLooperExplainer();
  } catch (error) {
    console.warn("[SC Downloader] Could not restore the requested popup view.", error);
  }
}

let commerceReturnFocus = null;
function openCommercePanel() {
  commerceReturnFocus = document.activeElement;
  commerceStatus.textContent = "";
  document.body.classList.add("commerce-mode");
  commercePanel.hidden = false;
  commerceBuyBtn.focus();
  chrome.runtime.sendMessage({ type: "TRACK_PLAYER_TOOLS_EVENT", name: "paywall_seen",
    properties: { cause: "pro-cta", surface: "popup" }, once: true, scope: "session" }).catch(() => {});
}
function closeCommercePanel() {
  commercePanel.hidden = true;
  document.body.classList.remove("commerce-mode");
  commerceReturnFocus?.focus?.();
  commerceReturnFocus = null;
}

function trapPanelFocus(event, panel) {
  if (event.key !== "Tab" || !panel.classList.contains("is-visible")) return;
  const focusable = [...panel.querySelectorAll(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  SCDLI18n.localizeDocument();
  await loadDownloadDestination();

  helpBtn.addEventListener("click", openHelp);
  helpBackBtn.addEventListener("click", closeHelp);
  const helpTabs = [...helpPanel.querySelectorAll('[role="tab"]')];
  helpTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectHelpTab(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % helpTabs.length;
      if (event.key === "ArrowLeft") next = (index + helpTabs.length - 1) % helpTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = helpTabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectHelpTab(helpTabs[next]);
      helpTabs[next].focus();
    });
  });
  await openRequestedPopupView();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && helpPanel.classList.contains("is-visible")) {
      event.preventDefault();
      closeHelp();
    }
    trapHelpFocus(event);
  });

  const retryTrack = () => {
    hasRenderedTrack = false;
    notTrackRetryCount = 0;
    hideRetryButton();
    showLoading();
    startTrackFlow(true);
  };
  retryBtn.addEventListener("click", retryTrack);
  errorRetryBtn.addEventListener("click", retryTrack);

  pauseJobBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PAUSE_BULK_JOB" }, (response) => {
      if (response?.job) {
        renderBulkJobState(response.job);
      }
    });
  });

  resumeJobBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RESUME_BULK_JOB" }, (response) => {
      if (response?.job) {
        renderBulkJobState(response.job);
      }
    });
  });

  cancelJobBtn.addEventListener("click", () => {
    const proceed = confirm(t("cancel_background_download"));
    if (!proceed) {
      return;
    }

    chrome.runtime.sendMessage({ type: "CANCEL_BULK_JOB" }, (response) => {
      if (response?.job) {
        renderBulkJobState(response.job);
      }
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BULK_JOB_UPDATE" && message.job) {
      activeBulkJob = message.job;
      renderBulkJobState(message.job);
      return;
    }

    if (message.type === "BULK_FETCH_PROGRESS") {
      if (isOpeningSelection || isDownloading) {
        const loaded = message.loaded ?? 0;
        const total = message.total ?? loaded;
        loadingText.textContent = t("loading_tracks_progress", [loaded, total]);
        downloadStatus.textContent = t("loading_tracks_progress", [loaded, total]);
      }
      loadingStartTime = Date.now();
      return;
    }

    if (hasRenderedTrack || isOpeningSelection || isSelectionMode) {
      return;
    }

    if (message.type === "TRACK_DATA" && message.data) {
      loadingStartTime = Date.now();
      renderTrack(message.data);
      return;
    }

    if (message.type === "PLAYLIST_DATA" && message.data) {
      renderPlaylist(message.data);
    }
  });

  selectionBackBtn.addEventListener("click", () => {
    exitSelectionMode();
  });

  selectAllBtn.addEventListener("click", () => {
    selectedIds = new Set(selectionItems.map((item) => item.id));
    updateSelectionCount();
    renderVisibleSelectionRows();
  });

  clearAllBtn.addEventListener("click", () => {
    selectedIds.clear();
    updateSelectionCount();
    renderVisibleSelectionRows();
  });

  chooseDownloadFolder.addEventListener("click", async () => {
    if (isDownloading) {
      return;
    }

    chooseDownloadFolder.disabled = true;
    try {
      currentDownloadDestination = await SCDownloadDirectory.chooseDirectory();
      renderDownloadDestination();
      downloadStatus.textContent = t("saving_to_folder", getDownloadDestinationLabel());
    } catch (error) {
      if (error?.name !== "AbortError") {
        alert(t("choose_folder_failed", error.message));
      }
    } finally {
      chooseDownloadFolder.disabled = isDownloading;
    }
  });

  retryFailedJobBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RETRY_FAILED_BULK_JOB" }, (response) => {
      if (response?.job) {
        activeBulkJob = response.job;
        renderBulkJobState(response.job);
        startJobPolling();
      }
    });
  });

  resetDownloadFolder.addEventListener("click", async () => {
    if (isDownloading) {
      return;
    }

    resetDownloadFolder.disabled = true;
    try {
      await SCDownloadDirectory.clearCurrent();
      currentDownloadDestination = null;
      renderDownloadDestination();
      downloadStatus.textContent = t("saving_to_downloads");
    } catch (error) {
      console.error("Error restoring browser Downloads folder:", error);
      alert(t("restore_downloads_failed", error.message));
    } finally {
      resetDownloadFolder.disabled = false;
    }
  });

  downloadLimit.addEventListener("change", () => {
    if (downloadLimit.value === "select") {
      openSelectionPanel();
    } else {
      previousDownloadLimitValue = downloadLimit.value;
      updateCollectionDownloadHint();
    }
  });

  downloadFormat.addEventListener("change", async () => {
    currentFormatPreference = downloadFormat.value;
    await SCStreamSelector.setStoredFormatPreference(currentFormatPreference);

    if (!activeTabId) {
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      {
        type: "APPLY_FORMAT_PREFERENCE",
        formatPreference: currentFormatPreference,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return;
        }

        if (response?.success && response.data) {
          currentTrackData = response.data;
          const label =
            response.data.streamFormatLabel ||
            (response.data.streamProtocol
              ? response.data.streamProtocol.toUpperCase()
              : "");
          streamFormat.textContent = label;
          streamFormat.style.display = label ? "" : "none";
          configureFormatDropdown(response.data);
        }
      }
    );
  });

  SCStreamSelector.getStoredFormatPreference().then((preference) => {
    currentFormatPreference = preference;
    downloadFormat.value = preference;
  });

  attachSelectionRowsListener();
  selectionViewport.addEventListener("scroll", onSelectionScroll, { passive: true });

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const activeTab = tabs[0];
    activeTabId = activeTab?.id ?? null;

    if (!isSoundCloudPage(activeTab?.url || activeTab?.pendingUrl)) {
      showTrackLoadError("not_track");
      return;
    }

    const jobStatus = await requestJobStatus();
    if (jobStatus?.job && ["running", "paused"].includes(jobStatus.job.status)) {
      activeBulkJob = jobStatus.job;
      renderBulkJobState(jobStatus.job);
      startJobPolling();
      return;
    }

    if (jobStatus?.job && ["completed", "completed_with_errors", "cancelled", "failed", "partial"].includes(jobStatus.job.status)) {
      activeBulkJob = jobStatus.job;
      renderBulkJobSummary(jobStatus.job);
    }

    showLoading();
    startTrackFlow(false);
  });
});

function isSoundCloudPage(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "soundcloud.com";
  } catch {
    return false;
  }
}

async function loadDownloadDestination() {
  try {
    currentDownloadDestination = await SCDownloadDirectory.getCurrent();
  } catch {
    currentDownloadDestination = null;
  }
  renderDownloadDestination();
}

function getDownloadDestinationLabel() {
  return currentDownloadDestination?.name || t("downloads_folder");
}

function formatDownloadSuccess(result) {
  const fileName = result?.fileName || t("track");
  const destinationName = result?.destinationName || getDownloadDestinationLabel();
  return t("saved_file_to", [fileName, destinationName]);
}

async function ensureDownloadDestinationPermission() {
  if (!currentDownloadDestination) {
    return;
  }

  await SCDownloadDirectory.ensurePermission(currentDownloadDestination.id);
}

function renderDownloadDestination() {
  const folderName = currentDownloadDestination?.name || t("folder");
  downloadFolderName.textContent = currentDownloadDestination?.name || t("downloads_folder");
  resetDownloadFolder.classList.toggle("is-hidden", !currentDownloadDestination);
  chooseDownloadFolder.title = currentDownloadDestination
    ? t("change_download_folder", folderName)
    : t("choose_folder");
}

function showDownloadDestination() {
  chooseDownloadFolder.classList.remove("is-hidden");
}

function hideDownloadDestination() {
  chooseDownloadFolder.classList.add("is-hidden");
}

function requestJobStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_JOB_STATUS" }, (response) => {
      resolve(response || { success: false, job: null });
    });
  });
}

function startJobPolling() {
  stopJobPolling();
  jobPollIntervalId = setInterval(async () => {
    const status = await requestJobStatus();
    if (!status?.job) {
      stopJobPolling();
      return;
    }

    activeBulkJob = status.job;
    renderBulkJobState(status.job);

    if (!["running", "paused"].includes(status.job.status)) {
      stopJobPolling();
    }
  }, JOB_POLL_INTERVAL_MS);
}

function stopJobPolling() {
  if (jobPollIntervalId) {
    clearInterval(jobPollIntervalId);
    jobPollIntervalId = null;
  }
}

function renderBulkJobState(job) {
  if (isSelectionMode) {
    exitSelectionMode();
  }

  hasRenderedTrack = true;
  stopPolling();
  hideLoading();
  hideRetryButton();
  errorOverlay.classList.remove("is-visible");

  titleEl.textContent = job.playlistTitle || t("background_download");
  artistEl.textContent = job.artist || t("app_name");
  artistUrl.href = job.artistUrl || "#";
  setArtistArtwork(artistArtwork, job.artistImageUrl);
  durationEl.textContent = t("tracks", job.total);
  streamFormat.style.display = "none";
  hideDownloadLimitSelector();
  metaSep.style.display = "none";
  hideDownloadDestination();

  if (job.artworkUrl) {
    artwork.style.backgroundImage = `url(${job.artworkUrl})`;
    artwork.style.backgroundColor = "";
  } else {
    artwork.style.backgroundImage = "none";
    artwork.style.backgroundColor = "#1a1a1a";
  }

  downloadBtn.classList.add("is-hidden");
  jobControls.classList.add("is-visible");
  jobHint.classList.remove("is-hidden");

  pauseJobBtn.classList.toggle("is-hidden", job.status !== "running");
  resumeJobBtn.classList.toggle("is-hidden", job.status !== "paused");
  retryFailedJobBtn.classList.add("is-hidden");
  cancelJobBtn.classList.toggle("is-hidden", !["running", "paused"].includes(job.status));

  if (job.status === "running" || job.status === "paused") {
    isDownloading = true;
    const statusPrefix = job.status === "paused" ? t("paused") : t("downloading");
    downloadStatus.textContent =
      job.currentTrackStatus ||
      t("job_progress", [statusPrefix, job.completed + (job.failedCount ?? job.failed.length), job.total]);
    const bulkState = `${job.id}:${job.status}`;
    if (bulkState !== lastAnnouncedBulkState) {
      lastAnnouncedBulkState = bulkState;
      announceDownloadStatus(downloadStatus.textContent);
    }
    failedSummary.classList.remove("is-visible");
    failedSummary.textContent = "";
    failedDetails.classList.remove("is-visible");
    failedDetails.replaceChildren();
    return;
  }

  renderBulkJobSummary(job);
}

function renderBulkJobSummary(job) {
  isDownloading = false;
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  pauseJobBtn.classList.add("is-hidden");
  resumeJobBtn.classList.add("is-hidden");
  const hasRetryableFailures = job.canRetry === true;
  retryFailedJobBtn.classList.toggle("is-hidden", !hasRetryableFailures);
  cancelJobBtn.classList.add("is-hidden");
  jobControls.classList.toggle("is-visible", Boolean(hasRetryableFailures));

  if (["completed", "completed_with_errors"].includes(job.status)) {
    const destination = job.destinationName || `${t("downloads_folder")}/${job.folderName}`;
    downloadStatus.textContent = t("saved_tracks_to", [job.completed, job.total, destination]);
  } else if (job.status === "cancelled") {
    downloadStatus.textContent = t("cancelled_after_saving", [job.completed, job.total]);
  } else {
    downloadStatus.textContent = job.error || DOWNLOAD_ERROR_STATUS;
  }
  lastAnnouncedBulkState = `${job.id}:${job.status}`;
  announceDownloadStatus(downloadStatus.textContent);

  if ((job.failedCount ?? job.failed?.length ?? 0) > 0) {
    failedSummary.textContent = t("tracks_failed", job.failedCount ?? job.failed.length);
    failedSummary.classList.add("is-visible");
    failedDetails.replaceChildren(
      ...job.failed.map((failed) => {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        const reason = document.createElement("span");
        item.className = "failed-detail";
        title.textContent = failed.title || t("unknown_track");
        title.title = title.textContent;
        reason.textContent = failed.error || t("error_retry");
        item.append(title, reason);
        return item;
      })
    );
    failedDetails.classList.add("is-visible");
  } else {
    failedSummary.classList.remove("is-visible");
    failedSummary.textContent = "";
    failedDetails.classList.remove("is-visible");
    failedDetails.replaceChildren();
  }
}

function startTrackFlow(forceRefresh) {
  stopPolling();
  notTrackRetryCount = 0;
  loadingStartTime = Date.now();
  requestTrackState(forceRefresh).then(handleTrackState);

  pollIntervalId = setInterval(async () => {
    if (hasRenderedTrack) {
      stopPolling();
      return;
    }

    const state = await requestTrackState(false);
    handleTrackState(state);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

function requestTrackState(forceRefresh) {
  return new Promise((resolve) => {
    if (!activeTabId) {
      resolve({ status: "loading" });
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: "GET_TRACK_DATA", forceRefresh },
      (response) => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message || "";
          resolve({
            status: /receiving end does not exist|could not establish connection/i.test(message)
              ? "reload_required"
              : "loading",
          });
          return;
        }

        if (response?.status === "loaded" && response.data) {
          resolve({
            status: "loaded",
            kind: response.kind || "track",
            data: response.data,
          });
          return;
        }

        if (response?.status === "not_track") {
          resolve({ status: "not_track" });
          return;
        }

        if (response?.status === "error") {
          resolve({ status: "error", code: response.code || "network_error" });
          return;
        }

        resolve({ status: "loading" });
      }
    );
  });
}

function handleTrackState(state) {
  if (hasRenderedTrack) {
    return;
  }

  if (state.status === "loaded") {
    notTrackRetryCount = 0;
    if (state.kind === "playlist") {
      renderPlaylist(state.data);
    } else {
      renderTrack(state.data);
    }
    return;
  }

  if (state.status === "not_track") {
    if (notTrackRetryCount < MAX_NOT_TRACK_RETRIES) {
      notTrackRetryCount += 1;
      loadingStartTime = Date.now();
      setTimeout(async () => {
        if (hasRenderedTrack) {
          return;
        }

        const retryState = await requestTrackState(true);
        handleTrackState(retryState);
      }, NOT_TRACK_RETRY_DELAY_MS);
      return;
    }

    stopPolling();
    hideLoading();
    showTrackLoadError("not_track");
    return;
  }
  if (state.status === "reload_required") {
    stopPolling();
    showTrackLoadError("load_failed");
    return;
  }
  if (state.status === "error") {
    stopPolling();
    showTrackLoadError(state.code);
    return;
  }

  if (Date.now() - loadingStartTime >= LOADING_TIMEOUT_MS) {
    showLoadingTimeout();
  }
}

function showLoading() {
  loadingOverlay.classList.remove("is-hidden");
  loadingText.textContent = t("loading");
  hideRetryButton();
  downloadBtn.classList.add("is-hidden");
  hideDownloadLimitSelector();
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  failedSummary.classList.remove("is-visible");
  errorOverlay.classList.remove("is-visible");
  hideDownloadDestination();
}

function hideLoading() {
  loadingOverlay.classList.add("is-hidden");
}

function showLoadingTimeout() {
  loadingText.textContent = t("loading_track_data");
  retryBtn.classList.add("is-visible");
}

async function getFormatPreference() {
  return currentFormatPreference || SCStreamSelector.DEFAULT_PREFERENCE;
}

function configureFormatDropdown(trackData) {
  const available = trackData?.availableFormats || {};

  for (const option of downloadFormat.options) {
    if (option.value === "auto") {
      option.disabled = false;
      continue;
    }

    if (option.value === "original") {
      option.disabled = !available.original;
      continue;
    }

    option.disabled = !available[option.value];
  }

  downloadFormat.value = trackData?.formatPreference || currentFormatPreference;
  downloadFormat.classList.remove("is-hidden");
}

function showFormatDropdownForBulk() {
  for (const option of downloadFormat.options) {
    option.disabled = false;
  }

  downloadFormat.value = currentFormatPreference;
  downloadFormat.classList.remove("is-hidden");
}

function hideFormatDropdown() {
  downloadFormat.classList.add("is-hidden");
}

function hideRetryButton() {
  retryBtn.classList.remove("is-visible");
}

async function renderTrack(trackData) {
  if (activeBulkJob && ["running", "paused"].includes(activeBulkJob.status)) {
    return;
  }

  hasRenderedTrack = true;
  currentTrackData = trackData;
  currentPlaylistData = null;
  stopPolling();
  hideLoading();
  hideRetryButton();

  titleEl.textContent = trackData.title;
  artistEl.textContent = trackData.artist;
  artistUrl.href = trackData.artistUrl;
  setArtistArtwork(artistArtwork, trackData.artistImageUrl);
  durationEl.textContent = trackData.duration || "";

  if (trackData.artworkUrl) {
    artwork.style.backgroundImage = `url(${trackData.artworkUrl})`;
    artwork.style.backgroundColor = "";
  } else {
    artwork.style.backgroundImage = "none";
    artwork.style.backgroundColor = "black";
  }

  const formatLabel =
    trackData.streamFormatLabel ||
    (trackData.streamProtocol ? trackData.streamProtocol.toUpperCase() : "");

  streamFormat.textContent = formatLabel;
  streamFormat.style.display = formatLabel ? "" : "none";
  hideDownloadLimitSelector();
  configureFormatDropdown(trackData);
  metaSep.style.display = trackData.duration ? "" : "none";

  downloadStatus.textContent = trackData.clientId
    ? DEFAULT_DOWNLOAD_STATUS
    : t("reload_if_download_fails");

  errorOverlay.classList.remove("is-visible");
  downloadBtn.classList.remove("is-hidden");
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  showDownloadDestination();

  attachDownloadListener();
}

function hideDownloadLimitSelector() {
  downloadLimit.classList.add("is-hidden");
}

function hideFormatAndLimitSelectors() {
  hideDownloadLimitSelector();
  hideFormatDropdown();
}

function appendSelectOption() {
  const selectOption = document.createElement("option");
  selectOption.value = "select";
  selectOption.textContent = t("select");
  downloadLimit.appendChild(selectOption);
}

function selectedDownloadLimit() {
  const value = downloadLimit.value;
  if (value === "all" || value === "select") return value;
  if (!/^[1-9]\d*$/.test(value) ||
      ![...downloadLimit.options].some((option) => option.value === value)) {
    return null;
  }
  return Number(value);
}

function updateCollectionDownloadHint() {
  if (!currentPlaylistData) return;
  const selected = selectedDownloadLimit();
  if (selected === "all") {
    downloadStatus.textContent = t("collection_download_all_hint");
  } else if (Number.isSafeInteger(selected)) {
    downloadStatus.textContent = t("collection_download_count_hint", [
      selected,
      currentPlaylistData.totalCount ?? currentPlaylistData.tracks?.length ?? 0,
    ]);
  } else {
    downloadStatus.textContent = t("collection_download_hint");
  }
}

function populateDownloadLimitOptions(total) {
  downloadLimit.innerHTML = "";

  if (!total) {
    hideDownloadLimitSelector();
    metaSep.style.display = "none";
    return;
  }

  if (total <= 25) {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = t("all");
    downloadLimit.appendChild(allOption);
    appendSelectOption();
    downloadLimit.value = "all";
    previousDownloadLimitValue = "all";
    downloadLimit.classList.remove("is-hidden");
    metaSep.style.display = "";
    return;
  }

  const presets = DOWNLOAD_PRESETS.filter((preset) => preset < total);
  let defaultValue = "all";

  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = String(preset);
    option.textContent = String(preset);
    downloadLimit.appendChild(option);
  }

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = t("all");
  downloadLimit.appendChild(allOption);
  appendSelectOption();

  if (total > 50) {
    defaultValue = "50";
  } else if (total > 50 && presets.length) {
    defaultValue = String(presets[presets.length - 1]);
  }

  downloadLimit.value = defaultValue;
  previousDownloadLimitValue = defaultValue;
  downloadLimit.classList.remove("is-hidden");
  metaSep.style.display = "";
}

async function renderPlaylist(playlistData) {
  if (activeBulkJob && ["running", "paused"].includes(activeBulkJob.status)) {
    return;
  }

  if (isSelectionMode) {
    exitSelectionMode();
  }

  hasRenderedTrack = true;
  currentPlaylistData = playlistData;
  currentTrackData = null;
  stopPolling();
  hideLoading();
  hideRetryButton();

  titleEl.textContent = playlistData.title || t("untitled_playlist");
  artistEl.textContent = playlistData.artist || t("unknown_artist");
  artistUrl.href = playlistData.artistUrl || "#";
  setArtistArtwork(artistArtwork, playlistData.artistImageUrl);

  const total =
    playlistData.totalCount ?? playlistData.tracks?.length ?? 0;
  durationEl.textContent = t("tracks", total);
  streamFormat.style.display = "none";
  showFormatDropdownForBulk();
  populateDownloadLimitOptions(total);

  if (playlistData.artworkUrl) {
    artwork.style.backgroundImage = `url(${playlistData.artworkUrl})`;
    artwork.style.backgroundColor = "";
  } else {
    artwork.style.backgroundImage = "none";
    artwork.style.backgroundColor = "black";
  }

  updateCollectionDownloadHint();

  errorOverlay.classList.remove("is-visible");
  downloadBtn.classList.remove("is-hidden");
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  showDownloadDestination();

  attachDownloadListener();

  if (playlistData.kind === "user_tracks") {
    setTimeout(() => {
      openSelectionPanel({ selectAllByDefault: true });
    }, 0);
  }
}

function attachSelectionRowsListener() {
  if (selectionRowsListenerAttached) {
    return;
  }

  selectionRowsListenerAttached = true;

  selectionRows.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (checkbox.type !== "checkbox") {
      return;
    }

    const row = checkbox.closest(".selection-row");
    const trackId = Number(row?.dataset?.id);
    if (!trackId) {
      return;
    }

    if (checkbox.checked) {
      selectedIds.add(trackId);
    } else {
      selectedIds.delete(trackId);
    }

    updateSelectionCount();
  });
}

function onSelectionScroll() {
  if (selectionScrollRaf) {
    cancelAnimationFrame(selectionScrollRaf);
  }

  selectionScrollRaf = requestAnimationFrame(() => {
    selectionScrollRaf = null;
    renderVisibleSelectionRows();
  });
}

function renderVisibleSelectionRows() {
  if (!selectionItems.length) {
    selectionViewport.style.height = "0px";
    selectionSpacer.style.height = "0px";
    selectionRows.innerHTML = "";
    return;
  }

  const scrollTop = selectionViewport.scrollTop;
  const viewportHeight = selectionViewport.clientHeight || 360;
  const total = selectionItems.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  const end = Math.min(total - 1, start + visibleCount + OVERSCAN * 2);

  selectionViewport.style.height = `${Math.min(
    total * ROW_HEIGHT + 2,
    MAX_SELECTION_HEIGHT
  )}px`;
  selectionSpacer.style.height = `${total * ROW_HEIGHT}px`;

  const fragment = document.createDocumentFragment();

  for (let index = start; index <= end; index += 1) {
    const item = selectionItems[index];
    const row = document.createElement("label");
    row.className = "selection-row";
    row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
    row.dataset.index = String(index);
    row.dataset.id = String(item.id);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(item.id);

    const indexSpan = document.createElement("span");
    indexSpan.className = "selection-index";
    indexSpan.textContent = item.indexLabel || String(item.index);

    const titleSpan = document.createElement("span");
    titleSpan.className = "selection-title";
    titleSpan.textContent = item.title;
    titleSpan.title = item.title;

    const durationSpan = document.createElement("span");
    durationSpan.className = "selection-duration";
    durationSpan.textContent = item.duration;

    row.append(checkbox, indexSpan, titleSpan, durationSpan);
    fragment.appendChild(row);
  }

  selectionRows.replaceChildren(fragment);
}

function updateSelectionCount() {
  const count = selectedIds.size;
  downloadStatus.textContent =
    count === 0
      ? t("select_tracks_to_download")
      : count === 1 ? t("track_selected", count) : t("tracks_selected", count);
}

function moveDownloadControlsToSelectionHeader() {
  selectionHeaderOptions.append(
    downloadFormat,
    chooseDownloadFolder,
    resetDownloadFolder
  );
}

function restoreDownloadControlsToTrackMeta() {
  downloadFormatSlot.append(downloadFormat);
  downloadFolderSlot.append(chooseDownloadFolder, resetDownloadFolder);
}

function enterSelectionMode(items, selectAllByDefault = false) {
  isSelectionMode = true;
  selectionItems = items;
  selectedIds = selectAllByDefault
    ? new Set(items.map((item) => item.id))
    : new Set();
  document.body.classList.add("selection-mode");
  selectionPanel.classList.remove("is-hidden");
  selectionPanel.classList.add("is-visible");
  moveDownloadControlsToSelectionHeader();
  downloadLimit.classList.add("is-hidden");
  metaSep.style.display = "none";
  selectionViewport.scrollTop = 0;
  updateSelectionCount();
  renderVisibleSelectionRows();
  downloadBtn.classList.remove("is-hidden");
  showDownloadDestination();
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectionItems = [];
  selectedIds.clear();
  document.body.classList.remove("selection-mode");
  selectionPanel.classList.add("is-hidden");
  selectionPanel.classList.remove("is-visible");
  restoreDownloadControlsToTrackMeta();
  selectionRows.replaceChildren();
  selectionViewport.style.height = "320px";
  selectionSpacer.style.height = "0px";
  selectionViewport.scrollTop = 0;

  if (currentPlaylistData) {
    downloadLimit.value = previousDownloadLimitValue;
    downloadLimit.classList.remove("is-hidden");
    metaSep.style.display = "";
    downloadStatus.textContent = t("collection_download_hint");
  }
}

function restoreCollectionAfterSelectionError() {
  downloadLimit.value = previousDownloadLimitValue;
  downloadLimit.classList.remove("is-hidden");
  downloadBtn.classList.remove("is-hidden");
  showFormatDropdownForBulk();
  showDownloadDestination();
  metaSep.style.display = "";
  downloadStatus.textContent = t("load_selector_failed");
  announceDownloadStatus(downloadStatus.textContent);
}

async function openSelectionPanel(options = {}) {
  if (!currentPlaylistData || isOpeningSelection) {
    return;
  }

  const total =
    currentPlaylistData.totalCount ??
    currentPlaylistData.tracks?.length ??
    0;

  if (total > SELECT_WARN_THRESHOLD) {
    const proceed = confirm(
      t("load_collection_confirm", total)
    );

    if (!proceed) {
      downloadLimit.value = previousDownloadLimitValue;
      return;
    }
  }

  isOpeningSelection = true;
  showLoading();
  loadingText.textContent = t("loading_track_list");

  try {
    const result = await requestBulkSelectionList(total);

    if (!result?.success || !result.items?.length) {
      hideLoading();
      alert(result?.error || t("load_track_list_failed"));
      restoreCollectionAfterSelectionError();
      return;
    }

    hideLoading();
    enterSelectionMode(
      result.items,
      options.selectAllByDefault === true
    );
  } catch (error) {
    console.error("Error opening selection panel:", error);
    hideLoading();
    alert(t("load_tracks_failed", error.message));
    restoreCollectionAfterSelectionError();
  } finally {
    isOpeningSelection = false;
  }
}

async function startSelectedBulkDownload() {
  if (!currentPlaylistData || selectedIds.size === 0) {
    alert(t("select_at_least_one_track"));
    return;
  }

  const selectedCount = selectedIds.size;

  if (selectedCount >= DOWNLOAD_WARN_THRESHOLD) {
    const proceed = confirm(
      t("download_selected_confirm", [selectedCount, getDownloadDestinationLabel()])
    );

    if (!proceed) {
      return;
    }
  }

  const orderedIds = selectionItems
    .filter((item) => selectedIds.has(item.id))
    .map((item) => item.id);

  setDownloadState(true, t("preparing_selected_tracks", selectedCount));

  try {
    await ensureDownloadDestinationPermission();
    const bulkResult = await requestBulkTracksByIds(orderedIds);

    if (!bulkResult?.success || !bulkResult.tracks?.length) {
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(bulkResult?.error || t("no_downloadable_tracks"));
      return;
    }

    const startResult = await popupDownloadIntent.downloadCollection(
      bulkResult.tracks,
      currentPlaylistData,
      {
        formatPreference: await getFormatPreference(),
        downloadDestination: currentDownloadDestination,
      }
    );

    exitSelectionMode();
    activeBulkJob = startResult.job;
    renderBulkJobState(startResult.job);
    startJobPolling();
  } catch (error) {
    console.error("Error starting selected bulk download:", error);
    setDownloadState(false, DOWNLOAD_ERROR_STATUS);
    alert(t("download_failed_detail", error.message));
  }
}

function attachDownloadListener() {
  if (downloadListenerAttached) {
    return;
  }

  downloadListenerAttached = true;

  downloadBtn.addEventListener("click", async () => {
    if (isDownloading) {
      return;
    }

    if (currentPlaylistData) {
      if (isSelectionMode) {
        await startSelectedBulkDownload();
        return;
      }

      if (downloadLimit.value === "select") {
        await openSelectionPanel();
        return;
      }

      const total =
        currentPlaylistData.totalCount ??
        currentPlaylistData.tracks?.length ??
        0;
      const selectedValue = selectedDownloadLimit();
      if (selectedValue === null || selectedValue === "select") {
        alert(t("collection_invalid_limit"));
        return;
      }
      const limit = selectedValue === "all" ? null : selectedValue;
      const effectiveCount = limit ?? total;

      if (effectiveCount >= DOWNLOAD_WARN_THRESHOLD) {
        const proceed = confirm(t("download_collection_confirm", [effectiveCount, getDownloadDestinationLabel()]));

        if (!proceed) {
          return;
        }
      }

      setDownloadState(true, t("fetching_track_list"));

      try {
        await ensureDownloadDestinationPermission();
        const startResult = await popupDownloadIntent.downloadPagedCollection(
          activeTabId,
          currentPlaylistData,
          {
            limit,
            formatPreference: await getFormatPreference(),
            downloadDestination: currentDownloadDestination,
          }
        );

        activeBulkJob = startResult.job;
        renderBulkJobState(startResult.job);
        startJobPolling();
      } catch (error) {
        console.error("Error starting bulk download:", error);
        setDownloadState(false, DOWNLOAD_ERROR_STATUS);
        alert(t("download_failed_detail", error.message));
      }

      return;
    }

    const trackData = currentTrackData;

    if (!trackData) {
      return;
    }

    if (!SCDownloadTrack.canDownload(trackData)) {
      console.error("Cannot obtain stream URL.");
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(t("no_downloadable_stream"));
      return;
    }

    setDownloadState(true, t("resolving_stream"));

    try {
      await ensureDownloadDestinationPermission();
      const formatPreference =
        trackData.formatPreference || (await getFormatPreference());
      const result = await popupDownloadIntent.downloadTrack(trackData, {
        formatPreference,
        downloadDestination: currentDownloadDestination,
      });

      setDownloadState(false, formatDownloadSuccess(result));
    } catch (error) {
      console.error("Error downloading file:", error);
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(t("download_failed_detail", error.message));
    }
  });
}

function showTrackLoadError(reason) {
  if (isSelectionMode) {
    exitSelectionMode();
  }

  hideLoading();
  hideRetryButton();
  downloadBtn.classList.add("is-hidden");
  hideDownloadLimitSelector();
  metaSep.style.display = "none";
  artwork.style.backgroundImage = "none";
  artwork.style.backgroundColor = "#000000";
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  hideDownloadDestination();

  if (reason === "auth_required") {
    errorTitle.textContent = t("track_load_failed");
    errorMessage.textContent = t("auth_required_detail");
    errorHint.textContent = "";
  } else if (reason === "rate_limited") {
    errorTitle.textContent = t("track_load_failed");
    errorMessage.textContent = t("rate_limited_detail");
    errorHint.textContent = "";
  } else if (reason === "network_timeout" || reason === "network_error") {
    errorTitle.textContent = t("track_load_failed");
    errorMessage.textContent = t(reason === "network_timeout" ? "network_timeout_detail" : "network_error_detail");
    errorHint.textContent = "";
  } else if (reason !== "not_track") {
    errorTitle.textContent = t("track_load_failed");
    errorMessage.textContent = t("track_load_failed_detail");
    errorHint.textContent = t("reload_soundcloud");
  } else {
    errorTitle.textContent = t("no_track_selected");
    errorMessage.textContent = t("open_soundcloud_page");
    errorHint.textContent = "";
  }

  errorOverlay.classList.add("is-visible");
  errorRetryBtn.classList.toggle("is-hidden", reason === "not_track" || reason === "auth_required");
}

function setDownloadState(downloading, statusText) {
  isDownloading = downloading;
  downloadBtn.classList.toggle("is-disabled", downloading);
  downloadBtn.classList.toggle("is-loading", downloading);
  chooseDownloadFolder.disabled = downloading;
  resetDownloadFolder.disabled = downloading;

  if (downloading) {
    downloadLimit.classList.add("is-hidden");
    hideFormatDropdown();
    if (currentPlaylistData && !isSelectionMode) {
      metaSep.style.display = "none";
    }
  } else if (currentPlaylistData && !isSelectionMode) {
    downloadLimit.classList.remove("is-hidden");
    showFormatDropdownForBulk();
    metaSep.style.display = "";
  } else if (currentTrackData) {
    configureFormatDropdown(currentTrackData);
  }

  downloadStatus.textContent = statusText || DEFAULT_DOWNLOAD_STATUS;
  announceDownloadStatus(downloadStatus.textContent);
}

function requestFromActiveTab(message) {
  return new Promise((resolve) => {
    if (!activeTabId) {
      resolve({ success: false, error: "No active tab." });
      return;
    }
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      resolve(
        chrome.runtime.lastError
          ? { success: false, error: chrome.runtime.lastError.message }
          : response
      );
    });
  });
}

function requestBulkTracks(limit) {
  return requestFromActiveTab({ type: "GET_BULK_TRACKS", limit });
}

function requestBulkSelectionList(total) {
  return requestFromActiveTab({ type: "GET_BULK_SELECTION_LIST", total });
}

function requestBulkTracksByIds(ids) {
  return requestFromActiveTab({ type: "GET_BULK_TRACKS_BY_IDS", ids });
}

async function syncPlayerToolsOffer() {
  try {
    // Opening the download popup is one of the two product-defined trial entry points.
    await chrome.runtime.sendMessage({ type: "START_PLAYER_TOOLS_TRIAL" });
    const commerceResponse = await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_COMMERCE", revalidate: true });
    const response = await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_SNAPSHOT" });
    const snapshot = response?.snapshot;
    const commerce = commerceResponse?.commerce;
    const offer = commerceResponse?.commerce?.offer;
    if (offer) {
      const format = (cents) => new Intl.NumberFormat(chrome.i18n.getUILanguage(), {
        style: "currency", currency: offer.currency,
      }).format(cents / 100);
      playerToolsReferencePrice.textContent = format(offer.referencePriceCents);
      playerToolsPrice.textContent = format(offer.priceCents);
      commerceReferencePrice.textContent = format(offer.referencePriceCents);
      commercePrice.textContent = `${format(offer.priceCents)} ${offer.currency}`;
    }
    const active = snapshot?.plan === "pro" || commerce?.status === "active";
    isTestProActive = commerce?.licenseId === "test-pro";
    commerceRestoreBtn.textContent = t(isTestProActive ? "player_tools_test_deactivate" : "player_tools_restore");
    productOffers.hidden = active && !SHOW_PRODUCT_OFFERS_FOR_PRO;
    playerToolsOffer.hidden = false;
    playerToolsProBtn.hidden = active && !isTestProActive;
    playerToolsProBtn.textContent = t(isTestProActive ? "player_tools_test_access" : "player_tools_get_pro");
    if (active) {
      playerToolsTrialStatus.textContent = t("player_tools_pro_active");
    } else {
      const trial = snapshot?.trial;
      playerToolsTrialStatus.textContent = snapshot?.state === "trial_expired"
        ? t("player_tools_trial_expired")
        : trial?.isLastDay ? t("player_tools_trial_last_day")
        : t("player_tools_trial_days_remaining", trial?.daysRemaining ?? 7);
      chrome.runtime.sendMessage({ type: "TRACK_PLAYER_TOOLS_EVENT", name: "player_tools_promo_seen",
        properties: { surface: "popup", locale: chrome.i18n.getUILanguage(), plan: "free", trialState: snapshot?.state || "unknown" },
        once: true, scope: "session" }).catch(() => {});
    }
  } catch {
    productOffers.hidden = false;
    playerToolsOffer.hidden = false;
    playerToolsTrialStatus.textContent = "";
  }
}

playerToolsProBtn.addEventListener("click", openCommercePanel);
commerceCloseBtn.addEventListener("click", closeCommercePanel);
commercePanel.addEventListener("click", (event) => { if (event.target === commercePanel) closeCommercePanel(); });
commercePanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeCommercePanel(); return; }
  trapPanelFocus(event, { classList: { contains: () => !commercePanel.hidden }, querySelectorAll: (...args) => commercePanel.querySelectorAll(...args) });
});
commerceBuyBtn.addEventListener("click", async () => {
  commerceBuyBtn.disabled = true;
  commerceStatus.textContent = t("player_tools_checkout_opening");
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_PLAYER_TOOLS_CHECKOUT",
      locale: chrome.i18n.getUILanguage(), surface: "popup" });
    if (!response?.success) throw new Error(response?.error || t("player_tools_checkout_error"));
    commerceStatus.textContent = t("player_tools_checkout_pending");
  } catch (error) { commerceStatus.textContent = error?.message || t("player_tools_checkout_error"); }
  finally { commerceBuyBtn.disabled = false; }
});
commerceRestoreBtn.addEventListener("click", async () => {
  const email = commerceEmail.value.trim();
  const licenseKey = commerceLicenseKey.value.trim();
  const isTestLogin = email === "1" && licenseKey === "1";
  if (!isTestProActive && !isTestLogin && (!email || !licenseKey)) {
    commerceStatus.textContent = t("player_tools_restore_required");
    return;
  }
  commerceRestoreBtn.disabled = true;
  commerceStatus.textContent = t(isTestProActive ? "player_tools_test_deactivating"
    : isTestLogin ? "player_tools_test_working" : "player_tools_restore_working");
  try {
    const response = await chrome.runtime.sendMessage(isTestProActive || isTestLogin
      ? { type: "TEST_PLAYER_TOOLS_PRO", active: !isTestProActive, username: email, password: licenseKey }
      : { type: "RESTORE_PLAYER_TOOLS_LICENSE", email, licenseKey });
    if (!response?.success) throw new Error(response?.error || t(isTestProActive || isTestLogin
      ? "player_tools_test_error" : "player_tools_restore_error"));
    commerceLicenseKey.value = "";
    commerceStatus.textContent = t(isTestProActive ? "player_tools_test_free_success"
      : isTestLogin ? "player_tools_test_success" : "player_tools_restore_success");
    await syncPlayerToolsOffer();
  } catch (error) { commerceStatus.textContent = error?.message || t(isTestProActive || isTestLogin
    ? "player_tools_test_error" : "player_tools_restore_error"); }
  finally { commerceRestoreBtn.disabled = false; }
});

syncPlayerToolsOffer();

window.addEventListener("unload", () => {
  stopPolling();
  stopJobPolling();
});
