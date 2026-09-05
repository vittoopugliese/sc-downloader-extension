const SESSION_KEY = "scdl_active_job";
const KEEPALIVE_ALARM = "scdl_bulk_keepalive";
const MAX_IN_FLIGHT = 2;
const JOB_STATUS = Object.freeze({
  RUNNING: "running",
  PAUSED: "paused",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
});
const TRACK_STATUS = Object.freeze({
  DONE: "done",
  FAILED: "failed",
});
const ACTIVE_JOB_STATUSES = Object.freeze([
  JOB_STATUS.RUNNING,
  JOB_STATUS.PAUSED,
]);
const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.CANCELLED,
  JOB_STATUS.COMPLETED,
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
});

let jobControl = { jobId: null, state: null };
let activeLoopPromise = null;
let activeLoopJobId = null;
let stateQueue = Promise.resolve();
let singleDownloadsInFlight = 0;

function withJobState(fn) {
  const run = stateQueue.then(fn);
  stateQueue = run.then(
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
      status === TRACK_STATUS.DONE || status === TRACK_STATUS.FAILED
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
        status !== TRACK_STATUS.DONE && status !== TRACK_STATUS.FAILED
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
  if (job.status === JOB_STATUS.COMPLETED) {
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
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existingContexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Assemble HLS audio tracks and save them to the selected destination.",
  });
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
  resolveSource: (trackData, formatPreference) =>
    SCDownloadSource.resolve(trackData, formatPreference),
  buildTrack: ({ buildId, trackData, streamUrl }) =>
    sendOffscreenMessage({
      type: "OFFSCREEN_BUILD",
      buildId,
      trackData,
      streamUrl,
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
      trackData,
      formatPreference: job.formatPreference || "auto",
      destination: job.downloadDestination,
      collection: {
        folderName: job.folderName,
        trackNumber,
        totalTracks: total,
      },
      isCancelled: async () => {
        const currentJob = await loadJob();
        return (
          !currentJob ||
          currentJob.id !== jobId ||
          jobControl.state === JOB_STATUS.CANCELLED
        );
      },
      onStage: (stage) => {
        const statusByStage = {
          resolving: "Resolving stream...",
          building: "Downloading...",
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
      const finalStatus =
        job.completed > 0 ? JOB_STATUS.COMPLETED : JOB_STATUS.FAILED;
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
      return await trackDownloadExecution.execute({
        trackData,
        formatPreference: formatPreference || "auto",
        destination: resolvedDestination,
      });
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

    await updateBadge(job);
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
