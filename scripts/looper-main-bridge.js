(() => {
  const INSTALLED_FLAG = "__scdlLooperMediaBridgeInstalled";
  const COMMAND_EVENT = "scdl-looper:command";
  const COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const RESPONSE_ATTRIBUTE = "data-scdl-looper-response";
  const SESSION_ATTRIBUTE = "data-scdl-loop-session";
  const SESSION_EVENT = "scdl-loop-session:changed";

  if (window[INSTALLED_FLAG] || !globalThis.SCLoopSession) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const knownMedia = new Set();
  const observedMedia = new WeakSet();
  let lastPlayingMedia = null;
  let loopMedia = null;
  let loopMediaSource = null;
  let loopFrameId = null;
  let globallyBypassed = false;
  let restoreLoopWhenUnbypassed = false;
  const loopSession = globalThis.SCLoopSession.create();
  let loopState = loopSession.snapshot();
  loopSession.subscribe((next) => { loopState = next; });

  function publicLoopState() {
    return { ...loopState };
  }

  function publishLoopState() {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute(SESSION_ATTRIBUTE, JSON.stringify(publicLoopState()));
    const event = typeof CustomEvent === "function"
      ? new CustomEvent(SESSION_EVENT, { bubbles: true })
      : { type: SESSION_EVENT };
    root.dispatchEvent(event);
  }

  function stopLoopFrame() {
    if (loopFrameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(loopFrameId);
    }
    loopFrameId = null;
  }

  function clearLoopState() {
    stopLoopFrame();
    loopMedia = null;
    loopMediaSource = null;
    restoreLoopWhenUnbypassed = false;
    loopSession.command({ type: "clear" });
    publishLoopState();
  }

  function loopFrame() {
    loopFrameId = null;
    if (!loopState.enabled || !loopMedia) return;
    if (
      mediaSource(loopMedia) !== loopMediaSource ||
      (lastPlayingMedia && lastPlayingMedia !== loopMedia && !lastPlayingMedia.paused)
    ) {
      clearLoopState();
      return;
    }
    enforceLoop(loopMedia);
    if (typeof requestAnimationFrame === "function") {
      loopFrameId = requestAnimationFrame(loopFrame);
    }
  }

  function enforceLoop(media) {
    if (!loopState.enabled || media !== loopMedia) return;
    const currentTimeMs = Number.isFinite(media.currentTime)
      ? media.currentTime * 1000
      : null;
    if (
      Number.isFinite(currentTimeMs) &&
      (currentTimeMs < loopState.startMs || currentTimeMs >= loopState.endMs)
    ) {
      media.currentTime = loopState.startMs / 1000;
    }
  }

  function startLoopFrame() {
    stopLoopFrame();
    if (loopState.enabled && typeof requestAnimationFrame === "function") {
      loopFrameId = requestAnimationFrame(loopFrame);
    }
  }

  function updateLoop(media, command) {
    const durationMs = mediaDurationMs(media);
    if (!Number.isFinite(durationMs)) return false;

    loopMedia = media;
    lastPlayingMedia = media;
    loopMediaSource = mediaSource(media);
    loopSession.command({
      type: "set-range",
      startMs: command.startMs,
      endMs: command.endMs,
      durationMs,
      trackIdentity: loopMediaSource,
      enabled: command.enabled !== false && !globallyBypassed,
      marker: command.marker,
    });
    if (globallyBypassed && command.enabled !== false && loopState.active) {
      restoreLoopWhenUnbypassed = true;
    }
    publishLoopState();
    if (loopState.enabled && command.startPlayback !== false) {
      media.currentTime = loopState.startMs / 1000;
      Promise.resolve(media.play?.()).catch(() => {});
    }
    startLoopFrame();
    return true;
  }

  function remember(media) {
    if (!(media instanceof HTMLMediaElement)) return media;
    if (
      loopMedia &&
      (media !== loopMedia || mediaSource(loopMedia) !== loopMediaSource) &&
      !media.paused
    ) {
      clearLoopState();
    }
    knownMedia.add(media);
    if (!observedMedia.has(media)) {
      observedMedia.add(media);
      media.addEventListener("playing", () => {
        if (
          loopMedia &&
          (media !== loopMedia || mediaSource(media) !== loopMediaSource)
        ) {
          clearLoopState();
        }
        lastPlayingMedia = media;
      });
      media.addEventListener("timeupdate", () => enforceLoop(media));
      media.addEventListener("seeking", () => enforceLoop(media));
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
    const connectedMedia = Array.from(document.querySelectorAll("audio, video"));
    for (const media of connectedMedia) {
      remember(media);
    }
    for (const media of knownMedia) {
      if (media.isConnected === false && media.paused) {
        knownMedia.delete(media);
      }
    }
    if (lastPlayingMedia?.isConnected === false && lastPlayingMedia.paused) {
      lastPlayingMedia = null;
    }

    const candidates = connectedMedia.length > 0
      ? connectedMedia
      : Array.from(knownMedia);
    return candidates
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
                source: mediaSource(media),
                loop: publicLoopState(),
              }
            : { available: false, loop: publicLoopState() },
        });
        return;
      }

      if (command.type === "set-loop" && media) {
        respond(root, {
          id: command.id,
          ok: updateLoop(media, command),
          loop: publicLoopState(),
        });
        return;
      }

      if (command.type === "set-loop-enabled" && loopMedia) {
        loopSession.command({
          type: "set-enabled",
          enabled: command.enabled && !globallyBypassed,
        });
        publishLoopState();
        if (loopState.enabled) {
          loopMedia.currentTime = loopState.startMs / 1000;
          Promise.resolve(loopMedia.play?.()).catch(() => {});
        }
        startLoopFrame();
        respond(root, { id: command.id, ok: true, loop: publicLoopState() });
        return;
      }

      if (command.type === "set-global-bypass") {
        globallyBypassed = Boolean(command.bypassed);
        if (globallyBypassed) {
          restoreLoopWhenUnbypassed = loopState.enabled || restoreLoopWhenUnbypassed;
          loopSession.command({ type: "set-enabled", enabled: false });
        } else {
          loopSession.command({
            type: "set-enabled",
            enabled: restoreLoopWhenUnbypassed,
          });
          restoreLoopWhenUnbypassed = false;
        }
        publishLoopState();
        if (loopState.enabled && loopMedia) {
          loopMedia.currentTime = loopState.startMs / 1000;
          Promise.resolve(loopMedia.play?.()).catch(() => {});
        }
        startLoopFrame();
        respond(root, { id: command.id, ok: true, loop: publicLoopState() });
        return;
      }

      if (command.type === "clear-loop") {
        clearLoopState();
        respond(root, { id: command.id, ok: true, loop: publicLoopState() });
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

  publishLoopState();
})();
