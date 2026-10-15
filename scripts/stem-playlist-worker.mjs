import createSignalsmith from './vendor/signalsmith/wasm-factory.mjs';
import { stretchChannels } from './stem-playlist-stretch.mjs';

// Jobs arrive one at a time from the playlist's stretch cache. A fresh WASM
// instance per job keeps buffer allocations from accumulating.
self.onmessage = async ({ data }) => {
  try {
    const channels = stretchChannels(await createSignalsmith(), data.channels, data.sampleRate, data);
    self.postMessage({ id: data.id, channels }, channels.map(channel => channel.buffer));
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message || error) });
  }
};
