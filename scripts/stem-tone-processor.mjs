import createSignalsmith from './vendor/signalsmith/wasm-factory.mjs';

// One processor after the shared mix keeps all five sources sample-aligned.
// BufferSource playbackRate supplies speed; reciprocal transposition keeps tone.
class StemToneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.factor = 1;
    this.active = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'dispose') { this.disposed = true; this.wasm = null; return; }
      // `transpose` sets the pitch factor directly: the playlist's live stretch of one clip.
      const transpose = Number(data.transpose), direct = Number.isFinite(transpose) && transpose > 0;
      const active = direct ? transpose !== 1 : !!data.keepTone && data.rate !== 1;
      this.factor = direct ? Math.max(1 / 16, Math.min(16, transpose)) : 1 / Math.max(.1, Math.min(3, Number(data.rate) || 1));
      if (active !== this.active || data.reset) this.wasm?._reset();
      this.active = active;
      this.wasm?._setTransposeFactor(this.factor, 8000 / sampleRate);
    };
    createSignalsmith().then(wasm => {
      if (this.disposed) return;
      wasm._main();
      wasm._configure(2, Math.round(sampleRate * .12), Math.round(sampleRate * .03), true);
      wasm._reset();
      this.pointer = wasm._setBuffers(2, 128);
      wasm._setTransposeFactor(this.factor, 8000 / sampleRate);
      this.wasm = wasm;
      this.port.postMessage({ type: 'ready', latency: (wasm._inputLatency() + wasm._outputLatency()) / sampleRate });
    }).catch(error => this.port.postMessage({ type: 'error', message: String(error) }));
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const input = inputs[0], output = outputs[0];
    if (!this.wasm || !this.active) {
      output.forEach((channel, index) => { if (input[index]) channel.set(input[index]); else channel.fill(0); });
      return true;
    }
    const wasm = this.wasm;
    for (let i = 0; i < 2; i++) {
      const channel = new Float32Array(wasm.HEAP8.buffer, this.pointer + i * 128 * 4, 128);
      if (input[i]) channel.set(input[i]); else channel.fill(0);
    }
    wasm._process(128, 128);
    output.forEach((channel, i) => channel.set(new Float32Array(wasm.HEAP8.buffer, this.pointer + (i + 2) * 128 * 4, 128)));
    return true;
  }
}
registerProcessor('scdl-stem-tone', StemToneProcessor);
