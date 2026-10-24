(() => {
  const INSTALLED_FLAG = "__scdlLooperMediaBridgeInstalled";
  const COMMAND_EVENT = "scdl-looper:command";
  const COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const RESPONSE_ATTRIBUTE = "data-scdl-looper-response";
  const SESSION_ATTRIBUTE = "data-scdl-loop-session";
  const SESSION_EVENT = "scdl-loop-session:changed";
  const CHANNEL_NAME = "scdl-loop-session-v2";
  const SEEK_ROUNDING_TOLERANCE_MS = 1;
  if (window[INSTALLED_FLAG] || !globalThis.SCLoopSession) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });
  const knownMedia = new Set();
  const observedMedia = new WeakSet();
  const instanceId = `${Date.now()}:${Math.random()}`;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  const loopSession = globalThis.SCLoopSession.create();
  let loopState = loopSession.snapshot(); let loopMedia = null; let lastPlayingMedia = null; let loopFrameId = null; let trackIdentity = null; let generation = 0; let remoteOwner = null;
  loopSession.subscribe((next) => { loopState = next; });
  function mediaDurationMs(media) { return Number.isFinite(media?.duration) ? Math.round(media.duration * 1000) : null; }
  function mediaSource(media) { return media?.currentSrc || media?.src || null; }
  function playerTrackIdentity() {
    // Non-SoundCloud players (YouTube) name the track through their adapter.
    const platform = globalThis.SCPlayerToolsPlatform;
    if (platform) return platform.trackIdentity();
    const link = document.querySelector(".playbackSoundBadge__titleLink[href]") || document.querySelector("a.playbackSoundBadge__titleLink[href]");
    if (!link?.href) return null;
    try { const url = new URL(link.href, window.location.href); url.hash = ""; url.search = ""; return `permalink:${url.toString().replace(/\/$/, "")}`; } catch { return null; }
  }
  function reconcileTrack() {
    const nextIdentity = playerTrackIdentity();
    if (!nextIdentity || nextIdentity === trackIdentity) return;
    trackIdentity = nextIdentity; generation += 1; loopMedia = null;
    loopSession.command({ type: "set-track", trackIdentity, generation }); stopLoopFrame();
  }
  function publicLoopState() { return { ...loopState, trackIdentity, generation }; }
  function publishLoopState(broadcast = true) {
    const root = document.documentElement;
    if (root) { root.setAttribute(SESSION_ATTRIBUTE, JSON.stringify(publicLoopState())); root.dispatchEvent(typeof CustomEvent === "function" ? new CustomEvent(SESSION_EVENT, { bubbles: true }) : { type: SESSION_EVENT }); }
    if (broadcast && channel) channel.postMessage({ type: "state", sender: instanceId, owner: loopState.active ? instanceId : null, state: publicLoopState() });
  }
  function stopLoopFrame() { if (loopFrameId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(loopFrameId); loopFrameId = null; }
  function clearLoopState() { stopLoopFrame(); loopMedia = null; loopSession.command({ type: "clear" }); publishLoopState(); }
  function enforceLoop() {
    // Let asynchronous seeks finish before correcting again, including while
    // dragging A-B into audio that has not been buffered yet.
    if (!loopState.effectiveEnabled || !loopMedia || remoteOwner || loopMedia.seeking) return;
    const now = Number.isFinite(loopMedia.currentTime) ? loopMedia.currentTime * 1000 : null;
    if (Number.isFinite(now) && (now < loopState.startMs - SEEK_ROUNDING_TOLERANCE_MS || now >= loopState.endMs)) { try { loopMedia.currentTime = loopState.startMs / 1000; } catch { loopSession.command({ type: "set-error", error: "seek-failed" }); } }
  }
  function loopFrame() { loopFrameId = null; reconcileTrack(); enforceLoop(); if (loopState.effectiveEnabled && loopMedia && typeof requestAnimationFrame === "function") loopFrameId = requestAnimationFrame(loopFrame); }
  function startLoopFrame() { stopLoopFrame(); if (loopState.effectiveEnabled && loopMedia && !remoteOwner && typeof requestAnimationFrame === "function") loopFrameId = requestAnimationFrame(loopFrame); }
  function remember(media) {
    if (!(media instanceof HTMLMediaElement)) return media;
    knownMedia.add(media);
    if (!observedMedia.has(media)) {
      observedMedia.add(media);
      media.addEventListener("playing", () => { reconcileTrack(); if (loopState.active && trackIdentity === loopState.trackIdentity) loopMedia = media; lastPlayingMedia = media; startLoopFrame(); });
      media.addEventListener("timeupdate", enforceLoop); media.addEventListener("seeked", enforceLoop);
      media.addEventListener("loadedmetadata", () => { reconcileTrack(); if (media === loopMedia && loopState.active) publishLoopState(); });
      media.addEventListener("emptied", () => { if (media === loopMedia) publishLoopState(); });
    }
    if (!media.paused) lastPlayingMedia = media;
    return media;
  }
  const NativeAudio = window.Audio;
  if (typeof NativeAudio === "function") { function CapturedAudio(...args) { return remember(new NativeAudio(...args)); } Object.setPrototypeOf(CapturedAudio, NativeAudio); CapturedAudio.prototype = NativeAudio.prototype; window.Audio = CapturedAudio; }
  const mediaPrototype = window.HTMLMediaElement?.prototype;
  if (mediaPrototype) for (const methodName of ["play", "load"]) { const nativeMethod = mediaPrototype[methodName]; if (typeof nativeMethod === "function") mediaPrototype[methodName] = function (...args) { remember(this); return nativeMethod.apply(this, args); }; }
  function findMedia(expectedDurationMs) {
    reconcileTrack();
    if (loopMedia && knownMedia.has(loopMedia)) return loopMedia;
    const connected = Array.from(document.querySelectorAll("audio, video")).map(remember);
    // Detached history is a fallback until it becomes the selected loop owner.
    // An on-page player must still win normal discovery.
    const candidates = (connected.length ? connected : [...knownMedia]).filter((media) => mediaDurationMs(media) !== null);
    return candidates.sort((left, right) => { const score = (media) => (media === lastPlayingMedia ? 100 : 0) + (!media.paused ? 50 : 0) + (Number.isFinite(expectedDurationMs) && mediaDurationMs(media) === expectedDurationMs ? 10 : 0); return score(right) - score(left); })[0] || null;
  }
  function stale(command) { return Number.isInteger(command.expectedGeneration) && command.expectedGeneration !== generation; }
  function playback(media, response) {
    if (!loopState.effectiveEnabled || !media) return;
    try { media.currentTime = loopState.startMs / 1000; } catch { response.error = "seek-failed"; loopSession.command({ type: "set-error", error: response.error }); return; }
    Promise.resolve(media.play?.()).catch(() => { loopSession.command({ type: "set-error", error: "playback-failed" }); publishLoopState(); });
  }
  function updateLoop(media, command) {
    const durationMs = mediaDurationMs(media);
    if (!Number.isFinite(durationMs)) return { ok: false, error: "waiting-metadata" };
    if (!trackIdentity) return { ok: false, error: "waiting-track" };
    loopMedia = media;
    loopSession.command({ type: "set-range", startMs: command.startMs, endMs: command.endMs, durationMs, trackIdentity, generation, enabled: command.enabled });
    const result = { ok: loopState.active, loop: publicLoopState() };
    if (result.ok && command.startPlayback !== false) playback(media, result);
    publishLoopState(); startLoopFrame(); return { ...result, loop: publicLoopState() };
  }
  function respond(root, response) { root.setAttribute(RESPONSE_ATTRIBUTE, JSON.stringify(response)); }
  document.addEventListener(COMMAND_EVENT, (event) => {
    const root = event.target; if (!(root instanceof Element)) return;
    let command; try { command = JSON.parse(root.getAttribute(COMMAND_ATTRIBUTE) || "null"); } catch { return; }
    if (!command || typeof command.id !== "string") return;
    reconcileTrack();
    if (stale(command)) { respond(root, { id: command.id, ok: false, error: "stale-generation", state: { loop: publicLoopState() } }); return; }
    const media = findMedia(Number(command.expectedDurationMs));
    if (command.type === "state") { respond(root, { id: command.id, ok: true, state: media ? { available: true, durationMs: mediaDurationMs(media), currentTimeMs: Number.isFinite(media.currentTime) ? media.currentTime * 1000 : null, paused: media.paused !== false, source: mediaSource(media), loop: publicLoopState() } : { available: false, loop: publicLoopState(), error: "unavailable" } }); return; }
    if (command.type === "set-global-bypass") { loopSession.command({ type: "set-bypass", bypassed: Boolean(command.bypassed) }); publishLoopState(); startLoopFrame(); respond(root, { id: command.id, ok: true, loop: publicLoopState() }); return; }
    if (command.type === "clear-loop") { clearLoopState(); respond(root, { id: command.id, ok: true, loop: publicLoopState() }); return; }
    if (!media) { respond(root, { id: command.id, ok: false, error: "unavailable", loop: publicLoopState() }); return; }
    if (command.type === "set-loop") { respond(root, { id: command.id, ...updateLoop(media, command) }); return; }
    if (command.type === "set-loop-enabled") { if (!loopState.active) { respond(root, { id: command.id, ok: false, error: "invalid-range", loop: publicLoopState() }); return; } loopSession.command({ type: "set-enabled", enabled: command.enabled }); const response = { id: command.id, ok: true, loop: publicLoopState() }; if (loopState.effectiveEnabled) playback(loopMedia, response); publishLoopState(); startLoopFrame(); respond(root, { ...response, loop: publicLoopState() }); return; }
    if (command.type === "seek" && Number.isFinite(command.timeMs)) { try { media.currentTime = Math.max(0, command.timeMs) / 1000; respond(root, { id: command.id, ok: true }); } catch { respond(root, { id: command.id, ok: false, error: "seek-failed" }); } return; }
    respond(root, { id: command.id, ok: false, error: "unknown-command" });
  }, true);
  if (channel) { channel.onmessage = ({ data }) => { if (!data || data.sender === instanceId || data.type !== "state") return; if (data.state?.bypassed !== loopState.bypassed) loopSession.command({ type: "set-bypass", bypassed: data.state.bypassed }); remoteOwner = data.owner && data.owner !== instanceId ? data.owner : null; if (remoteOwner) stopLoopFrame(); publishLoopState(false); }; channel.postMessage({ type: "state", sender: instanceId, owner: null, state: publicLoopState() }); }
  reconcileTrack(); publishLoopState();
})();
