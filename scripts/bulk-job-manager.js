const SESSION_KEY = "scdl_active_job";
const KEEPALIVE_ALARM = "scdl_bulk_keepalive";
const RECOVER_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
// Keep audio assembly sequential. Two decoded/combined tracks can exhaust memory
// on Chromebooks and other constrained devices even when network concurrency is safe.
const MAX_IN_FLIGHT = 1;
const JOB_STATUS = Object.freeze({
  RUNNING: "running",
  PAUSED: "paused",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  COMPLETED_WITH_ERRORS: "completed_with_errors",
  FAILED: "failed",
});
const TRACK_STATUS = Object.freeze({
  DONE: "done",
  FAILED: "failed",
  SAVING: "saving",
  AMBIGUOUS: "ambiguous_save",
});
const ACTIVE_JOB_STATUSES = Object.freeze([
  JOB_STATUS.RUNNING,
  JOB_STATUS.PAUSED,
]);
const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.CANCELLED,
  JOB_STATUS.COMPLETED,
  JOB_STATUS.COMPLETED_WITH_ERRORS,
  JOB_STATUS.FAILED,
]);
const JOB_TRANSITIONS = Object.freeze({
  [JOB_STATUS.RUNNING]: new Set([
    JOB_STATUS.PAUSED,
    ...TERMINAL_JOB_STATUSES,
  ]),
  [JOB_STATUS.PAUSED]: new Set([
    JOB_STATUS.RUNNING,
    ...TERMINAL_JOB_STATUSES,
  ]),
  [JOB_STATUS.COMPLETED]: new Set([JOB_STATUS.RUNNING]),
  [JOB_STATUS.COMPLETED_WITH_ERRORS]: new Set([JOB_STATUS.RUNNING]),
  [JOB_STATUS.FAILED]: new Set([JOB_STATUS.RUNNING]),
});

let jobControl = { jobId: null, state: null };
let activeLoopPromise = null;
let activeLoopJobId = null;
let stateQueue = Promise.resolve();
let singleDownloadQueue = Promise.resolve();
let creatingOffscreenDocument = null;
let singleDownloadsInFlight = 0;

