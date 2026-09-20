(function () {
  'use strict';
  if (window.top !== window) return;
  const text = globalThis.SCLikesText;
  const TELEPORT_ICON_URL = globalThis.chrome?.runtime?.getURL?.('assets/icons/teleport-to-selected-track.svg') || 'assets/icons/teleport-to-selected-track.svg';
  const REFRESH_ICON_URL = globalThis.chrome?.runtime?.getURL?.('assets/icons/refresh.svg') || 'assets/icons/refresh.svg';
  const STORAGE_ICON_URL = globalThis.chrome?.runtime?.getURL?.('assets/icons/storage.svg') || 'assets/icons/storage.svg';
  const STAR_ICON_URL = globalThis.chrome?.runtime?.getURL?.('assets/icons/star.svg') || 'assets/icons/star.svg';
  const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; };
  let host, shadow, panel, launch, viewport, canvas, search, period, collectionSelect, status, toolbar, detail, settings, syncAction;
  let ownerId, collectionId, sourceUserId, generation, revision, total = 0, count = 0, query = '', filter = '', anchor, selected, previousResults, opened = false, routeEpoch = 0, requestEpoch = 0, statusBusy = false, resizeObserver, focusBefore;
  let lastStatus, lastPoll = 0, renderTimer, searchTimer, saveTimer, restored = false;
  const images = new Map();
  const imageConsumers = new Map();
  const artworkInflight = new Map();
  const cardNodes = new Map();
  let imageEpoch = 0;
  let highlightId = null, anchorPixelOffset = 0;
  function button(label, action, cls = '') { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', () => Promise.resolve(action()).catch(showError)); return b; }
  async function send(type, payload = {}) {
    const epoch = routeEpoch;
    const r = await chrome.runtime.sendMessage({ type, ownerId, collectionId, sourceUserId, ...payload });
    if (epoch !== routeEpoch) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (!r?.success) throw Object.assign(new Error(r?.code || 'network-error'), { code: r?.code || 'network-error' });
    return r;
  }
  function showError(e) {
    if (e.code === 'cancelled') return;
    if (e.code === 'stale-generation') { poll().catch(()=>{}); }
    if (['auth-required','owner-mismatch','pro-required'].includes(e.code)) { canvas?.replaceChildren(); detail?.replaceChildren(); images.clear(); total = count = 0; }
    if (status) status.textContent = text(e.code);
    if (e.code === 'pro-required') gate();
  }
  function updateSyncAction(job) {
    if (!syncAction) return;
    const action = job?.phase === 'indexing' ? 'pause' : job?.phase === 'paused' ? 'resume' : 'refresh';
    const icon = syncAction.querySelector('.action-icon');
    if (action === 'refresh') {
      icon.replaceChildren();
      const refreshIcon = el('img','toolbar-icon'); refreshIcon.src = REFRESH_ICON_URL; refreshIcon.alt = '';
      icon.append(refreshIcon);
    } else icon.textContent = action === 'pause' ? 'Ⅱ' : '▶';
    syncAction.title = text(action);
    syncAction.setAttribute('aria-label', text(action));
    syncAction.classList.toggle('is-running', job?.phase === 'indexing');
  }
  function dimensions() {
    const columns = 6, gap = 6, inset = 8;
    const cell = Math.max(0, (viewport.clientWidth - inset * 2 - (columns - 1) * gap) / columns);
    return { columns, height: cell + 30, cell, gap, inset };
  }
  function visibleOrdinal() { const d = dimensions(); return Math.min(Math.max(0,count-1), Math.floor(viewport.scrollTop / d.height) * d.columns); }
  function persist() {
    clearTimeout(saveTimer); if (!ownerId || !anchor) return;
    saveTimer = setTimeout(() => send('SAVE_LIKES_VIEW', { anchorTrackId: anchor.itemId, query }).catch(() => {}), 350);
  }
  function art(item, size) {
    const box = el('span', 'cover'); box.style.setProperty('--hue', String((Number(item.itemId) * 137.508) % 360));
    box.append(el('span', 'cover-mark', '♪'));
    const cached = images.get(`${item.itemId}:${size}`);
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.dataset.id = item.itemId; img.dataset.size = size;
    if (cached) img.src = cached;
    img.onerror = () => { if (img.src) img.remove(); };
    const key = `${item.itemId}:${size}`; (imageConsumers.get(key) || imageConsumers.set(key,new Set()).get(key)).add(img);
    box.append(img);
    return box;
  }
  function applyImage(id, size, url) {
    const key = `${id}:${size}`;
    for (const img of imageConsumers.get(key) || []) if (img.isConnected && (!img.src || img.src !== url)) img.src = url;
    const consumers = imageConsumers.get(key); if (consumers) for (const img of [...consumers]) if (!img.isConnected) consumers.delete(img);
  }
  async function cachedArt(items, size, epoch) {
    const artEpoch = imageEpoch;
    const ids = [...new Set(items.filter(i => i.artworkUrl && !images.has(`${i.itemId}:${size}`)).map(i => i.itemId))];
    if (!lastStatus?.artwork?.saved) {
      for (const item of items) if (item.artworkUrl) applyImage(item.itemId, size, item.artworkUrl);
      return;
    }
    for (let n = 0; n < ids.length; n += 12) {
      if (epoch !== routeEpoch || !opened) return;
      const batch = ids.slice(n,n+12);
      const token = batch.join(',');
      let request = artworkInflight.get(token);
      if (!request) { request = send('GET_LIKES_ARTWORK', { trackIds: batch, variant: size }); artworkInflight.set(token, request); request.finally(() => artworkInflight.delete(token)).catch(() => {}); }
      const r = await request;
      if (artEpoch !== imageEpoch || epoch !== routeEpoch || !opened) return;
      for (const [id,url] of Object.entries(r.images)) {
        images.set(`${id}:${size}`,url); while (images.size > Math.max(400, canvas?.children.length || 0)) images.delete(images.keys().next().value);
        applyImage(id,size,url);
      }
      for (const item of items.filter(item => ids.slice(n,n+12).includes(item.itemId) && !r.images[item.itemId])) applyImage(item.itemId,size,item.artworkUrl);
    }
  }
  async function render() {
    if (!opened || !generation) return;
    const seq = ++requestEpoch, epoch = routeEpoch, d = dimensions();
    const start = Math.max(0, Math.floor(viewport.scrollTop/d.height)-2)*d.columns;
    const limit = Math.min(200,(Math.ceil(viewport.clientHeight/d.height)+5)*d.columns);
    const r = await send('QUERY_LIKES', { generation, query, period: filter, offset: start, limit });
    if (seq !== requestEpoch || !opened) return;
    count = r.matchingCount; total = r.indexedCount;
    canvas.style.height = `${Math.ceil(count/d.columns)*d.height}px`;
    const focused = shadow.activeElement?.closest('.card');
    const focusedId = focused?.dataset.id;
    if (!count) { cardNodes.clear(); canvas.replaceChildren(); const empty = el('div','empty',text(query || filter ? 'noResults' : 'empty')); if (!r.complete) empty.append(el('p','',text('partial'))); canvas.append(empty); }
    const first = visibleOrdinal();
    anchorPixelOffset = viewport.scrollTop % d.height;
    anchor = r.items[Math.max(0,first-start)] || anchor;
    const wanted = new Set(r.items.map(item => item.itemId));
    for (const [id,node] of cardNodes) if (!wanted.has(id)) { node.remove(); cardNodes.delete(id); }
    for (const [i,item] of r.items.entries()) {
      const index = start+i; let card = cardNodes.get(item.itemId);
      if (!card) {
        card = el('article','card'); card.dataset.id = item.itemId;
        const primary = button('', () => select(item), 'card-main'); primary.setAttribute('aria-label',`${item.title} — ${item.artistName}`);
        primary.append(art(item,48)); const copy = el('span','card-copy'); copy.append(el('strong','',item.title),el('span','artist',item.artistName)); primary.append(copy); card.append(primary); cardNodes.set(item.itemId,card);
      }
      card.classList.toggle('selected',selected?.itemId === item.itemId || highlightId === item.itemId);
      card.style.cssText = `top:${Math.floor(index/d.columns)*d.height}px;left:${d.inset+(index%d.columns)*(d.cell+d.gap)}px;width:${d.cell}px;height:${d.height-d.gap}px`;
      canvas.append(card);
    }
    if (focusedId) { const card = [...canvas.children].find(n=>n.dataset.id===focusedId); (card?.querySelector('.card-main') || viewport).focus({preventScroll:true}); }
    cachedArt(r.items,48,epoch).catch(() => {}); persist();
  }
  async function around(id, preserve = true) {
    if (preserve && (query || filter)) previousResults = { query, filter, anchor: anchor?.itemId };
    query = ''; filter = ''; search.value = ''; period.value = '';
    highlightId = id; anchorPixelOffset = 0;
    await restoreAnchor(id);
    shadow.querySelector('.back-results').hidden = !previousResults;
  }
  async function restoreAnchor(id) {
    const r = await send('QUERY_LIKES',{generation,query,period:filter,trackId:id,limit:1});
    if (r.anchor < 0) { status.textContent = text('missing'); viewport.scrollTop = 0; await render(); return; }
    const d = dimensions(); count = r.matchingCount; canvas.style.height = `${Math.ceil(count/d.columns)*d.height}px`;
    viewport.scrollTop = Math.floor(r.anchor/d.columns)*d.height + Math.min(anchorPixelOffset,d.height-1); await render();
  }
  async function openTrack(item) {
    anchor = item; await send('SAVE_LIKES_VIEW',{anchorTrackId:item.itemId,query});
    await send('OPEN_LIKED_TRACK',{generation,trackId:item.itemId});
  }
  function select(item) {
    selected = item; detail.hidden = false; detail.replaceChildren(); detail.append(art(item,48));
    const copy = el('div','detail-copy'); copy.append(el('strong','',item.title),el('span','',item.artistName)); detail.append(copy);
    const actions = el('div','detail-actions');
    const open = button(text('open')+' ↗',()=>openTrack(item),'accent'); open.title = text('openHint'); actions.append(open);
    const locateButton = button('',()=>locate(item),'small locate-action');
    const locateIcon = el('img','locate-icon'); locateIcon.src = TELEPORT_ICON_URL; locateIcon.alt = '';
    locateButton.append(locateIcon); locateButton.title = 'Teleport to selected track'; locateButton.setAttribute('aria-label','Teleport to selected track'); actions.append(locateButton);
    detail.append(actions, status);
    render().catch(showError);
  }
  async function locate(item) {
    const r = await send('LOCATE_LIKED_TRACK',{generation,trackId:item.itemId});
    status.textContent = text('locating'); const cancel = button(text('cancel'),()=>SCLikesLocator.cancel(),'small'); status.append(cancel);
    const found = await SCLikesLocator.locate(r.permalink, n => { status.textContent = `${text('locating')} ${n}`; });
    status.textContent = text(found ? 'located' : 'locateStopped');
  }
  function gate() {
    viewport.hidden = toolbar.hidden = true;
    const empty = el('div','gate'); empty.append(el('span','eyebrow','LIFETIME PRO'),el('h2','',text('pro')),el('p','',text('proInfo')),button(text('getPro')+' ↗',()=>document.dispatchEvent(new CustomEvent('scdl:open-player-tools-pro')),'accent'));
    empty.append(button(text('removeLibrary'),async()=>{ if(confirm(text('confirmDelete'))) { await send('DELETE_LIKES_LIBRARY'); images.clear(); status.textContent = text('empty'); } },'danger'));
    empty.append(button(text('close'),close,'small'));
    settings.replaceChildren(empty); settings.hidden = false;
  }
  async function poll() {
    if (!opened || statusBusy) return; statusBusy = true;
    try {
      const r = await send('GET_LIKES_LIBRARY_STATUS'); lastStatus = r; ownerId = r.ownerId; collectionId = r.collectionId; sourceUserId = r.sourceUserId;
      const lib = r.library, job = r.job;
      status.textContent = job?.error ? text(job.error) : `${text(job?.phase === 'indexing' ? 'indexing' : job?.phase === 'paused' ? 'paused' : lib?.complete ? 'complete' : 'welcome')}${lib ? ' · '+(job?.count || lib.count).toLocaleString()+' '+text('tracks') : ''}`;
      updateSyncAction(job);
      if (collectionSelect) {
        const old = collectionSelect.value;
        collectionSelect.replaceChildren();
        for (const value of r.collections || []) collectionSelect.add(new Option(value.name || value.sourceUserId, value.collectionId));
        if (!collectionSelect.options.length) collectionSelect.add(new Option(r.sourceUserId === r.ownerId ? text('likes') : (r.sourceUserId || text('likes')), r.collectionId));
        collectionSelect.value = (r.collections || []).some(value => value.collectionId === r.collectionId) ? r.collectionId : old;
      }
      viewport.hidden = toolbar.hidden = false;
      if (!lib) {
        canvas.style.height = 'auto'; canvas.replaceChildren(); const intro = el('div','empty'); intro.append(el('div','hero-mark','♡'),el('h2','',text('welcome')),el('p','',text('intro')),button(text('start')+' →',async()=>{ await send('START_LIKES_INDEX'); await pollAfter(); },'accent')); canvas.append(intro); return;
      }
      const changed = generation !== lib.generation || revision !== lib.revision;
      generation = lib.generation; revision = lib.revision; total = lib.count;
      if (changed || !restored) {
        const r2 = await send('QUERY_LIKES',{generation,limit:1});
        const value = period.value; period.replaceChildren(new Option(text('all'),''));
        for (const [key,p] of Object.entries(r2.periods)) period.add(new Option(`${key === 'unknown' ? text('unknown') : new Date(key+'-02').toLocaleDateString(undefined,{year:'numeric',month:'short'})} · ${p.count}${lib.complete ? '' : '+'}`,key)); period.value = value;
        if (!restored) { restored = true; query = r.view?.query || ''; search.value = query; if (r.view?.anchorTrackId) await restoreAnchor(r.view.anchorTrackId); else await render(); }
        else if (anchor && changed) await restoreAnchor(anchor.itemId); else await render();
      }
    } finally { statusBusy = false; }
  }
  async function pollAfter() { statusBusy = false; await poll(); }
  async function storagePanel() {
    settings.hidden = !settings.hidden; if (settings.hidden) return;
    const r = await send('GET_LIKES_LIBRARY_STATUS'), a = r.artwork;
    settings.replaceChildren(el('h3','',text('covers')),el('p','',text('coverInfo')));
    if (a) settings.append(el('p','',`${a.saved} ${text('saved')} · ${(a.bytes/1048576).toFixed(1)} MB · ${a.failed} ${text('failed')} · ${text(a.phase === 'saving' ? 'saving' : 'paused')}`));
    settings.append(button(text(a?.phase === 'saving' ? 'pause' : 'covers'),async()=>{ await send(a?.phase === 'saving' ? 'PAUSE_LIKES_ARTWORK' : 'START_LIKES_ARTWORK',{consent:true}); settings.hidden = true; },'accent'));
    settings.append(button(text('removeCovers'),async()=>{ imageEpoch++; await send('DELETE_LIKES_ARTWORK'); images.clear(); settings.hidden = true; await render(); }));
    settings.append(button(text('removeLibrary'),async()=>{ if (!confirm(text('confirmDelete'))) return; await send('DELETE_LIKES_LIBRARY'); routeEpoch++; imageEpoch++; requestEpoch++; statusBusy = false; generation = null; total = count = 0; selected = anchor = null; detail.hidden = true; images.clear(); settings.hidden = true; restored = false; await poll(); },'danger'));
    settings.append(el('h3','',text('bookmarks')));
    for (const b of r.bookmarks || []) settings.append(button(b.name,async()=>{ await around(b.anchorTrackId); settings.hidden = true; }));
    settings.append(button(text('close'),()=>{ settings.hidden = true; }));
  }
  function close() { opened = false; panel.hidden = true; launch.hidden = false; requestEpoch++; SCLikesLocator.cancel(); persist(); focusBefore?.focus?.(); }
  async function open() { opened = true; focusBefore = document.activeElement; panel.hidden = false; launch.hidden = true; search.focus(); await poll(); }
  function mount() {
    host = el('div'); host.id = 'scdl-likes-explorer'; shadow = host.attachShadow({mode:'open'});
    const style = el('style'); style.textContent = CSS; shadow.append(style);
    launch = button('♡  Likes',open,'launch'); launch.title = text('title'); shadow.append(launch);
    panel = el('section','shell'); panel.hidden = true; panel.setAttribute('aria-label',text('title')); shadow.append(panel);
    const main = el('div','main'); panel.append(main);
    toolbar = el('div','toolbar'); const toolbarLine = el('div','toolbar-line');
    search = el('input'); search.type = 'search'; search.placeholder = text('search'); search.maxLength = 200; search.setAttribute('aria-label',text('search'));
    const searchWrap = el('div','search-wrap'); searchWrap.append(search); const closeButton = button('×',close,'close search-close'); closeButton.setAttribute('aria-label',text('close')); closeButton.title = text('close'); searchWrap.append(closeButton); toolbarLine.append(searchWrap);
    period = el('select'); period.setAttribute('aria-label',text('all')); period.add(new Option(text('all'),'')); toolbarLine.append(period);
    collectionSelect = el('select'); collectionSelect.className = 'collection-select'; collectionSelect.setAttribute('aria-label',text('likes')); toolbarLine.append(collectionSelect);
    syncAction = button('',async()=>{
      syncAction.classList.add('is-loading'); syncAction.disabled = true;
      try { const phase = lastStatus?.job?.phase; await send(phase === 'indexing' ? 'CANCEL_LIKES_INDEX' : phase === 'paused' ? 'START_LIKES_INDEX' : 'REFRESH_LIKES_LIBRARY'); await pollAfter(); }
      finally { syncAction.classList.remove('is-loading'); syncAction.disabled = false; }
    },'sync action-button');
    syncAction.append(el('span','action-icon'),el('span','action-spinner')); toolbarLine.append(syncAction);
    const storage = button('',storagePanel,'small action-button icon-only'); const storageIcon = el('img','toolbar-icon'); storageIcon.src = STORAGE_ICON_URL; storageIcon.alt = ''; storage.append(storageIcon); storage.title = text('settings'); storage.setAttribute('aria-label',text('settings')); toolbarLine.append(storage);
    const bookmark = button('',async()=>{ if (!anchor) return; const name = prompt(text('bookmarkName'),anchor.title); if (name) await send('SAVE_LIKES_BOOKMARK',{trackId:anchor.itemId,name}); },'small action-button icon-only'); const starIcon = el('img','toolbar-icon star-icon'); starIcon.src = STAR_ICON_URL; starIcon.alt = ''; bookmark.append(starIcon); bookmark.title = text('bookmark'); bookmark.setAttribute('aria-label',text('bookmark')); toolbarLine.append(bookmark);
    toolbar.append(toolbarLine); status = el('span','status'); status.setAttribute('role','status');
    const back = button('← '+text('back'),async()=>{ if (!previousResults) return; const saved = previousResults; query = saved.query; filter = saved.filter; search.value = query; period.value = filter; previousResults = null; back.hidden = true; if(saved.anchor) await restoreAnchor(saved.anchor); else {viewport.scrollTop = 0; await render();} },'back-results'); back.hidden = true; main.append(back);
    settings = el('div','settings'); settings.hidden = true; main.append(settings);
    viewport = el('div','viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label',text('likes')); canvas = el('div','canvas'); viewport.append(canvas); main.append(viewport);
    detail = el('div','detail'); detail.hidden = true; main.append(detail,toolbar);
    document.body.append(host); layout();
    search.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ query = search.value; viewport.scrollTop = 0; render().catch(showError); },160); });
    period.addEventListener('change',()=>{ filter = period.value; viewport.scrollTop = 0; render().catch(showError); });
    collectionSelect.addEventListener('change',()=>{ const item=(lastStatus?.collections || []).find(value=>value.collectionId===collectionSelect.value); if (!item) return; collectionId=item.collectionId; sourceUserId=item.sourceUserId; generation=null; revision=null; anchor=selected=null; restored=false; viewport.scrollTop=0; pollAfter().catch(showError); });
    viewport.addEventListener('scroll',()=>{ clearTimeout(renderTimer); renderTimer = setTimeout(()=>render().catch(showError),45); });
    shadow.addEventListener('keydown',e=>{ if(e.key === 'Escape') { if (!settings.hidden) settings.hidden = true; else close(); } });
    resizeObserver = new ResizeObserver(()=>{ layout(); if(opened && generation && anchor) restoreAnchor(anchor.itemId).catch(showError); }); resizeObserver.observe(viewport);
  }
  function layout() {
    if (!host) return;
    const header = document.querySelector('.header'), player = document.querySelector('.playControls');
    const top = Math.max(12,header?.getBoundingClientRect().bottom || 48)+12;
    const playerTop = player?.getBoundingClientRect().top;
    const bottom = playerTop > 0 && playerTop < innerHeight ? innerHeight-playerTop+12 : 88;
    host.style.setProperty('--top',`${top}px`); host.style.setProperty('--bottom',`${bottom}px`);
  }
  function dispose() {
    routeEpoch++; imageEpoch++; opened = false; resizeObserver?.disconnect(); clearTimeout(renderTimer); clearTimeout(searchTimer); clearTimeout(saveTimer); SCLikesLocator.cancel(); host?.remove(); host = null; generation = null; ownerId = collectionId = sourceUserId = null; anchor = selected = null; restored = false; previousResults = null; query = filter = ''; statusBusy = false; images.clear(); imageConsumers.clear(); artworkInflight.clear();
  }
  function route() {
    const eligible = location.origin === 'https://soundcloud.com' && /^\/(?:you|[^/]+)\/likes$/.test(location.pathname.replace(/\/$/,''));
    if (!eligible) { if(host) dispose(); return; }
    if (!host && document.body) mount();
    if (host && location.hash === '#scdl-explore') { history.replaceState(history.state,'',location.pathname+location.search); open().catch(showError); }
    if (opened && Date.now()-lastPoll > 1800) { lastPoll = Date.now(); poll().catch(showError); }
  }
  chrome.runtime.onMessage.addListener(message=>{ if(message.type === 'LIKES_IDENTITY_CHANGED') { dispose(); route(); } if(message.type === 'OPEN_LIKES_EXPLORER') { route(); if(host) open().catch(showError); } });
  document.addEventListener('scdl:open-likes-explorer',()=>{ location.href = 'https://soundcloud.com/you/likes#scdl-explore'; });
  const CSS = `
    :host{all:initial;--top:60px;--bottom:88px;font:13px/1.45 system-ui,-apple-system,sans-serif;color:#ece9e4;position:fixed;inset:0;z-index:2147483647;isolation:isolate;contain:paint;pointer-events:none;color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important} button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #ffffff15;background:#ffffff06;border-radius:8px;padding:7px 10px;transition:background .15s,border-color .15s}button:hover{background:#ffffff12;border-color:#ffffff38}button:focus-visible,input:focus-visible,select:focus-visible,.viewport:focus-visible{outline:2px solid #ff996a;outline-offset:2px}button:disabled{opacity:.4}input,select{color:inherit;background:#141416;border:1px solid #ffffff15;border-radius:8px;padding:9px;min-width:0}h2,h3,p{margin:0}h2{font-size:25px;line-height:1.2;letter-spacing:-.7px}h3{font-size:14px}p{color:#a9a5a1}strong{font-weight:550} .launch{pointer-events:auto;position:absolute;right:12px;top:45%;background:#202023ed;color:#d9d4cf;box-shadow:0 4px 20px #0003;padding:11px 12px;border-radius:14px 5px 5px 14px;font-size:12px}
    .shell{pointer-events:auto;position:absolute;top:var(--top);bottom:var(--bottom);right:12px;z-index:2;display:flex;max-width:calc(100vw - 24px);filter:drop-shadow(0 20px 35px #0005);isolation:isolate}.main{pointer-events:auto;position:relative;z-index:2;width:720px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;min-height:0;background:#1b1b1e;border:1px solid #ffffff1f;border-radius:14px;overflow:hidden;isolation:isolate}.eyebrow{font-size:9px;letter-spacing:2px;color:#c39379;font-weight:600}.close{border:0;background:transparent;font-size:22px;line-height:1;padding:3px 6px;color:#aaa;flex:0 0 auto}.toolbar{pointer-events:auto;position:relative;z-index:3;padding:9px 10px 7px;border-bottom:1px solid #ffffff0b;background:#1b1b1e}.toolbar-line{pointer-events:auto;position:relative;z-index:4;display:flex;align-items:center;gap:5px}.search-wrap{position:relative;z-index:5;flex:1;min-width:130px}.toolbar input,.toolbar button,.toolbar select{pointer-events:auto;position:relative;z-index:6}.toolbar input{width:100%;height:28px;padding:7px 29px 7px 9px;font-size:10px}.search-close{position:absolute;top:50%;right:3px;transform:translateY(-50%);width:24px;height:24px;padding:0;font-size:16px}.toolbar select{width:98px;height:28px;flex:0 0 auto;font-size:9px;padding:6px}.status{display:block;min-height:12px;margin-top:4px;color:#96918b;font-size:8px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.small{padding:4px 7px;min-width:28px;min-height:28px}.action-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:4px 7px}.icon-only{width:28px;padding:0}.action-icon{font-size:12px;line-height:1}.sync{width:28px;padding:0;overflow:hidden;font-size:9px;white-space:nowrap}.action-spinner{display:none;width:10px;height:10px;border:2px solid #ffffff35;border-top-color:#f1a078;border-radius:50%;animation:spin .7s linear infinite}.sync.is-loading .action-icon,.sync.is-running .action-icon{display:none}.sync.is-loading .action-spinner,.sync.is-running .action-spinner{display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.viewport{pointer-events:auto;position:relative;z-index:2;flex:1;min-height:80px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#55514d transparent;padding-top:6px;background:#1b1b1e}.canvas{position:relative}.card{position:absolute;overflow:hidden;border-radius:7px;padding:3px;background:transparent;border:1px solid transparent}.card:hover{background:#ffffff05;border-color:#ffffff12}.card.selected{background:#ff915710;border-color:#ffffff55}.card-main{padding:0;border:0;background:none!important;display:block;width:100%;text-align:left}.cover{position:relative;display:block;aspect-ratio:1;background:linear-gradient(140deg,hsl(var(--hue) 23% 28%),hsl(var(--hue) 18% 13%));border-radius:5px;overflow:hidden}.cover-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;color:#ffffff30}.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.card-copy{display:block;padding:4px 1px 0;min-width:0}.card-copy strong,.artist{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;line-height:1.15}.artist{font-size:9px;color:#98928c;margin-top:2px}.empty{padding:40px 28px;text-align:center;max-width:420px;margin:auto}.empty p{font-size:12px;margin:12px 0 22px;line-height:1.7}.hero-mark{font-size:55px;color:#db9574;margin-bottom:12px}.accent{background:#e99b74!important;color:#221b17!important;border-color:#e99b74!important;font-weight:600;font-size:11px;padding:9px 13px}.detail{pointer-events:auto;position:relative;z-index:3;display:flex;flex-wrap:wrap;gap:7px;align-items:center;border-top:1px solid #ffffff12;padding:8px 10px;background:#252326}.detail-actions{display:flex;align-items:center;gap:7px;flex:1;min-width:0;pointer-events:auto}.detail>.cover{width:34px;height:34px;flex-shrink:0}.detail-copy{flex:1;min-width:0;font-size:11px}.detail-copy>*{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail-copy span{font-size:10px;color:#aaa}.detail .accent{font-size:10px;max-width:110px;padding:6px}.detail .small{padding:4px;min-width:24px}.detail .status{flex:0 0 100%;margin:0 0 0 41px}.back-results{margin:6px 10px 0;text-align:left;font-size:10px;color:#e8a581;border:0}.settings{padding:18px;overflow:auto;max-height:55%;background:#242326;border-bottom:1px solid #ffffff15}.settings p{font-size:12px;margin:8px 0 12px}.settings button{font-size:11px;margin:4px}.settings h3:not(:first-child){margin-top:16px}.danger{color:#efa699}.gate{padding:20px 10px}.gate h2{margin:12px 0}.gate p{line-height:1.7}.shell:has(.gate) .settings{max-height:none}
    .toolbar{border-top:1px solid #ffffff12;border-bottom:0}.toolbar .search-close{position:absolute;z-index:7}.toolbar-icon{display:block;width:16px;height:16px;filter:invert(1)}.toolbar-icon.star-icon{filter:none}.card.selected{border-color:#ff915755}.detail{border-top:1px solid #ffffff12}.detail .accent{display:inline-flex;align-items:center;justify-content:center;max-width:none;white-space:nowrap;line-height:1}.locate-action{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;padding:4px}.locate-icon{display:block;width:16px;height:16px;filter:invert(1)}
    @media(max-width:759px){.main{width:720px;max-width:calc(100vw - 24px)}.detail{flex-wrap:wrap}.detail-copy{min-width:80px}.toolbar select{width:92px}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}.action-spinner{animation:none!important}}
  `;
  setInterval(route,500); window.addEventListener('popstate',route); window.addEventListener('resize',layout); route();
})();
