(() => {
  "use strict";
  const t = (key) => globalThis.SCDLI18n.t(`listening_${key}`);
  // Both surfaces render the same state from SoundCloud's existing player.
  globalThis.SCDLListeningView = function createListeningView(host, { cinema = false, command }) {
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{display:block;color:#f5f5f5;font:13px/1.4 system-ui,sans-serif;color-scheme:dark}
      *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:0}
      button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:2px solid #ff853f;outline-offset:4px}
      .player{position:relative;isolation:isolate;overflow:hidden;border-radius:12px;background:#131315;padding:14px;display:grid;grid-template-columns:88px 1fr;gap:12px}
      .glow{position:absolute;inset:-50px;z-index:-1;background-size:cover;background-position:center;filter:blur(50px);opacity:.3;pointer-events:none}
      .cover{position:relative;align-self:center;width:88px;height:88px;border-radius:8px;background:#272333 linear-gradient(135deg,#352243,#173944);background-size:cover;background-position:center;overflow:hidden}
      .hint{position:absolute;inset:0;display:grid;place-items:center;padding:8px;background:#000a;opacity:0;transition:opacity .15s;font-size:11px}
      .cover:hover .hint,.cover:focus-visible .hint{opacity:1}.meta{min-width:0}.eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#ccc;margin-bottom:3px}
      .title,.artist{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title{font-weight:650;font-size:14px}.artist{color:#ccc;font-size:12px}
      .controls{display:flex;align-items:center;gap:12px;margin-top:9px}.controls button{width:30px;height:30px;border-radius:50%;background:#ffffff15;font-size:16px}.controls button:hover{background:#ffffff30}.controls .play{background:#f50;color:white}
      .timeline{grid-column:1/-1;display:flex;align-items:center;gap:9px;font-size:10px;font-variant-numeric:tabular-nums;color:#ccc}.timeline progress{width:100%;height:3px;accent-color:#ff661a}
      progress{-webkit-appearance:none;appearance:none;border:0}progress::-webkit-progress-bar{background:#ffffff30;border-radius:3px}progress::-webkit-progress-value{background:#ff661a;border-radius:3px}
      .close{position:absolute;top:22px;right:24px;border-radius:50%;width:40px;height:40px;background:#ffffff15;font-size:24px}
      .cinema{height:100dvh;border-radius:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#0a0a0f;padding:65px 25px 35px}
      .cinema .glow{opacity:.4;filter:blur(90px)}.cinema .cover{width:min(48vh,65vw,460px);height:min(48vh,65vw,460px);flex-shrink:0;border-radius:14px;box-shadow:0 25px 80px #0008;cursor:default}
      .cinema .meta{text-align:center;max-width:min(600px,90vw)}.cinema .title{font-size:22px}.cinema .artist{font-size:15px}.cinema .controls{justify-content:center;margin-top:18px;gap:24px}.cinema .controls button{width:42px;height:42px}.cinema .timeline{width:min(400px,80vw)}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style><section class="player ${cinema ? "cinema" : ""}">
      <div class="glow"></div>
      ${cinema ? '<button class="close" type="button"><sc-icon name="close" aria-hidden="true"></sc-icon></button>' : ""}
      <button class="cover" type="button"><span class="hint"></span></button>
      <div class="meta"><div class="eyebrow"></div><div class="title"></div><div class="artist"></div>
      <div class="controls"><button type="button" data-command="previous"><sc-icon name="previous" aria-hidden="true"></sc-icon></button><button type="button" class="play" data-command="play"><sc-icon name="play" aria-hidden="true"></sc-icon></button><button type="button" data-command="next"><sc-icon name="next" aria-hidden="true"></sc-icon></button></div></div>
      <div class="timeline"><span class="elapsed">0:00</span><progress max="1" value="0"></progress><span class="duration">0:00</span></div>
    </section>`;
    const el = (selector) => root.querySelector(selector);
    el(".eyebrow").textContent = t("now");
    el(".cover").setAttribute("aria-label", t("open"));
    el(".hint").textContent = t("open");
    el("progress").setAttribute("aria-label", t("progress"));
    if (cinema) {
      el(".hint").remove();
      el(".cover").tabIndex = -1;
      el(".cover").setAttribute("role", "img");
      el(".close").setAttribute("aria-label", t("close"));
      el(".close").onclick = () => command("close");
    } else el(".cover").onclick = () => command("cinema");
    root.querySelectorAll("[data-command]").forEach((button) => {
      button.setAttribute("aria-label", t(button.dataset.command));
      button.onclick = () => command(button.dataset.command);
    });
    const seconds = (value) => String(Math.floor(value % 60)).padStart(2, "0");
    const time = (value) => `${Math.floor(value / 60)}:${seconds(value)}`;
    return {
      root,
      update(state) {
        el(".title").textContent = state.title;
        el(".title").title = state.title;
        el(".artist").textContent = state.artist;
        const background = state.artwork ? `url(${JSON.stringify(state.artwork)})` : "";
        el(".cover").style.backgroundImage = background;
        el(".glow").style.backgroundImage = background;
        if (cinema) el(".cover").setAttribute("aria-label", state.title);
        el(".play sc-icon").setAttribute('name', state.playing ? "pause" : "play");
        el(".play").setAttribute("aria-label", t(state.playing ? "pause" : "play"));
        for (const action of ["play", "previous", "next"]) el(`[data-command="${action}"]`).disabled = !state.controls[action];
        el(".elapsed").textContent = time(state.elapsed);
        el(".duration").textContent = time(state.duration);
        el("progress").value = state.duration > 0 ? Math.min(1, state.elapsed / state.duration) : 0;
      },
    };
  };
})();
