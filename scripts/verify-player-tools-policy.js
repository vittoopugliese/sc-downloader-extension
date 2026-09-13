const assert = require("node:assert/strict");
const policy = require("./player-tools-policy.js");
const initial = policy.normalize();
const exhausted = { ...initial, trial: { ...initial.trial, used: 20 } };
assert.equal(policy.snapshot(initial, "owner").state, "trial_available");
assert.equal(policy.canAuthorize(initial, "owner", "begin-loop").consume, true);
assert.equal(policy.canAuthorize(initial, "owner", "edit-loop").allowed, false);
for (const operation of ["set-rate", "set-preserve-pitch", "save-preset", "set-effect"]) {
  assert.equal(policy.canAuthorize(initial, "owner", operation).allowed, true);
  assert.equal(policy.canAuthorize(exhausted, "owner", operation).reason, "trial-exhausted");
}
for (const capability of ["tempo", "preservePitch", "savePreset", "beginLoop", "editLoop", "maximizeLooper"]) {
  assert.equal(policy.snapshot(exhausted, "owner").capabilities[capability], false);
}
const last = structuredClone(exhausted);
last.trial.grants = [{ ownerKey: "owner", sessionId: "last", trackIdentity: "track", generation: 1 }];
assert.equal(policy.snapshot(last, "owner").state, "trial_last_session");
assert.equal(policy.snapshot(last, "owner").capabilities.tempo, true);
assert.equal(policy.snapshot(last, "owner").capabilities.beginLoop, false);
assert.equal(policy.snapshot(last, "other").capabilities.tempo, false);
assert.equal(policy.canAuthorize(last, "owner", "edit-loop", "last").allowed, true);
assert.equal(policy.canAuthorize(last, "other", "edit-loop", "last").allowed, false);
assert.equal(policy.canAuthorize(last, "other", "begin-loop").reason, "trial-exhausted");
const pro = { ...exhausted, entitlement: { status: "active" } };
for (const operation of ["begin-loop", "export-loop", "export-track-effects", "edit-loop-precise"]) {
  assert.deepEqual(policy.canAuthorize(pro, "owner", operation), { allowed: true, consume: false, reason: null });
  if (operation !== "begin-loop") assert.equal(policy.canAuthorize(initial, "owner", operation).reason, "pro-required");
}
assert.equal(policy.canAuthorize(pro, "owner", "activate-pro").reason, "unknown-operation");
for (const corrupt of [null, {}, { ...initial, schemaVersion: 2 },
  { ...initial, trial: { ...initial.trial, used: -1 } },
  { ...initial, trial: { ...initial.trial, used: 21 } },
  { ...last, trial: { ...last.trial, grants: [...last.trial.grants, ...last.trial.grants] } }]) {
  assert.throws(() => policy.normalize(corrupt), { code: "access-state-invalid" });
}
assert.equal(policy.normalize({ ...initial, revision: undefined }).revision, 0, "legacy v1 migration");
console.log("Player Tools policy verification passed.");
