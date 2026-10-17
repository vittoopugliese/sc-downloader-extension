const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("./record-core.js");

(async () => {
  const blob = SCRecord.encodeWav([[new Float32Array([-2, 0, .5]), new Float32Array([2, -.5, 0])]], 3, 48000);
  const bytes = new DataView(await blob.arrayBuffer());
  assert.equal(bytes.byteLength, 56);
  assert.equal(bytes.getUint32(24, true), 48000);
  assert.equal(bytes.getUint16(22, true), 2);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => bytes.getInt16(44 + i * 2, true)), [-32768, 32767, 0, -16384, 16384, 0], "WAV must interleave stereo and clip only samples outside full scale");

  let Processor;
  const messages = [];
  vm.runInNewContext(fs.readFileSync(require.resolve("./record-processor.js"), "utf8"), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor(_name, Class) { Processor = Class; },
    Float32Array,
    sampleRate: 16, // A short simulated clock exercises the five-minute cap.
  });
  const processor = new Processor();
  const block = new Float32Array(128).fill(.25);
  const command = data => processor.port.onmessage({ data });
  processor.process([[block]]);
  assert.equal(messages.length, 0, "Monitoring alone must not accumulate a take");
  command("start");
  for (let i = 0; i < 17; i++) processor.process([[block]]);
  processor.process([[]]); // The time between notes belongs in the recording.
  command("stop");
  assert.deepEqual(messages.filter(m => m.channels).map(m => m.channels[0].length), [2048, 256], "Stop must flush the partial audio block");
  assert.equal(messages[1].channels[0][128], 0, "Disconnected input must produce silence");
  assert.equal(messages[0].channels[1][0], .25, "Mono must be duplicated to stereo");
  assert.equal(messages.at(-1).stopped, true, "Stop acknowledgement must follow all audio data");
  messages.length = 0;
  command("start"); processor.process([[block, new Float32Array(128).fill(-.5)]]); command("stop");
  assert.equal(messages[0].channels[0].length, 128, "A new take must not contain previous frames");
  assert.equal(messages[0].channels[1][0], -.5, "Stereo separation must be preserved");
  messages.length = 0;
  command("start");
  for (let i = 0; i < 50; i++) processor.process([[block]]);
  assert.equal(messages.filter(m => m.channels).reduce((sum, m) => sum + m.channels[0].length, 0), 300 * 16,
    "The worklet must bound capture even when the page cannot send a stop command");
  assert.equal(messages.at(-1).limitReached, true);
  const count = messages.length;
  command("stop");
  assert.equal(messages.length, count, "A late stop must not acknowledge an already completed take again");
  messages.length = 0;
  const short = new Processor({ processorOptions: { maxSeconds: 120 } });
  short.port.onmessage({ data: "start" });
  for (let i = 0; i < 20; i++) short.process([[block]]);
  assert.equal(messages.filter(m => m.channels).reduce((sum, m) => sum + m.channels[0].length, 0), 120 * 16,
    "processorOptions.maxSeconds must lower the capture limit (Likes Explorer uses two minutes)");
  assert.equal(messages.at(-1).limitReached, true);
  assert.equal(new Processor({ processorOptions: { maxSeconds: 9999 } }).maxSeconds, 300, "The limit can never exceed five minutes");
  console.log("Record PCM verification passed: stereo WAV, clipping, silence, partial-block flush, fresh takes and automatic limit.");
})().catch(error => { console.error(error); process.exitCode = 1; });
