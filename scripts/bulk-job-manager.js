const SESSION_KEY = "scdl_active_job";
const KEEPALIVE_ALARM = "scdl_bulk_keepalive";
const RETRY_ALARM_PREFIX = "scdl_bulk_retry:";
const RECOVER_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
// Keep audio assembly sequential. Two decoded/combined tracks can exhaust memory
// on Chromebooks and other constrained devices even when network concurrency is safe.
const MAX_IN_FLIGHT = 1;
const JOB_STATUS = Object.freeze({
  ENUMERATING: "enumerating",
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  COMPLETED_WITH_ERRORS: "completed_with_errors",
  FAILED: "failed",
  PARTIAL: "partial",
});
const TRACK_STATUS = Object.freeze({
  DONE: "done",
  FAILED: "failed",
  SAVING: "saving",
  AMBIGUOUS: "ambiguous_save",
});
const ACTIVE_JOB_STATUSES = Object.freeze([
  JOB_STATUS.ENUMERATING,
  JOB_STATUS.READY,
  JOB_STATUS.RUNNING,
  JOB_STATUS.PAUSED,
]);
const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.CANCELLED,
  JOB_STATUS.COMPLETED,
  JOB_STATUS.COMPLETED_WITH_ERRORS,
  JOB_STATUS.FAILED,
  JOB_STATUS.PARTIAL,
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
let offscreenLifecycleQueue = Promise.resolve();
let singleDownloadsInFlight = 0;
let offscreenOperationsInFlight = 0;
let offscreenClosePending = false;
let legacyMigrationPromise = null;
let activeEnumerationPromise = null;
let activeEnumerationJobId = null;
const cancelledInstrumentOperations = new Map();
const instrumentOperationPhases = new Map();
const INSTRUMENT_CANCEL_TTL_MS = 5 * 60 * 1000;

function pruneCancelledInstrumentOperations() {
  const cutoff = Date.now() - INSTRUMENT_CANCEL_TTL_MS;
  for (const [operationId, cancelledAt] of cancelledInstrumentOperations) {
    if (cancelledAt < cutoff) cancelledInstrumentOperations.delete(operationId);
  }
}

function throwIfInstrumentCancelled(operationId) {
  pruneCancelledInstrumentOperations();
  if (!cancelledInstrumentOperations.has(operationId)) return;
  throw Object.assign(new Error("Instrument preparation cancelled."), {
    name: "AbortError",
    code: "instrument_cancelled",
  });
}

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

function withOffscreenLifecycle(fn) {
  const run = offscreenLifecycleQueue.then(fn);
  offscreenLifecycleQueue = run.then(
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

const JOB_MUTABLE_FIELDS = Object.freeze([
  "status", "playlistTitle", "folderName", "downloadDestination", "formatPreference",
  "clientId", "currentIndex", "currentTrackTitle", "currentTrackStatus", "pausedAt",
  "finishedAt", "error", "artworkUrl", "artist", "artistImageUrl", "artistUrl",
]);

async function persistJobSummary(job) {
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      version: 2,
      activeJobId: job.jobId,
      job: getPublicJobSnapshot(job),
    },
  });
}

function legacyTrackStatuses(job) {
  if (job.trackStatus?.length === job.tracks.length) return job.trackStatus;
  const states = new Array(job.tracks.length).fill("pending");
  for (const failure of job.failed || []) {
    const index = (failure.index || 0) - 1;
    if (index >= 0 && index < states.length) states[index] = TRACK_STATUS.FAILED;
  }
  let marked = 0;
  for (let index = 0; index < states.length && marked < (job.completed || 0); index += 1) {
    if (states[index] === TRACK_STATUS.FAILED) continue;
    states[index] = TRACK_STATUS.DONE;
    marked += 1;
  }
  return states;
}

async function createStoredJob(jobId, tracks, metadata = {}, initialStates = null) {
  const fallbackAlbum = metadata.playlistTitle || "Untitled playlist";
  const durableTracks = tracks.map(track => SCDownloadTrack.toDurable(track, fallbackAlbum));
  let created = await SCBulkLibrary.getJob(jobId);
  if (!created) {
    created = await SCBulkLibrary.createJob({
      jobId,
      sourceType: metadata.sourceType || "legacy_message",
      mode: "limit",
      requestedLimit: durableTracks.length,
      createdAt: metadata.startedAt,
    });
  }
  const pageSize = 500;
  for (let offset = created.status === "enumerating" ? created.eligible : durableTracks.length;
    offset < durableTracks.length; offset += pageSize) {
    const page = durableTracks.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    await SCBulkLibrary.commitPage(jobId, {
      epoch: created.epoch,
      expectedCursor: offset === 0 ? null : `import:${offset}`,
      nextCursor: nextOffset < durableTracks.length ? `import:${nextOffset}` : null,
      done: nextOffset >= durableTracks.length,
      enumerated: page.length,
      items: page.map((track, index) => ({
        trackId: `track:${String(track.id ?? "unknown").replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 90)}:${offset + index}`,
        track,
      })),
    });
  }
  let stored = await SCBulkLibrary.updateJob(jobId, ["ready", metadata.status || JOB_STATUS.RUNNING], {
    status: metadata.status || JOB_STATUS.RUNNING,
    playlistTitle: metadata.playlistTitle || "Untitled playlist",
    folderName: metadata.folderName || sanitizeFolderName(metadata.playlistTitle),
    downloadDestination: metadata.downloadDestination || null,
    formatPreference: metadata.formatPreference || "auto",
    clientId: metadata.clientId || null,
    currentIndex: metadata.currentIndex || 0,
    currentTrackTitle: metadata.currentTrackTitle || null,
    currentTrackStatus: metadata.currentTrackStatus || null,
    pausedAt: metadata.pausedAt || null,
    finishedAt: metadata.finishedAt || null,
    error: metadata.error || null,
    artworkUrl: metadata.artworkUrl || null,
    artist: metadata.artist || null,
    artistImageUrl: metadata.artistImageUrl || null,
    artistUrl: metadata.artistUrl || null,
    recentFailures: (metadata.failed || []).slice(-100),
  });
  if (!stored) stored = await SCBulkLibrary.getJob(jobId);
  if (initialStates) {
    for (let index = 0; index < initialStates.length; index += 1) {
      const state = initialStates[index];
      if (!state || state === "pending") continue;
      const failure = (metadata.failed || []).find(value => value.index === index + 1);
      const updated = await SCBulkLibrary.updateTrackState(jobId, index, state, {
        downloadId: metadata.downloadIds?.[index],
        error: failure?.error || null,
      });
      if (updated) stored = updated.job;
    }
  }
  return stored;
}

