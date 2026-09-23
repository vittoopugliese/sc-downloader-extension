const assert = require("node:assert/strict");
const { terminalEvent } = require("./download-analytics.js");

const id = "track_analytics1234";
assert.deepEqual(terminalEvent("single", { success: true, operationId: id }), {
  properties: { type: "single", count: 1, result: "saved" }, options: { eventId: `download:${id}` },
});
assert.equal(terminalEvent("single", { success: false, code: "operation_in_progress", operationId: id }), null);
assert.equal(terminalEvent("single", { success: false, code: "ambiguous_save", operationId: id }).properties.result, "ambiguous");
assert.equal(terminalEvent("single", { success: false, code: "network_error", operationId: id }).properties.result, "failed");
assert.equal(terminalEvent("loop", { success: false, cancelled: true, operationId: id }).properties.result, "cancelled");
assert.deepEqual(terminalEvent("single", { success: true, operationId: id }).options,
  terminalEvent("single", { success: true, operationId: id }).options, "replay uses the same event ID");
console.log("Direct download analytics verification passed.");
