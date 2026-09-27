const SCDownload = (() => {
  const NETWORK_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
  const NETWORK_ATTEMPTS = 3;
  const REQUEST_TIMEOUT_MS = 30000;
  const MAX_RETRY_WAIT_MS = 30000;
  const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
  const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
  const MAX_COVER_BYTES = 5 * 1024 * 1024;
  const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;
  const MAX_WAV_BYTES = 128 * 1024 * 1024;
  const MAX_WORKING_BYTES = 384 * 1024 * 1024;
  const DEFAULT_DECODE_SAMPLE_RATE = 48000;
  const EXPECTED_DECODE_CHANNELS = 2;

  function memoryError() {
    const error = new Error("This audio is too large to process safely in the browser.");
    error.code = "memory_budget_exceeded";
    return error;
  }

  function checkDecodeBudget(trackData, decoded, decodeSampleRate = null) {
    const durationMs = Number(trackData?.durationMs);
    const sampleRate = Number(decodeSampleRate);
    if (!decoded && Number.isFinite(durationMs) && durationMs > 0 &&
        durationMs / 1000 * (
          Number.isFinite(sampleRate) && sampleRate > 0
            ? sampleRate
            : DEFAULT_DECODE_SAMPLE_RATE
        ) * EXPECTED_DECODE_CHANNELS * 4 > MAX_DECODED_PCM_BYTES) throw memoryError();
    if (decoded && (!Number.isSafeInteger(decoded.length) ||
        decoded.length * decoded.numberOfChannels * 4 > MAX_DECODED_PCM_BYTES)) throw memoryError();
  }

  function checkRenderBudget(decoded, range, transform, compressedBytes) {
    const rate = Number(transform?.rate || 1);
    const channels = Number(decoded.numberOfChannels);
    const sampleRate = Number(decoded.sampleRate);
    const sourceFrames = Number(decoded.length);
    const durationMs = Math.max(0, Number(range.endMs) - Number(range.startMs));
    if (!Number.isSafeInteger(channels) || channels < 1 || channels > 8 ||
        !Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 192000 ||
        !Number.isSafeInteger(sourceFrames) || sourceFrames < 1 ||
        !Number.isFinite(durationMs) || !Number.isFinite(rate) || rate <= 0) throw memoryError();
    const outputFrames = Math.ceil(durationMs / 1000 * sampleRate / rate);
    const outputChannels = Math.min(channels, 2);
    const wavBytes = 44 + outputFrames * outputChannels * 2;
    const workingBytes = compressedBytes * 2 + sourceFrames * channels * 4 +
      outputFrames * outputChannels * 4 + wavBytes;
    if (!Number.isSafeInteger(outputFrames) || !Number.isSafeInteger(wavBytes) ||
        !Number.isSafeInteger(workingBytes) || wavBytes > MAX_WAV_BYTES ||
        workingBytes > MAX_WORKING_BYTES) throw memoryError();
  }

  function wait(delayMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Download aborted.", "AbortError"));
        return;
      }
      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new DOMException("Download aborted.", "AbortError"));
      };
      const timeoutId = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function retryDelay(response, attempt) {
    const header = response?.headers?.get?.("Retry-After")?.trim();
    if (header) {
      const seconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
      const date = Number.isFinite(seconds) ? NaN : Date.parse(header);
      if (Number.isFinite(seconds)) return seconds * 1000;
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    return Math.min(500 * 2 ** attempt, 4000);
  }

  function responseError(label, response) {
    const error = new Error(`${label} failed with status ${response.status}`);
    error.code = "http_error";
    error.status = response.status;
    return error;
  }

  async function readBounded(response, label, maxBytes, readAs, sharedBudget = null) {
    const header = response.headers?.get?.("Content-Length");
    const declared = header == null ? null : Number(header);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 ||
        declared > maxBytes || (sharedBudget && sharedBudget.used + declared > sharedBudget.limit))) {
      response.body?.cancel?.().catch?.(() => {});
      throw memoryError();
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
      response.body?.cancel?.().catch?.(() => {});
      const error = new Error(`${label} cannot be read with a safe size limit.`);
      error.code = "invalid_response";
      throw error;
    }
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || size + value.byteLength > maxBytes ||
            (sharedBudget && sharedBudget.used + value.byteLength > sharedBudget.limit)) throw memoryError();
        size += value.byteLength;
        if (sharedBudget) sharedBudget.used += value.byteLength;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return readAs === "text" ? new TextDecoder().decode(bytes) : bytes.buffer;
    } catch (error) {
      if (sharedBudget) sharedBudget.used -= size;
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async function fetchWithRetry(url, label, signal, readAs, maxBytes, sharedBudget = null) {
    let lastError;
    for (let attempt = 0; attempt < NETWORK_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      let delay = Math.min(500 * 2 ** attempt, 4000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          lastError = responseError(label, response);
          if (!NETWORK_RETRY_STATUSES.has(response.status) || attempt === NETWORK_ATTEMPTS - 1) throw lastError;
          delay = retryDelay(response, attempt);
          response.body?.cancel?.().catch?.(() => {});
          if (delay > MAX_RETRY_WAIT_MS) {
            lastError.code = response.status === 429 ? "rate_limited" : "retry_later";
            lastError.retryAt = Date.now() + delay;
            throw lastError;
          }
        } else {
          return await readBounded(response, label, maxBytes, readAs, sharedBudget);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        if (timedOut) {
          lastError = new Error(`${label} timed out.`);
          lastError.code = "network_timeout";
        } else {
          lastError = error;
        }
        if (lastError.code === "http_error" || lastError.code === "rate_limited" ||
            lastError.code === "retry_later" || lastError.code === "memory_budget_exceeded" ||
            lastError.code === "invalid_response" ||
            attempt === NETWORK_ATTEMPTS - 1) throw lastError;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      await wait(delay, signal);
    }
    throw lastError || new Error(`${label} failed.`);
  }

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

      return new Uint8Array(await readBounded(response, "Cover", MAX_COVER_BYTES, "buffer"));
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      return null;
    }
  }

  async function finalizeTrackBlob(trackData, buffer, onProgress, signal, allowWav = false) {
    const { fileName, extension, bytes } = resolveFilename(trackData, buffer);
    if (extension === "wav" && !allowWav) {
      const error = new Error("Player Tools Pro is required to download WAV audio.");
      error.code = "wav_requires_pro";
      throw error;
    }
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
      if (/^#EXT-X-(KEY|SESSION-KEY|BYTERANGE|I-FRAMES-ONLY):?/.test(line) ||
          /^#EXT-X-MAP:.*BYTERANGE=/.test(line)) {
        const error = new Error("This HLS playlist uses unsupported encryption or byte ranges.");
        error.code = "unsupported_hls";
        throw error;
      }
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
    return fetchWithRetry(url, label, signal, "text", MAX_PLAYLIST_BYTES);
  }

  async function fetchBufferOrThrow(url, label, signal, sharedBudget = null) {
    return fetchWithRetry(url, label, signal, "buffer", MAX_AUDIO_BYTES, sharedBudget);
  }

  async function resolveMediaPlaylist(url, signal, visited = new Set()) {
    if (visited.has(url) || visited.size >= 5) {
      const error = new Error("HLS playlist contains a cycle or too many variants.");
      error.code = "unsupported_hls";
      throw error;
    }
    visited.add(url);
    const playlistText = await fetchTextOrThrow(url, "Playlist request", signal);

    if (playlistText.includes("#EXT-X-STREAM-INF")) {
      const { segmentUrls } = parseHlsPlaylist(url, playlistText);

      if (!segmentUrls.length) {
        throw new Error("HLS master playlist did not contain a media playlist.");
      }

      return resolveMediaPlaylist(segmentUrls[0], signal, visited);
    }

    return { baseUrl: url, playlistText };
  }

  async function fetchSegmentsWithConcurrency(urls, concurrency, onProgress, signal) {
    const results = new Array(urls.length);
    const sharedBudget = { used: 0, limit: MAX_AUDIO_BYTES };
    let nextIndex = 0;
    let completed = 0;
    let firstError = null;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();

    async function worker() {
      while (nextIndex < urls.length && !firstError) {
        if (controller.signal.aborted) {
          throw new DOMException("Download aborted.", "AbortError");
        }

        const currentIndex = nextIndex;
        nextIndex += 1;

        try {
          const buffer = await fetchBufferOrThrow(
            urls[currentIndex],
            `Segment ${currentIndex + 1}`,
            controller.signal,
            sharedBudget
          );
          if (firstError || controller.signal.aborted) return;
          results[currentIndex] = new Uint8Array(buffer);
          completed += 1;
          onProgress?.(completed, urls.length);
        } catch (error) {
          if (!firstError) {
            firstError = error;
            controller.abort();
          }
          return;
        }
      }
    }

    const workerCount = Math.min(concurrency, urls.length);
    try {
      await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
      if (firstError) throw firstError;
      throwIfAborted(signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return results;
  }

  function combineChunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (!Number.isSafeInteger(totalLength) || totalLength > MAX_AUDIO_BYTES) {
      const error = new Error("Audio exceeds the safe size limit.");
      error.code = "memory_budget_exceeded";
      throw error;
    }
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
    if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 192000 ||
        !Number.isSafeInteger(audioBuffer.length) || audioBuffer.length < 1 ||
        !Number.isSafeInteger(audioBuffer.numberOfChannels) ||
        audioBuffer.numberOfChannels < 1) throw memoryError();
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
    if (!Number.isSafeInteger(dataLength) || 44 + dataLength > MAX_WAV_BYTES) throw memoryError();
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
    playbackTransform,
    onProgress,
    signal,
    sampleEffects = null,
    allowWav = false
  ) {
    if (!allowWav) {
      const error = new Error("Player Tools Pro is required to export WAV audio.");
      error.code = "wav_requires_pro";
      throw error;
    }
    throwIfAborted(signal);
    const AudioContextConstructor =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("This browser cannot decode audio to export the loop.");
    }

    onProgress?.("Decoding audio...");
    const audioContext = new AudioContextConstructor();
    try {
      // decodeAudioData resamples into the context's sample rate. Validate the
      // actual rate before decoding so high-rate output devices remain bounded.
      checkDecodeBudget(trackData, null, audioContext.sampleRate);
      const sourceBuffer =
        buffer instanceof ArrayBuffer
          ? buffer.slice(0)
          : buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
      let decoded;
      try {
        decoded = await audioContext.decodeAudioData(sourceBuffer);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new Error("The downloaded audio could not be decoded to export this loop.");
      }
      checkDecodeBudget(trackData, decoded);
      throwIfAborted(signal);
      const renderer = globalThis.SCLoopAudioRenderer;
      if (!renderer?.normalizeTransform || !renderer?.render) {
        throw new Error("The loop audio renderer is unavailable.");
      }
      const transform = renderer.normalizeTransform(playbackTransform);
      checkRenderBudget(decoded, trimRange, transform, buffer.byteLength);
      const rendered = await renderer.render(decoded, trimRange, transform, {
        onProgress,
        signal,
      });
      throwIfAborted(signal);
      const finished = sampleEffects
        ? await globalThis.SCTempoEffects.renderSample(rendered, sampleEffects, signal)
        : rendered;
      onProgress?.("Encoding WAV...");
      const outputRange = {
        startMs: 0,
        endMs: (finished.length / finished.sampleRate) * 1000,
      };
      const wavBytes = encodeWavSegment(finished, outputRange, signal);
      const rateLabel = String(Number(Number(transform.rate).toFixed(3)));
      const transformLabel =
        transform.rate === 1
          ? ""
          : ` ${rateLabel}x ${
              transform.preservePitch ? "preserve pitch" : "natural pitch"
            }`;
      const loopTrack = {
        ...trackData,
        title: `${trackData?.title || "Untitled"} (loop${transformLabel})`,
      };
      return {
        blob: new Blob([wavBytes], { type: "audio/wav" }),
        fileName: sanitizeFilename(loopTrack, "wav"),
      };
    } finally {
      try {
        await audioContext.close?.();
      } catch {
        // Closing the decoder is best-effort after the output has been built.
      }
    }
  }

  function hasPlaybackTransform(playbackTransform) {
    const rate = Number(playbackTransform?.rate);
    return Number.isFinite(rate) && Math.abs(rate - 1) > 0.0001;
  }

  function hasSampleEffects(sampleEffects) {
    if (!sampleEffects || sampleEffects.bypassed === true) return false;
    if (["reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation"]
      .some((name) => Number(sampleEffects[name]) > 0)) return true;
    return Boolean(globalThis.SCParametricEQ?.isActive?.(sampleEffects.eq));
  }

  async function finalizeTransformedBlob(
    trackData,
    buffer,
    playbackTransform,
    onProgress,
    signal,
    sampleEffects = null,
    allowWav = false
  ) {
    if (!allowWav) {
      const error = new Error("Player Tools Pro is required to export WAV audio.");
      error.code = "wav_requires_pro";
      throw error;
    }
    throwIfAborted(signal);
    const AudioContextConstructor =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("This browser cannot decode audio to apply playback speed.");
    }

    onProgress?.("Decoding audio...");
    const audioContext = new AudioContextConstructor();
    try {
      checkDecodeBudget(trackData, null, audioContext.sampleRate);
      const sourceBuffer =
        buffer instanceof ArrayBuffer
          ? buffer.slice(0)
          : buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
      const decoded = await audioContext.decodeAudioData(sourceBuffer);
      checkDecodeBudget(trackData, decoded);
      throwIfAborted(signal);
      const renderer = globalThis.SCLoopAudioRenderer;
      if (!renderer?.normalizeTransform || !renderer?.render) {
        throw new Error("The audio renderer is unavailable.");
      }
      const transform = renderer.normalizeTransform(playbackTransform);
      checkRenderBudget(decoded, { startMs: 0, endMs: decoded.duration * 1000 }, transform, buffer.byteLength);
      const rendered = await renderer.render(
        decoded,
        { startMs: 0, endMs: decoded.duration * 1000 },
        transform,
        { onProgress, signal }
      );
      throwIfAborted(signal);
      const finished = hasSampleEffects(sampleEffects)
        ? await globalThis.SCTempoEffects.renderSample(rendered, sampleEffects, signal)
        : rendered;
      onProgress?.("Encoding WAV...");
      const wavBytes = encodeWavSegment(finished, {
        startMs: 0,
        endMs: (finished.length / finished.sampleRate) * 1000,
      }, signal);
      const rateLabel = String(Number(Number(transform.rate).toFixed(3)));
      const pitchLabel = transform.preservePitch ? "preserve pitch" : "natural pitch";
      return {
        blob: new Blob([wavBytes], { type: "audio/wav" }),
        fileName: sanitizeFilename(
          { ...trackData, title: `${trackData?.title || "Untitled"} (${rateLabel}x ${pitchLabel})` },
          "wav"
        ),
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.code === "memory_budget_exceeded") throw error;
      if (error?.message?.includes("could not be decoded")) throw error;
      throw new Error(`The downloaded audio could not be processed: ${error.message}`);
    } finally {
      await audioContext.close?.().catch?.(() => {});
    }
  }

  async function analyzeWaveform(trackData, buffer, signal) {
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      checkDecodeBudget(trackData, null, context.sampleRate);
      throwIfAborted(signal);
      const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const decoded = await context.decodeAudioData(bytes);
      checkDecodeBudget(trackData, decoded);
      return { success: true, waveform: await SCSpectralWaveform.analyze(decoded, signal) };
    } finally { await context.close(); }
  }

  async function buildTrackBlob(
    streamUrl,
    trackData,
    onProgress,
    signal,
    trimRange = null,
    playbackTransform = null,
    sampleEffects = null,
    allowWav = false,
    spectral = false
  ) {
    if (spectral) checkDecodeBudget(trackData, null, 48000);
    const normalizedTrimRange = normalizeTrimRange(trimRange);
    if (normalizedTrimRange || hasPlaybackTransform(playbackTransform) || hasSampleEffects(sampleEffects)) checkDecodeBudget(trackData);
    const isHlsStream =
      trackData.streamProtocol === "hls" || streamUrl.includes(".m3u8");
    const isDirectDownload =
      trackData.isOriginalDownload ||
      trackData.streamProtocol === "progressive" ||
      !isHlsStream;

    if (isDirectDownload) {
      onProgress?.("Downloading file...");
      const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
      if ((hasPlaybackTransform(playbackTransform) || hasSampleEffects(sampleEffects)) && !normalizedTrimRange) {
        return finalizeTransformedBlob(
          trackData,
          buffer,
          playbackTransform,
          onProgress,
          signal,
          sampleEffects,
          allowWav
        );
      }
      if (normalizedTrimRange) {
        return finalizeLoopBlob(
          trackData,
          buffer,
          normalizedTrimRange,
          playbackTransform,
          onProgress,
          signal,
          sampleEffects,
          allowWav
        );
      }
      return spectral ? analyzeWaveform(trackData, buffer, signal) : finalizeTrackBlob(trackData, buffer, onProgress, signal, allowWav);
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
      if ((hasPlaybackTransform(playbackTransform) || hasSampleEffects(sampleEffects)) && !normalizedTrimRange) {
        return finalizeTransformedBlob(
          trackData,
          combined,
          playbackTransform,
          onProgress,
          signal,
          sampleEffects,
          allowWav
        );
      }
      if (normalizedTrimRange) {
        return finalizeLoopBlob(
          trackData,
          combined,
          normalizedTrimRange,
          playbackTransform,
          onProgress,
          signal,
          sampleEffects,
          allowWav
        );
      }
      return spectral ? analyzeWaveform(trackData, combined, signal) : finalizeTrackBlob(trackData, combined, onProgress, signal, allowWav);
    }

    onProgress?.("Downloading file...");
    const buffer = await fetchBufferOrThrow(streamUrl, "File download", signal);
    if (normalizedTrimRange) {
      return finalizeLoopBlob(
        trackData,
        buffer,
        normalizedTrimRange,
        playbackTransform,
        onProgress,
        signal,
        sampleEffects,
        allowWav
      );
    }
    return spectral ? analyzeWaveform(trackData, buffer, signal) : finalizeTrackBlob(trackData, buffer, onProgress, signal, allowWav);
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
