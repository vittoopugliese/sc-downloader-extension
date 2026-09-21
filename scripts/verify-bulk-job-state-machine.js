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
  let active = 0;
  let maxActive = 0;
  let automatic = options.automatic !== false;
  let failIds = new Set(options.failIds || []);
  let offscreenExists = options.offscreenInitiallyMissing !== true;
  const releases = [];
  const starts = [];
  const effects = { create: 0, close: 0, notifications: 0, abort: 0 };

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
    chrome: {
      runtime: {
        lastError: null,
        getURL: (value) => `chrome-extension://test/${value}`,
        getContexts: async () => offscreenExists ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [],
        sendMessage: async () => ({ success: true }),
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
      downloads: { search: async ({ id }) => [{ id, state: options.downloadState || "complete" }] },
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
    effects,
    get maxActive() { return maxActive; },
    get job() { return clone(storedJob); },
    releaseAll() { releases.splice(0).forEach((resolve) => resolve()); },
    setAutomatic(value) { automatic = value; },
    setFailIds(ids) { failIds = new Set(ids); },
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
  console.log("Bulk job state machine verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
