/* YouTube adapter for the Player Tools panel (MAIN world, loaded before the
 * looper bridge and tempo-control-main.js). SoundCloud pages have no adapter
 * and keep their built-in behaviour. */
(() => {
  "use strict";
  if (location.hostname !== "www.youtube.com" || globalThis.SCPlayerToolsPlatform) return;

  const MOUNT_SELECTOR = "ytd-watch-metadata #menu > ytd-menu-renderer";

  function videoId() {
    if (location.pathname !== "/watch") return null;
    const id = new URLSearchParams(location.search).get("v");
    return /^[A-Za-z0-9_-]{6,20}$/.test(id || "") ? id : null;
  }

  function player() {
    return document.getElementById("movie_player");
  }

  function isMedia(element) {
    return typeof HTMLVideoElement === "function" && element instanceof HTMLVideoElement &&
      Boolean(element.closest?.("#movie_player, .html5-video-player"));
  }

  function media() {
    const element = player()?.querySelector("video");
    return isMedia(element) ? element : null;
  }

  // Ads play through the same <video>; their duration must not reshape the track.
  function isAdPlaying() {
    return player()?.classList.contains("ad-showing") === true;
  }

  function trackIdentity() {
    const id = videoId();
    return id ? `youtube:${id}` : null;
  }

  function trackInfo() {
    const id = videoId();
    if (!id) return null;
    const metadata = document.querySelector("ytd-watch-metadata");
    const title = metadata?.querySelector("#title h1")?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/, "").trim() || "YouTube video";
    const channel = metadata?.querySelector("ytd-channel-name a, #owner #channel-name a")?.textContent?.trim() || "";
    return {
      title,
      artist: channel,
      artworkUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  // The trigger sits left of the like button. YouTube hides unknown children of
  // its own button row when it re-renders, so it goes beside that row instead.
  function mount(host) {
    const row = videoId() ? document.querySelector(MOUNT_SELECTOR) : null;
    if (!row) return false;
    if (host.parentElement !== row || row.firstElementChild !== host) row.prepend(host);
    host.style.height = "36px";
    host.style.marginLeft = "0";
    host.style.marginRight = "8px";
    return true;
  }

  // YouTube's speed menu and its < > shortcuts set the <video> rate, which the
  // Player Tools guard overrides. Its own rate event reports the user's choice.
  const rateListeners = new Set();
  let ratePlayer = null;
  function watchRate() {
    const current = player();
    if (!current || current === ratePlayer || typeof current.addEventListener !== "function") return;
    ratePlayer = current;
    current.addEventListener("onPlaybackRateChange", (rate) => {
      if (Number.isFinite(rate)) rateListeners.forEach((listener) => listener(rate));
    });
  }
  function onRateChange(listener) {
    rateListeners.add(listener);
    watchRate();
  }

  // Mirrors a Player Tools speed into YouTube's menu; false until the player
  // API exists. YouTube keeps 0.25–2x: outside that range its menu is left
  // alone instead of clamping our speed.
  function setPlayerRate(rate) {
    watchRate();
    const current = player();
    if (!current?.setPlaybackRate) return false;
    if (rate >= 0.25 && rate <= 2 && Math.abs((current.getPlaybackRate?.() ?? 1) - rate) > 0.001) current.setPlaybackRate(rate);
    return true;
  }

  globalThis.SCPlayerToolsPlatform = Object.freeze({
    onRateChange,
    setPlayerRate,
    id: "youtube",
    videoId,
    trackIdentity,
    trackInfo,
    isMedia,
    media,
    isAdPlaying,
    mount,
  });
})();
