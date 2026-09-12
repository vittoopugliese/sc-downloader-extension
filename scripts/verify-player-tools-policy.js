const assert = require("node:assert/strict");
const policy = require("./player-tools-policy.js");

const empty = policy.normalize({});
assert.deepEqual(policy.canAuthorize(empty, "tab:0", "set-effect"), {
  allowed: true, consume: false, reason: null,
});
assert.equal(policy.canAuthorize({ trial: { used: 20 } }, "tab:0", "set-effect").allowed, true);
assert.equal(policy.snapshot(empty, "tab:0").state, "trial_available");
assert.equal(policy.snapshot(empty, "tab:0").capabilities.tempo, true);
assert.equal(policy.snapshot(empty, "tab:0").capabilities.preservePitch, true);
assert.equal(policy.snapshot(empty, "tab:0").capabilities.savePreset, true);
for (const operation of ["set-rate", "set-preserve-pitch", "save-preset"]) {
  assert.deepEqual(policy.canAuthorize(empty, "tab:0", operation), {
    allowed: true, consume: false, reason: null,
  });
  assert.equal(
    policy.canAuthorize({ trial: { used: 20 } }, "tab:0", operation).allowed,
    true,
    `${operation} must stay available without an active loop session`
  );
}
assert.deepEqual(policy.canAuthorize(empty, "tab:0", "begin-loop"), {
  allowed: true, consume: false, reason: null,
});
assert.deepEqual(policy.canAuthorize(empty, "tab:0", "edit-loop"), {
  allowed: true, consume: false, reason: null,
});
assert.equal(policy.canAuthorize(empty, "tab:0", "export-loop").allowed, false);

const active = policy.normalize({
  trial: { used: 19, grants: [{ sessionId: "session", ownerKey: "tab:0" }] },
});
assert.equal(policy.snapshot(active, "tab:0").capabilities.tempo, true);
assert.equal(policy.snapshot(active, "other").capabilities.tempo, true);
assert.equal(policy.canAuthorize(active, "tab:0", "set-rate", "session").allowed, true);
assert.equal(policy.canAuthorize(active, "tab:0", "set-rate", "wrong").allowed, true);

const finalSession = policy.normalize({
  trial: { used: 20, grants: [{ sessionId: "last", ownerKey: "tab:0" }] },
});
assert.equal(policy.snapshot(finalSession, "tab:0").state, "trial_last_session");
assert.equal(policy.snapshot(finalSession, "tab:0").capabilities.tempo, true);
assert.equal(policy.snapshot(finalSession, "other").state, "free_locked");
assert.equal(policy.snapshot(finalSession, "other").capabilities.beginLoop, true);
assert.equal(policy.snapshot(finalSession, "other").capabilities.editLoop, true);
assert.equal(policy.canAuthorize(finalSession, "other", "begin-loop").allowed, true);

const pro = policy.normalize({ entitlement: { status: "active", licenseId: "lic_123" } });
assert.equal(policy.snapshot(pro, "tab:0").state, "pro");
assert.equal(policy.canAuthorize(pro, "tab:0", "export-loop").allowed, true);

console.log("Player Tools policy verification passed.");
