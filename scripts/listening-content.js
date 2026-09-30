(() => {
  "use strict";
  if (window.top !== window) return;
  const artworkSelector = ".playbackSoundBadge__avatar";
  const selectors = { play: ".playControl", previous: ".skipControl__previous", next: ".skipControl__next" };
  let cinema = null;
  let view = null;
  let timer = null;
  let previousFocus = null;
  const native = (selector) => document.querySelector(`.playControls ${selector}`);
  const enabled = (button) => !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !button.classList.contains("m-disabled");
  const readTime = (selector) => {
    const element = native(selector);
    const value = element?.querySelector('[aria-hidden="true"]')?.textContent || element?.textContent || "";
    const match = value.match(/\d+:\d+(?::\d+)?/);
    return match ? match[0].split(":").reduce((total, part) => total * 60 + Number(part), 0) : 0;
  };
  function state() {
    const title = native(".playbackSoundBadge__titleLink");
    if (!title) return null;
    const cover = native(artworkSelector);
    const image = cover?.querySelector("img");
    const background = cover?.querySelector('[style*="background-image"]') || cover;
    const source = image?.src || (background && getComputedStyle(background).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]);
    let artwork = "";
    try { const url = new URL(source); if (url.protocol === "https:" && (url.hostname === "sndcdn.com" || url.hostname.endsWith(".sndcdn.com"))) artwork = url.href.replace(/-t\d+x\d+(?=\.)/, "-t500x500"); } catch {}
    return {
      title: title.getAttribute("title") || title.textContent.trim(),
      artist: native(".playbackSoundBadge__lightLink")?.textContent.trim() || "",
      artwork,
      playing: native(selectors.play)?.classList.contains("playing") || native(selectors.play)?.getAttribute("aria-label") === "Pause",
      elapsed: readTime(".playbackTimeline__timePassed"), duration: readTime(".playbackTimeline__duration"),
      controls: Object.fromEntries(Object.entries(selectors).map(([action, selector]) => [action, enabled(native(selector))])),
    };
  }
  function close() {
    if (!cinema) return;
    clearInterval(timer);
    cinema.remove();
    cinema = view = timer = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function open() {
    const current = state();
    if (!current) return false;
    if (cinema) return true;
    previousFocus = document.activeElement;
    cinema = document.createElement("dialog");
    cinema.id = "scdl-cinema";
    cinema.setAttribute("aria-label", globalThis.SCDLI18n.t("listening_cinema"));
    cinema.style.cssText = "position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;background:#0a0a0f;overflow:hidden;color:white";
    const surface = document.createElement("div");
    cinema.appendChild(surface);
    view = globalThis.SCDLListeningView(surface, { cinema: true, command });
    cinema.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    cinema.addEventListener("keydown", (event) => {
      if (event.code === "Space" && event.composedPath()[0]?.tagName !== "BUTTON") { event.preventDefault(); command("play"); }
      event.stopPropagation();
    });
    document.body.appendChild(cinema);
    view.update(current);
    cinema.showModal();
    view.root.querySelector(".close").focus();
    timer = setInterval(() => { const current = state(); if (current) view.update(current); else close(); }, 400);
    return true;
  }
  function command(action) {
    if (action === "cinema") return open();
    if (action === "close") { close(); return true; }
    const button = Object.hasOwn(selectors, action) && native(selectors[action]);
    if (!enabled(button)) return false;
    button.click();
    return true;
  }
  const hint = document.createElement("style");
  hint.textContent = `.playControls ${artworkSelector}{position:relative;cursor:zoom-in}.playControls ${artworkSelector}::after{content:attr(data-scdl-cinema-hint);position:absolute;inset:0;background:#000b;color:white;display:grid;place-items:center;text-align:center;font:10px/1.1 system-ui;padding:2px;opacity:0;pointer-events:none}.playControls ${artworkSelector}:hover::after,.playControls ${artworkSelector}:focus-visible::after{opacity:1}`;
  document.head.appendChild(hint);
  // Delegation survives SoundCloud's SPA replacing the bottom player.
  function markCover(event) {
    const cover = event.target.closest?.(`.playControls ${artworkSelector}`);
    if (cover) cover.setAttribute("data-scdl-cinema-hint", globalThis.SCDLI18n.t("listening_open"));
  }
  document.addEventListener("pointerover", markCover);
  document.addEventListener("focusin", markCover);
  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!event.target.closest?.(`.playControls ${artworkSelector}`) || !open()) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "SCDL_LISTENING_STATE") { respond({ state: state() }); return false; }
    if (message.type === "SCDL_LISTENING_COMMAND") { respond({ success: command(message.action) }); return false; }
  });
  window.addEventListener("pagehide", close);
})();
