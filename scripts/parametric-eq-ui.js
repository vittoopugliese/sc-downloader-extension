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
        .peq button, .peq input, .peq select { box-sizing:border-box; min-width:0; border:1px solid #474747; border-radius:5px; background:#262626; color:#eee; font:inherit; font-size:10px; }
        .peq button { padding:4px 7px; cursor:pointer; }
        .peq button[aria-pressed="true"] { border-color:#ff7b38; color:#ffad7b; }
        .peq button:disabled, .peq input:disabled, .peq select:disabled { opacity:.45; cursor:not-allowed; }
        .peq :focus-visible { outline:2px solid #ff8b47; outline-offset:2px; }
        .peq-headroom { margin-left:auto; font-size:9px; color:#aaa; }
        .peq-stage { position:relative; height:172px; border-radius:6px; background:#0c0c0c; touch-action:none; }
        .peq-canvas { display:block; width:100%; height:100%; touch-action:none; }
        .peq .peq-point { position:absolute; width:18px; height:18px; padding:0; border:1px solid #ffd0ad; border-radius:50%; background:#d64c09; color:white; transform:translate(-50%,-50%); font-size:9px; touch-action:none; cursor:grab; }
        .peq .peq-point[aria-pressed="true"] { background:#ff9c5b; color:#111; box-shadow:0 0 0 3px #ff7b3838; }
        .peq-fields { display:grid; grid-template-columns:48px 1.3fr 1fr 1fr auto; gap:5px; margin-top:7px; align-items:end; }
        .peq-fields label { display:flex; flex-direction:column; gap:3px; color:#aaa; font-size:9px; min-width:0; }
        .peq-fields input, .peq-fields select { width:100%; height:25px; padding:3px; }
        .peq-hint, .peq-message { margin:6px 0 0; color:#aaa; font-size:9px; line-height:1.4; }
        .peq-message { color:#ffb68b; }
      </style>
      <summary>Parametric EQ <span>PRO · LIVE</span></summary>
      <div class="peq-body">
        <div class="peq-toolbar"><button type="button" class="peq-bypass" aria-pressed="false">Bypass</button><button type="button" class="peq-add">+ Point</button><button type="button" class="peq-reset">Reset</button><output class="peq-headroom"></output></div>
        <div class="peq-stage"><canvas class="peq-canvas" aria-label="Equalizer response and live frequency spectrum. Double click to add a point; use the point controls below for keyboard editing."></canvas></div>
        <div class="peq-fields">
          <label>Point<select class="peq-select" aria-label="EQ point"></select></label>
          <label>Hz<input class="peq-frequency" aria-label="EQ frequency" type="number" min="20" max="20000" step="1"></label>
          <label>dB<input class="peq-gain" aria-label="EQ gain" type="number" min="-18" max="18" step="0.1"></label>
          <label>Q<input class="peq-q" aria-label="EQ Q" type="number" min="0.1" max="18" step="0.1"></label>
          <button type="button" class="peq-delete" aria-label="Delete EQ point">×</button>
        </div>
        <p class="peq-hint">Double click to add · drag to shape · wheel on a point for Q · Delete to remove. EQ is live only; saved pads and WAV exports do not include it.</p>
        <p class="peq-message" role="status" aria-live="polite" hidden></p>
      </div>`;
    container.append(section);
    const find = (name) => section.querySelector(`.peq-${name}`);
    const canvas = find("canvas");
    const stage = find("stage");
    const ctx = canvas.getContext("2d");
    const fields = Object.fromEntries(["frequency", "gain", "q"].map((name) => [name, find(name)]));
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
      find("delete").disabled = !allowed || selected < 0;
      find("headroom").textContent = `Auto headroom −${api.headroom(settings).toFixed(1)} dB`;
      const select = find("select");
      if (select.options.length !== settings.bands.length) {
        select.replaceChildren(...settings.bands.map((_, index) => new Option(String(index + 1), String(index))));
      }
      select.value = String(selected);
      select.disabled = !allowed || !settings.bands.length;
      for (const [key, field] of Object.entries(fields)) {
        if (section.getRootNode().activeElement !== field) field.value = selected < 0 ? "" : String(Math.round(settings.bands[selected][key] * 100) / 100);
        field.disabled = !allowed || selected < 0;
      }
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
        point.addEventListener("dblclick", (event) => { event.stopPropagation(); selected = index; changeBand({ gain: 0 }); });
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
          for (let x = g.left; x <= g.right; x += 2) {
            const hz = 20 * Math.pow(1000, (x - g.left) / (g.right - g.left));
            const bin = Math.round(hz * spectrum.fftSize / spectrum.sampleRate);
            const db = spectrum.values[bin] ?? -100;
            ctx.lineTo(x, g.bottom - clamp((db + 90) / 80, 0, 1) * (g.bottom - g.top));
          }
          ctx.lineTo(g.right, g.bottom); ctx.closePath(); ctx.fillStyle = "#ff85432b"; ctx.fill();
        }
        const frequencies = Float32Array.from({ length: 192 }, (_, i) => 20 * Math.pow(1000, i / 191));
        // The response remains editable when playback is paused or no track is loaded.
        if (!previewGraph) previewGraph = api.createGraph(new OfflineAudioContext(1, 1, 48000));
        const bypassed = !isAllowed() || effects.snapshot().bypassed;
        const key = `${JSON.stringify(settings)}:${bypassed}`;
        if (previewKey !== key) { previewGraph.apply(settings, bypassed, true); previewKey = key; }
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
    find("delete").addEventListener("click", remove);
    find("bypass").addEventListener("click", () => { settings.enabled = !settings.enabled; commit(); });
    find("reset").addEventListener("click", () => { settings = api.normalize(null); selected = -1; commit(); });
    find("select").addEventListener("change", (event) => { selected = Number(event.target.value); render(); });
    for (const [key, field] of Object.entries(fields)) field.addEventListener("change", () => {
      if (Number.isFinite(field.valueAsNumber)) changeBand({ [key]: field.valueAsNumber });
      else render();
    });
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
