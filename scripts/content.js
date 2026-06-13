let currentTrackData = null;
let currentPlaylistData = null;
let lastRawTrackApiData = null;
let cachedFormatPreference = SCStreamSelector.DEFAULT_PREFERENCE;
let bulkContext = null;
let bulkSelectionCache = null;
let lastUrl = location.href;
let cachedClientId = null;
let cachedClientIdAt = 0;
let extractionRetryCount = 0;
let observerRegistered = false;
let urlCheckInterval = null;
let activeExtractionId = 0;
let pendingRetryTimeout = null;
let isExtracting = false;

const MAX_EXTRACTION_RETRIES = 3;
const TRACKS_BATCH_SIZE = 50;
const PREVIEW_LIMIT = 50;
const LIKES_PAGE_SIZE = 50;
const CLIENT_ID_TTL_MS = 60 * 60 * 1000;
const CLIENT_ID_PATTERNS = [
  /client_id[=:]["']([A-Za-z0-9_-]{20,})["']/g,
  /["']client_id["']\s*:\s*["']([A-Za-z0-9_-]{20,})["']/g,
];

const NON_TRACK_PATHS = [ "/discover", "/search", "/stream", "/upload", "/feed", "/you", "/sets", "/likes", "/albums", "/tracks", "/reposts", "/comments", "/popular-tracks", "/following", "/followers", "/library", "/notifications", "/messages", "/settings", "/signin", "/signup", "/pages", "/stations", "/charts", "/terms-of-use", "/privacy", ];

function isSoundCloudLikesPage() {
  if (!window.location.hostname.includes("soundcloud.com")) return false;
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 2 && segments[1].toLowerCase() === "likes";
}

function isPersonalLikesPage() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return (
    segments.length === 2 &&
    segments[0].toLowerCase() === "you" &&
    segments[1].toLowerCase() === "likes"
  );
}

function isSoundCloudPlaylistPage() {
  if (!window.location.hostname.includes("soundcloud.com")) return false;
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 3 && segments[1].toLowerCase() === "sets";
}

function looksLikeTrackPathPage() {
  if (!window.location.hostname.includes("soundcloud.com")) return false;
  if (isSoundCloudLikesPage()) return false;
  if (isSoundCloudPlaylistPage()) return false;
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) return false;
  if (segments.some((segment) => NON_TRACK_PATHS.includes(`/${segment.toLowerCase()}`))) {
    return false;
  }
  return true;
}

function isSoundCloudTrackPage() {
  return looksLikeTrackPathPage();
}

function getCurrentPageUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeTrackUrl(url) {
  if (!url) return null;

  const parsedUrl = new URL(url, window.location.origin);
  parsedUrl.hash = "";
  parsedUrl.search = "";
  return parsedUrl.toString().replace(/\/$/, "");
}

function isCurrentTrackDataForPage() {
  if (!currentTrackData) return false;

  const currentPageUrl = getCurrentPageUrl();
  return (currentTrackData.pageUrl === currentPageUrl || normalizeTrackUrl(currentTrackData.permalink) === currentPageUrl);
}

function isCurrentPlaylistDataForPage() {
  if (!currentPlaylistData) return false;
  return currentPlaylistData.pageUrl === getCurrentPageUrl();
}

function isExtractionStillActive(extractionId) {
  return extractionId === activeExtractionId;
}

function scheduleExtractRetry(delay, extractionId) {
  if (pendingRetryTimeout) clearTimeout(pendingRetryTimeout);

  pendingRetryTimeout = setTimeout(() => {
    pendingRetryTimeout = null;
    if (isExtractionStillActive(extractionId)) {
      extractTrackData(extractionId);
    }
  }, delay);
}

function parseHydrationData(html) {
  const hydrationMatch = html.match(
    /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/
  );

  if (!hydrationMatch) return null;

  return JSON.parse(hydrationMatch[1]);
}

function findClientIdInText(text) {
  for (const pattern of CLIENT_ID_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);

    while (match) {
      if (match[1] && match[1] !== "MISSING_CLIENT_ID") return match[1];
      match = pattern.exec(text);
    }
  }

  return null;
}

