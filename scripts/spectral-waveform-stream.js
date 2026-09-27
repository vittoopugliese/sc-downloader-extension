/* Long-track MP3 analysis: bounded decoder queue, continuous filters, no retained PCM.
 * MP3 chunks follow https://www.w3.org/TR/webcodecs-mp3-codec-registration/.
 */
(() => {
  'use strict';
  const MAX_BINS = 65536;

  function createAccumulator(sampleRate, durationMs) {
    let binSize = Math.max(1, Math.ceil(Math.max(sampleRate * .005, sampleRate * durationMs / 1000 / (MAX_BINS - 1))));
    const peaks = new Float32Array(MAX_BINS);
    const bands = new Float64Array(MAX_BINS * 3);
    const states = [{ low: 0, high: 0 }, { low: 0, high: 0 }];
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 250 / sampleRate);
    const highAlpha = 1 - Math.exp(-2 * Math.PI * 4000 / sampleRate);
    let frames = 0;

    function compact() {
      // Underestimated duration must not discard the end or grow memory indefinitely.
      for (let i = 0; i < MAX_BINS / 2; i++) {
        peaks[i] = Math.max(peaks[i * 2], peaks[i * 2 + 1]);
        for (let b = 0; b < 3; b++) bands[i * 3 + b] = bands[i * 6 + b] + bands[i * 6 + 3 + b];
      }
      peaks.fill(0, MAX_BINS / 2);
      bands.fill(0, MAX_BINS * 3 / 2);
      binSize *= 2;
    }

    return {
      push(channels) {
        const length = channels[0].length;
        for (let frame = 0; frame < length; frame++, frames++) {
          if (Math.floor(frames / binSize) >= MAX_BINS) compact();
          const bin = Math.floor(frames / binSize);
          for (let channel = 0; channel < Math.min(channels.length, 2); channel++) {
            const value = channels[channel][frame];
            const state = states[channel];
            state.low += lowAlpha * (value - state.low);
            state.high += highAlpha * (value - state.high);
            peaks[bin] = Math.max(peaks[bin], Math.abs(value));
            bands[bin * 3] += state.low * state.low;
            bands[bin * 3 + 1] += (state.high - state.low) ** 2;
            bands[bin * 3 + 2] += (value - state.high) ** 2;
          }
        }
      },
      finish() {
        const count = Math.ceil(frames / binSize);
        if (!count) throw new Error('No audio frames were decoded.');
        return { peaks: Array.from(peaks.subarray(0, count)),
          bands: Array.from(bands.subarray(0, count * 3)), durationMs: frames / sampleRate * 1000 };
      },
    };
  }

  function header(bytes, offset) {
    if (bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) return null;
    const version = (bytes[offset + 1] >> 3) & 3;
    const layer = (bytes[offset + 1] >> 1) & 3;
    const rateIndex = (bytes[offset + 2] >> 2) & 3;
    const bitrateIndex = bytes[offset + 2] >> 4;
    if (version === 1 || layer !== 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) return null;
    const sampleRate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    return { sampleRate, channels: (bytes[offset + 3] >> 6) === 3 ? 1 : 2,
      samples: version === 3 ? 1152 : 576,
      length: Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((bytes[offset + 2] >> 1) & 1) };
  }

  async function* mp3Frames(chunks, signal) {
    let pending = new Uint8Array(0), skip = 0, seen = false;
    for await (const chunk of chunks) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      // Bound parser storage even if a fetch reader supplies a large chunk.
      for (let part = 0; part < chunk.length; part += 65536) {
        const input = chunk.subarray(part, part + 65536);
        const bytes = new Uint8Array(pending.length + input.length);
        bytes.set(pending); bytes.set(input, pending.length);
        let offset = 0;
        while (offset < bytes.length) {
          if (skip) {
            const amount = Math.min(skip, bytes.length - offset);
            offset += amount; skip -= amount;
            continue;
          }
          if (bytes.length - offset < 10) break;
          if (bytes[offset] === 73 && bytes[offset + 1] === 68 && bytes[offset + 2] === 51) {
            const size = bytes.subarray(offset + 6, offset + 10);
            if (size.some(value => value & 128)) throw new Error('Invalid MP3 metadata.');
            skip = 10 + size.reduce((total, value) => total * 128 + value, 0) +
              (bytes[offset + 3] === 4 && (bytes[offset + 5] & 16) ? 10 : 0);
            continue;
          }
          if (seen && bytes[offset] === 84 && bytes[offset + 1] === 65 && bytes[offset + 2] === 71) {
            skip = 128; continue; // ID3v1 footer.
          }
          const info = header(bytes, offset);
          if (!info) throw new Error('Long-track analysis requires an MP3 stream.');
          if (bytes.length - offset < info.length) break;
          yield { ...info, data: bytes.subarray(offset, offset + info.length) };
          seen = true;
          offset += info.length;
        }
        pending = bytes.slice(offset);
      }
    }
    if (!seen || pending.length || skip) throw new Error('Incomplete MP3 stream.');
  }

  async function analyze(chunks, durationMs, signal) {
    if (typeof AudioDecoder !== 'function') throw new Error('This browser does not support streaming audio analysis.');
    let accumulator, config, failure, timestamp = 0;
    const decoder = new AudioDecoder({
      output(data) {
        try {
          if (failure) return;
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (data.sampleRate !== config.sampleRate) throw new Error('The audio sample rate changed.');
          accumulator ||= createAccumulator(data.sampleRate, durationMs);
          const channels = Array.from({ length: Math.min(data.numberOfChannels, 2) }, (_, planeIndex) => {
            const pcm = new Float32Array(data.numberOfFrames);
            data.copyTo(pcm, { planeIndex, format: 'f32-planar' });
            return pcm;
          });
          accumulator.push(channels);
        } catch (error) { failure = error; }
        finally { data.close(); }
      },
      error(error) { failure = error; },
    });
    try {
      for await (const frame of mp3Frames(chunks, signal)) {
        if (failure) throw failure;
        if (!config) {
          config = { codec: 'mp3', sampleRate: frame.sampleRate, numberOfChannels: frame.channels };
          const support = await AudioDecoder.isConfigSupported(config);
          if (!support.supported) throw new Error('MP3 streaming analysis is unavailable in this browser.');
          decoder.configure(config);
        }
        if (frame.sampleRate !== config.sampleRate || frame.channels !== config.numberOfChannels) {
          throw new Error('The MP3 stream format changed.');
        }
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(timestamp), data: frame.data }));
        timestamp += frame.samples / frame.sampleRate * 1e6;
        // Yield without flushing: MP3's bit reservoir must survive block boundaries.
        while (decoder.decodeQueueSize >= 32) {
          if (failure) throw failure;
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      await decoder.flush();
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (failure) throw failure;
      if (!accumulator) throw new Error('No audio frames were decoded.');
      return accumulator.finish();
    } finally { if (decoder.state !== 'closed') decoder.close(); }
  }
  globalThis.SCSpectralWaveformStream = { analyze, createAccumulator };
})();
