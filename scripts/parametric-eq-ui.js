/* Canvas spectrum with keyboard-accessible parametric EQ controls. */
(() => {
  "use strict";
  const HEART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17.2C22 19.85 19.85 22 17.2 22C15.78 22 14.51 21.38 13.63 20.4C12.87 19.55 12.4 18.43 12.4 17.2C12.4 14.55 14.55 12.4 17.2 12.4C18.57 12.4 19.81 12.98 20.69 13.91C20.68 13.91 20.68 13.91 20.69 13.92C21.5 14.78 22 15.93 22 17.2Z"/><path d="M18.48 18.54L15.95 16M18.45 16.03L15.92 18.57"/><path d="M22 8.69C22 10.66 21.49 12.4 20.69 13.91C19.81 12.98 18.57 12.4 17.2 12.4C14.55 12.4 12.4 14.55 12.4 17.2C12.4 18.43 12.87 19.55 13.63 20.4C13.26 20.57 12.92 20.71 12.62 20.81C12.28 20.93 11.72 20.93 11.38 20.81C8.48 19.82 2 15.69 2 8.69C2 5.6 4.49 3.09998 7.56 3.09998C9.37 3.09998 10.99 3.98002 12 5.33002C13.01 3.98002 14.63 3.09998 16.44 3.09998C19.51 3.09998 22 5.6 22 8.69Z"/></svg>`;
  function mount({ container, effects, authorize, isAllowed, onChange, onCollapsedChange }) {
    const api = globalThis.SCParametricEQ;
    const collapsible = globalThis.SCPlayerToolsCollapsible;
    const section = document.createElement("section");
    section.className = "peq";
    section.id = "scdl-parametric-eq";
    section.setAttribute("aria-label", "Parametric EQ");
    const bodyId = "scdl-parametric-eq-body";
    section.innerHTML = `
      <style>
        ${collapsible.styles}
        .peq { margin-top:7px; border:1px solid #343434; border-radius:11px; background:#151515; color:#eee; }
        .peq .tool-section-heading { padding-right:72px; }
        .peq-icon { border-radius:100%; }
        .peq-pro { padding:2px 4px; border:1px solid #8b5cf6; border-radius:4px; color:#f5f3ff; background:#32105e; font-size:8px; line-height:1; }
        .peq-body { padding:0 9px 8px; }
        .peq-toolbar { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
        .peq button:not(.tool-section-toggle) { box-sizing:border-box; min-width:0; border:1px solid #474747; border-radius:5px; background:#262626; color:#eee; font:inherit; font-size:10px; }
        .peq button:not(.tool-section-toggle) { display:inline-grid; place-items:center; min-height:23px; padding:3px 7px; cursor:pointer; }
        .peq-toolbar button:hover:not(:disabled) { border-color:#ff7b38; color:#fff; background:#3a251b; }
        .peq-toolbar button svg { display:block; width:15px; height:15px; }
        .peq-bypass { color:#fa5858 !important; }
        .peq-bypass[aria-pressed="true"] { color:#fff !important; border-color:#777 !important; }
        .peq-header-bypass { width:23px; height:22px; padding:1px !important; border-color:transparent !important; background:transparent !important; }
        .peq-header-bypass svg { width:17px !important; height:17px !important; }
        .peq-clip[aria-pressed="true"] { color:#ff925a; }
        .peq-reset svg, .peq-clip svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .peq button[aria-pressed="true"] { border-color:#ff7b38; color:#ffad7b; }
        .peq button:disabled { opacity:.45; cursor:not-allowed; }
        .peq :focus-visible { outline:2px solid #ff8b47; outline-offset:2px; }
        .peq-stage { position:relative; height:172px; border-radius:6px; background:#0c0c0c; touch-action:none; }
        .peq-canvas { display:block; width:100%; height:100%; touch-action:none; }
        .peq .peq-point { position:absolute; width:18px; height:18px; padding:0; border:1px solid #ffd0ad; border-radius:50%; background:#d64c09; color:white; transform:translate(-50%,-50%); font-size:9px; touch-action:none; cursor:grab; }
        .peq .peq-point[aria-pressed="true"] { background:#ff9c5b; color:#111; box-shadow:0 0 0 3px #ff7b3838; }
        .peq-message { position:absolute; z-index:2; top:4px; left:28px; right:6px; margin:0; padding:2px 4px; border-radius:3px; color:#ffb68b; background:#17100be8; font-size:9px; line-height:1.4; pointer-events:none; }
      </style>
      ${collapsible.header({ title: "Parametric EQ", bodyId, expanded: true, toggleClass: "peq-toggle", icon: '<img class="tool-section-icon peq-icon" alt="" aria-hidden="true" />', actions: `<button type="button" class="peq-bypass peq-header-bypass" aria-pressed="false" aria-label="Bypass EQ" title="Bypass EQ only">${HEART_ICON}</button><span class="peq-pro">PRO</span>` })}
      <div class="peq-body" id="${bodyId}">
        <div class="peq-toolbar"><button type="button" class="peq-add" aria-label="Add EQ point" title="Add a parametric EQ point">+ Point</button><button type="button" class="peq-clip" aria-pressed="false" aria-label="Enable hard clip" title="Enable hard clipping after EQ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 17h4V7h12v10h4"/></svg></button><button type="button" class="peq-reset" aria-label="Reset EQ" title="Reset all EQ points and clipping"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg></button></div>
        <div class="peq-stage"><canvas class="peq-canvas" aria-label="Equalizer response and live frequency spectrum. Double click near the left or right edge for a high-pass or low-pass cutoff. Drag to edit; scroll on a point to adjust Q; double click a point to delete it."></canvas><p class="peq-message" role="status" aria-live="polite" hidden></p></div>
      </div>`;
    container.append(section);
    const find = (name) => section.querySelector(`.peq-${name}`);
    const canvas = find("canvas");
    const stage = find("stage");
    const ctx = canvas.getContext("2d");
    const syncIcon = () => {
      const url = document.documentElement.getAttribute("data-scdl-extension-eq-url");
      if (url) find("icon").src = url;
    };
    syncIcon();
    document.addEventListener("scdl:extension-assets-ready", syncIcon);
    let settings = api.normalize(effects.snapshot().eq);
    let selected = settings.bands.length ? 0 : -1;
    let visible = false;
    let frame = null;
    let lastFrame = 0;
    let pending = false;
    let dirty = false;
    let dragging = null;
    let points = [];
    let lastError = "";
    let previewGraph = null;
    let previewKey = "";
    let operationVersion = 0;
    let collapseController = null;
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const message = (text) => { find("message").textContent = text; find("message").hidden = !text; };
    const geometry = () => ({ width: stage.clientWidth, height: stage.clientHeight, left: 27, right: Math.max(28, stage.clientWidth - 12), top: 12, bottom: stage.clientHeight - 22 });
    const xFor = (hz, g) => g.left + Math.log(hz / 20) / Math.log(1000) * (g.right - g.left);
    const yFor = (gain, g) => g.top + (api.MAX_GAIN_DB - gain) / (2 * api.MAX_GAIN_DB) * (g.bottom - g.top);
    const yForQ = (q, g) => g.top + Math.log(18 / q) / Math.log(180) * (g.bottom - g.top);
    const qForY = (y, g) => clamp(18 * Math.exp(-((y - g.top) / (g.bottom - g.top)) * Math.log(180)), 0.1, 18);
    function bandAt(event) {
      const g = geometry();
      const rect = stage.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, g.left, g.right);
      const y = clamp(event.clientY - rect.top, g.top, g.bottom);
      return { frequency: Math.round(20 * Math.pow(1000, (x - g.left) / (g.right - g.left))),
        gain: Math.round((api.MAX_GAIN_DB - (y - g.top) / (g.bottom - g.top) * 2 * api.MAX_GAIN_DB) * 10) / 10,
        q: qForY(y, g),
        type: x <= g.left + 18 ? "highpass" : x >= g.right - 18 ? "lowpass" : "peaking" };
    }
    async function commit() {
      const version = operationVersion;
      dirty = true;
      render();
      if (pending) return;
      pending = true;
      try {
        while (dirty) {
          dirty = false;
          const allowed = await authorize();
          if (version !== operationVersion) break;
          if (!allowed || !isAllowed()) {
            dirty = false;
            settings = api.normalize(effects.snapshot().eq);
            message("Player Tools Pro is required to use EQ.");
            break;
          }
          // Commit the newest gesture state after authorization, not an older drag sample.
          dirty = false;
          effects.setEqualizer(settings);
          onChange(settings);
          message(effects.snapshot().initialized ? "" : "Play a track to hear EQ and see its spectrum.");
        }
      } catch (error) {
        settings = api.normalize(effects.snapshot().eq);
        message(error?.message || "Could not apply EQ.");
      } finally {
        pending = false;
        render();
        if (dirty) commit();
      }
    }
    function changeBand(update) {
      if (!isAllowed() || selected < 0 || !settings.bands[selected]) return;
      Object.assign(settings.bands[selected], update);
      settings = api.normalize(settings);
      commit();
    }
    function add(band = { frequency: 1000, gain: 0, type: "peaking" }) {
      if (!isAllowed()) { message("Player Tools Pro is required to use EQ."); return; }
      if (settings.bands.length >= api.MAX_BANDS) { message("All 8 points are in use. Move or delete a point."); return; }
      settings.bands.push({ ...band, gain: band.type === "peaking" ? band.gain : 0,
        q: band.type === "peaking" ? 1 : Math.SQRT1_2 });
      selected = settings.bands.length - 1;
      commit();
    }
    function remove() {
      if (!isAllowed() || selected < 0) return;
      settings.bands.splice(selected, 1);
      selected = Math.min(selected, settings.bands.length - 1);
      commit();
    }
    function render() {
      const allowed = isAllowed();
      selected = Math.min(selected, settings.bands.length - 1);
      find("header-bypass").setAttribute("aria-pressed", String(!settings.enabled));
      find("header-bypass").disabled = !allowed;
      find("header-bypass").setAttribute("aria-label", settings.enabled ? "Bypass EQ" : "Enable EQ");
      find("header-bypass").title = settings.enabled ? "Bypass EQ only" : "Enable EQ";
      find("clip").setAttribute("aria-pressed", String(settings.hardClip));
      find("clip").setAttribute("aria-label", settings.hardClip ? "Disable hard clip" : "Enable hard clip");
      find("clip").title = settings.hardClip ? "Disable hard clipping after EQ" : "Enable hard clipping after EQ";
      find("clip").disabled = !allowed;
      find("reset").disabled = !allowed;
      find("add").disabled = !allowed || settings.bands.length >= api.MAX_BANDS;
      while (points.length > settings.bands.length) points.pop().remove();
      while (points.length < settings.bands.length) {
        const index = points.length;
        const point = document.createElement("button");
        point.type = "button";
        point.className = "peq-point";
        point.textContent = String(index + 1);
        point.addEventListener("focus", () => { selected = index; render(); });
        point.addEventListener("pointerdown", (event) => {
          if (!isAllowed() || event.button !== 0) return;
          event.preventDefault();
          selected = index;
          dragging = { index, id: event.pointerId };
          point.setPointerCapture(event.pointerId);
          point.focus();
          render();
        });
        point.addEventListener("pointermove", (event) => {
          if (dragging?.id !== event.pointerId || dragging.index !== index) return;
          const position = bandAt(event);
          changeBand(settings.bands[index].type === "peaking"
            ? { frequency: position.frequency, gain: position.gain }
            : { frequency: position.frequency, q: position.q });
        });
        for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) point.addEventListener(eventName, () => { dragging = null; });
        point.addEventListener("dblclick", (event) => { event.stopPropagation(); selected = index; remove(); });
        point.addEventListener("wheel", (event) => {
          if (!isAllowed()) return;
          event.preventDefault(); event.stopPropagation();
          selected = index;
          changeBand({ q: clamp(settings.bands[index].q * Math.exp(-Math.sign(event.deltaY) * 0.12), 0.1, 18) });
        }, { passive: false });
        point.addEventListener("keydown", (event) => {
          selected = index;
          const band = settings.bands[index];
          if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); remove(); return; }
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            if (band.type === "peaking") changeBand({ gain: band.gain + (event.key === "ArrowUp" ? 0.5 : -0.5) });
            else changeBand({ q: band.q * (event.key === "ArrowUp" ? 1.1 : 1 / 1.1) });
          }
          else if (event.shiftKey) changeBand({ q: band.q * (event.key === "ArrowRight" ? 1.1 : 1 / 1.1) });
          else changeBand({ frequency: band.frequency * (event.key === "ArrowRight" ? 1.05 : 1 / 1.05) });
        });
        stage.append(point);
        points.push(point);
      }
      const g = geometry();
      settings.bands.forEach((band, index) => {
        const point = points[index];
        point.style.left = `${xFor(band.frequency, g)}px`;
        point.style.top = `${band.type === "peaking" ? yFor(band.gain, g) : yForQ(band.q, g)}px`;
        point.disabled = !allowed;
        point.setAttribute("aria-pressed", String(selected === index));
        const type = band.type === "highpass" ? "High-pass" : band.type === "lowpass" ? "Low-pass" : "Bell";
        const description = `${type} ${index + 1}: ${Math.round(band.frequency)} Hz, ${band.type === "peaking" ? `${band.gain.toFixed(1)} dB, ` : ""}Q ${band.q.toFixed(2)}`;
        point.setAttribute("aria-label", description);
        point.title = `${description} · drag ${band.type === "peaking" ? "for frequency/gain" : "for frequency/Q"} · scroll for Q · double-click to remove`;
      });
      draw();
    }
    function draw() {
      if (collapseController?.isCollapsed() || !visible || !ctx || !stage.clientWidth) return;
      const g = geometry();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(g.width * dpr) || canvas.height !== Math.round(g.height * dpr)) {
        canvas.width = Math.round(g.width * dpr); canvas.height = Math.round(g.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.width, g.height);
      ctx.font = "9px system-ui";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#777";
      for (const hz of [20, 100, 1000, 10000, 20000]) {
        const x = xFor(hz, g);
        ctx.strokeStyle = "#252525"; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom); ctx.stroke();
        ctx.textAlign = hz === 20000 ? "right" : "center";
        ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, g.height - 6);
      }
      for (const db of [-api.MAX_GAIN_DB, -api.MAX_GAIN_DB / 2, 0, api.MAX_GAIN_DB / 2, api.MAX_GAIN_DB]) {
        const y = yFor(db, g);
        ctx.strokeStyle = db === 0 ? "#555" : "#252525";
        ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillText(String(db), 2, y + 3);
      }
      try {
        const graph = isAllowed() ? effects.analyseEqualizer() : null;
        const spectrum = graph?.readSpectrum();
        if (spectrum) {
          ctx.beginPath(); ctx.moveTo(g.left, g.bottom);
          for (let x = g.left; x <= g.right; x += 1) {
            const hz = 20 * Math.pow(1000, (x - g.left) / (g.right - g.left));
            const position = hz * spectrum.fftSize / spectrum.sampleRate;
            const bin = Math.min(spectrum.values.length - 2, Math.floor(position));
            const fraction = clamp(position - bin, 0, 1);
            const left = Number.isFinite(spectrum.values[bin]) ? spectrum.values[bin] : -100;
            const right = Number.isFinite(spectrum.values[bin + 1]) ? spectrum.values[bin + 1] : -100;
            const db = left + (right - left) * fraction;
            ctx.lineTo(x, g.bottom - clamp((db + 90) / 80, 0, 1) * (g.bottom - g.top));
          }
          ctx.lineTo(g.right, g.bottom); ctx.closePath(); ctx.fillStyle = "#ff85432b"; ctx.fill();
        }
        const frequencies = Float32Array.from({ length: 192 }, (_, i) => 20 * Math.pow(1000, i / 191));
        // The response remains editable when playback is paused or no track is loaded.
        if (!previewGraph) previewGraph = api.createGraph(new OfflineAudioContext(1, 1, 48000));
        const key = JSON.stringify(settings.bands);
        if (previewKey !== key) { previewGraph.apply({ enabled: true, bands: settings.bands }, false, true); previewKey = key; }
        const response = previewGraph.response(frequencies);
        ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.right - g.left, g.bottom - g.top); ctx.clip();
        ctx.strokeStyle = settings.enabled && isAllowed() && !effects.snapshot().bypassed ? "#ff995c" : "#777";
        ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < frequencies.length; i++) {
          const x = xFor(frequencies[i], g), y = yFor(Number.isFinite(response?.[i]) ? response[i] : 0, g);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.restore();
      } catch (error) {
        if (lastError !== error.message) { lastError = error.message; message(lastError); }
      }
    }
    function tick(time) {
      frame = null;
      if (!visible || collapseController?.isCollapsed() || document.hidden || !section.isConnected) return;
      if (time - lastFrame >= 33) { lastFrame = time; draw(); }
      frame = requestAnimationFrame(tick);
    }
    function schedule() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (visible && !collapseController?.isCollapsed() && !document.hidden) { render(); frame = requestAnimationFrame(tick); }
    }
    collapseController = collapsible.mount({
      section,
      toggle: find("toggle"),
      body: find("body"),
      collapsed: true,
      onChange(value) { schedule(); onCollapsedChange?.(value); },
    });
    document.addEventListener("visibilitychange", schedule);
    const observer = new ResizeObserver(() => render());
    observer.observe(stage);
    canvas.addEventListener("dblclick", (event) => add(bandAt(event)));
    find("add").addEventListener("click", () => add());
    find("header-bypass").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      settings.enabled = !settings.enabled;
      commit();
    });
    find("clip").addEventListener("click", () => { settings.hardClip = !settings.hardClip; commit(); });
    find("reset").addEventListener("click", () => { settings = api.normalize(null); selected = -1; commit(); });
    render();
    return {
      setVisible(value) { visible = value; schedule(); },
      setCollapsed(value, options) { collapseController.setCollapsed(value, options); schedule(); },
      isCollapsed() { return collapseController.isCollapsed(); },
      sync() {
        if (!pending && !dragging) settings = api.normalize(effects.snapshot().eq);
        if (!isAllowed()) message("Player Tools Pro is required to use EQ.");
        render();
      },
      reset() {
        operationVersion += 1;
        dirty = false;
        dragging = null;
        settings = api.normalize(effects.snapshot().eq);
        selected = -1;
        message("");
        render();
      },
    };
  }
  globalThis.SCParametricEQUI = Object.freeze({ mount });
})();
