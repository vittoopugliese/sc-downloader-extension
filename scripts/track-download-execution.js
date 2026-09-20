const SCTrackDownloadExecution = (() => {
  function requireDependency(dependencies, name) {
    if (typeof dependencies[name] !== "function") {
      throw new Error(`Track download execution requires a ${name} dependency.`);
    }

    return dependencies[name];
  }

  function create(dependencies) {
    const resolveSource = requireDependency(dependencies, "resolveSource");
    const buildTrack = requireDependency(dependencies, "buildTrack");
    const saveOutput = requireDependency(dependencies, "saveOutput");
    const revokeBlob = requireDependency(dependencies, "revokeBlob");
    const abortBuild = requireDependency(dependencies, "abortBuild");
    const activeBuildIds = new Set();
    const progressByBuildId = new Map();

    async function execute(command) {
      if (!command?.trackData) {
        throw new Error("Track data is required.");
      }

      const onStage = command.onStage || (() => {});
      const isCancelled = command.isCancelled || (() => false);
      const operationId = `track_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      let activeBuildId = null;
      let blobUrl = null;

      try {
        await onStage("resolving");
        let buildResult;
        for (let sourceAttempt = 0; sourceAttempt < 2; sourceAttempt += 1) {
          if (await isCancelled()) return { success: false, cancelled: true };
          const resolved = await resolveSource(
            command.trackData,
            command.formatPreference || "auto",
            { forceRefresh: sourceAttempt > 0, reason: sourceAttempt > 0 ? "expired_media" : "initial", attempt: sourceAttempt }
          );

          if (await isCancelled()) {
            return { success: false, cancelled: true };
          }

          await onStage(sourceAttempt === 0 ? "building" : "refreshing");
          if (await isCancelled()) return { success: false, cancelled: true };
          const buildId = `${operationId}_${sourceAttempt}`;
          activeBuildId = buildId;
          activeBuildIds.add(buildId);
          if (typeof command.onProgress === "function") {
            progressByBuildId.set(buildId, command.onProgress);
          }
          buildResult = await buildTrack({
            buildId,
            trackData: resolved.trackData,
            streamUrl: resolved.streamUrl,
            trimRange: command.trimRange || null,
            playbackTransform: command.playbackTransform || null,
          });
          activeBuildIds.delete(buildId);
          progressByBuildId.delete(buildId);
          activeBuildId = null;
          if (buildResult?.success && buildResult.blobUrl) break;
          if (sourceAttempt === 0 && [401, 403, 404].includes(buildResult?.status)) continue;
          break;
        }
        if (!buildResult?.success || !buildResult.blobUrl) {
          const error = new Error(buildResult?.error || "Failed to build audio file.");
          error.code = buildResult?.code;
          error.status = buildResult?.status;
          throw error;
        }

        blobUrl = buildResult.blobUrl;
        if (await isCancelled()) {
          return { success: false, cancelled: true };
        }

        await onStage("saving");
        const saved = await saveOutput({
          blobUrl,
          fileName: buildResult.fileName,
          destination: command.destination,
          collection: command.collection,
        });

        return {
          success: true,
          cancelled: false,
          fileName: saved.fileName,
          destinationName: saved.destinationName,
        };
      } finally {
        if (activeBuildId) {
          activeBuildIds.delete(activeBuildId);
          progressByBuildId.delete(activeBuildId);
        }

        if (blobUrl) {
          await revokeBlob(blobUrl).catch(() => {});
        } else if (activeBuildId) {
          await abortBuild(activeBuildId).catch(() => {});
        }
      }
    }

    async function abortAll() {
      const buildIds = [...activeBuildIds];
      await Promise.all(buildIds.map((buildId) => abortBuild(buildId).catch(() => {})));
    }

    async function reportProgress(buildId, statusText) {
      const onProgress = progressByBuildId.get(buildId);
      if (!onProgress) return false;
      await onProgress(statusText);
      return true;
    }

    return { execute, abortAll, reportProgress };
  }

  return { create };
})();
