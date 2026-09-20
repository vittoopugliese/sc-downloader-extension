(function (root) {
  'use strict';
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
  async function fetchPage({ ownerId, nextCursor, clientId, token, signal }) {
    const url = new URL(cursor(nextCursor, ownerId) || `https://api-v2.soundcloud.com/users/${ownerId}/likes?limit=50&linked_partitioning=1`);
    url.searchParams.set('client_id', clientId);
    const response = await fetch(url, { headers: { Authorization: `OAuth ${token}` }, signal, redirect: 'error' });
    if (!response.ok) throw Object.assign(fail(response.status === 429 ? 'rate-limited' : [401,403].includes(response.status) ? 'auth-required' : 'network-error'), { status: response.status });
    const data = await response.json();
    if (!Array.isArray(data.collection)) throw fail('invalid-response');
    return { entries: data.collection.map(project).filter(Boolean), rawCount: data.collection.length, nextCursor: cursor(data.next_href, ownerId) };
  }
  root.SCLikesSource = { fail, project, cursor, permalink, artwork, fetchPage };
  if (typeof module !== 'undefined') module.exports = root.SCLikesSource;
})(globalThis);
