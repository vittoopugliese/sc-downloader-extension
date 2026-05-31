const LOADING_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
const DEFAULT_DOWNLOAD_STATUS = "Ready to download";
const DOWNLOAD_ERROR_STATUS = "Error, please retry";
const DOWNLOAD_PRESETS = [10, 25, 50, 100, 150, 200, 300];
const DOWNLOAD_WARN_THRESHOLD = 200;

let isDownloading = false;
let activeTabId = null;
let pollIntervalId = null;
let loadingStartTime = 0;
let currentTrackData = null;
let currentPlaylistData = null;
let hasRenderedTrack = false;
let downloadListenerAttached = false;

document.addEventListener("DOMContentLoaded", () => {
  retryBtn.addEventListener("click", () => {
    hasRenderedTrack = false;
    hideRetryButton();
    showLoading();
    startTrackFlow(true);
  });

  chrome.runtime.onMessage.addListener((message) => {
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

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTabId = tabs[0]?.id ?? null;
    showLoading();
    startTrackFlow(false);
  });
});

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

  downloadStatus.textContent = playlistData.clientId
    ? DEFAULT_DOWNLOAD_STATUS
    : "Tip: reload SoundCloud if download fails without login.";

  errorOverlay.classList.remove("is-visible");
  downloadBtn.classList.remove("is-hidden");

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
        const proceed = confirm(
          `You're about to download ${effectiveCount} tracks in a single ZIP. This may take a long time and use a lot of memory. Continue?`
        );

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

        await downloadAll(currentPlaylistData, bulkResult.tracks);
      } catch (error) {
        console.error("Error fetching bulk tracks:", error);
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

function sanitizeZipEntryFilename(trackData, extension, index, total) {
  const paddedIndex = String(index).padStart(String(total).length, "0");
  const baseName = SCDownload.sanitizeFilename(trackData, extension).replace(/\.[^.]+$/, "");
  return `${paddedIndex} - ${baseName}.${extension}`;
}

function sanitizeZipFilename(title) {
  const sanitizedTitle = (title || "playlist")
    .replace(/[^a-z0-9 -]/gi, " ")
    .trim();
  return `${sanitizedTitle || "playlist"}.zip`;
}

async function resolveStreamForTrack(trackData) {
  if (!trackData.streamUrl) {
    throw new Error("No downloadable stream was found for this track.");
  }

  const result = await chrome.runtime.sendMessage({
    type: "GET_STREAM_URL",
    streamUrl: trackData.streamUrl,
    clientId: trackData.clientId,
    trackAuthorization: trackData.trackAuthorization,
    streamProtocol: trackData.streamProtocol,
    streamPreset: trackData.streamPreset,
    streamMimeType: trackData.streamMimeType,
  });

  if (!result?.success || !result.url) {
    throw new Error(result?.error || "Cannot obtain final file URL.");
  }

  return result.url;
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

async function downloadAll(playlistData, tracks) {
  if (!tracks?.length) {
    setDownloadState(false, DOWNLOAD_ERROR_STATUS);
    alert("No downloadable tracks were found in this playlist.");
    return;
  }

  setDownloadState(true, "Preparing playlist...");

  const zip = new JSZip();
  let successCount = 0;
  const total = tracks.length;

  for (let index = 0; index < tracks.length; index += 1) {
    const trackData = tracks[index];
    const trackNumber = index + 1;

    setDownloadState(
      true,
      `Track ${trackNumber}/${total} - ${trackData.title}`
    );

    try {
      const streamUrl = await resolveStreamForTrack(trackData);
      const { blob, fileName } = await SCDownload.buildTrackBlob(
        streamUrl,
        trackData,
        (status) =>
          setDownloadState(true, `Track ${trackNumber}/${total} - ${status}`)
      );
      const extension = SCDownload.getFileExtension(trackData);
      const zipEntryName = sanitizeZipEntryFilename( trackData, extension, trackNumber, total );

      zip.file(zipEntryName || fileName, blob);
      successCount += 1;
    } catch (error) {
      console.error(`Failed to download track ${trackNumber}:`, error);
    }
  }

  if (!successCount) {
    setDownloadState(false, DOWNLOAD_ERROR_STATUS);
    alert("Could not download any tracks from this playlist.");
    return;
  }

  setDownloadState(true, "Creating ZIP...");
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });
  SCDownload.triggerBlobDownload(zipBlob, sanitizeZipFilename(playlistData.title));
  setDownloadState(false, `Downloaded ${successCount}/${total} tracks`);
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
});