async function loadJob() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const session = result[SESSION_KEY] || null;
  if (Array.isArray(session?.tracks)) {
    if (!legacyMigrationPromise) {
      legacyMigrationPromise = (async () => {
        const migrated = await createStoredJob(
          session.id,
          session.tracks,
          session,
          legacyTrackStatuses(session)
        );
        await persistJobSummary(migrated);
        return migrated;
      })().catch(error => {
        legacyMigrationPromise = null;
        throw error;
      });
    }
    return legacyMigrationPromise;
  }
  const jobId = session?.activeJobId || session?.job?.id;
  let sessionJob = jobId ? await SCBulkLibrary.getJob(jobId) : null;
  if (sessionJob && (!Number.isSafeInteger(sessionJob.retryableFailedCount) ||
      !Number.isSafeInteger(sessionJob.ambiguousCount))) {
    sessionJob = await SCBulkLibrary.recountFailures(sessionJob.jobId);
  }
  if (sessionJob) return sessionJob;

  let durableJob = await SCBulkLibrary.getActiveJob();
  if (durableJob && (!Number.isSafeInteger(durableJob.retryableFailedCount) ||
      !Number.isSafeInteger(durableJob.ambiguousCount))) {
    durableJob = await SCBulkLibrary.recountFailures(durableJob.jobId);
  }
  if (durableJob) await persistJobSummary(durableJob);
  return durableJob;
}

async function saveJob(job) {
  const patch = Object.fromEntries(JOB_MUTABLE_FIELDS.map(key => [key, job[key]]));
  const stored = await SCBulkLibrary.updateJob(job.jobId, null, patch);
  if (stored) await persistJobSummary(stored);
  return stored;
}

function getPublicJobSnapshot(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.jobId,
    status: [JOB_STATUS.ENUMERATING, JOB_STATUS.READY].includes(job.status)
      ? JOB_STATUS.RUNNING : job.status,
    playlistTitle: job.playlistTitle,
    folderName: job.folderName,
    destinationName: job.downloadDestination?.name || null,
    total: job.enumerating && job.requestedLimit != null ? job.requestedLimit : job.eligible,
    currentIndex: job.currentIndex || 0,
    completed: job.saved,
    failed: job.recentFailures || [],
    failedCount: job.failed,
    retryableFailedCount: job.retryableFailedCount || 0,
    ambiguousCount: job.ambiguousCount || 0,
    canRetry: (job.retryableFailedCount || 0) > 0,
    currentTrackTitle: job.currentTrackTitle || null,
    currentTrackStatus: job.currentTrackStatus || null,
    artworkUrl: job.artworkUrl || null,
    artist: job.artist || null,
    artistImageUrl: job.artistImageUrl || null,
    artistUrl: job.artistUrl || null,
    startedAt: job.startedAt || job.createdAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
  };
}

