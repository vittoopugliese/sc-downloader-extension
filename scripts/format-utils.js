const SCFormat = (() => {
  const EXTENSION_BY_MIME = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/aiff": "aiff",
    "audio/x-aiff": "aiff",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
  };

  function getExtensionFromUrl(url) {
    if (!url) {
      return null;
    }

    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.(wav|aiff|aif|flac|mp3|m4a|ogg)$/);

      if (!match) {
        return null;
      }

      if (match[1] === "aif") {
        return "aiff";
      }

      return match[1];
    } catch {
      return null;
    }
  }

  function getExtensionFromMimeType(mimeType) {
    if (!mimeType) {
      return null;
    }

    const normalized = mimeType.split(";")[0].trim().toLowerCase();
    return EXTENSION_BY_MIME[normalized] || null;
  }

  function getFileExtension(trackData) {
    if (trackData.isOriginalDownload) {
      return (
        getExtensionFromUrl(trackData.originalDownloadUrl) ||
        getExtensionFromMimeType(trackData.originalMimeType) ||
        "mp3"
      );
    }

    const preset = trackData.streamPreset || "";
    const mimeType = trackData.streamMimeType || "";

    if (trackData.streamProtocol === "progressive") {
      return "mp3";
    }

    if (preset.startsWith("mp3") || mimeType.includes("audio/mpeg")) {
      return "mp3";
    }

    if (preset.includes("opus") || mimeType.includes("opus")) {
      return "ogg";
    }

    if (preset.startsWith("aac") || mimeType.includes("mp4")) {
      return "m4a";
    }

    return "audio";
  }

  function getBlobType(trackData) {
    if (!trackData.isOriginalDownload) {
      return "application/octet-stream";
    }

    const extension = getFileExtension(trackData);

    if (extension === "mp3") {
      return "audio/mpeg";
    }

    if (extension === "ogg") {
      return "audio/ogg";
    }

    if (extension === "m4a") {
      return "audio/mp4";
    }

    if (extension === "wav") {
      return "audio/wav";
    }

    if (extension === "aiff") {
      return "audio/aiff";
    }

    if (extension === "flac") {
      return "audio/flac";
    }

    return "application/octet-stream";
  }

  function readAscii(bytes, offset, length) {
    let value = "";
    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(bytes[offset + index] || 0);
    }
    return value;
  }

  function detectContainerFromBytes(bytes) {
    if (!bytes || bytes.length < 4) {
      return null;
    }

    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return "mp3";
    }

    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
      return "mp3";
    }

    if (bytes.length >= 8 && readAscii(bytes, 4, 4) === "ftyp") {
      return "m4a";
    }

    if (bytes.length >= 8 && readAscii(bytes, 0, 4) === "fLaC") {
      return "flac";
    }

    if (
      bytes.length >= 12 &&
      readAscii(bytes, 0, 4) === "RIFF" &&
      readAscii(bytes, 8, 4) === "WAVE"
    ) {
      return "wav";
    }

    if (bytes.length >= 8 && readAscii(bytes, 0, 4) === "FORM") {
      return "aiff";
    }

    if (bytes.length >= 4 && readAscii(bytes, 0, 4) === "OggS") {
      return "ogg";
    }

    return null;
  }

  return {
    getExtensionFromUrl,
    getExtensionFromMimeType,
    getFileExtension,
    getBlobType,
    detectContainerFromBytes,
  };
})();
