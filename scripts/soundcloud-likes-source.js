(function (root) {
  'use strict';
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_JSON_BYTES = 2 * 1024 * 1024;
  const fail = (code) => Object.assign(new Error(code), { code });
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  function permalink(value) {
    try { const u = new URL(value); return u.origin === 'https://soundcloud.com' && /^\/[^/]+\/[^/]+\/?$/.test(u.pathname) && !u.username && !u.password ? u.origin + u.pathname.replace(/\/$/, '') : null; } catch { return null; }
  }
  function artwork(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)sndcdn\.com$/.test(u.hostname) && /\.(jpg|jpeg|png|webp)$/i.test(u.pathname) && !u.username && !u.password ? u.href : null; } catch { return null; }
  }
  function cursor(value, ownerId) {
    if (!value) return null;
    const u = new URL(value, 'https://api-v2.soundcloud.com');
    if (u.origin !== 'https://api-v2.soundcloud.com' || u.pathname !== `/users/${ownerId}/likes` || u.username || u.password) throw fail('invalid-cursor');
    const clean = new URL(u.origin + u.pathname);
    for (const key of ['offset', 'limit', 'linked_partitioning']) if (u.searchParams.has(key)) clean.searchParams.set(key, u.searchParams.get(key));
    return clean.href;
  }
  function project(item) {
    const kind = item.track ? 'track' : item.playlist ? 'playlist' : null;
    const raw = kind && item[kind];
    if (!raw || !/^\d+$/.test(String(raw.id))) return null;
    const trackArtworkUrl = artwork(raw.artwork_url);
    const artistAvatarUrl = artwork(raw.user?.avatar_url);
    return { kind, itemId: String(raw.id), likedAt: date(item.created_at),
      title: String(raw.title || 'Untitled').slice(0, 500), artistName: String(raw.user?.username || '').slice(0, 200),
      artistId: raw.user?.id ? String(raw.user.id) : null, permalink: permalink(raw.permalink_url),
      artworkUrl: trackArtworkUrl || artistAvatarUrl, publicationDate: date(raw.created_at),
      durationMs: Number.isFinite(raw.duration) && raw.duration >= 0 ? raw.duration : null,
      availability: raw.streamable === false ? 'unavailable' : 'unknown' };
  }
  function responseError(response) {
    const code = response.status === 429 ? 'rate-limited'
      : [401, 403].includes(response.status) ? 'auth-required'
      : response.status >= 500 ? 'service-unavailable' : 'network-error';
    const error = Object.assign(fail(code), { status: response.status });
    const header = response.headers?.get?.('Retry-After')?.trim();
    const seconds = /^\d+(?:\.\d+)?$/.test(header || '') ? Number(header) : NaN;
    const retryDate = Number.isFinite(seconds) ? NaN : Date.parse(header || '');
    if (Number.isFinite(seconds)) error.retryAt = Date.now() + seconds * 1000;
    else if (Number.isFinite(retryDate)) error.retryAt = retryDate;
    return error;
  }
  async function readJson(response, maxBytes) {
    const declaredValue = response.headers?.get?.('Content-Length');
    const declared = declaredValue == null ? null : Number(declaredValue);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)) {
      response.body?.cancel?.().catch?.(() => {});
      throw fail('response-too-large');
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
      try { return await response.json(); }
      catch (cause) { throw Object.assign(fail('invalid-response'), { cause }); }
    }
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || size + value.byteLength > maxBytes) throw fail('response-too-large');
        size += value.byteLength; chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder().decode(bytes)); }
      catch (cause) { throw Object.assign(fail('invalid-response'), { cause }); }
    } catch (error) {
      await reader.cancel().catch(() => {}); throw error;
    } finally { reader.releaseLock?.(); }
  }
  async function fetchPage({ ownerId, nextCursor, clientId, token, signal, request = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_JSON_BYTES }) {
    const url = new URL(cursor(nextCursor, ownerId) || `https://api-v2.soundcloud.com/users/${ownerId}/likes?limit=50&linked_partitioning=1`);
    url.searchParams.set('client_id', clientId);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false; let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(fail('network-timeout')); }, timeoutMs);
    });
    let data;
    try {
      data = await Promise.race([(async () => {
        const response = await request(url, { headers: { Authorization: `OAuth ${token}` }, signal: controller.signal, redirect: 'error' });
        if (!response.ok) { response.body?.cancel?.().catch?.(() => {}); throw responseError(response); }
        return readJson(response, maxBytes);
      })(), timeout]);
    } catch (error) {
      if (timedOut) throw fail('network-timeout');
      if (signal?.aborted) throw fail('request-cancelled');
      if (error?.code) throw error;
      throw Object.assign(fail('network-error'), { cause: error });
    } finally {
      clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort);
    }
    if (!Array.isArray(data.collection)) throw fail('invalid-response');
    return { entries: data.collection.map(project).filter(Boolean), rawCount: data.collection.length, nextCursor: cursor(data.next_href, ownerId) };
  }
  root.SCLikesSource = { fail, project, cursor, permalink, artwork, fetchPage };
  if (typeof module !== 'undefined') module.exports = root.SCLikesSource;
})(globalThis);
