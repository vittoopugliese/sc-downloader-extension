/*
 * Playback control adapted from SoundCloud Tempo Control.
 * Copyright (c) 2026 SoundCloud Tempo Control contributors.
 * Licensed under the MIT License; see THIRD_PARTY_LICENSES.md.
 */
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    min: 0.1,
    max: 3,
    step: 0.0125,
    rate: 1,
    preservePitch: false,
  });
  const PITCH_PROPERTIES = Object.freeze([
    "preservesPitch",
    "mozPreservesPitch",
    "webkitPreservesPitch",
  ]);

  function clampRate(value, minimum = DEFAULTS.min, maximum = DEFAULTS.max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULTS.rate;
    return Math.round(Math.max(minimum, Math.min(maximum, number)) * 10000) / 10000;
  }

  function formatRate(value) {
    // Truncate only the display; playback retains the full half-step precision.
    const thousandths = Math.floor(Number(value) * 1000 + 1e-9);
    return `${(thousandths / 1000).toFixed(3)}x`;
  }

  function create(options = {}) {
    const mediaPrototype =
      options.mediaPrototype || globalThis.HTMLMediaElement?.prototype;
    if (!mediaPrototype) {
      throw new Error("HTMLMediaElement is unavailable");
    }

    const minimum = Number(options.minimum ?? DEFAULTS.min);
    const maximum = Number(options.maximum ?? DEFAULTS.max);
    const isAudio =
      options.isAudio ||
      ((media) =>
        typeof globalThis.HTMLAudioElement === "function" &&
        media instanceof globalThis.HTMLAudioElement);
    const onChange = options.onChange || (() => {});
    const onError = options.onError || (() => {});
    const properties = [
      "playbackRate",
      "defaultPlaybackRate",
      ...PITCH_PROPERTIES,
    ];
    const native = Object.fromEntries(
      properties.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(mediaPrototype, name),
      ])
    );
    const known = new WeakSet();
    const references = new Set();
    let rate = clampRate(options.initialRate, minimum, maximum);
    let preservePitch =
      Boolean(options.initialPreservePitch) && supportsPreservePitch();
    let installed = false;
    let bypassed = false;

    function supportsPreservePitch() {
      return PITCH_PROPERTIES.some((name) => native[name]?.set);
    }

    function snapshot() {
      return Object.freeze({
        min: minimum,
        max: maximum,
        step: DEFAULTS.step,
        rate,
        bypassed,
        effectiveRate: bypassed ? 1 : rate,
        preservePitch,
        preservePitchSupported: supportsPreservePitch(),
      });
    }

    function setNative(audio, name, value) {
      const descriptor = native[name];
      if (descriptor?.set && descriptor.get.call(audio) !== value) {
        descriptor.set.call(audio, value);
      }
    }

    function applyNative(audio) {
      for (const name of PITCH_PROPERTIES) {
        setNative(audio, name, preservePitch);
      }
      setNative(audio, "defaultPlaybackRate", bypassed ? 1 : rate);
      setNative(audio, "playbackRate", bypassed ? 1 : rate);
    }

    function apply(audio) {
      if (!isAudio(audio)) return;
      discover(audio);
      try {
        applyNative(audio);
      } catch (error) {
        onError(error);
      }
    }

    function discover(audio) {
      if (!isAudio(audio) || known.has(audio)) return;
      known.add(audio);
      references.add(new WeakRef(audio));
      for (const event of [
        "play",
        "playing",
        "loadstart",
        "loadedmetadata",
        "ratechange",
        "emptied",
      ]) {
        audio.addEventListener?.(event, () => apply(audio));
      }
    }

    function updateAll() {
      for (const reference of references) {
        const audio = reference.deref();
        if (!audio) references.delete(reference);
        else apply(audio);
      }
      onChange(snapshot());
    }

    function getActiveAudio() {
      const candidates = [];
      for (const reference of references) {
        const audio = reference.deref();
        if (!audio) references.delete(reference);
        else candidates.push(audio);
      }
      const score = (audio) =>
        (audio.paused === false ? 100 : 0) +
        ((audio.currentSrc || audio.src) ? 20 : 0) +
        (audio.readyState >= 1 ? 10 : 0) +
        (Number.isFinite(audio.duration) ? 5 : 0);
      return candidates.sort((left, right) => score(right) - score(left))[0] || null;
    }

    function setRate(value) {
      rate = clampRate(value, minimum, maximum);
      updateAll();
      return snapshot();
    }

    function setBypassed(value) {
      bypassed = Boolean(value);
      updateAll();
      return snapshot();
    }

    function setPreservePitch(value) {
      preservePitch = Boolean(value) && supportsPreservePitch();
      updateAll();
      return snapshot();
    }

    function installGuards() {
      if (installed) return snapshot();
      installed = true;

      for (const name of properties) {
        const descriptor = native[name];
        if (!descriptor?.configurable || !descriptor.set) continue;
        Object.defineProperty(mediaPrototype, name, {
          ...(Object.getOwnPropertyDescriptor(mediaPrototype, name) || descriptor),
          set(value) {
            if (!isAudio(this)) {
              return descriptor.set.call(this, value);
            }
            discover(this);
            if (PITCH_PROPERTIES.includes(name)) {
              return descriptor.set.call(this, preservePitch);
            }
            apply(this);
          },
        });
      }

      const play = mediaPrototype.play;
      if (typeof play === "function") {
        mediaPrototype.play = function (...args) {
          if (isAudio(this)) apply(this);
          return Reflect.apply(play, this, args);
        };
      }

      return snapshot();
    }

    return Object.freeze({
      apply,
      discover,
      getActiveAudio,
      install: installGuards,
      setPreservePitch,
      setRate,
      setBypassed,
      snapshot,
    });
  }

  globalThis.SCTempoControl = Object.freeze({
    DEFAULTS,
    create,
    clampRate,
    formatRate,
  });
})();
