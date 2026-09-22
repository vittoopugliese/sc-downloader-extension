const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "bulk-job-manager.js"), "utf8");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
  let storedJob = clone(options.storedJob || null);
  const durableJobs = new Map();
  const durableTracks = new Map();
  let active = 0;
  let maxActive = 0;
  let automatic = options.automatic !== false;
  let failIds = new Set(options.failIds || []);
  let offscreenExists = options.offscreenInitiallyMissing !== true;
  let getContextsCalls = 0;
  let releasePausedGetContexts = null;
  let markPausedGetContexts;
  const pausedGetContexts = new Promise((resolve) => { markPausedGetContexts = resolve; });
  const releases = [];
  const starts = [];
  const effects = { create: 0, close: 0, notifications: 0, abort: 0 };
  const downloadListeners = new Set();
  const downloadStates = new Map(Object.entries(options.downloadStates || {}).map(([id, state]) => [Number(id), state]));
  const bulkPageCalls = [];

  const bulkLibrary = {
    async createJob(spec) {
      const job = { jobId: spec.jobId, status: "enumerating", epoch: 0, revision: 0,
        eligible: 0, saved: 0, failed: 0, retryableFailedCount: 0, ambiguousCount: 0,
        remaining: 0, createdAt: spec.createdAt || Date.now(),
        recentFailures: [], requestedLimit: spec.requestedLimit ?? null, nextCursor: spec.initialCursor ?? null };
      durableJobs.set(job.jobId, job);
      durableTracks.set(job.jobId, []);
      return clone(job);
    },
    async commitPage(jobId, page) {
      const job = durableJobs.get(jobId);
      const records = durableTracks.get(jobId);
      const allowed = job.requestedLimit == null ? page.items : page.items.slice(0, Math.max(0, job.requestedLimit - records.length));
      for (const item of allowed) records.push({ jobId, index: records.length, trackId: item.trackId,
        track: clone(item.track), state: "pending", attempts: 0, downloadId: null, error: null });
      job.eligible = records.length;
      job.remaining = records.length;
      job.nextCursor = page.nextCursor;
      if (page.done || page.nextCursor == null || (job.requestedLimit != null && job.eligible >= job.requestedLimit)) job.status = "ready";
      return { job: clone(job), inserted: allowed.length };
    },
    async getJob(jobId) { return clone(durableJobs.get(jobId) || null); },
    async getActiveJob() {
      const activeStatuses = new Set(["enumerating", "ready", "running", "paused"]);
      const jobs = [...durableJobs.values()].filter(job => activeStatuses.has(job.status));
      jobs.sort((left, right) => (right.updatedAt || right.createdAt || 0) -
        (left.updatedAt || left.createdAt || 0));
      return clone(jobs[0] || null);
    },
    async cleanupTerminalJobs() { return []; },
    async recountFailures(jobId) { return clone(durableJobs.get(jobId) || null); },
    async getTrack(jobId, index) { return clone(durableTracks.get(jobId)?.[index] || null); },
    async getTracksByState(jobId, state, limit) {
      return clone((durableTracks.get(jobId) || []).filter(record => record.state === state).slice(0, limit));
    },
    async updateJob(jobId, expected, patch) {
      const job = durableJobs.get(jobId);
      if (!job || (expected?.length && !expected.includes(job.status))) return null;
      Object.assign(job, typeof patch === "function" ? await patch(clone(job)) : clone(patch));
      job.revision += 1;
      return clone(job);
    },
    async updateTrackState(jobId, index, state, detail = {}) {
      const job = durableJobs.get(jobId);
      const record = durableTracks.get(jobId)?.[index];
      if (!job || !record || (detail.expectedStates?.length && !detail.expectedStates.includes(record.state))) return null;
      if (detail.expectedJobStatuses?.length && !detail.expectedJobStatuses.includes(job.status)) return null;
      if (record.state === "done") job.saved -= 1;
      if (["failed", "ambiguous_save"].includes(record.state)) job.failed -= 1;
      if (record.state === "failed") job.retryableFailedCount -= 1;
      if (record.state === "ambiguous_save") job.ambiguousCount -= 1;
      record.state = state;
      if (detail.downloadId != null) record.downloadId = detail.downloadId;
      if (Object.hasOwn(detail, "error")) record.error = detail.error;
      if (state === "done") job.saved += 1;
      if (["failed", "ambiguous_save"].includes(state)) {
        job.failed += 1;
        if (state === "failed") job.retryableFailedCount += 1;
        if (state === "ambiguous_save") job.ambiguousCount += 1;
        job.recentFailures = [...job.recentFailures.filter(value => value.index !== index + 1), {
          index: index + 1, title: record.track.title, error: record.error || "Unknown error",
          ...(state === "ambiguous_save" ? { ambiguous: true } : {}),
        }].slice(-100);
      } else if (["done", "pending"].includes(state)) {
        job.recentFailures = job.recentFailures.filter(value => value.index !== index + 1);
      }
      job.remaining = Math.max(0, job.eligible - job.saved - job.failed);
      job.currentIndex = Math.max(job.currentIndex || 0, ["done", "failed", "ambiguous_save"].includes(state) ? index + 1 : 0);
      return { job: clone(job), track: clone(record) };
    },
    async retryFailed(jobId) {
      const job = durableJobs.get(jobId);
      let reset = 0;
      for (const record of durableTracks.get(jobId) || []) {
        if (record.state !== "failed") continue;
        record.state = "pending";
        record.error = null;
        reset += 1;
      }
      job.failed -= reset;
      job.retryableFailedCount -= reset;
      job.remaining += reset;
      job.recentFailures = job.recentFailures.filter(value => value.ambiguous);
      return { job: clone(job), reset };
    },
  };

  const execution = {
    async execute(request) {
      starts.push(request.trackData.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      request.onStage?.("resolving");
      request.onProgress?.("Downloading 1/2 parts...");
      try {
        if (!automatic) {
          await new Promise((resolve) => releases.push(resolve));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (await request.isCancelled?.()) return { cancelled: true };
        if (failIds.has(request.trackData.id)) {
          throw new Error(`failed ${request.trackData.id}`);
        }
        return { success: true, fileName: `${request.trackData.id}.mp3` };
      } finally {
        active -= 1;
      }
    },
    async abortAll() {
      effects.abort += 1;
    },
    async reportProgress() {
      return false;
    },
  };

  const context = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    SCFormat: { sanitizePathComponent: (value, fallback) => value || fallback },
    SCDownloadTrack: {
      migrate: (track) => ({ ...track, artworkUrl: track.artworkUrl || track.coverUrl || null }),
      toDurable: (track, album) => ({ ...track, album: track.album || album || null }),
      canDownload: (track) => Boolean(track?.streamUrl),
    },
    SCDownloadSource: { resolve: async (trackData) => ({ trackData, streamUrl: trackData.streamUrl }) },
    SCDownloadDestination: {
      create: () => ({
        resolve: async (value) => value,
        save: async (value) => value,
      }),
    },
    SCTrackDownloadExecution: { create: () => execution },
    SCDownloadDirectory: { getCurrent: async () => null },
    SCBulkLibrary: bulkLibrary,
    chrome: {
      runtime: {
        lastError: null,
        getURL: (value) => `chrome-extension://test/${value}`,
        getContexts: async () => {
          getContextsCalls += 1;
          if (getContextsCalls === options.pauseGetContextsCall) {
            markPausedGetContexts();
            await new Promise((resolve) => { releasePausedGetContexts = resolve; });
          }
          return offscreenExists ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [];
        },
        sendMessage: async () => ({ success: true }),
      },
      tabs: {
        sendMessage(_tabId, message, _options, callback) {
          bulkPageCalls.push(message.cursor ?? null);
          const key = message.cursor ?? "first";
          const page = options.bulkPages?.[key];
          setTimeout(() => callback(page
            ? { success: true, page: clone(page) }
            : { success: false, code: "stale_context", error: "Missing bulk fixture page." }), 0);
        },
      },
      storage: {
        session: {
          async get(key) { return { [key]: clone(storedJob) }; },
          async set(value) { storedJob = clone(value.scdl_active_job); },
        },
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      alarms: { create: async () => {}, clear: async () => {} },
      notifications: {
        create(_id, _options, callback) {
          effects.notifications += 1;
          callback();
        },
      },
      downloads: {
        search: async ({ id }) => [{ id, state: downloadStates.get(id) || options.downloadState || "complete" }],
        onChanged: {
          addListener(listener) { downloadListeners.add(listener); },
          removeListener(listener) { downloadListeners.delete(listener); },
        },
      },
      offscreen: {
        createDocument: async () => {
          effects.create += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          offscreenExists = true;
        },
        closeDocument: async () => { effects.close += 1; offscreenExists = false; },
      },
    },
  });
  vm.runInContext(source, context, { filename: "bulk-job-manager.js" });
  return {
    manager: vm.runInContext("BulkJobManager", context),
    updateTrackProgress: vm.runInContext("updateTrackProgress", context),
    starts,
    bulkPageCalls,
    effects,
    get maxActive() { return maxActive; },
    get job() {
      const jobId = storedJob?.activeJobId;
      const durable = jobId && durableJobs.get(jobId);
      if (!durable) return clone(storedJob);
      const records = durableTracks.get(jobId) || [];
      return clone({ ...durable, id: durable.jobId, tracks: records.map(value => value.track),
        trackStatus: records.map(value => value.state === "pending" ? null : value.state),
        downloadIds: Object.fromEntries(records.filter(value => value.downloadId != null).map(value => [value.index, value.downloadId])),
        completed: durable.saved, failed: durable.recentFailures });
    },
    get session() { return clone(storedJob); },
    clearSession() { storedJob = null; },
    markTrackState(jobId, index, state, detail) {
      return bulkLibrary.updateTrackState(jobId, index, state, detail);
    },
    releaseAll() { releases.splice(0).forEach((resolve) => resolve()); },
    setAutomatic(value) { automatic = value; },
    setFailIds(ids) { failIds = new Set(ids); },
    setDownloadState(id, state) {
      downloadStates.set(id, state);
      for (const listener of downloadListeners) listener({ id, state: { current: state } });
    },
    waitForPausedGetContexts() { return pausedGetContexts; },
    releaseGetContexts() { releasePausedGetContexts?.(); },
  };
}

