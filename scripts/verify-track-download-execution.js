const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "track-download-execution.js"),
  "utf8"
);
const context = vm.createContext({ console, setTimeout, URL });
vm.runInContext(source, context, { filename: "track-download-execution.js" });

function createHarness(overrides = {}) {
  const calls = [];
  const dependencies = {
    async resolveSource(trackData, formatPreference) {
      calls.push(["resolve", trackData.id, formatPreference]);
      return { trackData: { ...trackData, resolved: true }, streamUrl: "stream:test" };
    },
    async buildTrack(request) {
      calls.push(["build", request.trackData.resolved, request.streamUrl]);
      return { success: true, blobUrl: "blob:test", fileName: "Artist - Track.mp3" };
    },
    async saveOutput(request) {
      calls.push([
        "save",
        request.fileName,
        request.destination?.id || null,
        request.collection?.folderName || null,
      ]);
      return {
        fileName: request.destination?.id
          ? `saved-${request.fileName}`
          : request.fileName,
        destinationName: request.destination?.name || "Downloads",
      };
    },
    async revokeBlob(blobUrl) {
      calls.push(["revoke", blobUrl]);
    },
    async abortBuild(buildId) {
      calls.push(["abort", buildId]);
    },
    ...overrides,
  };

  const execution = vm.runInContext(
    "SCTrackDownloadExecution.create",
    context
  )(dependencies);
  return { calls, execution };
}

(async () => {
  const single = createHarness();
  const singleResult = await single.execution.execute({
    trackData: { id: 1 },
    formatPreference: "mp3",
  });
  assert.equal(singleResult.success, true);
  assert.equal(singleResult.fileName, "Artist - Track.mp3");
  assert.deepEqual(single.calls, [
    ["resolve", 1, "mp3"],
    ["build", true, "stream:test"],
    ["save", "Artist - Track.mp3", null, null],
    ["revoke", "blob:test"],
  ]);

  const collection = createHarness();
  const collectionResult = await collection.execution.execute({
    trackData: { id: 2 },
    destination: { id: "music", name: "Music" },
    collection: { folderName: "Playlist", trackNumber: 3, totalTracks: 12 },
  });
  assert.equal(collectionResult.fileName, "saved-Artist - Track.mp3");
  assert.equal(collectionResult.destinationName, "Music");
  assert.deepEqual(collection.calls.at(-2), [
    "save",
    "Artist - Track.mp3",
    "music",
    "Playlist",
  ]);
  assert.deepEqual(collection.calls.at(-1), ["revoke", "blob:test"]);

  const downloadsCollection = createHarness();
  const stages = [];
  await downloadsCollection.execution.execute({
    trackData: { id: 22 },
    collection: { folderName: "Playlist", trackNumber: 3, totalTracks: 120 },
    onStage: (stage) => stages.push(stage),
  });
  assert.deepEqual(stages, ["resolving", "building", "saving"]);
  assert.deepEqual(downloadsCollection.calls.at(-2), [
    "save",
    "Artist - Track.mp3",
    null,
    "Playlist",
  ]);
  assert.deepEqual(downloadsCollection.calls.at(-1), ["revoke", "blob:test"]);

  const cancelled = createHarness();
  let cancellationChecks = 0;
  const cancelledResult = await cancelled.execution.execute({
    trackData: { id: 3 },
    isCancelled: () => {
      cancellationChecks += 1;
      return cancellationChecks === 2;
    },
  });
  assert.equal(cancelledResult.cancelled, true);
  assert.equal(cancelled.calls.some(([name]) => name === "save"), false);
  assert.deepEqual(cancelled.calls.at(-1), ["revoke", "blob:test"]);

  const failed = createHarness({
    async buildTrack() {
      throw new Error("build failed");
    },
  });
  await assert.rejects(
    failed.execution.execute({ trackData: { id: 4 } }),
    /build failed/
  );
  assert.equal(failed.calls.at(-1)[0], "abort");

  let releaseBuild;
  let activeBuildId = null;
  const progressValues = [];
  const progress = createHarness({
    async buildTrack(request) {
      activeBuildId = request.buildId;
      await new Promise((resolve) => {
        releaseBuild = resolve;
      });
      return { success: true, blobUrl: "blob:progress", fileName: "Track.mp3" };
    },
  });
  const progressDownload = progress.execution.execute({
    trackData: { id: 5 },
    onProgress: (statusText) => progressValues.push(statusText),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await progress.execution.reportProgress(
      activeBuildId,
      "Downloading 1/2 parts..."
    ),
    true
  );
  assert.deepEqual(progressValues, ["Downloading 1/2 parts..."]);
  releaseBuild();
  await progressDownload;
  assert.equal(await progress.execution.reportProgress(activeBuildId, "late"), false);

  console.log("Track download execution verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
