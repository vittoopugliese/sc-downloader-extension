(() => {
  "use strict";

  if (document.documentElement.dataset.view === "goodbye") return;

  const { t, apply } = window.PTLandingI18n;
  apply();
  document.title = t("doc_title");

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Deterministic noise so the illustration looks the same on every load.
  function noise(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  // Each stem gets an envelope that reads like its instrument.
  const shapes = {
    vocals: (x, r) => (Math.sin(x * 9) > -0.2 ? 0.35 + 0.55 * Math.abs(Math.sin(x * 23)) * r() : 0.04),
    drums: (x, r) => (Math.round(x * 64) % 4 === 0 ? 0.75 + 0.25 * r() : 0.12 + 0.2 * r()),
    bass: (x, r) => 0.42 + 0.18 * Math.sin(x * 6) + 0.08 * r(),
    other: (x, r) => 0.22 + 0.3 * Math.abs(Math.sin(x * 3.4)) + 0.12 * r(),
  };

  function fillBars(container, count, shape, seed, className) {
    const random = noise(seed);
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const bar = document.createElement("i");
      bar.style.height = `${Math.max(4, Math.min(100, shape(index / count, random) * 100))}%`;
      if (className) className(bar, index / count);
      fragment.append(bar);
    }
    container.append(fragment);
  }

  const barCount = innerWidth < 600 ? 48 : 84;
  document.querySelectorAll(".rack .lane").forEach((lane, index) => {
    fillBars(lane.querySelector(".bars"), barCount, shapes[lane.dataset.stem], 11 + index * 97);
  });

  const rack = document.querySelector(".rack");
  const toggle = document.getElementById("rack-toggle");
  function setRack(state) {
    rack.dataset.state = state;
    toggle.dataset.l10n = state === "mixed" ? "split_again" : "mix_back";
    toggle.textContent = t(toggle.dataset.l10n);
  }
  toggle.addEventListener("click", () => setRack(rack.dataset.state === "mixed" ? "split" : "mixed"));
  // The one orchestrated moment on the page: the mix splits into stems after load.
  if (reducedMotion) setRack("split");
  else setTimeout(() => setRack("split"), 700);

  // Mute and solo behave like a mixer: any solo silences every lane that isn't soloed.
  const lanes = [...document.querySelectorAll(".rack .lane")];
  function refreshLanes() {
    const soloed = lanes.some((lane) => lane.querySelector('[data-act="solo"]').getAttribute("aria-pressed") === "true");
    lanes.forEach((lane) => {
      const muted = lane.querySelector('[data-act="mute"]').getAttribute("aria-pressed") === "true";
      const solo = lane.querySelector('[data-act="solo"]').getAttribute("aria-pressed") === "true";
      lane.classList.toggle("silent", muted || (soloed && !solo));
    });
  }
  lanes.forEach((lane) => {
    const name = lane.querySelector(".lane-name").textContent;
    lane.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-label", `${name} ${button.dataset.act}`);
      button.addEventListener("click", () => {
        button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
        refreshLanes();
      });
    });
  });

  // Speed: pitch follows speed unless Keep Tone is on, exactly like the extension.
  const speed = document.getElementById("speed");
  const speedValue = document.getElementById("speed-value");
  const speedPitch = document.getElementById("speed-pitch");
  const keepTone = document.getElementById("keep-tone");
  const presets = [...document.querySelectorAll("[data-speed]")];
  function renderSpeed() {
    const value = Number(speed.value);
    speedValue.textContent = `${value.toFixed(2)}×`;
    const semitones = keepTone.checked ? 0 : 12 * Math.log2(value);
    const rounded = Math.round(semitones * 10) / 10;
    speedPitch.textContent = rounded === 0 ? "±0 st" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)} st`;
    presets.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === value)));
  }
  speed.addEventListener("input", renderSpeed);
  keepTone.addEventListener("change", renderSpeed);
  presets.forEach((button) => button.addEventListener("click", () => { speed.value = button.dataset.speed; renderSpeed(); }));
  renderSpeed();

  // Loop waveform with the A–B range highlighted.
  fillBars(document.getElementById("loop-bars"), barCount, (x, r) => 0.25 + 0.6 * Math.abs(Math.sin(x * 14)) * r() + 0.1, 5, (bar, x) => {
    if (x >= 0.38 && x <= 0.62) bar.classList.add("in");
  });

  // Pads play the same default drum samples the extension ships with.
  let audio = null;
  const buffers = new Map();
  function ensureAudio() {
    if (audio) return;
    audio = new AudioContext();
    document.querySelectorAll(".pad").forEach((pad) => {
      const name = pad.dataset.sample;
      buffers.set(name, fetch(`./assets/drums/${name}.wav`)
        .then((response) => response.arrayBuffer())
        .then((data) => audio.decodeAudioData(data))
        .catch(() => null));
    });
  }
  async function hit(pad) {
    pad.classList.add("hit");
    setTimeout(() => pad.classList.remove("hit"), 120);
    ensureAudio();
    if (audio.state === "suspended") audio.resume();
    const buffer = await buffers.get(pad.dataset.sample);
    if (!buffer) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
  }
  const pads = new Map([...document.querySelectorAll(".pad")].map((pad) => [pad.dataset.key, pad]));
  pads.forEach((pad) => pad.addEventListener("pointerdown", () => hit(pad)));
  pads.forEach((pad) => pad.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); hit(pad); }
  }));
  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, textarea")) return;
    const pad = pads.get(event.key.toLowerCase());
    if (pad) hit(pad);
  });

  // Likes search filters the sample list, so the widget answers what the copy promises.
  const likesSearch = document.getElementById("likes-search");
  const likes = [...document.querySelectorAll("#likes-list li")];
  likesSearch.addEventListener("input", () => {
    const query = likesSearch.value.trim().toLowerCase();
    likes.forEach((item) => { item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query); });
  });
})();
