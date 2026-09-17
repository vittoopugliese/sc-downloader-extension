(function (root) {
  'use strict';
  let opening;
  const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  function open() {
    return opening ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('scdl_likes_explorer', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const name of ['libraries', 'jobs', 'views', 'artworkJobs']) db.createObjectStore(name, { keyPath: 'ownerId' });
        const entries = db.createObjectStore('entries', { keyPath: ['ownerId', 'generation', 'kind', 'itemId'] });
        entries.createIndex('order', ['ownerId', 'generation', 'trackOrdinal'], { unique: true });
        entries.createIndex('library', ['ownerId', 'generation']);
        db.createObjectStore('cursors', { keyPath: ['ownerId', 'generation', 'cursor'] });
        db.createObjectStore('bookmarks', { keyPath: ['ownerId', 'id'] });
        db.createObjectStore('artwork', { keyPath: ['ownerId', 'url'] });
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
  root.SCLikesLibrary = { open, request, transaction, get, put, all, tracks, start, commit, pause, erase, prune };
})(globalThis);