function tracks(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Track ${index + 1}`,
    artist: "Artist",
    streamUrl: `https://api.test/${index + 1}`,
    clientId: "client",
  }));
}

async function waitFor(predicate, label, timeout = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

(async () => {
  const partial = createHarness({ failIds: [2] });
  await partial.manager.createJob(tracks(3), "Set");
  await waitFor(() => ["completed_with_errors", "failed"].includes(partial.job?.status), "partial job");
  assert.equal(partial.job.status, "completed_with_errors");
  assert.equal(partial.job.completed, 2);
  assert.equal(partial.job.failed.length, 1);
  assert.equal(Object.hasOwn(partial.session, "tracks"), false);
  assert.equal(partial.session.version, 2);
  assert.equal(partial.maxActive, 1, "Bulk downloads must limit peak audio memory");
  assert.equal(partial.effects.notifications, 1);
  assert.equal(partial.effects.close, 1);
  partial.setFailIds([]);
  assert.equal((await partial.manager.retryFailedJob()).success, true);
  await waitFor(
    () => partial.job?.status === "completed" && partial.job.completed === 3,
    "retried job"
  );
  assert.equal(partial.job.failed.length, 0);
  assert.deepEqual(partial.starts, [1, 2, 3, 2], "Only failed tracks must be retried");

  const paused = createHarness({ automatic: false });
  await paused.manager.createJob(tracks(3), "Paused set");
  await waitFor(() => paused.starts.length === 1, "one in-flight track");
  assert.equal((await paused.manager.pauseJob()).success, true);
  assert.equal((await paused.manager.pauseJob()).success, false);
  paused.releaseAll();
  await waitFor(() => paused.job?.completed === 1, "in-flight track saved while paused");
  assert.equal(paused.job.status, "paused");
  assert.equal(paused.starts.length, 1, "Pause dispatched another track");
  paused.setAutomatic(true);
  assert.equal((await paused.manager.resumeJob()).success, true);
  await waitFor(() => paused.job?.status === "completed", "resumed job");
  assert.deepEqual(paused.starts, [1, 2, 3]);

  const cancelled = createHarness({ automatic: false });
  await cancelled.manager.createJob(tracks(3), "Cancelled set");
  await waitFor(() => cancelled.starts.length === 1, "cancel in-flight track");
  const cancelResult = await cancelled.manager.cancelJob();
  assert.equal(cancelResult.success, true);
  await cancelled.updateTrackProgress(
    cancelled.job.id,
    0,
    cancelled.job.tracks.length,
    "Track 1",
    "late progress"
  );
  assert.equal(cancelled.job.currentTrackStatus, null, "Cancelled job accepted late progress");
  cancelled.releaseAll();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.completed, 0, "Cancelled builds saved late results");
  assert.equal(cancelled.effects.abort, 1);
  assert.equal(cancelled.effects.notifications, 1);
  assert.equal(cancelled.effects.close, 1);

  const recoveredJob = {
    id: "recovered",
    status: "running",
    playlistTitle: "Recovered",
    folderName: "Recovered",
    tracks: tracks(2),
    formatPreference: "auto",
    trackStatus: [null, null],
    currentIndex: 0,
    completed: 0,
    failed: [],
    startedAt: Date.now(),
  };
  const recovered = createHarness({ storedJob: recoveredJob });
  await Promise.all([
    recovered.manager.recoverRunningJob(),
    recovered.manager.recoverRunningJob(),
  ]);
  await waitFor(() => recovered.job?.status === "completed", "recovered job");
  assert.deepEqual([...recovered.starts].sort(), [1, 2]);

  const uncertain = createHarness({ storedJob: {
    ...recoveredJob, id: "uncertain", trackStatus: ["saving", "done"],
    completed: 1, currentIndex: 2,
  } });
  await uncertain.manager.recoverRunningJob();
  await waitFor(() => uncertain.job?.status === "completed_with_errors", "ambiguous save recovery");
  assert.deepEqual(uncertain.starts, [], "An uncertain save must never start another download");
  assert.equal(uncertain.job.trackStatus[0], "ambiguous_save");
  assert.equal(uncertain.job.failed[0].ambiguous, true);
  assert.equal((await uncertain.manager.retryFailedJob()).success, false);

  const chromeSaved = createHarness({ storedJob: {
    ...recoveredJob, id: "chrome-saved", trackStatus: ["saving", "done"],
    downloadIds: { 0: 42 }, completed: 1, currentIndex: 2,
  } });
  await chromeSaved.manager.recoverRunningJob();
  await waitFor(() => chromeSaved.job?.status === "completed", "Chrome save recovery");
  assert.deepEqual(chromeSaved.starts, []);
  assert.equal(chromeSaved.job.completed, 2);
  assert.equal(chromeSaved.job.failed.length, 0);

  const chromeInProgress = createHarness({ storedJob: {
    ...recoveredJob, id: "chrome-in-progress", trackStatus: ["saving", "done"],
    downloadIds: { 0: 43 }, completed: 1, currentIndex: 2,
  }, downloadStates: { 43: "in_progress" } });
  const pendingRecovery = chromeInProgress.manager.recoverRunningJob();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(chromeInProgress.job.trackStatus[0], "saving");
  assert.deepEqual(chromeInProgress.starts, [], "Recovery restarted an active Chrome download");
  chromeInProgress.setDownloadState(43, "complete");
  await pendingRecovery;
  await waitFor(() => chromeInProgress.job?.status === "completed", "active Chrome save recovery");
  assert.deepEqual(chromeInProgress.starts, []);
  assert.equal(chromeInProgress.job.completed, 2);

  const chromeInterrupted = createHarness({ storedJob: {
    ...recoveredJob, id: "chrome-interrupted", trackStatus: ["saving", "done"],
    downloadIds: { 0: 44 }, completed: 1, currentIndex: 2,
  }, downloadStates: { 44: "in_progress" } });
  const interruptedRecovery = chromeInterrupted.manager.recoverRunningJob();
  await new Promise((resolve) => setTimeout(resolve, 20));
  chromeInterrupted.setDownloadState(44, "interrupted");
  await interruptedRecovery;
  await waitFor(() => chromeInterrupted.job?.status === "completed_with_errors", "interrupted Chrome save recovery");
  assert.deepEqual(chromeInterrupted.starts, []);
  assert.equal(chromeInterrupted.job.trackStatus[0], "failed");

  const concurrent = createHarness({ automatic: false });
  const concurrentStarts = await Promise.allSettled([
    concurrent.manager.createJob(tracks(2), "First"),
    concurrent.manager.createJob(tracks(2), "Second"),
  ]);
  assert.equal(
    concurrentStarts.filter((result) => result.status === "fulfilled").length,
    1,
    "Concurrent bulk jobs both started"
  );
  assert.equal(
    concurrentStarts.filter((result) => result.status === "rejected").length,
    1,
    "Concurrent bulk job was not rejected"
  );
  await concurrent.manager.cancelJob();
  concurrent.releaseAll();

  const durableRecovery = createHarness({ automatic: false });
  await durableRecovery.manager.createJob(tracks(1), "Durable recovery");
  durableRecovery.clearSession();
  const recoveredWithoutSession = await durableRecovery.manager.getStatus();
  assert.equal(recoveredWithoutSession.job?.status, "running");
  assert.equal(recoveredWithoutSession.job?.playlistTitle, "Durable recovery");
  assert.equal(durableRecovery.session?.activeJobId, recoveredWithoutSession.job.id,
    "Durable recovery did not restore the session cache");
  await durableRecovery.manager.cancelJob();
  durableRecovery.releaseAll();

  const truncatedFailures = createHarness({ automatic: false });
  const truncatedJob = await truncatedFailures.manager.createJob(tracks(101), "Truncated failures");
  await truncatedFailures.markTrackState(truncatedJob.id, 0, "failed", { error: "retry me" });
  for (let index = 1; index < 101; index += 1) {
    await truncatedFailures.markTrackState(truncatedJob.id, index, "ambiguous_save", {
      error: "check folder",
    });
  }
  const truncatedStatus = await truncatedFailures.manager.getStatus();
  assert.equal(truncatedStatus.job.failed.length, 100);
  assert.equal(truncatedStatus.job.failed.every(value => value.ambiguous), true);
  assert.equal(truncatedStatus.job.retryableFailedCount, 1);
  assert.equal(truncatedStatus.job.ambiguousCount, 100);
  assert.equal(truncatedStatus.job.canRetry, true);
  await truncatedFailures.manager.cancelJob();
  truncatedFailures.releaseAll();

  const mixed = createHarness({ automatic: false });
  const bulkStart = mixed.manager.createJob(tracks(2), "Bulk");
  const singleStart = mixed.manager.downloadSingleTrack(tracks(1)[0]);
  const mixedSettled = Promise.allSettled([bulkStart, singleStart]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  mixed.releaseAll();
  const mixedStarts = await mixedSettled;
  assert.equal(
    mixedStarts.filter((result) => result.status === "fulfilled").length,
    1,
    "A bulk job and single-track download started concurrently"
  );

  const offscreenRace = createHarness({ offscreenInitiallyMissing: true });
  const simultaneousSingles = await Promise.all([
    offscreenRace.manager.downloadSingleTrack(tracks(1)[0]),
    offscreenRace.manager.downloadSingleTrack(tracks(1)[0]),
  ]);
  assert.equal(simultaneousSingles.length, 2);
  assert.equal(offscreenRace.effects.create, 1, "Concurrent downloads created two offscreen documents");
  assert.equal(offscreenRace.maxActive, 1, "Concurrent single downloads were not serialized");

  const closeRace = createHarness({ automatic: false, pauseGetContextsCall: 2 });
  const firstClosingDownload = closeRace.manager.downloadSingleTrack(tracks(1)[0]);
  await waitFor(() => closeRace.starts.length === 1, "first download before close race");
  closeRace.releaseAll();
  await closeRace.waitForPausedGetContexts();
  const leaseDuringClose = closeRace.manager.downloadSingleTrack(tracks(1)[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  closeRace.releaseGetContexts();
  await firstClosingDownload;
  await waitFor(() => closeRace.starts.length === 2, "second download during close race");
  assert.equal(closeRace.effects.close, 0, "Offscreen document closed after a new lease was acquired");
  closeRace.releaseAll();
  await leaseDuringClose;
  assert.equal(closeRace.effects.close, 1, "Last lease did not perform the deferred offscreen close");

  const paged = createHarness({ bulkPages: {
    first: { items: tracks(2), enumerated: 2, nextCursor: "page-2", done: false },
    "page-2": { items: tracks(1).map(track => ({ ...track, id: 3, title: "Track 3" })), enumerated: 1, nextCursor: null, done: true },
  } });
  await paged.manager.createPagedJob(7, { kind: "user_tracks", title: "Paged set", pageUrl: "https://soundcloud.com/a/tracks" });
  await waitFor(() => paged.job?.status === "completed", "paged collection job");
  assert.deepEqual(paged.bulkPageCalls, [null, "page-2"]);
  assert.deepEqual(paged.starts, [1, 2, 3]);
  assert.equal(Object.hasOwn(paged.session, "tracks"), false);

  const limited = createHarness({ bulkPages: {
    first: { items: tracks(3), enumerated: 3, nextCursor: "unused", done: false },
  } });
  await limited.manager.createPagedJob(8, { kind: "playlist", title: "Limited set" }, 2);
  await waitFor(() => limited.job?.status === "completed", "limited paged job");
  assert.deepEqual(limited.bulkPageCalls, [null]);
  assert.deepEqual(limited.starts, [1, 2]);
  console.log("Bulk job state machine verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