function withJobState(fn) {
  const run = stateQueue.then(fn);
  stateQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function queueSingleDownload(fn) {
  const run = singleDownloadQueue.then(fn);
  singleDownloadQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function sanitizeFolderName(title) {
  return SCFormat.sanitizePathComponent(
    title,
    "SoundCloud Playlist",
    120
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActiveJobStatus(status) {
  return ACTIVE_JOB_STATUSES.includes(status);
}

function transitionJob(job, nextStatus, options = {}) {
  if (!JOB_TRANSITIONS[job.status]?.has(nextStatus)) {
    throw new Error(`Illegal bulk job transition: ${job.status} -> ${nextStatus}`);
  }

  job.status = nextStatus;
  if (nextStatus === JOB_STATUS.PAUSED) job.pausedAt = Date.now();
  if (nextStatus === JOB_STATUS.RUNNING) job.pausedAt = null;
  if (TERMINAL_JOB_STATUSES.includes(nextStatus)) {
    job.finishedAt = Date.now();
    if (Object.hasOwn(options, "error")) job.error = options.error || null;
    job.currentTrackTitle = null;
    job.currentTrackStatus = null;
  }
}

function syncJobCountersFromTrackStatus(job) {
  if (!Array.isArray(job.trackStatus)) return;
  job.completed = job.trackStatus.filter(
    (status) => status === TRACK_STATUS.DONE
  ).length;
  job.currentIndex = job.trackStatus.reduce(
    (max, status, index) =>
      status === TRACK_STATUS.DONE || status === TRACK_STATUS.FAILED || status === TRACK_STATUS.AMBIGUOUS
        ? Math.max(max, index + 1)
        : max,
    0
  );
}

function migrateJobTrackStatus(job) {
  if (!job?.tracks?.length) return job;

  job.tracks = job.tracks.map((track) =>
    SCDownloadTrack.toDurable(track, job.playlistTitle)
  );

  if (job.trackStatus?.length === job.tracks.length) {
    syncJobCountersFromTrackStatus(job);
    return job;
  }

  const trackStatus = new Array(job.tracks.length).fill(null);

  for (const failure of job.failed || []) {
    const index = (failure.index || 0) - 1;
    if (index >= 0 && index < trackStatus.length) {
      trackStatus[index] = TRACK_STATUS.FAILED;
    }
  }

  let doneMarked = 0;
  for (
    let index = 0;
    index < trackStatus.length && doneMarked < (job.completed || 0);
    index += 1
  ) {
    if (trackStatus[index] === TRACK_STATUS.FAILED) continue;
    trackStatus[index] = TRACK_STATUS.DONE;
    doneMarked += 1;
  }

  job.trackStatus = trackStatus;
  syncJobCountersFromTrackStatus(job);
  return job;
}

function getPendingTrackIndices(job) {
  migrateJobTrackStatus(job);
  return job.trackStatus
    .map((status, index) => ({ status, index }))
    .filter(
      ({ status }) =>
        status !== TRACK_STATUS.DONE && status !== TRACK_STATUS.FAILED && status !== TRACK_STATUS.AMBIGUOUS
    )
    .map(({ index }) => index);
}

async function loadJob() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const job = result[SESSION_KEY] || null;
  return job ? migrateJobTrackStatus(job) : null;
}

async function saveJob(job) {
  await chrome.storage.session.set({ [SESSION_KEY]: job });
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
    destinationName: job.downloadDestination?.name || null,
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

async function mutateJob(jobId, options, change) {
  return withJobState(async () => {
    const job = await loadJob();
    if (
      !job ||
      (jobId && job.id !== jobId) ||
      (options.statuses && !options.statuses.includes(job.status))
    ) {
      return null;
    }

    const changed = await change(job);
    if (changed === false) return job;
    await saveJob(job);
    if (options.badge !== false) await updateBadge(job);
    if (options.broadcast !== false) broadcastJobUpdate(job);
    return job;
  });
}

function broadcastJobUpdate(job) {
  chrome.runtime
    .sendMessage({ type: "BULK_JOB_UPDATE", job: getPublicJobSnapshot(job) })
    .catch(() => {});
}

async function updateBadge(job) {
  if (!job || !isActiveJobStatus(job.status)) {
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
      chrome.notifications.create(notificationId, { type: "basic", title, message }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch {
    // Notifications are optional; never block or throw after a download job.
  }
}

async function notifyJobFinished(job) {
  let title = null;
  let message = null;
  if ([JOB_STATUS.COMPLETED, JOB_STATUS.COMPLETED_WITH_ERRORS].includes(job.status)) {
    const failedCount = job.failed.length;
    const destination = job.downloadDestination?.name
      ? job.downloadDestination.name
      : `Downloads/${job.folderName}`;
    title = "Download complete";
    message =
      failedCount > 0
        ? `${job.completed}/${job.tracks.length} tracks saved to ${destination}. ${failedCount} failed.`
        : `${job.completed}/${job.tracks.length} tracks saved to ${destination}.`;
  } else if (job.status === JOB_STATUS.CANCELLED) {
    title = "Download cancelled";
    message = `${job.completed} tracks were saved before cancellation.`;
  } else if (job.status === JOB_STATUS.FAILED) {
    title = "Download failed";
    message = job.error || "The bulk download could not be completed.";
  }
  if (title) await safeCreateNotification(title, message);
}

async function startKeepalive() {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}
async function stopKeepalive() {
  await chrome.alarms.clear(KEEPALIVE_ALARM);
}

async function ensureOffscreenDocument() {
  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }
  const offscreenUrl = chrome.runtime.getURL?.("offscreen.html");
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    ...(offscreenUrl ? { documentUrls: [offscreenUrl] } : {}),
  });
  if (existingContexts.length > 0) return;
  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }
  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Assemble HLS audio tracks and save them to the selected destination.",
  });
  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existingContexts.length > 0) await chrome.offscreen.closeDocument();
}

async function finishJobResources(job) {
  await updateBadge(job);
  await stopKeepalive();
  await notifyJobFinished(job);
  await closeOffscreenDocument();
}

