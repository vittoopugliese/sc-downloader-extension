/* Player Tools commerce lives in the service worker. Pages only use typed messages. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "scdl.playerTools.commerce.v1";
  const IDENTITY_KEY = "scdl.playerTools.installation.v1";
  const SESSION_MEASURED_KEY = "scdl.playerTools.measured.session.v1";
  const LICENSE_REVALIDATION_ALARM = "scdl.playerTools.license-revalidation";
  const API_BASE_URL = "https://sctd.vpugliese.online/api/player-tools";
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_RESPONSE_BYTES = 256 * 1024;
  const RECEIPTS = root.SCPlayerToolsReceipts || (typeof require === "function" && require("./player-tools-receipts.js"));
  // The production packager replaces this line with `const TEST_LOGIN = null;`.
  const TEST_LOGIN = Object.freeze({ username: "1", password: "1" });
  const OFFER = Object.freeze({
    currency: "USD",
    priceCents: 369,
    kind: "lifetime",
    version: "founder-2026-09",
  });
  const ANALYTICS_EVENTS = new Set([
    "player_tools_promo_seen", "player_tools_opened", "player_tools_value_reached",
    "pro_feature_attempted", "paywall_seen", "checkout_started", "license_activated",
    "download_job_completed",
  ]);

  function create({ storage, identityStorage = null, sessionStorage = null, alarms = null, request = fetch, randomUUID = () => crypto.randomUUID(),
    access, apiBaseUrl = API_BASE_URL, now = () => Date.now(), version = "unknown",
    requestTimeoutMs = REQUEST_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES, entitlementPublicJwk = null }) {
    let queue = Promise.resolve();
    const exclusive = (task) => {
      const next = queue.then(task);
      queue = next.catch(() => {});
      return next;
    };
    async function scheduleRevalidation(state) {
      if (!alarms) return;
      try {
        const expiresAt = state.activation?.receiptExpiresAt;
        if (state.status === "active" && Number.isSafeInteger(expiresAt) && expiresAt < Number.MAX_SAFE_INTEGER) {
          await alarms.create(LICENSE_REVALIDATION_ALARM, { when: Math.max(now() + 1000, expiresAt) });
        } else {
          await alarms.clear(LICENSE_REVALIDATION_ALARM);
        }
      } catch {
        // Every PRO guard still checks receipt expiry if Chrome drops the alarm.
      }
    }
    async function installationId(existing = null) {
      if (!identityStorage) return existing || randomUUID().replaceAll("-", "");
      try {
        const stored = (await identityStorage.get(IDENTITY_KEY))[IDENTITY_KEY];
        if (/^[a-zA-Z0-9_-]{16,128}$/.test(stored || "")) return stored;
        const value = existing || randomUUID().replaceAll("-", "");
        await identityStorage.set({ [IDENTITY_KEY]: value });
        return value;
      } catch {
        return existing || randomUUID().replaceAll("-", "");
      }
    }
    async function read() {
      const raw = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (raw === undefined) {
        const initial = { schemaVersion: 1, installationId: await installationId(),
          status: "free", activation: null, pendingCheckoutAt: null, measured: {} };
        await storage.set({ [STORAGE_KEY]: initial });
        return initial;
      }
      if (!raw || raw.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(raw.installationId || "") ||
          !["free", "pending", "active", "revoked", "error"].includes(raw.status) ||
          !raw.measured || typeof raw.measured !== "object") {
        throw Object.assign(new Error("Invalid commerce state"), { code: "commerce-state-invalid" });
      }
      const stableId = await installationId(raw.installationId);
      if (stableId !== raw.installationId) {
        raw.installationId = stableId;
        raw.activation = null;
        raw.status = "free";
        await storage.set({ [STORAGE_KEY]: raw });
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
        throw Object.assign(new Error(message), { code, status: response.status, payload });
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
      await scheduleRevalidation(state);
      await access.setEntitlement(active ? {
        status: "active", licenseId: state.activation?.licenseId || "", checkedAt: state.activation?.lastCheckedAt || 0,
        expiresAt: state.activation?.receiptExpiresAt || 0, receipt: state.activation?.receipt || null,
      } : { status: "free" });
    }
    async function verifiedReceipt(result, state, expectedType = "pro") {
      if (!RECEIPTS?.verify || result?.active !== true || !result?.receipt) {
        throw Object.assign(new Error("Licensing did not return a valid entitlement."), { code: "invalid-entitlement" });
      }
      const claims = await RECEIPTS.verify(result.receipt, { publicJwk: entitlementPublicJwk, installationId: state.installationId });
      if (claims.type !== expectedType || claims.expiresAt <= now()) {
        throw Object.assign(new Error("The entitlement receipt is expired or has the wrong type."), { code: "invalid-entitlement" });
      }
      if (expectedType === "pro" && (claims.licenseId !== result.licenseId || claims.instanceId !== result.instanceId)) {
        throw Object.assign(new Error("The entitlement receipt does not match the activation."), { code: "invalid-entitlement" });
      }
      return claims;
    }
    async function applyProResult(state, result) {
      const claims = await verifiedReceipt(result, state);
      state.activation = { instanceId: result.instanceId, licenseId: result.licenseId,
        lastCheckedAt: now(), receipt: result.receipt, receiptExpiresAt: claims.expiresAt };
      state.pendingCheckoutAt = null;
      await applyEntitlement(state, true);
    }
    async function validateEntitlement(entitlement) {
      if (entitlement?.licenseId === "test-pro") return Boolean(TEST_LOGIN);
      const state = await read();
      if (!entitlement?.receipt || !state.activation?.instanceId ||
          state.activation.licenseId !== entitlement.licenseId) return false;
      try {
        const claims = await RECEIPTS.verify(entitlement.receipt, {
          publicJwk: entitlementPublicJwk, installationId: state.installationId,
        });
        return claims.type === "pro" && claims.licenseId === state.activation.licenseId &&
          claims.instanceId === state.activation.instanceId && claims.expiresAt > now();
      } catch { return false; }
    }
    function getState({ revalidate = false } = {}) {
      return exclusive(async () => {
        const state = await read();
        if (state.activation?.licenseId === "test-pro") {
          if (!TEST_LOGIN) {
            state.activation = null;
            await applyEntitlement(state, false);
          } else {
            state.activation.receiptExpiresAt = Number.MAX_SAFE_INTEGER;
            await applyEntitlement(state, true);
          }
        } else if (state.activation?.instanceId) {
          let receiptValid = false;
          try {
            const claims = await RECEIPTS.verify(state.activation.receipt, { publicJwk: entitlementPublicJwk, installationId: state.installationId });
            receiptValid = claims.type === "pro" && claims.licenseId === state.activation.licenseId &&
              claims.instanceId === state.activation.instanceId && claims.expiresAt > now();
            state.activation.receiptExpiresAt = claims.expiresAt;
          } catch { receiptValid = false; }
          if (receiptValid) {
            await applyEntitlement(state, true);
          } else if (revalidate) {
          try {
            const result = await post("/license/status", { installationId: state.installationId,
              instanceId: state.activation.instanceId });
            await applyProResult(state, result);
          } catch (error) {
            if (error.code === "license_revoked") await applyEntitlement(state, false, "revoked");
            else { await applyEntitlement(state, false, "error"); }
          }
          } else await applyEntitlement(state, false, "error");
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
        await applyProResult(state, result);
        return publicState(state);
      });
    }
    function activateTest({ username, password }) {
      return exclusive(async () => {
        const state = await read();
        if (!TEST_LOGIN || String(username || "").trim() !== TEST_LOGIN.username || String(password || "") !== TEST_LOGIN.password) {
          throw Object.assign(new Error("Those testing credentials could not activate Pro."), { code: "test_login_failed" });
        }
        state.activation = { instanceId: "local-test", licenseId: "test-pro", lastCheckedAt: now(),
          receipt: null, receiptExpiresAt: Number.MAX_SAFE_INTEGER };
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
    async function verifiedTrial(result, state) {
      if (!result?.trial || !result?.receipt) throw Object.assign(new Error("Trial service returned an invalid response."), { code: "invalid-trial" });
      const claims = await RECEIPTS.verify(result.receipt, { publicJwk: entitlementPublicJwk, installationId: state.installationId });
      if (claims.type !== "trial" || claims.startedAt !== result.trial.startedAt || claims.expiresAt !== result.trial.expiresAt ||
          claims.used !== result.trial.used || claims.limit !== result.trial.limit) {
        throw Object.assign(new Error("Trial receipt does not match its state."), { code: "invalid-trial" });
      }
      return { ...result.trial, receipt: result.receipt,
        ...(Object.hasOwn(result, "allowed") ? { allowed: result.allowed, reason: result.reason || null } : {}) };
    }
    function startTrial() {
      return exclusive(async () => {
        const state = await read();
        return verifiedTrial(await post("/trial/start", { installationId: state.installationId }), state);
      });
    }
    function consumeTrial({ requestId, trackIdentity }) {
      return exclusive(async () => {
        const state = await read();
        try {
          const result = await post("/trial/consume", { installationId: state.installationId, requestId, trackIdentity });
          return verifiedTrial(result, state);
        } catch (error) {
          if (!["trial_expired", "trial_exhausted", "trial_not_started"].includes(error.code)) throw error;
          if (error.payload?.trial && error.payload?.receipt) return verifiedTrial(error.payload, state);
          return { allowed: false, reason: error.code };
        }
      });
    }
    async function validateTrial(value) {
      const state = await read();
      if (!value?.receipt) return false;
      try {
        const claims = await RECEIPTS.verify(value.receipt, {
          publicJwk: entitlementPublicJwk, installationId: state.installationId,
        });
        return claims.type === "trial" && claims.startedAt === value.startedAt &&
          claims.expiresAt === value.expiresAt && claims.used === value.used &&
          claims.limit === value.limit && claims.expiresAt > now();
      } catch { return false; }
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
    return { getState, startCheckout, activate, activateTest, deactivateTest, startTrial, consumeTrial, track, validateEntitlement, validateTrial };
  }

  root.SCPlayerToolsCommerce = { STORAGE_KEY, IDENTITY_KEY, SESSION_MEASURED_KEY, LICENSE_REVALIDATION_ALARM,
    API_BASE_URL, OFFER, ANALYTICS_EVENTS, create };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsCommerce;
})(globalThis);
