export const SAMPLE_RATE = 44100;
export const SEGMENT_FRAMES = 343980;
export const MAX_SECONDS = 120;
export const STEMS = Object.freeze(['drums', 'bass', 'other', 'vocals']);

export function validateAudio(channels) {
  const frames = channels?.[0]?.length;
  if (!Array.isArray(channels) || channels.length !== 2 || !frames || frames > SAMPLE_RATE * MAX_SECONDS ||
      channels.some(channel => !(channel instanceof Float32Array) || channel.length !== frames)) {
    throw new Error('Expected a stereo loop of up to 2 minutes at 44.1 kHz.');
  }
  for (const channel of channels) for (const value of channel) {
    if (!Number.isFinite(value)) throw new Error('Audio contains invalid samples.');
  }
  return frames;
}

// The ONNX model receives raw waveform; its graph performs its own normalization.
// A positive window retains the first/last sample. Short loops are centered in
// one segment; long loops use overlapping segments, with the last ending at B.
export async function separateAudio(channels, infer, progress = () => {}, segment = SEGMENT_FRAMES) {
  const frames = validateAudio(channels);
  if (!Number.isInteger(segment) || segment < 4) throw new Error('Invalid segment size.');
  const hop = Math.floor(segment * 0.75);
  const starts = [0];
  while (starts.at(-1) + segment < frames) starts.push(Math.min(starts.at(-1) + hop, frames - segment));
  const outputs = STEMS.map(() => [new Float32Array(frames), new Float32Array(frames)]);
  const weights = new Float32Array(frames);
  const fade = Math.floor(segment / 4);
  for (let part = 0; part < starts.length; part++) {
    const start = starts[part];
    const length = Math.min(segment, frames - start);
    const padding = Math.floor((segment - length) / 2);
    const input = new Float32Array(segment * 2);
    channels.forEach((channel, index) => input.set(channel.subarray(start, start + length), index * segment + padding));
    progress({ completed: part, total: starts.length });
    const predicted = await infer(input);
    if (!(predicted instanceof Float32Array) || predicted.length !== STEMS.length * 2 * segment) throw new Error('Unexpected model output shape.');
    for (let i = 0; i < length; i++) {
      const local = i + padding;
      const weight = Math.min(1, (local + 1) / (fade + 1), (segment - local) / (fade + 1));
      weights[start + i] += weight;
      for (let stem = 0; stem < STEMS.length; stem++) for (let channel = 0; channel < 2; channel++) {
        const value = predicted[(stem * 2 + channel) * segment + local];
        if (!Number.isFinite(value)) throw new Error('The model produced invalid audio.');
        outputs[stem][channel][start + i] += value * weight;
      }
    }
    progress({ completed: part + 1, total: starts.length });
  }
  for (const stem of outputs) for (const channel of stem) for (let i = 0; i < frames; i++) channel[i] /= weights[i];
  return outputs;
}

// IEEE float WAV preserves stem headroom instead of clipping individual exports.
export function encodeWav(channels, sampleRate = SAMPLE_RATE) {
  const frames = validateAudio(channels);
  const bytes = new ArrayBuffer(44 + frames * 8);
  const view = new DataView(bytes);
  const tag = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true);
  view.setUint16(32, 8, true); view.setUint16(34, 32, true); tag(36, 'data'); view.setUint32(40, frames * 8, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) view.setFloat32(44 + (i * 2 + c) * 4, channels[c][i], true);
  return bytes;
}
