let currentTrackData = null;
let currentPlaylistData = null;
let bulkContext = null;
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

function isSoundCloudTrackPage() {
  if (!window.location.hostname.includes("soundcloud.com")) return false;
  if (isSoundCloudLikesPage()) return false;
  if (isSoundCloudPlaylistPage()) return false;
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) return false;
  if (segments.some((segment) =>NON_TRACK_PATHS.includes(`/${segment.toLowerCase()}`))) return false;
  return true;
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

function getStreamFormatLabel(streamInfo) {
  if (!streamInfo) {
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

function extractStreamInfo(data) {
  const transcodings = data.media?.transcodings || [];
  if (!transcodings.length) {
    return null;
  }

  const fullTranscodings = transcodings.filter((transcoding) => !transcoding.snipped);
  const candidates = fullTranscodings.length ? fullTranscodings : transcodings;

  const findHls = (predicate) =>
    candidates.find(
      (transcoding) =>
        transcoding.format?.protocol === "hls" && predicate(transcoding)
    );

  const hlsAac160 = findHls(
    (transcoding) =>
      transcoding.preset === "aac_160k" || transcoding.preset?.startsWith("aac_160")
  );
  if (hlsAac160) {
    return {
      url: hlsAac160.url,
      protocol: "hls",
      preset: hlsAac160.preset || null,
      mimeType: hlsAac160.format?.mime_type || null,
    };
  }

  const hlsAac96 = findHls(
    (transcoding) =>
      transcoding.preset === "aac_96k" || transcoding.preset?.startsWith("aac_96")
  );
  if (hlsAac96) {
    return {
      url: hlsAac96.url,
      protocol: "hls",
      preset: hlsAac96.preset || null,
      mimeType: hlsAac96.format?.mime_type || null,
    };
  }

  const hlsAac = findHls(
    (transcoding) =>
      transcoding.preset?.startsWith("aac") ||
      transcoding.format?.mime_type?.includes("mp4")
  );
  if (hlsAac) {
    return {
      url: hlsAac.url,
      protocol: "hls",
      preset: hlsAac.preset || null,
      mimeType: hlsAac.format?.mime_type || null,
    };
  }

  const hlsMp3 = findHls(
    (transcoding) =>
      transcoding.format?.mime_type?.includes("audio/mpeg") ||
      transcoding.preset?.startsWith("mp3")
  );
  if (hlsMp3) {
    return {
      url: hlsMp3.url,
      protocol: "hls",
      preset: hlsMp3.preset || null,
      mimeType: hlsMp3.format?.mime_type || null,
    };
  }

  const hlsOpus = findHls(
    (transcoding) =>
      transcoding.preset?.includes("opus") ||
      transcoding.format?.mime_type?.includes("opus")
  );
  if (hlsOpus) {
    return {
      url: hlsOpus.url,
      protocol: "hls",
      preset: hlsOpus.preset || null,
      mimeType: hlsOpus.format?.mime_type || null,
    };
  }

  const progressive = candidates.find(
    (transcoding) => transcoding.format?.protocol === "progressive"
  );
  if (progressive) {
    return {
      url: progressive.url,
      protocol: "progressive",
      preset: progressive.preset || null,
      mimeType: progressive.format?.mime_type || null,
    };
  }

  const anyHls = candidates.find(
    (transcoding) => transcoding.format?.protocol === "hls"
  );
  if (anyHls) {
    return {
      url: anyHls.url,
      protocol: "hls",
      preset: anyHls.preset || null,
      mimeType: anyHls.format?.mime_type || null,
    };
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

function buildTrackDataFromApiTrack(trackData, clientId, pageUrl) {
  const streamInfo = extractStreamInfo(trackData);

  return {
    title: trackData.title,
    artist: trackData.user?.username || "Unknown Artist",
    artistUrl: trackData.user?.permalink_url || "",
    artistImageUrl: trackData.user?.avatar_url || null,
    duration: formatDuration(trackData.duration),
    artwork_url: trackData.artwork_url?.replace("-large", "-t500x500") || null,
    description: trackData.description || "No Description.",
    streamUrl: streamInfo?.url || null,
    streamProtocol: streamInfo?.protocol || null,
    streamPreset: streamInfo?.preset || null,
    streamMimeType: streamInfo?.mimeType || null,
    streamFormatLabel: getStreamFormatLabel(streamInfo),
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

async function fetchTracksByIds(trackIds, clientId) {
  if (!trackIds.length) {
    return new Map();
  }

  const tracksById = new Map();

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
  }

  return tracksById;
}

async function resolvePlaylistTracksUpTo(orderedEntries, clientId, pageUrl, limit) {
  const cap = limit ?? orderedEntries.length;
  const entriesUpToCap = orderedEntries.slice(0, cap);
  const partialTrackIds = entriesUpToCap
    .filter((track) => !track.title && track.id)
    .map((track) => track.id);

  let tracksById = new Map();

  if (partialTrackIds.length) {
    tracksById = await fetchTracksByIds(partialTrackIds, clientId);
  }

  return entriesUpToCap
    .map((track) => {
      const fullTrack = track.title ? track : tracksById.get(track.id);
      if (!fullTrack?.title) {
        return null;
      }

      return buildTrackDataFromApiTrack(fullTrack, clientId, pageUrl);
    })
    .filter(Boolean);
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
  extractionId = null
) {
  const tracks = [];
  const cap = limit ?? Infinity;
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

async function resolveBulkTracks(limit) {
  if (!bulkContext || bulkContext.pageUrl !== getCurrentPageUrl()) {
    throw new Error("Bulk download context is not available for this page.");
  }

  if (bulkContext.kind === "likes") {
    const tracks = await fetchLikesTracks(
      bulkContext.userId,
      bulkContext.clientId,
      bulkContext.pageUrl,
      bulkContext.oauthToken,
      limit
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
      limit
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

    const newTrackData = buildTrackDataFromApiTrack(
      trackData.data,
      clientId,
      pageUrl
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

    if (isSoundCloudTrackPage()) {
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

  return true;
});

function handleUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    activeExtractionId += 1;
    currentTrackData = null;
    currentPlaylistData = null;
    bulkContext = null;
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

window.SCDL = {
  getTrackData: () => currentTrackData,
  isTrackPage: () => isSoundCloudTrackPage(),
};

initScript();