function setCachedClientId(clientId) {
  cachedClientId = clientId;
  cachedClientIdAt = Date.now();
}

function isClientIdCacheValid() {
  return (
    Boolean(cachedClientId) &&
    Date.now() - cachedClientIdAt < CLIENT_ID_TTL_MS
  );
}

async function extractClientId(html) {
  if (isClientIdCacheValid()) {
    return cachedClientId;
  }

  const inlineClientId = findClientIdInText(html);
  if (inlineClientId) {
    setCachedClientId(inlineClientId);
    return inlineClientId;
  }

  const scriptUrls = [
    ...document.querySelectorAll('script[src*="a-v2.sndcdn.com"]'),
  ].map((script) => script.src);

  for (const scriptUrl of scriptUrls) {
    try {
      const scriptContent = await fetch(scriptUrl, { cache: "force-cache" }).then(
        (response) => response.text()
      );
      const clientId = findClientIdInText(scriptContent);

      if (clientId) {
        setCachedClientId(clientId);
        return clientId;
      }
    } catch {
      // Continue trying other bundles.
    }
  }

  return null;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildTrackDataFromApiTrack(
  trackData,
  clientId,
  pageUrl,
  formatPreference = cachedFormatPreference
) {
  const streamInfo = SCStreamSelector.extractStreamInfo(trackData, formatPreference);

  return {
    id: trackData.id || null,
    title: trackData.title,
    artist: trackData.user?.username || "Unknown Artist",
    artistUrl: trackData.user?.permalink_url || "",
    artistImageUrl: trackData.user?.avatar_url || null,
    duration: formatDuration(trackData.duration),
    artwork_url: trackData.artwork_url?.replace("-large", "-t500x500") || null,
    coverUrl: trackData.artwork_url?.replace("-large", "-t500x500") || null,
    album: trackData.publisher_metadata?.album_title || null,
    genre: trackData.genre || null,
    year:
      trackData.release_year ||
      (trackData.created_at
        ? new Date(trackData.created_at).getFullYear()
        : null),
    isrc: trackData.publisher_metadata?.isrc || null,
    description: trackData.description || "No Description.",
    streamUrl: streamInfo?.url || null,
    streamProtocol: streamInfo?.protocol || null,
    streamPreset: streamInfo?.preset || null,
    streamMimeType: streamInfo?.mimeType || null,
    streamFormatLabel: SCStreamSelector.getStreamFormatLabel(
      streamInfo,
      trackData,
      formatPreference
    ),
    availableFormats: SCStreamSelector.getAvailableFormats(trackData, trackData),
    formatPreference,
    downloadable: trackData.downloadable === true,
    hasDownloadsLeft: trackData.has_downloads_left !== false,
    clientId,
    trackAuthorization: trackData.track_authorization || null,
    permalink: trackData.permalink_url,
    pageUrl,
    waveform_url: trackData.waveform_url || null,
    created_at: trackData.created_at
      ? new Date(trackData.created_at).toLocaleDateString()
      : null,
  };
}

function rebuildCurrentTrackData(formatPreference = cachedFormatPreference) {
  if (!lastRawTrackApiData || !currentTrackData?.pageUrl) {
    return null;
  }

  const rebuilt = buildTrackDataFromApiTrack(
    lastRawTrackApiData,
    currentTrackData.clientId,
    currentTrackData.pageUrl,
    formatPreference
  );

  currentTrackData = rebuilt;
  ensureInlineDownloadButton(currentTrackData);
  return rebuilt;
}

SCStreamSelector.getStoredFormatPreference().then((preference) => {
  cachedFormatPreference = preference;
});

async function fetchTracksByIds(trackIds, clientId, options = {}) {
  if (!trackIds.length) {
    return new Map();
  }

  const { onProgress, progressOffset = 0, progressTotal } = options;
  const tracksById = new Map();
  let loadedPartial = 0;

  for (const idChunk of chunkArray(trackIds, TRACKS_BATCH_SIZE)) {
    const requestUrl = new URL("https://api-v2.soundcloud.com/tracks");
    requestUrl.searchParams.set("ids", idChunk.join(","));
    requestUrl.searchParams.set("client_id", clientId);

    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Origin: "https://soundcloud.com",
        Referer: "https://soundcloud.com/",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist tracks (${response.status}).`);
    }

    const tracks = await response.json();

    for (const track of tracks) {
      if (track?.id) {
        tracksById.set(track.id, track);
      }
    }

    loadedPartial += idChunk.length;
    if (onProgress) {
      onProgress(progressOffset + loadedPartial, progressTotal);
    }
  }

  return tracksById;
}

async function resolvePlaylistTracksUpTo(
  orderedEntries,
  clientId,
  pageUrl,
  limit,
  options = {}
) {
  const { onProgress, progressTotal } = options;
  const cap = limit ?? orderedEntries.length;
  const entriesUpToCap = orderedEntries.slice(0, cap);
  const total = progressTotal ?? cap;
  const titledCount = entriesUpToCap.filter((track) => track.title).length;
  const partialTrackIds = entriesUpToCap
    .filter((track) => !track.title && track.id)
    .map((track) => track.id);

  let tracksById = new Map();

  if (partialTrackIds.length) {
    tracksById = await fetchTracksByIds(partialTrackIds, clientId, {
      onProgress,
      progressOffset: titledCount,
      progressTotal: total,
    });
  } else if (onProgress) {
    onProgress(titledCount, total);
  }

  const resolved = [];

  for (const track of entriesUpToCap) {
    const fullTrack = track.title ? track : tracksById.get(track.id);
    if (fullTrack?.title) {
      resolved.push(buildTrackDataFromApiTrack(fullTrack, clientId, pageUrl));
    }

    if (onProgress) {
      onProgress(resolved.length, total);
    }
  }

  return resolved;
}

async function fetchUserLikesPage(requestUrl, clientId, oauthToken) {
  const url =
    typeof requestUrl === "string" ? new URL(requestUrl) : new URL(requestUrl.href);

  if (!url.searchParams.has("client_id")) {
    url.searchParams.set("client_id", clientId);
  }

  const headers = {
    Accept: "application/json",
    Origin: "https://soundcloud.com",
    Referer: "https://soundcloud.com/",
  };

  if (oauthToken) {
    headers.Authorization = `OAuth ${oauthToken}`;
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user likes (${response.status}).`);
  }

  return response.json();
}