async function sendOffscreenMessage(message, retries = 12) {
  await ensureOffscreenDocument();
  await sleep(250);

  const hasSideEffect = message.type === "OFFSCREEN_SAVE_TO_DIRECTORY";
  for (let attempt = 0; attempt < (hasSideEffect ? 1 : retries); attempt += 1) {
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
    } catch (error) {
      if (hasSideEffect) {
        const ambiguous = new Error("Folder save may have completed. Check the folder before retrying.");
        ambiguous.code = "ambiguous_save";
        throw ambiguous;
      }
      // Offscreen may still be loading its scripts.
    }

    if (hasSideEffect) {
      const ambiguous = new Error("Folder save may have completed. Check the folder before retrying.");
      ambiguous.code = "ambiguous_save";
      throw ambiguous;
    }

    await sleep(200);
  }

  throw new Error("Could not reach the offscreen audio worker.");
}

async function waitWhilePaused(jobId) {
  while (
    jobControl.jobId === jobId &&
    jobControl.state === JOB_STATUS.PAUSED
  ) {
    await sleep(400);
  }
}

const destinationHandler = SCDownloadDestination.create({
  chromeApi: chrome,
  getRememberedDirectory: () => SCDownloadDirectory.getCurrent(),
  sendOffscreenMessage,
});

const trackDownloadExecution = SCTrackDownloadExecution.create({
  resolveSource: (trackData, formatPreference, options) =>
    SCDownloadSource.resolve(trackData, formatPreference, options),
  buildTrack: ({
    buildId,
    trackData,
    streamUrl,
    trimRange,
    playbackTransform,
  }) =>
    sendOffscreenMessage({
      type: "OFFSCREEN_BUILD",
      buildId,
      trackData,
      streamUrl,
      trimRange: trimRange || null,
      playbackTransform: playbackTransform || null,
    }),
  saveOutput: (output) => destinationHandler.save(output),
  revokeBlob: (blobUrl) =>
    sendOffscreenMessage({ type: "OFFSCREEN_REVOKE", blobUrl }),
  abortBuild: (buildId) =>
    sendOffscreenMessage({ type: "OFFSCREEN_ABORT", buildId }),
});

async function updateTrackProgress(jobId, trackIndex, total, title, statusText) {
  return mutateJob(
    jobId,
    { statuses: ACTIVE_JOB_STATUSES, badge: false },
    (job) => {
      job.currentTrackTitle = title;
      job.currentTrackStatus = statusText || `Track ${trackIndex + 1}/${total}`;
    }
  );
}

async function recordTrackSuccess(jobId, trackIndex) {
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, (job) => {
    if (job.trackStatus[trackIndex] === TRACK_STATUS.DONE) {
      return false;
    }
    job.trackStatus[trackIndex] = TRACK_STATUS.DONE;
    syncJobCountersFromTrackStatus(job);
    job.currentTrackTitle = null;
    job.currentTrackStatus = `Saved ${job.completed}/${job.tracks.length}`;
  });
}

async function recordDownloadStarted(jobId, trackIndex, downloadId) {
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, (job) => {
    job.downloadIds ||= {};
    job.downloadIds[trackIndex] = downloadId;
    job.trackStatus[trackIndex] = TRACK_STATUS.SAVING;
  });
}

async function recordTrackFailure(jobId, trackIndex, title, errorMessage) {
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, (job) => {
    if (job.trackStatus[trackIndex] === TRACK_STATUS.FAILED) {
      return false;
    }
    job.trackStatus[trackIndex] = TRACK_STATUS.FAILED;
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
  });
}

async function recordAmbiguousSave(jobId, trackIndex, title, errorMessage) {
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, (job) => {
    if (job.trackStatus[trackIndex] !== TRACK_STATUS.SAVING) return false;
    job.trackStatus[trackIndex] = TRACK_STATUS.AMBIGUOUS;
    job.failed = [...(job.failed || []), { index: trackIndex + 1, title: title || "Unknown track", error: errorMessage, ambiguous: true }];
    syncJobCountersFromTrackStatus(job);
    job.currentTrackStatus = `Check folder: ${title || "Unknown track"}`;
  });
}

