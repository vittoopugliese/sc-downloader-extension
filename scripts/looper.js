const SCLooper = (() => {
  const BUTTON_ATTRIBUTE = "data-scdl-looper";
  const DOWNLOAD_ATTRIBUTE = "data-scdl-loop-download";
  const OVERLAY_ATTRIBUTE = "data-scdl-loop-overlay";
  const STATUS_ATTRIBUTE = "data-scdl-looper-debug";
  const STYLES_ID = "scdl-looper-styles";
  const MEDIA_BRIDGE_EVENT = "scdl-looper:command";
  const MEDIA_BRIDGE_COMMAND_ATTRIBUTE = "data-scdl-looper-command";
  const MEDIA_BRIDGE_RESPONSE_ATTRIBUTE = "data-scdl-looper-response";
  const SEEK_RETRY_MS = 250;
  const STICKY_MEDIA_BRIDGE_SCORE = 30;
  const MEDIA_EVENTS = [
    "playing",
    "seeking",
    "seeked",
    "loadedmetadata",
    "durationchange",
    "emptied",
    "timeupdate",
  ];

  let view = null;
  let range = null;
  let player = null;
  let frameId = null;
  let initialUrl = null;
  let initialTrackIdentity = null;
  let lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
  let discoveryObserver = null;
  let contextInterval = null;
  let ensureTimeout = null;
  let resizeObserver = null;
  let started = false;
  let lastDebugStatus = null;
  let mediaBridgeRequestId = 0;
  let isLoopDownloading = false;
  let downloadResetTimeout = null;
  let selectionDrag = null;

  function setDebugStatus(status) {
    if (status === lastDebugStatus) return;
    lastDebugStatus = status;
    document.documentElement?.setAttribute(STATUS_ATTRIBUTE, status);
    console.debug(`[DEBUG-SCDL-LOOPER] ${status}`);
  }

  function normalizeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.origin);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  function normalizeLabel(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function isMoreActionsButton(button) {
    if (button?.getAttribute("aria-haspopup") !== "true") return false;
    const label = normalizeLabel(
      button.getAttribute("aria-label") || button.getAttribute("title")
    );
    return (
      label === "more actions" ||
      label === "mas acciones" ||
      label.endsWith(" acciones")
    );
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isTrackPage() {
    if (window.SCDL?.isTrackPage?.() === true) return true;

    const parts = window.location.pathname.split("/").filter(Boolean);
    const reserved = new Set([
      "discover",
      "search",
      "stream",
      "upload",
      "feed",
      "you",
      "sets",
      "likes",
      "albums",
      "tracks",
      "reposts",
      "comments",
      "stations",
      "charts",
    ]);
    return (
      parts.length >= 2 &&
      parts.length <= 3 &&
      !parts.some((part) => reserved.has(part.toLowerCase()))
    );
  }

  function readWaveformDuration(waveform) {
    const durationMs = Number(waveform?.getAttribute("aria-valuemax"));
    return Number.isFinite(durationMs) && durationMs >= SCLooperCore.MIN_RANGE_MS
      ? durationMs
      : null;
  }

  function findMoreActionsWithin(container) {
    return Array.from(
      container?.querySelectorAll?.('button[aria-haspopup="true"]') || []
    ).find(isMoreActionsButton) || null;
  }

  function findTrackRoot(waveform) {
    let candidate = waveform.parentElement;
    while (candidate && candidate !== document.body) {
      const menuButton = findMoreActionsWithin(candidate);
      const visibleWaveforms = Array.from(
        candidate.querySelectorAll('[role="slider"][aria-label="Waveform"]')
      ).filter(isVisible);
      if (
        menuButton &&
        candidate.querySelector("h1") &&
        visibleWaveforms.length === 1 &&
        visibleWaveforms[0] === waveform
      ) {
        return { root: candidate, menuButton };
      }
      candidate = candidate.parentElement;
    }
    return null;
  }

  function findWaveformWrapper(waveform) {
    const parent = waveform.parentElement;
    if (!parent) return waveform;
    const parentRect = parent.getBoundingClientRect();
    const waveformRect = waveform.getBoundingClientRect();
    return Math.abs(parentRect.width - waveformRect.width) <= 2 &&
      Math.abs(parentRect.height - waveformRect.height) <= 2
      ? parent
      : waveform;
  }

  function discoverTarget() {
    const waveforms = Array.from(
      document.querySelectorAll('[role="slider"][aria-label="Waveform"]')
    ).filter(
      (waveform) => readWaveformDuration(waveform) !== null && isVisible(waveform)
    );

    for (const waveform of waveforms) {
      const track = findTrackRoot(waveform);
      if (track) {
        return {
          ...track,
          waveform,
          wrapper: findWaveformWrapper(waveform),
          durationMs: readWaveformDuration(waveform),
        };
      }
    }

    return null;
  }

  function mediaDurationMs(media) {
    return Number.isFinite(media?.duration) ? media.duration * 1000 : null;
  }

  function mediaSource(media) {
    return media?.currentSrc || media?.src || null;
  }

  function accessibleDocuments() {
    const documents = [];
    const seenDocuments = new Set();
    const seenWindows = new Set();

    function visit(targetWindow) {
      if (!targetWindow || seenWindows.has(targetWindow)) return;
      seenWindows.add(targetWindow);

      try {
        const targetDocument = targetWindow.document;
        if (targetDocument && !seenDocuments.has(targetDocument)) {
          seenDocuments.add(targetDocument);
          documents.push(targetDocument);
        }
      } catch {
        return;
      }

      try {
        for (let index = 0; index < targetWindow.frames.length; index += 1) {
          visit(targetWindow.frames[index]);
        }
      } catch {
        // Cross-origin child frames are intentionally ignored.
      }
    }

    visit(window);
    try {
      visit(window.top);
    } catch {
      // The current document remains usable when the top frame is cross-origin.
    }
    return documents;
  }

  function scoreMedia(media, expectedDurationMs) {
    if (!media?.isConnected) return -Infinity;
    let score = 0;
    const durationMs = mediaDurationMs(media);
    if (durationMs !== null) {
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
    const candidates = accessibleDocuments().flatMap((targetDocument) =>
      Array.from(targetDocument.querySelectorAll("audio, video"))
    );
    return candidates
      .map((media) => ({ media, score: scoreMedia(media, expectedDurationMs) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score)[0]?.media || null;
  }

  function currentPlayerPermalink() {
    for (const targetDocument of accessibleDocuments()) {
      const link = targetDocument.querySelector(
        ".playControls__soundBadge .playbackSoundBadge__titleLink"
      );
      const permalink = normalizeUrl(link?.href);
      if (permalink) return permalink;
    }
    return null;
  }

  function currentPagePermalink() {
    return normalizeUrl(
      window.SCDL?.getTrackData?.()?.permalink || window.location.href
    );
  }

  function requestMediaBridge(targetDocument, type, payload = {}) {
    const root = targetDocument?.documentElement;
    if (!root?.dispatchEvent) return null;

    const id = `${Date.now()}-${mediaBridgeRequestId += 1}`;
    const command = JSON.stringify({ id, type, ...payload });

    try {
      root.removeAttribute(MEDIA_BRIDGE_RESPONSE_ATTRIBUTE);
      root.setAttribute(MEDIA_BRIDGE_COMMAND_ATTRIBUTE, command);
      root.dispatchEvent(new Event(MEDIA_BRIDGE_EVENT, { bubbles: true }));

      const serializedResponse = root.getAttribute(
        MEDIA_BRIDGE_RESPONSE_ATTRIBUTE
      );
      if (!serializedResponse) return null;
      const response = JSON.parse(serializedResponse);
      return response?.id === id ? response : null;
    } catch {
      return null;
    } finally {
      root.removeAttribute(MEDIA_BRIDGE_COMMAND_ATTRIBUTE);
      root.removeAttribute(MEDIA_BRIDGE_RESPONSE_ATTRIBUTE);
    }
  }

  function queryMediaBridge(targetDocument, expectedDurationMs) {
    const response = requestMediaBridge(targetDocument, "state", {
      expectedDurationMs,
    });
    return response?.ok && response.state?.available
      ? response.state
      : null;
  }

  function scoreMediaBridgeState(state, expectedDurationMs) {
    if (!state?.available) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (Number.isFinite(state.durationMs)) {
      const difference = Math.abs(state.durationMs - expectedDurationMs);
      if (difference <= 1000) score += 100;
      else if (difference <= 3000) score += 30;
      else score -= 100;
    }
    if (state.paused === false) score += 50;
    else score -= 10;
    if (Number.isFinite(state.currentTimeMs)) score += 5;
    return score;
  }

  function createNativeMediaAdapter(expectedDurationMs) {
    let media = null;
    let bridgeDocument = null;
    let listeners = new Set();

    function notify(event) {
      for (const listener of listeners) listener(event);
    }

    function unbind() {
      if (!media) return;
      for (const eventName of MEDIA_EVENTS) {
        media.removeEventListener(eventName, notify);
      }
    }

    function bind(nextMedia) {
      if (nextMedia === media) return media;
      unbind();
      media = nextMedia;
      if (media) {
        for (const eventName of MEDIA_EVENTS) {
          media.addEventListener(eventName, notify);
        }
      }
      return media;
    }

    function resolve() {
      if (
        media?.isConnected &&
        scoreMedia(media, expectedDurationMs) >= 0
      ) {
        return media;
      }
      return bind(findMedia(expectedDurationMs));
    }

    function resolveBridge() {
      if (bridgeDocument) {
        const state = queryMediaBridge(bridgeDocument, expectedDurationMs);
        if (
          scoreMediaBridgeState(state, expectedDurationMs) >=
          STICKY_MEDIA_BRIDGE_SCORE
        ) {
          return state;
        }
      }

      const candidate = accessibleDocuments()
        .map((targetDocument) => {
          const state = queryMediaBridge(targetDocument, expectedDurationMs);
          return {
            targetDocument,
            state,
            score: scoreMediaBridgeState(state, expectedDurationMs),
          };
        })
        .filter(({ state }) => state)
        .sort((left, right) => right.score - left.score)[0];

      bridgeDocument = candidate?.targetDocument || null;
      return candidate?.state || null;
    }

    return {
      getDurationMs() {
        const nativeDuration = mediaDurationMs(resolve());
        if (
          nativeDuration !== null &&
          Math.abs(nativeDuration - expectedDurationMs) <= 1000
        ) {
          return nativeDuration;
        }
        const bridgeDuration = resolveBridge()?.durationMs;
        return Number.isFinite(bridgeDuration) &&
          Math.abs(bridgeDuration - expectedDurationMs) <= 1000
          ? bridgeDuration
          : expectedDurationMs;
      },
      getCurrentTimeMs() {
        const currentTime = resolve()?.currentTime;
        if (Number.isFinite(currentTime)) return currentTime * 1000;
        const bridgeTime = resolveBridge()?.currentTimeMs;
        return Number.isFinite(bridgeTime) ? bridgeTime : null;
      },
      seekToMs(timeMs) {
        if (!Number.isFinite(timeMs)) return false;
        const target = resolve();
        if (target) {
          target.currentTime = Math.max(0, timeMs) / 1000;
          return true;
        }
        resolveBridge();
        if (!bridgeDocument) return false;
        return requestMediaBridge(bridgeDocument, "seek", {
          expectedDurationMs,
          timeMs,
        })?.ok === true;
      },
      isPaused() {
        const target = resolve();
        if (target) return target.paused !== false;
        return resolveBridge()?.paused !== false;
      },
      getTrackIdentity() {
        const permalink = currentPlayerPermalink();
        if (permalink) return `url:${permalink}`;
        const source = mediaSource(resolve());
        if (source) return `media:${source}`;
        const pagePermalink = currentPagePermalink();
        return pagePermalink ? `url:${pagePermalink}` : null;
      },
      subscribe(listener) {
        listeners.add(listener);
        resolve();
        return () => listeners.delete(listener);
      },
      destroy() {
        unbind();
        listeners.clear();
        media = null;
        bridgeDocument = null;
      },
      isAvailable() {
        return Boolean(resolve()) || Boolean(resolveBridge());
      },
    };
  }

  function injectStyles() {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = `
      [${BUTTON_ATTRIBUTE}] {
        position: relative;
      }
      [${BUTTON_ATTRIBUTE}].scdl-loop-active {
        color: #ff5500;
      }
      [${BUTTON_ATTRIBUTE}].scdl-loop-unavailable {
        opacity: 0.45;
      }
      [${BUTTON_ATTRIBUTE}] .scdl-loop-button-icon {
        display: block;
        width: 24px;
        height: 24px;
        pointer-events: none;
      }
      [${DOWNLOAD_ATTRIBUTE}][hidden] {
        display: none !important;
      }
      [${DOWNLOAD_ATTRIBUTE}] {
        position: relative;
        color: #ff5500 !important;
      }
      [${DOWNLOAD_ATTRIBUTE}] .scdl-loop-download-icon {
        display: block;
        width: 20px;
        height: 20px;
        object-fit: contain;
        pointer-events: none;
        filter: invert(42%) sepia(99%) saturate(3297%) hue-rotate(359deg)
          brightness(101%) contrast(106%);
      }
      [${DOWNLOAD_ATTRIBUTE}].scdl-loop-download-loading {
        cursor: wait;
        opacity: 0.65;
      }
      [${DOWNLOAD_ATTRIBUTE}].scdl-loop-download-loading
        .scdl-loop-download-icon {
        visibility: hidden;
      }
      [${DOWNLOAD_ATTRIBUTE}].scdl-loop-download-loading::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 16px;
        height: 16px;
        margin: auto;
        border: 2px solid rgba(255, 85, 0, 0.28);
        border-top-color: #ff5500;
        border-radius: 50%;
        box-sizing: border-box;
        animation: scdl-loop-spin 0.8s linear infinite;
      }
      @keyframes scdl-loop-spin {
        to { transform: rotate(360deg); }
      }
      [${OVERLAY_ATTRIBUTE}] {
        position: absolute;
        inset: 0;
        z-index: 5;
        overflow: visible;
        pointer-events: none;
      }
      .scdl-loop-dim,
      .scdl-loop-selection {
        position: absolute;
        top: 0;
        bottom: 0;
        pointer-events: none;
      }
      .scdl-loop-dim {
        background: rgba(0, 0, 0, 0.22);
      }
      .scdl-loop-selection {
        background: linear-gradient(
          to right,
          rgba(255, 85, 0, 0.24) 0%,
          rgba(255, 85, 0, 0.12) 50%,
          rgba(255, 85, 0, 0.24) 100%
        );
        box-sizing: border-box;
      }
      .scdl-loop-selection-drag {
        position: absolute;
        z-index: 1;
        top: 0;
        left: 0;
        right: 0;
        height: 24px;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        outline: 0;
        color: #fff;
        background: transparent;
        cursor: grab;
        touch-action: none;
        pointer-events: auto;
      }
      .scdl-loop-selection-drag::after {
        content: "";
        position: absolute;
        top: 6px;
        left: 50%;
        width: 22px;
        height: 3px;
        transform: translateX(-50%);
        border-top: 1px solid rgba(255, 255, 255, 0.9);
        border-bottom: 1px solid rgba(255, 255, 255, 0.65);
        opacity: 0.72;
      }
      .scdl-loop-selection-drag:hover::after,
      .scdl-loop-selection-drag:focus-visible::after,
      .scdl-loop-selection-drag.scdl-loop-dragging::after {
        opacity: 0.72;
      }
      .scdl-loop-selection-drag.scdl-loop-dragging {
        cursor: grabbing;
      }
      .scdl-loop-marker {
        position: absolute;
        z-index: 2;
        top: 0;
        bottom: 0;
        width: 18px;
        min-width: 18px;
        margin: 0;
        padding: 0;
        border: 0;
        outline: 0;
        transform: translateX(-50%);
        color: #fff;
        background: transparent;
        cursor: ew-resize;
        touch-action: none;
        pointer-events: auto;
      }
      .scdl-loop-marker::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        transform: translateX(-50%);
        background: #ff5500;
      }
      .scdl-loop-marker-label {
        position: absolute;
        z-index: 2;
        top: 24px;
        left: 50%;
        width: 14px;
        height: 14px;
        padding: 0;
        transform: translateX(-50%);
        border-radius: 50%;
        color: #fff;
        background: #ff5500ff;
        font: 600 10px/18px Arial, sans-serif;
        text-align: center;
        box-sizing: border-box;
      }
      .scdl-loop-marker-time {
        position: absolute;
        z-index: 3;
        left: 50%;
        bottom: 5px;
        padding: 3px 5px;
        transform: translateX(-50%);
        border-radius: 3px;
        color: #fff;
        background: rgba(0, 0, 0, 0.82);
        font: 11px/14px Arial, sans-serif;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 100ms ease;
      }
      .scdl-loop-marker:hover .scdl-loop-marker-time,
      .scdl-loop-marker:focus .scdl-loop-marker-time,
      .scdl-loop-marker.scdl-loop-dragging .scdl-loop-marker-time {
        opacity: 1;
      }
      .scdl-loop-marker:focus-visible .scdl-loop-marker-label {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function loopIcon(active) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("scdl-loop-button-icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    if (active) {
      path.setAttribute("d", "M6 6l12 12M18 6L6 18");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.8");
      path.setAttribute("stroke-linecap", "square");
    } else {
      path.setAttribute(
        "d",
        "M17.6 6.4A7.5 7.5 0 0 0 5.1 9H2.75l3.1 3.1L9 9H6.7a5.75 5.75 0 0 1 9.65-1.35L17.6 6.4Zm.55 5.5L15 15h2.3a5.75 5.75 0 0 1-9.65 1.35L6.4 17.6A7.5 7.5 0 0 0 18.9 15h2.35l-3.1-3.1Z"
      );
      path.setAttribute("fill", "currentColor");
    }
    svg.appendChild(path);
    return svg;
  }

  function createButton(menuButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = menuButton.className;
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.setAttribute("variant", menuButton.getAttribute("variant") || "outlined");
    button.addEventListener("click", handleButtonClick);
    setButtonState(button, false, true);
    return button;
  }

  function setButtonState(button, active, available) {
    if (!button) return;
    button.classList.toggle("scdl-loop-active", active);
    button.classList.toggle("scdl-loop-unavailable", !available);
    const visualState = active ? "active" : "idle";
    if (button.dataset.scdlLoopState !== visualState) {
      button.replaceChildren(loopIcon(active));
      button.dataset.scdlLoopState = visualState;
    }
    const label = active ? "Desactivar loop" : "Activar loop A-B";
    button.title = available || active
      ? label
      : "Reproduce o carga este track para activar el loop";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-disabled", String(!available && !active));
  }

  function setDownloadButtonState(button, state = "idle", detail = "") {
    if (!button) return;
    const labels = {
      idle: "Descargar loop",
      loading: "Preparando loop...",
      success: "Loop descargado",
      error: "No se pudo descargar el loop. Reintentar",
    };
    button.classList.toggle(
      "scdl-loop-download-loading",
      state === "loading"
    );
    button.dataset.scdlLoopDownloadState = state;
    button.disabled = state === "loading";
    button.hidden = !range;
    button.title = detail || labels[state] || labels.idle;
    button.setAttribute("aria-label", button.title);
  }

  function createDownloadButton(menuButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = menuButton.className;
    button.setAttribute(DOWNLOAD_ATTRIBUTE, "true");
    const icon = document.createElement("img");
    icon.className = "scdl-loop-download-icon";
    icon.src = chrome.runtime.getURL("assets/icons/download.svg");
    icon.alt = "";
    icon.draggable = false;
    button.appendChild(icon);
    button.addEventListener("click", handleDownloadClick);
    setDownloadButtonState(button);
    return button;
  }

  function formatTime(timeMs) {
    const totalMs = Math.max(0, Math.round(timeMs));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(
      milliseconds
    ).padStart(3, "0")}`;
  }

  function createMarker(marker) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "scdl-loop-marker";
    element.dataset.marker = marker;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-orientation", "horizontal");
    element.innerHTML = `<span class="scdl-loop-marker-label" aria-hidden="true"></span><span class="scdl-loop-marker-time"></span>`;
    element.addEventListener("pointerdown", handleMarkerPointerDown);
    element.addEventListener("pointermove", handleMarkerPointerMove);
    element.addEventListener("pointerup", handleMarkerPointerEnd);
    element.addEventListener("pointercancel", handleMarkerPointerEnd);
    element.addEventListener("keydown", handleMarkerKeyDown);
    element.addEventListener("click", stopMarkerEvent);
    return element;
  }

  function createSelectionDragHandle() {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "scdl-loop-selection-drag";
    element.setAttribute("aria-label", "Mover selección completa del loop");
    element.addEventListener("pointerdown", handleSelectionPointerDown);
    element.addEventListener("pointermove", handleSelectionPointerMove);
    element.addEventListener("pointerup", handleSelectionPointerEnd);
    element.addEventListener("pointercancel", handleSelectionPointerEnd);
    element.addEventListener("keydown", handleSelectionKeyDown);
    element.addEventListener("click", stopMarkerEvent);
    return element;
  }

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.setAttribute(OVERLAY_ATTRIBUTE, "true");
    const before = document.createElement("div");
    before.className = "scdl-loop-dim scdl-loop-before";
    const selection = document.createElement("div");
    selection.className = "scdl-loop-selection";
    selection.appendChild(createSelectionDragHandle());
    const after = document.createElement("div");
    after.className = "scdl-loop-dim scdl-loop-after";
    overlay.append(
      before,
      selection,
      after,
      createMarker("start", "A"),
      createMarker("end", "B")
    );
    return overlay;
  }

  function updateOverlay() {
    if (!view?.overlay || !range) return;
    const start = SCLooperCore.timeToPercent(range.startMs, range.durationMs);
    const end = SCLooperCore.timeToPercent(range.endMs, range.durationMs);
    const before = view.overlay.querySelector(".scdl-loop-before");
    const selection = view.overlay.querySelector(".scdl-loop-selection");
    const after = view.overlay.querySelector(".scdl-loop-after");
    before.style.left = "0";
    before.style.width = `${start}%`;
    selection.style.left = `${start}%`;
    selection.style.width = `${end - start}%`;
    const dragHandle = selection.querySelector(".scdl-loop-selection-drag");
    dragHandle?.setAttribute(
      "aria-valuetext",
      `${formatTime(range.startMs)} a ${formatTime(range.endMs)}`
    );
    after.style.left = `${end}%`;
    after.style.right = "0";

    for (const marker of view.overlay.querySelectorAll(".scdl-loop-marker")) {
      const isStart = marker.dataset.marker === "start";
      const timeMs = isStart ? range.startMs : range.endMs;
      marker.style.left = `${isStart ? start : end}%`;
      marker.setAttribute(
        "aria-label",
        isStart ? "Inicio del loop A" : "Final del loop B"
      );
      marker.setAttribute("aria-valuemin", "0");
      marker.setAttribute("aria-valuemax", String(Math.round(range.durationMs)));
      marker.setAttribute("aria-valuenow", String(Math.round(timeMs)));
      marker.setAttribute("aria-valuetext", formatTime(timeMs));
      marker.querySelector(".scdl-loop-marker-time").textContent = formatTime(timeMs);
    }
  }

  function restoreWrapperPosition(currentView) {
    if (!currentView?.changedWrapperPosition) return;
    currentView.wrapper.style.position = currentView.previousWrapperPosition;
  }

  function removeView() {
    if (!view) return;
    selectionDrag = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    view.button?.removeEventListener("click", handleButtonClick);
    view.downloadButton?.removeEventListener("click", handleDownloadClick);
    view.button?.remove();
    view.downloadButton?.remove();
    view.overlay?.remove();
    restoreWrapperPosition(view);
    view = null;
  }

  function mountView(target) {
    removeView();
    injectStyles();

    const button = createButton(target.menuButton);
    const downloadButton = createDownloadButton(target.menuButton);
    target.menuButton.parentElement.insertBefore(button, target.menuButton);
    target.menuButton.parentElement.insertBefore(downloadButton, target.menuButton);
    view = {
      ...target,
      button,
      downloadButton,
      overlay: null,
      pageUrl: window.location.href,
    };

    if (range) mountOverlay();
    updateButtonAvailability();
    setDownloadButtonState(downloadButton, isLoopDownloading ? "loading" : "idle");
    setDebugStatus("mounted");
  }

  function mountOverlay() {
    if (!view || !range) return;
    view.overlay?.remove();
    const computedPosition = window.getComputedStyle(view.wrapper).position;
    if (computedPosition === "static") {
      view.previousWrapperPosition = view.wrapper.style.position;
      view.wrapper.style.position = "relative";
      view.changedWrapperPosition = true;
    }
    view.overlay = createOverlay();
    view.wrapper.appendChild(view.overlay);
    if (typeof ResizeObserver === "function") {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(updateOverlay);
      resizeObserver.observe(view.wrapper);
    }
    updateOverlay();
  }

  function updateButtonAvailability() {
    if (!view?.button) return;
    if (range) {
      setButtonState(view.button, true, true);
      setDownloadButtonState(
        view.downloadButton,
        isLoopDownloading ? "loading" : "idle"
      );
      return;
    }
    if (view.durationMs === null) {
      setButtonState(view.button, false, false);
      return;
    }
    const probe = createNativeMediaAdapter(view.durationMs);
    const available = probe.isAvailable();
    probe.destroy();
    setButtonState(view.button, false, available);
    setDownloadButtonState(view.downloadButton);
  }

  function identityUrl(identity) {
    return typeof identity === "string" && identity.startsWith("url:")
      ? normalizeUrl(identity.slice(4))
      : null;
  }

  async function resolveLoopTrackData(identity) {
    const expectedUrl = identityUrl(identity);
    const currentTrack = window.SCDL?.getTrackData?.() || null;
    const currentUrl = normalizeUrl(
      currentTrack?.permalink || currentTrack?.pageUrl
    );

    if (currentTrack && (!expectedUrl || currentUrl === expectedUrl)) {
      return currentTrack;
    }

    if (
      expectedUrl &&
      typeof window.SCDL?.resolvePlayerTrackData === "function"
    ) {
      return window.SCDL.resolvePlayerTrackData(expectedUrl);
    }

    throw new Error("No se pudo identificar el track activo.");
  }

  async function handleDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!range || isLoopDownloading) return;

    const button = event.currentTarget;
    const trimRange = {
      startMs: range.startMs,
      endMs: range.endMs,
      durationMs: range.durationMs,
    };
    const trackIdentity = initialTrackIdentity;
    isLoopDownloading = true;
    if (downloadResetTimeout) clearTimeout(downloadResetTimeout);
    setDownloadButtonState(button, "loading");

    try {
      let trackData = null;
      try {
        trackData = await resolveLoopTrackData(trackIdentity);
      } catch {
        // The looper can live in SoundCloud's player frame. The background
        // asks the top-frame intake for track data when it is unavailable here.
      }
      const result = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_LOOP",
        trackData,
        trackUrl: identityUrl(trackIdentity),
        formatPreference: trackData?.formatPreference || "auto",
        trimRange,
      });
      if (!result?.success) {
        throw new Error(result?.error || "No se pudo descargar el loop.");
      }
      setDownloadButtonState(button, "success");
      downloadResetTimeout = setTimeout(() => {
        downloadResetTimeout = null;
        if (button.isConnected) setDownloadButtonState(button);
      }, 2500);
    } catch (error) {
      console.error("SC Downloader loop download error:", error);
      setDownloadButtonState(
        button,
        "error",
        error?.message || "No se pudo descargar el loop."
      );
    } finally {
      isLoopDownloading = false;
      if (
        button.isConnected &&
        button.dataset.scdlLoopDownloadState === "loading"
      ) {
        setDownloadButtonState(button);
      }
    }
  }

  function stopMarkerEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function updateSelectionFromPointer(clientX) {
    if (!selectionDrag || !range || !view) return;
    const rect = view.waveform.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    const deltaMs =
      ((clientX - selectionDrag.startClientX) / rect.width) *
      selectionDrag.initialRange.durationMs;
    range = SCLooperCore.moveRange(selectionDrag.initialRange, deltaMs);
    updateOverlay();
  }

  function handleSelectionPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stopMarkerEvent(event);
    selectionDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      initialRange: { ...range },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("scdl-loop-dragging");
  }

  function handleSelectionPointerMove(event) {
    if (
      !selectionDrag ||
      selectionDrag.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    stopMarkerEvent(event);
    updateSelectionFromPointer(event.clientX);
  }

  function handleSelectionPointerEnd(event) {
    if (
      !selectionDrag ||
      selectionDrag.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    stopMarkerEvent(event);
    if (event.type !== "pointercancel") {
      updateSelectionFromPointer(event.clientX);
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove("scdl-loop-dragging");
    selectionDrag = null;
    seekIfOutsideRange();
  }

  function handleSelectionKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    stopMarkerEvent(event);
    const amount = event.shiftKey ? 1000 : 100;
    range = SCLooperCore.moveRange(
      range,
      event.key === "ArrowLeft" ? -amount : amount
    );
    updateOverlay();
    seekIfOutsideRange();
  }

  function updateMarkerFromPointer(marker, clientX) {
    if (!range || !view) return;
    const rect = view.waveform.getBoundingClientRect();
    const timeMs = SCLooperCore.positionToTime(
      clientX,
      rect.left,
      rect.width,
      range.durationMs
    );
    range = SCLooperCore.moveMarker(range, marker, timeMs);
    updateOverlay();
  }

  function handleMarkerPointerDown(event) {
    stopMarkerEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("scdl-loop-dragging");
    updateMarkerFromPointer(event.currentTarget.dataset.marker, event.clientX);
  }

  function handleMarkerPointerMove(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    stopMarkerEvent(event);
    updateMarkerFromPointer(event.currentTarget.dataset.marker, event.clientX);
  }

  function handleMarkerPointerEnd(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    stopMarkerEvent(event);
    if (event.type !== "pointercancel") {
      updateMarkerFromPointer(event.currentTarget.dataset.marker, event.clientX);
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove("scdl-loop-dragging");
    seekIfOutsideRange();
  }

  function handleMarkerKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    stopMarkerEvent(event);
    const marker = event.currentTarget.dataset.marker;
    const currentTime = marker === "start" ? range.startMs : range.endMs;
    const amount = event.shiftKey ? 1000 : 100;
    range = SCLooperCore.moveMarker(
      range,
      marker,
      currentTime + (event.key === "ArrowLeft" ? -amount : amount)
    );
    updateOverlay();
    seekIfOutsideRange();
  }

  function seekToStart() {
    if (!player || !range) return;
    const now = performance.now();
    if (now - lastSeekAttemptAt < SEEK_RETRY_MS) return;
    lastSeekAttemptAt = now;
    player.seekToMs(range.startMs);
  }

  function seekIfOutsideRange() {
    const currentTimeMs = player?.getCurrentTimeMs();
    if (SCLooperCore.getSeekTarget(range, currentTimeMs) !== null) {
      seekToStart();
    }
  }

  function identitiesConflict(initial, current) {
    if (!initial || !current) return false;
    const initialKind = initial.slice(0, initial.indexOf(":"));
    const currentKind = current.slice(0, current.indexOf(":"));
    if (initialKind !== currentKind) {
      if (currentKind === "url") initialTrackIdentity = current;
      return false;
    }
    return initial !== current;
  }

  function handlePlayerEvent(event) {
    if (!range || !player) return;
    if (event.type === "seeked") {
      const currentTimeMs = player.getCurrentTimeMs();
      if (SCLooperCore.getSeekTarget(range, currentTimeMs) === null) {
        lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
      }
    }

    if (event.type === "loadedmetadata" || event.type === "durationchange") {
      const normalized = SCLooperCore.normalizeRange({
        ...range,
        durationMs: player.getDurationMs(),
      });
      if (!normalized) {
        reset("invalid-duration");
        return;
      }
      range = normalized;
      updateOverlay();
    }

    if (event.type !== "emptied") seekIfOutsideRange();
  }

  function loopFrame() {
    frameId = null;
    if (!range || !player) return;

    if (window.location.href !== initialUrl) {
      reset("navigation");
      return;
    }

    const currentIdentity = player.getTrackIdentity();
    if (identitiesConflict(initialTrackIdentity, currentIdentity)) {
      reset("track-changed");
      return;
    }

    const currentTimeMs = player.getCurrentTimeMs();
    if (SCLooperCore.getSeekTarget(range, currentTimeMs) !== null) {
      seekToStart();
    } else {
      lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
    }

    frameId = requestAnimationFrame(loopFrame);
  }

  function activate() {
    const target = discoverTarget();
    if (!target) return false;
    if (!view || view.waveform !== target.waveform) mountView(target);

    const nextPlayer = createNativeMediaAdapter(target.durationMs);
    if (!nextPlayer.isAvailable()) {
      nextPlayer.destroy();
      updateButtonAvailability();
      return false;
    }

    const initialRange = SCLooperCore.createInitialRange(
      nextPlayer.getDurationMs(),
      nextPlayer.getCurrentTimeMs()
    );
    if (!initialRange) {
      nextPlayer.destroy();
      updateButtonAvailability();
      return false;
    }

    player?.destroy();
    player = nextPlayer;
    range = initialRange;
    initialUrl = window.location.href;
    initialTrackIdentity = player.getTrackIdentity();
    lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
    player.subscribe(handlePlayerEvent);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    mountOverlay();
    setButtonState(view.button, true, true);
    setDownloadButtonState(view.downloadButton);
    frameId = requestAnimationFrame(loopFrame);
    return true;
  }

  function handleButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (range) {
      reset("deactivated");
      scheduleEnsure(0);
      return;
    }
    activate();
  }

  function handleDocumentKeyDown(event) {
    if (event.key !== "Escape" || !range) return;
    event.preventDefault();
    reset("escape");
    scheduleEnsure(0);
  }

  function reset(reason = "manual") {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    document.removeEventListener("keydown", handleDocumentKeyDown, true);
    player?.destroy();
    player = null;
    range = null;
    initialUrl = null;
    initialTrackIdentity = null;
    lastSeekAttemptAt = Number.NEGATIVE_INFINITY;
    removeView();

    for (const node of document.querySelectorAll(
      `[${BUTTON_ATTRIBUTE}], [${DOWNLOAD_ATTRIBUTE}], [${OVERLAY_ATTRIBUTE}]`
    )) {
      node.remove();
    }

    setDebugStatus(`reset:${reason}`);

    return reason;
  }

  function mountingDiagnostics() {
    const waveforms = Array.from(
      document.querySelectorAll('[role="slider"][aria-label="Waveform"]')
    );
    const validWaveforms = waveforms.filter(
      (waveform) => readWaveformDuration(waveform) !== null
    );
    const visibleWaveforms = validWaveforms.filter(isVisible);
    const menus = Array.from(
      document.querySelectorAll('button[aria-haspopup="true"]')
    );
    const matchedMenus = menus.filter(isMoreActionsButton);
    return [
      "waiting",
      `route=${isTrackPage()}`,
      `waveforms=${waveforms.length}`,
      `valid=${validWaveforms.length}`,
      `visible=${visibleWaveforms.length}`,
      `menus=${menus.length}`,
      `matchedMenus=${matchedMenus.length}`,
      `h1=${document.querySelectorAll("h1").length}`,
    ].join(";");
  }

  function ensureMounted() {
    if (range && window.location.href !== initialUrl) {
      reset("navigation");
      return false;
    }

    if (
      view?.pageUrl === window.location.href &&
      view.button?.isConnected &&
      view.waveform?.isConnected &&
      view.menuButton?.isConnected &&
      isVisible(view.waveform)
    ) {
      view.durationMs = readWaveformDuration(view.waveform);
      updateButtonAvailability();
      return true;
    }

    const target = discoverTarget();
    if (!target) {
      setDebugStatus(mountingDiagnostics());
      if (!isTrackPage() && (view || range)) reset("unsupported-page");
      return false;
    }
    if (
      !view ||
      !view.button?.isConnected ||
      view.waveform !== target.waveform ||
      view.menuButton !== target.menuButton
    ) {
      if (range) {
        range = SCLooperCore.normalizeRange({
          ...range,
          durationMs: target.durationMs,
        });
      }
      mountView(target);
    } else {
      updateButtonAvailability();
    }
    return true;
  }

  function runEnsureMounted() {
    try {
      return ensureMounted();
    } catch (error) {
      setDebugStatus(`error:${error?.name || "Error"}:${error?.message || error}`);
      console.error("[DEBUG-SCDL-LOOPER] Mount failed", error);
      return false;
    }
  }

  function scheduleEnsure(delay = 80) {
    if (ensureTimeout !== null) clearTimeout(ensureTimeout);
    ensureTimeout = setTimeout(() => {
      ensureTimeout = null;
      runEnsureMounted();
    }, delay);
  }

  function startLifecycle() {
    if (started || !document.body) return;
    started = true;
    discoveryObserver = new MutationObserver(() => scheduleEnsure());
    discoveryObserver.observe(document.body, { childList: true, subtree: true });
    contextInterval = setInterval(() => {
      if (range && window.location.href !== initialUrl) reset("navigation");
      scheduleEnsure(0);
    }, 750);
    window.addEventListener("popstate", scheduleEnsure);
    window.addEventListener("hashchange", scheduleEnsure);
    window.addEventListener("beforeunload", stopLifecycle, { once: true });
    setDebugStatus("booted");
    runEnsureMounted();
  }

  function stopLifecycle() {
    reset("unload");
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    if (contextInterval !== null) clearInterval(contextInterval);
    contextInterval = null;
    if (ensureTimeout !== null) clearTimeout(ensureTimeout);
    ensureTimeout = null;
    window.removeEventListener("popstate", scheduleEnsure);
    window.removeEventListener("hashchange", scheduleEnsure);
    started = false;
  }

  function getState() {
    return range
      ? { active: true, ...range, trackIdentity: initialTrackIdentity }
      : { active: false };
  }

  const looper = { ensureMounted: runEnsureMounted, reset, getState };
  globalThis.SCLooper = looper;

  if (document.body) startLifecycle();
  else document.addEventListener("DOMContentLoaded", startLifecycle, { once: true });

  return looper;
})();
