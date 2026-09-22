const SCDownloadIntent = (() => {
  function create(runtime = chrome.runtime) {
    async function send(command) {
      const result = await runtime.sendMessage(command);
      if (!result?.success) {
        const error = new Error(result?.error || "Download failed.");
        error.result = result;
        throw error;
      }
      return result;
    }

    async function downloadTrack(trackData, options = {}) {
      const track = SCDownloadTrack.migrate(trackData);
      if (!SCDownloadTrack.canDownload(track)) {
        throw new Error("No downloadable stream was found for this track.");
      }
      return send({
        type: "DOWNLOAD_SINGLE_TRACK",
        trackData: track,
        formatPreference:
          options.formatPreference || track.formatPreference || "auto",
        playbackTransform: options.playbackTransform || null,
        effects: options.effects || null,
        downloadDestination: options.downloadDestination ?? null,
      });
    }

    async function downloadCollection(tracks, collection, options = {}) {
      if (!Array.isArray(tracks) || tracks.length === 0) {
        throw new Error("No downloadable tracks were found.");
      }
      if (!collection?.title) {
        throw new Error("Collection information is unavailable.");
      }
      return send({
        type: "START_BULK_JOB",
        tracks: tracks.map((track) => SCDownloadTrack.migrate(track)),
        playlistTitle: collection.title,
        playlistMeta: {
          artworkUrl: collection.artworkUrl || null,
          artist: collection.artist || null,
          artistImageUrl: collection.artistImageUrl || null,
          artistUrl: collection.artistUrl || null,
        },
        formatPreference: options.formatPreference || "auto",
        downloadDestination: options.downloadDestination ?? null,
      });
    }

    async function downloadPagedCollection(tabId, collection, options = {}) {
      if (tabId != null && !Number.isInteger(tabId)) {
        throw new Error("Collection tab context is unavailable.");
      }
      if (!collection?.title) {
        throw new Error("Collection information is unavailable.");
      }
      const command = {
        type: "START_PAGED_BULK_JOB",
        collection: {
          kind: collection.kind || "collection",
          title: collection.title,
          sourceUserId: collection.sourceUserId || null,
          sourceAuthenticated: collection.sourceAuthenticated === true,
          sourceUrl: collection.sourceUrl || null,
          pageUrl: collection.pageUrl || null,
          clientId: collection.clientId || null,
          artworkUrl: collection.artworkUrl || null,
          artist: collection.artist || null,
          artistImageUrl: collection.artistImageUrl || null,
          artistUrl: collection.artistUrl || null,
        },
        requestedLimit: options.limit ?? null,
        formatPreference: options.formatPreference || "auto",
        downloadDestination: options.downloadDestination ?? null,
      };
      if (options.selection) command.selection = {
        mode: options.selection.mode,
        ids: Array.from(options.selection.ids || [], (value) => String(value)),
      };
      // Content scripts do not know their tab ID. The background derives it
      // from the trusted sender, so inline and popup use the same durable path.
      if (Number.isInteger(tabId)) command.tabId = tabId;
      return send(command);
    }

    return { downloadTrack, downloadCollection, downloadPagedCollection };
  }

  function isJobAlreadyRunning(error) {
    return /already in progress/i.test(error?.message || error || "");
  }

  return { create, isJobAlreadyRunning };
})();
