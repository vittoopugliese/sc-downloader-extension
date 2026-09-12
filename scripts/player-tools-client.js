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

  function publish(snapshot) {
    document.documentElement.setAttribute(SNAPSHOT_ATTRIBUTE, JSON.stringify(snapshot));
    document.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT));
  }

  async function refresh() {
    const response = await chrome.runtime.sendMessage({ type: "GET_PLAYER_TOOLS_SNAPSHOT" });
    if (response?.success && response.snapshot) publish(response.snapshot);
  }

  document.addEventListener(REQUEST_EVENT, async () => {
    let request;
    try { request = JSON.parse(document.documentElement.getAttribute(REQUEST_ATTRIBUTE) || "null"); } catch { request = null; }
    if (!request?.id || typeof request.operation !== "string") return;
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: request.type === "end" ? "END_PLAYER_TOOLS_SESSION" : "AUTHORIZE_PLAYER_TOOLS",
        operation: request.operation,
        sessionId: request.sessionId || null,
        payload: request.payload || null,
      });
    } catch (error) {
      result = { success: false, code: "access-error", error: error?.message || "Could not verify Player Tools access." };
    }
    if (result?.snapshot) publish(result.snapshot);
    document.documentElement.setAttribute(RESPONSE_ATTRIBUTE, JSON.stringify({ id: request.id, ...result }));
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT));
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PLAYER_TOOLS_ACCESS_SNAPSHOT" && message.snapshot) publish(message.snapshot);
  });
  refresh().catch(() => {});
})();
