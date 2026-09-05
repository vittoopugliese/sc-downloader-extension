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
      const buildId = `track_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      let buildRequested = false;
      let blobUrl = null;

      try {
        await onStage("resolving");
        const resolved = await resolveSource(
          command.trackData,
          command.formatPreference || "auto"
        );

        if (await isCancelled()) {
          return { success: false, cancelled: true };
        }

        await onStage("building");
        buildRequested = true;
        activeBuildIds.add(buildId);
        if (typeof command.onProgress === "function") {
          progressByBuildId.set(buildId, command.onProgress);
        }
        const buildResult = await buildTrack({
          buildId,
          trackData: resolved.trackData,
          streamUrl: resolved.streamUrl,
          trimRange: command.trimRange || null,
        });
        activeBuildIds.delete(buildId);
        progressByBuildId.delete(buildId);

        if (!buildResult?.success || !buildResult.blobUrl) {
          throw new Error(buildResult?.error || "Failed to build audio file.");
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
        activeBuildIds.delete(buildId);
        progressByBuildId.delete(buildId);

        if (blobUrl) {
          await revokeBlob(blobUrl).catch(() => {});
        } else if (buildRequested) {
          await abortBuild(buildId).catch(() => {});
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
