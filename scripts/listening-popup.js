(() => {
  "use strict";
  const host = document.getElementById("listeningPlayer");
  let tabId = null;
  let pending = false;
  const view = globalThis.SCDLListeningView(host, { command: async (action) => {
    if (tabId == null) return;
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "SCDL_LISTENING_COMMAND", action });
      if (action === "cinema" && result?.success) { await chrome.tabs.update(tabId, { active: true }); window.close(); }
      else await refresh();
    } catch { hide(); }
  } });
  function hide() { host.hidden = true; document.body.classList.remove("listening-active"); }
  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.startsWith("https://soundcloud.com/")) { hide(); return; }
      tabId = tab.id;
      const result = await chrome.tabs.sendMessage(tabId, { type: "SCDL_LISTENING_STATE" });
      if (!result?.state) { hide(); return; }
      view.update(result.state);
      host.hidden = false;
      document.body.classList.add("listening-active");
    } catch { hide(); } finally { pending = false; }
  }
  refresh();
  const timer = setInterval(refresh, 500);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
