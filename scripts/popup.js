const LOADING_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const JOB_POLL_INTERVAL_MS = 1000;
const NOT_TRACK_RETRY_DELAY_MS = 600;
const MAX_NOT_TRACK_RETRIES = 2;
const t = globalThis.SCDLI18n?.t || ((key) => key);
const DEFAULT_DOWNLOAD_STATUS = t("ready_to_download");
const DOWNLOAD_ERROR_STATUS = t("error_retry");
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
const downloadToolbar = document.getElementById("downloadToolbar");
const downloadFormat = document.getElementById("downloadFormat");
const downloadLimitControl = document.getElementById("downloadLimitControl");
const downloadLimit = document.getElementById("downloadLimit");
const downloadLimitMenu = document.getElementById("downloadLimitMenu");
const downloadLimitAll = document.getElementById("downloadLimitAll");
const downloadLimitSelect = document.getElementById("downloadLimitSelect");
const downloadBtn = document.getElementById("downloadBtn");
const downloadButtonContainer = document.querySelector(".download-button-container");
const statusRow = document.getElementById("statusRow");
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
const selectionPanel = document.getElementById("selectionPanel");
const selectionBackBtn = document.getElementById("selectionBackBtn");
const selectionHeaderOptions = document.getElementById("selectionHeaderOptions");
const selectionHeaderActions = document.querySelector(".selection-header-actions");
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
const playerToolsPrice = document.getElementById("playerToolsPrice");
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
let selectionAll = false;
let selectionExcludedIds = new Set();
let selectionNextCursor = null;
let selectionDone = true;
let selectionLoadingPage = false;
let selectionTotal = 0;
let previousDownloadLimitValue = "50";
let downloadLimitMode = "number";
let suppressLimitFocus = false;
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
  if (selected?.id === "supportTab") SCContactContent.load();
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
    selectionAll = true;
    selectionExcludedIds.clear();
    selectedIds.clear();
    updateSelectionCount();
    renderVisibleSelectionRows();
  });

  clearAllBtn.addEventListener("click", () => {
    selectionAll = false;
    selectionExcludedIds.clear();
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

  downloadLimit.addEventListener("focus", () => {
    if (suppressLimitFocus) return;
    openDownloadLimitMenu();
    downloadLimit.select();
  });
  downloadLimit.addEventListener("input", () => {
    const total = getCollectionTotal();
    const digits = downloadLimit.value.replace(/\D/g, "");
    const amount = digits ? Math.min(Number(digits), total) : null;
    downloadLimitMode = "number";
    downloadLimit.value = amount === null ? "" : String(amount);
    if (amount !== null) previousDownloadLimitValue = downloadLimit.value;
    downloadLimitAll.setAttribute("aria-selected", "false");
    updateCollectionDownloadHint();
    updateCollectionControlHints();
  });
  downloadLimit.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openDownloadLimitMenu();
      (event.key === "ArrowDown" ? downloadLimitAll : downloadLimitSelect).focus();
    } else if (event.key === "Escape" || event.key === "Enter") {
      closeDownloadLimitMenu();
      if (event.key === "Enter") event.preventDefault();
    }
  });
  downloadLimitAll.addEventListener("click", () => {
    setDownloadLimit("all");
    closeDownloadLimitMenu();
    downloadLimit.focus();
  });
  downloadLimitSelect.addEventListener("click", () => {
    closeDownloadLimitMenu();
    downloadLimit.focus();
    openSelectionPanel();
  });
  downloadLimitMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDownloadLimitMenu();
      suppressLimitFocus = true;
      downloadLimit.focus();
      suppressLimitFocus = false;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      (document.activeElement === downloadLimitAll ? downloadLimitSelect : downloadLimitAll).focus();
    }
  });
  downloadLimitControl.addEventListener("focusout", (event) => {
    if (!downloadLimitControl.contains(event.relatedTarget)) closeDownloadLimitMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!downloadLimitControl.contains(event.target)) closeDownloadLimitMenu();
  });

  downloadFormat.addEventListener("change", async () => {
    currentFormatPreference = downloadFormat.value;
    updateFormatHint(currentTrackData);
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
  resetDownloadFolder.classList.toggle("is-hidden", !currentDownloadDestination);
  chooseDownloadFolder.classList.toggle("has-custom-folder", !!currentDownloadDestination);
  setControlHint(chooseDownloadFolder, currentDownloadDestination
    ? t("change_download_folder", folderName)
    : t("choose_folder"));
}

function showDownloadDestination() {
  chooseDownloadFolder.classList.remove("is-hidden");
  resetDownloadFolder.classList.toggle("is-hidden", !currentDownloadDestination);
}

function hideDownloadDestination() {
  chooseDownloadFolder.classList.add("is-hidden");
  resetDownloadFolder.classList.add("is-hidden");
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
  durationEl.style.display = "";
  downloadToolbar.classList.add("is-hidden");
  hideDownloadLimitSelector();
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

function setControlHint(control, message) {
  control.title = message;
  control.setAttribute("aria-label", message);
}

function formatCount(value) {
  return new Intl.NumberFormat(chrome.i18n.getUILanguage()).format(value);
}

function getCollectionTotal() {
  return currentPlaylistData?.totalCount ?? currentPlaylistData?.tracks?.length ?? 0;
}

function openDownloadLimitMenu() {
  if (downloadLimitControl.classList.contains("is-hidden")) return;
  downloadLimitMenu.hidden = false;
  downloadLimit.setAttribute("aria-expanded", "true");
}

function closeDownloadLimitMenu() {
  downloadLimitMenu.hidden = true;
  downloadLimit.setAttribute("aria-expanded", "false");
}

function setDownloadLimit(value) {
  downloadLimitMode = value === "all" ? "all" : "number";
  downloadLimit.value = value === "all" ? t("all") : String(value);
  previousDownloadLimitValue = value;
  downloadLimitAll.setAttribute("aria-selected", String(value === "all"));
  updateCollectionDownloadHint();
  updateCollectionControlHints();
}

function expectedAutoFormat(trackData) {
  if (trackData?.availableFormats?.original || trackData?.streamFormatLabel === "Original file") return t("original");
  if (trackData?.availableFormats?.mp3) return "MP3";
  if (trackData?.availableFormats?.m4a) return "M4A";
  if (trackData?.availableFormats?.opus) return "Opus";
  const preset = trackData?.streamPreset || "";
  const mimeType = trackData?.streamMimeType || "";
  if (preset.startsWith("mp3") || mimeType.includes("audio/mpeg") || trackData?.streamProtocol === "progressive") return "MP3";
  if (preset.startsWith("aac") || mimeType.includes("mp4")) return "M4A";
  if (preset.includes("opus") || mimeType.includes("opus")) return "Opus";
  return "";
}

function updateFormatHint(trackData = null) {
  const autoOption = downloadFormat.querySelector('option[value="auto"]');
  const expected = trackData ? expectedAutoFormat(trackData) : "";
  const autoLabel = isSelectionMode ? "Auto" : t("auto");
  autoOption.textContent = expected ? `${autoLabel} · ${expected}` : autoLabel;
  const hint = downloadFormat.value === "auto"
    ? expected ? t("auto_format_expected", expected) : t("auto_format_collection")
    : t("download_format_preference", downloadFormat.selectedOptions[0]?.textContent || "");
  setControlHint(downloadFormat, hint);
}

function updateCollectionControlHints() {
  if (!currentPlaylistData) return;
  const total = getCollectionTotal();
  const selected = selectedDownloadLimit();
  const totalLabel = formatCount(total);
  const hint = selected === "all"
    ? t("download_all_count", totalLabel)
    : selected === null
      ? t("download_amount_range", totalLabel)
      : selected === 0
        ? t("download_zero_hint")
      : t("download_part_count", [formatCount(selected), totalLabel]);
  setControlHint(downloadLimit, hint);
  setControlHint(downloadBtn, hint);
  downloadBtn.disabled = selected === null || selected === 0;
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
  updateFormatHint(trackData);
}

function showFormatDropdownForBulk() {
  for (const option of downloadFormat.options) {
    option.disabled = false;
  }

  downloadFormat.value = currentFormatPreference;
  downloadFormat.classList.remove("is-hidden");
  updateFormatHint();
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
  durationEl.style.display = trackData.duration ? "" : "none";
  downloadToolbar.classList.remove("is-hidden");

  if (trackData.artworkUrl) {
    artwork.style.backgroundImage = `url(${trackData.artworkUrl})`;
    artwork.style.backgroundColor = "";
  } else {
    artwork.style.backgroundImage = "none";
    artwork.style.backgroundColor = "black";
  }

  hideDownloadLimitSelector();
  configureFormatDropdown(trackData);
  setControlHint(downloadBtn, t("download_track_hint"));
  downloadBtn.disabled = false;

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
  closeDownloadLimitMenu();
  downloadLimitControl.classList.add("is-hidden");
}

function selectedDownloadLimit() {
  if (downloadLimitMode === "all") return "all";
  if (!/^\d+$/.test(downloadLimit.value)) return null;
  const amount = Number(downloadLimit.value);
  return Number.isSafeInteger(amount) && amount <= getCollectionTotal() ? amount : null;
}

function updateCollectionDownloadHint() {
  if (!currentPlaylistData) return;
  const selected = selectedDownloadLimit();
  if (selected === "all") {
    downloadStatus.textContent = t("collection_download_all_hint");
  } else if (selected === 0) {
    downloadStatus.textContent = t("download_zero_hint");
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
  if (!total) {
    hideDownloadLimitSelector();
    return;
  }
  downloadLimit.maxLength = String(total).length;
  downloadLimitAll.textContent = `${t("all")} · ${formatCount(total)}`;
  setControlHint(downloadLimitAll, t("download_all_count", formatCount(total)));
  downloadLimitControl.classList.remove("is-hidden");
  setDownloadLimit(total <= 50 ? "all" : "50");
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
  durationEl.textContent = "";
  durationEl.style.display = "none";
  downloadToolbar.classList.remove("is-hidden");
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
    const trackId = String(row?.dataset?.id || "");
    if (!trackId) {
      return;
    }

    if (selectionAll) {
      if (checkbox.checked) selectionExcludedIds.delete(trackId);
      else selectionExcludedIds.add(trackId);
    } else if (checkbox.checked) {
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
    if (!selectionDone && !selectionLoadingPage &&
        selectionViewport.scrollTop + selectionViewport.clientHeight >= selectionViewport.scrollHeight - ROW_HEIGHT * 8) {
      loadNextSelectionPage().catch((error) => console.error("Error loading selection page:", error));
    }
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
    const trackId = String(item.id);
    checkbox.checked = selectionAll ? !selectionExcludedIds.has(trackId) : selectedIds.has(trackId);

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
  const count = selectionAll ? Math.max(0, selectionTotal - selectionExcludedIds.size) : selectedIds.size;
  downloadStatus.textContent =
    count === 0
      ? t("select_tracks_to_download")
      : count === 1 ? t("track_selected", count) : t("tracks_selected", count);
  setControlHint(downloadBtn, count === 0
    ? t("select_tracks_to_download")
    : t("download_selected_count", formatCount(count)));
  downloadBtn.disabled = count === 0;
}

function moveControlsToSelectionView() {
  selectionHeaderOptions.append(downloadFormat, chooseDownloadFolder, resetDownloadFolder);
  selectionHeaderActions.append(helpBtn);
  downloadButtonContainer.prepend(downloadBtn);
  updateFormatHint();
}

function restoreControlsToMainView() {
  downloadToolbar.append(downloadFormat, downloadLimitControl, chooseDownloadFolder, resetDownloadFolder, downloadBtn);
  statusRow.prepend(helpBtn);
  updateFormatHint();
}

function enterSelectionMode(page, selectAllByDefault = false, total = null) {
  isSelectionMode = true;
  selectionItems = page.items;
  selectionNextCursor = page.nextCursor ?? null;
  selectionDone = page.done === true || selectionNextCursor == null;
  selectionTotal = Number.isSafeInteger(total) && total >= selectionItems.length ? total : selectionItems.length;
  selectionAll = selectAllByDefault;
  selectionExcludedIds = new Set();
  selectedIds = new Set();
  closeDownloadLimitMenu();
  document.body.classList.add("selection-mode");
  selectionPanel.classList.remove("is-hidden");
  selectionPanel.classList.add("is-visible");
  moveControlsToSelectionView();
  downloadLimitControl.classList.add("is-hidden");
  selectionViewport.scrollTop = 0;
  updateSelectionCount();
  renderVisibleSelectionRows();
  downloadBtn.classList.remove("is-hidden");
  showDownloadDestination();
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectionItems = [];
  selectionAll = false;
  selectionExcludedIds.clear();
  selectionNextCursor = null;
  selectionDone = true;
  selectionTotal = 0;
  selectedIds.clear();
  document.body.classList.remove("selection-mode");
  selectionPanel.classList.add("is-hidden");
  selectionPanel.classList.remove("is-visible");
  restoreControlsToMainView();
  selectionRows.replaceChildren();
  selectionViewport.style.height = "320px";
  selectionSpacer.style.height = "0px";
  selectionViewport.scrollTop = 0;

  if (currentPlaylistData) {
    downloadLimitControl.classList.remove("is-hidden");
    setDownloadLimit(previousDownloadLimitValue);
    updateCollectionDownloadHint();
  }
}

function restoreCollectionAfterSelectionError() {
  downloadLimitControl.classList.remove("is-hidden");
  setDownloadLimit(previousDownloadLimitValue);
  downloadBtn.classList.remove("is-hidden");
  showFormatDropdownForBulk();
  showDownloadDestination();
  updateCollectionControlHints();
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
      updateCollectionControlHints();
      return;
    }
  }

  isOpeningSelection = true;
  showLoading();
  loadingText.textContent = t("loading_track_list");

  try {
    const result = await requestBulkSelectionPage(null);

    if (!result?.success || !result.page?.items?.length) {
      hideLoading();
      alert(result?.error || t("load_track_list_failed"));
      restoreCollectionAfterSelectionError();
      return;
    }

    hideLoading();
    enterSelectionMode(
      result.page,
      options.selectAllByDefault === true,
      total
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
  const selectedCount = selectionAll ? Math.max(0, selectionTotal - selectionExcludedIds.size) : selectedIds.size;
  if (!currentPlaylistData || selectedCount === 0) {
    alert(t("select_at_least_one_track"));
    return;
  }

  if (selectedCount >= DOWNLOAD_WARN_THRESHOLD) {
    const proceed = confirm(
      t("download_selected_confirm", [selectedCount, getDownloadDestinationLabel()])
    );

    if (!proceed) {
      return;
    }
  }

  setDownloadState(true, t("preparing_selected_tracks", selectedCount));

  try {
    await ensureDownloadDestinationPermission();
    const startResult = await popupDownloadIntent.downloadPagedCollection(
      activeTabId,
      currentPlaylistData,
      {
        formatPreference: await getFormatPreference(),
        downloadDestination: currentDownloadDestination,
        selection: selectionAll
          ? { mode: "all_except", ids: selectionExcludedIds }
          : { mode: "explicit", ids: selectedIds },
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

      const total =
        currentPlaylistData.totalCount ??
        currentPlaylistData.tracks?.length ??
        0;
      const selectedValue = selectedDownloadLimit();
      if (selectedValue === null || selectedValue === 0) {
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
  downloadToolbar.classList.add("is-hidden");
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
    downloadLimitControl.classList.add("is-hidden");
    if (!isSelectionMode) hideFormatDropdown();
  } else if (currentPlaylistData && !isSelectionMode) {
    downloadLimitControl.classList.remove("is-hidden");
    showFormatDropdownForBulk();
    updateCollectionControlHints();
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

function requestBulkSelectionPage(cursor) {
  return requestFromActiveTab({ type: "GET_BULK_SELECTION_PAGE", cursor, pageSize: 200 });
}

async function loadNextSelectionPage() {
  if (selectionDone || selectionLoadingPage) return;
  selectionLoadingPage = true;
  try {
    const result = await requestBulkSelectionPage(selectionNextCursor);
    if (!result?.success || !result.page) throw new Error(result?.error || "Could not load the next page.");
    const known = new Set(selectionItems.map((item) => String(item.id)));
    for (const item of result.page.items || []) if (!known.has(String(item.id))) selectionItems.push(item);
    selectionNextCursor = result.page.nextCursor ?? null;
    selectionDone = result.page.done === true || selectionNextCursor == null;
    renderVisibleSelectionRows();
  } finally {
    selectionLoadingPage = false;
  }
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
      playerToolsPrice.textContent = format(offer.priceCents);
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
