/*
 * SoundCloud player adapter for scripts/tempo-control-core.js.
 * The audio-control implementation is adapted under the MIT license; see
 * THIRD_PARTY_LICENSES.md.
 */
(() => {
  "use strict";

  const INSTALLED_FLAG = "__scdlTempoControlInstalled";
  const HOST_ID = "scdl-tempo-control";
  const PLAYER_SELECTOR = ".playControls__elements";
  const DOWNLOAD_BUTTON_SELECTOR = "#scdl-player-download";
  const RATE_STORAGE = "scdl.tempo.rate";
  const PITCH_STORAGE = "scdl.tempo.preservePitch";
  const RATE_ATTRIBUTE = "data-scdl-tempo-rate";
  const PITCH_ATTRIBUTE = "data-scdl-tempo-preserve-pitch";

  if (window[INSTALLED_FLAG] || !globalThis.SCTempoControl) return;
  Object.defineProperty(window, INSTALLED_FLAG, { value: true });

  const { DEFAULTS, clampRate, create, formatRate } = globalThis.SCTempoControl;
  let ui = null;
  let mountQueued = false;
  let playbackFailure = "";
  let storageFailure = "";

  function readStoredRate() {
    try {
      const stored = localStorage.getItem(RATE_STORAGE);
      return stored === null ? DEFAULTS.rate : clampRate(stored);
    } catch {
      return DEFAULTS.rate;
    }
  }

  function readStoredPitch() {
    try {
      return localStorage.getItem(PITCH_STORAGE) === "true";
    } catch {
      return DEFAULTS.preservePitch;
    }
  }

  const controller = create({
    initialRate: readStoredRate(),
    initialPreservePitch: readStoredPitch(),
    onChange: render,
    onError(error) {
      playbackFailure =
        "Could not change playback speed. Reload SoundCloud and retry.";
      console.warn("[SC Downloader Tempo]", error);
      render();
    },
  });

  function writeSetting(key, value) {
    try {
      localStorage.setItem(key, String(value));
      storageFailure = "";
      return true;
    } catch {
      storageFailure = "Could not save this playback setting.";
      render();
      return false;
    }
  }

  function syncRange(input) {
    const minimum = Number(input.min) || 0;
    const span = Number(input.max) - minimum;
    const value = span > 0 ? (input.valueAsNumber - minimum) / span : 0;
    const fill = `${Math.max(0, Math.min(1, value || 0)) * 100}%`;
    input.style.setProperty("--range-fill", fill);
  }

  function template() {
    return `
      <style>
        :host {
          color: #fff;
          font: 12px/1.4 Interstate, Lucida Grande, Arial, sans-serif;
        }

        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }

        .trigger {
          min-width: 54px;
          height: 34px;
          margin: 0;
          padding: 0 10px;
          border: 1px solid #333;
          border-radius: 4px;
          color: #ff5500;
          background: #181818;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }

        .trigger:hover { border-color: #555; }
        .trigger:focus-visible,
        input:focus-visible {
          outline: 2px solid #ff5500;
          outline-offset: 2px;
        }

        .panel {
          position: fixed;
          z-index: 2147483647;
          width: min(314px, calc(100vw - 16px));
          padding: 18px 17px 20px;
          border: 1px solid #444;
          border-radius: 7px;
          color: #eee;
          background: #202020;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
        }

        .title {
          margin: 0 0 22px;
          font-size: 14px;
          font-weight: 700;
        }

        .limits,
        .pitch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .limits {
          margin-bottom: 4px;
          color: #ccc;
        }

        .slider {
          appearance: none;
          -webkit-appearance: none;
          display: block;
          width: 100%;
          height: 28px;
          margin: 0 0 14px;
          border: 0;
          background: linear-gradient(
              to right,
              #ff5500 var(--range-fill, 0%),
              #3b3b3b var(--range-fill, 0%)
            ) center / 100% 8px no-repeat;
          cursor: pointer;
        }

        .slider::-webkit-slider-runnable-track {
          height: 8px;
          background: transparent;
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 19px;
          height: 19px;
          margin-top: -5.5px;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #ff5500;
        }

        .slider::-moz-range-track { height: 8px; background: #3b3b3b; }
        .slider::-moz-range-progress { height: 8px; background: #ff5500; }
        .slider::-moz-range-thumb {
          width: 15px;
          height: 15px;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #ff5500;
        }

        .pitch-row { cursor: pointer; }
        .pitch-label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-size: 14px;
        }

        .pitch-toggle {
          width: 15px;
          height: 15px;
          margin: 0;
          accent-color: #ff5500;
        }

        .current {
          color: #ff5500;
          font-size: 14px;
          font-weight: 700;
        }

        .status {
          margin: 12px 0 0;
          color: #ffb199;
          font-size: 11px;
        }

        @media (forced-colors: active) {
          .trigger, .panel { border-color: CanvasText; }
        }

        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; }
        }
      </style>
      <button
        class="trigger"
        type="button"
        aria-label="Playback speed 1x"
        aria-haspopup="dialog"
        aria-expanded="false"
      >1x</button>
      <section
        class="panel"
        role="dialog"
        aria-label="Playback Speed"
        hidden
      >
        <div class="limits" aria-hidden="true"><span>0.5x</span><span>2x</span></div>
        <input
          class="slider"
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value="1"
          aria-label="Playback speed"
        />
        <label class="pitch-row">
          <span class="pitch-label">
            <input class="pitch-toggle" type="checkbox" />
            Preserve Pitch
          </span>
          <output class="current">1x</output>
        </label>
        <p class="status" role="status" aria-live="polite" hidden></p>
      </section>
    `;
  }

  function positionPanel() {
    if (!ui || ui.panel.hidden) return;
    const anchor = ui.trigger.getBoundingClientRect();
    const width = Math.min(314, innerWidth - 16);
    const left = Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width));
    ui.panel.style.left = `${left}px`;
    ui.panel.style.bottom = `${Math.max(8, innerHeight - anchor.top + 8)}px`;
  }

  function setPanelOpen(open) {
    if (!ui) return;
    ui.panel.hidden = !open;
    ui.trigger.setAttribute("aria-expanded", String(open));
    if (open) positionPanel();
  }

  function createUi() {
    const host = document.createElement("span");
    host.id = HOST_ID;
    host.style.cssText = [
      "display:flex",
      "align-items:center",
      "flex:0 0 auto",
      "height:100%",
      "margin-left:8px",
    ].join(";");

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = template();
    ui = {
      host,
      root,
      trigger: root.querySelector(".trigger"),
      panel: root.querySelector(".panel"),
      slider: root.querySelector(".slider"),
      pitchToggle: root.querySelector(".pitch-toggle"),
      current: root.querySelector(".current"),
      status: root.querySelector(".status"),
    };

    ui.trigger.addEventListener("click", () => {
      setPanelOpen(ui.panel.hidden);
    });
    ui.slider.addEventListener("input", () => {
      playbackFailure = "";
      const state = controller.setRate(ui.slider.valueAsNumber);
      writeSetting(RATE_STORAGE, state.rate);
      render();
    });
    ui.slider.addEventListener("dblclick", () => {
      playbackFailure = "";
      const state = controller.setRate(DEFAULTS.rate);
      writeSetting(RATE_STORAGE, state.rate);
      render();
    });
    ui.pitchToggle.addEventListener("change", () => {
      playbackFailure = "";
      const state = controller.setPreservePitch(ui.pitchToggle.checked);
      writeSetting(PITCH_STORAGE, state.preservePitch);
      render();
    });

    render();
    return host;
  }

  function render() {
    if (!ui) return;
    const state = controller.snapshot();
    const text = formatRate(state.rate);
    ui.trigger.textContent = text;
    ui.trigger.setAttribute("aria-label", `Playback speed ${text}`);
    ui.slider.value = String(state.rate);
    ui.slider.setAttribute("aria-valuetext", text);
    syncRange(ui.slider);
    ui.pitchToggle.checked = state.preservePitch;
    ui.pitchToggle.disabled = !state.preservePitchSupported;
    ui.current.textContent = text;
    ui.host.setAttribute(RATE_ATTRIBUTE, String(state.rate));
    ui.host.setAttribute(PITCH_ATTRIBUTE, String(state.preservePitch));
    const message = playbackFailure || storageFailure;
    ui.status.textContent = message;
    ui.status.hidden = !message;
  }

  function mount() {
    const player = document.querySelector(PLAYER_SELECTOR);
    if (!player) {
      ui?.host.remove();
      setPanelOpen(false);
      return;
    }

    const host = ui?.host || createUi();
    const downloadButton = player.querySelector(DOWNLOAD_BUTTON_SELECTOR);
    if (downloadButton) {
      if (downloadButton.nextElementSibling !== host) {
        downloadButton.insertAdjacentElement("afterend", host);
      }
      return;
    }

    if (host.parentElement !== player) {
      const soundBadge = player.querySelector(".playControls__soundBadge");
      if (soundBadge) soundBadge.insertAdjacentElement("afterend", host);
      else player.appendChild(host);
    }
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => {
      mountQueued = false;
      mount();
    });
  }

  controller.install();
  document.querySelectorAll("audio").forEach(controller.discover);
  for (const event of ["play", "loadedmetadata"]) {
    document.addEventListener(
      event,
      (mediaEvent) => controller.apply(mediaEvent.target),
      true
    );
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLAudioElement) controller.discover(node);
        else node.querySelectorAll("audio").forEach(controller.discover);
      }
    }
    scheduleMount();
  }).observe(document, { childList: true, subtree: true });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (ui && !ui.panel.hidden && !event.composedPath().includes(ui.host)) {
        setPanelOpen(false);
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && ui && !ui.panel.hidden) {
        setPanelOpen(false);
        ui.trigger.focus();
      }
    },
    true
  );
  window.addEventListener("resize", positionPanel);
  window.addEventListener("storage", (event) => {
    if (event.key === RATE_STORAGE) controller.setRate(readStoredRate());
    if (event.key === PITCH_STORAGE) {
      controller.setPreservePitch(readStoredPitch());
    }
  });

  mount();
  render();
})();
