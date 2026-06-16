const LOADING_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const JOB_POLL_INTERVAL_MS = 1000;
const NOT_TRACK_RETRY_DELAY_MS = 600;
const MAX_NOT_TRACK_RETRIES = 2;
const DEFAULT_DOWNLOAD_STATUS = "Ready to download";
const DOWNLOAD_ERROR_STATUS = "Error, please retry";
const DOWNLOAD_PRESETS = [10, 25, 50, 100];
const DOWNLOAD_WARN_THRESHOLD = 200;
const SELECT_WARN_THRESHOLD = 1000;
const ROW_HEIGHT = 40;
const OVERSCAN = 6;

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const retryBtn = document.getElementById("retryBtn");
const errorOverlay = document.getElementById("errorOverlay");
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
const waveformCanvas = document.getElementById("waveformCanvas");
const downloadBtn = document.getElementById("downloadBtn");
const jobControls = document.getElementById("jobControls");
const pauseJobBtn = document.getElementById("pauseJobBtn");
const resumeJobBtn = document.getElementById("resumeJobBtn");
const cancelJobBtn = document.getElementById("cancelJobBtn");
const downloadStatus = document.getElementById("downloadStatus");
const jobHint = document.getElementById("jobHint");
const failedSummary = document.getElementById("failedSummary");
const selectionPanel = document.getElementById("selectionPanel");
const selectionBackBtn = document.getElementById("selectionBackBtn");
const selectionCount = document.getElementById("selectionCount");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const selectionViewport = document.getElementById("selectionViewport");
const selectionSpacer = document.getElementById("selectionSpacer");
const selectionRows = document.getElementById("selectionRows");

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
let notTrackRetryCount = 0;
let currentFormatPreference = SCStreamSelector.DEFAULT_PREFERENCE;

