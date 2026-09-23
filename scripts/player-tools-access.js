/* Background is the only writer. Inject storage in tests, never via runtime messages. */
(function (root) {
  "use strict";
  const POLICY = root.SCPlayerToolsPolicy || (typeof require === "function" && require("./player-tools-policy.js"));
  const STORAGE_KEY = "scdl.playerTools.access.v1";

  function ownerKey(sender) {
    if (!Number.isInteger(sender?.tab?.id) || !Number.isInteger(sender?.frameId) ||
        typeof sender?.documentId !== "string" || !sender.documentId || sender.documentId.length > 256) return null;
    return `${sender.tab.id}:${sender.frameId}:${sender.documentId}`;
  }

  function create({ storage, randomUUID = () => crypto.randomUUID(), now = () => Date.now(), authority: initialAuthority = null }) {
    let authority = initialAuthority;
    let queue = Promise.resolve();
    function runExclusive(task) {
      const next = queue.then(task);
      queue = next.catch(() => {});
      return next;
    }
    async function storageCall(method, value) {
      try { return await storage[method](value); }
      catch (cause) { throw Object.assign(new Error("Player Tools storage unavailable", { cause }), { code: "storage-unavailable" }); }
    }
    async function read() {
      const record = (await storageCall("get", STORAGE_KEY))[STORAGE_KEY];
      const state = POLICY.normalize(record);
      if (record === undefined || record?.schemaVersion === 1) await storageCall("set", { [STORAGE_KEY]: state });
      return state;
    }
    async function commit(state) {
      state.revision += 1;
      await storageCall("set", { [STORAGE_KEY]: POLICY.normalize(state) });
    }
    async function verifyEntitlement(state) {
      if (state.entitlement.status !== "active") return true;
      if (typeof authority?.ensureEntitlement === "function") {
        let result;
        try { result = await authority.ensureEntitlement(state.entitlement); }
        catch { result = { status: "unavailable", code: "license-check-required" }; }
        if (result?.status === "active") {
          if (result.entitlement && JSON.stringify(result.entitlement) !== JSON.stringify(state.entitlement)) {
            state.entitlement = result.entitlement; await commit(state);
          }
          return true;
        }
        state.entitlement = result?.status === "unavailable"
          ? { ...state.entitlement, expiresAt: 0 }
          : { status: "free" };
        await commit(state);
        return result?.code || "license-check-required";
      }
      if (typeof authority?.validateEntitlement !== "function") return true;
      let valid = false;
      try { valid = await authority.validateEntitlement(state.entitlement); } catch { valid = false; }
      if (valid) return true;
      // A locally altered, expired or unknown-key receipt can never keep PRO.
      state.entitlement = { status: "free" };
      await commit(state);
      return "pro-required";
    }
    async function verifyTrial(state, grant = null) {
      if (state.trial.startedAt === null || typeof authority?.validateTrial !== "function") return { status: "valid" };
      try {
        const result = await authority.validateTrial({
          receipt: state.trial.receipt, startedAt: state.trial.startedAt,
          expiresAt: state.trial.expiresAt, used: state.trial.used, limit: state.trial.limit,
          grant: grant ? { requestId: grant.requestId, trackIdentity: grant.trackIdentity } : null,
        });
        if (typeof result === "boolean") return { status: result ? "valid" : "unavailable" };
        return result;
      } catch { return { status: "unavailable" }; }
    }
    function getSnapshot(sender) {
      return runExclusive(async () => {
        const state = await read(); await verifyEntitlement(state);
        const owner = ownerKey(sender); const timestamp = now();
        let current = POLICY.snapshot(state, owner, timestamp);
        if (current.state === "trial_last_session") {
          const grant = state.trial.grants.find((item) => item.active && item.ownerKey === owner);
          const validation = await verifyTrial(state, grant);
          if (validation?.status !== "valid" && !(validation?.status === "expired" && validation.grantValid)) {
            grant.active = false; await commit(state); current = POLICY.snapshot(state, owner, timestamp);
          }
        }
        return current;
      });
    }
    function startTrial() {
      return runExclusive(async () => {
        if (!authority?.startTrial) throw Object.assign(new Error("Trial service unavailable"), { code: "trial-unavailable" });
        const state = await read(); const timestamp = now();
        await verifyEntitlement(state);
        const current = POLICY.snapshot(state, null, now());
        if (current.plan === "pro") return current;
        const remote = await authority.startTrial();
        state.trial.startedAt = remote.startedAt;
        state.trial.expiresAt = remote.expiresAt;
        state.trial.used = remote.used;
        state.trial.receipt = remote.receipt || null;
        await commit(state);
        return POLICY.snapshot(state, null, timestamp);
      });
    }
    function authorize(sender, request) {
      return runExclusive(async () => {
        const owner = ownerKey(sender);
        const state = await read(); const timestamp = now();
        const entitlementError = await verifyEntitlement(state);
        const reply = (allowed, code = null, extra = {}) => ({ allowed, code, snapshot: POLICY.snapshot(state, owner, timestamp), ...extra });
        const operation = request?.operation;
        const isLoop = operation === "begin-loop" || operation === "edit-loop";
        if (isLoop) {
          if (!owner) return reply(false, "owner-gone");
          const invalid = POLICY.validateLoopRequest(request);
          if (invalid) return reply(false, invalid);
          // Closed receipts survive Clear/restart. A delayed retry cannot resurrect them.
          const receipt = state.trial.grants.find((g) => g.ownerKey === owner && g.requestId === request.requestId);
          const matches = (g) => g.trackIdentity === request.payload.trackIdentity && g.generation === request.expectedGeneration;
          if (operation === "begin-loop" && receipt) {
            if (!receipt.active || !matches(receipt) || (request.sessionId && receipt.sessionId !== request.sessionId)) {
              return reply(false, "stale-generation");
            }
            const current = POLICY.snapshot(state, owner, timestamp);
            if (!current.capabilities.editLoop) return reply(false, current.trial.expired ? "trial-expired" : "trial-exhausted");
            return reply(true, null, { grant: current.grant, replayed: true, notice: null });
          }
          const active = state.trial.grants.find((g) => g.active && g.ownerKey === owner);
          if (active && (!matches(active) || (request.sessionId && active.sessionId !== request.sessionId))) {
            return reply(false, "stale-generation");
          }
        }
        if (state.entitlement.status !== "active" && state.trial.startedAt !== null) {
          const activeGrant = isLoop && operation === "edit-loop" ? state.trial.grants.find((g) =>
            g.active && g.ownerKey === owner && g.sessionId === request.sessionId) : null;
          const trialValidation = await verifyTrial(state, activeGrant);
          if (trialValidation?.status !== "valid" && !(trialValidation?.status === "expired" && activeGrant && trialValidation.grantValid)) {
            const code = trialValidation?.status === "expired" ? "trial-expired" :
              trialValidation?.status === "invalid" ? "trial-invalid" : "trial-unavailable";
            return reply(false, code);
          }
        }
        if (entitlementError !== true && POLICY.canAuthorize(state, owner, operation, request?.sessionId, timestamp).reason === "pro-required") {
          return reply(false, entitlementError);
        }
        const decision = POLICY.canAuthorize(state, owner, operation, request?.sessionId, timestamp);
        if (!decision.allowed) return reply(false, decision.reason);
        let notice = null;
        if (decision.consume) {
          if (!authority?.consumeTrial) return reply(false, "trial-unavailable");
          const remote = await authority.consumeTrial({ requestId: request.requestId, trackIdentity: request.payload.trackIdentity });
          state.trial.startedAt = remote.startedAt;
          state.trial.expiresAt = remote.expiresAt;
          state.trial.used = remote.used;
          state.trial.receipt = remote.receipt || state.trial.receipt || null;
          if (!remote.allowed) {
            await commit(state);
            return reply(false, remote.reason || "trial-unavailable");
          }
          // Exhaustion grants grace only to the final loop's document, not all previous owners.
          if (state.trial.used === POLICY.TRIAL_LIMIT) state.trial.grants.forEach((g) => { g.active = false; });
          state.trial.grants.push({ sessionId: randomUUID(), ownerKey: owner, requestId: request.requestId,
            trackIdentity: request.payload.trackIdentity, generation: request.expectedGeneration, active: true });
          if (state.trial.used === POLICY.TRIAL_LIMIT - 1 && !state.trial.warnedLastUse) {
            state.trial.warnedLastUse = true;
            notice = "last-loop-remaining";
          }
          // Commit point: never return a usable grant before this resolves. No automatic refunds.
          await commit(state);
        }
        return reply(true, null, { grant: POLICY.snapshot(state, owner, timestamp).grant, notice });
      });
    }
    function endSession(sender, request) {
      return runExclusive(async () => {
        const owner = ownerKey(sender);
        const state = await read(); const timestamp = now();
        if (!owner) return { success: false, code: "owner-gone" };
        const grant = state.trial.grants.find((g) => g.active && g.ownerKey === owner && g.sessionId === request?.sessionId);
        if (grant) { grant.active = false; await commit(state); }
        return { success: true, snapshot: POLICY.snapshot(state, owner, timestamp) };
      });
    }
    function endTab(tabId) {
      return runExclusive(async () => {
        const state = await read();
        const grants = state.trial.grants.filter((g) => g.active && g.ownerKey.startsWith(`${tabId}:`));
        if (grants.length) { grants.forEach((g) => { g.active = false; }); await commit(state); }
      });
    }
    function setEntitlement(entitlement) {
      return runExclusive(async () => {
        const state = await read();
        const next = entitlement?.status === "active"
          ? { status: "active", licenseId: String(entitlement.licenseId || "").slice(0, 256),
            checkedAt: Number.isSafeInteger(entitlement.checkedAt) ? entitlement.checkedAt : 0,
            expiresAt: Number.isSafeInteger(entitlement.expiresAt) ? entitlement.expiresAt : 0,
            receipt: entitlement.receipt && typeof entitlement.receipt === "object" ? {
              algorithm: entitlement.receipt.algorithm, keyId: entitlement.receipt.keyId,
              payload: entitlement.receipt.payload, signature: entitlement.receipt.signature,
            } : null }
          : { status: "free" };
        if (JSON.stringify(state.entitlement) !== JSON.stringify(next)) {
          state.entitlement = next;
          await commit(state);
        }
        return POLICY.snapshot(state, null, now());
      });
    }
    function configureAuthority(value) {
      if (!value || typeof value.startTrial !== "function" || typeof value.consumeTrial !== "function") {
        throw new Error("Player Tools authority is incomplete.");
      }
      authority = value;
    }
    return { getSnapshot, startTrial, authorize, endSession, endTab, setEntitlement, configureAuthority };
  }
  // No entitlement/reset writer is exposed in the production runtime.
  root.SCPlayerToolsAccess = { STORAGE_KEY, ownerKey, create,
    ...(root.chrome?.storage?.local ? create({ storage: root.chrome.storage.local }) : {}) };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsAccess;
})(globalThis);
