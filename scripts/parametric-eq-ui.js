/* Canvas spectrum with keyboard-accessible parametric EQ controls. */
(() => {
  "use strict";
  function mount({ container, effects, authorize, isAllowed, onChange }) {
    const api = globalThis.SCParametricEQ;
    const section = document.createElement("details");
    section.className = "peq";
    section.innerHTML = `
      <style>
        .peq { margin-top:7px; border:1px solid #343434; border-radius:11px; background:#151515; color:#eee; }
        .peq summary { padding:8px 10px; cursor:pointer; font-size:11px; font-weight:700; }
        .peq summary span { float:right; color:#bca4ee; font-size:9px; }
        .peq-body { padding:0 9px 8px; }
        .peq-toolbar { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
        .peq button { box-sizing:border-box; min-width:0; border:1px solid #474747; border-radius:5px; background:#262626; color:#eee; font:inherit; font-size:10px; }
        .peq button { padding:4px 7px; cursor:pointer; }
        .peq button[aria-pressed="true"] { border-color:#ff7b38; color:#ffad7b; }
        .peq button:disabled { opacity:.45; cursor:not-allowed; }
        .peq :focus-visible { outline:2px solid #ff8b47; outline-offset:2px; }
        .peq-stage { position:relative; height:172px; border-radius:6px; background:#0c0c0c; touch-action:none; }
        .peq-canvas { display:block; width:100%; height:100%; touch-action:none; }
        .peq .peq-point { position:absolute; width:18px; height:18px; padding:0; border:1px solid #ffd0ad; border-radius:50%; background:#d64c09; color:white; transform:translate(-50%,-50%); font-size:9px; touch-action:none; cursor:grab; }
        .peq .peq-point[aria-pressed="true"] { background:#ff9c5b; color:#111; box-shadow:0 0 0 3px #ff7b3838; }
        .peq-message { position:absolute; z-index:2; top:4px; left:28px; right:6px; margin:0; padding:2px 4px; border-radius:3px; color:#ffb68b; background:#17100be8; font-size:9px; line-height:1.4; pointer-events:none; }
      </style>
      <summary>Parametric EQ <span>PRO · LIVE</span></summary>
      <div class="peq-body">
        <div class="peq-toolbar"><button type="button" class="peq-bypass" aria-pressed="false">Bypass</button><button type="button" class="peq-add">+ Point</button><button type="button" class="peq-reset">Reset</button></div>
        <div class="peq-stage"><canvas class="peq-canvas" aria-label="Equalizer response and live frequency spectrum. Double click the graph to add a point, drag a point to edit it, scroll on a point to adjust Q, or double click a point to delete it."></canvas><p class="peq-message" role="status" aria-live="polite" hidden></p></div>
      </div>`;
    container.append(section);
    const find = (name) => section.querySelector(`.peq-${name}`);
    const canvas = find("canvas");
    const stage = find("stage");
    const ctx = canvas.getContext("2d");
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
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const message = (text) => { find("message").textContent = text; find("message").hidden = !text; };
    const geometry = () => ({ width: stage.clientWidth, height: stage.clientHeight, left: 27, right: Math.max(28, stage.clientWidth - 12), top: 12, bottom: stage.clientHeight - 22 });
    const xFor = (hz, g) => g.left + Math.log(hz / 20) / Math.log(1000) * (g.right - g.left);
    const yFor = (gain, g) => g.top + (18 - gain) / 36 * (g.bottom - g.top);
    function bandAt(event) {
      const g = geometry();
      const rect = stage.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, g.left, g.right);
      const y = clamp(event.clientY - rect.top, g.top, g.bottom);
      return { frequency: Math.round(20 * Math.pow(1000, (x - g.left) / (g.right - g.left))),
        gain: Math.round((18 - (y - g.top) / (g.bottom - g.top) * 36) * 10) / 10 };
    }
    async function commit() {
      dirty = true;
      render();
      if (pending) return;
      pending = true;
      try {
        while (dirty) {
          dirty = false;
          const allowed = await authorize();
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
      } finally { pending = false; render(); }
    }
    function changeBand(update) {
      if (!isAllowed() || selected < 0 || !settings.bands[selected]) return;
      Object.assign(settings.bands[selected], update);
      settings = api.normalize(settings);
      commit();
    }
    function add(band = { frequency: 1000, gain: 0 }) {
      if (!isAllowed()) { message("Player Tools Pro is required to use EQ."); return; }
      if (settings.bands.length >= api.MAX_BANDS) { message("All 8 points are in use. Move or delete a point."); return; }
      settings.bands.push({ ...band, q: 1 });
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
      find("bypass").setAttribute("aria-pressed", String(!settings.enabled));
      find("bypass").disabled = !allowed;
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
          changeBand(bandAt(event));
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
          if (event.key === "ArrowUp" || event.key === "ArrowDown") changeBand({ gain: band.gain + (event.key === "ArrowUp" ? 0.5 : -0.5) });
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
        point.style.top = `${yFor(band.gain, g)}px`;
        point.disabled = !allowed;
        point.setAttribute("aria-pressed", String(selected === index));
        point.setAttribute("aria-label", `EQ point ${index + 1}: ${Math.round(band.frequency)} Hz, ${band.gain.toFixed(1)} dB, Q ${band.q.toFixed(2)}`);
      });
      draw();
    }
    function draw() {
      if (!section.open || !visible || !ctx || !stage.clientWidth) return;
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
      for (const db of [-18, -9, 0, 9, 18]) {
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
      if (!visible || !section.open || document.hidden || !section.isConnected) return;
      if (time - lastFrame >= 33) { lastFrame = time; draw(); }
      frame = requestAnimationFrame(tick);
    }
    function schedule() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (visible && section.open && !document.hidden) { render(); frame = requestAnimationFrame(tick); }
    }
    section.addEventListener("toggle", schedule);
    document.addEventListener("visibilitychange", schedule);
    const observer = new ResizeObserver(() => render());
    observer.observe(stage);
    canvas.addEventListener("dblclick", (event) => add(bandAt(event)));
    find("add").addEventListener("click", () => add());
    find("bypass").addEventListener("click", () => { settings.enabled = !settings.enabled; commit(); });
    find("reset").addEventListener("click", () => { settings = api.normalize(null); selected = -1; commit(); });
    render();
    return {
      setVisible(value) { visible = value; schedule(); },
      sync() {
        if (!pending && !dragging) settings = api.normalize(effects.snapshot().eq);
        if (!isAllowed()) message("Player Tools Pro is required to use EQ.");
        render();
      },
    };
  }
  globalThis.SCParametricEQUI = Object.freeze({ mount });
})();
