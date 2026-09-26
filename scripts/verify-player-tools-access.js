const assert = require("node:assert/strict");
globalThis.SCReleaseConfig = Object.freeze({ FREE_PRO_ENABLED: false });
const policy = require("./player-tools-policy.js");
const { create, STORAGE_KEY, ownerKey } = require("./player-tools-access.js");
const owner = { tab: { id: 1 }, frameId: 0, documentId: "document-a" };
const other = { tab: { id: 2 }, frameId: 0, documentId: "document-b" };
const request = (requestId = "request-a", overrides = {}) => ({ operation: "begin-loop", requestId,
  expectedGeneration: 1, payload: { trackIdentity: "track-a", generation: 1, startMs: 0, endMs: 1000, durationMs: 5000 }, ...overrides });

function fixture(used) {
  let data = {};
  let clock = 1_800_000_000_000;
  if (used !== undefined) {
    const state = policy.normalize(); state.trial.used = used;
    data[STORAGE_KEY] = state;
  }
  let writes = 0;
  let fail = false;
  let serverStartedAt = null;
  let serverUsed = used || 0;
  const consumptions = new Map();
  const authority = {
    async startTrial() {
      if (serverStartedAt == null) serverStartedAt = clock;
      return { startedAt: serverStartedAt, expiresAt: serverStartedAt + policy.TRIAL_DURATION_MS, used: serverUsed, limit: 20 };
    },
    async consumeTrial(value) {
      if (consumptions.has(value.requestId)) return { ...consumptions.get(value.requestId), allowed: true };
      const current = { startedAt: serverStartedAt, expiresAt: serverStartedAt + policy.TRIAL_DURATION_MS,
        used: serverUsed, limit: 20 };
      if (serverStartedAt == null || clock >= serverStartedAt + policy.TRIAL_DURATION_MS) return { ...current, allowed: false, reason: "trial-expired" };
      if (serverUsed >= 20) return { ...current, allowed: false, reason: "trial-exhausted" };
      serverUsed += 1;
      const result = { startedAt: serverStartedAt, expiresAt: serverStartedAt + policy.TRIAL_DURATION_MS, used: serverUsed, limit: 20 };
      consumptions.set(value.requestId, result);
      return { ...result, allowed: true };
    },
  };
  const storage = {
    async get() { return structuredClone(data); },
    async set(value) {
      if (fail) throw new Error("disk full");
      writes += 1; data = structuredClone(value);
    },
  };
  return { storage, authority, restart: () => create({ storage, now: () => clock, authority }), read: () => structuredClone(data[STORAGE_KEY]),
    writes: () => writes, fail: (value) => { fail = value; }, advance: (ms) => { clock += ms; },
    serverUse: (value) => { serverUsed = value; } };
}

