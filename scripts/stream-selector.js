const SCStreamSelector = (() => {
  const STORAGE_KEY = "downloadFormatPreference";
  const DEFAULT_PREFERENCE = "auto";
  const PREFERENCE = Object.freeze({
    AUTO: DEFAULT_PREFERENCE,
    ORIGINAL: "original",
    MP3: "mp3",
    M4A: "m4a",
    OPUS: "opus",
  });
  const TRANSCODE_PREFERENCES = Object.freeze([
    PREFERENCE.MP3,
    PREFERENCE.M4A,
    PREFERENCE.OPUS,
  ]);
  const VALID_PREFERENCES = new Set(Object.values(PREFERENCE));
  const FORMAT_MATCHERS = Object.freeze({
    [PREFERENCE.MP3]: (preset, mime) =>
      preset.startsWith("mp3") || mime.includes("audio/mpeg"),
    [PREFERENCE.M4A]: (preset, mime) =>
      preset.startsWith("aac") || mime.includes("mp4"),
    [PREFERENCE.OPUS]: (preset, mime) =>
      preset.includes("opus") || mime.includes("opus"),
  });

  function candidates(data) {
    const values = data?.media?.transcodings || [];
    const full = values.filter((value) => !value.snipped);
    return full.length ? full : values;
  }

  function matches(value, format) {
    const preset = value.preset || "";
    const mime = value.format?.mime_type || "";
    return FORMAT_MATCHERS[format]?.(preset, mime) || false;
  }

  function first(values, protocol, predicate) {
    return values.find(
      (value) => value.format?.protocol === protocol && predicate(value)
    );
  }

  const FORMAT_RULES = Object.freeze({
    [PREFERENCE.MP3]: Object.freeze([
      (value) =>
        value.format?.protocol === "progressive" &&
        matches(value, PREFERENCE.MP3),
      (value) =>
        value.format?.protocol === "hls" && matches(value, PREFERENCE.MP3),
    ]),
    [PREFERENCE.M4A]: Object.freeze([
      (value) =>
        value.format?.protocol === "hls" && value.preset?.startsWith("aac_160"),
      (value) =>
        value.format?.protocol === "hls" && value.preset?.startsWith("aac_96"),
      (value) =>
        value.format?.protocol === "hls" && matches(value, PREFERENCE.M4A),
    ]),
    [PREFERENCE.OPUS]: Object.freeze([
      (value) =>
        value.format?.protocol === "hls" && matches(value, PREFERENCE.OPUS),
    ]),
  });

  function selectFormat(values, preference) {
    for (const rule of FORMAT_RULES[preference] || []) {
      const match = values.find(rule);
      if (match) return match;
    }
    return null;
  }

  function normalizePreference(preference) {
    return VALID_PREFERENCES.has(preference) ? preference : DEFAULT_PREFERENCE;
  }

  function prefersOriginal(preference) {
    const normalized = normalizePreference(preference);
    return normalized === PREFERENCE.AUTO || normalized === PREFERENCE.ORIGINAL;
  }

  function isOriginalAvailable(trackData) {
    const hasDownloadsLeft =
      trackData?.hasDownloadsLeft !== undefined
        ? trackData.hasDownloadsLeft !== false
        : trackData?.has_downloads_left !== false;
    return trackData?.downloadable === true && hasDownloadsLeft;
  }

  function shouldPreferOriginal(trackData, preference) {
    return Boolean(
      prefersOriginal(preference) &&
        isOriginalAvailable(trackData) &&
        trackData?.id
    );
  }

  function streamInfo(value) {
    return value
      ? {
          url: value.url,
          protocol: value.format?.protocol || null,
          preset: value.preset || null,
          mimeType: value.format?.mime_type || null,
        }
      : null;
  }

  function extractStreamInfo(data, preference = DEFAULT_PREFERENCE) {
    const values = candidates(data);
    if (!values.length) return null;
    const normalized = normalizePreference(preference);
    if (TRANSCODE_PREFERENCES.includes(normalized)) {
      return streamInfo(selectFormat(values, normalized));
    }
    return streamInfo(
      TRANSCODE_PREFERENCES.map((format) =>
        selectFormat(values, format)
      ).find(Boolean) ||
        first(values, "progressive", () => true) ||
        first(values, "hls", () => true)
    );
  }

  function getAvailableFormats(data, trackData) {
    const values = candidates(data);
    return {
      original: isOriginalAvailable(trackData),
      mp3: Boolean(selectFormat(values, PREFERENCE.MP3)),
      m4a: Boolean(selectFormat(values, PREFERENCE.M4A)),
      opus: Boolean(selectFormat(values, PREFERENCE.OPUS)),
    };
  }

  function getStreamFormatLabel(
    stream,
    trackData,
    preference = DEFAULT_PREFERENCE
  ) {
    if (prefersOriginal(preference) && isOriginalAvailable(trackData)) {
      return "Original file";
    }
    if (!stream) {
      return normalizePreference(preference) === PREFERENCE.ORIGINAL
        ? "Original file"
        : null;
    }
    const preset = stream.preset || "";
    if (stream.protocol === "progressive") return "Progressive MP3";
    if (preset.startsWith("aac_160")) return "AAC HLS 160k";
    if (preset.startsWith("aac_96")) return "AAC HLS 96k";
    if (preset.startsWith("mp3") || stream.mimeType?.includes("audio/mpeg")) {
      return "MP3 HLS";
    }
    if (preset.includes("opus") || stream.mimeType?.includes("opus")) {
      return "Opus HLS";
    }
    return stream.protocol === "hls" ? "HLS" : stream.protocol || null;
  }

  async function getStoredFormatPreference() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizePreference(result[STORAGE_KEY]);
  }

  async function setStoredFormatPreference(preference) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: normalizePreference(preference),
    });
  }

  return {
    STORAGE_KEY,
    DEFAULT_PREFERENCE,
    normalizePreference,
    shouldPreferOriginal,
    extractStreamInfo,
    getAvailableFormats,
    getStreamFormatLabel,
    getStoredFormatPreference,
    setStoredFormatPreference,
  };
})();
