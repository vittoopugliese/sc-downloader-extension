/* Player Tools commerce lives in the service worker. Pages only use typed messages. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "scdl.playerTools.commerce.v1";
  const SESSION_MEASURED_KEY = "scdl.playerTools.measured.session.v1";
  const API_BASE_URL = "https://sctd.vpugliese.online/api/player-tools";
  const OFFER = Object.freeze({
    currency: "USD",
    priceCents: 369,
    referencePriceCents: 679,
    kind: "lifetime",
    version: "founder-2026-09",
  });
  const ANALYTICS_EVENTS = new Set([
    "player_tools_promo_seen", "player_tools_opened", "player_tools_value_reached",
    "pro_feature_attempted", "paywall_seen", "checkout_started", "license_activated",
    "download_job_completed",
  ]);

  function create({ storage, sessionStorage = null, request = fetch, randomUUID = () => crypto.randomUUID(),
    access, apiBaseUrl = API_BASE_URL, now = () => Date.now(), version = "unknown" }) {
    let queue = Promise.resolve();
    const exclusive = (task) => {
      const next = queue.then(task);
      queue = next.catch(() => {});
      return next;
    };
    async function read() {
      const raw = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (raw === undefined) {
        const initial = { schemaVersion: 1, installationId: randomUUID().replaceAll("-", ""),
          status: "free", activation: null, pendingCheckoutAt: null, measured: {} };
        await storage.set({ [STORAGE_KEY]: initial });
        return initial;
      }
      if (!raw || raw.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(raw.installationId || "") ||
          !["free", "pending", "active", "revoked", "error"].includes(raw.status) ||
          !raw.measured || typeof raw.measured !== "object") {
        throw Object.assign(new Error("Invalid commerce state"), { code: "commerce-state-invalid" });
      }
      return structuredClone(raw);
    }
    const write = (state) => storage.set({ [STORAGE_KEY]: state });
    async function post(path, body) {
      let response;
      try {
        response = await request(`${apiBaseUrl}${path}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw Object.assign(new Error("Player Tools licensing is temporarily unavailable.", { cause }), { code: "service-unavailable" });
      }
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        const code = payload?.error || "service-error";
        const message = code === "activation_failed" ? "That license could not be activated. Check the email and key, then try again."
          : code === "test_login_failed" ? "Those testing credentials could not activate Pro."
          : code === "license_revoked" ? "This purchase was refunded or revoked. Contact support if this looks wrong."
          : "Player Tools licensing is temporarily unavailable.";
        throw Object.assign(new Error(message), { code, status: response.status });
      }
      return payload || {};
    }
    function publicState(state) {
      return { status: state.status, pendingCheckoutAt: state.pendingCheckoutAt,
        offer: OFFER, canCheckout: Boolean(apiBaseUrl), licenseId: state.activation?.licenseId || null,
        lastCheckedAt: state.activation?.lastCheckedAt || null };
    }
    async function applyEntitlement(state, active, status = active ? "active" : "free") {
      state.status = status;
      await write(state);
      await access.setEntitlement(active ? {
        status: "active", licenseId: state.activation?.licenseId || "", checkedAt: now(),
      } : { status: "free" });
    }
    function getState({ revalidate = false } = {}) {
      return exclusive(async () => {
        const state = await read();
        if (revalidate && state.activation?.instanceId) {
          try {
            const result = await post("/license/status", { installationId: state.installationId,
              instanceId: state.activation.instanceId });
            state.activation.lastCheckedAt = now();
            await applyEntitlement(state, result.active === true, result.active ? "active" : "revoked");
          } catch (error) {
            // Offline does not silently revoke a previously validated lifetime purchase.
            if (error.code === "license_revoked") await applyEntitlement(state, false, "revoked");
            else if (state.status !== "active") { state.status = "error"; await write(state); }
          }
        }
        return publicState(state);
      });
    }
    function startCheckout(locale) {
      return exclusive(async () => {
        const state = await read();
        const result = await post("/checkout", { installationId: state.installationId,
          locale: String(locale || "en").slice(0, 16) });
        if (!/^https:\/\//.test(result.checkoutUrl || "")) throw Object.assign(new Error("Checkout did not return a secure URL."), { code: "invalid-checkout" });
        state.status = "pending"; state.pendingCheckoutAt = now();
        await write(state);
        return { ...publicState(state), checkoutUrl: result.checkoutUrl };
      });
    }
    function activate({ licenseKey, email }) {
      return exclusive(async () => {
        const state = await read();
        const result = await post("/license/restore", { installationId: state.installationId,
          licenseKey: String(licenseKey || "").trim(), email: String(email || "").trim() });
        state.activation = { instanceId: result.instanceId, licenseId: result.licenseId, lastCheckedAt: now() };
        state.pendingCheckoutAt = null;
        await applyEntitlement(state, true);
        return publicState(state);
      });
    }
    function activateTest({ username, password }) {
      return exclusive(async () => {
        const state = await read();
        const result = await post("/license/test", { installationId: state.installationId,
          username: String(username || "").trim(), password: String(password || "") });
        state.activation = { instanceId: result.instanceId, licenseId: result.licenseId, lastCheckedAt: now() };
        state.pendingCheckoutAt = null;
        await applyEntitlement(state, true);
        return publicState(state);
      });
    }
    async function track(name, properties = {}, { once = false, scope = "lifetime" } = {}) {
      if (!ANALYTICS_EVENTS.has(name)) return false;
      return exclusive(async () => {
        const state = await read();
        const onceKey = `${name}:${String(properties.surface || properties.category || properties.feature || "")}`;
        let sessionMeasured = {};
        if (once && scope === "session" && sessionStorage) {
          sessionMeasured = (await sessionStorage.get(SESSION_MEASURED_KEY))[SESSION_MEASURED_KEY] || {};
          if (sessionMeasured[onceKey]) return false;
        } else if (once && state.measured[onceKey]) return false;
        const clean = {};
        for (const key of ["surface", "locale", "plan", "trialState", "origin", "category", "feature", "cause", "result", "type", "count"]) {
          const value = properties[key];
          if (typeof value === "string" && value.length <= 64) clean[key] = value;
          else if (key === "count" && Number.isSafeInteger(value) && value >= 0 && value <= 10000) clean[key] = value;
        }
        try {
          await post("/events", { eventId: randomUUID(), installationId: state.installationId,
            name, occurredAt: now(), version, offer: OFFER.version, properties: clean });
          if (once && scope === "session" && sessionStorage) {
            sessionMeasured[onceKey] = now();
            await sessionStorage.set({ [SESSION_MEASURED_KEY]: sessionMeasured });
          } else if (once) { state.measured[onceKey] = now(); await write(state); }
          return true;
        } catch { return false; }
      });
    }
    return { getState, startCheckout, activate, activateTest, track };
  }

  root.SCPlayerToolsCommerce = { STORAGE_KEY, SESSION_MEASURED_KEY, API_BASE_URL, OFFER, ANALYTICS_EVENTS, create };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsCommerce;
})(globalThis);
