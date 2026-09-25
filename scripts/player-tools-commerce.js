/* Player Tools commerce lives in the service worker. Pages only use typed messages. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "scdl.playerTools.commerce.v1";
  const IDENTITY_KEY = "scdl.playerTools.installation.v1";
  const SESSION_MEASURED_KEY = "scdl.playerTools.measured.session.v1";
  const LICENSE_REVALIDATION_ALARM = "scdl.playerTools.license-revalidation";
  const API_BASE_URL = "https://sctd-test.vpugliese.online/api/player-tools";
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_RESPONSE_BYTES = 256 * 1024;
  const RECEIPTS = root.SCPlayerToolsReceipts || (typeof require === "function" && require("./player-tools-receipts.js"));
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

  const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
  const MAX_RECEIPT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
  const REVALIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

  function create({ storage, identityStorage = null, legacyIdentityStorage = null, sessionStorage = null, alarms = null, request = fetch, randomUUID = () => crypto.randomUUID(),
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
        if (state.status === "pending" && now() - state.pendingCheckoutAt < 24 * 60 * 60 * 1000) {
          await alarms.create(LICENSE_REVALIDATION_ALARM, { when: now() + 30_000 });
        } else if (state.status === "active" && Number.isSafeInteger(expiresAt) && expiresAt < Number.MAX_SAFE_INTEGER) {
          await alarms.create(LICENSE_REVALIDATION_ALARM, { when: Math.max(now() + 1000,
            Math.min(expiresAt, Math.max(now() + 5 * 60 * 1000,
              (state.activation.lastCheckedAt || now()) + REVALIDATION_INTERVAL_MS))) });
        } else if (state.status === "error" && state.activation?.instanceId) {
          await alarms.create(LICENSE_REVALIDATION_ALARM, { when: now() + 5 * 60 * 1000 });
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
        await identityStorage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
        const stored = (await identityStorage.get(IDENTITY_KEY))[IDENTITY_KEY];
        if (/^[a-zA-Z0-9_-]{16,128}$/.test(stored || "")) return stored;
        let legacy = null;
        if (legacyIdentityStorage && legacyIdentityStorage !== identityStorage) {
          try { legacy = (await legacyIdentityStorage.get(IDENTITY_KEY))[IDENTITY_KEY]; } catch { legacy = null; }
        }
        const value = existing || (/^[a-zA-Z0-9_-]{16,128}$/.test(legacy || "") ? legacy : null) || randomUUID().replaceAll("-", "");
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
          status: "free", activation: null, pendingCheckoutAt: null, measured: {},
          clock: { serverTimeAtValidation: null, clientTimeAtValidation: null, maxObservedClientTime: now() } };
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
      if (!raw.clock || typeof raw.clock !== "object") {
        raw.clock = { serverTimeAtValidation: null, clientTimeAtValidation: null, maxObservedClientTime: now() };
        await storage.set({ [STORAGE_KEY]: raw });
      } else if (!Number.isSafeInteger(raw.clock.maxObservedClientTime) || now() > raw.clock.maxObservedClientTime) {
        raw.clock.maxObservedClientTime = now();
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
        lastCheckedAt: state.activation?.lastCheckedAt || null };
    }
    async function applyEntitlement(state, active, status = active ? "active" : "free") {
      state.status = status;
      await write(state);
      await scheduleRevalidation(state);
    }
    function exclusiveWithAccess(task) {
      // Release the commerce queue before waiting for access: an access guard
      // may itself be waiting for ensureEntitlement on the commerce queue.
      return exclusive(task).then(async (state) => {
        await access.setEntitlement(state.status === "active" ? {
          status: "active", licenseId: state.activation?.licenseId || "", checkedAt: state.activation?.lastCheckedAt || 0,
          expiresAt: state.activation?.receiptExpiresAt || 0, receipt: state.activation?.receipt || null,
        } : { status: "free" });
        return publicState(state);
      });
    }
    async function verifiedReceipt(result, state, expectedType = "pro") {
      if (!RECEIPTS?.verify || result?.active !== true || !result?.receipt) {
        throw Object.assign(new Error("Licensing did not return a valid entitlement."), { code: "invalid-entitlement" });
      }
      const claims = await RECEIPTS.verify(result.receipt, { publicJwk: entitlementPublicJwk, installationId: state.installationId });
      if (claims.type !== expectedType || claims.expiresAt <= now() || claims.issuedAt > claims.expiresAt ||
          claims.expiresAt - claims.issuedAt > MAX_RECEIPT_LIFETIME_MS ||
          (expectedType === "pro" && !Array.isArray(claims.capabilities)) ||
          (expectedType === "pro" && !claims.capabilities.includes("pro"))) {
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
      state.clock = { serverTimeAtValidation: Number.isSafeInteger(result.serverTime) ? result.serverTime : claims.issuedAt,
        clientTimeAtValidation: now(), maxObservedClientTime: Math.max(now(), state.clock?.maxObservedClientTime || 0) };
      state.pendingCheckoutAt = null;
      await applyEntitlement(state, true);
    }
    async function validateEntitlement(entitlement) {
      const state = await read();
      if (state.status === "revoked" || !entitlement?.receipt || !state.activation?.instanceId ||
          state.activation.licenseId !== entitlement.licenseId) return false;
      try {
        const claims = await RECEIPTS.verify(entitlement.receipt, {
          publicJwk: entitlementPublicJwk, installationId: state.installationId,
        });
        const rollback = Number.isSafeInteger(state.clock?.maxObservedClientTime) &&
          now() + CLOCK_ROLLBACK_TOLERANCE_MS < state.clock.maxObservedClientTime;
        return !rollback && Number.isSafeInteger(state.clock?.serverTimeAtValidation) &&
          claims.type === "pro" && Array.isArray(claims.capabilities) && claims.capabilities.includes("pro") &&
          claims.licenseId === state.activation.licenseId && claims.instanceId === state.activation.instanceId &&
          claims.expiresAt > now() && claims.issuedAt <= claims.expiresAt &&
          claims.expiresAt - claims.issuedAt <= MAX_RECEIPT_LIFETIME_MS;
      } catch { return false; }
    }
    function ensureEntitlement(entitlement) {
      return exclusive(async () => {
        if (await validateEntitlement(entitlement)) return { status: "active", entitlement };
        const state = await read();
        if (state.status === "revoked") return { status: "revoked", code: "license_revoked" };
        if (!state.activation?.instanceId) return { status: "invalid", code: "pro-required" };
        const cached = { status: "active", licenseId: state.activation.licenseId,
          checkedAt: state.activation.lastCheckedAt, expiresAt: state.activation.receiptExpiresAt, receipt: state.activation.receipt };
        if (await validateEntitlement(cached)) return { status: "active", entitlement: cached };
        try {
          const result = await post("/license/status", { installationId: state.installationId, instanceId: state.activation.instanceId });
          const claims = await verifiedReceipt(result, state);
          state.activation = { instanceId: result.instanceId, licenseId: result.licenseId,
            lastCheckedAt: now(), receipt: result.receipt, receiptExpiresAt: claims.expiresAt };
          state.status = "active";
          state.clock = { serverTimeAtValidation: Number.isSafeInteger(result.serverTime) ? result.serverTime : claims.issuedAt,
            clientTimeAtValidation: now(), maxObservedClientTime: Math.max(now(), state.clock?.maxObservedClientTime || 0) };
          await write(state); await scheduleRevalidation(state);
          return { status: "active", entitlement: { status: "active", licenseId: state.activation.licenseId,
            checkedAt: state.activation.lastCheckedAt, expiresAt: state.activation.receiptExpiresAt, receipt: state.activation.receipt } };
        } catch (error) {
          if (error.code === "license_revoked") { state.status = "revoked"; await write(state); await scheduleRevalidation(state); return { status: "revoked", code: error.code }; }
          return { status: "unavailable", code: "license-check-required" };
        }
      });
    }
    function getState({ revalidate = false } = {}) {
      return exclusiveWithAccess(async () => {
        const state = await read();
        if (state.status === "pending" && revalidate) {
          try {
            const result = await post("/checkout/claim", { installationId: state.installationId });
            if (result.active === true) await applyProResult(state, result);
          } catch {
            // A pending purchase remains pending and can be claimed on the next
            // SoundCloud return, popup open or service-worker startup.
          }
        }
        if (state.activation?.instanceId && state.status !== "revoked") {
          const receiptValid = await validateEntitlement({ receipt: state.activation.receipt, licenseId: state.activation.licenseId });
          if (receiptValid && !revalidate) {
            await applyEntitlement(state, true);
          } else if (revalidate) {
            try {
              const result = await post("/license/status", { installationId: state.installationId,
                instanceId: state.activation.instanceId });
              await applyProResult(state, result);
            } catch (error) {
              if (error.code === "license_revoked") await applyEntitlement(state, false, "revoked");
              else { await applyEntitlement(state, receiptValid, receiptValid ? "active" : "error"); }
            }
          } else await applyEntitlement(state, false, "error");
        }
        await scheduleRevalidation(state);
        return state;
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
        await scheduleRevalidation(state);
        return { ...publicState(state), checkoutUrl: result.checkoutUrl };
      });
    }
    function activate({ licenseKey, email }) {
      return exclusiveWithAccess(async () => {
        const state = await read();
        const result = await post("/license/restore", { installationId: state.installationId,
          licenseKey: String(licenseKey || "").trim(), email: String(email || "").trim() });
        await applyProResult(state, result);
        return state;
      });
    }
    function claimCheckout() {
      return exclusiveWithAccess(async () => {
        const state = await read();
        if (state.status !== "pending") return state;
        const result = await post("/checkout/claim", { installationId: state.installationId });
        if (result.active === true) await applyProResult(state, result);
        await scheduleRevalidation(state);
        return state;
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
      if (!value?.receipt) return { status: "invalid" };
      if (now() + CLOCK_ROLLBACK_TOLERANCE_MS < state.clock.maxObservedClientTime) return { status: "invalid" };
      try {
        const claims = await RECEIPTS.verify(value.receipt, {
          publicJwk: entitlementPublicJwk, installationId: state.installationId,
        });
        const matches = claims.type === "trial" && claims.startedAt === value.startedAt &&
          claims.expiresAt === value.expiresAt && claims.used === value.used &&
          claims.limit === value.limit && claims.startedAt <= now() + CLOCK_ROLLBACK_TOLERANCE_MS;
        if (!matches) return { status: "invalid" };
        let grantValid = false;
        if (value.grant && typeof claims.grantTrackIdentityHash === "string") {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.grant.trackIdentity));
          const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
          grantValid = claims.grantRequestId === value.grant.requestId && claims.grantTrackIdentityHash === hash &&
            Number.isSafeInteger(claims.graceExpiresAt) && claims.graceExpiresAt > now();
        }
        return { status: claims.expiresAt > now() ? "valid" : "expired", claims, grantValid };
      } catch { return { status: "invalid" }; }
    }
    async function track(name, properties = {}, { once = false, scope = "lifetime", eventId = null } = {}) {
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
          const stableEventId = typeof eventId === "string" && /^[A-Za-z0-9:_-]{8,128}$/.test(eventId) ? eventId : randomUUID();
          await post("/events", { eventId: stableEventId, installationId: state.installationId,
            name, occurredAt: now(), version, offer: OFFER.version, properties: clean });
          if (once && scope === "session" && sessionStorage) {
            sessionMeasured[onceKey] = now();
            await sessionStorage.set({ [SESSION_MEASURED_KEY]: sessionMeasured });
          } else if (once) { state.measured[onceKey] = now(); await write(state); }
          return true;
        } catch { return false; }
      });
    }
    return { getState, startCheckout, claimCheckout, activate, startTrial, consumeTrial, track,
      validateEntitlement, ensureEntitlement, validateTrial };
  }

  root.SCPlayerToolsCommerce = { STORAGE_KEY, IDENTITY_KEY, SESSION_MEASURED_KEY, LICENSE_REVALIDATION_ALARM,
    API_BASE_URL, OFFER, ANALYTICS_EVENTS, CLOCK_ROLLBACK_TOLERANCE_MS, MAX_RECEIPT_LIFETIME_MS, create };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsCommerce;
})(globalThis);
