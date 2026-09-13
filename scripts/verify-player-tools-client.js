const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const attributes = new Map(); const listeners = new Map();
const snapshotAttribute = "data-scdl-player-tools-access";
let storageListener; let messageListener; let sent;
let response = { success: true, snapshot: { revision: 2, state: "free_locked", capabilities: { tempo: false } } };
const document = {
  documentElement: { setAttribute: (k, v) => attributes.set(k, v), getAttribute: (k) => attributes.get(k) },
  addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent() {},
};
vm.runInNewContext(fs.readFileSync(require.resolve("./player-tools-client.js"), "utf8"), {
  document, CustomEvent: class { constructor(type) { this.type = type; } },
  chrome: { runtime: { async sendMessage(value) { sent = value; return response; },
    onMessage: { addListener(fn) { messageListener = fn; } } },
    storage: { onChanged: { addListener(fn) { storageListener = fn; } } } },
});
const current = () => JSON.parse(attributes.get(snapshotAttribute));
const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  await tick(); assert.equal(current().revision, 2);
  messageListener({ type: "PLAYER_TOOLS_ACCESS_SNAPSHOT", snapshot: { revision: 1, capabilities: { tempo: true } } });
  assert.equal(current().capabilities.tempo, false, "stale snapshot cannot unlock");
  attributes.set("data-scdl-player-tools-request", JSON.stringify({ version: 1, id: "transport", requestId: "stable",
    operation: "begin-loop", expectedGeneration: 3, payload: { generation: 3 }, plan: "pro" }));
  await listeners.get("scdl:player-tools-request")();
  assert.equal(sent.requestId, "stable"); assert.equal(sent.expectedGeneration, 3);
  assert.equal(sent.plan, undefined, "page cannot transport an entitlement override");
  response = { success: true, snapshot: { revision: 1, capabilities: { tempo: true } } };
  await listeners.get("scdl:player-tools-request")();
  assert.equal(JSON.parse(attributes.get("data-scdl-player-tools-response")).snapshot.revision, 2,
    "correlated responses must not restore an older snapshot either");
  response = { success: true, snapshot: { revision: 3, state: "pro", capabilities: { tempo: true } } };
  storageListener({ "scdl.playerTools.access.v1": {} }, "local");
  await tick(); assert.equal(current().revision, 3);
  response = { success: false, code: "storage-unavailable" };
  storageListener({ "scdl.playerTools.access.v1": {} }, "local");
  await tick(); assert.equal(current().state, "access_error"); assert.equal(current().capabilities.tempo, false);
  console.log("Player Tools client verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