async function fetchLikesTracks(
  userId,
  clientId,
  pageUrl,
  oauthToken,
  limit,
  extractionId = null,
  options = {}
) {
  const { onProgress, progressTotal } = options;
  const tracks = [];
  const cap = limit ?? Infinity;
  const total = progressTotal ?? cap;
  let nextUrl = new URL(`https://api-v2.soundcloud.com/users/${userId}/likes`);
  nextUrl.searchParams.set("client_id", clientId);
  nextUrl.searchParams.set("limit", String(LIKES_PAGE_SIZE));
  nextUrl.searchParams.set("linked_partitioning", "1");

  while (nextUrl && tracks.length < cap) {
    if (extractionId !== null && !isExtractionStillActive(extractionId)) {
      return null;
    }

    const page = await fetchUserLikesPage(nextUrl, clientId, oauthToken);

    for (const item of page.collection || []) {
      if (tracks.length >= cap) {
        break;
      }

      const track = item?.track;
      if (track?.title) {
        tracks.push(buildTrackDataFromApiTrack(track, clientId, pageUrl));
        if (onProgress) {
          onProgress(tracks.length, total);
        }
      }
    }

    if (!page.next_href || tracks.length >= cap) {
      break;
    }

    nextUrl = new URL(page.next_href);
    nextUrl.searchParams.set("client_id", clientId);
  }

  return limit ? tracks.slice(0, limit) : tracks;
}

const BULK_PROGRESS_THROTTLE_MS = 150;
let lastBulkProgressAt = 0;

function emitBulkFetchProgress(loaded, total) {
  chrome.runtime
    .sendMessage({
      type: "BULK_FETCH_PROGRESS",
      loaded,
      total: Number.isFinite(total) ? total : loaded,
    })
    .catch(() => {});
}

function reportBulkFetchProgress(loaded, total) {
  const now = Date.now();
  if (now - lastBulkProgressAt < BULK_PROGRESS_THROTTLE_MS) {
    return;
  }

  lastBulkProgressAt = now;
  emitBulkFetchProgress(loaded, total);
}

