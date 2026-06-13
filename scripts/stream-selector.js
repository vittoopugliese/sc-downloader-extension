const SCStreamSelector = (() => {
  const STORAGE_KEY = "downloadFormatPreference";
  const DEFAULT_PREFERENCE = "auto";

  function getTranscodingCandidates(data) {
    const transcodings = data?.media?.transcodings || [];
    if (!transcodings.length) {
      return [];
    }

    const fullTranscodings = transcodings.filter((transcoding) => !transcoding.snipped);
    return fullTranscodings.length ? fullTranscodings : transcodings;
  }

  function findHls(candidates, predicate) {
    return candidates.find(
      (transcoding) =>
        transcoding.format?.protocol === "hls" && predicate(transcoding)
    );
  }

  function findProgressive(candidates, predicate) {
    return candidates.find(
      (transcoding) =>
        transcoding.format?.protocol === "progressive" && predicate(transcoding)
    );
  }

  function toStreamInfo(transcoding) {
    return {
      url: transcoding.url,
      protocol: transcoding.format?.protocol || null,
      preset: transcoding.preset || null,
      mimeType: transcoding.format?.mime_type || null,
    };
  }

  function findMp3Transcoding(candidates) {
    const progressive = findProgressive(
      candidates,
      (transcoding) =>
        transcoding.format?.mime_type?.includes("audio/mpeg") ||
        transcoding.preset?.startsWith("mp3")
    );
    if (progressive) {
      return progressive;
    }

    return findHls(
      candidates,
      (transcoding) =>
        transcoding.format?.mime_type?.includes("audio/mpeg") ||
        transcoding.preset?.startsWith("mp3")
    );
  }

  function findAacTranscoding(candidates) {
    const hlsAac160 = findHls(
      candidates,
      (transcoding) =>
        transcoding.preset === "aac_160k" || transcoding.preset?.startsWith("aac_160")
    );
    if (hlsAac160) {
      return hlsAac160;
    }

    const hlsAac96 = findHls(
      candidates,
      (transcoding) =>
        transcoding.preset === "aac_96k" || transcoding.preset?.startsWith("aac_96")
    );
    if (hlsAac96) {
      return hlsAac96;
    }

    return findHls(
      candidates,
      (transcoding) =>
        transcoding.preset?.startsWith("aac") ||
        transcoding.format?.mime_type?.includes("mp4")
    );
  }

  function findOpusTranscoding(candidates) {
    return findHls(
      candidates,
      (transcoding) =>
        transcoding.preset?.includes("opus") ||
        transcoding.format?.mime_type?.includes("opus")
    );
  }

  function extractStreamInfo(data, formatPreference = DEFAULT_PREFERENCE) {
    const candidates = getTranscodingCandidates(data);
    if (!candidates.length) {
      return null;
    }

    if (formatPreference === "mp3") {
      const mp3 = findMp3Transcoding(candidates);
      return mp3 ? toStreamInfo(mp3) : null;
    }

    if (formatPreference === "m4a") {
      const aac = findAacTranscoding(candidates);
      return aac ? toStreamInfo(aac) : null;
    }

    if (formatPreference === "opus") {
      const opus = findOpusTranscoding(candidates);
      return opus ? toStreamInfo(opus) : null;
    }

    const mp3 = findMp3Transcoding(candidates);
    if (mp3) {
      return toStreamInfo(mp3);
    }

    const aac = findAacTranscoding(candidates);
    if (aac) {
      return toStreamInfo(aac);
    }

    const opus = findOpusTranscoding(candidates);
    if (opus) {
      return toStreamInfo(opus);
    }

    const progressive = candidates.find(
      (transcoding) => transcoding.format?.protocol === "progressive"
    );
    if (progressive) {
      return toStreamInfo(progressive);
    }

    const anyHls = candidates.find(
      (transcoding) => transcoding.format?.protocol === "hls"
    );
    if (anyHls) {
      return toStreamInfo(anyHls);
    }

    return null;
  }

  function getAvailableFormats(data, trackData) {
    const candidates = getTranscodingCandidates(data);

    return {
      original:
        trackData?.downloadable === true && trackData?.has_downloads_left !== false,
      mp3: Boolean(findMp3Transcoding(candidates)),
      m4a: Boolean(findAacTranscoding(candidates)),
      opus: Boolean(findOpusTranscoding(candidates)),
    };
  }

  function shouldPreferOriginal(formatPreference) {
    return formatPreference === "auto" || formatPreference === "original";
  }

  function shouldUseOriginalOnly(formatPreference) {
    return formatPreference === "original";
  }

  function getStreamFormatLabel(streamInfo, trackData, formatPreference = DEFAULT_PREFERENCE) {
    if (
      shouldUseOriginalOnly(formatPreference) &&
      trackData?.downloadable === true &&
      trackData?.has_downloads_left !== false
    ) {
      return "Original file";
    }

    if (
      formatPreference === "auto" &&
      trackData?.downloadable === true &&
      trackData?.has_downloads_left !== false
    ) {
      return "Original file";
    }

    if (!streamInfo) {
      if (formatPreference === "original") {
        return "Original file";
      }
      return null;
    }

    const preset = streamInfo.preset || "";

    if (streamInfo.protocol === "progressive") {
      return "Progressive MP3";
    }

    if (preset === "aac_160k" || preset.startsWith("aac_160")) {
      return "AAC HLS 160k";
    }

    if (preset === "aac_96k" || preset.startsWith("aac_96")) {
      return "AAC HLS 96k";
    }

    if (preset.startsWith("mp3") || streamInfo.mimeType?.includes("audio/mpeg")) {
      return "MP3 HLS";
    }

    if (preset.includes("opus") || streamInfo.mimeType?.includes("opus")) {
      return "Opus HLS";
    }

    if (streamInfo.protocol === "hls") {
      return "HLS";
    }

    return streamInfo.protocol || null;
  }

  async function getStoredFormatPreference() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const preference = result[STORAGE_KEY];
    return preference || DEFAULT_PREFERENCE;
  }

  async function setStoredFormatPreference(preference) {
    await chrome.storage.local.set({ [STORAGE_KEY]: preference });
  }

  async function resolveDownloadSource(trackData, options = {}) {
    const {
      formatPreference = trackData.formatPreference || DEFAULT_PREFERENCE,
      getOriginal = null,
      getStream,
      refreshTrack = null,
      urlKey = "url",
    } = options;

    if (!getStream) {
      throw new Error("Stream resolver is not available.");
    }

    const preferOriginal = shouldPreferOriginal(formatPreference);

    if (
      preferOriginal &&
      trackData.downloadable &&
      trackData.hasDownloadsLeft &&
      trackData.id &&
      getOriginal
    ) {
      try {
        const original = await getOriginal(trackData.id, trackData.clientId);

        if (original?.url) {
          return {
            [urlKey]: original.url,
            trackData: {
              ...trackData,
              isOriginalDownload: true,
              originalDownloadUrl: original.url,
              originalMimeType: original.mimeType || null,
            },
          };
        }
      } catch {
        // Original unavailable; fall back to the best stream below.
      }
    }

    let currentTrack = trackData;
    let lastError = null;
    const maxAttempts = refreshTrack ? 2 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (!currentTrack?.streamUrl) {
          throw new Error("No downloadable stream was found for this track.");
        }

        const result = await getStream(currentTrack);
        const resolvedUrl = result?.url;

        if (!resolvedUrl) {
          const error = new Error(result?.error || "Cannot obtain final file URL.");
          if (result) {
            error.result = result;
          }
          throw error;
        }

        return {
          [urlKey]: resolvedUrl,
          trackData: currentTrack,
        };
      } catch (error) {
        lastError = error;
        const shouldRefresh =
          refreshTrack &&
          attempt === 0 &&
          currentTrack?.id &&
          currentTrack?.clientId &&
          /403|404|401|stream|URL/i.test(error.message || "");

        if (!shouldRefresh) {
          throw error;
        }

        const refreshed = await refreshTrack(
          currentTrack.id,
          currentTrack.clientId,
          formatPreference
        );
        currentTrack = { ...currentTrack, ...refreshed };
      }
    }

    throw lastError || new Error("Could not resolve stream URL.");
  }

  return {
    STORAGE_KEY,
    DEFAULT_PREFERENCE,
    extractStreamInfo,
    getAvailableFormats,
    getStreamFormatLabel,
    shouldPreferOriginal,
    shouldUseOriginalOnly,
    getStoredFormatPreference,
    setStoredFormatPreference,
    resolveDownloadSource,
  };
})();
