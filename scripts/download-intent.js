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

    return { downloadTrack, downloadCollection };
  }

  function isJobAlreadyRunning(error) {
    return /already in progress/i.test(error?.message || error || "");
  }

  return { create, isJobAlreadyRunning };
})();
