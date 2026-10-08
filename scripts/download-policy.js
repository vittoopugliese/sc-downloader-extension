/* Remote download eligibility policy, shared across downloads and worker restarts. */
(function (root) {
  "use strict";
  function create({ request = fetch, apiBaseUrl, storage, timeoutMs = 5000,
    cacheTtlMs = 5 * 60 * 1000, restrictedCacheTtlMs = 5 * 60 * 1000, now = Date.now,
    fixedRestricted = root.SCReleaseConfig?.DOWNLOADER_ENABLED === false }) {
    // Builds without the downloader never consult the remote policy.
    if (fixedRestricted) return { getPolicy: () => Promise.resolve({ allDownloadsActivated: false }) };
    const storageKey = `scdl.downloadPolicy.v1:${apiBaseUrl}`;
    let pending = null;
    let cached = null;
    let restored = false;
    function isFresh(entry) {
      const ttl = entry?.value?.allDownloadsActivated === true ? cacheTtlMs : restrictedCacheTtlMs;
      return typeof entry?.value?.allDownloadsActivated === "boolean" &&
        Number.isFinite(entry.checkedAt) && entry.checkedAt <= now() &&
        now() < entry.checkedAt + Math.max(0, ttl);
    }
    async function readDownloadPolicy() {
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
      if (isFresh(cached)) return Promise.resolve(cached.value);
      if (!pending) {
        pending = (async () => {
          if (!restored) {
            restored = true;
            try { cached = (await storage?.get(storageKey))?.[storageKey]; } catch { /* Use the backend if storage is unavailable. */ }
          }
          if (isFresh(cached)) return cached.value;
          const value = await readDownloadPolicy();
          cached = { value, checkedAt: now() };
          try { await storage?.set({ [storageKey]: cached }); } catch { /* Keep the in-memory result. */ }
          return value;
        })().finally(() => { pending = null; });
      }
      return pending;
    }
    return { getPolicy };
  }
  root.SCDownloadPolicy = { create };
  if (typeof module !== "undefined") module.exports = root.SCDownloadPolicy;
})(globalThis);
