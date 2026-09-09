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
  // Kept inline because this script runs in the page's MAIN world, where
  // chrome.runtime.getURL() is intentionally unavailable. The paths match
  // assets/icons/speed-meter.svg, with fill changed to currentColor.
  const SPEED_METER_ICON = `<svg class="trigger-icon" viewBox="0 0 612 612" aria-hidden="true" focusable="false"><g><path d="M175.205 239.62c.127-1.965-.533-3.902-1.833-5.381l-58.84-66.941c-1.3-1.479-3.135-2.381-5.102-2.508-1.975-.126-3.902.533-5.381 1.833-27.037 23.766-49.479 51.794-66.706 83.305-.944 1.729-1.165 3.762-.611 5.651.554 1.89 1.836 3.483 3.565 4.427l78.205 42.748a7.46 7.46 0 0 0 3.557.912c2.627 0 5.174-1.398 6.523-3.866 11.386-20.828 26.229-39.359 44.114-55.08 1.482-1.308 2.384-3.143 2.509-5.11Z"/><path d="M201.462 214.829a7.46 7.46 0 0 0 10.041 3.081c20.962-11.117 43.512-18.371 67.025-21.561 4.064-.551 6.913-4.293 6.362-8.358l-11.979-88.316c-.551-4.064-4.304-6.909-8.358-6.362-35.708 4.843-69.949 15.857-101.772 32.736-3.623 1.922-5.002 6.416-3.082 10.041l41.763 78.739Z"/><path d="m105.785 334.345-86.017-23.338a7.47 7.47 0 0 0-9.113 5.224C3.586 342.295 0 369.309 0 396.523c0 4.657.111 9.329.342 14.284.185 3.981 3.468 7.083 7.414 7.083.116 0 .234-.002.35-.008l89.031-4.113a7.46 7.46 0 0 0 7.075-7.762c-.155-3.341-.23-6.444-.23-9.484 0-18.02 2.365-35.873 7.029-53.066a7.46 7.46 0 0 0-5.226-9.112Z"/><path d="M438.731 120.745c-32.411-15.625-67.04-25.308-102.925-28.786a7.46 7.46 0 0 0-8.11 6.677l-8.593 88.712c-.396 4.082 2.594 7.713 6.677 8.108 23.652 2.291 46.463 8.669 67.8 18.954a7.46 7.46 0 0 0 10.14-3.37l38.7-80.287c1.558-3.788.007-8.228-3.689-10.008Z"/><path d="M569.642 245.337a7.46 7.46 0 0 0-.828-5.624c-18.432-30.835-41.933-57.983-69.848-80.686a7.46 7.46 0 0 0-10.447 1.075l-56.237 69.144a7.46 7.46 0 0 0 1.077 10.449c18.47 15.019 34.015 32.975 46.205 53.369a7.46 7.46 0 0 0 10.186 2.564l76.501-45.728a7.46 7.46 0 0 0 3.391-4.562Z"/><path d="M598.044 304.939c-1.228-3.915-5.397-6.096-9.308-4.867l-85.048 26.648c-3.915 1.226-6.093 5.393-4.867 9.306 6.104 19.486 9.199 39.839 9.199 60.494 0 3.041-.076 6.144-.23 9.484a7.46 7.46 0 0 0 7.075 7.762l89.031 4.113.35.008c3.944 0 7.228-3.103 7.414-7.083.229-4.955.342-9.627.342-14.284 0-31.217-4.694-61.912-13.956-91.584Z"/><path d="M305.737 380.755c-1.281 0-2.555.042-3.824.11l-120.65-71.185a7.46 7.46 0 0 0-10.632 10.186l65.815 123.355a69.56 69.56 0 0 0-.371 7.195c0 18.608 7.246 36.101 20.403 49.258 13.158 13.158 30.652 20.404 49.26 20.404s36.101-7.248 49.258-20.404c13.157-13.157 20.403-30.65 20.403-49.258s-7.246-36.101-20.403-49.258c-13.157-13.157-30.652-20.403-49.259-20.403Z"/></g></svg>`;

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
          width: 48px;
          height: 34px;
          margin: 0;
          margin-left: 6px;
          padding: 0;
          border: 0;
          color: #fff;
          background: transparent;
          font: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .trigger:hover { color: #abababff; }
        .trigger-icon {
          display: block;
          width: 18px;
          height: 18px;
          fill: currentColor;
        }

        .trigger-rate {
          margin-left: 2px;
          color: #ff6c23ff;
          font-weight: 600;
          line-height: 1;
          position:relative;
          right: 9px;
          transform: translateY(5px);
        }
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
      >${SPEED_METER_ICON}<span class="trigger-rate">1x</span></button>
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
    ui.trigger.querySelector(".trigger-rate").textContent = text;
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
