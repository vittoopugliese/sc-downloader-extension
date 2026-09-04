const SCDownload = (() => {
  function sanitizeFilename(trackData, extension) {
    const artist = SCFormat.sanitizePathComponent(
      trackData?.artist,
      "Unknown Artist",
      80
    );
    const title = SCFormat.sanitizePathComponent(
      trackData?.title,
      "Untitled",
      160
    );
    const baseName = SCFormat.sanitizePathComponent(
      `${artist} - ${title}`,
      "Unknown Artist - Untitled",
      220
    );
    const safeExtension = String(extension || "audio")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "audio";

    return `${baseName}.${safeExtension}`;
  }

  function getFileExtension(trackData) {
    return SCFormat.getFileExtension(trackData);
  }

  function getBlobType(trackData) {
    return SCFormat.getBlobType(trackData);
  }

  function resolveFilename(trackData, buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const detectedExtension = SCFormat.detectContainerFromBytes(bytes);
    const metadataExtension = getFileExtension(trackData);
    const extension = detectedExtension || metadataExtension;

    if (!detectedExtension && bytes.length < 16) {
      throw new Error("Downloaded file is empty or unreadable.");
    }

    if (detectedExtension && detectedExtension !== metadataExtension) {
      console.warn(
        `SC Downloader: corrected extension from .${metadataExtension} to .${detectedExtension}`
      );
    }

    return {
      fileName: sanitizeFilename(trackData, extension),
      extension,
      bytes,
    };
  }

  async function fetchCoverBuffer(coverUrl, signal) {
    if (!coverUrl) {
      return null;
    }

    try {
      const response = await fetch(coverUrl, { signal });

      if (!response.ok) {
        return null;
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      return null;
    }
  }

  async function finalizeTrackBlob(trackData, buffer, onProgress, signal) {
    const { fileName, extension, bytes } = resolveFilename(trackData, buffer);
    let finalBytes = bytes;

    const shouldTag =
      (extension === "mp3" || extension === "m4a") &&
      typeof SCMetadata !== "undefined" &&
      (trackData.coverUrl ||
        trackData.artwork_url ||
        trackData.title ||
        trackData.artist);

    if (shouldTag) {
      onProgress?.("Adding metadata...");
      const coverUrl = trackData.coverUrl || trackData.artwork_url || null;
      const coverBuffer = coverUrl ? await fetchCoverBuffer(coverUrl, signal) : null;

      finalBytes = SCMetadata.embedMetadata(
        finalBytes,
        extension,
        {
          title: trackData.title,
          artist: trackData.artist,
          album: trackData.album,
          genre: trackData.genre,
          year: trackData.year,
        },
        coverBuffer
      );
    }

    return {
      blob: new Blob([finalBytes], { type: getBlobType(trackData) }),
      fileName,
    };
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
    const isHlsStream =
      trackData.streamProtocol === "hls" || streamUrl.includes(".m3u8");
    const isDirectDownload =
      trackData.isOriginalDownload ||
      trackData.streamProtocol === "progressive" ||
      !isHlsStream;

    if (isDirectDownload) {
      onProgress?.("Downloading file...");
      const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
      return finalizeTrackBlob(trackData, buffer, onProgress, signal);
    }

    if (isHlsStream) {
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
      return finalizeTrackBlob(trackData, combined, onProgress, signal);
    }

    onProgress?.("Downloading file...");
    const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
    return finalizeTrackBlob(trackData, buffer, onProgress, signal);
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
