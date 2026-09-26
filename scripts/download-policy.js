/* Remote download eligibility policy. No persistent enabled cache. */
(function (root) {
  "use strict";
  function create({ request = fetch, apiBaseUrl, timeoutMs = 5000 }) {
    let pending = null;
    async function read() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await request(`${apiBaseUrl}/download-policy`, {
          method: "POST", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) return { allDownloadsActivated: false };
        const value = await response.json();
        return { allDownloadsActivated: value?.allDownloadsActivated === true };
      } catch {
        return { allDownloadsActivated: false };
      } finally {
        clearTimeout(timeout);
      }
    }
    function getPolicy() {
      if (!pending) pending = read().finally(() => { pending = null; });
      return pending;
    }
    return { getPolicy };
  }
  root.SCDownloadPolicy = { create };
  if (typeof module !== "undefined") module.exports = root.SCDownloadPolicy;
})(globalThis);
