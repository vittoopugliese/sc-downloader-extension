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
      (trackData.artworkUrl ||
        trackData.title ||
        trackData.artist);

    if (shouldTag) {
      onProgress?.("Adding metadata...");
      const coverUrl = trackData.artworkUrl || null;
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

  function normalizeTrimRange(trimRange) {
    if (!trimRange) return null;

    const startMs = Number(trimRange.startMs);
    const endMs = Number(trimRange.endMs);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs
    ) {
      throw new Error("The selected loop range is invalid.");
    }

    return { startMs, endMs };
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error("Download aborted.");
    error.name = "AbortError";
    throw error;
  }

  function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  function encodeWavSegment(audioBuffer, trimRange, signal) {
    const sampleRate = audioBuffer.sampleRate;
    const channelCount = Math.min(Math.max(audioBuffer.numberOfChannels, 1), 2);
    const startFrame = Math.max(
      0,
      Math.floor((trimRange.startMs / 1000) * sampleRate)
    );
    const endFrame = Math.min(
      audioBuffer.length,
      Math.ceil((trimRange.endMs / 1000) * sampleRate)
    );
    const frameCount = endFrame - startFrame;

    if (frameCount <= 0) {
      throw new Error("The selected loop starts after the available audio ends.");
    }

    const bytesPerSample = 2;
    const dataLength = frameCount * channelCount * bytesPerSample;
    const output = new ArrayBuffer(44 + dataLength);
    const view = new DataView(output);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
    view.setUint16(32, channelCount * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataLength, true);

    const channels = Array.from({ length: channelCount }, (_, index) =>
      audioBuffer.getChannelData(index)
    );
    let outputOffset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (frame % sampleRate === 0) throwIfAborted(signal);
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(
          -1,
          Math.min(1, channels[channel][startFrame + frame] || 0)
        );
        view.setInt16(
          outputOffset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        outputOffset += bytesPerSample;
      }
    }

    return new Uint8Array(output);
  }

  async function finalizeLoopBlob(
    trackData,
    buffer,
    trimRange,
    onProgress,
    signal
  ) {
    throwIfAborted(signal);
    const AudioContextConstructor =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("This browser cannot decode audio to export the loop.");
    }

    onProgress?.("Decoding audio...");
    const audioContext = new AudioContextConstructor();
    try {
      const sourceBuffer =
        buffer instanceof ArrayBuffer
          ? buffer.slice(0)
          : buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
      const decoded = await audioContext.decodeAudioData(sourceBuffer);
      throwIfAborted(signal);
      onProgress?.("Cutting selected loop...");
      const wavBytes = encodeWavSegment(decoded, trimRange, signal);
      const loopTrack = {
        ...trackData,
        title: `${trackData?.title || "Untitled"} (loop)`,
      };
      return {
        blob: new Blob([wavBytes], { type: "audio/wav" }),
        fileName: sanitizeFilename(loopTrack, "wav"),
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(
        error?.message === "The selected loop starts after the available audio ends."
          ? error.message
          : "The downloaded audio could not be decoded to export this loop."
      );
    } finally {
      try {
        await audioContext.close?.();
      } catch {
        // Closing the decoder is best-effort after the output has been built.
      }
    }
  }

  async function buildTrackBlob(
    streamUrl,
    trackData,
    onProgress,
    signal,
    trimRange = null
  ) {
    const normalizedTrimRange = normalizeTrimRange(trimRange);
    const isHlsStream =
      trackData.streamProtocol === "hls" || streamUrl.includes(".m3u8");
    const isDirectDownload =
      trackData.isOriginalDownload ||
      trackData.streamProtocol === "progressive" ||
      !isHlsStream;

    if (isDirectDownload) {
      onProgress?.("Downloading file...");
      const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
      if (normalizedTrimRange) {
        return finalizeLoopBlob(
          trackData,
          buffer,
          normalizedTrimRange,
          onProgress,
          signal
        );
      }
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
      if (normalizedTrimRange) {
        return finalizeLoopBlob(
          trackData,
          combined,
          normalizedTrimRange,
          onProgress,
          signal
        );
      }
      return finalizeTrackBlob(trackData, combined, onProgress, signal);
    }

    onProgress?.("Downloading file...");
    const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
    if (normalizedTrimRange) {
      return finalizeLoopBlob(
        trackData,
        buffer,
        normalizedTrimRange,
        onProgress,
        signal
      );
    }
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
