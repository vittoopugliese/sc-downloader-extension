const SCDownload = (() => {
  function sanitizeFilename(trackData, extension) {
    const fileName = `${trackData.artist} - ${trackData.title}`;
    const sanitizedFileName = fileName.replace(/[^a-z0-9 -]/gi, " ").trim();
    return `${sanitizedFileName}.${extension}`;
  }

  function getFileExtension(trackData) {
    const preset = trackData.streamPreset || "";
    const mimeType = trackData.streamMimeType || "";

    if (trackData.streamProtocol === "progressive") {
      return "mp3";
    }

    if (preset.startsWith("mp3") || mimeType.includes("audio/mpeg")) {
      return "mp3";
    }

    if (preset.includes("opus") || mimeType.includes("opus")) {
      return "ogg";
    }

    if (preset.startsWith("aac") || mimeType.includes("mp4")) {
      return "m4a";
    }

    return "audio";
  }

  function getBlobType(trackData) {
    const extension = getFileExtension(trackData);

    if (extension === "mp3") {
      return "audio/mpeg";
    }

    if (extension === "ogg") {
      return "audio/ogg";
    }

    if (extension === "m4a") {
      return "audio/mp4";
    }

    return "application/octet-stream";
  }

  function resolvePlaylistUrl(baseUrl, line) {
    if (line.startsWith("http")) {
      return line;
    }

    return new URL(line, baseUrl).href;
  }

  function parseHlsPlaylist(baseUrl, playlistText) {
    const lines = playlistText.split("\n").map((line) => line.trim());
    let initSegmentUrl = null;
    const segmentUrls = [];

    for (const line of lines) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          initSegmentUrl = resolvePlaylistUrl(baseUrl, uriMatch[1]);
        }
        continue;
      }

      if (line && !line.startsWith("#")) {
        segmentUrls.push(resolvePlaylistUrl(baseUrl, line));
      }
    }

    return { initSegmentUrl, segmentUrls };
  }

  async function fetchTextOrThrow(url, label, signal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`${label} failed with status ${response.status}`);
    }

    return response.text();
  }

  async function fetchBufferOrThrow(url, label, signal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`${label} failed with status ${response.status}`);
    }

    return response.arrayBuffer();
  }

  async function resolveMediaPlaylist(url, signal) {
    const playlistText = await fetchTextOrThrow(url, "Playlist request", signal);

    if (playlistText.includes("#EXT-X-STREAM-INF")) {
      const { segmentUrls } = parseHlsPlaylist(url, playlistText);

      if (!segmentUrls.length) {
        throw new Error("HLS master playlist did not contain a media playlist.");
      }

      return resolveMediaPlaylist(segmentUrls[0], signal);
    }

    return { baseUrl: url, playlistText };
  }

  async function fetchSegmentsWithConcurrency(urls, concurrency, onProgress, signal) {
    const results = new Array(urls.length);
    let nextIndex = 0;
    let completed = 0;

    async function worker() {
      while (nextIndex < urls.length) {
        if (signal?.aborted) {
          throw new DOMException("Download aborted.", "AbortError");
        }

        const currentIndex = nextIndex;
        nextIndex += 1;

        const buffer = await fetchBufferOrThrow(
          urls[currentIndex],
          `Segment ${currentIndex + 1}`,
          signal
        );
        results[currentIndex] = new Uint8Array(buffer);
        completed += 1;
        onProgress?.(completed, urls.length);
      }
    }

    const workerCount = Math.min(concurrency, urls.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
  }

  function combineChunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  }

  async function buildTrackBlob(streamUrl, trackData, onProgress, signal) {
    const extension = getFileExtension(trackData);
    const fileName = sanitizeFilename(trackData, extension);

    if (trackData.streamProtocol === "hls" || streamUrl.includes(".m3u8")) {
      onProgress?.("Loading playlist...");
      const { baseUrl, playlistText } = await resolveMediaPlaylist(streamUrl, signal);
      const { initSegmentUrl, segmentUrls } = parseHlsPlaylist(
        baseUrl,
        playlistText
      );

      if (!segmentUrls.length) {
        throw new Error("HLS playlist did not contain any media segments.");
      }

      const downloadUrls = initSegmentUrl
        ? [initSegmentUrl, ...segmentUrls]
        : segmentUrls;

      onProgress?.(`Downloading 0/${downloadUrls.length} parts...`);

      const chunks = await fetchSegmentsWithConcurrency(
        downloadUrls,
        4,
        (done, total) => {
          onProgress?.(`Downloading ${done}/${total} parts...`);
        },
        signal
      );

      onProgress?.("Preparing file...");
      const combined = combineChunks(chunks);
      const blob = new Blob([combined], { type: getBlobType(trackData) });
      return { blob, fileName };
    }

    onProgress?.("Downloading file...");
    const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
    const blob = new Blob([buffer], { type: getBlobType(trackData) });
    return { blob, fileName };
  }

  function triggerBlobDownload(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  }

  async function forceDownload(url, trackData, onProgress) {
    const { blob, fileName } = await buildTrackBlob(url, trackData, onProgress);
    triggerBlobDownload(blob, fileName);
  }

  return {
    sanitizeFilename,
    getFileExtension,
    getBlobType,
    buildTrackBlob,
    triggerBlobDownload,
    forceDownload,
  };
})();
