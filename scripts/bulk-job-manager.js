const SESSION_KEY = "scdl_active_job";
const KEEPALIVE_ALARM = "scdl_bulk_keepalive";
const MAX_IN_FLIGHT = 2;
const DOWNLOAD_COMPLETE_TIMEOUT_MS = 5 * 60 * 1000;

let streamDeps = {
  resolveStreamUrl: null,
  refreshTrackMetadata: null,
};

let jobControl = { jobId: null, state: "running" };
let activeLoopPromise = null;
let activeLoopJobId = null;
let inFlightBuildIds = new Set();
let stateQueue = Promise.resolve();

function withJobState(fn) {
  const run = stateQueue.then(fn);
  stateQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function sanitizeFolderName(title) {
  return (title || "SoundCloud Playlist")
    .replace(/[^a-z0-9 -]/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120) || "SoundCloud Playlist";
}

function createJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFileExtension(trackData) {
  return SCFormat.getFileExtension(trackData);
}

function createEmptyTrackStatus(trackCount) {
  return new Array(trackCount).fill(null);
}

function syncJobCountersFromTrackStatus(job) {
  if (!Array.isArray(job.trackStatus)) {
    return;
  }

  job.completed = job.trackStatus.filter((status) => status === "done").length;
  job.currentIndex = job.trackStatus.reduce(
    (max, status, index) =>
      status === "done" || status === "failed" ? Math.max(max, index + 1) : max,
    0
  );
}

function migrateJobTrackStatus(job) {
  if (!job?.tracks?.length) {
    return job;
  }

  if (
    Array.isArray(job.trackStatus) &&
    job.trackStatus.length === job.tracks.length
  ) {
    syncJobCountersFromTrackStatus(job);
    return job;
  }

  const trackStatus = createEmptyTrackStatus(job.tracks.length);

  for (const failure of job.failed || []) {
    const index = (failure.index || 0) - 1;
    if (index >= 0 && index < trackStatus.length) {
      trackStatus[index] = "failed";
    }
  }

  let doneMarked = 0;
  for (
    let index = 0;
    index < trackStatus.length && doneMarked < (job.completed || 0);
    index += 1
  ) {
    if (trackStatus[index] === "failed") {
      continue;
    }

    trackStatus[index] = "done";
    doneMarked += 1;
  }

  job.trackStatus = trackStatus;
  syncJobCountersFromTrackStatus(job);
  return job;
}

function getPendingTrackIndices(job) {
  migrateJobTrackStatus(job);

  const pending = [];
  for (let index = 0; index < job.tracks.length; index += 1) {
    const status = job.trackStatus[index];
    if (status !== "done" && status !== "failed") {
      pending.push(index);
    }
  }

  return pending;
}

function slimTrackForJob(track) {
  return {
    id: track.id || null,
    title: track.title,
    artist: track.artist,
    streamUrl: track.streamUrl,
    streamProtocol: track.streamProtocol,
    streamPreset: track.streamPreset,
    streamMimeType: track.streamMimeType,
    trackAuthorization: track.trackAuthorization,
    clientId: track.clientId,
  };
}

function sanitizeBulkFilename(trackData, extension, index, total) {
  const paddedIndex = String(index + 1).padStart(String(total).length, "0");
  const baseName = `${trackData.artist || "Unknown Artist"} - ${trackData.title || "Untitled"}`
    .replace(/[^a-z0-9 -]/gi, " ")
    .trim();
  return `${paddedIndex} - ${baseName}.${extension}`;
}

async function loadJob() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const job = result[SESSION_KEY] || null;
  return job ? migrateJobTrackStatus(job) : null;
}

