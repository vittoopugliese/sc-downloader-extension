(function (root) {
  "use strict";
  function terminalEvent(type, result) {
    if (!result || result.code === "operation_in_progress") return null;
    const terminal = result.success === true ? "saved"
      : result.code === "ambiguous_save" ? "ambiguous"
      : result.cancelled || result.code === "cancelled" ? "cancelled" : "failed";
    const operationId = typeof result.operationId === "string" && /^track_[A-Za-z0-9_]{8,100}$/.test(result.operationId)
      ? result.operationId : null;
    return { properties: { type, count: 1, result: terminal },
      options: operationId ? { eventId: `download:${operationId}` } : {} };
  }
  root.SCDirectDownloadAnalytics = Object.freeze({ terminalEvent });
  if (typeof module !== "undefined") module.exports = root.SCDirectDownloadAnalytics;
})(globalThis);
