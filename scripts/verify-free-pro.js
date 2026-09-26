const assert = require("node:assert/strict");
const config = require("./release-config.js");
const policy = require("./player-tools-policy.js");
const accessModule = require("./player-tools-access.js");
const commerceModule = require("./player-tools-commerce.js");

(async () => {
  assert.equal(config.FREE_PRO_ENABLED, true, "This release must provide free Pro");
  let externalCalls = 0;
  const unavailable = async () => { externalCalls++; throw new Error("Service unavailable"); };
  const storage = { get: unavailable, set: unavailable };
  const owner = { tab: { id: 1 }, frameId: 0, documentId: "free-user" };
  let now = 1_800_000_000_000;
  const access = accessModule.create({ storage, now: () => now, authority: {
    startTrial: unavailable, consumeTrial: unavailable, ensureEntitlement: unavailable, validateTrial: unavailable,
  } });
  for (const elapsed of [0, 8 * 86400000, 3650 * 86400000]) {
    now += elapsed;
    // Free access must not read any expired, revoked, malformed, or missing stored license/trial.
    const snapshot = await access.startTrial();
    assert.equal(snapshot.plan, "pro");
    assert.equal(snapshot.trial.expiresAt, null);
    assert.ok(Object.values(snapshot.capabilities).every(Boolean));
    assert.equal(policy.snapshot({ corrupt: true }, null, now).plan, "pro");
    for (const operation of ["explore-likes", "set-effect", "set-eq", "save-loop-pad", "play-loop-instrument",
      "set-rate", "set-preserve-pitch", "save-preset", "export-loop", "export-track-effects", "export-wav", "edit-loop-precise"]) {
      assert.equal((await access.authorize(owner, { operation })).allowed, true, operation);
    }
    for (let index = 0; index < 25; index++) {
      assert.equal((await access.authorize(owner, { operation: "begin-loop", requestId: `loop-${index}`,
        expectedGeneration: index, payload: { generation: index, trackIdentity: "track", startMs: 0, endMs: 1000, durationMs: 5000 } })).allowed, true);
    }
  }
  assert.equal((await access.authorize(owner, { operation: "unknown" })).allowed, false);
  assert.equal((await access.authorize(owner, { operation: "begin-loop" })).allowed, false);
  await access.setEntitlement({ status: "free" });
  assert.equal((await access.getSnapshot(owner)).plan, "pro");
  const commerce = commerceModule.create({ storage, request: unavailable, access,
    alarms: { clear: async name => assert.equal(name, commerceModule.LICENSE_REVALIDATION_ALARM) } });
  const state = await commerce.getState({ revalidate: true });
  assert.equal(state.status, "active");
  assert.equal(state.canCheckout, false);
  await assert.rejects(commerce.startCheckout(), { code: "free-pro-enabled" });
  await assert.rejects(commerce.activate({}), { code: "free-pro-enabled" });
  assert.equal(await commerce.track("player_tools_opened"), false);
  assert.equal(externalCalls, 0, "Free Pro must not depend on storage, trials or payment services");
  console.log("Free Pro passed: unlimited offline access, no expiry, no checkout, validated operations.");
})().catch(error => { console.error(error); process.exitCode = 1; });
