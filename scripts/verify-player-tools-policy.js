const assert = require("node:assert/strict");
const policy = require("./player-tools-policy.js");
const NOW = 1_800_000_000_000;
const notStarted = policy.normalize();
assert.equal(policy.snapshot(notStarted, "owner", NOW).state, "trial_not_started");
const initial = policy.startTrial(notStarted, NOW);
const exhausted = { ...initial, trial: { ...initial.trial, used: 20 } };
assert.equal(policy.snapshot(initial, "owner", NOW).state, "trial_available");
assert.equal(policy.snapshot(initial, "owner", NOW).trial.daysRemaining, 7);
assert.equal(policy.canAuthorize(initial, "owner", "begin-loop", null, NOW).consume, true);
assert.equal(policy.canAuthorize(initial, "owner", "edit-loop", null, NOW).allowed, false);
for (const operation of ["set-rate", "set-preserve-pitch", "save-preset", "set-effect"]) {
  assert.equal(policy.canAuthorize(initial, "owner", operation, null, NOW).allowed, true);
  assert.equal(policy.canAuthorize(exhausted, "owner", operation, null, NOW).reason, "trial-exhausted");
}
for (const capability of ["tempo", "preservePitch", "savePreset", "beginLoop", "editLoop", "maximizeLooper"]) {
  assert.equal(policy.snapshot(exhausted, "owner", NOW).capabilities[capability], false);
}
const last = structuredClone(exhausted);
last.trial.grants = [{ ownerKey: "owner", sessionId: "last", trackIdentity: "track", generation: 1 }];
assert.equal(policy.snapshot(last, "owner", NOW).state, "trial_last_session");
assert.equal(policy.snapshot(last, "owner", NOW).capabilities.tempo, true);
assert.equal(policy.snapshot(last, "owner", NOW).capabilities.beginLoop, false);
assert.equal(policy.snapshot(last, "other", NOW).capabilities.tempo, false);
assert.equal(policy.canAuthorize(last, "owner", "edit-loop", "last", NOW).allowed, true);
assert.equal(policy.canAuthorize(last, "other", "edit-loop", "last", NOW).allowed, false);
assert.equal(policy.canAuthorize(last, "other", "begin-loop", null, NOW).reason, "trial-exhausted");
const expired = policy.snapshot(initial, "owner", initial.trial.expiresAt);
assert.equal(expired.state, "trial_expired");
assert.equal(expired.capabilities.tempo, false);
assert.equal(policy.canAuthorize(initial, "owner", "set-rate", null, initial.trial.expiresAt).reason, "trial-expired");
assert.equal(policy.snapshot(last, "owner", initial.trial.expiresAt).state, "trial_last_session", "loop 20 grace survives clock expiry");
const pro = { ...exhausted, entitlement: { status: "active" } };
for (const operation of ["begin-loop", "export-loop", "export-track-effects", "edit-loop-precise"]) {
  assert.deepEqual(policy.canAuthorize(pro, "owner", operation, null, NOW), { allowed: true, consume: false, reason: null });
  if (operation !== "begin-loop") assert.equal(policy.canAuthorize(initial, "owner", operation, null, NOW).reason, "pro-required");
}
assert.equal(policy.canAuthorize(pro, "owner", "activate-pro", null, NOW).reason, "unknown-operation");
for (const corrupt of [null, {}, { ...initial, schemaVersion: 3 },
  { ...initial, trial: { ...initial.trial, used: -1 } },
  { ...initial, trial: { ...initial.trial, used: 21 } },
  { ...last, trial: { ...last.trial, grants: [...last.trial.grants, ...last.trial.grants] } }]) {
  assert.throws(() => policy.normalize(corrupt), { code: "access-state-invalid" });
}
const legacy = { ...initial, schemaVersion: 1, revision: undefined, trial: { ...initial.trial } };
delete legacy.trial.startedAt; delete legacy.trial.expiresAt;
assert.equal(policy.normalize(legacy).revision, 0, "legacy v1 migration");
console.log("Player Tools policy verification passed.");
