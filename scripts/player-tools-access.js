/* Background-only access module. It owns the trial counter: page scripts
 * receive decisions, never authority to increment or reset the quota. */
(function (root) {
  "use strict";

  const POLICY = root.SCPlayerToolsPolicy;
  const STORAGE_KEY = "scdl.playerTools.access.v1";
  let queue = Promise.resolve();

  function ownerKey(sender) {
    const tab = Number.isInteger(sender?.tab?.id) ? sender.tab.id : "no-tab";
    const frame = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
    const documentId = typeof sender?.documentId === "string" ? sender.documentId : "legacy-document";
    return `${tab}:${frame}:${documentId}`;
  }

  async function read() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return POLICY.normalize(result[STORAGE_KEY]);
  }

  async function write(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: POLICY.normalize(state) });
  }

  function runExclusive(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  function createGrant(owner, payload) {
    return {
      sessionId: crypto.randomUUID(),
      ownerKey: owner,
      trackIdentity: typeof payload?.trackIdentity === "string" ? payload.trackIdentity.slice(0, 1_024) : null,
      generation: Number.isInteger(payload?.generation) ? payload.generation : 0,
      createdAt: Date.now(),
    };
  }

  async function getSnapshot(sender) {
    return POLICY.snapshot(await read(), ownerKey(sender));
  }

  async function authorize(sender, request) {
    return runExclusive(async () => {
      const owner = ownerKey(sender);
      const state = await read();
      const operation = String(request?.operation || "");
      const decision = POLICY.canAuthorize(state, owner, operation, request?.sessionId || null);
      if (!decision.allowed) {
        return { allowed: false, code: decision.reason, snapshot: POLICY.snapshot(state, owner) };
      }

      let grant = POLICY.snapshot(state, owner).grant;
      if (decision.consume && operation === "begin-loop" && state.entitlement.status !== "active") {
        if (grant) {
          return { allowed: true, grant, snapshot: POLICY.snapshot(state, owner) };
        }
        state.trial.used += 1;
        if (state.trial.used === state.trial.limit - 1) state.trial.warnedLastUse = true;
        const created = createGrant(owner, request?.payload);
        state.trial.grants.push(created);
        grant = { sessionId: created.sessionId, trackIdentity: created.trackIdentity, generation: created.generation };
        await write(state);
      }
      return { allowed: true, grant, snapshot: POLICY.snapshot(state, owner) };
    });
  }

  async function endSession(sender, request) {
    return runExclusive(async () => {
      const owner = ownerKey(sender);
      const state = await read();
      const sessionId = String(request?.sessionId || "");
      state.trial.grants = state.trial.grants.filter(
        (grant) => !(grant.ownerKey === owner && grant.sessionId === sessionId)
      );
      await write(state);
      return { success: true, snapshot: POLICY.snapshot(state, owner) };
    });
  }

  async function setEntitlement(entitlement) {
    return runExclusive(async () => {
      const state = await read();
      state.entitlement = entitlement?.status === "active"
        ? { status: "active", licenseId: String(entitlement.licenseId || "").slice(0, 256), checkedAt: Date.now() }
        : { status: "free" };
      await write(state);
      return state;
    });
  }

  root.SCPlayerToolsAccess = { STORAGE_KEY, getSnapshot, authorize, endSession, setEntitlement, ownerKey };
})(globalThis);
