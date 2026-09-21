(function (root) {
  'use strict';
  const db = root.SCLikesLibrary, source = root.SCLikesSource;
  function create({ getToken, resolveUser, access }) {
    let running = false, sessionEpoch = 0, identity = null, cache = null;
    const collectionCaches = new Map();
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
        await collectionTick();
        await collectionArtworkTick();
        await artworkTick();
      } finally { running = false; }
      if ((await db.all('jobs')).some(j => j.phase === 'indexing') || (await db.all('collectionJobs')).some(j=>j.phase==='indexing') || (await db.all('collectionArtworkJobs')).some(j=>j.phase==='saving')) setTimeout(() => tick().catch(() => {}), 300);
    }
    async function collectionTick() {
      for (const initial of await db.all('collectionJobs')) {
        if (initial.phase === 'paused' && initial.retryAt && initial.retryAt <= Date.now()) { await db.startCollection(initial.accountId, initial, false); initial.phase='indexing'; }
        if (initial.phase !== 'indexing') continue;
        try {
          await authorize(); const ctx=await context(null,initial.accountId);
          for(let n=0;n<8;n++) {
            const job=await db.get('collectionJobs',[initial.accountId,initial.collectionId]); if(!job||job.phase!=='indexing')break;
            await valid(ctx); const controller=new AbortController(); controllers.add(controller); const timeout=setTimeout(()=>controller.abort(),15000); let page;
            // `ctx.ownerId` is the authenticated account. The source profile
            // is independent and must be applied after spreading the session
            // context, otherwise third-party collections fetch the account's
            // own likes.
            try { page=await source.fetchPage({...ctx,ownerId:job.sourceUserId,nextCursor:job.nextCursor,signal:controller.signal}); }
            finally {clearTimeout(timeout);controllers.delete(controller);}
            const previous=await db.get('collections',[job.accountId,job.collectionId]); await valid(ctx);
            if(!await db.commitCollection(job,page))break;
            if(!page.nextCursor) await db.pruneCollection(job.accountId,job.collectionId,[job.generation,previous?.activeGeneration].filter(Boolean));
            collectionCaches.delete(`${job.accountId}:${job.collectionId}`);
          }
        } catch(e) {
          const key=[initial.accountId,initial.collectionId], job=await db.get('collectionJobs',key); if(!job)continue;
          const code=e.name==='QuotaExceededError'?'storage-full':e.code||'network-error';
          await db.put('collectionJobs',{...job,phase:'paused',error:code,epoch:job.epoch+1,retryAt:['rate-limited','network-error'].includes(code)&&Number(job.attempts||0)<4?Date.now()+60000*2**Number(job.attempts||0):null,attempts:Number(job.attempts||0)+1});
        }
      }
    }
    async function collectionArtworkTick() {
      for (const initial of await db.all('collectionArtworkJobs')) {
        if(initial.phase!=='saving')continue;
        try {
          await authorize();const ctx=await context(null,initial.accountId);const collection=await db.get('collections',[initial.accountId,initial.collectionId]);if(!collection)continue;
          for(let n=0;n<4;n++){
            const job=await db.get('collectionArtworkJobs',[initial.accountId,initial.collectionId]);if(!job||job.phase!=='saving'||job.epoch!==initial.epoch)break;
            const item=(await db.window(job.accountId,job.collectionId,job.generation,job.offset,1))[0];
            if(!item){if(collection.complete)await db.put('collectionArtworkJobs',{...job,phase:'complete'});break;}
            let asset=item.artworkUrl&&await db.get('accountArtwork',[job.accountId,item.artworkUrl]);
            if(item.artworkUrl&&!asset){try{asset=await convertArtwork(item.artworkUrl);}catch{job.failed++;}}
            await db.transaction(['collectionArtworkJobs','accountArtwork'],true,async s=>{const current=await db.request(s('collectionArtworkJobs').get([job.accountId,job.collectionId]));if(!current||current.epoch!==job.epoch||current.phase!=='saving')return;if(asset&&!asset.accountId){if(Number(current.bytes||0)+asset.bytes>200*1024*1024){s('collectionArtworkJobs').put({...current,phase:'paused',error:'storage-full'});return;}s('accountArtwork').put({...asset,accountId:job.accountId,artworkKey:item.artworkUrl,formatVersion:2});job.bytes=Number(job.bytes||0)+asset.bytes;job.saved=Number(job.saved||0)+1;}job.offset++;s('collectionArtworkJobs').put(job);});
          }
        }catch(e){const job=await db.get('collectionArtworkJobs',[initial.accountId,initial.collectionId]);if(job?.epoch===initial.epoch)await db.put('collectionArtworkJobs',{...job,phase:'paused',error:e.code||'storage-full'});}
      }
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
    async function collectionRecords(collection, query='', period='') {
      const key=`${collection.accountId}:${collection.collectionId}:${collection.activeGeneration}:${collection.revision}:${query}:${period}`;
      if(collectionCaches.has(key))return collectionCaches.get(key);
      const normalized=String(query||'').toLocaleLowerCase(), result=[]; let offset=0;
      while(true){const batch=await db.window(collection.accountId,collection.collectionId,collection.activeGeneration,offset,400);if(!batch.length)break;for(const item of batch)if((!normalized||`${item.title} ${item.artistName}`.toLocaleLowerCase().includes(normalized))&&(!period||(item.likedAt?.slice(0,7)||'unknown')===period))result.push(item);offset+=batch.length;if(batch.length<400)break;await new Promise(resolve=>setTimeout(resolve,0));}
      collectionCaches.set(key,result);while(collectionCaches.size>6)collectionCaches.delete(collectionCaches.keys().next().value);return result;
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
    async function convertArtwork(url, { request = fetch, timeoutMs = 15000 } = {}) {
      if (!source.artwork(url)) throw source.fail('invalid-request');
      const controller = new AbortController(); let timedOut = false; let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(source.fail('network-timeout')); }, timeoutMs);
      });
      let chunks;
      try {
        chunks = await Promise.race([(async () => {
          const response = await request(url.replace(/-large\./, '-t200x200.'), { credentials: 'omit', redirect: 'error', signal: controller.signal });
          const contentType = response.headers?.get?.('content-type') || '';
          const declaredValue = response.headers?.get?.('content-length');
          const declared = declaredValue == null ? null : Number(declaredValue);
          if (!response.ok || !/^image\/(jpeg|png|webp)/.test(contentType) ||
              (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > 2 * 1024 * 1024))) {
            response.body?.cancel?.().catch?.(() => {}); throw source.fail('invalid-image');
          }
          const reader = response.body?.getReader?.();
          if (!reader) throw source.fail('invalid-image');
          const values = []; let bytes = 0;
          try {
            while (true) {
              const result = await reader.read(); if (result.done) break;
              if (!(result.value instanceof Uint8Array) || bytes + result.value.byteLength > 2 * 1024 * 1024) throw source.fail('invalid-image');
              bytes += result.value.byteLength; values.push(result.value);
            }
            return values;
          } catch (error) {
            await reader.cancel().catch(() => {}); throw error;
          } finally { reader.releaseLock?.(); }
        })(), timeout]);
      } catch (error) {
        if (timedOut) throw source.fail('network-timeout');
        if (error?.code) throw error;
        throw Object.assign(source.fail('network-error'), { cause: error });
      } finally { clearTimeout(timer); }
      const bitmap = await createImageBitmap(new Blob(chunks));
      try {
        if (bitmap.width * bitmap.height > 16000000) throw source.fail('invalid-image');
        const variants = {}; let total = 0;
        for (const size of [48]) {
          const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
          const side = Math.min(bitmap.width, bitmap.height);
          ctx.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, size, size);
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality: .55 });
          if (blob.type !== 'image/webp') throw source.fail('webp-unavailable');
          variants[size] = blob; total += blob.size;
        }
        return { variants, bytes: total };
      } finally { bitmap.close(); }
    }
    function checkSender(sender) {
      if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || new URL(sender.url || sender.tab.url).origin !== 'https://soundcloud.com') throw source.fail('invalid-request');
    }
    function sourceNameFromUrl(value) {
      try { const segment = new URL(value).pathname.split('/').filter(Boolean)[0]; return segment ? decodeURIComponent(segment).slice(0, 200) : null; } catch { return null; }
    }
    async function handle(r, sender) {
      checkSender(sender); const deleting=['DELETE_LIKES_LIBRARY','DELETE_LIKES_ARTWORK'].includes(r.type); if(!deleting)await authorize(sender);
      const ctx=await context(sender,r.accountId||r.ownerId); const accountId=ctx.ownerId; await db.ensureLegacyMigrated(accountId);
      let pageContext=null;
      if(!r.sourceUserId&&sender?.tab?.id) try { pageContext=await chrome.tabs.sendMessage(sender.tab.id,{type:'GET_LIKES_CONTEXT'},{frameId:0}); } catch {}
      const requestedSource=String(r.sourceUserId||pageContext?.sourceUserId||accountId); if(!/^\d+$/.test(requestedSource))throw source.fail('invalid-request');
      const collectionId=String(r.collectionId||db.collectionKey(requestedSource)); if(collectionId!==db.collectionKey(requestedSource)&&!/^likes:[A-Za-z0-9_-]{1,80}$/.test(collectionId))throw source.fail('invalid-request');
      const key=[accountId,collectionId];
      if(r.type==='START_LIKES_INDEX'||r.type==='REFRESH_LIKES_LIBRARY'){
        const sourceUrl = r.sourceUrl || pageContext?.sourceUrl || null;
        const sourceName = r.sourceName || pageContext?.sourceName || sourceNameFromUrl(sourceUrl) || (requestedSource === accountId ? ctx.displayName : `Likes · ${requestedSource}`);
        const job=await db.startCollection(accountId,{collectionId,sourceUserId:requestedSource,sourceUrl,name:String(sourceName).slice(0,200)},r.type==='REFRESH_LIKES_LIBRARY');
        chrome.alarms.create('scdl-likes',{periodInMinutes:1});tick().catch(()=>{});return{ownerId:accountId,accountId,collectionId,operationId:job?.operationId};
      }
      if(r.type==='CANCEL_LIKES_INDEX'){const job=await db.get('collectionJobs',key);if(job)await db.put('collectionJobs',{...job,phase:'paused',epoch:job.epoch+1,retryAt:null});return{};}
      if(r.type==='DELETE_LIKES_LIBRARY'){await db.eraseCollection(accountId,collectionId);if(collectionId===db.collectionKey(accountId))await db.erase(accountId);collectionCaches.clear();return{};}
      if(r.type==='DELETE_LIKES_ARTWORK'){await db.eraseCollection(accountId,collectionId,true);if(collectionId===db.collectionKey(accountId))await db.erase(accountId,true);collectionCaches.clear();return{};}
      const collection=await db.get('collections',key);
      if(r.type==='GET_LIKES_LIBRARY_STATUS'){
        const collections=await db.listCollections(accountId),job=await db.get('collectionJobs',key),artwork=await db.get('collectionArtworkJobs',key),view=await db.get('collectionViews',key),stats=await db.storageStats(accountId);
        await valid(ctx);
        return{ownerId:accountId,accountId,collectionId,sourceUserId:requestedSource,displayName:ctx.displayName,library:collection?{...collection,generation:collection.activeGeneration}:null,collection:collection||null,collections,job,artwork,view,storage:stats};
      }
      if(!collection)throw source.fail('not-indexed');const generation=collection.activeGeneration;
      if(r.generation&&r.generation!==generation)throw source.fail('stale-generation');
      if(r.type==='SAVE_LIKES_VIEW'){await db.put('collectionViews',{accountId,collectionId,anchorTrackId:String(r.anchorTrackId||'').slice(0,30),query:String(r.query||'').slice(0,200),period:String(r.period||'').slice(0,7),offset:Number(r.offset)||0});return{};}
      const locate=async id=>{const ordinal=await db.position(accountId,collectionId,generation,id);if(ordinal<0)throw source.fail('track-missing');return(await db.window(accountId,collectionId,generation,ordinal,1))[0];};
      if(r.type==='OPEN_LIKED_TRACK'||r.type==='LOCATE_LIKED_TRACK'){const item=await locate(r.trackId);if(!item?.permalink)throw source.fail('track-missing');await valid(ctx);if(r.type==='OPEN_LIKED_TRACK'){await chrome.tabs.update(sender.tab.id,{url:item.permalink});return{phase:'needs-user-action'};}return{permalink:item.permalink};}
      if(r.type==='GET_LIKES_ARTWORK'){
        if(!Array.isArray(r.trackIds)||r.trackIds.length>24)throw source.fail('invalid-request');const images={};let total=0;
        const assets=await db.transaction(['collectionEntries','tracks','accountArtwork'],false,async s=>Promise.all(r.trackIds.map(async id=>{const entry=await db.request(s('collectionEntries').index('track').get([accountId,collectionId,generation,String(id)]));if(!entry)return null;const item=await db.request(s('tracks').get([accountId,String(id)]));const asset=item?.artworkUrl?await db.request(s('accountArtwork').get([accountId,item.artworkUrl])):null;return{id:String(id),asset};})));
        for(const value of assets){const blob=value?.asset?.variants?.[48];if(!blob||total+blob.size*1.4>512*1024)continue;total+=blob.size*1.4;images[value.id]='data:image/webp;base64,'+btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));}
        await valid(ctx);return{images};
      }
      if(r.type==='GET_LIKES_DOWNLOAD_SELECTION'){
        const offset=Number.isSafeInteger(r.offset)?r.offset:0,limit=Math.min(200,Math.max(1,Number(r.limit)||200));const items=await db.window(accountId,collectionId,generation,offset,limit);return{collectionId,generation,items:items.map(i=>({id:i.itemId,index:i.trackOrdinal+1,title:i.title,permalink:i.permalink})),nextOffset:offset+items.length<collection.count?offset+items.length:null,total:collection.count};
      }
      if(r.type==='START_LIKES_ARTWORK'||r.type==='PAUSE_LIKES_ARTWORK'){
        if(r.type==='START_LIKES_ARTWORK'&&r.consent!==true)throw source.fail('invalid-request');const old=await db.get('collectionArtworkJobs',key);await db.put('collectionArtworkJobs',{accountId,collectionId,generation,offset:0,bytes:0,saved:0,failed:0,...old,epoch:crypto.randomUUID(),phase:r.type==='START_LIKES_ARTWORK'?'saving':'paused'});chrome.alarms.create('scdl-likes',{periodInMinutes:1});tick().catch(()=>{});return{};
      }
      if(r.type==='QUERY_LIKES'){
        if((r.query!==undefined&&(typeof r.query!=='string'||r.query.length>200))||(r.offset!==undefined&&(!Number.isSafeInteger(r.offset)||r.offset<0))||(r.limit!==undefined&&(!Number.isInteger(r.limit)||r.limit<1||r.limit>200))||(r.period&&r.period!=='unknown'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period)))throw source.fail('invalid-request');
        const offset=Number.isSafeInteger(r.offset)?r.offset:0,limit=Number.isInteger(r.limit)?r.limit:100,filtered=Boolean(r.query||r.period);let items,matchingCount,anchor=-1;
        if(!filtered){matchingCount=collection.count;anchor=r.trackId?await db.position(accountId,collectionId,generation,r.trackId):-1;items=await db.window(accountId,collectionId,generation,offset,limit);}
        else{const matches=await collectionRecords(collection,r.query,r.period);matchingCount=matches.length;anchor=r.trackId?matches.findIndex(i=>i.itemId===r.trackId):-1;items=matches.slice(offset,offset+limit);}
        let periods=collection.periods||null;if(r.includePeriods||!periods){const all=await collectionRecords(collection);periods={};for(const i of all){const p=i.likedAt?.slice(0,7)||'unknown';periods[p]||={count:0,firstTrackId:i.itemId};periods[p].count++;}if(collection.complete)await db.put('collections',{...collection,periods});}
        await valid(ctx);return{ownerId:accountId,accountId,collectionId,generation,revision:collection.revision,items,matchingCount,indexedCount:collection.count,complete:collection.complete,anchor,periods,requestId:r.requestId};
      }
      throw source.fail('invalid-request');
    }
    function invalidate() {
      sessionEpoch++; identity = null; cache = null; collectionCaches.clear(); for (const c of controllers) c.abort();
      chrome.tabs.query({ url: 'https://soundcloud.com/*' }).then(tabs => { for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'LIKES_IDENTITY_CHANGED' }, { frameId: 0 }).catch(() => {}); });
    }
    return { handle, tick, invalidate, convertArtwork };
  }
  root.SCLikesJobs = { create };
})(globalThis);
