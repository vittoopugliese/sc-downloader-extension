const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "loop-session.js"), "utf8"),
  context
);
const session = vm.runInContext("SCLoopSession.create()", context);
let notifications = 0;
session.subscribe(() => { notifications += 1; });

session.command({
  type: "set-range",
  startMs: 2500,
  endMs: null,
  durationMs: 10000,
  trackIdentity: "media:track-a",
});
assert.equal(session.snapshot().active, false);
assert.equal(session.snapshot().startMs, 2500);

session.command({
  type: "set-range",
  endMs: 2600,
  durationMs: 10000,
  marker: "end",
});
assert.equal(session.snapshot().active, true);
assert.equal(session.snapshot().endMs - session.snapshot().startMs, 250);
assert.equal(session.snapshot().trackIdentity, "media:track-a");

session.command({ type: "set-enabled", enabled: false });
assert.equal(session.snapshot().enabled, false);
session.command({ type: "clear" });
assert.deepEqual(
  JSON.parse(JSON.stringify(session.snapshot())),
  {
    active: false,
    enabled: false,
    startMs: null,
    endMs: null,
    durationMs: null,
    trackIdentity: null,
  }
);
assert.equal(notifications, 4);

console.log("Loop session verification passed.");
