(function () {
  'use strict';
  if (window.top !== window) return;
  const text = globalThis.SCLikesText;
  const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; };
  let host, shadow, panel, launch, viewport, canvas, rail, mapCanvas, indicator, search, period, status, toolbar, detail, settings, syncAction;
  let ownerId, generation, revision, total = 0, count = 0, query = '', filter = '', anchor, selected, previousResults, opened = false, routeEpoch = 0, requestEpoch = 0, mapEpoch = 0, statusBusy = false, resizeObserver, focusBefore;
  let lastStatus, lastPoll = 0, drag, renderTimer, searchTimer, saveTimer, raf, mapManual = false, restored = false;
  const images = new Map();
  let imageEpoch = 0;
  let highlightId = null, anchorPixelOffset = 0;
  function button(label, action, cls = '') { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', () => Promise.resolve(action()).catch(showError)); return b; }
  async function send(type, payload = {}) {
    const epoch = routeEpoch;
    const r = await chrome.runtime.sendMessage({ type, ownerId, ...payload });
    if (epoch !== routeEpoch) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (!r?.success) throw Object.assign(new Error(r?.code || 'network-error'), { code: r?.code || 'network-error' });
    return r;
  }
  function showError(e) {
    if (e.code === 'cancelled') return;
    if (e.code === 'stale-generation') { endDrag(); poll().catch(()=>{}); }
    if (['auth-required','owner-mismatch','pro-required'].includes(e.code)) { canvas?.replaceChildren(); mapCanvas?.replaceChildren(); detail?.replaceChildren(); images.clear(); total = count = 0; }
    if (status) status.textContent = text(e.code);
    if (e.code === 'pro-required') gate();
  }
  function updateSyncAction(job) {
    if (!syncAction) return;
    const action = job?.phase === 'indexing' ? 'pause' : job?.phase === 'paused' ? 'resume' : 'refresh';
    syncAction.querySelector('.action-icon').textContent = action === 'pause' ? 'Ⅱ' : action === 'resume' ? '▶' : '↻';
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
    const url = cached || item.artworkUrl;
    if (url) { const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = url; img.dataset.id = item.itemId; img.dataset.size = size; img.onerror = () => img.remove(); box.append(img); }
    return box;
  }
  async function cachedArt(items, size, epoch) {
    const artEpoch = imageEpoch;
    const ids = [...new Set(items.filter(i => i.artworkUrl && !images.has(`${i.itemId}:${size}`)).map(i => i.itemId))];
    for (let n = 0; n < ids.length; n += 12) {
      if (epoch !== routeEpoch || !opened || !lastStatus?.artwork?.saved) return;
      const r = await send('GET_LIKES_ARTWORK', { trackIds: ids.slice(n,n+12), variant: size });
      if (artEpoch !== imageEpoch || epoch !== routeEpoch || !opened) return;
      for (const [id,url] of Object.entries(r.images)) {
        images.set(`${id}:${size}`,url); while (images.size > 320) images.delete(images.keys().next().value);
        for (const img of shadow.querySelectorAll('img[data-id]')) if (img.dataset.id === id && img.dataset.size === String(size)) img.src = url;
      }
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
    canvas.replaceChildren();
    if (!count) { const empty = el('div','empty',text(query || filter ? 'noResults' : 'empty')); if (!r.complete) empty.append(el('p','',text('partial'))); canvas.append(empty); }
    const first = visibleOrdinal();
    anchorPixelOffset = viewport.scrollTop % d.height;
    anchor = r.items[Math.max(0,first-start)] || anchor;
    for (const [i,item] of r.items.entries()) {
      const index = start+i, card = el('article',`card ${selected?.itemId === item.itemId || highlightId === item.itemId ? 'selected' : ''}`);
      card.dataset.id = item.itemId;
      card.style.cssText = `top:${Math.floor(index/d.columns)*d.height}px;left:${d.inset+(index%d.columns)*(d.cell+d.gap)}px;width:${d.cell}px;height:${d.height-d.gap}px`;
      const primary = button('', () => select(item), 'card-main'); primary.setAttribute('aria-label',`${item.title} — ${item.artistName}`);
      primary.append(art(item,48));
      const copy = el('span','card-copy'); copy.append(el('strong','',item.title),el('span','artist',item.artistName)); primary.append(copy);
      card.append(primary); canvas.append(card);
    }
    if (focusedId) { const card = [...canvas.children].find(n=>n.dataset.id===focusedId); (card?.querySelector('.card-main') || viewport).focus({preventScroll:true}); }
    updateIndicator();
    cachedArt(r.items,48,epoch).catch(() => {}); persist();
  }
  async function renderMap() {
    if (!opened || !generation) return;
    const seq = ++mapEpoch, pitch = 18, start = Math.max(0,Math.floor(rail.scrollTop/pitch)-4)*6;
    const amount = Math.min(600,(Math.ceil(rail.clientHeight/pitch)+8)*6);
    const pages = await Promise.all(Array.from({length:Math.ceil(amount/200)},(_,i)=>send('QUERY_LIKES',{generation,offset:start+i*200,limit:Math.min(200,amount-i*200)})));
    const r = { items: pages.flatMap(p=>p.items) };
    if (seq !== mapEpoch || !opened) return;
    mapCanvas.style.height = `${Math.ceil(total/6)*pitch}px`; mapCanvas.replaceChildren();
    for (const [i,item] of r.items.entries()) {
      const index = start+i, tile = button('',()=>around(item.itemId),'tile'); tile.title = `${item.title} — ${item.artistName}`; tile.setAttribute('aria-label',tile.title); tile.tabIndex = -1;
      tile.style.cssText = `top:${Math.floor(index/6)*pitch}px;left:${index%6*pitch}px`; tile.append(art(item,48)); mapCanvas.append(tile);
    }
    updateIndicator(); cachedArt(r.items,48,routeEpoch).catch(()=>{});
  }
  function updateIndicator() {
    if (!anchor || !total) { indicator.hidden = true; return; }
    const d = dimensions(), first = anchor.trackOrdinal, last = query || filter ? first : Math.min(total-1, first+Math.ceil(viewport.clientHeight/d.height)*d.columns-1);
    const top = Math.floor(first/6)*18, bottom = (Math.floor(last/6)+1)*18;
    indicator.hidden = false; indicator.style.top = `${top}px`; indicator.style.height = `${Math.max(18,bottom-top)}px`;
    indicator.setAttribute('aria-valuemin','1'); indicator.setAttribute('aria-valuemax',String(total)); indicator.setAttribute('aria-valuenow',String(first+1));
    if (!mapManual && !drag && (top < rail.scrollTop || bottom > rail.scrollTop+rail.clientHeight)) rail.scrollTop = Math.max(0,top-36);
  }
  async function around(id, preserve = true) {
    if (preserve && (query || filter)) previousResults = { query, filter, anchor: anchor?.itemId };
    query = ''; filter = ''; search.value = ''; period.value = ''; mapManual = false;
    highlightId = id; anchorPixelOffset = 0;
    await restoreAnchor(id);
    shadow.querySelector('.back-results').hidden = !previousResults;
  }
  async function restoreAnchor(id) {
    const r = await send('QUERY_LIKES',{generation,query,period:filter,trackId:id,limit:1});
    if (r.anchor < 0) { status.textContent = text('missing'); viewport.scrollTop = 0; await render(); return; }
    const d = dimensions(); count = r.matchingCount; canvas.style.height = `${Math.ceil(count/d.columns)*d.height}px`;
    viewport.scrollTop = Math.floor(r.anchor/d.columns)*d.height + Math.min(anchorPixelOffset,d.height-1); await render(); await renderMap();
  }
  async function at(ordinal) {
    const r = await send('QUERY_LIKES',{generation,offset:Math.max(0,Math.min(total-1,ordinal)),limit:1});
    if (r.items[0]) await around(r.items[0].itemId);
  }
  async function openTrack(item) {
    anchor = item; await send('SAVE_LIKES_VIEW',{anchorTrackId:item.itemId,query});
    await send('OPEN_LIKED_TRACK',{generation,trackId:item.itemId});
  }
  function select(item) {
    selected = item; detail.hidden = false; detail.replaceChildren(); detail.append(art(item,48));
    const copy = el('div','detail-copy'); copy.append(el('strong','',item.title),el('span','',item.artistName)); detail.append(copy);
    const open = button(text('open')+' ↗',()=>openTrack(item),'accent'); open.title = text('openHint'); detail.append(open);
    const locateButton = button('⌖',()=>locate(item),'small locate-action'); locateButton.title = text('locate'); locateButton.setAttribute('aria-label',text('locate')); detail.append(locateButton);
    render().catch(showError);
  }
  async function locate(item) {
    const r = await send('LOCATE_LIKED_TRACK',{generation,trackId:item.itemId});
    status.textContent = text('locating'); const cancel = button(text('cancel'),()=>SCLikesLocator.cancel(),'small'); status.append(cancel);
    const found = await SCLikesLocator.locate(r.permalink, n => { status.textContent = `${text('locating')} ${n}`; });
    status.textContent = text(found ? 'located' : 'locateStopped');
  }
  function gate() {
    viewport.hidden = rail.parentElement.hidden = toolbar.hidden = true;
    const empty = el('div','gate'); empty.append(el('span','eyebrow','LIFETIME PRO'),el('h2','',text('pro')),el('p','',text('proInfo')),button(text('getPro')+' ↗',()=>document.dispatchEvent(new CustomEvent('scdl:open-player-tools-pro')),'accent'));
    empty.append(button(text('removeLibrary'),async()=>{ if(confirm(text('confirmDelete'))) { await send('DELETE_LIKES_LIBRARY'); images.clear(); status.textContent = text('empty'); } },'danger'));
    empty.append(button(text('close'),close,'small'));
    settings.replaceChildren(empty); settings.hidden = false;
  }
  async function poll() {
    if (!opened || statusBusy || drag) return; statusBusy = true;
    try {
      const r = await send('GET_LIKES_LIBRARY_STATUS'); lastStatus = r; ownerId = r.ownerId;
      const lib = r.library, job = r.job;
      status.textContent = job?.error ? text(job.error) : `${text(job?.phase === 'indexing' ? 'indexing' : job?.phase === 'paused' ? 'paused' : lib?.complete ? 'complete' : 'welcome')}${lib ? ' · '+(job?.count || lib.count).toLocaleString()+' '+text('tracks') : ''}`;
      updateSyncAction(job);
      viewport.hidden = toolbar.hidden = false; rail.parentElement.hidden = !lib;
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
        await renderMap();
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
    settings.append(button(text('removeLibrary'),async()=>{ if (!confirm(text('confirmDelete'))) return; await send('DELETE_LIKES_LIBRARY'); routeEpoch++; imageEpoch++; requestEpoch++; mapEpoch++; statusBusy = false; generation = null; total = count = 0; selected = anchor = null; detail.hidden = true; mapCanvas.replaceChildren(); images.clear(); settings.hidden = true; restored = false; await poll(); },'danger'));
    settings.append(el('h3','',text('bookmarks')));
    for (const b of r.bookmarks || []) settings.append(button(b.name,async()=>{ await around(b.anchorTrackId); settings.hidden = true; }));
    settings.append(button(text('close'),()=>{ settings.hidden = true; }));
  }
  function close() { opened = false; panel.hidden = true; launch.hidden = false; requestEpoch++; mapEpoch++; SCLikesLocator.cancel(); endDrag(); persist(); focusBefore?.focus?.(); }
  async function open() { opened = true; focusBefore = document.activeElement; panel.hidden = false; launch.hidden = true; search.focus(); await poll(); }
  function endDrag() { if (drag) { try { indicator.releasePointerCapture(drag.pointerId); } catch {} drag = null; } cancelAnimationFrame(raf); persist(); }
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
    syncAction = button('',async()=>{
      syncAction.classList.add('is-loading'); syncAction.disabled = true;
      try { const phase = lastStatus?.job?.phase; await send(phase === 'indexing' ? 'CANCEL_LIKES_INDEX' : phase === 'paused' ? 'START_LIKES_INDEX' : 'REFRESH_LIKES_LIBRARY'); await pollAfter(); }
      finally { syncAction.classList.remove('is-loading'); syncAction.disabled = false; }
    },'sync action-button');
    syncAction.append(el('span','action-icon','↻'),el('span','action-spinner')); toolbarLine.append(syncAction);
    const storage = button('',storagePanel,'small action-button icon-only'); storage.append(el('span','action-icon','▣')); storage.title = text('settings'); storage.setAttribute('aria-label',text('settings')); toolbarLine.append(storage);
    const bookmark = button('',async()=>{ if (!anchor) return; const name = prompt(text('bookmarkName'),anchor.title); if (name) await send('SAVE_LIKES_BOOKMARK',{trackId:anchor.itemId,name}); },'small action-button icon-only'); bookmark.append(el('span','action-icon','☆')); bookmark.title = text('bookmark'); bookmark.setAttribute('aria-label',text('bookmark')); toolbarLine.append(bookmark);
    toolbar.append(toolbarLine); status = el('span','status'); status.setAttribute('role','status'); toolbar.append(status);
    const back = button('← '+text('back'),async()=>{ if (!previousResults) return; const saved = previousResults; query = saved.query; filter = saved.filter; search.value = query; period.value = filter; previousResults = null; back.hidden = true; if(saved.anchor) await restoreAnchor(saved.anchor); else {viewport.scrollTop = 0; await render();} },'back-results'); back.hidden = true; main.append(back);
    settings = el('div','settings'); settings.hidden = true; main.append(settings);
    viewport = el('div','viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label',text('likes')); canvas = el('div','canvas'); viewport.append(canvas); main.append(viewport);
    detail = el('div','detail'); detail.hidden = true; main.append(detail,toolbar);
    const aside = el('aside'); aside.append(el('span','map-label','LIKES MAP')); rail = el('div','rail'); rail.tabIndex = 0; rail.setAttribute('aria-label',text('map')); mapCanvas = el('div','map-canvas'); indicator = el('div','indicator'); indicator.setAttribute('role','slider'); indicator.setAttribute('aria-label',text('position')); rail.append(mapCanvas,indicator); aside.append(rail); panel.append(aside);
    document.body.append(host); layout();
    search.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ query = search.value; viewport.scrollTop = 0; render().catch(showError); },160); });
    period.addEventListener('change',()=>{ filter = period.value; viewport.scrollTop = 0; render().catch(showError); });
    viewport.addEventListener('scroll',()=>{ clearTimeout(renderTimer); renderTimer = setTimeout(()=>render().catch(showError),45); });
    rail.addEventListener('wheel',()=>{ mapManual = true; },{passive:true}); rail.addEventListener('scroll',()=>renderMap().catch(showError));
    rail.addEventListener('keydown',event=>{ const shifts = { ArrowDown:6,ArrowUp:-6,PageDown:Math.floor(rail.clientHeight/18)*6,PageUp:-Math.floor(rail.clientHeight/18)*6,Home:-total,End:total }; if (event.key in shifts) { event.preventDefault(); at((anchor?.trackOrdinal || 0)+shifts[event.key]).catch(showError); } });
    indicator.addEventListener('pointerdown',event=>{ if (!total) return; event.preventDefault(); drag = {pointerId:event.pointerId,y:event.clientY,grab:event.clientY-rail.getBoundingClientRect().top+rail.scrollTop-parseFloat(indicator.style.top),busy:false,last:-1}; indicator.setPointerCapture(event.pointerId); mapManual = true; dragFrame(); });
    indicator.addEventListener('pointermove',e=>{ if(drag) drag.y = e.clientY; }); for (const name of ['pointerup','pointercancel','lostpointercapture']) indicator.addEventListener(name,endDrag);
    shadow.addEventListener('keydown',e=>{ if(e.key === 'Escape') { if(drag) endDrag(); else if (!settings.hidden) settings.hidden = true; else close(); } });
    resizeObserver = new ResizeObserver(()=>{ layout(); if(opened && generation && anchor) restoreAnchor(anchor.itemId).catch(showError); }); resizeObserver.observe(viewport);
  }
  function dragFrame() {
    if (!drag) return;
    const bounds = rail.getBoundingClientRect(), y = drag.y-bounds.top;
    if(y < 24) rail.scrollTop -= 5; else if(y > bounds.height-24) rail.scrollTop += 5;
    const ordinal = Math.max(0,Math.min(total-1,Math.floor((y+rail.scrollTop-drag.grab)/18)*6));
    if (!drag.busy && ordinal !== drag.last) { const current = drag; current.busy = true; current.last = ordinal; at(ordinal).catch(showError).finally(()=>{ current.busy = false; }); }
    raf = requestAnimationFrame(dragFrame);
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
    routeEpoch++; imageEpoch++; opened = false; endDrag(); resizeObserver?.disconnect(); clearTimeout(renderTimer); clearTimeout(searchTimer); clearTimeout(saveTimer); SCLikesLocator.cancel(); host?.remove(); host = null; generation = null; ownerId = null; anchor = selected = null; restored = false; previousResults = null; query = filter = ''; statusBusy = false; images.clear();
  }
  function route() {
    const eligible = location.origin === 'https://soundcloud.com' && location.pathname.replace(/\/$/,'') === '/you/likes';
    if (!eligible) { if(host) dispose(); return; }
    if (!host && document.body) mount();
    if (host && location.hash === '#scdl-explore') { history.replaceState(history.state,'',location.pathname+location.search); open().catch(showError); }
    if (opened && Date.now()-lastPoll > 1800) { lastPoll = Date.now(); poll().catch(showError); }
  }
  chrome.runtime.onMessage.addListener(message=>{ if(message.type === 'LIKES_IDENTITY_CHANGED') { dispose(); route(); } if(message.type === 'OPEN_LIKES_EXPLORER') { route(); if(host) open().catch(showError); } });
  document.addEventListener('scdl:open-likes-explorer',()=>{ location.href = 'https://soundcloud.com/you/likes#scdl-explore'; });
  const CSS = `
    :host{all:initial;--top:60px;--bottom:88px;font:13px/1.45 system-ui,-apple-system,sans-serif;color:#ece9e4;position:fixed;inset:0;z-index:2147483600;pointer-events:none;color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important} button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #ffffff15;background:#ffffff06;border-radius:8px;padding:7px 10px;transition:background .15s,border-color .15s}button:hover{background:#ffffff12;border-color:#ffffff38}button:focus-visible,input:focus-visible,select:focus-visible,.rail:focus-visible,.viewport:focus-visible{outline:2px solid #ff996a;outline-offset:2px}button:disabled{opacity:.4}input,select{color:inherit;background:#141416;border:1px solid #ffffff15;border-radius:8px;padding:9px;min-width:0}h2,h3,p{margin:0}h2{font-size:25px;line-height:1.2;letter-spacing:-.7px}h3{font-size:14px}p{color:#a9a5a1}strong{font-weight:550} .launch{pointer-events:auto;position:absolute;right:12px;top:45%;background:#202023ed;color:#d9d4cf;box-shadow:0 4px 20px #0003;padding:11px 12px;border-radius:14px 5px 5px 14px;font-size:12px}
    .shell{pointer-events:auto;position:absolute;top:var(--top);bottom:var(--bottom);right:12px;display:flex;gap:10px;max-width:calc(100vw - 24px);filter:drop-shadow(0 20px 35px #0005)}.main{width:520px;max-width:calc(100vw - 152px);display:flex;flex-direction:column;min-height:0;background:#1b1b1e;border:1px solid #ffffff1f;border-radius:14px;overflow:hidden}.eyebrow{font-size:9px;letter-spacing:2px;color:#c39379;font-weight:600}.close{border:0;background:transparent;font-size:22px;line-height:1;padding:3px 6px;color:#aaa;flex:0 0 auto}.toolbar{padding:9px 10px 7px;border-bottom:1px solid #ffffff0b}.toolbar-line{display:flex;align-items:center;gap:5px}.search-wrap{position:relative;flex:1;min-width:130px}.toolbar input{width:100%;height:28px;padding:7px 29px 7px 9px;font-size:10px}.search-close{position:absolute;top:50%;right:3px;transform:translateY(-50%);width:24px;height:24px;padding:0;font-size:16px}.toolbar select{width:98px;height:28px;flex:0 0 auto;font-size:9px;padding:6px}.status{display:block;min-height:12px;margin-top:4px;color:#96918b;font-size:8px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.small{padding:4px 7px;min-width:28px;min-height:28px}.action-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:4px 7px}.icon-only{width:28px;padding:0}.action-icon{font-size:12px;line-height:1}.sync{width:28px;padding:0;overflow:hidden;font-size:9px;white-space:nowrap}.action-spinner{display:none;width:10px;height:10px;border:2px solid #ffffff35;border-top-color:#f1a078;border-radius:50%;animation:spin .7s linear infinite}.sync.is-loading .action-icon,.sync.is-running .action-icon{display:none}.sync.is-loading .action-spinner,.sync.is-running .action-spinner{display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.viewport{position:relative;flex:1;min-height:80px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#55514d transparent;padding-top:6px}.canvas{position:relative}.card{position:absolute;overflow:hidden;border-radius:7px;padding:3px;background:transparent;border:1px solid transparent}.card:hover{background:#ffffff05;border-color:#ffffff12}.card.selected{background:#ff915710;border-color:#ff915755}.card-main{padding:0;border:0;background:none!important;display:block;width:100%;text-align:left}.cover{position:relative;display:block;aspect-ratio:1;background:linear-gradient(140deg,hsl(var(--hue) 23% 28%),hsl(var(--hue) 18% 13%));border-radius:5px;overflow:hidden}.cover-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;color:#ffffff30}.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.card-copy{display:block;padding:4px 1px 0;min-width:0}.card-copy strong,.artist{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;line-height:1.15}.artist{font-size:9px;color:#98928c;margin-top:2px}.empty{padding:40px 28px;text-align:center;max-width:420px;margin:auto}.empty p{font-size:12px;margin:12px 0 22px;line-height:1.7}.hero-mark{font-size:55px;color:#db9574;margin-bottom:12px}.accent{background:#e99b74!important;color:#221b17!important;border-color:#e99b74!important;font-weight:600;font-size:11px;padding:9px 13px}.detail{display:flex;gap:7px;align-items:center;border-top:1px solid #ffffff12;padding:8px 10px;background:#252326}.detail>.cover{width:34px;height:34px;flex-shrink:0}.detail-copy{flex:1;min-width:0;font-size:11px}.detail-copy>*{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail-copy span{font-size:10px;color:#aaa}.detail .accent{font-size:10px;max-width:110px;padding:6px}.detail .small{padding:4px;min-width:24px}.back-results{margin:6px 10px 0;text-align:left;font-size:10px;color:#e8a581;border:0}.settings{padding:18px;overflow:auto;max-height:55%;background:#242326;border-bottom:1px solid #ffffff15}.settings p{font-size:12px;margin:8px 0 12px}.settings button{font-size:11px;margin:4px}.settings h3:not(:first-child){margin-top:16px}.danger{color:#efa699}.gate{padding:20px 10px}.gate h2{margin:12px 0}.gate p{line-height:1.7}.shell:has(.gate) .settings{max-height:none}
    aside{width:124px;background:#1b1b1eeF;border:1px solid #ffffff1f;border-radius:14px;padding:10px 7px;display:flex;flex-direction:column;overflow:hidden}.map-label{font-size:8px;letter-spacing:1.7px;color:#a3988f;text-align:center;padding:2px 0 10px}.rail{flex:1;position:relative;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;min-height:0;width:108px}.map-canvas{position:relative;width:108px}.tile{position:absolute;width:16px;height:16px;padding:0;border:0;border-radius:2px}.tile .cover{border-radius:2px}.tile .cover-mark{font-size:10px}.indicator{position:absolute;left:0;width:108px;border:2px solid #f6ccaf;box-shadow:0 0 0 1px #0008;background:#e8ceae25;border-radius:3px;touch-action:none;cursor:grab;min-height:18px;pointer-events:auto}.indicator:active{cursor:grabbing}.indicator::after{content:'';display:block;width:22px;height:3px;background:#ffe2cf;border-radius:3px;position:absolute;left:41px;top:50%}
    .toolbar{border-top:1px solid #ffffff12;border-bottom:0}.detail{border-top:1px solid #ffffff12}.detail .accent{display:inline-flex;align-items:center;justify-content:center;max-width:none;white-space:nowrap;line-height:1}.locate-action{flex:0 0 28px;padding:4px}
    @media(max-width:759px){aside{display:none}.main{width:520px;max-width:calc(100vw - 24px)}.detail{flex-wrap:wrap}.detail-copy{min-width:80px}.toolbar select{width:92px}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}.action-spinner{animation:none!important}}
  `;
  setInterval(route,500); window.addEventListener('popstate',route); window.addEventListener('resize',layout); route();
})();
