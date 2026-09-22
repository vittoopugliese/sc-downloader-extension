(function (global) {
  "use strict";

  const CONTENT_URL = "https://sctd.vpugliese.online/extension-content/contact.json";
  const STORAGE_KEY = "scdl.contact.content.v1";
  const MAX_JSON_BYTES = 16 * 1024;
  const TIMEOUT_MS = 5000;
  let cached;
  let inFlight;

  function cleanText(value, maxLength) {
    if (typeof value !== "string") return null;
    const result = value.trim();
    return result && result.length <= maxLength ? result : null;
  }

  function httpsUrl(value, image = false) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      if (image && (url.origin !== "https://sctd.vpugliese.online" ||
          !url.pathname.startsWith("/extension-content/images/"))) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function validate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        value.schemaVersion !== 1 || typeof value.enabled !== "boolean" ||
        !cleanText(value.revision, 64)) return null;
    const result = { schemaVersion: 1, revision: value.revision.trim(), enabled: value.enabled };
    if (!value.enabled) return result;
    result.title = cleanText(value.title, 120);
    if (!result.title) return null;
    const description = cleanText(value.description, 500);
    if (description) result.description = description;
    if (value.link && typeof value.link === "object") {
      const label = cleanText(value.link.label, 100);
      const url = httpsUrl(value.link.url);
      if (label && url) result.link = { label, url };
    }
    if (value.image && typeof value.image === "object") {
      const url = httpsUrl(value.image.url, true);
      const alt = cleanText(value.image.alt, 200);
      if (url && alt) result.image = { url, alt };
    }
    return result;
  }

  function render(content) {
    const root = document.getElementById("contactContent");
    if (!root) return;
    if (!content?.enabled) {
      root.hidden = true;
      return;
    }
    const title = document.getElementById("contactContentTitle");
    const description = document.getElementById("contactContentDescription");
    const link = document.getElementById("contactContentLink");
    const image = document.getElementById("contactContentImage");
    title.textContent = content.title;
    description.textContent = content.description || "";
    description.hidden = !content.description;
    link.textContent = content.link?.label || "";
    if (content.link) link.href = content.link.url;
    else link.removeAttribute("href");
    link.hidden = !content.link;
    image.onload = null;
    image.onerror = null;
    image.hidden = true;
    image.removeAttribute("src");
    if (content.image) {
      image.alt = content.image.alt;
      image.onload = () => { image.hidden = false; };
      image.onerror = () => { image.hidden = true; };
      image.src = content.image.url;
    }
    root.hidden = false;
  }

  async function readLimited(response) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new Error("Contact JSON is too large");
    if (!response.body) {
      const text = await response.text();
      if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error("Contact JSON is too large");
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_JSON_BYTES) throw new Error("Contact JSON is too large");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
      if (size > MAX_JSON_BYTES) await response.body.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  async function refresh() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(CONTENT_URL, { cache: "no-cache", signal: controller.signal });
      if (!response.ok || new URL(response.url).origin !== new URL(CONTENT_URL).origin)
        throw new Error("Contact JSON request failed");
      const content = validate(JSON.parse(await readLimited(response)));
      if (!content) throw new Error("Contact JSON is invalid");
      cached = content;
      render(content);
      await chrome.storage.local.set({ [STORAGE_KEY]: content });
    } catch (error) {
      console.warn("[SC Downloader] Contact content unavailable; using saved content.", error);
    } finally {
      clearTimeout(timer);
    }
  }

  function load() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (cached === undefined) {
        cached = null;
        try {
          const stored = await chrome.storage.local.get(STORAGE_KEY);
          cached = validate(stored[STORAGE_KEY]);
        } catch (error) {
          console.warn("[SC Downloader] Could not read saved Contact content.", error);
        }
      }
      render(cached);
      await refresh();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  global.SCContactContent = { load, validate };
  if (typeof module !== "undefined") module.exports = { validate };
})(globalThis);