async function mutateJob(jobId, options, change) {
  return withJobState(async () => {
    const job = await loadJob();
    if (
      !job ||
      (jobId && job.jobId !== jobId) ||
      (options.statuses && !options.statuses.includes(job.status))
    ) {
      return null;
    }

    const changed = await change(job);
    if (changed === false) return job;
    const saved = await saveJob(job);
    if (!saved) return null;
    if (options.badge !== false) await updateBadge(saved);
    if (options.broadcast !== false) broadcastJobUpdate(saved);
    return saved;
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

  const done = job.saved + job.failed;
  const total = job.eligible;
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
    const failedCount = job.failed;
    const destination = job.downloadDestination?.name
      ? job.downloadDestination.name
      : `Downloads/${job.folderName}`;
    title = "Download complete";
    message =
      failedCount > 0
        ? `${job.saved}/${job.eligible} tracks saved to ${destination}. ${failedCount} failed.`
        : `${job.saved}/${job.eligible} tracks saved to ${destination}.`;
  } else if (job.status === JOB_STATUS.CANCELLED) {
    title = "Download cancelled";
    message = `${job.saved} tracks were saved before cancellation.`;
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

async function ensureOffscreenDocumentUnlocked() {
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

function ensureOffscreenDocument() {
  return withOffscreenLifecycle(ensureOffscreenDocumentUnlocked);
}

function closeOffscreenDocument() {
  return withOffscreenLifecycle(async () => {
  // A terminal bulk job can finish while a pad render or a single export still
  // owns the shared offscreen document. Closing it here used to abort that
  // unrelated operation. The last lease holder performs the deferred close.
  if (offscreenOperationsInFlight > 0 || singleDownloadsInFlight > 0) {
    offscreenClosePending = true;
    return false;
  }
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  // Acquiring a lease is synchronous, but it can happen while getContexts()
  // yields. Recheck immediately before the destructive close.
  if (offscreenOperationsInFlight > 0 || singleDownloadsInFlight > 0) {
    offscreenClosePending = true;
    return false;
  }
  if (existingContexts.length > 0) await chrome.offscreen.closeDocument();
  offscreenClosePending = false;
  return true;
  });
}

async function finishJobResources(job) {
  await updateBadge(job);
  await stopKeepalive();
  await notifyJobFinished(job);
  await closeOffscreenDocument();
}

async function sendOffscreenMessage(message, retries = 12) {
  offscreenOperationsInFlight += 1;
  try {
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
  } finally {
    offscreenOperationsInFlight = Math.max(0, offscreenOperationsInFlight - 1);
    if (offscreenOperationsInFlight === 0 && offscreenClosePending && singleDownloadsInFlight === 0) {
      await closeOffscreenDocument().catch(() => {});
    }
  }
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
    effects,
  }) => (async () => {
    const access = await globalThis.SCPlayerToolsAccess?.getSnapshot?.({}).catch?.(() => null);
    return sendOffscreenMessage({
      type: "OFFSCREEN_BUILD",
      buildId,
      trackData,
      streamUrl,
      trimRange: trimRange || null,
      playbackTransform: playbackTransform || null,
      effects: effects || null,
      allowWav: access?.plan === "pro",
    });
  })(),
  saveOutput: (output) => destinationHandler.save(output),
  revokeBlob: (blobUrl) =>
    sendOffscreenMessage({ type: "OFFSCREEN_REVOKE", blobUrl }),
  abortBuild: (buildId) =>
    sendOffscreenMessage({ type: "OFFSCREEN_ABORT", buildId }),
});

function newDirectOperationId() {
  const value = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `track_${value}`;
}

function directOperationSignature(trackData, formatPreference, trimRange, playbackTransform, effects, destination) {
  // Never persist signed stream URLs or authentication material merely to
  // deduplicate a retry. Track identity plus immutable export options suffice.
  return JSON.stringify([String(trackData?.trackId || trackData?.id || ""), formatPreference || "auto",
    trimRange || null, playbackTransform || null, effects || null, destination?.id || null]);
}

async function executeDirectOperation({ operationId, trackData, formatPreference, destination, trimRange = null, playbackTransform = null, effects = null }) {
  let id = operationId || newDirectOperationId();
  const signature = directOperationSignature(trackData, formatPreference, trimRange, playbackTransform, effects, destination);
  const existing = await SCBulkLibrary.beginOperation(id, signature);
  id = existing.operationId;
  if (existing.isNew) await SCBulkLibrary.updateOperation(id, { saveKind: destination ? "directory" : "downloads" });
  if (existing.state === "completed") return existing.result;
  if (!existing.isNew && ["resolving", "building", "built", "save_requested", "download_started", "saving"].includes(existing.state)) {
    return { success: false, operationId: id, code: "operation_in_progress", error: "This download is still processing." };
  }
  if (["ambiguous_save", "failed", "cancelled"].includes(existing.state)) return existing.result || {
    success: false, operationId: id, code: existing.state, error: existing.error || "Check the download before retrying.",
  };
  try {
    const result = await trackDownloadExecution.execute({
      operationId: id, trackData, formatPreference, destination, trimRange, playbackTransform, effects,
      onStage: async (stage) => {
        const state = stage === "saving" ? "save_requested" : stage === "resolving" ? "resolving" : "building";
        await SCBulkLibrary.updateOperation(id, { state, stage });
      },
      onDownloadStarted: async (downloadId) => SCBulkLibrary.updateOperation(id, { state: "download_started", stage: "download_started", downloadId }),
    });
    const finalState = result.cancelled ? "cancelled" : "completed";
    const saved = { ...result, operationId: id };
    await SCBulkLibrary.updateOperation(id, { state: finalState, stage: finalState, result: saved, error: null });
    return saved;
  } catch (error) {
    const state = error?.code === "ambiguous_save" ? "ambiguous_save" : "failed";
    const result = { success: false, operationId: id, code: error?.code || state,
      error: error?.message || "Download failed." };
    await SCBulkLibrary.updateOperation(id, { state, stage: state, result, error: result.error });
    return result;
  }
}

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
  const result = await SCBulkLibrary.updateTrackState(jobId, trackIndex, TRACK_STATUS.DONE, {
    expectedJobStatuses: ACTIVE_JOB_STATUSES,
  });
  if (!result || !isActiveJobStatus(result.job.status)) return null;
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, job => {
    job.currentTrackTitle = null;
    job.currentTrackStatus = `Saved ${result.job.saved}/${result.job.eligible}`;
  });
}

async function recordDownloadStarted(jobId, trackIndex, downloadId) {
  const result = await SCBulkLibrary.updateTrackState(jobId, trackIndex, TRACK_STATUS.SAVING, {
    downloadId,
    expectedJobStatuses: ACTIVE_JOB_STATUSES,
  });
  if (result) await persistJobSummary(result.job);
  return result?.job || null;
}

async function recordTrackFailure(jobId, trackIndex, title, errorMessage) {
  const result = await SCBulkLibrary.updateTrackState(jobId, trackIndex, TRACK_STATUS.FAILED, {
    error: errorMessage || "Unknown error",
    expectedJobStatuses: ACTIVE_JOB_STATUSES,
  });
  if (!result || !isActiveJobStatus(result.job.status)) return null;
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, job => {
    job.currentTrackStatus = `Failed: ${title || "Unknown track"}`;
  });
}

