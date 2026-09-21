const assert = require('node:assert/strict');
const source = require('./soundcloud-likes-source');
const policy = require('./player-tools-policy');
const entry = source.project({created_at:'2020-02-10',track:{id:123,title:'A',created_at:'2016-01-01',duration:42,permalink_url:'https://soundcloud.com/a/b',artwork_url:'https://i1.sndcdn.com/cover-large.jpg',track_authorization:'secret',media:{secret:true}}});
assert.equal(entry.likedAt,'2020-02-10T00:00:00.000Z');
assert.equal(entry.publicationDate,'2016-01-01T00:00:00.000Z');
assert.equal(entry.track_authorization,undefined); assert.equal(entry.media,undefined);
assert.equal(source.project({playlist:{id:3}}).kind,'playlist');
assert.equal(source.project({track:{id:4},created_at:'bad'}).likedAt,null);
assert.equal(source.project({track:{id:'bad'}}),null);
const avatarFallback = source.project({track:{id:5,artwork_url:null,user:{username:'Artist',avatar_url:'https://i1.sndcdn.com/avatars-user-large.jpg'}}});
assert.equal(avatarFallback.artworkUrl,'https://i1.sndcdn.com/avatars-user-large.jpg');
const invalidArtworkFallback = source.project({track:{id:6,artwork_url:'https://evil.test/cover.jpg',user:{avatar_url:'https://i1.sndcdn.com/avatars-safe-large.jpg'}}});
assert.equal(invalidArtworkFallback.artworkUrl,'https://i1.sndcdn.com/avatars-safe-large.jpg');
const artworkPreferred = source.project({track:{id:7,artwork_url:'https://i1.sndcdn.com/cover-large.jpg',user:{avatar_url:'https://i1.sndcdn.com/avatar-large.jpg'}}});
assert.equal(artworkPreferred.artworkUrl,'https://i1.sndcdn.com/cover-large.jpg');
assert.equal(source.permalink('https://evil.com/a/b'),null);
assert.equal(source.artwork('https://sndcdn.com.evil.com/a.jpg'),null);
assert.equal(source.artwork('https://i1.sndcdn.com/a.mp3'),null);
assert.equal(source.cursor('https://api-v2.soundcloud.com/users/42/likes?offset=50&client_id=secret&oauth_token=secret', '42'),'https://api-v2.soundcloud.com/users/42/likes?offset=50');
assert.throws(()=>source.cursor('https://evil.com/users/42/likes','42'));
assert.throws(()=>source.cursor('https://api-v2.soundcloud.com/users/43/likes','42'));
assert.equal(policy.canAuthorize(undefined,null,'explore-likes').reason,'pro-required');
const trial=policy.startTrial(policy.normalize(), Date.now());
assert.equal(policy.canAuthorize(trial,null,'explore-likes').allowed,true);
const pro=policy.normalize(undefined); pro.entitlement={status:'active'};
assert.equal(policy.canAuthorize(pro,null,'explore-likes').allowed,true);
assert.equal(policy.canAuthorize(pro,null,'explore-likes').consume,false);
assert.equal(policy.snapshot(pro,null).capabilities.likesExplorer,true);
assert.equal(policy.canAuthorize(pro,null,'invented-operation').allowed,false);
(async () => {
  const base = { ownerId: '42', clientId: 'client', token: 'token' };
  let aborted = false;
  await assert.rejects(source.fetchPage({ ...base, timeoutMs: 20, request: async (_url, options) => {
    options.signal.addEventListener('abort', () => { aborted = true; });
    return { ok: true, json: () => new Promise(() => {}) };
  } }), error => error.code === 'network-timeout');
  assert.equal(aborted, true);

  let cancelled = false;
  await assert.rejects(source.fetchPage({ ...base, maxBytes: 8, request: async () => ({
    ok: true, headers: { get: name => name === 'Content-Length' ? '9' : null },
    body: { cancel: async () => { cancelled = true; } },
  }) }), error => error.code === 'response-too-large');
  assert.equal(cancelled, true);

  const unavailable = source.fetchPage({ ...base, request: async () => ({
    ok: false, status: 503, headers: { get: () => null },
    body: { cancel: async () => {} },
  }) });
  await assert.rejects(unavailable, error => error.code === 'service-unavailable' && error.status === 503);

  const limited = source.fetchPage({ ...base, request: async () => ({
    ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '60' : null },
    body: { cancel: async () => {} },
  }) });
  await assert.rejects(limited, error => error.code === 'rate-limited' && error.retryAt > Date.now() + 59000);
  console.log('Likes source privacy, cursor, dates, HTTP bounds and Pro policy passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
