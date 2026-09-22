/* Player Tools commerce lives in the service worker. Pages only use typed messages. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "scdl.playerTools.commerce.v1";
  const SESSION_MEASURED_KEY = "scdl.playerTools.measured.session.v1";
  const API_BASE_URL = "https://sctd.vpugliese.online/api/player-tools";
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_RESPONSE_BYTES = 256 * 1024;
  // The production packager replaces this line with `const TEST_LOGIN = null;`.
  const TEST_LOGIN = Object.freeze({ username: "1", password: "1" });
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
    access, apiBaseUrl = API_BASE_URL, now = () => Date.now(), version = "unknown",
    requestTimeoutMs = REQUEST_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES }) {
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
    async function readResponse(response) {
      const declaredValue = response.headers?.get?.("Content-Length");
      const declared = declaredValue == null ? null : Number(declaredValue);
      if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxResponseBytes)) {
        response.body?.cancel?.().catch?.(() => {});
        throw Object.assign(new Error("Licensing returned an oversized response."), { code: "response-too-large" });
      }
      const reader = response.body?.getReader?.();
      if (!reader) return response.json();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) || size + value.byteLength > maxResponseBytes) {
            throw Object.assign(new Error("Licensing returned an oversized response."), { code: "response-too-large" });
          }
          size += value.byteLength; chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock?.();
      }
    }
    async function post(path, body) {
      const controller = new AbortController();
      let timedOut = false; let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true; controller.abort();
          reject(Object.assign(new Error("Player Tools licensing timed out."), { code: "network-timeout" }));
        }, requestTimeoutMs);
      });
      let response; let payload = null;
      try {
        ({ response, payload } = await Promise.race([(async () => {
          const received = await request(`${apiBaseUrl}${path}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(body), signal: controller.signal,
          });
          let parsed = null;
          try { parsed = await readResponse(received); }
          catch (error) {
            if (error?.code === "response-too-large") throw error;
            if (received.ok) throw Object.assign(new Error("Licensing returned an invalid response."), { code: "invalid-response", cause: error });
          }
          return { response: received, payload: parsed };
        })(), timeout]));
      } catch (cause) {
        if (timedOut || cause?.code === "network-timeout") throw Object.assign(new Error("Player Tools licensing timed out.", { cause }), { code: "network-timeout" });
        if (["response-too-large", "invalid-response"].includes(cause?.code)) throw cause;
        throw Object.assign(new Error("Player Tools licensing is temporarily unavailable.", { cause }), { code: "service-unavailable" });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const code = payload?.error || "service-error";
        const message = code === "activation_failed" ? "That license could not be activated. Check the email and key, then try again."
          : code === "seat_limit" ? "This license already has two active Chrome profiles. Contact support to release one."
          : code === "activation_in_progress" ? "This activation is still being confirmed. Please try again shortly."
          : code === "license_revoked" ? "This purchase was refunded or revoked. Contact support if this looks wrong."
          : "Player Tools licensing is temporarily unavailable.";
        throw Object.assign(new Error(message), { code, status: response.status });
      }
      return payload || {};
    }
    function publicState(state) {
      return { status: state.status, pendingCheckoutAt: state.pendingCheckoutAt,
        offer: OFFER, canCheckout: Boolean(apiBaseUrl), licenseId: state.activation?.licenseId || null,
        lastCheckedAt: state.activation?.lastCheckedAt || null, testAccessAvailable: Boolean(TEST_LOGIN) };
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
        if (state.activation?.licenseId === "test-pro") {
          if (!TEST_LOGIN) {
            state.activation = null;
            await applyEntitlement(state, false);
          } else await applyEntitlement(state, true);
        } else if (revalidate && state.activation?.instanceId) {
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
        if (!TEST_LOGIN || String(username || "").trim() !== TEST_LOGIN.username || String(password || "") !== TEST_LOGIN.password) {
          throw Object.assign(new Error("Those testing credentials could not activate Pro."), { code: "test_login_failed" });
        }
        state.activation = { instanceId: "local-test", licenseId: "test-pro", lastCheckedAt: now() };
        state.pendingCheckoutAt = null;
        await applyEntitlement(state, true);
        return publicState(state);
      });
    }
    function deactivateTest() {
      return exclusive(async () => {
        const state = await read();
        if (!TEST_LOGIN || state.activation?.licenseId !== "test-pro") return publicState(state);
        state.activation = null;
        state.pendingCheckoutAt = null;
        await applyEntitlement(state, false);
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
    return { getState, startCheckout, activate, activateTest, deactivateTest, track };
  }

  root.SCPlayerToolsCommerce = { STORAGE_KEY, SESSION_MEASURED_KEY, API_BASE_URL, OFFER, ANALYTICS_EVENTS, create };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsCommerce;
})(globalThis);
