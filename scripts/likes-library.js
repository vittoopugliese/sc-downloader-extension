(function (root) {
  'use strict';
  let opening;
  const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  function open() {
    return opening ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('scdl_likes_explorer', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('libraries')) {
          for (const name of ['libraries', 'jobs', 'views', 'artworkJobs']) db.createObjectStore(name, { keyPath: 'ownerId' });
          const entries = db.createObjectStore('entries', { keyPath: ['ownerId', 'generation', 'kind', 'itemId'] });
          entries.createIndex('order', ['ownerId', 'generation', 'trackOrdinal'], { unique: true });
          entries.createIndex('library', ['ownerId', 'generation']);
          db.createObjectStore('cursors', { keyPath: ['ownerId', 'generation', 'cursor'] });
          db.createObjectStore('bookmarks', { keyPath: ['ownerId', 'id'] });
          db.createObjectStore('artwork', { keyPath: ['ownerId', 'url'] });
        }
        if (!db.objectStoreNames.contains('collections')) {
          const collections = db.createObjectStore('collections', { keyPath: ['accountId', 'collectionId'] });
          collections.createIndex('account', 'accountId');
          collections.createIndex('source', ['accountId', 'sourceUserId']);
          const tracks = db.createObjectStore('tracks', { keyPath: ['accountId', 'trackId'] });
          tracks.createIndex('account', 'accountId');
          const collectionEntries = db.createObjectStore('collectionEntries', { keyPath: ['accountId', 'collectionId', 'generation', 'trackId'] });
          collectionEntries.createIndex('order', ['accountId', 'collectionId', 'generation', 'ordinal'], { unique: true });
          collectionEntries.createIndex('track', ['accountId', 'collectionId', 'generation', 'trackId'], { unique: true });
          collectionEntries.createIndex('generation', ['accountId', 'collectionId', 'generation']);
          for (const name of ['collectionJobs', 'collectionViews', 'collectionArtworkJobs']) db.createObjectStore(name, { keyPath: ['accountId', 'collectionId'] });
          db.createObjectStore('collectionBookmarks', { keyPath: ['accountId', 'collectionId', 'id'] });
          const artwork = db.createObjectStore('accountArtwork', { keyPath: ['accountId', 'artworkKey'] });
          artwork.createIndex('account', 'accountId');
          db.createObjectStore('collectionCursors', { keyPath: ['accountId', 'collectionId', 'generation', 'cursor'] });
          db.createObjectStore('likesMigrations', { keyPath: 'accountId' });
        }
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => { opening = null; reject(r.error); };
    });
  }
  async function transaction(names, write, fn) {
    const db = await open(); const tx = db.transaction(names, write ? 'readwrite' : 'readonly');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('transaction-aborted')); tx.onerror = () => {}; });
    try { const result = await fn(name => tx.objectStore(name)); await done; return result; }
    catch (e) { try { tx.abort(); } catch {} await done.catch(() => {}); throw e; }
  }
  const get = (store, key) => transaction([store], false, s => request(s(store).get(key)));
  const put = (store, value) => transaction([store], true, s => request(s(store).put(value)));
  const all = store => transaction([store], false, s => request(s(store).getAll()));
  async function tracks(ownerId, generation) {
    if (!generation) return [];
    return transaction(['entries'], false, s => request(s('entries').index('order').getAll(IDBKeyRange.bound([ownerId, generation, 0], [ownerId, generation, Number.MAX_SAFE_INTEGER]))));
  }
  async function start(ownerId, displayName, refresh) {
    return transaction(['libraries', 'jobs'], true, async s => {
      const old = await request(s('jobs').get(ownerId));
      let lib = await request(s('libraries').get(ownerId));
      if (old && old.phase !== 'complete' && !refresh) { if (old.phase === 'indexing') return old; old.phase = 'indexing'; old.error = null; old.retryAt = null; old.epoch++; s('jobs').put(old); return old; }
      if (lib?.complete && !refresh) return old;
      const generation = crypto.randomUUID();
      const job = { ownerId, generation, operationId: generation, epoch: 0, phase: 'indexing', nextCursor: null, count: 0, sourceCount: 0, rawCount: 0, revision: 0, duplicateCount: 0, unsupportedCount: 0, unknownDateCount: 0 };
      lib ||= { ownerId, displayName, generation, count: 0, revision: 0, complete: false };
      s('libraries').put(lib); s('jobs').put(job); return job;
    });
  }
  async function commit(job, page) {
    return transaction(['entries', 'libraries', 'jobs', 'cursors'], true, async s => {
      const current = await request(s('jobs').get(job.ownerId));
      if (!current || current.phase !== 'indexing' || current.epoch !== job.epoch || current.generation !== job.generation || current.revision !== job.revision) return false;
      if (page.nextCursor && await request(s('cursors').get([job.ownerId, job.generation, page.nextCursor]))) throw root.SCLikesSource.fail('cursor-cycle');
      for (const entry of page.entries) {
        if (await request(s('entries').get([job.ownerId, job.generation, entry.kind, entry.itemId]))) { current.duplicateCount++; continue; }
        if (entry.kind === 'track' && !entry.likedAt) current.unknownDateCount++;
        s('entries').put({ ...entry, ownerId: job.ownerId, generation: job.generation, sourceOrdinal: current.sourceCount++, ...(entry.kind === 'track' ? { trackOrdinal: current.count++ } : {}) });
      }
      if (page.nextCursor) s('cursors').put({ ownerId: job.ownerId, generation: job.generation, cursor: page.nextCursor });
      current.nextCursor = page.nextCursor; current.rawCount += page.rawCount; current.revision++; current.error = null;
      current.unsupportedCount += Math.max(0,page.rawCount-page.entries.length);
      current.phase = page.nextCursor ? 'indexing' : 'complete'; s('jobs').put(current);
      const lib = await request(s('libraries').get(job.ownerId));
      if (!lib.complete || !page.nextCursor) s('libraries').put({ ...lib, generation: job.generation, count: current.count, revision: current.revision, complete: !page.nextCursor, updatedAt: Date.now(), unknownDateCount:current.unknownDateCount, unsupportedCount:current.unsupportedCount, duplicateCount:current.duplicateCount, rawEntriesRead:current.rawCount, playlistCount:current.sourceCount-current.count });
      return true;
    });
  }
  async function pause(ownerId, error = null) {
    return transaction(['jobs'], true, async s => { const job = await request(s('jobs').get(ownerId)); if (job && job.phase !== 'complete') { job.phase = 'paused'; job.error = error; job.retryAt = null; job.epoch++; s('jobs').put(job); } });
  }
  async function erase(ownerId, imagesOnly = false) {
    const names = imagesOnly ? ['artwork', 'artworkJobs'] : ['libraries','jobs','views','entries','cursors','bookmarks','artwork','artworkJobs'];
    return transaction(names, true, async s => {
      for (const name of names) await new Promise((resolve, reject) => {
        const r = s(name).openCursor(); r.onerror = () => reject(r.error); r.onsuccess = () => { const c = r.result; if (!c) return resolve(); if (c.value.ownerId === ownerId) c.delete(); c.continue(); };
      });
    });
  }
  async function prune(ownerId, keep) {
    return transaction(['entries','cursors'], true, async s => {
      for (const name of ['entries','cursors']) await new Promise((resolve,reject)=>{
        const r=s(name).openCursor(); r.onerror=()=>reject(r.error); r.onsuccess=()=>{ const c=r.result; if(!c)return resolve(); if(c.value.ownerId===ownerId && (name==='cursors' || !keep.includes(c.value.generation)))c.delete(); c.continue(); };
      });
    });
  }

  const collectionKey = sourceUserId => `likes:${String(sourceUserId)}`;
  const rangeFor = prefix => IDBKeyRange.bound([...prefix, 0], [...prefix, Number.MAX_SAFE_INTEGER]);
  function cursorValues(store, range, limit = Infinity, offset = 0) {
    return new Promise((resolve, reject) => {
      const values = []; let skipped = 0;
      const r = store.openCursor(range);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c || values.length >= limit) return resolve(values);
        if (skipped++ < offset) { c.continue(); return; }
        values.push(c.value); c.continue();
      };
    });
  }
  async function listCollections(accountId) {
    return transaction(['collections'], false, s => request(s('collections').index('account').getAll(IDBKeyRange.only(String(accountId)))));
  }
  async function ensureLegacyMigrated(accountId) {
    accountId = String(accountId);
    const state = await get('likesMigrations', accountId);
    if (state?.complete) return;
    const legacy = await get('libraries', accountId);
    if (!legacy) { await put('likesMigrations', { accountId, complete: true, at: Date.now() }); return; }
    const collectionId = collectionKey(accountId), entries = await tracks(accountId, legacy.generation);
    await transaction(['collections','tracks','collectionEntries','collectionViews','collectionBookmarks','accountArtwork','likesMigrations','views','bookmarks','artwork'], true, async s => {
      s('collections').put({ ...legacy, accountId, collectionId, sourceUserId: accountId, sourceUrl: 'https://soundcloud.com/you/likes', name: legacy.displayName || 'Likes', activeGeneration: legacy.generation, migratedFrom: 1 });
      for (const entry of entries) {
        s('tracks').put({ ...entry, accountId, trackId: entry.itemId });
        s('collectionEntries').put({ accountId, collectionId, generation: entry.generation, trackId: entry.itemId, ordinal: entry.trackOrdinal, likedAt: entry.likedAt });
      }
      const view = await request(s('views').get(accountId));
      if (view) s('collectionViews').put({ ...view, accountId, collectionId });
      const oldBookmarks = await request(s('bookmarks').getAll());
      for (const value of oldBookmarks.filter(value => value.ownerId === accountId)) s('collectionBookmarks').put({ ...value, accountId, collectionId });
      const oldArtwork = await request(s('artwork').getAll());
      for (const value of oldArtwork.filter(value => value.ownerId === accountId)) s('accountArtwork').put({ ...value, accountId, artworkKey: value.url, formatVersion: value.formatVersion || 1 });
      s('likesMigrations').put({ accountId, complete: true, collectionId, copied: entries.length, at: Date.now() });
    });
  }
  async function startCollection(accountId, spec, refresh) {
    accountId = String(accountId); const sourceUserId = String(spec.sourceUserId); const collectionId = spec.collectionId || collectionKey(sourceUserId);
    return transaction(['collections','collectionJobs'], true, async s => {
      const key = [accountId, collectionId], old = await request(s('collectionJobs').get(key));
      let collection = await request(s('collections').get(key));
      if (old && old.phase !== 'complete' && !refresh) { if (old.phase !== 'indexing') { old.phase = 'indexing'; old.error = null; old.retryAt = null; old.epoch++; s('collectionJobs').put(old); } return old; }
      if (collection?.complete && !refresh) return old;
      const generation = crypto.randomUUID();
      const job = { accountId, collectionId, sourceUserId, generation, operationId:generation, epoch:0, phase:'indexing', nextCursor:null, count:0, sourceCount:0, rawCount:0, revision:0, duplicateCount:0, unsupportedCount:0, unknownDateCount:0 };
      collection ||= { accountId, collectionId, type:'likes', sourceUserId, sourceUrl:spec.sourceUrl || null, name:spec.name || 'Likes', activeGeneration:null, generation:null, count:0, revision:0, complete:false, createdAt:Date.now() };
      s('collections').put({ ...collection, sourceUserId, sourceUrl:spec.sourceUrl || collection.sourceUrl, name:spec.name || collection.name }); s('collectionJobs').put(job); return job;
    });
  }
  async function commitCollection(job, page) {
    return transaction(['collections','collectionJobs','collectionEntries','tracks','collectionCursors'], true, async s => {
      const key=[job.accountId,job.collectionId], current=await request(s('collectionJobs').get(key));
      if (!current || current.phase !== 'indexing' || current.epoch !== job.epoch || current.generation !== job.generation || current.revision !== job.revision) return false;
      if (page.nextCursor && await request(s('collectionCursors').get([...key,job.generation,page.nextCursor]))) throw root.SCLikesSource.fail('cursor-cycle');
      for (const entry of page.entries) {
        if (entry.kind !== 'track') { current.sourceCount++; continue; }
        const entryKey=[...key,job.generation,entry.itemId];
        if (await request(s('collectionEntries').get(entryKey))) { current.duplicateCount++; continue; }
        if (!entry.likedAt) current.unknownDateCount++;
        s('tracks').put({ ...entry, accountId:job.accountId, trackId:entry.itemId, updatedAt:Date.now() });
        s('collectionEntries').put({ accountId:job.accountId, collectionId:job.collectionId, generation:job.generation, trackId:entry.itemId, ordinal:current.count++, likedAt:entry.likedAt }); current.sourceCount++;
      }
      if (page.nextCursor) s('collectionCursors').put({ accountId:job.accountId, collectionId:job.collectionId, generation:job.generation, cursor:page.nextCursor });
      current.nextCursor=page.nextCursor; current.rawCount+=page.rawCount; current.revision++; current.error=null; current.unsupportedCount+=Math.max(0,page.rawCount-page.entries.length); current.phase=page.nextCursor?'indexing':'complete'; s('collectionJobs').put(current);
      const collection=await request(s('collections').get(key));
      if (!collection.activeGeneration || !page.nextCursor) s('collections').put({ ...collection, generation:job.generation, activeGeneration:job.generation, count:current.count, revision:current.revision, complete:!page.nextCursor, updatedAt:Date.now(), unknownDateCount:current.unknownDateCount, unsupportedCount:current.unsupportedCount, duplicateCount:current.duplicateCount, rawEntriesRead:current.rawCount });
      return true;
    });
  }
  async function window(accountId, collectionId, generation, offset, limit) {
    const entries = await transaction(['collectionEntries'], false, s => cursorValues(s('collectionEntries').index('order'), rangeFor([String(accountId),collectionId,generation]), limit, offset));
    if (!entries.length) return [];
    return transaction(['tracks'], false, async s => Promise.all(entries.map(async entry => ({ ...(await request(s('tracks').get([String(accountId),entry.trackId]))), ...entry, itemId:entry.trackId, trackOrdinal:entry.ordinal }))));
  }
  async function position(accountId, collectionId, generation, trackId) {
    const entry=await transaction(['collectionEntries'], false, s => request(s('collectionEntries').index('track').get([String(accountId),collectionId,generation,String(trackId)])));
    return entry ? entry.ordinal : -1;
  }
  async function collectionTracks(accountId, collectionId, generation) { return window(accountId,collectionId,generation,0,Number.MAX_SAFE_INTEGER); }
  async function eraseCollection(accountId, collectionId, imagesOnly=false) {
    accountId=String(accountId); const names=imagesOnly?['accountArtwork','collectionArtworkJobs']:['collections','collectionJobs','collectionViews','collectionEntries','collectionCursors','collectionBookmarks','collectionArtworkJobs'];
    return transaction(names,true,async s=>{ for(const name of names) await new Promise((resolve,reject)=>{const r=s(name).openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c)return resolve();const v=c.value;if(v.accountId===accountId&&(imagesOnly||v.collectionId===collectionId))c.delete();c.continue();};}); });
  }
  async function pruneCollection(accountId, collectionId, keep) {
    return transaction(['collectionEntries','collectionCursors'],true,async s=>{for(const name of ['collectionEntries','collectionCursors'])await new Promise((resolve,reject)=>{const r=s(name).openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c)return resolve();const v=c.value;if(v.accountId===String(accountId)&&v.collectionId===collectionId&&!keep.includes(v.generation))c.delete();c.continue();};});});
  }
  async function storageStats(accountId) {
    accountId=String(accountId); const collections=await listCollections(accountId); let trackCount=0,entryCount=0,metadataBytes=0,artworkBytes=0,artworkCount=0;
    await transaction(['tracks','collectionEntries','accountArtwork'],false,async s=>{for(const [name,visit] of [['tracks',v=>{trackCount++;metadataBytes+=new Blob([JSON.stringify(v)]).size;}],['collectionEntries',v=>{entryCount++;metadataBytes+=new Blob([JSON.stringify(v)]).size;}],['accountArtwork',v=>{artworkCount++;artworkBytes+=Number(v.bytes)||Object.values(v.variants||{}).reduce((n,b)=>n+(b?.size||0),0);}]])await new Promise((resolve,reject)=>{const r=s(name).openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c)return resolve();if(c.value.accountId===accountId)visit(c.value);c.continue();};});});
    const sizes=await transaction(['accountArtwork'],false,async s=>{const values=await request(s('accountArtwork').index('account').getAll(IDBKeyRange.only(accountId)));return values.map(v=>Number(v.bytes)||0).sort((a,b)=>a-b);});
    const percentile=p=>sizes.length?sizes[Math.min(sizes.length-1,Math.floor((sizes.length-1)*p))]:0;
    return { collectionCount:collections.length,trackCount,entryCount,metadataEstimatedBytes:metadataBytes,artworkCount,artworkBytes,artworkAverageBytes:artworkCount?Math.round(artworkBytes/artworkCount):0,artworkSize:{min:sizes[0]||0,median:percentile(.5),p95:percentile(.95),max:sizes.at(-1)||0} };
  }
  root.SCLikesLibrary = { open, request, transaction, get, put, all, tracks, start, commit, pause, erase, prune, collectionKey, listCollections, ensureLegacyMigrated, startCollection, commitCollection, window, position, collectionTracks, eraseCollection, pruneCollection, storageStats };
})(globalThis);