function buildSelectionListProjection(tracks) {
  const indexWidth = String(tracks.length).length;

  return tracks.map((track, index) => ({
    id: track.id,
    index: index + 1,
    title: track.title || "Untitled",
    duration: track.duration || "",
    indexLabel: String(index + 1).padStart(indexWidth, "0"),
  }));
}

function setBulkSelectionCache(tracks) {
  bulkSelectionCache = {
    pageUrl: getCurrentPageUrl(),
    tracks: tracks || [],
  };
}

function getBulkTracksByIds(ids) {
  if (
    !bulkSelectionCache ||
    bulkSelectionCache.pageUrl !== getCurrentPageUrl() ||
    !Array.isArray(ids)
  ) {
    return null;
  }

  const tracksById = new Map(
    bulkSelectionCache.tracks.map((track) => [track.id, track])
  );

  return ids
    .map((id) => tracksById.get(id))
    .filter(Boolean);
}

async function resolveBulkTracks(limit, options = {}) {
  if (!bulkContext || bulkContext.pageUrl !== getCurrentPageUrl()) {
    throw new Error("Bulk download context is not available for this page.");
  }

  cachedFormatPreference = await SCStreamSelector.getStoredFormatPreference();

  const onProgress = options.onProgress ?? null;
  const progressTotal =
    options.progressTotal ??
    (bulkContext.kind === "playlist"
      ? bulkContext.orderedEntries.length
      : currentPlaylistData?.totalCount ?? null);

  const emitProgress = onProgress
    ? (loaded, total) => onProgress(loaded, total ?? progressTotal ?? loaded)
    : null;

  if (bulkContext.kind === "likes") {
    const tracks = await fetchLikesTracks(
      bulkContext.userId,
      bulkContext.clientId,
      bulkContext.pageUrl,
      bulkContext.oauthToken,
      limit,
      null,
      {
        onProgress: emitProgress,
        progressTotal: progressTotal ?? Infinity,
      }
    );

    if (tracks === null) {
      throw new Error("Bulk likes fetch was interrupted.");
    }

    return tracks;
  }

  if (bulkContext.kind === "playlist") {
    return resolvePlaylistTracksUpTo(
      bulkContext.orderedEntries,
      bulkContext.clientId,
      bulkContext.pageUrl,
      limit,
      {
        onProgress: emitProgress,
        progressTotal: progressTotal ?? bulkContext.orderedEntries.length,
      }
    );
  }

  throw new Error("Unknown bulk download context.");
}

async function resolveUserForLikes(hydrationData, clientId) {
  if (isPersonalLikesPage()) {
    const result = await chrome.runtime.sendMessage({
      type: "GET_LOGGED_IN_USER",
      clientId,
    });

    if (result?.success && result.profile?.user?.id) {
      return {
        user: result.profile.user,
        oauthToken: result.profile.oauthToken || null,
      };
    }

    return null;
  }

  const userEntry = hydrationData?.find((item) => item.hydratable === "user");

  if (userEntry?.data?.id) {
    return {
      user: userEntry.data,
      oauthToken: null,
    };
  }

  return null;
}

function scheduleLikesExtractRetry(delay, extractionId) {
  if (pendingRetryTimeout) {
    clearTimeout(pendingRetryTimeout);
  }

  pendingRetryTimeout = setTimeout(() => {
    pendingRetryTimeout = null;
    if (isExtractionStillActive(extractionId)) {
      extractLikesData(extractionId);
    }
  }, delay);
}

