const LOADING_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
const JOB_POLL_INTERVAL_MS = 1000;
const DEFAULT_DOWNLOAD_STATUS = "Ready to download";
const DOWNLOAD_ERROR_STATUS = "Error, please retry";
const DOWNLOAD_PRESETS = [10, 25, 50, 100, 150, 200, 300];
const DOWNLOAD_WARN_THRESHOLD = 200;

let isDownloading = false;
let activeTabId = null;
let pollIntervalId = null;
let jobPollIntervalId = null;
let loadingStartTime = 0;
let currentTrackData = null;
let currentPlaylistData = null;
let hasRenderedTrack = false;
let downloadListenerAttached = false;
let activeBulkJob = null;

document.addEventListener("DOMContentLoaded", () => {
  retryBtn.addEventListener("click", () => {
    hasRenderedTrack = false;
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

    if (hasRenderedTrack) {
      return;
    }

    if (message.type === "TRACK_DATA" && message.data) {
      renderTrack(message.data);
      return;
    }

    if (message.type === "PLAYLIST_DATA" && message.data) {
      renderPlaylist(message.data);
    }
  });

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
  hasRenderedTrack = true;
  stopPolling();
  hideLoading();
  hideRetryButton();
  errorOverlay.classList.remove("is-visible");

  title.textContent = job.playlistTitle || "Background download";
  artist.textContent = job.artist || "SoundCloud Downloader";
  artistUrl.href = job.artistUrl || "#";
  artistArtwork.src = job.artistImageUrl || "./assets/icon48.png";
  duration.textContent = `${job.total} tracks`;
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
    if (state.kind === "playlist") {
      renderPlaylist(state.data);
    } else {
      renderTrack(state.data);
    }
    return;
  }

  if (state.status === "not_track") {
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
  loadingText.textContent = "Could not load track.";
  retryBtn.classList.add("is-visible");
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

  title.textContent = trackData.title;
  artist.textContent = trackData.artist;
  artistUrl.href = trackData.artistUrl;
  artistArtwork.src = trackData.artistImageUrl || "./assets/icon48.png";
  duration.textContent = trackData.duration || "";

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
  const showSeparator = Boolean(trackData.duration) && Boolean(formatLabel);
  streamFormat.style.display = formatLabel ? "" : "none";
  hideDownloadLimitSelector();
  metaSep.style.display = showSeparator ? "" : "none";

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
    downloadLimit.value = "all";
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

  if (total >= 50) {
    defaultValue = "50";
  } else if (presets.length) {
    defaultValue = String(presets[presets.length - 1]);
  }

  downloadLimit.value = defaultValue;
  downloadLimit.classList.remove("is-hidden");
  metaSep.style.display = "";
}

async function renderPlaylist(playlistData) {
  if (activeBulkJob && ["running", "paused"].includes(activeBulkJob.status)) {
    return;
  }

  hasRenderedTrack = true;
  currentPlaylistData = playlistData;
  currentTrackData = null;
  stopPolling();
  hideLoading();
  hideRetryButton();

  title.textContent = playlistData.title || "Untitled playlist";
  artist.textContent = playlistData.artist || "Unknown artist";
  artistUrl.href = playlistData.artistUrl || "#";
  artistArtwork.src = playlistData.artistImageUrl || "./assets/icon48.png";

  const total =
    playlistData.totalCount ?? playlistData.tracks?.length ?? 0;
  duration.textContent = `${total} tracks`;
  streamFormat.style.display = "none";
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

    if (!trackData.streamUrl) {
      console.error("Cannot obtain stream URL.");
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert("Error #33: No downloadable stream was found for this track.");
      return;
    }

    setDownloadState(true, "Resolving stream...");

    try {
      const result = await chrome.runtime.sendMessage({
        type: "GET_STREAM_URL",
        streamUrl: trackData.streamUrl,
        clientId: trackData.clientId,
        trackAuthorization: trackData.trackAuthorization,
        streamProtocol: trackData.streamProtocol,
        streamPreset: trackData.streamPreset,
        streamMimeType: trackData.streamMimeType,
      });

      if (result?.success && result.url) {
        try {
          await SCDownload.forceDownload(result.url, trackData, (status) => setDownloadState(true, status));
          setDownloadState(false, "Download completed, enjoy");
        } catch (downloadError) {
          console.error("Error downloading file:", downloadError);
          setDownloadState(false, DOWNLOAD_ERROR_STATUS);
          alert(`Download failed: ${downloadError.message}`);
        }
      } else {
        console.error("Error: " + (result?.error || "Cannot obtain final file URL."));
        setDownloadState(false, DOWNLOAD_ERROR_STATUS);
        alert(formatResolveError(result));
      }
    } catch (error) {
      console.error("Error communicating with Background Script. " + error.message);
      setDownloadState(false, DOWNLOAD_ERROR_STATUS);
      alert(`Error #22: ${error.message}`);
    }
  });
}

function showTrackLoadError(reason) {
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
    errorMessage.textContent =
      "Open a SoundCloud track or playlist page to download it. You're currently on the home or another page.";
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
    if (currentPlaylistData) {
      metaSep.style.display = "none";
    }
  } else if (currentPlaylistData) {
    downloadLimit.classList.remove("is-hidden");
    metaSep.style.display = "";
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
