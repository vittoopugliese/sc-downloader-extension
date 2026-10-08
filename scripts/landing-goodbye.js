(() => {
  "use strict";

  if (document.documentElement.dataset.view !== "goodbye") return;

  const STORE_URL = "https://chromewebstore.google.com/detail/soundcloud-player-tools-s/gmlijjdgphenebddlpmpiknmmfijfmnk";
  const params = new URLSearchParams(location.search);
  const i18n = window.PTLandingI18n;
  i18n.setLocale(params.get("locale") || navigator.language);
  const { t } = i18n;
  const extensionVersion = params.get("version") || "";

  // Both extensions open this page on uninstall. SoundCloud Track Downloader never shipped
  // past 2026.9.x; Player Tools started at 2026.10.7. A missing version is treated as legacy.
  // If the old listing is ever reinstated with newer versions, pass an explicit edition param.
  function isLegacy(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) return true;
    const [year, month, day] = match.slice(1).map(Number);
    return year * 10000 + month * 100 + day < 20261007;
  }
  const legacy = isLegacy(extensionVersion);
  const storeLink = `${STORE_URL}?utm_source=sctd.vpugliese.online&utm_medium=${legacy ? "uninstall-sctd" : "uninstall-tools"}&utm_campaign=player-tools`;

  const reasons = [
    ["confusing_to_use", "reason_confusing"],
    ["downloads_did_not_work", legacy ? "reason_downloads" : "reason_broken"],
    ["missing_feature", "reason_missing"],
    ["pricing", "reason_pricing"],
    ["no_longer_needed", "reason_unneeded"],
    ["other", "reason_other"],
  ];

  const pitch = legacy
    ? `<header class="bye-head"><h1 id="bye-title">${t("bye_legacy_title")}</h1><p>${t("bye_legacy_lead")}</p></header>
       <section class="bye-pitch" aria-labelledby="pitch-title">
         <div class="bye-stems" aria-hidden="true"><i style="--c:var(--vocals)"></i><i style="--c:var(--drums)"></i><i style="--c:var(--bass)"></i><i style="--c:var(--other)"></i></div>
         <h2 id="pitch-title">${t("bye_pitch_title")}</h2>
         <p>${t("bye_pitch_copy")}</p>
         <a class="install large" href="${storeLink}"><svg aria-hidden="true"><use href="#i-chrome"/></svg><span>${t("bye_pitch_cta")}</span></a>
         <p class="bye-note">${t("bye_pitch_note")}</p>
       </section>`
    : `<header class="bye-head"><h1 id="bye-title">${t("bye_tools_title")}</h1><p>${t("bye_tools_lead")}</p>
         <a class="bye-reinstall" href="${storeLink}">${t("bye_reinstall")}</a></header>`;

  const root = document.getElementById("goodbye-root");
  root.innerHTML = `<main class="bye" aria-labelledby="bye-title">
    <a class="brand" href="/"><img src="./assets/icon128.png" alt="" width="36" height="36">Player Tools</a>
    ${pitch}
    <section class="bye-feedback" aria-labelledby="form-title">
      <h2 id="form-title">${t("bye_form_title")}</h2>
      <form id="feedback-form">
        <fieldset><legend>${t("bye_reason")}</legend>
          ${reasons.map(([value, key], index) => `<label class="bye-radio"><input ${index === 0 ? "required" : ""} type="radio" name="reason" value="${value}"> ${t(key)}</label>`).join("")}
        </fieldset>
        <label class="bye-field">${t("bye_comment")}<textarea name="comment" maxlength="2000" rows="3"></textarea></label>
        <label class="bye-field">${t("bye_email")}<input name="email" type="email" maxlength="254" autocomplete="email"></label>
        <div id="turnstile-widget"></div>
        <p id="feedback-status" role="status" aria-live="polite"></p>
        <div class="bye-actions"><button class="bye-send" id="feedback-submit" type="submit" disabled>${t("bye_send")}</button><button class="bye-skip" type="button">${t("bye_skip")}</button></div>
      </form>
      <p id="feedback-success" class="bye-success" role="status" hidden>${t("bye_success")}</p>
    </section>
  </main>`;
  document.documentElement.lang = i18n.locale;
  document.title = legacy ? t("bye_legacy_title") : t("bye_tools_title");

  const style = document.createElement("style");
  style.textContent = `
    .bye { width: min(640px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }
    .bye .brand { margin-bottom: 48px; }
    .bye-head h1 { margin: 0 0 14px; font: 700 clamp(26px, 4.2vw, 38px)/1.1 var(--display); letter-spacing: -.03em; }
    .bye-head p { margin: 0; font-size: 18px; color: var(--muted); }
    .bye-reinstall { display: inline-block; margin-top: 18px; color: var(--vocals); font-weight: 600; text-underline-offset: 3px; }
    .bye-pitch { margin: 40px 0 0; padding: 28px; border: 1px solid var(--line); border-radius: 20px; background: var(--panel); }
    .bye-stems { display: flex; gap: 6px; margin-bottom: 22px; }
    .bye-stems i { height: 6px; flex: 1; border-radius: 3px; background: var(--c); }
    .bye-pitch h2 { margin: 0 0 10px; font: 600 24px/1.2 var(--display); letter-spacing: -.02em; }
    .bye-pitch > p { margin: 0 0 24px; color: var(--muted); }
    .bye-pitch .bye-note { margin: 14px 0 0; font-size: 14px; }
    .bye-feedback { margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--line); }
    .bye-feedback h2 { margin: 0 0 8px; font: 600 20px/1.25 var(--display); }
    .bye fieldset { display: grid; gap: 4px; margin: 16px 0; padding: 0; border: 0; }
    .bye legend { margin-bottom: 8px; font-weight: 600; }
    .bye-radio { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; }
    .bye-radio input { accent-color: var(--vocals); width: 18px; height: 18px; margin: 0; }
    .bye-field { display: grid; gap: 6px; margin: 16px 0; color: var(--muted); font-size: 15px; }
    .bye-field textarea, .bye-field input { padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--text); resize: vertical; }
    #feedback-status { min-height: 24px; color: var(--drums); font-size: 15px; }
    .bye-actions { display: flex; gap: 12px; align-items: center; }
    .bye-send { padding: 12px 20px; border: 1px solid var(--text); border-radius: 999px; background: transparent; font-weight: 600; cursor: pointer; }
    .bye-send:disabled { opacity: .45; cursor: not-allowed; }
    .bye-skip { padding: 12px 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
    .bye-success { color: var(--bass); font-weight: 600; }
  `;
  document.head.append(style);

  const form = document.getElementById("feedback-form");
  const status = document.getElementById("feedback-status");
  const submit = document.getElementById("feedback-submit");
  const success = document.getElementById("feedback-success");
  const submissionId = crypto.randomUUID();
  let turnstileToken = "";
  let turnstileWidgetId = null;
  const setStatus = (message) => { status.textContent = message; };

  document.querySelector(".bye-skip").addEventListener("click", () => {
    form.hidden = true;
    success.textContent = t("bye_skipped");
    success.hidden = false;
  });

  fetch("/api/uninstall-feedback/config", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      if (!config?.turnstileSiteKey) { setStatus(t("st_unavailable")); return; }
      const container = document.getElementById("turnstile-widget");
      window.scdTurnstileSuccess = (token) => { turnstileToken = token; submit.disabled = false; setStatus(""); };
      window.scdTurnstileExpired = () => { turnstileToken = ""; submit.disabled = true; setStatus(t("st_expired")); };
      window.scdTurnstileError = () => { turnstileToken = ""; submit.disabled = true; setStatus(t("st_unavailable")); };
      window.scdTurnstileLoad = () => {
        if (typeof window.turnstile?.render !== "function") { window.scdTurnstileError(); return; }
        try {
          turnstileWidgetId = window.turnstile.render(container, {
            sitekey: config.turnstileSiteKey,
            action: "uninstall_feedback",
            theme: "dark",
            callback: window.scdTurnstileSuccess,
            "expired-callback": window.scdTurnstileExpired,
            "error-callback": window.scdTurnstileError,
          });
        } catch { window.scdTurnstileError(); }
      };
      setStatus(t("st_loading"));
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=scdTurnstileLoad";
      script.async = true;
      script.defer = true;
      script.onerror = () => setStatus(t("st_unavailable"));
      script.onload = () => { if (typeof window.turnstile?.render !== "function") window.scdTurnstileError(); };
      document.head.append(script);
    })
    .catch(() => setStatus(t("st_unavailable")));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!turnstileToken) { setStatus(t("st_verify_first")); return; }
    const values = new FormData(form);
    const payload = {
      reason: values.get("reason"),
      comment: values.get("comment"),
      email: values.get("email"),
      submissionId,
      locale: params.get("locale") || navigator.language || "",
      extensionVersion,
      turnstileToken,
    };
    setStatus(t("st_sending"));
    submit.disabled = true;
    try {
      const response = await fetch("/api/uninstall-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      form.hidden = true;
      success.hidden = false;
    } catch {
      turnstileToken = "";
      if (turnstileWidgetId !== null && typeof window.turnstile?.reset === "function") window.turnstile.reset(turnstileWidgetId);
      setStatus(t("st_failed"));
    }
  });
})();
