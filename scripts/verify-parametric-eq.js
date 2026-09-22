const assert = require("node:assert/strict");
require("./parametric-eq.js");
const eq = globalThis.SCParametricEQ;
assert.deepEqual(eq.normalize(null), { enabled: true, bands: [] });
const raw = { enabled: true, bands: [{ frequency: 1000, gain: -12, q: 2 }] };
const snapshot = eq.validate(raw);
raw.bands[0].gain = 18;
assert.equal(snapshot.bands[0].gain, -12, "Settings must not retain mutable caller references");
assert.equal(eq.isActive(snapshot), true);
assert.equal(eq.isActive({ ...snapshot, enabled: false }), false);
assert.equal(eq.isActive({ enabled: true, bands: [{ frequency: 1000, gain: 0, q: 1 }] }), false);
for (const field of ["frequency", "gain", "q"]) {
  for (const value of [NaN, Infinity, -Infinity, "1", null]) {
    assert.throws(() => eq.validate({ enabled: true, bands: [{ frequency: 1000, gain: 0, q: 1, [field]: value }] }), /Invalid/);
  }
}
assert.throws(() => eq.validate({ enabled: true, bands: Array(9).fill({ frequency: 1000, gain: 0, q: 1 }) }), /Invalid/);
assert.throws(() => eq.validate({ enabled: true, bands: [{ frequency: 1000, gain: 0, q: 0 }] }), /Invalid/);
assert.deepEqual(eq.normalize({ bands: [{ frequency: -1, gain: 100, q: 0 }] }).bands[0], { frequency: 20, gain: 18, q: 0.1 });
console.log("Parametric EQ settings verification passed (validation, identity, bounds and immutable snapshots).");