function waitForStartedDownload(downloadId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(state);
    };
    const onChanged = (delta) => {
      if (delta.id === downloadId && ["complete", "interrupted"].includes(delta.state?.current)) {
        finish(delta.state.current);
      }
    };
    const timeoutId = setTimeout(() => finish("unknown"), RECOVER_DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    // Subscribe before searching so a completion between these steps is not missed.
    chrome.downloads.search({ id: downloadId })
      .then((items) => {
        const state = items?.[0]?.state;
        if (state !== "in_progress") finish(state || "unknown");
      })
      .catch(() => finish("unknown"));
  });
}

async function finalizeJob(jobId, status, error) {
  const job = await mutateJob(
    jobId,
    { statuses: ACTIVE_JOB_STATUSES, badge: false, broadcast: false },
    (value) => {
      transitionJob(value, status, { error });
    }
  );
  if (!job) return null;

  await finishJobResources(job);
  broadcastJobUpdate(job);
  return job;
}

async function processTrack(jobId, trackIndex) {
  const job = await loadJob();
  if (!job || job.id !== jobId) {
    return;
  }

  const trackData = job.tracks[trackIndex];
  const trackNumber = trackIndex + 1;
  const total = job.tracks.length;

  try {
    const result = await trackDownloadExecution.execute({
      operationId: `track_${jobId.replace(/[^A-Za-z0-9_]/g, "")}_${trackIndex}`,
      trackData,
      formatPreference: job.formatPreference || "auto",
      destination: job.downloadDestination,
      collection: {
        folderName: job.folderName,
        trackNumber,
        totalTracks: total,
      },
      onDownloadStarted: (downloadId) => recordDownloadStarted(jobId, trackIndex, downloadId),
      isCancelled: async () => {
        const currentJob = await loadJob();
        return (
          !currentJob ||
          currentJob.id !== jobId ||
          jobControl.state === JOB_STATUS.CANCELLED
        );
      },
      onStage: async (stage) => {
        if (stage === "saving") {
          await mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, (current) => {
            current.trackStatus[trackIndex] = TRACK_STATUS.SAVING;
          });
        }
        const statusByStage = {
          resolving: "Resolving stream...",
          building: "Downloading...",
          refreshing: "Refreshing expired stream...",
          saving: "Saving...",
        };
        return updateTrackProgress(
          jobId,
          trackIndex,
          total,
          trackData.title,
          `Track ${trackNumber}/${total} - ${statusByStage[stage]}`
        );
      },
      onProgress: (statusText) =>
        updateTrackProgress(
          jobId,
          trackIndex,
          total,
          trackData.title,
          `Track ${trackNumber}/${total} - ${statusText}`
        ),
    });

    if (result.cancelled) {
      return;
    }

    await recordTrackSuccess(jobId, trackIndex);
  } catch (error) {
    if (
      jobControl.jobId === jobId &&
      jobControl.state === JOB_STATUS.CANCELLED
    ) {
      return;
    }

    if (error.code === "ambiguous_save") {
      await recordAmbiguousSave(jobId, trackIndex, trackData?.title, error.message);
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
  if (!job || job.id !== jobId || !isActiveJobStatus(job.status)) {
    return;
  }

  jobControl = { jobId, state: job.status };

  const inFlight = new Map();

  try {
    while (true) {
      await waitWhilePaused(jobId);

      if (
        jobControl.jobId === jobId &&
        jobControl.state === JOB_STATUS.CANCELLED
      ) {
        break;
      }

      job = await loadJob();
      if (!job || job.id !== jobId || job.status === JOB_STATUS.CANCELLED) {
        break;
      }

      while (inFlight.size >= MAX_IN_FLIGHT) {
        await Promise.race(inFlight.values());
        await waitWhilePaused(jobId);

        if (jobControl.state === JOB_STATUS.CANCELLED) {
          break;
        }
      }

      if (jobControl.state === JOB_STATUS.CANCELLED) {
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

    if (
      jobControl.jobId === jobId &&
      jobControl.state === JOB_STATUS.CANCELLED
    ) {
      return;
    }

    if (
      job.status === JOB_STATUS.RUNNING &&
      getPendingTrackIndices(job).length === 0
    ) {
      const finalStatus = job.completed > 0
        ? job.failed.length ? JOB_STATUS.COMPLETED_WITH_ERRORS : JOB_STATUS.COMPLETED
        : JOB_STATUS.FAILED;
      await finalizeJob(
        jobId,
        finalStatus,
        job.completed > 0 ? null : "Could not download any tracks."
      );
    }
  } catch (error) {
    await finalizeJob(
      jobId,
      JOB_STATUS.FAILED,
      error.message || "Bulk download failed."
    );
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

const BulkJobManager = {
  SESSION_KEY,
  KEEPALIVE_ALARM,

  reportBuildProgress(buildId, statusText) {
    return trackDownloadExecution.reportProgress(buildId, statusText);
  },

  async downloadSingleTrack(
    trackData,
    formatPreference = "auto",
    downloadDestination = null,
    playbackTransform = null
  ) {
    await withJobState(async () => {
      const activeJobBeforeDownload = await loadJob();
      if (
        activeJobBeforeDownload &&
        isActiveJobStatus(activeJobBeforeDownload.status)
      ) {
        throw new Error("A bulk download is already in progress.");
      }

      singleDownloadsInFlight += 1;
    });

    try {
      const resolvedDestination = await destinationHandler.resolve(
        downloadDestination
      );
      await startKeepalive();
      await ensureOffscreenDocument();
      return await queueSingleDownload(() =>
        trackDownloadExecution.execute({
          trackData,
          formatPreference: formatPreference || "auto",
          destination: resolvedDestination,
          playbackTransform,
        })
      );
    } finally {
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      const hasActiveBulkJob =
        activeJob && isActiveJobStatus(activeJob.status);
      if (!hasActiveBulkJob && singleDownloadsInFlight === 0) {
        await stopKeepalive().catch(() => {});
        await closeOffscreenDocument().catch(() => {});
      }
    }
  },

  async downloadLoop(
    trackData,
    formatPreference = "auto",
    trimRange,
    playbackTransform = null,
    downloadDestination = null
  ) {
    await withJobState(async () => {
      const activeJobBeforeDownload = await loadJob();
      if (
        activeJobBeforeDownload &&
        isActiveJobStatus(activeJobBeforeDownload.status)
      ) {
        throw new Error("A bulk download is already in progress.");
      }

      singleDownloadsInFlight += 1;
    });

    try {
      const resolvedDestination = await destinationHandler.resolve(
        downloadDestination
      );
      await startKeepalive();
      await ensureOffscreenDocument();
      return await queueSingleDownload(() =>
        trackDownloadExecution.execute({
          trackData,
          formatPreference: formatPreference || "auto",
          destination: resolvedDestination,
          trimRange,
          playbackTransform,
        })
      );
    } finally {
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      const hasActiveBulkJob =
        activeJob && isActiveJobStatus(activeJob.status);
      if (!hasActiveBulkJob && singleDownloadsInFlight === 0) {
        await stopKeepalive().catch(() => {});
        await closeOffscreenDocument().catch(() => {});
      }
    }
  },

  async createJob(
    tracks,
    playlistTitle,
    playlistMeta = {},
    formatPreference = "auto",
    downloadDestination = null
  ) {
    const resolvedDestination = await destinationHandler.resolve(
      downloadDestination
    );

    return withJobState(async () => {
      const existing = await loadJob();
      if (existing && isActiveJobStatus(existing.status)) {
        throw new Error("A bulk download is already in progress.");
      }

      if (singleDownloadsInFlight > 0) {
        throw new Error("A track download is already in progress.");
      }

      const fallbackAlbum = playlistTitle || "Untitled playlist";
      const collectionFolder = sanitizeFolderName(playlistTitle);
      const job = {
        id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        status: JOB_STATUS.RUNNING,
        playlistTitle: playlistTitle || "Untitled playlist",
        folderName: collectionFolder,
        downloadDestination: resolvedDestination,
        artworkUrl:
          playlistMeta.artworkUrl ||
          SCDownloadTrack.migrate(tracks[0])?.artworkUrl ||
          null,
        artist: playlistMeta.artist || tracks[0]?.artist || null,
        artistImageUrl:
          playlistMeta.artistImageUrl || tracks[0]?.artistImageUrl || null,
        artistUrl: playlistMeta.artistUrl || tracks[0]?.artistUrl || null,
        tracks: tracks.map((track) =>
          SCDownloadTrack.toDurable(track, fallbackAlbum)
        ),
        formatPreference: formatPreference || "auto",
        trackStatus: new Array(tracks.length).fill(null),
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
      jobControl = { jobId: job.id, state: JOB_STATUS.RUNNING };
      runJobLoop(job.id);

      return getPublicJobSnapshot(job);
    });
  },

  async getStatus() {
    await BulkJobManager.ensureJobRunning();
    const job = await loadJob();
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async pauseJob() {
    const job = await mutateJob(
      null,
      { statuses: [JOB_STATUS.RUNNING] },
      (value) => {
        transitionJob(value, JOB_STATUS.PAUSED);
        jobControl = { jobId: value.id, state: JOB_STATUS.PAUSED };
      }
    );
    if (!job) {
      return { success: false, error: "No running job to pause." };
    }
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async resumeJob() {
    const job = await mutateJob(
      null,
      { statuses: [JOB_STATUS.PAUSED], broadcast: false },
      (value) => {
        transitionJob(value, JOB_STATUS.RUNNING);
        jobControl = { jobId: value.id, state: JOB_STATUS.RUNNING };
      }
    );
    if (!job) {
      return { success: false, error: "No paused job to resume." };
    }
    await startKeepalive();
    runJobLoop(job.id);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async retryFailedJob() {
    const job = await mutateJob(
      null,
      { statuses: [JOB_STATUS.COMPLETED, JOB_STATUS.COMPLETED_WITH_ERRORS, JOB_STATUS.FAILED], broadcast: false },
      (value) => {
        if (!value.trackStatus.includes(TRACK_STATUS.FAILED)) return false;

        value.trackStatus = value.trackStatus.map((status) =>
          status === TRACK_STATUS.FAILED ? null : status
        );
        value.failed = value.failed.filter((failure) => failure.ambiguous);
        transitionJob(value, JOB_STATUS.RUNNING);
        value.finishedAt = null;
        value.error = null;
        value.currentTrackTitle = null;
        value.currentTrackStatus = null;
        syncJobCountersFromTrackStatus(value);
        jobControl = { jobId: value.id, state: JOB_STATUS.RUNNING };
      }
    );
    if (!job || !job.trackStatus.includes(null)) {
      return { success: false, error: "No failed tracks are available to retry." };
    }

    if (activeLoopPromise && activeLoopJobId === job.id) {
      await activeLoopPromise;
    }
    await startKeepalive();
    runJobLoop(job.id);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async cancelJob() {
    const job = await mutateJob(
      null,
      { statuses: ACTIVE_JOB_STATUSES, badge: false, broadcast: false },
      (value) => {
        transitionJob(value, JOB_STATUS.CANCELLED);
        jobControl = { jobId: value.id, state: JOB_STATUS.CANCELLED };
      }
    );
    if (!job) {
      return { success: false, error: "No active job to cancel." };
    }
    await trackDownloadExecution.abortAll();
    await finishJobResources(job);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async recoverRunningJob() {
    const job = await loadJob();
    if (!job || !isActiveJobStatus(job.status)) {
      return;
    }

    for (let index = 0; index < job.trackStatus.length; index += 1) {
      if (job.trackStatus[index] === TRACK_STATUS.SAVING) {
        const downloadId = job.downloadIds?.[index];
        if (downloadId) {
          const state = await waitForStartedDownload(downloadId);
          if (state === "complete") {
            await recordTrackSuccess(job.id, index);
            continue;
          }
          if (state === "interrupted") {
            await recordTrackFailure(job.id, index, job.tracks[index]?.title,
              "Chrome interrupted the download.");
            continue;
          }
        }
        await recordAmbiguousSave(job.id, index, job.tracks[index]?.title,
          "Save was interrupted. Check the destination before retrying.");
      }
    }
    await updateBadge(await loadJob());
    await startKeepalive();
    jobControl = { jobId: job.id, state: job.status };
    runJobLoop(job.id);
  },

  async ensureJobRunning() {
    const job = await loadJob();
    if (!job || !isActiveJobStatus(job.status)) {
      return;
    }

    if (activeLoopPromise !== null && activeLoopJobId === job.id) {
      await updateBadge(job);
      return;
    }

    await BulkJobManager.recoverRunningJob();
  },
};
