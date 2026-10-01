import * as ort from './vendor/onnxruntime/ort.wasm.min.mjs';
import { separateAudio, validateAudio, SEGMENT_FRAMES } from './stem-audio.mjs';
import { loadModel } from './stem-model.mjs';

let busy = false;
self.onmessage = async ({ data }) => {
  if (busy || data?.type !== 'separate') return;
  busy = true;
  let session;
  const progress = details => self.postMessage({ type: 'progress', ...details });
  try {
    validateAudio(data.channels);
    const bytes = await loadModel(progress);
    progress({ phase: 'load' });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('./vendor/onnxruntime/', import.meta.url).href;
    // ORT 1.30's graph optimizer exhausted WASM memory for this export in the
    // real Chrome test. Keep these settings until a different configuration
    // passes the same model/browser test; file size is not peak runtime memory.
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled',
      enableCpuMemArena: false, enableMemPattern: false });
    if (session.inputNames.length !== 1 || session.inputNames[0] !== 'mix' || !session.outputNames.includes('stems')) {
      throw new Error('This model has an unexpected input/output contract.');
    }
    const started = performance.now();
    const outputs = await separateAudio(data.channels, async input => {
      const tensor = new ort.Tensor('float32', input, [1, 2, SEGMENT_FRAMES]);
      let result;
      try {
        result = await session.run({ mix: tensor });
        if (result.stems.dims.join(',') !== `1,4,2,${SEGMENT_FRAMES}`) throw new Error('Unexpected stem dimensions.');
        return new Float32Array(result.stems.data);
      } finally {
        tensor.dispose();
        if (result) for (const output of Object.values(result)) output.dispose();
      }
    }, details => progress({ phase: 'run', ...details }));
    self.postMessage({ type: 'complete', outputs, seconds: (performance.now() - started) / 1000 }, outputs.flat().map(channel => channel.buffer));
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  } finally { await session?.release(); busy = false; }
};
