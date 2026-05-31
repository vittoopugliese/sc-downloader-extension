const SCFormat = (() => {
  function getFileExtension(trackData) {
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

    return "application/octet-stream";
  }

  return {
    getFileExtension,
    getBlobType,
  };
})();
