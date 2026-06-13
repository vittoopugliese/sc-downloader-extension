const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createContext() {
  const context = {
    console,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    Blob,
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => {},
    },
    globalThis: {},
  };
  context.self = context.globalThis;
  return context;
}

function loadScript(context, relativePath) {
  const filePath = path.join(__dirname, "..", relativePath);
  const code = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(code, context, { filename: filePath });
}

function createFakeMp3Body() {
  const body = new Uint8Array(128);
  body[0] = 0xff;
  body[1] = 0xfb;
  return body;
}

function createFakeM4aInitSegment() {
  const ftypPayload = new Uint8Array(8);
  ftypPayload.set([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1], 0);
  const ftyp = new Uint8Array(16);
  ftyp[3] = 16;
  ftyp.set([0x66, 0x74, 0x79, 0x70], 4);
  ftyp.set(ftypPayload, 8);

  const moov = new Uint8Array(8);
  moov[3] = 8;
  moov.set([0x6d, 0x6f, 0x6f, 0x76], 4);

  const combined = new Uint8Array(ftyp.length + moov.length);
  combined.set(ftyp, 0);
  combined.set(moov, ftyp.length);
  return combined;
}

function createFakeJpeg() {
  const jpeg = new Uint8Array(16);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  return jpeg;
}

function hasId3Header(bytes) {
  return bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
}

function findAtom(bytes, type) {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const atomType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (atomType === type) {
      return { offset, size };
    }
    if (size < 8) {
      break;
    }
    offset += size;
  }
  return null;
}

function findChildAtom(bytes, parentOffset, parentSize, type) {
  const parentEnd = parentOffset + parentSize;
  let offset = parentOffset + 8;

  while (offset + 8 <= parentEnd) {
    const size =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const atomType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

    if (atomType === type) {
      return { offset, size };
    }

    if (size < 8) {
      break;
    }

    offset += size;
  }

  return null;
}

function runTests() {
  const context = createContext();
  loadScript(context, "scripts/vendor/id3-writer.js");
  loadScript(context, "scripts/metadata.js");

  const SCMetadata = context.globalThis.SCMetadata;
  if (!SCMetadata) {
    throw new Error("SCMetadata was not loaded.");
  }
  const cover = createFakeJpeg();
  const meta = {
    title: "Test Track",
    artist: "Test Artist",
    album: "Test Album",
    genre: "Electronic",
    year: 2024,
  };

  const mp3Input = createFakeMp3Body();
  const mp3Tagged = SCMetadata.embedMetadata(mp3Input, "mp3", meta, cover);
  if (!hasId3Header(mp3Tagged)) {
    throw new Error("MP3 tagging failed: missing ID3 header.");
  }

  const m4aInput = createFakeM4aInitSegment();
  const m4aTagged = SCMetadata.embedMetadata(m4aInput, "m4a", meta, cover);
  const moov = findAtom(m4aTagged, "moov");
  const udta = moov
    ? findChildAtom(m4aTagged, moov.offset, moov.size, "udta")
    : null;

  if (!moov || !udta) {
    throw new Error("M4A tagging failed: missing moov/udta atoms.");
  }

  if (m4aTagged.length <= m4aInput.length) {
    throw new Error("M4A tagging failed: output size did not grow.");
  }

  const opusInput = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
  const opusTagged = SCMetadata.embedMetadata(opusInput, "ogg", meta, cover);
  if (opusTagged.length !== opusInput.length) {
    throw new Error("Unsupported format should remain unchanged.");
  }

  console.log("Metadata verification passed.");
}

runTests();
