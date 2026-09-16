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

  function create({ storage, randomUUID = () => crypto.randomUUID(), now = () => Date.now() }) {
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
    function getSnapshot(sender) {
      return runExclusive(async () => { const timestamp = now(); return POLICY.snapshot(await read(), ownerKey(sender), timestamp); });
    }
    function startTrial() {
      return runExclusive(async () => {
        const state = await read(); const timestamp = now();
        const before = state.trial.startedAt;
        const started = POLICY.startTrial(state, timestamp);
        if (started.trial.startedAt !== before) await commit(started);
        return POLICY.snapshot(started, null, timestamp);
      });
    }
    function authorize(sender, request) {
      return runExclusive(async () => {
        const owner = ownerKey(sender);
        const state = await read(); const timestamp = now();
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
        const decision = POLICY.canAuthorize(state, owner, operation, request?.sessionId, timestamp);
        if (!decision.allowed) return reply(false, decision.reason);
        let notice = null;
        if (decision.consume) {
          state.trial.used += 1;
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
            checkedAt: Number.isSafeInteger(entitlement.checkedAt) ? entitlement.checkedAt : 0 }
          : { status: "free" };
        if (JSON.stringify(state.entitlement) !== JSON.stringify(next)) {
          state.entitlement = next;
          await commit(state);
        }
        return POLICY.snapshot(state, null, now());
      });
    }
    return { getSnapshot, startTrial, authorize, endSession, endTab, setEntitlement };
  }
  // No entitlement/reset writer is exposed in the production runtime.
  root.SCPlayerToolsAccess = { STORAGE_KEY, ownerKey, create,
    ...(root.chrome?.storage?.local ? create({ storage: root.chrome.storage.local }) : {}) };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsAccess;
})(globalThis);