async function extractLikesData(capturedExtractionId) {
  const extractionId = capturedExtractionId ?? ++activeExtractionId;
  isExtracting = true;

  try {
    const pageUrl = getCurrentPageUrl();
    const html = await fetch(window.location.href, {
      cache: "no-store",
      credentials: "include",
    }).then((response) => response.text());

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    const hydrationData = parseHydrationData(html);
    if (!hydrationData) {
      if (extractionRetryCount < MAX_EXTRACTION_RETRIES) {
        extractionRetryCount += 1;
        scheduleLikesExtractRetry(2000, extractionId);
      }

      return null;
    }

    const clientId = await extractClientId(html);

    if (!clientId) {
      if (isExtractionStillActive(extractionId)) {
        currentPlaylistData = null;
        bulkContext = null;
      }

      return null;
    }

    const resolvedUser = await resolveUserForLikes(hydrationData, clientId);

    if (!resolvedUser?.user?.id) {
      if (isExtractionStillActive(extractionId)) {
        currentPlaylistData = null;
        bulkContext = null;
      }

      return null;
    }

    const { user, oauthToken } = resolvedUser;
    const totalCount =
      user.public_likes_count ?? user.likes_count ?? PREVIEW_LIMIT;

    bulkContext = {
      kind: "likes",
      userId: user.id,
      clientId,
      oauthToken,
      pageUrl,
    };

    const tracks = await fetchLikesTracks(
      user.id,
      clientId,
      pageUrl,
      oauthToken,
      PREVIEW_LIMIT,
      extractionId
    );

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    extractionRetryCount = 0;

    const username = user.username || "Unknown user";
    const newPlaylistData = {
      title: `${username} - Likes`,
      trackCount: tracks?.length || 0,
      totalCount,
      clientId,
      tracks: tracks || [],
      pageUrl,
      artwork_url: tracks?.[0]?.artwork_url || null,
      artist: username,
      artistUrl: user.permalink_url || "",
      artistImageUrl: user.avatar_url || null,
    };

    if (JSON.stringify(currentPlaylistData) !== JSON.stringify(newPlaylistData)) {
      currentPlaylistData = newPlaylistData;
      chrome.runtime.sendMessage({
        type: "PLAYLIST_DATA",
        data: currentPlaylistData,
      });
    }

    ensureInlineDownloadButton();
    return currentPlaylistData;
  } catch (error) {
    console.error("SC Track Downloader Error:", error);
    return null;
  } finally {
    if (isExtractionStillActive(extractionId)) {
      isExtracting = false;
    }
  }
}

async function extractPlaylistData(capturedExtractionId) {
  const extractionId = capturedExtractionId ?? ++activeExtractionId;
  isExtracting = true;

  try {
    const pageUrl = getCurrentPageUrl();
    const html = await fetch(window.location.href, {
      cache: "no-store",
      credentials: "include",
    }).then((response) => response.text());

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    const hydrationData = parseHydrationData(html);
    if (!hydrationData) {
      if (extractionRetryCount < MAX_EXTRACTION_RETRIES) {
        extractionRetryCount += 1;
        scheduleExtractRetry(2000, extractionId);
      }

      return null;
    }

    const playlistEntry = hydrationData.find(
      (item) => item.hydratable === "playlist"
    );

    if (!playlistEntry?.data) {
      if (isExtractionStillActive(extractionId)) {
        currentPlaylistData = null;
        bulkContext = null;
      }

      return null;
    }

    const playlist = playlistEntry.data;
    const playlistTracks = playlist.tracks || [];
    const clientId = await extractClientId(html);

    if (!clientId) {
      if (isExtractionStillActive(extractionId)) {
        currentPlaylistData = null;
        bulkContext = null;
      }

      return null;
    }

    bulkContext = {
      kind: "playlist",
      orderedEntries: playlistTracks,
      clientId,
      pageUrl,
    };

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    extractionRetryCount = 0;

    const totalCount = playlist.track_count || playlistTracks.length;
    const resolvedTracks = await resolvePlaylistTracksUpTo(
      playlistTracks,
      clientId,
      pageUrl,
      PREVIEW_LIMIT
    );

    const newPlaylistData = {
      title: playlist.title,
      trackCount: resolvedTracks.length,
      totalCount,
      clientId,
      tracks: resolvedTracks,
      pageUrl,
      artwork_url:
        playlist.artwork_url?.replace("-large", "-t500x500") ||
        resolvedTracks[0]?.artwork_url ||
        null,
      artist: playlist.user?.username || resolvedTracks[0]?.artist || "",
      artistUrl: playlist.user?.permalink_url || resolvedTracks[0]?.artistUrl || "",
      artistImageUrl:
        playlist.user?.avatar_url || resolvedTracks[0]?.artistImageUrl || null,
    };

    if (JSON.stringify(currentPlaylistData) !== JSON.stringify(newPlaylistData)) {
      currentPlaylistData = newPlaylistData;
      chrome.runtime.sendMessage({
        type: "PLAYLIST_DATA",
        data: currentPlaylistData,
      });
    }

    ensureInlineDownloadButton();
    return currentPlaylistData;
  } catch (error) {
    console.error("SC Track Downloader Error:", error);
    return null;
  } finally {
    if (isExtractionStillActive(extractionId)) {
      isExtracting = false;
    }
  }
}

