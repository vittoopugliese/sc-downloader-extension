const SCDownloadTrack = (() => {
  const DEFAULT_ARTIST = "Unknown Artist";

  function formatDuration(milliseconds) {
    const totalSeconds = Math.floor((Number(milliseconds) || 0) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function normalizeArtwork(url) {
    return url ? url.replace("-large", "-t500x500") : null;
  }

  function fromSoundCloud(rawTrack, context = {}) {
    if (!rawTrack) return null;

    const selector = context.streamSelector || SCStreamSelector;
    const formatPreference = selector.normalizePreference
      ? selector.normalizePreference(context.formatPreference)
      : context.formatPreference || "auto";
    const stream = selector.extractStreamInfo(rawTrack, formatPreference);
    const artworkUrl = normalizeArtwork(rawTrack.artwork_url);

    return {
      id: rawTrack.id || null,
      title: rawTrack.title,
      artist: rawTrack.user?.username || DEFAULT_ARTIST,
      artistUrl: rawTrack.user?.permalink_url || "",
      artistImageUrl: rawTrack.user?.avatar_url || null,
      duration: formatDuration(rawTrack.duration),
      artworkUrl,
      album: rawTrack.publisher_metadata?.album_title || null,
      genre: rawTrack.genre || null,
      year:
        rawTrack.release_year ||
        (rawTrack.created_at ? new Date(rawTrack.created_at).getFullYear() : null),
      isrc: rawTrack.publisher_metadata?.isrc || null,
      description: rawTrack.description || "No Description.",
      streamUrl: stream?.url || null,
      streamProtocol: stream?.protocol || null,
      streamPreset: stream?.preset || null,
      streamMimeType: stream?.mimeType || null,
      streamFormatLabel: selector.getStreamFormatLabel(
        stream,
        rawTrack,
        formatPreference
      ),
      availableFormats: selector.getAvailableFormats(rawTrack, rawTrack),
      formatPreference,
      downloadable: rawTrack.downloadable === true,
      hasDownloadsLeft: rawTrack.has_downloads_left !== false,
      clientId: context.clientId || null,
      trackAuthorization: rawTrack.track_authorization || null,
      permalink: rawTrack.permalink_url || null,
      pageUrl: context.pageUrl || rawTrack.permalink_url || null,
      waveformUrl: rawTrack.waveform_url || null,
      createdAt: rawTrack.created_at
        ? new Date(rawTrack.created_at).toLocaleDateString()
        : null,
    };
  }

  function migrate(track, fallbackAlbum = null) {
    if (!track) return null;

    const {
      coverUrl,
      artwork_url: legacyArtworkUrl,
      waveform_url: legacyWaveformUrl,
      created_at: legacyCreatedAt,
      has_downloads_left: legacyHasDownloadsLeft,
      ...canonical
    } = track;

    return {
      ...canonical,
      artworkUrl: track.artworkUrl || coverUrl || legacyArtworkUrl || null,
      waveformUrl: track.waveformUrl || legacyWaveformUrl || null,
      createdAt: track.createdAt || legacyCreatedAt || null,
      album: track.album || fallbackAlbum || null,
      hasDownloadsLeft:
        track.hasDownloadsLeft !== undefined
          ? track.hasDownloadsLeft !== false
          : legacyHasDownloadsLeft !== false,
    };
  }

  function toDurable(track, fallbackAlbum = null) {
    const value = migrate(track, fallbackAlbum);
    if (!value) return null;

    return {
      id: value.id || null,
      title: value.title,
      artist: value.artist || DEFAULT_ARTIST,
      artistUrl: value.artistUrl || "",
      artistImageUrl: value.artistImageUrl || null,
      artworkUrl: value.artworkUrl,
      album: value.album,
      genre: value.genre || null,
      year: value.year || null,
      isrc: value.isrc || null,
      streamUrl: value.streamUrl || null,
      streamProtocol: value.streamProtocol || null,
      streamPreset: value.streamPreset || null,
      streamMimeType: value.streamMimeType || null,
      trackAuthorization: value.trackAuthorization || null,
      downloadable: value.downloadable === true,
      hasDownloadsLeft: value.hasDownloadsLeft !== false,
      clientId: value.clientId || null,
      permalink: value.permalink || null,
    };
  }

  function canDownload(track) {
    const value = migrate(track);
    return Boolean(
      value?.streamUrl ||
        (value?.downloadable && value?.hasDownloadsLeft && value?.id)
    );
  }

  return {
    fromSoundCloud,
    migrate,
    toDurable,
    canDownload,
    normalizeArtwork,
  };
})();
