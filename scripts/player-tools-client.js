/* ISOLATED-world bridge. MAIN can ask for a decision, but only this script can
 * talk to chrome.runtime; every response is correlated and bounded. */
(() => {
  "use strict";
  const SNAPSHOT_ATTRIBUTE = "data-scdl-player-tools-access";
  const REQUEST_ATTRIBUTE = "data-scdl-player-tools-request";
  const RESPONSE_ATTRIBUTE = "data-scdl-player-tools-response";
  const REQUEST_EVENT = "scdl:player-tools-request";
  const RESPONSE_EVENT = "scdl:player-tools-response";
  const SNAPSHOT_EVENT = "scdl:player-tools-access-changed";
  let latestRevision = -1;
  let latestSnapshot = null;

  function publish(snapshot) {
    if (!Number.isSafeInteger(snapshot?.revision) || snapshot.revision < latestRevision) return;
    latestRevision = snapshot.revision;
    latestSnapshot = snapshot;
    document.documentElement.setAttribute(SNAPSHOT_ATTRIBUTE, JSON.stringify(snapshot));
    document.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT));
  }

  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_SNAPSHOT" });
      if (response?.success && response.snapshot) publish(response.snapshot);
      else publishUnavailable(response?.code);
    } catch { publishUnavailable("storage-unavailable"); }
  }

  function publishUnavailable(code) {
    publish({ revision: Math.max(0, latestRevision), state: "access_error", plan: "free", code,
      grant: null, capabilities: { openPanel: true, beginLoop: false, editLoop: false,
        tempo: false, preservePitch: false, savePreset: false, maximizeLooper: false,
        editLoopPrecise: false, exportLoop: false, exportTrackEffects: false } });
  }

  document.addEventListener(REQUEST_EVENT, async () => {
    let request;
    const raw = document.documentElement.getAttribute(REQUEST_ATTRIBUTE) || "null";
    if (raw.length > 8192) return;
    try { request = JSON.parse(raw); } catch { request = null; }
    if (typeof request?.id !== "string" || !request.id || request.id.length > 1024 ||
        typeof request.operation !== "string" || (request.version !== undefined && request.version !== 1)) return;
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: request.type === "end" ? "END_PLAYER_TOOLS_SESSION" : "AUTHORIZE_PLAYER_TOOLS",
        operation: request.operation,
        requestId: request.requestId || request.id,
        expectedGeneration: request.expectedGeneration ?? request.payload?.generation,
        sessionId: request.sessionId || null,
        payload: request.payload || null,
      });
    } catch (error) {
      result = { success: false, code: "storage-unavailable" };
    }
    if (result?.snapshot) publish(result.snapshot);
    else if (!result?.success) publishUnavailable(result?.code);
    // MAIN also reads the correlated response directly; filtering only the event
    // publication would still let an older response restore stale capabilities.
    if (latestSnapshot) result = { ...result, snapshot: latestSnapshot };
    document.documentElement.setAttribute(RESPONSE_ATTRIBUTE, JSON.stringify({ id: request.id, ...result }));
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT));
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PLAYER_TOOLS_ACCESS_SNAPSHOT" && message.snapshot) publish(message.snapshot);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["scdl.playerTools.access.v1"]) refresh();
  });
  refresh().catch(() => {});
})();
