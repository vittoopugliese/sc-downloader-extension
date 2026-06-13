const SCMetadata = (() => {
  const ITUNES_TITLE = "\xa9nam";
  const ITUNES_ARTIST = "\xa9ART";
  const ITUNES_ALBUM = "\xa9alb";
  const ITUNES_GENRE = "\xa9gen";
  const ITUNES_YEAR = "\xa9day";

  function readUint32BE(bytes, offset) {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    );
  }

  function writeUint32BE(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function readAtomType(bytes, offset) {
    return String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
  }

  function writeAtomType(bytes, offset, type) {
    for (let index = 0; index < 4; index += 1) {
      bytes[offset + index] = type.charCodeAt(index);
    }
  }

  function concatChunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  }

  function toArrayBuffer(bytes) {
    if (bytes.buffer instanceof ArrayBuffer) {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    return bytes;
  }

  function encodeAtom(type, payload) {
    const atom = new Uint8Array(8 + payload.length);
    writeUint32BE(atom, 0, atom.length);
    writeAtomType(atom, 4, type);
    atom.set(payload, 8);
    return atom;
  }

  function buildDataAtom(valueBytes, typeIndicator) {
    const payload = new Uint8Array(8 + valueBytes.length);
    writeUint32BE(payload, 4, typeIndicator);
    payload.set(valueBytes, 8);
    return encodeAtom("data", payload);
  }

  function buildTextItem(fourcc, text) {
    if (!text) {
      return null;
    }

    const valueBytes = new TextEncoder().encode(String(text));
    const dataAtom = buildDataAtom(valueBytes, 1);
    return encodeAtom(fourcc, dataAtom);
  }

  function buildCoverItem(coverBytes) {
    if (!coverBytes?.length) {
      return null;
    }

    const isPng =
      coverBytes[0] === 0x89 &&
      coverBytes[1] === 0x50 &&
      coverBytes[2] === 0x4e &&
      coverBytes[3] === 0x47;
    const typeIndicator = isPng ? 14 : 13;
    const dataAtom = buildDataAtom(coverBytes, typeIndicator);
    return encodeAtom("covr", dataAtom);
  }

  function buildHdlrAtom() {
    const payload = new Uint8Array(25);
    writeAtomType(payload, 8, "mdir");
    return encodeAtom("hdlr", payload);
  }

  function buildIlstAtom(meta, coverBytes) {
    const items = [
      buildTextItem(ITUNES_TITLE, meta.title),
      buildTextItem(ITUNES_ARTIST, meta.artist),
      buildTextItem(ITUNES_ALBUM, meta.album),
      buildTextItem(ITUNES_GENRE, meta.genre),
      buildTextItem(ITUNES_YEAR, meta.year ? String(meta.year) : null),
      buildCoverItem(coverBytes),
    ].filter(Boolean);

    if (!items.length) {
      return null;
    }

    return encodeAtom("ilst", concatChunks(items));
  }

  function buildUdtaAtom(meta, coverBytes) {
    const ilstAtom = buildIlstAtom(meta, coverBytes);
    if (!ilstAtom) {
      return null;
    }

    const hdlrAtom = buildHdlrAtom();
    const metaPayload = concatChunks([
      new Uint8Array(4),
      hdlrAtom,
      ilstAtom,
    ]);
    const metaAtom = encodeAtom("meta", metaPayload);
    return encodeAtom("udta", metaAtom);
  }

  function findTopLevelAtom(bytes, type) {
    let offset = 0;

    while (offset + 8 <= bytes.length) {
      const size = readUint32BE(bytes, offset);
      if (size < 8) {
        break;
      }

      if (readAtomType(bytes, offset + 4) === type) {
        return { offset, size };
      }

      offset += size;
    }

    return null;
  }

  function findChildAtom(bytes, parentOffset, parentSize, type) {
    const parentEnd = parentOffset + parentSize;
    let offset = parentOffset + 8;

    while (offset + 8 <= parentEnd) {
      const size = readUint32BE(bytes, offset);
      if (size < 8) {
        break;
      }

      if (readAtomType(bytes, offset + 4) === type) {
        return { offset, size };
      }

      offset += size;
    }

    return null;
  }

  function insertUdtaInMoov(bytes, udtaBytes) {
    const moov = findTopLevelAtom(bytes, "moov");
    if (!moov) {
      return null;
    }

    const moovStart = moov.offset;
    const moovEnd = moov.offset + moov.size;
    const existingUdta = findChildAtom(bytes, moovStart, moov.size, "udta");

    if (existingUdta) {
      const before = bytes.slice(0, existingUdta.offset);
      const after = bytes.slice(existingUdta.offset + existingUdta.size);
      const result = concatChunks([before, udtaBytes, after]);
      writeUint32BE(
        result,
        moovStart,
        moov.size - existingUdta.size + udtaBytes.length
      );
      return result;
    }

    const beforeMoov = bytes.slice(0, moovStart);
    const moovBody = bytes.slice(moovStart, moovEnd);
    const afterMoov = bytes.slice(moovEnd);
    const result = new Uint8Array(bytes.length + udtaBytes.length);

    result.set(beforeMoov, 0);
    result.set(moovBody, moovStart);
    writeUint32BE(result, moovStart, moov.size + udtaBytes.length);
    result.set(udtaBytes, moovEnd);
    result.set(afterMoov, moovEnd + udtaBytes.length);
    return result;
  }

  function getId3Writer() {
    if (typeof ID3Writer !== "undefined") {
      return ID3Writer;
    }

    if (typeof globalThis !== "undefined" && globalThis.ID3Writer) {
      return globalThis.ID3Writer;
    }

    return null;
  }

  function embedMp3(bytes, meta, coverBuffer) {
    const Writer = getId3Writer();
    if (!Writer) {
      throw new Error("ID3Writer is not available.");
    }

    const sourceBuffer = toArrayBuffer(bytes);
    const writer = new Writer(sourceBuffer);

    if (meta.title) {
      writer.setFrame("TIT2", meta.title);
    }

    if (meta.artist) {
      writer.setFrame("TPE1", [meta.artist]);
    }

    if (meta.album) {
      writer.setFrame("TALB", meta.album);
    }

    if (meta.genre) {
      writer.setFrame("TCON", [meta.genre]);
    }

    if (meta.year) {
      writer.setFrame("TYER", Number(meta.year));
    }

    if (coverBuffer?.byteLength) {
      writer.setFrame("APIC", {
        type: 3,
        data: toArrayBuffer(coverBuffer),
        description: "Cover",
      });
    }

    writer.addTag();
    return new Uint8Array(writer.arrayBuffer);
  }

  function embedM4a(bytes, meta, coverBuffer) {
    const udtaAtom = buildUdtaAtom(meta, coverBuffer);
    if (!udtaAtom) {
      return bytes;
    }

    const tagged = insertUdtaInMoov(bytes, udtaAtom);
    return tagged || bytes;
  }

  function embedMetadata(bytes, extension, meta, coverBuffer) {
    try {
      const normalizedExtension = (extension || "").toLowerCase();

      if (normalizedExtension === "mp3") {
        return embedMp3(bytes, meta, coverBuffer);
      }

      if (normalizedExtension === "m4a" || normalizedExtension === "mp4") {
        return embedM4a(bytes, meta, coverBuffer);
      }

      return bytes;
    } catch (error) {
      console.warn("SC Downloader: metadata embedding failed", error);
      return bytes;
    }
  }

  return {
    embedMetadata,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.SCMetadata = SCMetadata;
}
