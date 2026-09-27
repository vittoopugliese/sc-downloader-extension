/* Capture stereo PCM independently of the page's rendering/animation loop. */
class SCRecordProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data === "start") { this.reset(); this.frames = 0; this.recording = true; }
      if (data === "stop" && this.recording) {
        this.recording = false;
        this.flush();
        this.port.postMessage({ stopped: true });
      }
    };
  }
  reset() { this.channels = [new Float32Array(2048), new Float32Array(2048)]; this.offset = 0; }
  flush() {
    if (!this.offset) return;
    const channels = this.channels.map(channel => channel.slice(0, this.offset));
    this.port.postMessage({ channels }, channels.map(channel => channel.buffer));
    this.reset();
  }
  process(inputs) {
    if (this.recording) {
      const input = inputs[0];
      const length = input?.[0]?.length || 128;
      for (let i = 0; i < length; i++) {
        this.channels[0][this.offset] = input?.[0]?.[i] || 0;
        this.channels[1][this.offset++] = (input?.[1] || input?.[0])?.[i] || 0;
        if (this.offset === 2048) this.flush();
        // Enforce the budget on the audio thread, even if the page is busy.
        if (++this.frames >= sampleRate * 300) {
          this.recording = false;
          this.flush();
          this.port.postMessage({ stopped: true, limitReached: true });
          break;
        }
      }
    }
    // Outputs stay silent: the original post-EQ route handles monitoring.
    return true;
  }
}
registerProcessor("scdl-record", SCRecordProcessor);
