/*
 * Offline loop renderer for SoundCloud Track Downloader.
 * Preserve-pitch rendering uses the pinned Signalsmith Stretch WASM build;
 * see THIRD_PARTY_LICENSES.md.
 */
(() => {
  "use strict";

  const MIN_RATE = 0.1;
  const MAX_RATE = 4;
  const DEFAULT_RATE = 1;
  const QUANTUM = 128;
  // The rendered Float32 output is only one part of the peak: decoded input,
  // renderer working buffers, WAV bytes and the final Blob coexist briefly.
  // Keeping this at 128 MiB prevents multi-gigabyte peaks on Chromebooks.
  const MAX_RENDERED_PCM_BYTES = 128 * 1024 * 1024;
  const FACTORY_URL = "scripts/vendor/signalsmith/wasm-factory.mjs";
  let factoryPromise = null;

  function normalizeTransform(value) {
    const number = Number(value?.rate);
    const rate = Number.isFinite(number)
      ? Math.round(Math.max(MIN_RATE, Math.min(MAX_RATE, number)) * 1000) / 1000
      : DEFAULT_RATE;
    return Object.freeze({
      rate,
      preservePitch: Boolean(value?.preservePitch),
    });
  }

  function normalizeRange(audioBuffer, trimRange) {
    const sampleRate = Number(audioBuffer?.sampleRate);
    const length = Number(audioBuffer?.length);
    const channels = Number(audioBuffer?.numberOfChannels);
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate <= 0 ||
      sampleRate > 192000 ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      !Number.isInteger(channels) ||
      channels <= 0 ||
      typeof audioBuffer?.getChannelData !== "function"
    ) {
      throw new TypeError("Decoded audio is not supported for loop rendering.");
    }

    const startMs = Number(trimRange?.startMs);
    const endMs = Number(trimRange?.endMs);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs
    ) {
      throw new Error("The selected loop range is invalid.");
    }

    const startFrame = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
    const endFrame = Math.min(length, Math.ceil((endMs / 1000) * sampleRate));
    if (endFrame <= startFrame) {
      throw new Error("The selected loop starts after the available audio ends.");
    }

    return Object.freeze({
      sampleRate,
      sourceChannels: Math.min(channels, 2),
      startFrame,
      endFrame,
      frameCount: endFrame - startFrame,
    });
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error("Download aborted.");
    error.name = "AbortError";
    throw error;
  }

  function pcmBuffer(sampleRate, channels) {
    const values = channels.map((channel) =>
      channel instanceof Float32Array ? channel : new Float32Array(channel)
    );
    return Object.freeze({
      sampleRate,
      numberOfChannels: values.length,
      length: values[0]?.length || 0,
      getChannelData(index) {
        if (!Number.isInteger(index) || index < 0 || index >= values.length) {
          throw new RangeError("Audio channel is out of range.");
        }
        return values[index];
      },
    });
  }

  function copySegment(audioBuffer, range) {
    const outputBytes = range.frameCount * range.sourceChannels * 4;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > MAX_RENDERED_PCM_BYTES) {
      const error = new Error("The selected loop is too large to render.");
      error.code = "memory_budget_exceeded";
      throw error;
    }
    const channels = Array.from({ length: range.sourceChannels }, (_, channel) =>
      audioBuffer
        .getChannelData(channel)
        .slice(range.startFrame, range.endFrame)
    );
    return pcmBuffer(range.sampleRate, channels);
  }

  function linearResample(audioBuffer, range, rate, signal) {
    const outputLength = Math.max(1, Math.ceil(range.frameCount / rate));
    const outputBytes = outputLength * range.sourceChannels * 4;
    if (outputBytes > MAX_RENDERED_PCM_BYTES) {
      throw new Error("The selected loop is too large to render at this speed.");
    }

    const channels = Array.from(
      { length: range.sourceChannels },
      () => new Float32Array(outputLength)
    );
    for (let channel = 0; channel < channels.length; channel += 1) {
      const input = audioBuffer.getChannelData(channel);
      const output = channels[channel];
      for (let frame = 0; frame < outputLength; frame += 1) {
        if ((frame & 0xffff) === 0) throwIfAborted(signal);
        const sourcePosition = Math.min(
          range.endFrame - 1,
          range.startFrame + frame * rate
        );
        const left = Math.floor(sourcePosition);
        const right = Math.min(range.endFrame - 1, left + 1);
        const mix = sourcePosition - left;
        output[frame] = input[left] * (1 - mix) + input[right] * mix;
      }
    }
    return pcmBuffer(range.sampleRate, channels);
  }

  async function renderNatural(audioBuffer, range, rate, signal) {
    throwIfAborted(signal);
    const OfflineContext =
      globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (typeof OfflineContext !== "function") {
      return linearResample(audioBuffer, range, rate, signal);
    }

    const outputLength = Math.max(1, Math.ceil(range.frameCount / rate));
    const outputBytes = outputLength * range.sourceChannels * 4;
    if (outputBytes > MAX_RENDERED_PCM_BYTES) {
      throw new Error("The selected loop is too large to render at this speed.");
    }

    const context = new OfflineContext(
      range.sourceChannels,
      outputLength,
      range.sampleRate
    );
    const segment = context.createBuffer(
      range.sourceChannels,
      range.frameCount,
      range.sampleRate
    );
    for (let channel = 0; channel < range.sourceChannels; channel += 1) {
      segment.copyToChannel(
        audioBuffer
          .getChannelData(channel)
          .subarray(range.startFrame, range.endFrame),
        channel
      );
    }
    const source = context.createBufferSource();
    source.buffer = segment;
    source.playbackRate.value = rate;
    source.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    throwIfAborted(signal);
    return rendered;
  }

  function defaultFactoryLoader() {
    if (!factoryPromise) {
      const url = globalThis.chrome?.runtime?.getURL
        ? chrome.runtime.getURL(FACTORY_URL)
        : `./vendor/signalsmith/wasm-factory.mjs`;
      factoryPromise = import(url).then((module) => {
        if (typeof module.default !== "function") {
          throw new Error("Signalsmith Stretch could not be loaded.");
        }
        return module.default;
      });
    }
    return factoryPromise;
  }

  function sampleAt(audioBuffer, range, channel, frame) {
    if (frame < range.startFrame || frame >= range.endFrame) return 0;
    const sourceChannel = Math.min(channel, range.sourceChannels - 1);
    return audioBuffer.getChannelData(sourceChannel)[frame] || 0;
  }

  async function renderPreserved(
    audioBuffer,
    range,
    rate,
    signal,
    onProgress,
    loadFactory
  ) {
    throwIfAborted(signal);
    if (range.sampleRate < 8000) {
      throw new Error("Signalsmith does not support this audio sample rate.");
    }
    const outputLength = Math.max(1, Math.ceil(range.frameCount / rate));
    const outputBytes = outputLength * range.sourceChannels * 4;
    if (outputBytes > MAX_RENDERED_PCM_BYTES) {
      throw new Error("The selected loop is too large to preserve its pitch.");
    }

    onProgress?.("Loading pitch-preservation engine...");
    const createSignalsmith = await loadFactory();
    const wasm = await createSignalsmith();
    wasm._main();
    wasm._configure(
      2,
      Math.round(range.sampleRate * 0.12),
      Math.round(range.sampleRate * 0.03),
      true
    );
    wasm._reset();
    const inputLatency = wasm._inputLatency();
    const outputLatency = wasm._outputLatency();
    const historyLength = inputLatency + outputLatency;
    if (
      !Number.isSafeInteger(inputLatency) ||
      !Number.isSafeInteger(outputLatency) ||
      historyLength < QUANTUM ||
      historyLength > range.sampleRate
    ) {
      throw new Error("Signalsmith returned an invalid working-buffer size.");
    }

    const pointer = wasm._setBuffers(2, historyLength);
    wasm._setTransposeFactor(1, 8000 / range.sampleRate);
    wasm._setFormantSemitones(0, false);
    wasm._setFormantBase(0);

    const outputChannels = Array.from(
      { length: range.sourceChannels },
      () => new Float32Array(outputLength)
    );
    const rateHint = Math.fround(rate);
    let previousSourceEnd = null;
    let lastPercent = -1;

    onProgress?.(`Rendering loop at ${rate}x with preserved pitch...`);
    for (let outputFrame = 0; outputFrame < outputLength; outputFrame += QUANTUM) {
      throwIfAborted(signal);
      const sourceEnd = Math.round(
        range.startFrame +
          (outputFrame + outputLatency) * rate +
          inputLatency
      );
      const first = previousSourceEnd === null;
      const inputLength = first
        ? historyLength
        : Math.max(0, sourceEnd - previousSourceEnd);
      if (inputLength > historyLength) {
        throw new Error("Signalsmith input advanced beyond its working buffer.");
      }

      for (let channel = 0; channel < 2; channel += 1) {
        const input = new Float32Array(
          wasm.HEAP8.buffer,
          pointer + channel * historyLength * 4,
          historyLength
        );
        const sourceStart = first ? sourceEnd - historyLength : previousSourceEnd;
        for (let index = 0; index < inputLength; index += 1) {
          input[index] = sampleAt(
            audioBuffer,
            range,
            channel,
            sourceStart + index
          );
        }
      }

      if (first) wasm._seek(historyLength, rateHint);
      wasm._process(first ? 0 : inputLength, QUANTUM);
      const writable = Math.min(QUANTUM, outputLength - outputFrame);
      for (let channel = 0; channel < range.sourceChannels; channel += 1) {
        const output = new Float32Array(
          wasm.HEAP8.buffer,
          pointer + (channel + 2) * historyLength * 4,
          QUANTUM
        );
        if (!output.every(Number.isFinite)) {
          throw new Error("Signalsmith produced invalid audio samples.");
        }
        outputChannels[channel].set(output.subarray(0, writable), outputFrame);
      }

      previousSourceEnd = sourceEnd;
      const percent = Math.min(
        100,
        Math.floor(((outputFrame + writable) / outputLength) * 100)
      );
      if (percent >= lastPercent + 5 || percent === 100) {
        lastPercent = percent;
        onProgress?.(`Rendering preserved pitch ${percent}%...`);
      }
      if ((outputFrame / QUANTUM) % 256 === 255) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return pcmBuffer(range.sampleRate, outputChannels);
  }

  function create(options = {}) {
    const loadFactory = options.loadFactory || defaultFactoryLoader;
    return Object.freeze({
      async render(audioBuffer, trimRange, transformValue, hooks = {}) {
        const transform = normalizeTransform(transformValue);
        const range = normalizeRange(audioBuffer, trimRange);
        if (transform.rate === DEFAULT_RATE) {
          return copySegment(audioBuffer, range);
        }
        if (!transform.preservePitch) {
          hooks.onProgress?.(
            `Rendering loop at ${transform.rate}x with natural pitch...`
          );
          return renderNatural(
            audioBuffer,
            range,
            transform.rate,
            hooks.signal
          );
        }
        return renderPreserved(
          audioBuffer,
          range,
          transform.rate,
          hooks.signal,
          hooks.onProgress,
          loadFactory
        );
      },
    });
  }

  globalThis.SCLoopAudioRenderer = Object.freeze({
    DEFAULTS: Object.freeze({
      minRate: MIN_RATE,
      maxRate: MAX_RATE,
      rate: DEFAULT_RATE,
      preservePitch: false,
    }),
    create,
    normalizeTransform,
    render: create().render,
  });
})();
