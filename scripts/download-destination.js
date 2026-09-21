const SCDownloadDestination = (() => {
  const DOWNLOAD_COMPLETE_TIMEOUT_MS = 5 * 60 * 1000;

  function normalize(value) {
    if (!value || typeof value.id !== "string" || typeof value.name !== "string") {
      return null;
    }

    return { id: value.id, name: value.name };
  }

  function createBrowserDownloadsAdapter(chromeApi) {
    function waitForComplete(downloadId, timeoutMs = DOWNLOAD_COMPLETE_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        let settled = false;

        function settle(onSettle, value) {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeoutId);
          chromeApi.downloads.onChanged.removeListener(handleChange);
          onSettle(value);
        }

        function handleChange(delta) {
          if (delta.id !== downloadId || !delta.state) {
            return;
          }

          if (delta.state.current === "complete") {
            settle(resolve, downloadId);
          } else if (delta.state.current === "interrupted") {
            settle(reject, new Error("Download was interrupted."));
          }
        }

        const timeoutId = setTimeout(() => {
          const error = new Error("Chrome download status timed out. Check Downloads before retrying.");
          error.code = "ambiguous_save";
          settle(reject, error);
        }, timeoutMs);

        chromeApi.downloads.onChanged.addListener(handleChange);
        chromeApi.downloads.search({ id: downloadId }, (items) => {
          if (chromeApi.runtime.lastError || settled) {
            return;
          }

          const item = items?.[0];
          if (item?.state === "complete") {
            settle(resolve, downloadId);
          } else if (item?.state === "interrupted") {
            settle(reject, new Error("Download was interrupted."));
          }
        });
      });
    }

    function save(blobUrl, fileName, onDownloadStarted) {
      return new Promise((resolve, reject) => {
        chromeApi.downloads.download(
          {
            url: blobUrl,
            filename: fileName,
            saveAs: false,
            conflictAction: "uniquify",
          },
          (downloadId) => {
            if (chromeApi.runtime.lastError || !downloadId) {
              const error = new Error(chromeApi.runtime.lastError?.message || "Chrome may have started the download. Check Downloads before retrying.");
              error.code = "ambiguous_save";
              reject(error);
              return;
            }
            Promise.resolve().then(() => onDownloadStarted?.(downloadId)).catch(() => {
              const error = new Error("Download started, but its checkpoint could not be saved. Check Downloads before retrying.");
              error.code = "ambiguous_save";
              throw error;
            })
              .then(() => waitForComplete(downloadId))
              .then(() => resolve(fileName))
              .catch(reject);
          }
        );
      });
    }

    return { save };
  }

  function createSelectedDirectoryAdapter(sendOffscreenMessage) {
    async function save(blobUrl, fileName, destination, operationId) {
      const result = await sendOffscreenMessage({
        type: "OFFSCREEN_SAVE_TO_DIRECTORY",
        operationId,
        blobUrl,
        fileName,
        directoryId: destination.id,
      });

      if (!result?.success) {
        throw new Error(result?.error || "Could not save to the selected folder.");
      }

      return result.fileName || fileName;
    }

    return { save };
  }

  function isUnavailableDirectoryError(error) {
    const message = String(error?.message || error || "");
    return /(?:folder|directory).*(?:unavailable|expired|permission|access|no longer available)|(?:permission|access).*(?:folder|directory)/i.test(
      message
    );
  }

  function createCollectionFileName(fileName, collection) {
    if (!collection) {
      return fileName;
    }

    const trackNumber = Number(collection.trackNumber);
    const totalTracks = Number(collection.totalTracks);
    if (!Number.isInteger(trackNumber) || !Number.isInteger(totalTracks)) {
      throw new Error("Collection downloads require integer track numbers.");
    }

    const paddedIndex = String(trackNumber).padStart(String(totalTracks).length, "0");
    return `${paddedIndex} - ${fileName}`;
  }

  function create({ chromeApi, getRememberedDirectory, sendOffscreenMessage }) {
    if (!chromeApi?.downloads || !chromeApi?.runtime) {
      throw new Error("Download destination requires the browser downloads interface.");
    }
    if (typeof getRememberedDirectory !== "function") {
      throw new Error("Download destination requires remembered directory lookup.");
    }
    if (typeof sendOffscreenMessage !== "function") {
      throw new Error("Download destination requires offscreen messaging.");
    }

    const browserDownloads = createBrowserDownloadsAdapter(chromeApi);
    const selectedDirectory = createSelectedDirectoryAdapter(sendOffscreenMessage);

    async function resolve(candidate = null) {
      return normalize(candidate || (await getRememberedDirectory()));
    }

    async function save({ operationId, blobUrl, fileName, destination = null, collection = null, onDownloadStarted }) {
      const outputFileName = createCollectionFileName(fileName, collection);
      const selected = normalize(destination);

      if (selected) {
        try {
          const savedFileName = await selectedDirectory.save(
            blobUrl,
            outputFileName,
            selected,
            operationId
          );
          return { fileName: savedFileName, destinationName: selected.name };
        } catch (error) {
          if (!isUnavailableDirectoryError(error)) {
            throw error;
          }

          await browserDownloads.save(blobUrl, outputFileName, onDownloadStarted);
          return {
            fileName: outputFileName,
            destinationName: "Downloads (folder unavailable)",
          };
        }
      }

      const browserFileName = collection?.folderName
        ? `${collection.folderName}/${outputFileName}`
        : outputFileName;
      await browserDownloads.save(blobUrl, browserFileName, onDownloadStarted);
      return { fileName: outputFileName, destinationName: "Downloads" };
    }

    return { resolve, save };
  }

  return { create };
})();