async function recordAmbiguousSave(jobId, trackIndex, title, errorMessage) {
  const result = await SCBulkLibrary.updateTrackState(jobId, trackIndex, TRACK_STATUS.AMBIGUOUS, {
    expectedStates: [TRACK_STATUS.SAVING],
    expectedJobStatuses: ACTIVE_JOB_STATUSES,
    error: errorMessage,
  });
  if (!result || !isActiveJobStatus(result.job.status)) return null;
  return mutateJob(jobId, { statuses: ACTIVE_JOB_STATUSES }, job => {
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
  if (!job || job.jobId !== jobId) {
    return;
  }

  const trackRecord = await SCBulkLibrary.getTrack(jobId, trackIndex);
  if (!trackRecord || !["pending", TRACK_STATUS.SAVING].includes(trackRecord.state)) return;
  const trackData = trackRecord.track;
  const trackNumber = trackIndex + 1;
  const total = job.eligible;

  try {
    const result = await trackDownloadExecution.execute({
      operationId: `track_${jobId.replace(/[^A-Za-z0-9_]/g, "")}_${trackIndex}`,
      trackData,
      formatPreference: job.formatPreference || "auto",
      reuseEligibilitySnapshot: job.sourceType !== "legacy_message",
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
          currentJob.jobId !== jobId ||
          jobControl.state === JOB_STATUS.CANCELLED
        );
      },
      onStage: async (stage) => {
        if (stage === "saving") {
          await SCBulkLibrary.updateTrackState(jobId, trackIndex, TRACK_STATUS.SAVING, {
            expectedJobStatuses: ACTIVE_JOB_STATUSES,
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
  if (!job || job.jobId !== jobId || !isActiveJobStatus(job.status)) {
    return;
  }

  if (jobControl.jobId !== jobId) {
    jobControl = { jobId, state: job.status };
  }

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
      if (!job || job.jobId !== jobId || job.status === JOB_STATUS.CANCELLED) {
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
      const pending = (await SCBulkLibrary.getTracksByState(jobId, "pending", MAX_IN_FLIGHT + 1))
        .map(record => record.index)
        .filter(trackIndex => !inFlight.has(trackIndex));

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
    if (!job || job.jobId !== jobId) {
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
      (await SCBulkLibrary.getTracksByState(jobId, "pending", 1)).length === 0
    ) {
      const finalStatus = job.saved > 0
        ? job.failed ? JOB_STATUS.COMPLETED_WITH_ERRORS : JOB_STATUS.COMPLETED
        : JOB_STATUS.FAILED;
      await finalizeJob(
        jobId,
        finalStatus,
        job.saved > 0 ? null : "Could not download any tracks."
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

function requestBulkPage(job) {
  return SCDownloadSource.collectionPage({
    sourceType: job.sourceType,
    sourceUserId: job.sourceUserId,
    sourceUrl: job.sourceUrl,
    sourceAuthenticated: job.sourceAuthenticated,
    clientId: job.clientId,
  }, job.nextCursor, 200, job.formatPreference || "auto");
}

async function finishEnumeration(job) {
  const running = await SCBulkLibrary.updateJob(job.jobId, [JOB_STATUS.READY], {
    status: JOB_STATUS.RUNNING,
    enumerating: false,
    currentTrackStatus: null,
    error: null,
  });
  if (!running) return null;
  jobControl = { jobId: running.jobId, state: JOB_STATUS.RUNNING };
  await persistJobSummary(running);
  await updateBadge(running);
  broadcastJobUpdate(running);
  runJobLoop(running.jobId);
  return running;
}

async function failEnumeration(job, error) {
  if (["rate_limited", "network_error", "network_timeout", "service_unavailable"].includes(error.code)) {
    let paused = await SCBulkLibrary.pause(job.jobId, {
      epoch: job.epoch,
      code: error.code,
      retryAt: error.retryAt,
    });
    paused = await SCBulkLibrary.updateJob(job.jobId, [JOB_STATUS.PAUSED], {
      currentTrackStatus: error.message,
      enumerating: true,
    }) || paused;
    jobControl = { jobId: job.jobId, state: JOB_STATUS.PAUSED };
    await persistJobSummary(paused);
    await updateBadge(paused);
    broadcastJobUpdate(paused);
    if (Number.isFinite(paused.retryAt) && paused.retryAt > Date.now()) {
      await chrome.alarms.create(`${RETRY_ALARM_PREFIX}${job.jobId}`, { when: paused.retryAt });
    }
    return paused;
  }
  const status = job.eligible > 0 ? JOB_STATUS.PARTIAL : JOB_STATUS.FAILED;
  const failed = await SCBulkLibrary.updateJob(job.jobId, [JOB_STATUS.ENUMERATING], {
    status,
    enumerating: false,
    error: error.message || "Collection enumeration failed.",
    errorCode: error.code || "enumeration_failed",
    currentTrackStatus: null,
    finishedAt: Date.now(),
  });
  if (failed) {
    await persistJobSummary(failed);
    await finishJobResources(failed);
    broadcastJobUpdate(failed);
  }
  return failed;
}

async function runEnumerationInternal(jobId) {
  let job = await loadJob();
  if (!job || job.jobId !== jobId) return null;
  if (job.status === JOB_STATUS.READY) return finishEnumeration(job);
  if (job.status !== JOB_STATUS.ENUMERATING) return job;
  try {
    while (job.status === JOB_STATUS.ENUMERATING) {
      const epoch = job.epoch;
      const page = await requestBulkPage(job);
      const tracks = (page?.items || []).filter(track => SCDownloadTrack.canDownload(track));
      const skipped = { ...(page?.skipped || {}) };
      skipped.invalid = (Number(skipped.invalid) || 0) + Math.max(0, (page?.items?.length || 0) - tracks.length);
      const committed = await SCBulkLibrary.commitPage(jobId, {
        epoch,
        expectedCursor: job.nextCursor,
        nextCursor: page?.nextCursor ?? null,
        done: page?.done === true,
        enumerated: page?.enumerated,
        skipped,
        items: tracks.map(track => ({ trackId: String(track.id), track })),
      });
      job = committed.job;
      if (job.status === JOB_STATUS.ENUMERATING) {
        job = await SCBulkLibrary.updateJob(jobId, [JOB_STATUS.ENUMERATING], {
          currentTrackStatus: `Found ${job.eligible} downloadable tracks...`,
        }) || job;
      }
      await persistJobSummary(job);
      await updateBadge(job);
      broadcastJobUpdate(job);
    }
    if (job.status === JOB_STATUS.READY) return finishEnumeration(job);
    if (job.status === JOB_STATUS.PARTIAL) {
      job = await SCBulkLibrary.updateJob(jobId, [JOB_STATUS.PARTIAL], {
        error: "SoundCloud repeated a collection cursor. The job is incomplete.",
        errorCode: job.error || "cursor_cycle",
      }) || job;
      await persistJobSummary(job);
      await finishJobResources(job);
      broadcastJobUpdate(job);
    }
    return job;
  } catch (error) {
    const current = await SCBulkLibrary.getJob(jobId);
    if (!current || current.status === JOB_STATUS.CANCELLED) return current;
    return failEnumeration(current, error);
  }
}

function runEnumeration(jobId) {
  if (activeEnumerationPromise && activeEnumerationJobId === jobId) return activeEnumerationPromise;
  activeEnumerationJobId = jobId;
  activeEnumerationPromise = runEnumerationInternal(jobId).finally(() => {
    if (activeEnumerationJobId === jobId) {
      activeEnumerationPromise = null;
      activeEnumerationJobId = null;
    }
  });
  return activeEnumerationPromise;
}

const BulkJobManager = {
  SESSION_KEY,
  KEEPALIVE_ALARM,
  RETRY_ALARM_PREFIX,

  reportBuildProgress(buildId, statusText) {
    return trackDownloadExecution.reportProgress(buildId, statusText);
  },

  async getDownloadOperation(operationId) {
    return SCBulkLibrary.getOperation(operationId);
  },

  async recoverDirectOperations() {
    const active = await SCBulkLibrary.getOperationsByState(["resolving", "building", "built", "save_requested", "download_started", "saving"]);
    for (const operation of active) {
      if (["resolving", "building", "built"].includes(operation.state)) {
        const result = { success: false, operationId: operation.operationId, code: "interrupted_before_save",
          error: "The export stopped before saving. It is safe to retry." };
        await SCBulkLibrary.updateOperation(operation.operationId, { state: "failed", stage: "failed", result, error: result.error });
        continue;
      }
      if (operation.state === "download_started" && Number.isInteger(operation.downloadId)) {
        const items = await new Promise((resolve) => chrome.downloads.search({ id: operation.downloadId },
          (values) => resolve(chrome.runtime.lastError ? [] : values || [])));
        const item = items[0];
        if (item?.state === "complete") {
          const result = { success: true, operationId: operation.operationId, recovered: true,
            fileName: item.filename ? String(item.filename).split(/[\\/]/).pop() : null, destinationName: "Downloads" };
          await SCBulkLibrary.updateOperation(operation.operationId, { state: "completed", stage: "completed", result, error: null });
          continue;
        }
        if (item?.state === "interrupted") {
          const result = { success: false, operationId: operation.operationId, code: "download_interrupted",
            error: item.error || "The browser download was interrupted. It is safe to retry." };
          await SCBulkLibrary.updateOperation(operation.operationId, { state: "failed", stage: "failed", result, error: result.error });
          continue;
        }
      }
      const result = { success: false, operationId: operation.operationId, code: "ambiguous_save",
        error: "Saving may have started. Check the destination before retrying." };
      await SCBulkLibrary.updateOperation(operation.operationId, {
        state: "ambiguous_save", stage: "ambiguous_save", result, error: result.error,
      });
    }
    return active.length;
  },

  async downloadSingleTrack(
    trackData,
    formatPreference = "auto",
    downloadDestination = null,
    playbackTransform = null,
    effects = null,
    operationId = null
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
        executeDirectOperation({ operationId, trackData, formatPreference: formatPreference || "auto",
          destination: resolvedDestination, playbackTransform, effects })
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
    downloadDestination = null,
    effects = null,
    operationId = null
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
        executeDirectOperation({ operationId, trackData, formatPreference: formatPreference || "auto",
          destination: resolvedDestination, trimRange, playbackTransform, effects })
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

  async renderLoopSlices(trackData, operationId, owner) {
    singleDownloadsInFlight += 1;
    try {
      await startKeepalive();
      return await queueSingleDownload(async () => {
        let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          const resolved = await SCDownloadSource.resolveForPlayback(trackData, "auto", {
            forceRefresh: attempt > 0, reason: attempt > 0 ? "expired_media" : "initial", attempt,
          });
          result = await sendOffscreenMessage({ type: "OFFSCREEN_SLICES_RENDER", operationId, owner,
            streamUrl: resolved.streamUrl, trackData: resolved.trackData });
          if (result?.success || ![401, 403, 404].includes(result?.status)) break;
        }
        return result;
      });
    } finally {
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      if ((!activeJob || !isActiveJobStatus(activeJob.status)) && singleDownloadsInFlight === 0) {
        await stopKeepalive().catch(() => {});
        await closeOffscreenDocument().catch(() => {});
      }
    }
  },

  async analyzeWaveform(trackData) {
    singleDownloadsInFlight += 1;
    try {
      await startKeepalive();
      return await queueSingleDownload(async () => {
        let result;
        const streaming = SCSpectralWaveform.needsStreaming(trackData.durationMs);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const resolved = await SCDownloadSource.resolveForPlayback(trackData, streaming ? "mp3" : "auto", {
            // Existing metadata may point to an original WAV/AAC file. Re-resolve
            // long tracks as MP3 so the decoder can consume independent frames.
            forceRefresh: attempt > 0 || (streaming && !trackData.streamMimeType?.includes('audio/mpeg')),
            reason: attempt > 0 ? "expired_media" : "initial",
            attempt,
          });
          result = await sendOffscreenMessage({ type: "OFFSCREEN_WAVEFORM", streamUrl: resolved.streamUrl, trackData: resolved.trackData });
          if (result?.success || ![401, 403, 404].includes(result?.status)) break;
        }
        if (!result?.success) throw new Error(result?.error || "Could not analyze the waveform.");
        return result;
      });
    } finally {
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      if (!activeJob || !isActiveJobStatus(activeJob.status)) {
        if (singleDownloadsInFlight === 0) {
          await stopKeepalive().catch(() => {});
          await closeOffscreenDocument().catch(() => {});
        }
      }
    }
  },

  async renderLoopPad(trackData, index, trimRange, playbackTransform, effects, name, operationId = `pad_${Date.now()}_${index}`) {
    singleDownloadsInFlight += 1;
    try {
      await startKeepalive();
      return await queueSingleDownload(async () => {
        let result;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const resolved = await SCDownloadSource.resolveForPlayback(trackData, "auto", {
            forceRefresh: attempt > 0,
            reason: attempt > 0 ? "expired_media" : "initial",
            attempt,
          });
          result = await sendOffscreenMessage({
            type: "OFFSCREEN_PAD_RENDER",
            buildId: `track_pad_${operationId.replace(/^pad_/, "")}_${index}`,
            operationId,
            index,
            name,
            streamUrl: resolved.streamUrl,
            trackData: resolved.trackData,
            trimRange,
            playbackTransform,
            effects,
          });
          if (result?.success || ![401, 403, 404].includes(result?.status)) break;
        }
        if (!result?.success) throw new Error(result?.error || "Could not prepare the loop sample.");
        return result;
      });
    } finally {
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      if (!activeJob || !isActiveJobStatus(activeJob.status)) {
        if (singleDownloadsInFlight === 0) {
          await stopKeepalive().catch(() => {});
          await closeOffscreenDocument().catch(() => {});
        }
      }
    }
  },

  async renderLoopInstrument(trackData, trimRange, playbackTransform, effects, name, operationId = `instrument_${Date.now()}`, { fullTrack = false, onChunk } = {}) {
    singleDownloadsInFlight += 1;
    instrumentOperationPhases.set(operationId, "queued");
    try {
      throwIfInstrumentCancelled(operationId);
      await startKeepalive();
      return await queueSingleDownload(async () => {
        throwIfInstrumentCancelled(operationId);
        let result;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          throwIfInstrumentCancelled(operationId);
          const resolved = await SCDownloadSource.resolveForPlayback(trackData, "auto", {
            // A bounded instrument (including Stems) needs only A–B. Full-track
            // piano instruments retain their existing source selection.
            preferHls: Boolean(trimRange) && !fullTrack,
            forceRefresh: attempt > 0,
            reason: attempt > 0 ? "expired_media" : "initial",
            attempt,
          });
          throwIfInstrumentCancelled(operationId);
          instrumentOperationPhases.set(operationId, "offscreen");
          result = await sendOffscreenMessage({
            type: "OFFSCREEN_INSTRUMENT_RENDER",
            fullTrack,
            buildId: `track_${operationId}`,
            operationId,
            name,
            streamUrl: resolved.streamUrl,
            trackData: resolved.trackData,
            trimRange,
            playbackTransform,
            effects,
          });
          instrumentOperationPhases.set(operationId, "queued");
          throwIfInstrumentCancelled(operationId);
          if (result?.success || ![401, 403, 404].includes(result?.status)) break;
        }
        if (!result?.success) throw new Error(result?.error || "Could not prepare the loop instrument.");
        if (fullTrack) {
          if (!result.instrument?.fullTrack || !Number.isSafeInteger(result.instrument.byteLength) ||
              result.instrument.byteLength <= 0 || result.instrument.byteLength > 128 * 1024 * 1024 || typeof onChunk !== "function") {
            throw new Error("Invalid instrument transfer.");
          }
          instrumentOperationPhases.set(operationId, "offscreen");
          for (let offset = 0; offset < result.instrument.byteLength;) {
            throwIfInstrumentCancelled(operationId);
            const part = await sendOffscreenMessage({ type: "OFFSCREEN_INSTRUMENT_READ", operationId, offset });
            throwIfInstrumentCancelled(operationId);
            if (!part?.success || part.chunk?.offset !== offset || !Number.isSafeInteger(part.chunk?.byteLength) ||
                part.chunk.byteLength <= 0 || part.chunk.byteLength > 1024 * 1024 || offset + part.chunk.byteLength > result.instrument.byteLength) {
              throw new Error(part?.error || "Could not transfer the instrument audio.");
            }
            await onChunk(part.chunk);
            offset += part.chunk.byteLength;
          }
          throwIfInstrumentCancelled(operationId);
        }
        return result;
      });
    } catch (error) {
      if (fullTrack && instrumentOperationPhases.get(operationId) === "offscreen") {
        await sendOffscreenMessage({ type: "OFFSCREEN_INSTRUMENT_CANCEL", operationId }).catch(() => {});
      }
      throw error;
    } finally {
      instrumentOperationPhases.delete(operationId);
      singleDownloadsInFlight = Math.max(0, singleDownloadsInFlight - 1);
      const activeJob = await loadJob().catch(() => null);
      if ((!activeJob || !isActiveJobStatus(activeJob.status)) && singleDownloadsInFlight === 0) {
        await stopKeepalive().catch(() => {});
        await closeOffscreenDocument().catch(() => {});
      }
    }
  },

  async cancelLoopInstrument(operationId) {
    if (typeof operationId !== "string" || !/^instrument_[A-Za-z0-9_-]{8,100}$/.test(operationId)) {
      throw new Error("Invalid instrument operation.");
    }
    pruneCancelledInstrumentOperations();
    cancelledInstrumentOperations.set(operationId, Date.now());
    if (instrumentOperationPhases.get(operationId) !== "offscreen") {
      return { success: true, cancelled: false, code: "instrument_cancelled" };
    }
    return sendOffscreenMessage({ type: "OFFSCREEN_INSTRUMENT_CANCEL", operationId })
      .catch(() => ({ success: true, cancelled: false, code: "instrument_cancelled" }));
  },

  async padMessage(message) {
    return sendOffscreenMessage(message);
  },

  async createJob(
    tracks,
    playlistTitle,
    playlistMeta = {},
    formatPreference = "auto",
    downloadDestination = null
  ) {
    if (!Array.isArray(tracks) || tracks.length < 1 || tracks.length > 200) {
      throw Object.assign(new Error("Legacy bulk jobs are limited to 200 tracks; use paged collection jobs."), { code: "invalid_request" });
    }
    const resolvedDestination = await destinationHandler.resolve(
      downloadDestination
    );

    return withJobState(async () => {
      const existing = await loadJob();
      if (existing && isActiveJobStatus(existing.status)) {
        throw new Error("A bulk download is already in progress.");
      }
      await SCBulkLibrary.cleanupTerminalJobs();

      if (singleDownloadsInFlight > 0) {
        throw new Error("A track download is already in progress.");
      }

      const collectionFolder = sanitizeFolderName(playlistTitle);
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const firstTrack = SCDownloadTrack.migrate(tracks[0]);
      const job = await createStoredJob(jobId, tracks, {
        status: JOB_STATUS.RUNNING,
        playlistTitle: playlistTitle || "Untitled playlist",
        folderName: collectionFolder,
        downloadDestination: resolvedDestination,
        artworkUrl:
          playlistMeta.artworkUrl ||
          firstTrack?.artworkUrl ||
          null,
        artist: playlistMeta.artist || tracks[0]?.artist || null,
        artistImageUrl:
          playlistMeta.artistImageUrl || tracks[0]?.artistImageUrl || null,
        artistUrl: playlistMeta.artistUrl || tracks[0]?.artistUrl || null,
        formatPreference: formatPreference || "auto",
        clientId: tracks[0]?.clientId || null,
        currentIndex: 0,
        failed: [],
        currentTrackTitle: null,
        currentTrackStatus: null,
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      });

      await persistJobSummary(job);
      await updateBadge(job);
      await startKeepalive();
      jobControl = { jobId: job.jobId, state: JOB_STATUS.RUNNING };
      runJobLoop(job.jobId);

      return getPublicJobSnapshot(job);
    });
  },

  async createPagedJob(
    tabId,
    collection,
    requestedLimit = null,
    formatPreference = "auto",
    downloadDestination = null,
    selection = null
  ) {
    if (!Number.isInteger(tabId) || !collection?.title) {
      throw Object.assign(new Error("Bulk collection context is invalid."), { code: "invalid_request" });
    }
    if (requestedLimit != null && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) {
      throw Object.assign(new Error("Bulk download limit is invalid."), { code: "invalid_request" });
    }
    const selectionMode = selection?.mode || "all";
    const selectionIds = Array.isArray(selection?.ids) ? selection.ids.map(String) : [];
    if (!["all", "all_except", "explicit"].includes(selectionMode) || selectionIds.length > 50_000 ||
        selectionIds.some((value) => !/^[A-Za-z0-9:_-]{1,128}$/.test(value))) {
      throw Object.assign(new Error("Bulk selection is invalid."), { code: "invalid_request" });
    }
    const resolvedDestination = await destinationHandler.resolve(downloadDestination);
    return withJobState(async () => {
      const existing = await loadJob();
      if (existing && isActiveJobStatus(existing.status)) {
        throw new Error("A bulk download is already in progress.");
      }
      await SCBulkLibrary.cleanupTerminalJobs();
      if (singleDownloadsInFlight > 0) throw new Error("A track download is already in progress.");

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await SCBulkLibrary.createJob({
        jobId,
        sourceType: collection.kind || "collection",
        sourceUserId: collection.sourceUserId,
        sourceUrl: collection.pageUrl || collection.sourceUrl,
        clientId: collection.clientId,
        sourceAuthenticated: collection.sourceAuthenticated === true,
        mode: requestedLimit == null ? "all" : "limit",
        requestedLimit,
        selectionMode,
        selectionIds,
      });
      const job = await SCBulkLibrary.updateJob(jobId, [JOB_STATUS.ENUMERATING], {
        enumerating: true,
        enumerationTabId: null,
        playlistTitle: collection.title,
        folderName: sanitizeFolderName(collection.title),
        downloadDestination: resolvedDestination,
        formatPreference: formatPreference || "auto",
        clientId: collection.clientId || null,
        currentTrackStatus: "Loading collection pages...",
        artworkUrl: collection.artworkUrl || null,
        artist: collection.artist || null,
        artistImageUrl: collection.artistImageUrl || null,
        artistUrl: collection.artistUrl || null,
      });
      await persistJobSummary(job);
      await updateBadge(job);
      await startKeepalive();
      jobControl = { jobId, state: JOB_STATUS.ENUMERATING };
      runEnumeration(jobId);
      return getPublicJobSnapshot(job);
    });
  },

  async getStatus() {
    await BulkJobManager.ensureJobRunning();
    const job = await loadJob();
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async pauseJob() {
    const current = await loadJob();
    if (current?.status === JOB_STATUS.ENUMERATING) {
      const job = await SCBulkLibrary.updateJob(current.jobId, [JOB_STATUS.ENUMERATING], {
        status: JOB_STATUS.PAUSED,
        enumerating: true,
        pausedAt: Date.now(),
        currentTrackStatus: "Collection loading paused.",
      });
      jobControl = { jobId: current.jobId, state: JOB_STATUS.PAUSED };
      await persistJobSummary(job);
      broadcastJobUpdate(job);
      return { success: true, job: getPublicJobSnapshot(job) };
    }
    const job = await mutateJob(
      null,
      { statuses: [JOB_STATUS.RUNNING] },
      (value) => {
        transitionJob(value, JOB_STATUS.PAUSED);
        jobControl = { jobId: value.jobId, state: JOB_STATUS.PAUSED };
      }
    );
    if (!job) {
      return { success: false, error: "No running job to pause." };
    }
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async resumeJob(expectedJobId = null) {
    const current = await loadJob();
    if (expectedJobId && current?.jobId !== expectedJobId) return { success: false, error: "stale_retry_alarm" };
    if (current?.status === JOB_STATUS.PAUSED && current.enumerating) {
      if (Number.isFinite(current.retryAt) && current.retryAt > Date.now()) {
        return { success: false, error: "SoundCloud asked the extension to wait before retrying.",
          retryAt: current.retryAt, job: getPublicJobSnapshot(current) };
      }
      const job = await SCBulkLibrary.updateJob(current.jobId, [JOB_STATUS.PAUSED], {
        status: JOB_STATUS.ENUMERATING,
        pausedAt: null,
        error: null,
        retryAt: null,
        currentTrackStatus: `Found ${current.eligible} downloadable tracks...`,
      });
      jobControl = { jobId: job.jobId, state: JOB_STATUS.ENUMERATING };
      await chrome.alarms.clear(`${RETRY_ALARM_PREFIX}${job.jobId}`);
      await startKeepalive();
      await persistJobSummary(job);
      runEnumeration(job.jobId);
      broadcastJobUpdate(job);
      return { success: true, job: getPublicJobSnapshot(job) };
    }
    const job = await mutateJob(
      null,
      { statuses: [JOB_STATUS.PAUSED], broadcast: false },
      (value) => {
        transitionJob(value, JOB_STATUS.RUNNING);
        jobControl = { jobId: value.jobId, state: JOB_STATUS.RUNNING };
      }
    );
    if (!job) {
      return { success: false, error: "No paused job to resume." };
    }
    await startKeepalive();
    runJobLoop(job.jobId);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async retryFailedJob() {
    const current = await loadJob();
    if (!current || ![JOB_STATUS.COMPLETED, JOB_STATUS.COMPLETED_WITH_ERRORS, JOB_STATUS.FAILED].includes(current.status)) {
      return { success: false, error: "No failed tracks are available to retry." };
    }
    const retried = await SCBulkLibrary.retryFailed(current.jobId);
    if (!retried?.reset) return { success: false, error: "No failed tracks are available to retry." };
    const job = await SCBulkLibrary.updateJob(current.jobId, [current.status], {
      status: JOB_STATUS.RUNNING,
      finishedAt: null,
      error: null,
      currentTrackTitle: null,
      currentTrackStatus: null,
    });
    jobControl = { jobId: job.jobId, state: JOB_STATUS.RUNNING };
    await persistJobSummary(job);

    if (activeLoopPromise && activeLoopJobId === job.jobId) {
      await activeLoopPromise;
    }
    await startKeepalive();
    runJobLoop(job.jobId);
    broadcastJobUpdate(job);
    return { success: true, job: getPublicJobSnapshot(job) };
  },

  async cancelJob() {
    const current = await loadJob();
    if (current && [JOB_STATUS.ENUMERATING, JOB_STATUS.READY].includes(current.status)) {
      const job = await SCBulkLibrary.cancel(current.jobId);
      jobControl = { jobId: current.jobId, state: JOB_STATUS.CANCELLED };
      await persistJobSummary(job);
      await finishJobResources(job);
      broadcastJobUpdate(job);
      return { success: true, job: getPublicJobSnapshot(job) };
    }
    const job = await mutateJob(
      null,
      { statuses: ACTIVE_JOB_STATUSES, badge: false, broadcast: false },
      (value) => {
        transitionJob(value, JOB_STATUS.CANCELLED);
        jobControl = { jobId: value.jobId, state: JOB_STATUS.CANCELLED };
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

    if (job.status === JOB_STATUS.ENUMERATING || job.status === JOB_STATUS.READY) {
      await startKeepalive();
      jobControl = { jobId: job.jobId, state: job.status };
      runEnumeration(job.jobId);
      return;
    }
    if (job.status === JOB_STATUS.PAUSED && job.enumerating) {
      await updateBadge(job);
      jobControl = { jobId: job.jobId, state: JOB_STATUS.PAUSED };
      return;
    }

    const saving = await SCBulkLibrary.getTracksByState(job.jobId, TRACK_STATUS.SAVING, 500);
    for (const record of saving) {
        const index = record.index;
        const downloadId = record.downloadId;
        if (downloadId) {
          const state = await waitForStartedDownload(downloadId);
          if (state === "complete") {
            await recordTrackSuccess(job.jobId, index);
            continue;
          }
          if (state === "interrupted") {
            await recordTrackFailure(job.jobId, index, record.track?.title,
              "Chrome interrupted the download.");
            continue;
          }
        }
        await recordAmbiguousSave(job.jobId, index, record.track?.title,
          "Save was interrupted. Check the destination before retrying.");
    }
    await updateBadge(await loadJob());
    await startKeepalive();
    jobControl = { jobId: job.jobId, state: job.status };
    runJobLoop(job.jobId);
  },

  async ensureJobRunning() {
    const job = await loadJob();
    if (!job || !isActiveJobStatus(job.status)) {
      return;
    }

    if (activeLoopPromise !== null && activeLoopJobId === job.jobId) {
      await updateBadge(job);
      return;
    }

    await BulkJobManager.recoverRunningJob();
  },
};