document.addEventListener("DOMContentLoaded", () => {
  retryBtn.addEventListener("click", () => {
    hasRenderedTrack = false;
    notTrackRetryCount = 0;
    hideRetryButton();
    showLoading();
    startTrackFlow(true);
  });

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
    const proceed = confirm("Cancel the background download? Files already saved will be kept.");
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
        loadingText.textContent = `Loading tracks ${loaded}/${total}...`;
        downloadStatus.textContent = `Loading tracks ${loaded}/${total}...`;
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

  downloadLimit.addEventListener("change", () => {
    if (downloadLimit.value === "select") {
      openSelectionPanel();
    } else {
      previousDownloadLimitValue = downloadLimit.value;
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
    activeTabId = tabs[0]?.id ?? null;

    const jobStatus = await requestJobStatus();
    if (jobStatus?.job && ["running", "paused"].includes(jobStatus.job.status)) {
      activeBulkJob = jobStatus.job;
      renderBulkJobState(jobStatus.job);
      startJobPolling();
      return;
    }

    if (jobStatus?.job && ["completed", "cancelled", "failed"].includes(jobStatus.job.status)) {
      activeBulkJob = jobStatus.job;
      renderBulkJobSummary(jobStatus.job);
    }

    showLoading();
    startTrackFlow(false);
  });
});

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

  titleEl.textContent = job.playlistTitle || "Background download";
  artistEl.textContent = job.artist || "SoundCloud Downloader";
  artistUrl.href = job.artistUrl || "#";
  artistArtwork.src = job.artistImageUrl || "./assets/icon48.png";
  durationEl.textContent = `${job.total} tracks`;
  streamFormat.style.display = "none";
  hideDownloadLimitSelector();
  metaSep.style.display = "none";
  waveformCanvas.style.display = "none";

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
  cancelJobBtn.classList.toggle("is-hidden", !["running", "paused"].includes(job.status));

  if (job.status === "running" || job.status === "paused") {
    isDownloading = true;
    const statusPrefix = job.status === "paused" ? "Paused" : "Downloading";
    downloadStatus.textContent =
      job.currentTrackStatus ||
      `${statusPrefix}: ${job.completed + job.failed.length}/${job.total}`;
    failedSummary.classList.remove("is-visible");
    failedSummary.textContent = "";
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
  cancelJobBtn.classList.add("is-hidden");

  if (job.status === "completed") {
    downloadStatus.textContent = `Saved ${job.completed}/${job.total} tracks to Downloads/${job.folderName}`;
  } else if (job.status === "cancelled") {
    downloadStatus.textContent = `Cancelled after saving ${job.completed}/${job.total} tracks.`;
  } else {
    downloadStatus.textContent = job.error || DOWNLOAD_ERROR_STATUS;
  }

  if (job.failed?.length) {
    failedSummary.textContent = `${job.failed.length} track(s) failed.`;
    failedSummary.classList.add("is-visible");
  } else {
    failedSummary.classList.remove("is-visible");
    failedSummary.textContent = "";
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
          resolve({ status: "loading" });
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

  if (Date.now() - loadingStartTime >= LOADING_TIMEOUT_MS) {
    showLoadingTimeout();
  }
}

function showLoading() {
  loadingOverlay.classList.remove("is-hidden");
  loadingText.textContent = "Loading...";
  hideRetryButton();
  downloadBtn.classList.add("is-hidden");
  hideDownloadLimitSelector();
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");
  failedSummary.classList.remove("is-visible");
  errorOverlay.classList.remove("is-visible");
}

function hideLoading() {
  loadingOverlay.classList.add("is-hidden");
}

function showLoadingTimeout() {
  loadingText.textContent = "Still loading track data...";
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

async function refreshTrackDataBeforeDownload(trackData, formatPreference) {
  if (!trackData?.id || !trackData?.clientId) {
    return trackData;
  }

  try {
    const refreshed = await SCStreamSelector.refreshTrackFromApi(
      trackData.id,
      trackData.clientId,
      formatPreference
    );
    return { ...trackData, ...refreshed, formatPreference };
  } catch {
    return trackData;
  }
}

async function resolveTrackDownloadUrl(trackData) {
  const formatPreference = trackData.formatPreference || (await getFormatPreference());

  return SCStreamSelector.resolveDownloadSource(trackData, {
    formatPreference,
    refreshTrack: (trackId, clientId, preference) =>
      SCStreamSelector.refreshTrackFromApi(trackId, clientId, preference),
    getOriginal: async (trackId, clientId) => {
      const result = await chrome.runtime.sendMessage({
        type: "GET_ORIGINAL_DOWNLOAD",
        trackId,
        clientId,
      });

      if (!result?.success) {
        throw new Error(result?.error || "Original download failed.");
      }

      return result;
    },
    getStream: async (currentTrack) => {
      const result = await chrome.runtime.sendMessage({
        type: "GET_STREAM_URL",
        streamUrl: currentTrack.streamUrl,
        clientId: currentTrack.clientId,
        trackAuthorization: currentTrack.trackAuthorization,
        streamProtocol: currentTrack.streamProtocol,
        streamPreset: currentTrack.streamPreset,
        streamMimeType: currentTrack.streamMimeType,
      });

      if (!result?.success || !result.url) {
        const error = new Error(result?.error || "Cannot obtain final file URL.");
        error.result = result;
        throw error;
      }

      return result;
    },
  });
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
  artistArtwork.src = trackData.artistImageUrl || "./assets/icon48.png";
  durationEl.textContent = trackData.duration || "";

  if (trackData.artwork_url) {
    artwork.style.backgroundImage = `url(${trackData.artwork_url})`;
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
    : "Tip: reload SoundCloud if download fails without login.";

  errorOverlay.classList.remove("is-visible");
  downloadBtn.classList.remove("is-hidden");
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");

  if (trackData.waveform_url) {
    await drawWaveform(trackData.waveform_url);
  }

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
  selectOption.textContent = "Select ";
  downloadLimit.appendChild(selectOption);
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
    allOption.textContent = "All";
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
  allOption.textContent = "All";
  downloadLimit.appendChild(allOption);
  appendSelectOption();

  if (total >= 50) {
    defaultValue = "50";
  } else if (presets.length) {
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

  titleEl.textContent = playlistData.title || "Untitled playlist";
  artistEl.textContent = playlistData.artist || "Unknown artist";
  artistUrl.href = playlistData.artistUrl || "#";
  artistArtwork.src = playlistData.artistImageUrl || "./assets/icon48.png";

  const total =
    playlistData.totalCount ?? playlistData.tracks?.length ?? 0;
  durationEl.textContent = `${total} tracks`;
  streamFormat.style.display = "none";
  showFormatDropdownForBulk();
  populateDownloadLimitOptions(total);

  if (playlistData.artwork_url) {
    artwork.style.backgroundImage = `url(${playlistData.artwork_url})`;
    artwork.style.backgroundColor = "";
  } else {
    artwork.style.backgroundImage = "none";
    artwork.style.backgroundColor = "black";
  }

  downloadStatus.textContent =
    "Saves individual files to a Downloads folder. You can close this popup while downloading.";

  errorOverlay.classList.remove("is-visible");
  downloadBtn.classList.remove("is-hidden");
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");

  const firstTrackWaveform = playlistData.tracks?.[0]?.waveform_url;
  if (firstTrackWaveform) {
    await drawWaveform(firstTrackWaveform);
  } else {
    waveformCanvas.style.display = "none";
  }

  attachDownloadListener();
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
  selectionCount.textContent =
    count === 1 ? "1 selected" : `${count} selected`;
  downloadStatus.textContent =
    count === 0
      ? "Select tracks to download"
      : `${count} track${count === 1 ? "" : "s"} selected`;
}

function enterSelectionMode(items) {
  isSelectionMode = true;
  selectionItems = items;
  selectedIds = new Set();
  document.body.classList.add("selection-mode");
  selectionPanel.classList.remove("is-hidden");
  selectionPanel.classList.add("is-visible");
  downloadLimit.classList.add("is-hidden");
  metaSep.style.display = "none";
  waveformCanvas.style.display = "none";
  selectionViewport.scrollTop = 0;
  updateSelectionCount();
  renderVisibleSelectionRows();
  downloadBtn.classList.remove("is-hidden");
  downloadStatus.textContent = "Select tracks to download";
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectionItems = [];
  selectedIds.clear();
  document.body.classList.remove("selection-mode");
  selectionPanel.classList.add("is-hidden");
  selectionPanel.classList.remove("is-visible");
  selectionRows.replaceChildren();
  selectionSpacer.style.height = "0px";
  selectionViewport.scrollTop = 0;

  if (currentPlaylistData) {
    downloadLimit.value = previousDownloadLimitValue;
    downloadLimit.classList.remove("is-hidden");
    metaSep.style.display = "";
    downloadStatus.textContent =
      "Saves individual files to a Downloads folder. You can close this popup while downloading.";
  }
}

async function openSelectionPanel() {
  if (!currentPlaylistData || isOpeningSelection) {
    return;
  }

  const total =
    currentPlaylistData.totalCount ??
    currentPlaylistData.tracks?.length ??
    0;

  if (total > SELECT_WARN_THRESHOLD) {
    const proceed = confirm(
      `This collection has ${total} tracks. Loading the full list may take a while. Continue?`
    );

    if (!proceed) {
      downloadLimit.value = previousDownloadLimitValue;
      return;
    }
  }

  isOpeningSelection = true;
  showLoading();
  loadingText.textContent = "Loading track list...";

  try {
    const result = await requestBulkSelectionList(total);

    if (!result?.success || !result.items?.length) {
      hideLoading();
      alert(result?.error || "Could not load the track list.");
      downloadLimit.value = previousDownloadLimitValue;
      return;
    }

    hideLoading();
    enterSelectionMode(result.items);
  } catch (error) {
    console.error("Error opening selection panel:", error);
    hideLoading();
    alert(`Could not load tracks: ${error.message}`);
    downloadLimit.value = previousDownloadLimitValue;
  } finally {
    isOpeningSelection = false;
  }
}

async function startSelectedBulkDownload() {
  if (!currentPlaylistData || selectedIds.size === 0) {
    alert("Select at least one track to download.");
    return;
  }

  const selectedCount = selectedIds.size;

  if (selectedCount >= DOWNLOAD_WARN_THRESHOLD) {
    const proceed = confirm(
      `Download ${selectedCount} selected tracks as individual files in your Downloads folder? You can close this popup and the download will continue. Continue?`
    );

    if (!proceed) {
      return;
    }
  }

  const orderedIds = selectionItems
    .filter((item) => selectedIds.has(item.id))
    .map((item) => item.id);

  setDownloadState(true, `Preparing ${selectedCount} selected tracks...`);

  try {
    const bulkResult = await requestBulkTracksByIds(orderedIds);

    if (!bulkResult?.success || !bulkResult.tracks?.length) {
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(bulkResult?.error || "No downloadable tracks were found.");
      return;
    }

    const startResult = await chrome.runtime.sendMessage({
      type: "START_BULK_JOB",
      tracks: bulkResult.tracks,
      playlistTitle: currentPlaylistData.title,
      playlistMeta: {
        artworkUrl: currentPlaylistData.artwork_url || null,
        artist: currentPlaylistData.artist || null,
        artistImageUrl: currentPlaylistData.artistImageUrl || null,
        artistUrl: currentPlaylistData.artistUrl || null,
      },
      formatPreference: await getFormatPreference(),
    });

    if (!startResult?.success || !startResult.job) {
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(startResult?.error || "Could not start the background download.");
      return;
    }

    exitSelectionMode();
    activeBulkJob = startResult.job;
    renderBulkJobState(startResult.job);
    startJobPolling();
  } catch (error) {
    console.error("Error starting selected bulk download:", error);
    setDownloadState(false, DOWNLOAD_ERROR_STATUS);
    alert(`Download failed: ${error.message}`);
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
      const selectedValue = downloadLimit.value;
      const limit = selectedValue === "all" ? null : Number(selectedValue);
      const effectiveCount = limit ?? total;

      if (effectiveCount >= DOWNLOAD_WARN_THRESHOLD) {
        const proceed = confirm(`Download ${effectiveCount} tracks as individual files in your Downloads folder? You can close this popup and the download will continue. Or open the popup and select specific track count. Continue?`);

        if (!proceed) {
          return;
        }
      }

      setDownloadState(true, "Fetching track list...");

      try {
        const bulkResult = await requestBulkTracks(limit);

        if (!bulkResult?.success || !bulkResult.tracks?.length) {
          setDownloadState(false, DOWNLOAD_ERROR_STATUS);
          alert(bulkResult?.error || "No downloadable tracks were found.");
          return;
        }

        const startResult = await chrome.runtime.sendMessage({
          type: "START_BULK_JOB",
          tracks: bulkResult.tracks,
          playlistTitle: currentPlaylistData.title,
          playlistMeta: {
            artworkUrl: currentPlaylistData.artwork_url || null,
            artist: currentPlaylistData.artist || null,
            artistImageUrl: currentPlaylistData.artistImageUrl || null,
            artistUrl: currentPlaylistData.artistUrl || null,
          },
          formatPreference: await getFormatPreference(),
        });

        if (!startResult?.success || !startResult.job) {
          setDownloadState(false, DOWNLOAD_ERROR_STATUS);
          alert(startResult?.error || "Could not start the background download.");
          return;
        }

        activeBulkJob = startResult.job;
        renderBulkJobState(startResult.job);
        startJobPolling();
      } catch (error) {
        console.error("Error starting bulk download:", error);
        setDownloadState(false, DOWNLOAD_ERROR_STATUS);
        alert(`Download failed: ${error.message}`);
      }

      return;
    }

    const trackData = currentTrackData;

    if (!trackData) {
      return;
    }

    if (!trackData.streamUrl && !(trackData.downloadable && trackData.hasDownloadsLeft)) {
      console.error("Cannot obtain stream URL.");
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert("Error #33: No downloadable stream was found for this track.");
      return;
    }

    setDownloadState(true, "Resolving stream...");

    try {
      const formatPreference =
        trackData.formatPreference || (await getFormatPreference());
      const refreshedTrack = await refreshTrackDataBeforeDownload(
        trackData,
        formatPreference
      );
      currentTrackData = refreshedTrack;
      const resolved = await resolveTrackDownloadUrl(refreshedTrack);

      try {
        await SCDownload.forceDownload(
          resolved.url,
          resolved.trackData,
          (status) => setDownloadState(true, status)
        );
        setDownloadState(false, "Download completed, enjoy");
      } catch (downloadError) {
        console.error("Error downloading file:", downloadError);
        setDownloadState(false, DOWNLOAD_ERROR_STATUS);
        alert(`Download failed: ${downloadError.message}`);
      }
    } catch (error) {
      console.error("Error resolving download URL:", error);
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(formatResolveError(error.result || { error: error.message }));
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
  waveformCanvas.style.display = "none";
  artwork.style.backgroundImage = "none";
  artwork.style.backgroundColor = "#000000";
  jobControls.classList.remove("is-visible");
  jobHint.classList.add("is-hidden");

  if (reason === "load_failed") {
    errorTitle.textContent = "Couldn't load this track";
    errorMessage.textContent =
      "Something went wrong while reading the track data.";
    errorHint.textContent = "Try reloading the SoundCloud page.";
  } else {
    errorTitle.textContent = "No track selected";
    errorMessage.textContent = "Open a Track, Playlist or Likes page to download it";
    errorHint.textContent = "";
  }

  errorOverlay.classList.add("is-visible");
}

function setDownloadState(downloading, statusText) {
  isDownloading = downloading;
  downloadBtn.classList.toggle("is-disabled", downloading);
  downloadBtn.classList.toggle("is-loading", downloading);

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
}

function formatResolveError(result) {
  const code = result?.code;
  const message = result?.error || "Cannot obtain final file URL.";

  if (code === "missing_client_id") {
    return `Error #11: ${message}`;
  }

  if (code === "forbidden") {
    return `Error #11: ${message}`;
  }

  if (code === "unauthorized") {
    return `Error #11: ${message}`;
  }

  if (code === "not_found") {
    return `Error #11: ${message}`;
  }

  return `Error #11: ${message}`;
}

function requestBulkTracks(limit) {
  return new Promise((resolve) => {
    if (!activeTabId) {
      resolve({ success: false, error: "No active tab." });
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: "GET_BULK_TRACKS", limit },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        resolve(response);
      }
    );
  });
}

function requestBulkSelectionList(total) {
  return new Promise((resolve) => {
    if (!activeTabId) {
      resolve({ success: false, error: "No active tab." });
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: "GET_BULK_SELECTION_LIST", total },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        resolve(response);
      }
    );
  });
}

function requestBulkTracksByIds(ids) {
  return new Promise((resolve) => {
    if (!activeTabId) {
      resolve({ success: false, error: "No active tab." });
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: "GET_BULK_TRACKS_BY_IDS", ids },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        resolve(response);
      }
    );
  });
}

async function drawWaveform(waveformUrl) {
  const ctx = waveformCanvas.getContext("2d");

  try {
    const waveformResponse = await fetch(waveformUrl);
    const waveformData = await waveformResponse.json();

    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    ctx.fillStyle = "rgba(240, 240, 240, 0.5)";

    const samples = waveformData.samples || [];
    if (!samples.length) {
      waveformCanvas.style.display = "none";
      return;
    }

    const maxSample = Math.max(...samples.map(Math.abs)) || 1;
    const canvasHeight = waveformCanvas.height;
    const canvasWidth = waveformCanvas.width;
    const barWidth = canvasWidth / samples.length;

    samples.forEach((sample, index) => {
      const normalizedSample = sample / maxSample;
      const barHeight = Math.abs(normalizedSample) * (canvasHeight / 2);
      const x = index * barWidth;
      const y = canvasHeight / 2 - barHeight / 2;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    waveformCanvas.style.display = "flex";
  } catch (error) {
    console.error("Error drawing Waveform:", error);
    waveformCanvas.style.display = "none";
  }
}

window.addEventListener("unload", () => {
  stopPolling();
  stopJobPolling();
});