(async () => {
  const f = fixture(); let access = f.restart();
  await Promise.all([access.getSnapshot(owner), access.getSnapshot(other)]);
  assert.equal(f.writes(), 1, "initialization happens exactly once");
  const started = await access.startTrial();
  assert.equal(started.trial.daysRemaining, 7);
  const startsAt = f.read().trial.startedAt;
  await access.startTrial();
  assert.equal(f.read().trial.startedAt, startsAt, "reopening either entry point does not extend trial");
  assert.equal(ownerKey({ tab: { id: 1 } }), null, "no shared legacy-document identity");
  assert.equal((await access.authorize({}, request())).code, "owner-gone");
  assert.equal((await access.authorize(owner, request("bad", { payload: { startMs: 0 } }))).allowed, false);
  for (const range of [{ startMs: -1 }, { endMs: 249 }, { endMs: 6000 }, { endMs: NaN }, { endMs: "1000" }]) {
    const invalid = request("bad"); Object.assign(invalid.payload, range);
    assert.equal((await access.authorize(owner, invalid)).code, "invalid-range");
  }
  assert.equal(f.read().trial.used, 0);
  const first = await access.authorize(owner, request());
  assert.equal(first.snapshot.used, 1);
  access = f.restart(); // Lose response after durable commit, then retry.
  const replay = await access.authorize(owner, request());
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.grant, first.grant);
  assert.equal(f.read().trial.used, 1);
  assert.equal((await access.authorize(owner, request("new-without-clear"))).code, "session-active");
  const beforeDrag = f.writes();
  for (let i = 0; i < 100; i += 1) {
    const edit = request(`edit-${i}`, { operation: "edit-loop", sessionId: first.grant.sessionId });
    edit.payload.endMs += i;
    assert.equal((await access.authorize(owner, edit)).allowed, true);
  }
  assert.equal(f.writes(), beforeDrag, "drag never writes per pixel");
  const stale = request("stale", { sessionId: first.grant.sessionId, expectedGeneration: 2 });
  stale.payload.generation = 2;
  assert.equal((await access.authorize(owner, stale)).code, "stale-generation");
  await access.endSession(other, { sessionId: first.grant.sessionId });
  assert.ok((await access.getSnapshot(owner)).grant, "another owner cannot revoke grant");
  await access.endSession(owner, { sessionId: first.grant.sessionId });
  const revision = f.read().revision;
  await access.endSession(owner, { sessionId: first.grant.sessionId });
  assert.equal(f.read().revision, revision, "end is idempotent");
  assert.equal((await f.restart().authorize(owner, request())).code, "stale-generation");
  assert.equal((await access.authorize(owner, request("after-clear"))).snapshot.used, 2);

  const final = fixture(19); const finalAccess = final.restart(); await finalAccess.startTrial();
  const decisions = await Promise.all([finalAccess.authorize(owner, request()), finalAccess.authorize(other, request())]);
  assert.equal(decisions.filter((d) => d.allowed).length, 1, "only one winner for last use");
  assert.equal(final.read().trial.used, 20);
  assert.equal((await final.restart().getSnapshot(owner)).state, "trial_last_session");
  assert.equal((await finalAccess.getSnapshot({ ...owner, documentId: "reloaded" })).state, "free_locked");
  assert.equal((await finalAccess.getSnapshot(other)).state, "free_locked");
  await finalAccess.endTab(1);
  assert.equal((await finalAccess.getSnapshot(owner)).state, "free_locked");

  const staleLocal = fixture(19); const staleLocalAccess = staleLocal.restart(); await staleLocalAccess.startTrial();
  staleLocal.serverUse(20);
  const rejectedByAuthority = await staleLocalAccess.authorize(owner, request("server-exhausted"));
  assert.equal(rejectedByAuthority.code, "trial-exhausted");
  assert.equal(staleLocal.read().trial.used, 20, "an authoritative rejection refreshes stale local trial state");

  const warning = fixture(18); const warningAccess = warning.restart(); await warningAccess.startTrial();
  assert.equal((await warningAccess.authorize(owner, request())).notice, "last-loop-remaining");
  assert.equal((await warning.restart().authorize(owner, request())).notice, null);
  assert.equal((await warningAccess.getSnapshot(owner)).warnedLastUse, true);
  await warningAccess.authorize(other, request("final-other"));
  assert.equal((await warningAccess.getSnapshot(owner)).state, "free_locked", "only the final owner retains grace");
  assert.equal((await warningAccess.getSnapshot(other)).state, "trial_last_session");

  const broken = fixture(0); const brokenAccess = broken.restart(); await brokenAccess.startTrial(); broken.fail(true);
  await assert.rejects(brokenAccess.authorize(owner, request()), { code: "storage-unavailable" });
  assert.equal(broken.read().trial.used, 0);
  broken.fail(false);
  assert.equal((await brokenAccess.authorize(owner, request())).snapshot.used, 1, "queue recovers after failure");
  const corruptStorage = { async get() { return { [STORAGE_KEY]: null }; }, async set() { assert.fail("must not reset corrupt data"); } };
  await assert.rejects(create({ storage: corruptStorage }).getSnapshot(owner), { code: "access-state-invalid" });
  const unavailable = create({ storage: { async get() { throw new Error("unavailable"); } } });
  await assert.rejects(unavailable.getSnapshot(owner), { code: "storage-unavailable" });

  const paid = fixture(19);
  const paidState = paid.read(); paidState.entitlement = { status: "active", licenseId: "license-1", checkedAt: 123,
    expiresAt: 1_900_000_000_000 };
  await paid.storage.set({ [STORAGE_KEY]: paidState });
  const paidAccess = paid.restart();
  assert.equal((await paidAccess.authorize(owner, request())).allowed, true);
  assert.equal(paid.read().trial.used, 19);
  assert.equal((await paidAccess.authorize(owner, { operation: "export-loop" })).allowed, true);
  paidState.entitlement = { status: "free" }; await paid.storage.set({ [STORAGE_KEY]: paidState });
  assert.equal((await paidAccess.getSnapshot(owner)).used, 19);
  assert.equal((await paidAccess.authorize(owner, { operation: "export-loop" })).code, "pro-required");
  await paidAccess.setEntitlement({ status: "active", licenseId: "license-1", checkedAt: 123, expiresAt: 1_900_000_000_000 });
  assert.equal((await paidAccess.getSnapshot(owner)).plan, "pro", "validated commerce can grant the shared Pro entitlement");
  await paidAccess.setEntitlement({ status: "free" });
  assert.equal((await paidAccess.getSnapshot(owner)).plan, "free", "revocation preserves trial state while removing Pro");
  paidAccess.configureAuthority({ ...paid.authority, validateEntitlement: async (entitlement) => entitlement?.receipt?.signature === "trusted" });
  await paidAccess.setEntitlement({ status: "active", licenseId: "license-1", checkedAt: 123, expiresAt: 1_900_000_000_000,
    receipt: { algorithm: "ES256", keyId: "test", payload: "payload", signature: "forged" } });
  assert.equal((await paidAccess.authorize(owner, { operation: "export-loop" })).code, "pro-required",
    "a locally forged entitlement is removed before a PRO operation runs");
  await paidAccess.setEntitlement({ status: "active", licenseId: "license-1", checkedAt: 123, expiresAt: 1_900_000_000_000,
    receipt: { algorithm: "ES256", keyId: "test", payload: "payload", signature: "trusted" } });
  assert.equal((await paidAccess.authorize(owner, { operation: "export-loop" })).allowed, true);
  const all = fixture(0); const allAccess = all.restart(); await allAccess.startTrial();
  for (let i = 0; i < 20; i += 1) {
    const result = await allAccess.authorize(owner, request(`loop-${i}`));
    assert.equal(result.snapshot.used, i + 1);
    await allAccess.endSession(owner, { sessionId: result.grant.sessionId });
  }
  assert.equal((await allAccess.authorize(owner, request("loop-21"))).code, "trial-exhausted");
  assert.equal(all.read().trial.grants.length, 20, "durable receipts have a hard lifetime bound");
  assert.equal((await all.restart().authorize(owner, request("loop-0"))).code, "stale-generation");
  const expiredTrial = fixture(0); const expiredAccess = expiredTrial.restart(); await expiredAccess.startTrial();
  expiredTrial.advance(policy.TRIAL_DURATION_MS);
  assert.equal((await expiredAccess.authorize(owner, request("expired"))).code, "trial-expired");
  const freeFx = fixture(0); const freeFxAccess = freeFx.restart(); await freeFxAccess.startTrial();
  const premiumCapabilities = ["premiumEffects", "parametricEq", "saveLoopPad", "loopInstrument", "likesExplorer"];
  let trialValidation = "valid";
  freeFxAccess.configureAuthority({ ...freeFx.authority, async validateTrial() {
    if (trialValidation === "throws") throw new Error("service unavailable");
    return { status: trialValidation };
  } });
  for (const status of ["invalid", "unavailable", "throws"]) {
    trialValidation = status;
    await assert.rejects(freeFxAccess.getSnapshot(owner), { code: "trial-invalid" });
    const free = await freeFxAccess.authorize(owner, { operation: "set-free-effect" });
    assert.equal(free.allowed, true, "free effects remain usable without a verified trial");
    assert.equal(free.snapshot.grant, null);
    for (const [name, enabled] of Object.entries(free.snapshot.capabilities)) {
      assert.equal(enabled, ["openPanel", "freeEffects"].includes(name), `${status}: ${name}`);
    }
    const denied = await freeFxAccess.authorize(owner, { operation: "set-effect" });
    assert.equal(denied.allowed, false);
    assert.equal(denied.snapshot.capabilities.premiumEffects, false, "denials must not restore premium controls either");
  }
  trialValidation = "valid";
  const recovered = await freeFxAccess.authorize(owner, { operation: "set-free-effect" });
  for (const name of premiumCapabilities) assert.equal(recovered.snapshot.capabilities[name], true, name);
  freeFx.advance(policy.TRIAL_DURATION_MS);
  trialValidation = "expired";
  const expiredFree = await freeFxAccess.authorize(owner, { operation: "set-free-effect" });
  assert.equal(expiredFree.allowed, true);
  for (const name of premiumCapabilities) assert.equal(expiredFree.snapshot.capabilities[name], false, name);
  await freeFxAccess.setEntitlement({ status: "active", licenseId: "paid", expiresAt: 1_900_000_000_000 });
  trialValidation = "invalid";
  const proFree = await freeFxAccess.authorize(owner, { operation: "set-free-effect" });
  assert.equal(proFree.snapshot.plan, "pro");
  for (const name of premiumCapabilities) assert.equal(proFree.snapshot.capabilities[name], true, name);
  const lastGrace = fixture(19); const lastGraceAccess = lastGrace.restart(); await lastGraceAccess.startTrial();
  const lastGrant = await lastGraceAccess.authorize(owner, request("last"));
  lastGraceAccess.configureAuthority({ ...lastGrace.authority,
    validateTrial: async (value) => ({ status: "expired", grantValid:
      value.grant?.requestId === "last" && value.grant?.trackIdentity === "track-a" }) });
  lastGrace.advance(policy.TRIAL_DURATION_MS);
  assert.equal((await lastGraceAccess.getSnapshot(owner)).state, "trial_last_session");
  assert.equal((await lastGraceAccess.authorize(owner, request("edit-last", { operation: "edit-loop", sessionId: lastGrant.grant.sessionId }))).allowed, true);
  lastGraceAccess.configureAuthority({ ...lastGrace.authority,
    validateTrial: async () => ({ status: "expired", grantValid: false }) });
  assert.equal((await lastGraceAccess.authorize(owner, request("edit-last-invalid", { operation: "edit-loop", sessionId: lastGrant.grant.sessionId }))).code,
    "trial-expired", "expired grace requires a signed grant that matches the active loop");
  console.log("Player Tools access lifecycle verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
