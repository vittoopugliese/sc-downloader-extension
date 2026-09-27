/* Edison-inspired time-domain monitor and sample transport. */
(() => {
  "use strict";
  function mount({ container, effects, onCollapsedChange }) {
    const collapsible = globalThis.SCPlayerToolsCollapsible;
    const section = document.createElement("section");
    section.className = "record-section"; section.id = "scdl-record"; section.setAttribute("aria-label", "Record");
    section.innerHTML = `<style>
      ${collapsible.styles}
      .record-section { overflow:hidden; border:1px solid #343434; border-radius:11px; background:#151515; color:#eee; }
      .record-body { padding:2px 9px 9px; }
      .record-toolbar { display:flex; align-items:center; gap:5px; margin:3px 0 7px; }
      .record-section button:not(.tool-section-toggle) { display:inline-flex; align-items:center; justify-content:center; gap:4px; min-height:25px; padding:3px 7px; border:1px solid #474747; border-radius:5px; background:#262626; color:#eee; font:10px system-ui,sans-serif; cursor:pointer; }
      .record-section button:hover:not(:disabled) { border-color:#ff7b38; }
      .record-section button:disabled { opacity:.4; cursor:default; }
      .record-section :focus-visible { outline:2px solid #ff8b47; outline-offset:2px; }
      .record-dot { width:8px; height:8px; border-radius:50%; background:#f05c57; }
      .record-start[aria-pressed=true] { border-color:#fa6868 !important; background:#4e2323 !important; }
      .record-section[data-recording=true] .tool-section-title::after { content:' ●'; color:#ff6b68; }
      .record-time { margin-left:auto; color:#c7d8d5; font:10px ui-monospace,monospace; white-space:nowrap; }
      .record-stage { position:relative; height:126px; overflow:hidden; border:1px solid #586364; border-radius:3px; background:#3e494d; }
      .record-canvas { display:block; width:100%; height:100%; cursor:crosshair; touch-action:none; }
      .record-canvas.is-zoomed { cursor:grab; }
      .record-canvas.is-panning { cursor:grabbing; }
      .record-empty { position:absolute; inset:0; display:grid; place-content:center; text-align:center; pointer-events:none; color:#cad7d6; font:10px/1.6 system-ui,sans-serif; }
      .record-empty[hidden] { display:none; }
      .record-footer { display:flex; align-items:center; gap:7px; margin-top:6px; color:#9fa9aa; font:9px system-ui,sans-serif; }
      .record-notice { position:absolute; inset:auto 5px 5px; margin:0; padding:4px 6px; border-radius:3px; color:#eee; background:#20282bee; font:10px/1.4 system-ui,sans-serif; pointer-events:none; }
    </style>
    ${collapsible.header({ title: "Record", bodyId: "scdl-record-body", expanded: false, toggleClass: "record-toggle", icon: '<img class="tool-section-icon record-icon" alt="" aria-hidden="true" />' })}
    <div class="record-body" id="scdl-record-body" hidden>
      <div class="record-toolbar">
        <button type="button" class="record-start" aria-label="Start recording" aria-pressed="false"><span class="record-dot" aria-hidden="true"></span>Rec</button>
        <button type="button" class="record-stop" aria-label="Stop recording or playback" disabled>■</button>
        <button type="button" class="record-play" aria-label="Play recorded sample" disabled>▶</button>
        <button type="button" class="record-download" aria-label="Download recorded sample as WAV" title="Download recorded sample as WAV. Up to 5 minutes per take. Download to keep your sample." disabled>↓ WAV</button>
        <button type="button" class="record-clear" aria-label="Clear recorded sample" disabled>×</button>
        <output class="record-time" aria-label="Recording duration">00:00.000</output>
      </div>
      <div class="record-stage">
        <canvas class="record-canvas" tabindex="0" role="slider" aria-label="Recorded sample position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" data-scdl-tooltip="Wheel to zoom at the cursor. Drag or Shift + wheel to scroll. Click to seek. Keyboard: + / - zoom, Shift + arrows scroll, 0 resets the view."></canvas>
        <div class="record-empty">Record your mix<br>Track · pads · FX · EQ</div>
      </div>
      <div class="record-footer"><span class="record-format">STEREO · 48 kHz / 16-bit · POST EQ</span></div>
    </div>`;
    container.append(section);
    const find = name => section.querySelector(`.record-${name}`);
    const canvas = find("canvas"), painter = canvas.getContext("2d");
    let visible = false, frame = null, lastPaint = 0, liveReady = false, preparing = false;
    let zoom = 1, scroll = 0, lastState = "idle";
    let pan = null;
    const live = new Float32Array(2048);
    const recorder = globalThis.SCRecord.create({ effects, onChange: render });
    const time = seconds => {
      const ms = Math.round(seconds * 1000);
      return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
    };
    function notice(text) {
      let element = find("notice");
      if (!text) { element?.remove(); return; }
      if (!element) {
        element = document.createElement("p"); element.className = "record-notice";
        element.setAttribute("role", "status"); element.setAttribute("aria-live", "polite");
        find("stage").append(element);
      }
      element.textContent = text;
    }
    const report = error => notice(error.message || "Could not record audio.");
    const syncIcon = () => {
      const url = document.documentElement.getAttribute("data-scdl-extension-record-url");
      if (url) find("icon").src = url;
    };
    syncIcon(); document.addEventListener("scdl:extension-assets-ready", syncIcon);
    const disclosure = collapsible.mount({ section, toggle: find("toggle"), body: find("body"), collapsed: true,
      onChange(value) { updateVisibility(); onCollapsedChange?.(value); } });
    function render() {
      const state = recorder.snapshot();
      const capturing = state.state === "recording" || state.state === "stopping";
      const busy = capturing || state.state === "preparing";
      section.dataset.recording = String(capturing);
      find("start").disabled = busy;
      find("start").setAttribute("aria-pressed", String(capturing));
      find("start").title = state.frames ? "Start a new take (replaces this sample)" : "Record the final mix";
      find("stop").disabled = !capturing && state.state !== "playing";
      find("play").disabled = busy || !state.frames;
      find("play").textContent = state.state === "playing" ? "Ⅱ" : "▶";
      find("play").setAttribute("aria-label", state.state === "playing" ? "Pause recorded sample" : "Play recorded sample");
      find("download").disabled = busy || !state.frames;
      find("clear").disabled = busy || !state.frames;
      canvas.setAttribute("aria-valuemax", String(state.duration));
      if (busy) cancelPan();
      if (state.state === "recording" && lastState !== "recording") { zoom = 1; scroll = 0; }
      lastState = state.state;
      notice(state.message);
      paint();
    }
    function windowRange(state) {
      const span = state.duration / zoom;
      return { start: scroll * (state.duration - span), span };
    }
    function paint() {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      painter.setTransform(dpr, 0, 0, dpr, 0, 0);
      painter.fillStyle = "#3e494d"; painter.fillRect(0, 0, width, height);
      const state = recorder.snapshot(), mid = (height + 16) / 2, scale = (height - 24) / 2;
      canvas.classList.toggle("is-zoomed", zoom > 1);
      const range = windowRange(state);
      painter.fillStyle = "#303a3e"; painter.fillRect(0, 0, width, 16);
      painter.strokeStyle = "#657170"; painter.lineWidth = .5;
      painter.beginPath(); painter.moveTo(0, mid); painter.lineTo(width, mid); painter.stroke();
      painter.fillStyle = "#acbcb9"; painter.font = "8px ui-monospace,monospace";
      for (let i = 0; i < 4; i++) {
        const x = i * width / 4;
        painter.fillText(state.frames ? `${(range.start + range.span * i / 4).toFixed(2)}s` : "LIVE", x + 4, 11);
        painter.fillStyle = "#a1b4af18"; painter.fillRect(x, 16, 1, height - 16); painter.fillStyle = "#acbcb9";
      }
      painter.strokeStyle = "#d1e6df"; painter.lineWidth = 1;
      painter.beginPath();
      if (state.frames) {
        const peaks = recorder.peaks();
        const first = range.start * state.sampleRate / 128, count = range.span * state.sampleRate / 128;
        for (let x = 0; x < width; x++) {
          if (count < width) {
            const from = Math.floor((range.start + x / width * range.span) * state.sampleRate);
            const to = Math.min(state.frames, Math.max(from + 1, Math.ceil((range.start + (x + 1) / width * range.span) * state.sampleRate)));
            let low = 0, high = 0;
            for (let i = from; i < to; i++) for (let channel = 0; channel < 2; channel++) {
              const sample = recorder.sampleAt(i, channel);
              low = Math.min(low, sample); high = Math.max(high, sample);
            }
            painter.moveTo(x + .5, mid - Math.min(1, high) * scale); painter.lineTo(x + .5, mid - Math.max(-1, low) * scale + .5);
            continue;
          }
          const from = Math.floor(first + x / width * count), to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(first + (x + 1) / width * count)));
          let low = 0, high = 0;
          for (let i = from; i < to; i++) { low = Math.min(low, peaks[i][0]); high = Math.max(high, peaks[i][1]); }
          painter.moveTo(x + .5, mid - Math.min(1, high) * scale); painter.lineTo(x + .5, mid - Math.max(-1, low) * scale + .5);
        }
      } else {
        recorder.readLive(live);
        for (let x = 0; x < width; x++) {
          const y = mid - Math.max(-1, Math.min(1, live[Math.floor(x / width * live.length)])) * scale;
          if (!x) painter.moveTo(x, y); else painter.lineTo(x, y);
        }
      }
      painter.stroke();
      const pos = state.state === "recording" ? state.duration : recorder.position();
      if (state.frames) {
        const x = (pos - range.start) / range.span * width;
        if (x >= 0 && x <= width) { painter.fillStyle = state.state === "recording" ? "#ff7770" : "#ffb66f"; painter.fillRect(Math.min(width - 1, x), 16, 1, height - 16); }
      }
      find("empty").hidden = Boolean(state.frames) || (liveReady && live.some(value => Math.abs(value) > .002));
      find("time").textContent = time(state.state === "playing" ? pos : state.duration);
      canvas.setAttribute("aria-valuemax", String(state.duration));
      canvas.setAttribute("aria-valuenow", String(pos));
      canvas.setAttribute("aria-valuetext", time(pos));
    }
    function animate(now) {
      if (now - lastPaint >= 33) { paint(); lastPaint = now; }
      frame = requestAnimationFrame(animate);
    }
    function updateVisibility() {
      cancelPan();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (visible && !disclosure.isCollapsed()) {
        frame = requestAnimationFrame(animate);
        if (!liveReady && !preparing) {
          preparing = true;
          recorder.prepare().then(() => { liveReady = true; }).catch(report).finally(() => { preparing = false; });
        }
      }
    }
    find("start").addEventListener("click", () => recorder.start().catch(report));
    find("stop").addEventListener("click", () => recorder.stop().catch(report));
    find("play").addEventListener("click", () => {
      if (recorder.snapshot().state === "playing") recorder.stopPreview(); else recorder.play().catch(report);
    });
    find("clear").addEventListener("click", () => { cancelPan(); recorder.clear(); zoom = 1; scroll = 0; render(); });
    find("download").addEventListener("click", () => {
      try {
        const url = URL.createObjectURL(recorder.exportWav());
        const link = document.createElement("a"); link.href = url;
        link.download = `SoundCloud-sample-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
        section.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { report(error); }
    });
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const canNavigate = () => {
      const state = recorder.snapshot();
      return state.frames && !["recording", "stopping", "preparing"].includes(state.state);
    };
    function setViewStart(seconds) {
      const duration = recorder.snapshot().duration, span = duration / zoom;
      scroll = duration > span ? clamp(seconds / (duration - span), 0, 1) : 0;
      paint();
    }
    function zoomAt(ratio, direction) {
      const range = windowRange(recorder.snapshot());
      const focus = range.start + ratio * range.span;
      zoom = clamp(zoom * (direction < 0 ? 1.25 : .8), 1, 32);
      setViewStart(focus - ratio * recorder.snapshot().duration / zoom);
    }
    canvas.addEventListener("wheel", event => {
      if (!canNavigate() || pan || (!event.deltaX && !event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      const rect = canvas.getBoundingClientRect(), range = windowRange(recorder.snapshot());
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const pixels = (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1);
        setViewStart(range.start + pixels / rect.width * range.span);
      } else zoomAt(clamp((event.clientX - rect.left) / rect.width, 0, 1), event.deltaY);
    }, { passive: false });
    function cancelPan() {
      if (!pan) return;
      const id = pan.id; pan = null;
      canvas.classList.remove("is-panning");
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary || !canNavigate()) return;
      const range = windowRange(recorder.snapshot());
      pan = { id: event.pointerId, x: event.clientX, y: event.clientY, start: range.start, span: range.span, moved: false };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener("pointermove", event => {
      if (event.pointerId !== pan?.id) return;
      if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 4) return;
      pan.moved = true; canvas.classList.add("is-panning");
      setViewStart(pan.start - (event.clientX - pan.x) / canvas.clientWidth * pan.span);
    });
    canvas.addEventListener("pointerup", event => {
      if (event.pointerId !== pan?.id) return;
      const moved = pan.moved;
      cancelPan();
      if (moved) return;
      const range = windowRange(recorder.snapshot()), rect = canvas.getBoundingClientRect();
      Promise.resolve(recorder.seek(range.start + clamp((event.clientX - rect.left) / rect.width, 0, 1) * range.span)).catch(report);
    });
    for (const type of ["pointercancel", "lostpointercapture", "blur"]) canvas.addEventListener(type, cancelPan);
    canvas.addEventListener("keydown", event => {
      if (!canNavigate()) return;
      if (["+", "=", "-", "0"].includes(event.key) || (event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key))) {
        event.preventDefault(); event.stopPropagation(); cancelPan();
        const range = windowRange(recorder.snapshot());
        if (event.key === "0") { zoom = 1; setViewStart(0); }
        else if (event.shiftKey && event.key.startsWith("Arrow")) setViewStart(range.start + range.span * (event.key === "ArrowLeft" ? -.1 : .1));
        else zoomAt(.5, event.key === "-" ? 1 : -1);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const state = recorder.snapshot();
      const seconds = event.key === "Home" ? 0 : event.key === "End" ? state.duration : recorder.position() + (event.key === "ArrowLeft" ? -1 : 1) * .1;
      Promise.resolve(recorder.seek(seconds)).catch(report);
    });
    const resize = new ResizeObserver(paint); resize.observe(canvas);
    const dispose = () => { if (frame !== null) cancelAnimationFrame(frame); resize.disconnect(); document.removeEventListener("scdl:extension-assets-ready", syncIcon); recorder.dispose(); };
    window.addEventListener("pagehide", event => { if (!event.persisted) dispose(); });
    render();
    return Object.freeze({ setVisible(value) { if (visible === value) return; visible = value; updateVisibility(); },
      isCollapsed: disclosure.isCollapsed,
      setCollapsed(value, options) { disclosure.setCollapsed(value, options); updateVisibility(); }, dispose });
  }
  globalThis.SCRecordUI = Object.freeze({ mount });
})();
