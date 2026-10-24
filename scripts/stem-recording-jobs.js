(function (root) {
  "use strict";
  // Likes Explorer and YouTube loop recordings -> Stem Extractor. The WAV arrives over a port in
  // base64 chunks, waits in Cache Storage and the stems tab loads it without separating.
  const PREFIX = "stem-recording:";
  const PORT = "stem-recording-upload";
  const CACHE = "scdl-recording-jobs";
  const MAX_SECONDS = 120;
  const MAX_BYTES = 44 + 192000 * 4 * MAX_SECONDS;
  const audioKey = id => `https://scdl-recordings.invalid/recording/${id}`;
  const UUID = /^[a-f0-9-]{36}$/;
  const PERMALINK = /^https:\/\/soundcloud\.com\/[^/]+\/[^/?#]+$/;
  const YOUTUBE_WATCH = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,20}$/;
  const SENDER = /^https:\/\/(soundcloud\.com|www\.youtube\.com)\//;

  function decode(base64) {
    const binary = atob(base64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Accepts only the canonical 16-bit stereo PCM header written by SCRecord.encodeWav.
  function inspectWav(bytes) {
    if (bytes.length < 48) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
    const rate = view.getUint32(24, true), dataSize = view.getUint32(40, true);
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" ||
        view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 2 || view.getUint16(34, true) !== 16 ||
        rate < 8000 || rate > 192000 || dataSize !== bytes.length - 44 || dataSize % 4) return null;
    const frames = dataSize / 4;
    if (frames > rate * MAX_SECONDS + 1) return null;
    return { sampleRate: rate, durationMs: frames / rate * 1000 };
  }
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

  function create({ chrome, authorize, caches = root.caches }) {
    const key = id => PREFIX + id;
    async function store(id, bytes) {
      const cache = await caches.open(CACHE);
      await cache.put(audioKey(id), new Response(new Blob([bytes], { type: "audio/wav" }), { headers: { "Content-Type": "audio/wav" } }));
    }
    async function drop(id) {
      try { await (await caches.open(CACHE)).delete(audioKey(id)); } catch {}
    }
    async function open(meta, bytes, sender) {
      const wav = inspectWav(bytes);
      if (!wav) throw new Error("The recording is not a valid WAV of up to 2 minutes.");
      if (!(await authorize(sender)).allowed) throw new Error("Player Tools Pro is required to export loop stems.");
      const id = crypto.randomUUID();
      await store(id, bytes);
      let tab;
      try {
        tab = await chrome.tabs.create({ url: "about:blank" });
        await chrome.storage.session.set({ [key(id)]: { id, tabId: tab.id, createdAt: Date.now(), durationMs: wav.durationMs, ...meta } });
        await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`stems.html?recording=${id}`) });
      } catch (error) {
        await chrome.storage.session.remove(key(id)).catch(() => {});
        if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
        await drop(id);
        throw error;
      }
    }
    function connect(port) {
      const sender = port.sender || {};
      let meta = null, parts = [], received = 0, done = false;
      const reply = message => { try { port.postMessage(message); } catch {} };
      const fail = error => {
        if (done) return;
        done = true; parts = [];
        reply({ success: false, error: error?.message || String(error) });
      };
      if (sender.id !== chrome.runtime.id || !sender.tab || !SENDER.test(sender.url || "")) {
        fail(new Error("Record a track on SoundCloud or YouTube first.")); return;
      }
      port.onDisconnect.addListener(() => { done = true; parts = []; });
      port.onMessage.addListener(message => {
        if (done) return;
        if (message?.type === "begin" && !meta) {
          const artworkUrl = text(message.artworkUrl, 2048), trackUrl = text(message.trackUrl, 2048);
          if (!Number.isSafeInteger(message.size) || message.size < 48 || message.size > MAX_BYTES ||
              (artworkUrl && !/^https:\/\//.test(artworkUrl)) || (trackUrl && !PERMALINK.test(trackUrl) && !YOUTUBE_WATCH.test(trackUrl))) {
            fail(new Error("Invalid recording upload.")); return;
          }
          meta = { size: message.size, title: text(message.title, 300) || "SoundCloud recording", artist: text(message.artist, 300), artworkUrl, trackUrl };
        } else if (message?.type === "chunk" && meta && typeof message.data === "string") {
          let bytes;
          try { bytes = decode(message.data); } catch { fail(new Error("Invalid recording upload.")); return; }
          received += bytes.length;
          if (received > meta.size) { fail(new Error("Invalid recording upload.")); return; }
          parts.push(bytes);
        } else if (message?.type === "end" && meta) {
          if (received !== meta.size) { fail(new Error("Invalid recording upload.")); return; }
          const bytes = new Uint8Array(received);
          let at = 0;
          for (const part of parts) { bytes.set(part, at); at += part.length; }
          parts = []; done = true;
          const { size, ...info } = meta;
          open(info, bytes, sender).then(() => reply({ success: true }), error => { done = false; fail(error); });
        } else fail(new Error("Invalid recording upload."));
      });
    }
    async function info(request, sender) {
      if (sender.id !== chrome.runtime.id || sender.url?.split("?")[0] !== chrome.runtime.getURL("stems.html") ||
          !UUID.test(request.recordingId || "")) throw new Error("Invalid recording session.");
      const job = (await chrome.storage.session.get(key(request.recordingId)))[key(request.recordingId)];
      if (!job || job.tabId !== sender.tab?.id) throw new Error("This recording has expired. Record it again.");
      return { success: true, title: job.title, artist: job.artist, artworkUrl: job.artworkUrl, trackUrl: job.trackUrl,
        durationMs: job.durationMs, audioUrl: audioKey(job.id) };
    }
    async function removeTab(tabId) {
      const all = await chrome.storage.session.get(null);
      for (const [storageKey, job] of Object.entries(all)) {
        if (!storageKey.startsWith(PREFIX) || job.tabId !== tabId) continue;
        await chrome.storage.session.remove(storageKey);
        await drop(job.id);
      }
    }
    // Session storage ends with the browser; the cache does not. Drop orphans.
    async function sweep() {
      if (!caches) return;
      const all = await chrome.storage.session.get(null);
      const live = new Set(Object.entries(all).filter(([name]) => name.startsWith(PREFIX)).map(([, job]) => audioKey(job.id)));
      const cache = await caches.open(CACHE);
      for (const request of await cache.keys()) if (!live.has(request.url)) await cache.delete(request);
    }
    return {
      acceptsPort: name => name === PORT,
      connect,
      accepts: type => type === "STEM_RECORDING_INFO",
      handle: info,
      removeTab,
      sweep,
    };
  }
  root.SCStemRecordingJobs = { create, inspectWav, CACHE, audioKey };
})(globalThis);
