const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "loop-audio-renderer.js"),
  "utf8"
);
const context = vm.createContext({
  console,
  Float32Array,
  Number,
  Math,
  Object,
  Promise,
  RangeError,
  TypeError,
  Error,
  setTimeout,
});
vm.runInContext(source, context, { filename: "loop-audio-renderer.js" });
const rendererModule = context.SCLoopAudioRenderer;

function audioBuffer(samples, sampleRate = 8000) {
  const channels = samples.map((values) => new Float32Array(values));
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    getChannelData(index) {
      return channels[index];
    },
  };
}

function fakeFactory(record) {
  return async () => {
    const memory = new ArrayBuffer(1024 * 1024);
    const heap = new Int8Array(memory);
    const history = 384;
    return {
      HEAP8: heap,
      _main() {
        record.main += 1;
      },
      _configure(...args) {
        record.configure = args;
      },
      _reset() {},
      _inputLatency: () => 256,
      _outputLatency: () => 128,
      _setBuffers(channels, frames) {
        assert.equal(channels, 2);
        assert.equal(frames, history);
        return 0;
      },
      _setTransposeFactor(...args) {
        record.transpose = args;
      },
      _setFormantSemitones() {},
      _setFormantBase() {},
      _seek(frames, rate) {
        record.seek = [frames, rate];
      },
      _process(inputFrames, outputFrames) {
        record.process.push([inputFrames, outputFrames]);
        for (let channel = 0; channel < 2; channel += 1) {
          new Float32Array(
            memory,
            (channel + 2) * history * 4,
            outputFrames
          ).fill(channel === 0 ? 0.25 : -0.25);
        }
      },
    };
  };
}

(async () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(rendererModule.normalizeTransform({
      rate: 0.12,
      preservePitch: true,
    }))),
    { rate: 0.12, preservePitch: true }
  );
  assert.equal(rendererModule.normalizeTransform({ rate: 8 }).rate, 4);
  assert.equal(rendererModule.normalizeTransform({ rate: "nope" }).rate, 1);

  const sourceBuffer = audioBuffer([
    Array.from({ length: 800 }, (_, index) => index / 800),
  ]);
  const copied = await rendererModule.render(
    sourceBuffer,
    { startMs: 25, endMs: 75 },
    { rate: 1, preservePitch: true }
  );
  assert.equal(copied.length, 400);
  assert.equal(copied.numberOfChannels, 1);
  assert.equal(copied.getChannelData(0)[0], sourceBuffer.getChannelData(0)[200]);

  const natural = await rendererModule.render(
    sourceBuffer,
    { startMs: 0, endMs: 100 },
    { rate: 2, preservePitch: false }
  );
  assert.equal(natural.length, 400);
  assert.equal(natural.getChannelData(0)[1], sourceBuffer.getChannelData(0)[2]);

  const record = { main: 0, configure: null, transpose: null, seek: null, process: [] };
  const preservedRenderer = rendererModule.create({
    loadFactory: async () => fakeFactory(record),
  });
  const progress = [];
  const preserved = await preservedRenderer.render(
    sourceBuffer,
    { startMs: 0, endMs: 100 },
    { rate: 0.5, preservePitch: true },
    { onProgress: (value) => progress.push(value) }
  );
  assert.equal(preserved.length, 1600);
  assert.equal(record.main, 1);
  assert.deepEqual(record.configure, [2, 960, 240, true]);
  assert.equal(record.seek[0], 384);
  assert.ok(Math.abs(record.seek[1] - 0.5) < 1e-6);
  assert.ok(record.process.length > 1);
  assert.equal(preserved.getChannelData(0)[0], 0.25);
  assert.match(progress.join("\n"), /Loading pitch-preservation engine/);
  assert.match(progress.join("\n"), /Rendering preserved pitch 100%/);

  const sourceVendor = fs.readFileSync(
    path.resolve(
      __dirname,
      "../repos/soundcloud-tempo-control-main/vendor/signalsmith/wasm-factory.mjs"
    )
  );
  const packagedVendor = fs.readFileSync(
    path.resolve(__dirname, "vendor/signalsmith/wasm-factory.mjs")
  );
  const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
  assert.equal(sha256(packagedVendor), sha256(sourceVendor));
  assert.equal(
    sha256(packagedVendor),
    "14c2c5858daff55746fb6c61dee3a67a9fc5ba5edf57ce715559297c041d3d89"
  );

  const { default: createSignalsmith } = await import(
    pathToFileURL(
      path.resolve(__dirname, "vendor/signalsmith/wasm-factory.mjs")
    ).href
  );
  const actualRenderer = rendererModule.create({
    loadFactory: async () => createSignalsmith,
  });
  const sine = audioBuffer([
    Array.from(
      { length: 8000 },
      (_, index) => 0.2 * Math.sin((2 * Math.PI * 440 * index) / 8000)
    ),
  ]);
  const actualPreserved = await actualRenderer.render(
    sine,
    { startMs: 0, endMs: 1000 },
    { rate: 0.5, preservePitch: true }
  );
  assert.equal(actualPreserved.length, 16000);
  assert.ok(actualPreserved.getChannelData(0).every(Number.isFinite));
  assert.ok(
    actualPreserved.getChannelData(0).some((sample) => Math.abs(sample) > 0.001),
    "The pinned Signalsmith renderer produced only silence."
  );
  const pitchWindow = actualPreserved.getChannelData(0).subarray(4000, 12000);
  const crossings = [];
  for (let index = 1; index < pitchWindow.length; index += 1) {
    if (pitchWindow[index - 1] <= 0 && pitchWindow[index] > 0) {
      crossings.push(index);
    }
  }
  const measuredPitch =
    ((crossings.length - 1) * 8000) /
    (crossings[crossings.length - 1] - crossings[0]);
  assert.ok(
    Math.abs(measuredPitch - 440) < 15,
    `Preserved output drifted to ${measuredPitch.toFixed(2)} Hz.`
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8")
  );
  assert.match(
    manifest.content_security_policy.extension_pages,
    /wasm-unsafe-eval/
  );
  const offscreen = fs.readFileSync(
    path.resolve(__dirname, "../offscreen.html"),
    "utf8"
  );
  assert.match(offscreen, /scripts\/loop-audio-renderer\.js/);

  console.log("Pitched loop renderer verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
