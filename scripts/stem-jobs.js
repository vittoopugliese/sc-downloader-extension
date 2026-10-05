(function (root) {
  "use strict";
  const PREFIX = "stem-loop:";
  const TYPES = new Set(["OPEN_LOOP_STEMS", "STEM_LOOP_INFO", "STEM_LOOP_RENDER", "STEM_LOOP_CANCEL"]);
  function create({ chrome, authorize, resolveTrack, render, cancel }) {
    const running = new Map();
    const key = id => PREFIX + id;
    async function read(request, sender) {
      if (sender.id !== chrome.runtime.id || sender.url?.split("?")[0] !== chrome.runtime.getURL("stems.html") ||
          !/^[a-f0-9-]{36}$/.test(request.jobId || "")) throw new Error("Invalid loop session.");
      const job = (await chrome.storage.session.get(key(request.jobId)))[key(request.jobId)];
      if (!job || job.tabId !== sender.tab?.id) throw new Error("This loop session has expired. Select the loop again on SoundCloud.");
      return job;
    }
    async function handle(request, sender) {
      if (request.type === "OPEN_LOOP_STEMS") {
        if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/soundcloud\.com\//.test(sender.url || "")) {
          throw new Error("Select a loop on SoundCloud first.");
        }
        const { startMs, endMs } = request.trimRange || {};
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs - startMs > 120000 ||
            !/^https:\/\/soundcloud\.com\/[^/]+\/[^/?#]+$/.test(request.trackUrl || "")) {
          throw new Error("Select a loop longer than 0 and up to 2 minutes.");
        }
        if (!(await authorize(sender)).allowed) throw new Error("Player Tools Pro is required to export loop stems.");
        const trackData = await resolveTrack({ trackUrl: request.trackUrl }, sender);
        const id = crypto.randomUUID();
        const job = { id, trackData, trimRange: { startMs, endMs }, createdAt: Date.now(),
          source: { id: sender.id, url: sender.url, tab: { id: sender.tab.id }, frameId: sender.frameId, documentId: sender.documentId } };
        // Create a blank tab first so ownership is persisted before the analyzer loads.
        const tab = await chrome.tabs.create({ url: "about:blank" });
        try {
          await chrome.storage.session.set({ [key(id)]: { ...job, tabId: tab.id } });
          await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`stems.html?job=${id}`) });
        } catch (error) {
          await chrome.storage.session.remove(key(id));
          await chrome.tabs.remove(tab.id).catch(() => {});
          throw error;
        }
        return { success: true };
      }
      const job = await read(request, sender);
      if (request.type === "STEM_LOOP_INFO") {
        return { success: true, title: job.trackData.title || "SoundCloud loop", trimRange: job.trimRange,
          artist: job.trackData.artist || "", artworkUrl: job.trackData.artworkUrl || job.trackData.artistImageUrl || "",
          durationMs: job.trackData.durationMs || null };
      }
      if (request.type === "STEM_LOOP_CANCEL") {
        const active = running.get(job.id);
        if (active) { active.cancelled = true; await cancel(active.operationId); }
        return { success: true };
      }
      if (running.has(job.id)) throw new Error("This loop is already being prepared.");
      const active = { operationId: `instrument_stems_${crypto.randomUUID()}`, cancelled: false };
      running.set(job.id, active);
      try {
        if (!(await authorize(job.source)).allowed) throw new Error("Player Tools Pro is required to export loop stems.");
        if (active.cancelled) throw new Error("Loop preparation cancelled.");
        const result = await render(job.trackData, job.trimRange, { rate: 1, preservePitch: false }, {},
          job.trackData.title || "Loop", active.operationId);
        if (active.cancelled) throw new Error("Loop preparation cancelled.");
        return result;
      } finally { running.delete(job.id); }
    }
    async function removeTab(tabId) {
      const all = await chrome.storage.session.get(null);
      for (const [storageKey, job] of Object.entries(all)) {
        if (!storageKey.startsWith(PREFIX) || job.tabId !== tabId) continue;
        const active = running.get(job.id);
        if (active) { active.cancelled = true; await cancel(active.operationId).catch(() => {}); }
        await chrome.storage.session.remove(storageKey);
      }
    }
    return { accepts: type => TYPES.has(type), handle, removeTab };
  }
  root.SCStemJobs = { create };
})(globalThis);
