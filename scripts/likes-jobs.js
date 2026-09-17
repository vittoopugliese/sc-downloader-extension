(function (root) {
  'use strict';
  const db = root.SCLikesLibrary, source = root.SCLikesSource;
  function create({ getToken, resolveUser, access }) {
    let running = false, sessionEpoch = 0, identity = null, cache = null;
    const controllers = new Set();
    async function context(sender, expectedOwner) {
      const epoch = sessionEpoch;
      const token = await getToken().catch(() => { throw source.fail('auth-required'); });
      if (!identity || identity.token !== token || Date.now() - identity.at > 30000) {
        const tabs = sender?.tab ? [sender.tab] : await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
        let clientId;
        for (const tab of tabs) {
          try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LIKES_CONTEXT' }, { frameId: 0 }); if (r?.clientId) { clientId = r.clientId; break; } } catch {}
        }
        if (!clientId) throw source.fail('needs-soundcloud-tab');
        let profile;
        try { profile = await resolveUser(clientId); }
        catch (error) {
          if (identity?.token === token && epoch === sessionEpoch && (error instanceof TypeError || error.code === 'network-error')) {
            if (expectedOwner && expectedOwner !== identity.ownerId) throw source.fail('owner-mismatch');
            return { ...identity, epoch };
          }
          throw source.fail([401,403].includes(error.status) ? 'auth-required' : 'network-error');
        }
        if (profile.oauthToken !== token || epoch !== sessionEpoch) throw source.fail('auth-required');
        identity = { token, clientId, ownerId: String(profile.user.id), displayName: profile.user.username, at: Date.now() };
      }
      if (expectedOwner && expectedOwner !== identity.ownerId) throw source.fail('owner-mismatch');
      return { ...identity, epoch };
    }
    async function authorize(sender) { const result = await access.authorize(sender || {}, { operation: 'explore-likes' }); if (!result.allowed) throw source.fail(result.code || 'pro-required'); }
    async function valid(ctx) { await authorize(); if (ctx.epoch !== sessionEpoch || await getToken().catch(() => null) !== ctx.token) throw source.fail('auth-required'); }
    async function tick() {
      if (running) return; running = true;
      try {
        for (const initial of await db.all('jobs')) {
          if (initial.phase === 'paused' && initial.retryAt && initial.retryAt <= Date.now()) { await db.start(initial.ownerId, '', false); initial.phase = 'indexing'; }
          if (initial.phase !== 'indexing') continue;
          try {
            await authorize(); const ctx = await context(null, initial.ownerId);
            for (let n = 0; n < 8; n++) {
              const job = await db.get('jobs', initial.ownerId); if (!job || job.phase !== 'indexing') break;
              await valid(ctx);
              const controller = new AbortController(); controllers.add(controller);
              const timeout = setTimeout(() => controller.abort(), 15000);
              let page;
              try { page = await source.fetchPage({ ownerId: job.ownerId, nextCursor: job.nextCursor, ...ctx, signal: controller.signal }); }
              finally { clearTimeout(timeout); controllers.delete(controller); }
              const oldLibrary = await db.get('libraries',job.ownerId);
              await valid(ctx); if (!await db.commit(job, page)) break;
              if (!page.nextCursor) {
                await db.prune(job.ownerId,[job.generation,oldLibrary?.generation].filter(Boolean));
                const artworkJob = await db.get('artworkJobs',job.ownerId);
                if (artworkJob && artworkJob.generation !== job.generation) await db.put('artworkJobs',{...artworkJob,generation:job.generation,offset:0,epoch:crypto.randomUUID(),phase:artworkJob.phase === 'complete' ? 'saving' : artworkJob.phase});
              }
              cache = null;
            }
          } catch (e) {
            const code = e.name === 'QuotaExceededError' ? 'storage-full' : e.code || 'network-error';
            await db.pause(initial.ownerId, code);
            if (['rate-limited','network-error'].includes(code)) {
              const job = await db.get('jobs',initial.ownerId);
              if (job && (job.attempts || 0) < 4) await db.put('jobs',{...job,attempts:(job.attempts || 0)+1,retryAt:Date.now()+60000*2**(job.attempts || 0)});
            }
          }
        }
        await artworkTick();
      } finally { running = false; }
      if ((await db.all('jobs')).some(j => j.phase === 'indexing')) setTimeout(() => tick().catch(() => {}), 300);
    }
    async function records(lib) {
      const key = `${lib.ownerId}:${lib.generation}:${lib.revision}`;
      if (cache?.key !== key) {
        const items = await db.tracks(lib.ownerId, lib.generation), periods = {};
        for (const i of items) { const period = i.likedAt?.slice(0,7) || 'unknown'; periods[period] ||= { count:0, firstTrackId:i.itemId }; periods[period].count++; }
        cache = { key, items, periods, searches: new Map() };
      }
      return cache.items;
    }
    async function artworkTick() {
      for (const initial of await db.all('artworkJobs')) {
        if (initial.phase !== 'saving') continue;
        try {
          await authorize(); const ctx = await context(null, initial.ownerId);
          const lib = await db.get('libraries', initial.ownerId); if (!lib) continue;
          const items = await records(lib);
          for (let n = 0; n < 8; n++) {
            const job = await db.get('artworkJobs', initial.ownerId);
            if (!job || job.epoch !== initial.epoch || job.phase !== 'saving') break;
            const item = items[job.offset];
            if (!item) { if (lib.complete) { job.phase = 'complete'; await db.put('artworkJobs', job); } break; }
            await valid(ctx);
            let asset = item.artworkUrl && await db.get('artwork', [ctx.ownerId, item.artworkUrl]);
            if (item.artworkUrl && !asset) {
              try { asset = await convertArtwork(item.artworkUrl); }
              catch { job.failed++; }
            }
            await valid(ctx);
            await db.transaction(['artworkJobs','artwork'], true, async s => {
              const current = await db.request(s('artworkJobs').get(ctx.ownerId));
              if (!current || current.epoch !== job.epoch || current.phase !== 'saving') return;
              if (asset && !asset.ownerId) {
                if (job.bytes + asset.bytes > 200 * 1024 * 1024) { current.phase = 'paused'; current.error = 'storage-full'; s('artworkJobs').put(current); return; }
                s('artwork').put({ ...asset, ownerId: ctx.ownerId, url: item.artworkUrl }); job.bytes += asset.bytes; job.saved++;
              }
              job.offset++; s('artworkJobs').put(job);
            });
          }
        } catch (e) { const job = await db.get('artworkJobs', initial.ownerId); if (job?.epoch === initial.epoch) await db.put('artworkJobs', { ...job, phase: 'paused', error: e.code || 'storage-full' }); }
      }
      if ((await db.all('artworkJobs')).some(j => j.phase === 'saving')) setTimeout(() => tick().catch(() => {}), 500);
    }
    async function convertArtwork(url) {
      if (!source.artwork(url)) throw source.fail('invalid-request');
      const response = await fetch(url.replace(/-large\./, '-t200x200.'), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok || !/^image\/(jpeg|png|webp)/.test(response.headers.get('content-type') || '')) throw source.fail('invalid-image');
      const reader = response.body.getReader(), chunks = []; let bytes = 0;
      while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw source.fail('invalid-image'); } chunks.push(r.value); }
      const bitmap = await createImageBitmap(new Blob(chunks));
      try {
        if (bitmap.width * bitmap.height > 16000000) throw source.fail('invalid-image');
        const variants = {}; let total = 0;
        for (const size of [48, 160]) {
          const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
          const side = Math.min(bitmap.width, bitmap.height);
          ctx.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, size, size);
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality: size === 48 ? .65 : .75 });
          if (blob.type !== 'image/webp') throw source.fail('webp-unavailable');
          variants[size] = blob; total += blob.size;
        }
        return { variants, bytes: total };
      } finally { bitmap.close(); }
    }
    function checkSender(sender) {
      if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || new URL(sender.url || sender.tab.url).origin !== 'https://soundcloud.com') throw source.fail('invalid-request');
    }
    async function handle(r, sender) {
      checkSender(sender);
      const deleting = ['DELETE_LIKES_LIBRARY','DELETE_LIKES_ARTWORK'].includes(r.type);
      if (!deleting) await authorize(sender);
      const ctx = await context(sender, r.ownerId);
      const ownerId = ctx.ownerId;
      if (r.type === 'START_LIKES_INDEX' || r.type === 'REFRESH_LIKES_LIBRARY') {
        const job = await db.start(ownerId, ctx.displayName, r.type === 'REFRESH_LIKES_LIBRARY');
        chrome.alarms.create('scdl-likes', { periodInMinutes: 1 }); tick().catch(() => {});
        return { ownerId, operationId: job?.operationId };
      }
      if (r.type === 'CANCEL_LIKES_INDEX') { await db.pause(ownerId); return {}; }
      if (deleting) { await db.erase(ownerId, r.type === 'DELETE_LIKES_ARTWORK'); cache = null; return {}; }
      if (r.type === 'START_LIKES_ARTWORK' || r.type === 'PAUSE_LIKES_ARTWORK') {
        if (r.type === 'START_LIKES_ARTWORK' && r.consent !== true) throw source.fail('invalid-request');
        const old = await db.get('artworkJobs', ownerId);
        await db.put('artworkJobs', { ownerId, offset: 0, bytes: 0, saved: 0, failed: 0, ...old, ...(old?.phase === 'complete' ? {offset:0,failed:0} : {}), epoch: crypto.randomUUID(), phase: r.type === 'START_LIKES_ARTWORK' ? 'saving' : 'paused' });
        chrome.alarms.create('scdl-likes', { periodInMinutes: 1 }); tick().catch(() => {}); return {};
      }
      const lib = await db.get('libraries', ownerId);
      if (r.type === 'GET_LIKES_LIBRARY_STATUS') {
        const result = { ownerId, displayName: ctx.displayName, library: lib || null, job: await db.get('jobs', ownerId), artwork: await db.get('artworkJobs', ownerId), view: await db.get('views', ownerId), bookmarks: (await db.all('bookmarks')).filter(b => b.ownerId === ownerId) };
        await valid(ctx); return result;
      }
      if (!lib) throw source.fail('not-indexed');
      if (r.generation && r.generation !== lib.generation) throw source.fail('stale-generation');
      const items = await records(lib);
      if (r.type === 'SAVE_LIKES_VIEW') {
        await db.transaction(['libraries','views'],true,async s=>{
          const current=await db.request(s('libraries').get(ownerId)); if(!current || current.generation!==lib.generation)throw source.fail('stale-generation');
          s('views').put({ ownerId, anchorTrackId: String(r.anchorTrackId || '').slice(0,30), mode: r.mode === 'list' ? 'list' : 'gallery', query: String(r.query || '').slice(0,200), density: r.density === 'compact' ? 'compact' : 'comfortable' });
        }); return {};
      }
      if (r.type === 'SAVE_LIKES_BOOKMARK') {
        const item = items.find(i => i.itemId === r.trackId); if (!item) throw source.fail('track-missing');
        await db.transaction(['libraries','bookmarks'],true,async s=>{
          const current=await db.request(s('libraries').get(ownerId)); if(!current || current.generation!==lib.generation)throw source.fail('stale-generation');
          s('bookmarks').put({ ownerId, id: item.itemId, anchorTrackId: item.itemId, name: String(r.name || item.title).slice(0,80), likedAt: item.likedAt });
        }); return {};
      }
      if (r.type === 'OPEN_LIKED_TRACK' || r.type === 'LOCATE_LIKED_TRACK') {
        const item = items.find(i => i.itemId === r.trackId); if (!item?.permalink) throw source.fail('track-missing');
        await valid(ctx);
        if (r.type === 'OPEN_LIKED_TRACK') { await chrome.tabs.update(sender.tab.id, { url: item.permalink }); return { phase: 'needs-user-action' }; }
        return { permalink: item.permalink };
      }
      if (r.type === 'GET_LIKES_ARTWORK') {
        if (!Array.isArray(r.trackIds) || r.trackIds.length > 12) throw source.fail('invalid-request');
        const images = {}; let total = 0;
        for (const id of r.trackIds) {
          const item = items.find(i => i.itemId === id); if (!item?.artworkUrl) continue;
          const asset = await db.get('artwork', [ownerId, item.artworkUrl]), blob = asset?.variants[r.variant === 48 ? 48 : 160];
          if (!blob || total + blob.size * 1.4 > 512 * 1024) continue;
          total += blob.size * 1.4; images[id] = 'data:image/webp;base64,' + btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
        }
        await valid(ctx); return { images };
      }
      if (r.type === 'QUERY_LIKES') {
        if ((r.query !== undefined && (typeof r.query !== 'string' || r.query.length > 200)) || (r.offset !== undefined && (!Number.isSafeInteger(r.offset) || r.offset < 0)) || (r.limit !== undefined && (!Number.isInteger(r.limit) || r.limit < 1 || r.limit > 200)) || (r.period && r.period !== 'unknown' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period))) throw source.fail('invalid-request');
        const query = String(r.query || '').slice(0,200).toLocaleLowerCase();
        const searchKey = JSON.stringify([query,r.period || '']);
        const filtered = cache.searches.get(searchKey) || items.filter(i => (!query || `${i.title} ${i.artistName}`.toLocaleLowerCase().includes(query)) && (!r.period || (i.likedAt?.slice(0,7) || 'unknown') === r.period));
        cache.searches.set(searchKey,filtered); if(cache.searches.size > 8)cache.searches.delete(cache.searches.keys().next().value);
        const offset = Number.isSafeInteger(r.offset) && r.offset >= 0 ? r.offset : 0;
        const limit = Number.isSafeInteger(r.limit) ? Math.max(1,Math.min(200,r.limit)) : 100;
        const anchor = r.trackId ? filtered.findIndex(i => i.itemId === r.trackId) : -1;
        const periods = cache.periods;
        await valid(ctx);
        return { ownerId, generation: lib.generation, revision: lib.revision, items: filtered.slice(offset,offset+limit), matchingCount: filtered.length, indexedCount: items.length, complete: lib.complete, anchor, periods, requestId: r.requestId };
      }
      throw source.fail('invalid-request');
    }
    function invalidate() {
      sessionEpoch++; identity = null; cache = null; for (const c of controllers) c.abort();
      chrome.tabs.query({ url: 'https://soundcloud.com/*' }).then(tabs => { for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'LIKES_IDENTITY_CHANGED' }, { frameId: 0 }).catch(() => {}); });
    }
    return { handle, tick, invalidate, convertArtwork };
  }
  root.SCLikesJobs = { create };
})(globalThis);