async function extractTrackData(capturedExtractionId) {
  const extractionId = capturedExtractionId ?? ++activeExtractionId;
  isExtracting = true;

  try {
    const pageUrl = getCurrentPageUrl();
    const html = await fetch(window.location.href, {
      cache: "no-store",
      credentials: "include",
    }).then((response) => response.text());

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    const hydrationData = parseHydrationData(html);
    if (!hydrationData) {
      if (extractionRetryCount < MAX_EXTRACTION_RETRIES) {
        extractionRetryCount += 1;
        scheduleExtractRetry(2000, extractionId);
      }

      return null;
    }

    const trackData = hydrationData.find((item) => item.hydratable === "sound");
    if (!trackData?.data) {
      if (isExtractionStillActive(extractionId)) {
        currentTrackData = null;
        removeInlineDownloadButton();
      }

      return null;
    }

    const permalink = normalizeTrackUrl(trackData.data.permalink_url);
    if (permalink && permalink !== pageUrl) {
      if (extractionRetryCount < MAX_EXTRACTION_RETRIES) {
        extractionRetryCount += 1;
        scheduleExtractRetry(1000, extractionId);
      }

      return null;
    }

    extractionRetryCount = 0;

    let clientId = await extractClientId(html);

    if (!clientId) {
      clientId = await extractClientId(html);
    }

    if (!isExtractionStillActive(extractionId)) {
      return null;
    }

    lastRawTrackApiData = trackData.data;

    const newTrackData = buildTrackDataFromApiTrack(
      trackData.data,
      clientId,
      pageUrl,
      cachedFormatPreference
    );

    if (JSON.stringify(currentTrackData) !== JSON.stringify(newTrackData)) {
      currentTrackData = newTrackData;
      chrome.runtime.sendMessage({
        type: "TRACK_DATA",
        data: currentTrackData,
      });
    }

    ensureInlineDownloadButton(currentTrackData);
    return currentTrackData;
  } catch (error) {
    console.error("SC Track Downloader Error:", error);
    return null;
  } finally {
    if (isExtractionStillActive(extractionId)) {
      isExtracting = false;
    }
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TRACK_DATA") {
    if (isSoundCloudLikesPage()) {
      if (
        currentPlaylistData &&
        !request.forceRefresh &&
        isCurrentPlaylistDataForPage()
      ) {
        sendResponse({
          status: "loaded",
          kind: "playlist",
          data: currentPlaylistData,
        });
        return true;
      }

      if (request.forceRefresh || !isExtracting) {
        extractLikesData();
      }

      sendResponse({ status: "loading" });
      return true;
    }

    if (isSoundCloudPlaylistPage()) {
      if (
        currentPlaylistData &&
        !request.forceRefresh &&
        isCurrentPlaylistDataForPage()
      ) {
        sendResponse({
          status: "loaded",
          kind: "playlist",
          data: currentPlaylistData,
        });
        return true;
      }

      if (request.forceRefresh || !isExtracting) {
        extractPlaylistData();
      }

      sendResponse({ status: "loading" });
      return true;
    }

    if (
      currentTrackData &&
      !request.forceRefresh &&
      isCurrentTrackDataForPage()
    ) {
      sendResponse({
        status: "loaded",
        kind: "track",
        data: currentTrackData,
      });
      return true;
    }

    if (looksLikeTrackPathPage()) {
      if (request.forceRefresh || !isExtracting) {
        extractTrackData();
      }

      sendResponse({ status: "loading" });
      return true;
    }

    sendResponse({ status: "not_track" });
    return true;
  }

  if (request.type === "GET_BULK_TRACKS") {
    resolveBulkTracks(request.limit ?? null)
      .then((tracks) => sendResponse({ success: true, tracks }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );

    return true;
  }

  if (request.type === "GET_BULK_SELECTION_LIST") {
    const progressTotal =
      request.total ?? currentPlaylistData?.totalCount ?? null;

    resolveBulkTracks(null, {
      onProgress: reportBulkFetchProgress,
      progressTotal,
    })
      .then((tracks) => {
        setBulkSelectionCache(tracks);
        sendResponse({
          success: true,
          total: tracks.length,
          items: buildSelectionListProjection(tracks),
        });
      })
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );

    return true;
  }

  if (request.type === "APPLY_FORMAT_PREFERENCE") {
    cachedFormatPreference = request.formatPreference || SCStreamSelector.DEFAULT_PREFERENCE;
    const rebuilt = rebuildCurrentTrackData(cachedFormatPreference);

    if (rebuilt) {
      chrome.runtime.sendMessage({
        type: "TRACK_DATA",
        data: rebuilt,
      });
      sendResponse({ success: true, data: rebuilt });
      return true;
    }

    sendResponse({ success: true, data: null });
    return true;
  }

  if (request.type === "GET_BULK_TRACKS_BY_IDS") {
    (async () => {
      try {
        const ids = request.ids || [];
        let tracks = getBulkTracksByIds(ids);

        if (!tracks || tracks.length !== ids.length) {
          const allTracks = await resolveBulkTracks(null, {
            onProgress: reportBulkFetchProgress,
            progressTotal: currentPlaylistData?.totalCount ?? null,
          });
          setBulkSelectionCache(allTracks);
          tracks = getBulkTracksByIds(ids);
        }

        if (!tracks?.length) {
          sendResponse({
            success: false,
            error: "No matching tracks were found for the current selection.",
          });
          return;
        }

        sendResponse({ success: true, tracks });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message,
        });
      }
    })();

    return true;
  }

  return true;
});

function handleUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    activeExtractionId += 1;
    currentTrackData = null;
    currentPlaylistData = null;
    lastRawTrackApiData = null;
    bulkContext = null;
    bulkSelectionCache = null;
    extractionRetryCount = 0;
    isExtracting = false;

    if (pendingRetryTimeout) {
      clearTimeout(pendingRetryTimeout);
      pendingRetryTimeout = null;
    }

    if (window.urlChangeTimeout) {
      clearTimeout(window.urlChangeTimeout);
    }

    window.urlChangeTimeout = setTimeout(async () => {
      if (isSoundCloudLikesPage()) {
        removeInlineDownloadButton();
        await extractLikesData();
      } else if (isSoundCloudPlaylistPage()) {
        removeInlineDownloadButton();
        await extractPlaylistData();
      } else if (isSoundCloudTrackPage()) {
        await extractTrackData();
      } else {
        removeInlineDownloadButton();
      }
    }, 2000);
  }
}

const observer = new MutationObserver(handleUrlChange);

function initScript() {
  if (!observerRegistered) {
    observer.observe(document, { subtree: true, childList: true });
    observerRegistered = true;
  }

  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(() => {
      if (
        isSoundCloudLikesPage() ||
        isSoundCloudTrackPage() ||
        isSoundCloudPlaylistPage() ||
        location.href !== lastUrl
      ) {
        handleUrlChange();
      }
    }, 750);
  }

  if (isSoundCloudLikesPage()) {
    setTimeout(extractLikesData, 1254);
  } else if (isSoundCloudPlaylistPage()) {
    setTimeout(extractPlaylistData, 1254);
  } else if (isSoundCloudTrackPage()) {
    setTimeout(extractTrackData, 1254);
  }
}

function isSoundCloudCollectionPage() {
  return isSoundCloudLikesPage() || isSoundCloudPlaylistPage();
}

window.SCDL = {
  getTrackData: () => currentTrackData,
  getPlaylistData: () => currentPlaylistData,
  isTrackPage: () => isSoundCloudTrackPage(),
  isCollectionPage: () => isSoundCloudCollectionPage(),
  resolveBulkTracks: (limit) => resolveBulkTracks(limit),
};

initScript();