async function saveJob(job) {
  if (job) {
    await chrome.storage.session.set({ [SESSION_KEY]: job });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

function getPublicJobSnapshot(job) {
  if (!job) {
    return null;
  }

  migrateJobTrackStatus(job);

  return {
    id: job.id,
    status: job.status,
    playlistTitle: job.playlistTitle,
    folderName: job.folderName,
    total: job.tracks.length,
    currentIndex: job.currentIndex,
    completed: job.completed,
    failed: job.failed,
    currentTrackTitle: job.currentTrackTitle || null,
    currentTrackStatus: job.currentTrackStatus || null,
    artworkUrl: job.artworkUrl || null,
    artist: job.artist || null,
    artistImageUrl: job.artistImageUrl || null,
    artistUrl: job.artistUrl || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
  };
}

function broadcastJobUpdate(job) {
  chrome.runtime
    .sendMessage({ type: "BULK_JOB_UPDATE", job: getPublicJobSnapshot(job) })
    .catch(() => {});
}

async function updateBadge(job) {
  if (!job || !["running", "paused"].includes(job.status)) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  migrateJobTrackStatus(job);
  const done = job.completed + job.failed.length;
  const total = job.tracks.length;
  const text = total > 999 ? `${done}` : `${done}/${total}`;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#FF5500" });
}

async function safeCreateNotification(title, message) {
  const notificationId = `scdl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    await new Promise((resolve, reject) => {
      chrome.notifications.create(
        notificationId,
        {
          type: "basic",
          title,
          message,
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolve();
        }
      );
    });
  } catch {
    // Notifications are optional; never block or throw after a download job.
  }
}

async function notifyJobFinished(job) {
  if (job.status === "completed") {
    const failedCount = job.failed.length;
    const message =
      failedCount > 0
        ? `${job.completed}/${job.tracks.length} tracks saved to Downloads/${job.folderName}. ${failedCount} failed.`
        : `${job.completed}/${job.tracks.length} tracks saved to Downloads/${job.folderName}.`;

    await safeCreateNotification("Download complete", message);
    return;
  }

  if (job.status === "cancelled") {
    await safeCreateNotification(
      "Download cancelled",
      `${job.completed} tracks were saved before cancellation.`
    );
    return;
  }

  if (job.status === "failed") {
    await safeCreateNotification(
      "Download failed",
      job.error || "The bulk download could not be completed."
    );
  }
}

async function startKeepalive() {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}

async function stopKeepalive() {
  await chrome.alarms.clear(KEEPALIVE_ALARM);
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Assemble HLS audio tracks and save them to the Downloads folder.",
  });
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length === 0) {
    return;
  }

  await chrome.offscreen.closeDocument();
}

async function sendOffscreenMessage(message, retries = 12) {
  await ensureOffscreenDocument();
  await sleep(250);

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolve(result);
        });
      });

      if (response !== undefined) {
        return response;
      }
    } catch {
      // Offscreen may still be loading its scripts.
    }

    await sleep(200);
  }

  throw new Error("Could not reach the offscreen audio worker.");
}

async function waitWhilePaused(jobId) {
  while (jobControl.jobId === jobId && jobControl.state === "paused") {
    await sleep(400);
  }
}

function waitForDownloadComplete(
  downloadId,
  timeoutMs = DOWNLOAD_COMPLETE_TIMEOUT_MS
) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(onSettle, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(handleChange);
      onSettle(value);
    }

    function handleChange(delta) {
      if (delta.id !== downloadId || !delta.state) {
        return;
      }

      if (delta.state.current === "complete") {
        settle(resolve, downloadId);
        return;
      }

      if (delta.state.current === "interrupted") {
        settle(reject, new Error("Download was interrupted."));
      }
    }

    const timeoutId = setTimeout(() => {
      settle(reject, new Error("Download timed out."));
    }, timeoutMs);

    chrome.downloads.onChanged.addListener(handleChange);

    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError || settled) {
        return;
      }

      const item = items?.[0];
      if (item?.state === "complete") {
        settle(resolve, downloadId);
      } else if (item?.state === "interrupted") {
        settle(reject, new Error("Download was interrupted."));
      }
    });
  });
}

function downloadBlobUrl(blobUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: blobUrl,
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          reject(new Error(chrome.runtime.lastError?.message || "Download failed."));
          return;
        }

        waitForDownloadComplete(downloadId).then(resolve).catch(reject);
      }
    );
  });
}

async function resolveStreamForTrack(trackData) {
  if (!streamDeps.resolveStreamUrl) {
    throw new Error("Stream resolver is not initialized.");
  }

  let currentTrack = trackData;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!currentTrack?.streamUrl) {
        throw new Error("No downloadable stream was found for this track.");
      }

      const result = await streamDeps.resolveStreamUrl(
        currentTrack.streamUrl,
        currentTrack.clientId,
        currentTrack.trackAuthorization,
        currentTrack.streamProtocol,
        currentTrack.streamPreset,
        currentTrack.streamMimeType
      );

      return result.url;
    } catch (error) {
      lastError = error;
      const shouldRefresh =
        attempt === 0 &&
        currentTrack?.id &&
        currentTrack?.clientId &&
        streamDeps.refreshTrackMetadata &&
        /403|404|401|stream|URL/i.test(error.message || "");

      if (!shouldRefresh) {
        throw error;
      }

      const refreshed = await streamDeps.refreshTrackMetadata(
        currentTrack.id,
        currentTrack.clientId
      );
      currentTrack = { ...currentTrack, ...refreshed };
    }
  }

  throw lastError || new Error("Could not resolve stream URL.");
}

async function abortInFlightBuilds() {
  const buildIds = [...inFlightBuildIds];
  inFlightBuildIds.clear();

  await Promise.all(
    buildIds.map((buildId) =>
      sendOffscreenMessage({ type: "OFFSCREEN_ABORT", buildId }).catch(() => {})
    )
  );
}

async function updateTrackProgress(jobId, trackIndex, total, title, statusText) {
  return withJobState(async () => {
    const job = await loadJob();
    if (!job || job.id !== jobId) {
      return null;
    }

    job.currentTrackTitle = title;
    job.currentTrackStatus = statusText || `Track ${trackIndex + 1}/${total}`;
    await saveJob(job);
    broadcastJobUpdate(job);
    return job;
  });
}

async function recordTrackSuccess(jobId, trackIndex) {
  return withJobState(async () => {
    const job = await loadJob();
    if (!job || job.id !== jobId || !["running", "paused"].includes(job.status)) {
      return null;
    }

    if (job.trackStatus[trackIndex] === "done") {
      return job;
    }

    job.trackStatus[trackIndex] = "done";
    syncJobCountersFromTrackStatus(job);
    job.currentTrackTitle = null;
    job.currentTrackStatus = `Saved ${job.completed}/${job.tracks.length}`;

    await saveJob(job);
    await updateBadge(job);
    broadcastJobUpdate(job);
    return job;
  });
}

async function recordTrackFailure(jobId, trackIndex, title, errorMessage) {
  return withJobState(async () => {
    const job = await loadJob();
    if (!job || job.id !== jobId || !["running", "paused"].includes(job.status)) {
      return null;
    }

    if (job.trackStatus[trackIndex] === "failed") {
      return job;
    }

    job.trackStatus[trackIndex] = "failed";
    job.failed = [
      ...(job.failed || []),
      {
        index: trackIndex + 1,
        title: title || "Unknown track",
        error: errorMessage || "Unknown error",
      },
    ];
    syncJobCountersFromTrackStatus(job);
    job.currentTrackStatus = `Failed: ${title || "Unknown track"}`;

    await saveJob(job);
    await updateBadge(job);
    broadcastJobUpdate(job);
    return job;
  });
}

async function finalizeJob(jobId, status, error) {
  return withJobState(async () => {
    const job = await loadJob();
    if (!job || job.id !== jobId) {
      return null;
    }

    job.status = status;
    job.finishedAt = Date.now();
    job.error = error || null;
    job.currentTrackTitle = null;
    job.currentTrackStatus = null;

    await saveJob(job);
    await updateBadge(job);
    await stopKeepalive();
    await notifyJobFinished(job);
    await closeOffscreenDocument();

    broadcastJobUpdate(job);
    return job;
  });
}

async function processTrack(jobId, trackIndex) {
  let job = await loadJob();
  if (!job || job.id !== jobId) {
    return;
  }

  const trackData = job.tracks[trackIndex];
  const trackNumber = trackIndex + 1;
  const total = job.tracks.length;
  let buildId = null;

  await updateTrackProgress(
    jobId,
    trackIndex,
    total,
    trackData.title,
    `Track ${trackNumber}/${total} - Resolving stream...`
  );

  try {
    const streamUrl = await resolveStreamForTrack(trackData);

    await updateTrackProgress(
      jobId,
      trackIndex,
      total,
      trackData.title,
      `Track ${trackNumber}/${total} - Downloading...`
    );

    buildId = `build_${jobId}_${trackIndex}_${Date.now()}`;
    inFlightBuildIds.add(buildId);

    const buildResult = await sendOffscreenMessage({
      type: "OFFSCREEN_BUILD",
      buildId,
      trackData,
      streamUrl,
    });

    inFlightBuildIds.delete(buildId);
    buildId = null;

    if (!buildResult?.success || !buildResult.blobUrl) {
      throw new Error(buildResult?.error || "Failed to build audio file.");
    }

    job = await loadJob();
    if (!job || job.id !== jobId || jobControl.state === "cancelled") {
      await sendOffscreenMessage({
        type: "OFFSCREEN_REVOKE",
        blobUrl: buildResult.blobUrl,
      }).catch(() => {});
      return;
    }

    const extension = getFileExtension(trackData);
    const filename = sanitizeBulkFilename(trackData, extension, trackIndex, total);

    await updateTrackProgress(
      jobId,
      trackIndex,
      total,
      trackData.title,
      `Track ${trackNumber}/${total} - Saving...`
    );

    await downloadBlobUrl(buildResult.blobUrl, `${job.folderName}/${filename}`);

    await sendOffscreenMessage({
      type: "OFFSCREEN_REVOKE",
      blobUrl: buildResult.blobUrl,
    }).catch(() => {});

    await recordTrackSuccess(jobId, trackIndex);
  } catch (error) {
    if (buildId) {
      inFlightBuildIds.delete(buildId);
      await sendOffscreenMessage({ type: "OFFSCREEN_ABORT", buildId }).catch(() => {});
    }

    if (jobControl.jobId === jobId && jobControl.state === "cancelled") {
      return;
    }

    await recordTrackFailure(
      jobId,
      trackIndex,
      trackData?.title,
      error.message || "Unknown error"
    );
  }
}

async function runJobLoopInternal(jobId) {
  await ensureOffscreenDocument();

  let job = await loadJob();
  if (!job || job.id !== jobId || !["running", "paused"].includes(job.status)) {
    return;
  }

  jobControl = { jobId, state: job.status === "paused" ? "paused" : "running" };

  const inFlight = new Map();

  try {
    while (true) {
      await waitWhilePaused(jobId);

      if (jobControl.jobId === jobId && jobControl.state === "cancelled") {
        break;
      }

      job = await loadJob();
      if (!job || job.id !== jobId || job.status === "cancelled") {
        break;
      }

      while (inFlight.size >= MAX_IN_FLIGHT) {
        await Promise.race(inFlight.values());
        await waitWhilePaused(jobId);

        if (jobControl.state === "cancelled") {
          break;
        }
      }

      if (jobControl.state === "cancelled") {
        break;
      }

      job = await loadJob();
      const pending = getPendingTrackIndices(job).filter(
        (trackIndex) => !inFlight.has(trackIndex)
      );

      if (pending.length === 0) {
        if (inFlight.size === 0) {
          break;
        }

        await Promise.race(inFlight.values());
        continue;
      }

      const trackIndex = pending[0];
      const trackPromise = processTrack(jobId, trackIndex).finally(() => {
        inFlight.delete(trackIndex);
      });
      inFlight.set(trackIndex, trackPromise);
    }

    if (inFlight.size) {
      await Promise.all(inFlight.values());
    }

    job = await loadJob();
    if (!job || job.id !== jobId) {
      return;
    }

    if (jobControl.jobId === jobId && jobControl.state === "cancelled") {
      return;
    }

    if (job.status === "running" && getPendingTrackIndices(job).length === 0) {
      const finalStatus = job.completed > 0 ? "completed" : "failed";
      await finalizeJob(
        jobId,
        finalStatus,
        job.completed > 0 ? null : "Could not download any tracks."
      );
    }
  } catch (error) {
    await finalizeJob(jobId, "failed", error.message || "Bulk download failed.");
  }
}

function runJobLoop(jobId) {
  if (activeLoopPromise && activeLoopJobId === jobId) {
    return activeLoopPromise;
  }

  activeLoopJobId = jobId;
  activeLoopPromise = runJobLoopInternal(jobId).finally(() => {
    if (activeLoopJobId === jobId) {
      activeLoopPromise = null;
      activeLoopJobId = null;
    }
  });

  return activeLoopPromise;
}

function isLoopActive(jobId) {
  return activeLoopPromise !== null && activeLoopJobId === jobId;
}

const BulkJobManager = {
  SESSION_KEY,
  KEEPALIVE_ALARM,

  loadJob,
  saveJob,
  getPublicJobSnapshot,
  sanitizeFolderName,
  updateBadge,
  isLoopActive,

  setStreamDependencies(deps) {
    streamDeps = {
      resolveStreamUrl: deps.resolveStreamUrl,
      refreshTrackMetadata: deps.refreshTrackMetadata,
    };
  },

  async createJob(tracks, playlistTitle, playlistMeta = {}) {
    const existing = await loadJob();
    if (existing && ["running", "paused"].includes(existing.status)) {
      throw new Error("A bulk download is already in progress.");
    }

    const job = {
      id: createJobId(),
      status: "running",
      playlistTitle: playlistTitle || "Untitled playlist",
      folderName: sanitizeFolderName(playlistTitle),
      artworkUrl: playlistMeta.artworkUrl || tracks[0]?.artwork_url || null,
      artist: playlistMeta.artist || tracks[0]?.artist || null,
      artistImageUrl: playlistMeta.artistImageUrl || tracks[0]?.artistImageUrl || null,
      artistUrl: playlistMeta.artistUrl || tracks[0]?.artistUrl || null,
      tracks: tracks.map(slimTrackForJob),
      trackStatus: createEmptyTrackStatus(tracks.length),
      clientId: tracks[0]?.clientId || null,
      currentIndex: 0,
      completed: 0,
      failed: [],
      currentTrackTitle: null,
      currentTrackStatus: null,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
    };

    await saveJob(job);
    await updateBadge(job);
    await startKeepalive();
    jobControl = { jobId: job.id, state: "running" };
    runJobLoop(job.id);

    return getPublicJobSnapshot(job);
  },

  async getStatus() {
    await BulkJobManager.ensureJobRunning();
    const job = await loadJob();
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async pauseJob() {
    const job = await loadJob();
    if (!job || job.status !== "running") {
      return { success: false, error: "No running job to pause." };
    }

    // Pause stops dispatching new tracks; in-flight downloads still finish and save.
    job.status = "paused";
    job.pausedAt = Date.now();
    jobControl = { jobId: job.id, state: "paused" };
    await saveJob(job);
    await updateBadge(job);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async resumeJob() {
    const job = await loadJob();
    if (!job || job.status !== "paused") {
      return { success: false, error: "No paused job to resume." };
    }

    job.status = "running";
    job.pausedAt = null;
    jobControl = { jobId: job.id, state: "running" };
    await saveJob(job);
    await updateBadge(job);
    await startKeepalive();
    runJobLoop(job.id);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async cancelJob() {
    const job = await loadJob();
    if (!job || !["running", "paused"].includes(job.status)) {
      return { success: false, error: "No active job to cancel." };
    }

    jobControl = { jobId: job.id, state: "cancelled" };
    job.status = "cancelled";
    job.finishedAt = Date.now();
    await saveJob(job);
    await abortInFlightBuilds();
    await updateBadge(job);
    await stopKeepalive();
    await notifyJobFinished(job);
    await closeOffscreenDocument();
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async recoverRunningJob() {
    const job = await loadJob();
    if (!job || !["running", "paused"].includes(job.status)) {
      return;
    }

    await updateBadge(job);
    await startKeepalive();
    jobControl = {
      jobId: job.id,
      state: job.status === "paused" ? "paused" : "running",
    };
    runJobLoop(job.id);
  },

  async ensureJobRunning() {
    const job = await loadJob();
    if (!job || !["running", "paused"].includes(job.status)) {
      return;
    }

    if (isLoopActive(job.id)) {
      await updateBadge(job);
      return;
    }

    await BulkJobManager.recoverRunningJob();
  },
};
