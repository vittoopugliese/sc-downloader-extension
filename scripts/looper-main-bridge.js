(() => {
  const INSTALLED_FLAG = "__scdlLooperMediaBridgeInstalled";
  const COMMAND_EVENT = "scdl-looper:command";
  const COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const RESPONSE_ATTRIBUTE = "data-scdl-looper-response";

  if (window[INSTALLED_FLAG]) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const knownMedia = new Set();
  const observedMedia = new WeakSet();
  let lastPlayingMedia = null;

  function remember(media) {
    if (!(media instanceof HTMLMediaElement)) return media;
    knownMedia.add(media);
    if (!observedMedia.has(media)) {
      observedMedia.add(media);
      media.addEventListener("playing", () => {
        lastPlayingMedia = media;
      });
    }
    if (!media.paused) lastPlayingMedia = media;
    return media;
  }

  const NativeAudio = window.Audio;
  if (typeof NativeAudio === "function") {
    function CapturedAudio(...args) {
      return remember(new NativeAudio(...args));
    }
    Object.setPrototypeOf(CapturedAudio, NativeAudio);
    CapturedAudio.prototype = NativeAudio.prototype;
    window.Audio = CapturedAudio;
  }

  const mediaPrototype = window.HTMLMediaElement?.prototype;
  if (mediaPrototype) {
    for (const methodName of ["play", "load"]) {
      const nativeMethod = mediaPrototype[methodName];
      if (typeof nativeMethod !== "function") continue;
      mediaPrototype[methodName] = function (...args) {
        remember(this);
        return nativeMethod.apply(this, args);
      };
    }
  }

  function mediaDurationMs(media) {
    return Number.isFinite(media?.duration) ? media.duration * 1000 : null;
  }

  function mediaSource(media) {
    return media?.currentSrc || media?.src || null;
  }

  function scoreMedia(media, expectedDurationMs) {
    let score = media === lastPlayingMedia ? 50 : 0;
    const durationMs = mediaDurationMs(media);
    if (durationMs !== null && Number.isFinite(expectedDurationMs)) {
      const difference = Math.abs(durationMs - expectedDurationMs);
      if (difference <= 1000) score += 100;
      else if (difference <= 3000) score += 30;
      else score -= 100;
    }
    if (!media.paused) score += 40;
    if (mediaSource(media)) score += 15;
    if (media.readyState >= 1) score += 10;
    if (media.currentTime > 0) score += 5;
    return score;
  }

  function findMedia(expectedDurationMs) {
    for (const media of document.querySelectorAll("audio, video")) {
      remember(media);
    }
    return Array.from(knownMedia)
      .map((media) => ({ media, score: scoreMedia(media, expectedDurationMs) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score)[0]?.media || null;
  }

  function respond(root, response) {
    root.setAttribute(RESPONSE_ATTRIBUTE, JSON.stringify(response));
  }

  document.addEventListener(
    COMMAND_EVENT,
    (event) => {
      const root = event.target;
      if (!(root instanceof Element)) return;

      let command;
      try {
        command = JSON.parse(root.getAttribute(COMMAND_ATTRIBUTE) || "null");
      } catch {
        return;
      }
      if (!command || typeof command.id !== "string") return;

      const media = findMedia(Number(command.expectedDurationMs));
      if (command.type === "state") {
        respond(root, {
          id: command.id,
          ok: true,
          state: media
            ? {
                available: true,
                durationMs: mediaDurationMs(media),
                currentTimeMs: Number.isFinite(media.currentTime)
                  ? media.currentTime * 1000
                  : null,
                paused: media.paused !== false,
              }
            : { available: false },
        });
        return;
      }

      if (
        command.type === "seek" &&
        media &&
        Number.isFinite(command.timeMs)
      ) {
        media.currentTime = Math.max(0, command.timeMs) / 1000;
        respond(root, { id: command.id, ok: true });
        return;
      }

      respond(root, { id: command.id, ok: false });
    },
    true
  );
})();
