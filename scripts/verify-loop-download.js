const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let fetchCount = 0;
let decoderClosed = false;
const decodedAudio = {
  sampleRate: 4,
  numberOfChannels: 1,
  length: 8,
  getChannelData() {
    return new Float32Array([0, 0.25, 0.5, 0.75, 1, -1, -0.5, 0]);
  },
};

class FakeAudioContext {
  async decodeAudioData(input) {
    assert.equal(input.byteLength, 4);
    return decodedAudio;
  }

  async close() {
    decoderClosed = true;
  }
}

const context = vm.createContext({
  console,
  URL,
  Blob,
  ArrayBuffer,
  DataView,
  Uint8Array,
  Float32Array,
  AudioContext: FakeAudioContext,
  async fetch() {
    fetchCount += 1;
    return {
      ok: true,
      async arrayBuffer() {
        return new Uint8Array([0xff, 0xfb, 0, 0]).buffer;
      },
    };
  },
});

for (const fileName of ["format-utils.js", "download-core.js"]) {
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, fileName), "utf8"),
    context,
    { filename: fileName }
  );
}

const download = vm.runInContext("SCDownload", context);

(async () => {
  const progress = [];
  const result = await download.buildTrackBlob(
    "https://example.com/audio.mp3",
    {
      artist: "Artist",
      title: "Track",
      streamProtocol: "progressive",
      streamMimeType: "audio/mpeg",
    },
    (value) => progress.push(value),
    undefined,
    { startMs: 500, endMs: 1500 }
  );

  assert.equal(result.fileName, "Artist - Track (loop).wav");
  assert.equal(result.blob.type, "audio/wav");
  assert.equal(decoderClosed, true);
  assert.deepEqual(progress, [
    "Downloading file...",
    "Decoding audio...",
    "Cutting selected loop...",
  ]);

  const wav = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(wav.byteLength, 52);
  const samples = new DataView(wav.buffer);
  assert.equal(samples.getInt16(44, true), 16383);
  assert.equal(samples.getInt16(46, true), 24575);
  assert.equal(samples.getInt16(48, true), 32767);
  assert.equal(samples.getInt16(50, true), -32768);

  await assert.rejects(
    download.buildTrackBlob(
      "https://example.com/audio.mp3",
      { streamProtocol: "progressive" },
      undefined,
      undefined,
      { startMs: 2000, endMs: 1000 }
    ),
    /selected loop range is invalid/
  );
  assert.equal(fetchCount, 1, "Invalid ranges must fail before downloading audio");

  const looperSource = fs.readFileSync(
    path.resolve(__dirname, "looper.js"),
    "utf8"
  );
  assert.match(looperSource, /Descargar loop/);
  assert.match(looperSource, /type: "DOWNLOAD_LOOP"/);

  console.log("Loop download verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
