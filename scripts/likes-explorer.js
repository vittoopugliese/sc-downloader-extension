(function () {
  'use strict';
  if (window.top !== window) return;
  const text = globalThis.SCLikesText;
  const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; };
  let host, shadow, panel, launch, teleportOverlay, viewport, canvas, search, period, collectionSelect, status, toolbar, detail, settings, syncAction;
  let ownerId, collectionId, sourceUserId, generation, revision, total = 0, count = 0, query = '', filter = '', anchor, selected, previousResults, opened = false, routeEpoch = 0, requestEpoch = 0, statusBusy = false, resizeObserver, focusBefore;
  let lastStatus, lastPoll = 0, renderTimer, searchTimer, saveTimer, restored = false;
  const images = new Map();
  const imageConsumers = new Map();
  const artworkInflight = new Map();
  const cardNodes = new Map();
  let imageEpoch = 0;
  let highlightId = null, anchorPixelOffset = 0;
  let selectedContext, player, detailSummary, playerInline, playerStatus, playerWidget;
  let nowTrack = null, playContext = null, playPhase = 'idle', playEpoch = 0;
  let nativeTrack = null, nativeContext = null, nativePhase = 'idle', nativeEpoch = 0, nativeRequest, nativeStatus;
  // Mini recorder: captures the widget iframe and hands the take to the Stem Extractor.
  let recordSlot = null, recordUI = null, recordSource = null, recordSend = null, recordTrack = null, recordSending = false;
  const RECORD_SECONDS = 120, UPLOAD_CHUNK = 3 * 1024 * 1024;
  const pt = (source, ...values) => globalThis.SCPlayerToolsText?.t(source, ...values) ?? source.replace(/\$(\d+)/g, (match, index) => values[index - 1] ?? match);
  function button(label, action, cls = '', icon) { const b = el('button', cls, label); if (icon) b.prepend(globalThis.SCIcons.create(icon)); b.type = 'button'; b.addEventListener('click', () => Promise.resolve(action()).catch(showError)); return b; }
  async function send(type, payload = {}) {
    const epoch = routeEpoch;
    const r = await chrome.runtime.sendMessage({ type, ownerId, collectionId, sourceUserId, ...payload });
    if (epoch !== routeEpoch) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (!r?.success) throw Object.assign(new Error(r?.code || 'network-error'), { code: r?.code || 'network-error' });
    return r;
  }
  function showError(e) {
    if (e.code === 'cancelled') return;
    if (['trial-expired', 'trial-exhausted', 'trial-invalid', 'license_revoked', 'license-check-required'].includes(e.code)) e = { ...e, code: 'pro-required' };
    if (e.code === 'stale-generation') { poll().catch(()=>{}); }
    if (['auth-required','owner-mismatch','pro-required'].includes(e.code)) { stopPlayback(); canvas?.replaceChildren(); if (detail) detail.hidden = true; selected = selectedContext = null; images.clear(); total = count = 0; }
    if (status) status.textContent = text(e.code);
    if (e.code === 'pro-required') gate();
  }
  function updateSyncAction(job) {
    if (!syncAction) return;
    const action = job?.phase === 'indexing' ? 'pause' : job?.phase === 'paused' ? 'resume' : 'refresh';
    const icon = syncAction.querySelector('.action-icon');
    if (action === 'refresh') {
      icon.replaceChildren();
      const refreshIcon = globalThis.SCIcons.create('refresh','toolbar-icon');
      icon.append(refreshIcon);
    } else icon.replaceChildren(globalThis.SCIcons.create(action === 'pause' ? 'pause' : 'play'));
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
    const view = { anchorTrackId: anchor.itemId, query, period: filter, offset: anchorPixelOffset };
    saveTimer = setTimeout(() => send('SAVE_LIKES_VIEW', view).catch(() => {}), 350);
  }
  function art(item, size) {
    const box = el('span', 'cover'); box.style.setProperty('--hue', String((Number(item.itemId) * 137.508) % 360));
    const mark = el('span', 'cover-mark'); mark.append(globalThis.SCIcons.create('music')); box.append(mark);
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
    else canvas.querySelector(':scope > .empty')?.remove();
    const first = visibleOrdinal();
    anchorPixelOffset = viewport.scrollTop % d.height;
    anchor = r.items[Math.max(0,first-start)] || anchor;
    const wanted = new Set(r.items.map(item => item.itemId));
    for (const [id,node] of cardNodes) if (!wanted.has(id)) { node.remove(); cardNodes.delete(id); }
    for (const [i,item] of r.items.entries()) {
      const index = start+i; let card = cardNodes.get(item.itemId);
      if (!card) {
        card = el('article','card'); card.dataset.id = item.itemId;
        const primary = button('', () => select(card.item, card.context), 'card-main'); primary.setAttribute('aria-label',`${item.title} — ${item.artistName}`);
        primary.append(art(item,48)); const copy = el('span','card-copy'); copy.append(el('strong','',item.title),el('span','artist',item.artistName)); primary.append(copy); card.append(primary);
        cardNodes.set(item.itemId,card);
      }
      card.item = item;
      card.context = { ownerId, collectionId, sourceUserId, generation };
      card.classList.toggle('selected',selected?.itemId === item.itemId || highlightId === item.itemId);
      updateCardPlayback(card);
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
  function select(item, context) {
    selectedContext = context;
    selected = item; detail.hidden = false; detailSummary.replaceChildren(art(item,48));
    const copy = el('div','detail-copy'); copy.append(el('strong','',item.title),el('span','',item.artistName)); detailSummary.append(copy);
    for (const [id, card] of cardNodes) card.classList.toggle('selected',id === item.itemId);
    updateDetailPlayback();
    updateNativePlayback();
    cachedArt([item],48,routeEpoch).catch(()=>{});
  }
  function updateCardPlayback(card) {
    const playing = nowTrack?.itemId === card.item.itemId && playPhase === 'playing';
    card.classList.toggle('is-playing',playing);
  }
  function updateDetailPlayback() {
    const control = detail?.querySelector('.detail-play');
    const current = !!nowTrack && selected?.itemId === nowTrack.itemId && selectedContext?.collectionId === playContext?.collectionId;
    if (control) {
      const playing = current && playPhase === 'playing';
      control.replaceChildren(globalThis.SCIcons.create(playing ? 'pause' : 'play'), document.createTextNode(' ' + text(playing ? 'pause' : 'play')));
      control.disabled = current && playPhase === 'loading';
    }
    if (playerInline) {
      playerInline.hidden = !current;
      detailSummary.hidden = current;
      detail.classList.toggle('has-player',current);
    }
    updateRecorder();
  }
  function recordTake() { return recordUI?.recorder.snapshot() || { state: 'idle', frames: 0 }; }
  // The pill follows the visible player, but a running or finished take stays in view.
  function updateRecorder() {
    if (!recordSlot) return;
    const take = recordTake();
    const current = !!nowTrack && !!player && selected?.itemId === nowTrack.itemId;
    recordSlot.hidden = !(current || take.frames > 0 || ['recording','stopping','preparing'].includes(take.state));
    recordUI?.setVisible(opened && !recordSlot.hidden);
    recordSource?.setMonitor(opened && !recordSlot.hidden);
    if (recordSend) recordSend.disabled = recordSending || !take.frames || !['ready','playing'].includes(take.state);
  }
  function mountRecorder() {
    recordSlot = el('div','record-slot'); recordSlot.hidden = true;
    if (!globalThis.SCRecordUI || !globalThis.SCRecord || !globalThis.SCWidgetRecordSource) return recordSlot;
    recordSource = SCWidgetRecordSource.create({ getFrame: () => player?.frame?.() || null,
      moduleUrl: chrome.runtime.getURL('scripts/record-processor.js') });
    const recorder = SCRecord.create({ source: recordSource, maxSeconds: RECORD_SECONDS, onChange: () => recordUI?.render() });
    recordSend = el('button','record-send'); recordSend.type = 'button'; recordSend.disabled = true;
    recordSend.innerHTML = '<sc-icon name="place" aria-hidden="true"></sc-icon>';
    recordSend.append(document.createTextNode(pt('Send to Stem Extractor')));
    recordSend.addEventListener('click', () => sendRecording().catch(error => {
      console.error('[Likes recorder]', error);
      if (status) status.textContent = error.localized ? error.message : pt('Could not send the recording to the Stem Extractor.');
    }));
    recordUI = SCRecordUI.mount({ container: recordSlot, recorder, variant: 'pill', extraActions: [recordSend],
      emptyText: pt('Record what is playing · up to 2 min'),
      onChange: state => {
        // Never play the take on top of the widget.
        if (state.state === 'playing' && playPhase === 'playing') player?.pause();
        updateRecorder();
      } });
    return recordSlot;
  }
  function base64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  async function sendRecording() {
    const recorder = recordUI?.recorder;
    if (!recorder || recordSending) return;
    recorder.stopPreview();
    const bytes = new Uint8Array(await recorder.exportWav().arrayBuffer());
    const track = recordTrack || {};
    recordSending = true; updateRecorder();
    if (status) status.textContent = pt('Opening the Stem Extractor…');
    try {
      await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'stem-recording-upload' });
        let settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; try { port.disconnect(); } catch {} if (error) reject(error); else resolve(value); };
        port.onMessage.addListener(message => {
          if (message?.success) finish(null, message);
          else finish(Object.assign(new Error(message?.error || pt('Could not send the recording to the Stem Extractor.')), { localized: !!message?.error }));
        });
        port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || 'Upload interrupted')));
        port.postMessage({ type: 'begin', size: bytes.length, title: pt('$1 (recording)', track.title || 'SoundCloud'),
          artist: track.artistName || '', artworkUrl: /^https:\/\//.test(track.artworkUrl || '') ? track.artworkUrl : '', trackUrl: track.permalink || '' });
        for (let i = 0; i < bytes.length; i += UPLOAD_CHUNK) port.postMessage({ type: 'chunk', data: base64(bytes.subarray(i, i + UPLOAD_CHUNK)) });
        port.postMessage({ type: 'end' });
      });
      if (status) status.textContent = '';
    } finally { recordSending = false; updateRecorder(); }
  }
  function playerState(phase) {
    playPhase = phase;
    if (!nowTrack || !playerInline) return;
    playerInline.dataset.state = phase;
    const playing = phase === 'playing';
    playerStatus.hidden = !['loading','error','needs-play'].includes(phase);
    playerStatus.textContent = text(({loading:'loadingAudio',error:'playbackError','needs-play':'needsPlay'})[phase] || 'listen');
    for (const card of cardNodes.values()) updateCardPlayback(card);
    updateDetailPlayback();
    if (playing) {
      if (recordTake().state === 'playing') recordUI.recorder.stopPreview();
      cancelNativePlayback();
      const native = document.querySelector('.playControls .playControl.playing');
      native?.click();
    }
  }
  function stopPlayback() {
    cancelNativePlayback(true);
    playEpoch++; player?.destroy(); player = null; nowTrack = playContext = null;
    recordSource?.interrupt();
    playPhase = 'idle';
    for (const card of cardNodes.values()) updateCardPlayback(card);
    updateDetailPlayback();
  }
  async function playTrack(item, context) {
    if (!context) return;
    cancelNativePlayback();
    if (nowTrack?.itemId === item.itemId && playContext?.collectionId === context.collectionId && player && !['error','loading'].includes(playPhase)) {
      if (playPhase === 'playing') player.pause(); else player.play();
      return;
    }
    const seq = ++playEpoch;
    player?.destroy(); player = null; recordSource?.interrupt();
    nowTrack = item; playContext = { ...context };
    playerState('loading');
    try {
      const result = await send('PLAY_LIKED_TRACK',{...context,trackId:item.itemId});
      if (seq !== playEpoch) return;
      player = SCLikesPlayer.create({container:playerWidget,title:text('listen'),onState:playerState,onFinish:()=>{}});
      player.load(result.item);
      recordTrack = { ...result.item, artworkUrl: item.artworkUrl };
      updateRecorder();
    } catch (error) {
      if (seq !== playEpoch) return;
      playerState('error'); showError(error);
    }
  }
  function updateNativePlayback() {
    const control = detail?.querySelector('.native-play');
    const current = !!nativeTrack && selected?.itemId === nativeTrack.itemId && selectedContext?.collectionId === nativeContext?.collectionId;
    if (control) {
      control.disabled = current && nativePhase === 'loading';
      control.setAttribute('aria-busy', String(control.disabled));
      control.dataset.state = current ? nativePhase : 'idle';
    }
    if (nativeStatus) {
      nativeStatus.hidden = !current || nativePhase === 'idle';
      nativeStatus.textContent = text(({loading:'nativeLoading',playing:'nativePlaying','needs-play':'nativeNeedsPlay',unavailable:'nativeUnavailable'})[nativePhase] || 'nativePlay');
    }
  }
  function cancelNativePlayback(clear = false) {
    nativeEpoch++; nativeRequest?.abort(); nativeRequest = null; nativePhase = 'idle';
    if (clear) nativeTrack = nativeContext = null;
    updateNativePlayback();
  }
  async function playNativeTrack(item, context) {
    if (!context) return;
    cancelNativePlayback(); SCLikesLocator.cancel();
    const seq = nativeEpoch, request = new AbortController(); nativeRequest = request;
    nativeTrack = item; nativeContext = { ...context }; nativePhase = 'loading';
    // Cancel pending preview authorization as well as pausing a mounted widget.
    // The iframe stays mounted so its position and controls remain available.
    playEpoch++; player?.pause();
    if (!player && playPhase === 'loading') playerState('paused');
    updateNativePlayback(); persist();
    try {
      const result = await send('PLAY_LIKED_TRACK', { ...context, trackId: item.itemId });
      if (seq !== nativeEpoch) return;
      nativeTrack = result.item;
      const playback = await SCSoundCloudPlayback.play(result.item, { signal: request.signal });
      if (seq !== nativeEpoch) return;
      nativePhase = playback.phase; updateNativePlayback();
    } catch (error) {
      if (seq !== nativeEpoch) return;
      nativePhase = error.code === 'cancelled' ? 'idle' : 'unavailable'; updateNativePlayback();
      showError(error);
    } finally { if (seq === nativeEpoch) nativeRequest = null; }
  }
  function mountDetail() {
    const media = el('div','detail-media');
    detailSummary = el('div','detail-summary');
    playerInline = el('div','player-inline'); playerInline.hidden = true; playerInline.setAttribute('aria-label',text('listen'));
    playerStatus = el('div','player-status'); playerStatus.setAttribute('role','status');
    playerWidget = el('div','player-widget');
    playerInline.append(playerWidget,playerStatus); media.append(detailSummary,playerInline);
    nativeStatus = el('div','native-status'); nativeStatus.hidden = true; nativeStatus.setAttribute('role','status'); media.append(nativeStatus);
    const actions = el('div','detail-actions');
    actions.append(button(text('play'),()=>playTrack(selected,selectedContext),'accent detail-play','play'));
    const locateButton = button('',()=>locate(selected),'small locate-action');
    const locateIcon = globalThis.SCIcons.create('locate','locate-icon');
    locateButton.append(locateIcon); locateButton.title = text('locate'); locateButton.setAttribute('aria-label',text('locate')); actions.append(locateButton);
    const nativePlay = button('',()=>playNativeTrack(selected,selectedContext),'small native-play');
    nativePlay.title = text('nativePlay'); nativePlay.setAttribute('aria-label',text('nativePlay'));
    nativePlay.innerHTML = '<sc-icon name="play-pattern" style="--icon-size:18px" aria-hidden="true"></sc-icon>';
    actions.append(nativePlay);
    detail.append(media,status,actions,mountRecorder());
  }
  async function locate(item) {
    if (nativePhase === 'loading') cancelNativePlayback();
    const r = await send('LOCATE_LIKED_TRACK',{generation,trackId:item.itemId});
    const overlay = teleportOverlay;
    overlay.hidden = false;
    status.textContent = text('locating'); const cancel = button(text('cancel'),()=>SCLikesLocator.cancel(),'small'); status.append(cancel);
    try {
      const found = await SCLikesLocator.locate(r.permalink, n => { status.textContent = `${text('locating')} ${n}`; });
      status.textContent = text(found ? 'located' : 'locateStopped');
    } finally {
      overlay.hidden = true;
    }
  }
  function gate() {
    stopPlayback();
    requestEpoch++; imageEpoch++; generation = null; restored = false;
    detail.hidden = true; selected = null; images.clear(); SCLikesLocator.cancel();
    viewport.hidden = toolbar.hidden = true;
    const empty = el('div','gate'); empty.append(el('span','eyebrow','LIFETIME PRO'),el('h2','',text('pro')),el('p','',text('proInfo')),button(text('getPro'),()=>document.dispatchEvent(new CustomEvent('scdl:open-player-tools-pro')),'accent','detach'));
    empty.append(button(text('removeLibrary'),async()=>{ if(confirm(text('confirmDelete'))) { await send('DELETE_LIKES_LIBRARY'); images.clear(); status.textContent = text('empty'); } },'danger'));
    empty.append(button(text('close'),close,'small'));
    settings.replaceChildren(empty); settings.hidden = false;
  }
  async function poll() {
    if ((!opened && !nowTrack && !nativeTrack) || statusBusy) return; statusBusy = true;
    try {
      const r = await send('GET_LIKES_LIBRARY_STATUS'); lastStatus = r; ownerId = r.ownerId; collectionId = r.collectionId; sourceUserId = r.sourceUserId;
      if (settings.querySelector('.gate')) { settings.replaceChildren(); settings.hidden = true; viewport.hidden = toolbar.hidden = false; }
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
        canvas.style.height = 'auto'; canvas.replaceChildren(); const intro = el('div','empty'); intro.append(globalThis.SCIcons.create('likes','hero-mark'),el('h2','',text('welcome')),el('p','',text('intro')),button(text('start'),async()=>{ await send('START_LIKES_INDEX'); await pollAfter(); },'accent','next')); canvas.append(intro); return;
      }
      const changed = generation !== lib.generation || revision !== lib.revision;
      generation = lib.generation; revision = lib.revision; total = lib.count;
      if (nativePhase === 'loading' && nativeContext?.generation !== generation) cancelNativePlayback();
      if (changed || !restored) {
        const r2 = await send('QUERY_LIKES',{generation,limit:1});
        const value = period.value; period.replaceChildren(new Option(text('all'),''));
        for (const [key,p] of Object.entries(r2.periods)) period.add(new Option(`${key === 'unknown' ? text('unknown') : new Date(key+'-02').toLocaleDateString(undefined,{year:'numeric',month:'short'})} · ${p.count}${lib.complete ? '' : '+'}`,key)); period.value = value;
        if (!restored) { restored = true; query = r.view?.query || ''; filter = r.view?.period || ''; anchorPixelOffset = Math.max(0,Number(r.view?.offset)||0); search.value = query; period.value = filter; if (r.view?.anchorTrackId) await restoreAnchor(r.view.anchorTrackId); else await render(); }
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
    settings.append(button(text('removeLibrary'),async()=>{ if (!confirm(text('confirmDelete'))) return; await send('DELETE_LIKES_LIBRARY'); stopPlayback(); routeEpoch++; imageEpoch++; requestEpoch++; statusBusy = false; generation = null; total = count = 0; selected = anchor = null; detail.hidden = true; images.clear(); cardNodes.clear(); settings.hidden = true; restored = false; await poll(); },'danger'));
    settings.append(button(text('close'),()=>{ settings.hidden = true; }));
  }
  function close() { if (nativePhase === 'loading') cancelNativePlayback(); opened = false; updateRecorder(); panel.hidden = true; launch.hidden = false; requestEpoch++; SCLikesLocator.cancel(); persist(); focusBefore?.focus?.(); }
  async function open() { opened = true; updateRecorder(); focusBefore = document.activeElement; panel.hidden = false; launch.hidden = true; search.focus(); await poll(); }
  function mount() {
    host = el('div'); host.id = 'scdl-likes-explorer'; shadow = host.attachShadow({mode:'open'});
    const style = el('style'); style.textContent = CSS; shadow.append(style);
    teleportOverlay = el('div','teleport-overlay'); teleportOverlay.hidden = true;
    teleportOverlay.setAttribute('role','button'); teleportOverlay.tabIndex = 0;
    teleportOverlay.setAttribute('aria-label',text('teleportStopHint'));
    const teleportMessage = el('div','teleport-message');
    const teleportIcon = globalThis.SCIcons.create('locate','teleport-icon');
    teleportMessage.append(teleportIcon,el('strong','',text('teleporting')),el('span','',text('teleportStopHint')));
    teleportOverlay.append(teleportMessage);
    teleportOverlay.addEventListener('pointerdown',()=>SCLikesLocator.cancel());
    teleportOverlay.addEventListener('click',()=>SCLikesLocator.cancel());
    shadow.append(teleportOverlay);
    launch = button('Likes',open,'launch','likes'); launch.title = text('title'); shadow.append(launch);
    panel = el('section','shell'); panel.hidden = true; panel.setAttribute('aria-label',text('title')); shadow.append(panel);
    const main = el('div','main'); panel.append(main);
    toolbar = el('div','toolbar'); const toolbarLine = el('div','toolbar-line');
    search = el('input'); search.type = 'search'; search.placeholder = text('search'); search.maxLength = 200; search.setAttribute('aria-label',text('search'));
    const searchWrap = el('div','search-wrap'); searchWrap.append(search); const closeButton = button('',close,'close search-close'); const crossIcon = globalThis.SCIcons.create('close','cross-icon'); closeButton.append(crossIcon); closeButton.setAttribute('aria-label',text('close')); closeButton.title = text('close'); searchWrap.append(closeButton); toolbarLine.append(searchWrap);
    period = el('select'); period.setAttribute('aria-label',text('all')); period.add(new Option(text('all'),'')); toolbarLine.append(period);
    collectionSelect = el('select'); collectionSelect.className = 'collection-select'; collectionSelect.setAttribute('aria-label',text('likes')); toolbarLine.append(collectionSelect);
    syncAction = button('',async()=>{
      syncAction.classList.add('is-loading'); syncAction.disabled = true;
      try { const phase = lastStatus?.job?.phase; await send(phase === 'indexing' ? 'CANCEL_LIKES_INDEX' : phase === 'paused' ? 'START_LIKES_INDEX' : 'REFRESH_LIKES_LIBRARY'); await pollAfter(); }
      finally { syncAction.classList.remove('is-loading'); syncAction.disabled = false; }
    },'sync action-button');
    syncAction.append(el('span','action-icon'),el('span','action-spinner')); toolbarLine.append(syncAction);
    const storage = button('',storagePanel,'small action-button icon-only'); const storageIcon = globalThis.SCIcons.create('storage','toolbar-icon'); storage.append(storageIcon); storage.title = text('settings'); storage.setAttribute('aria-label',text('settings')); toolbarLine.append(storage);
    toolbar.append(toolbarLine); status = el('span','status'); status.setAttribute('role','status');
    const back = button(text('back'),async()=>{ if (!previousResults) return; const saved = previousResults; query = saved.query; filter = saved.filter; search.value = query; period.value = filter; previousResults = null; back.hidden = true; if(saved.anchor) await restoreAnchor(saved.anchor); else {viewport.scrollTop = 0; await render();} },'back-results','back'); back.hidden = true; main.append(back);
    settings = el('div','settings'); settings.hidden = true; main.append(settings);
    viewport = el('div','viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label',text('likes')); canvas = el('div','canvas'); viewport.append(canvas); main.append(viewport);
    detail = el('div','detail'); detail.hidden = true; main.append(detail,toolbar);
    mountDetail(); document.body.append(host); layout();
    search.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ query = search.value; viewport.scrollTop = 0; render().catch(showError); },160); });
    period.addEventListener('change',()=>{ filter = period.value; viewport.scrollTop = 0; render().catch(showError); });
    collectionSelect.addEventListener('change',()=>{ const item=(lastStatus?.collections || []).find(value=>value.collectionId===collectionSelect.value); if (!item) return; if (nativePhase === 'loading') cancelNativePlayback(); clearTimeout(saveTimer); collectionId=item.collectionId; sourceUserId=item.sourceUserId; generation=null; revision=null; anchor=selected=selectedContext=null; detail.hidden=true; restored=false; viewport.scrollTop=0; pollAfter().catch(showError); });
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
    stopPlayback(); recordUI?.dispose(); recordUI = recordSource = recordSend = recordSlot = recordTrack = null; cardNodes.clear(); selectedContext = null;
    routeEpoch++; imageEpoch++; opened = false; resizeObserver?.disconnect(); clearTimeout(renderTimer); clearTimeout(searchTimer); clearTimeout(saveTimer); SCLikesLocator.cancel(); host?.remove(); host = teleportOverlay = null; generation = null; ownerId = collectionId = sourceUserId = null; anchor = selected = null; restored = false; previousResults = null; query = filter = ''; statusBusy = false; images.clear(); imageConsumers.clear(); artworkInflight.clear();
  }
  function route() {
    const eligible = location.origin === 'https://soundcloud.com' && /^\/(?:you|[^/]+)\/likes$/.test(location.pathname.replace(/\/$/,''));
    if (!eligible && !nowTrack && !nativeTrack) { if(host) dispose(); return; }
    if (!host && document.body) mount();
    if (host && location.hash === '#scdl-explore') { history.replaceState(history.state,'',location.pathname+location.search); open().catch(showError); }
    if (playPhase === 'playing' && document.querySelector('.playControls .playControl.playing')) player?.pause();
    if (nativePhase === 'playing' && SCSoundCloudPlayback.currentTrack() !== nativeTrack?.permalink) { nativePhase = 'idle'; updateNativePlayback(); }
    if ((opened || nowTrack || nativeTrack) && Date.now()-lastPoll > 1800) { lastPoll = Date.now(); poll().catch(showError); }
  }
  chrome.runtime.onMessage.addListener(message=>{ if(message.type === 'LIKES_IDENTITY_CHANGED') { dispose(); route(); } if(message.type === 'OPEN_LIKES_EXPLORER') { route(); if(host) open().catch(showError); } });
  document.addEventListener('scdl:open-likes-explorer',()=>{ if (host) open().catch(showError); else location.href = 'https://soundcloud.com/you/likes#scdl-explore'; });
  const CSS = `
    .detail .native-play{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:4px;background:#70d6cb;color:#102d2a;border-color:#70d6cb}.detail .native-play:hover{background:#93e6dd;border-color:#93e6dd}.detail .native-play[aria-busy="true"]{opacity:.65}.native-status{padding-top:5px;font-size:10px;line-height:1.4;color:#93e6dd;overflow-wrap:anywhere}
    .card.is-playing{border-color:#e99b74}
    .detail{flex-wrap:wrap}.record-slot{flex:0 0 100%;min-width:0}.record-slot .record-section{border-color:#ffffff1f}
    .record-slot .record-section button.record-send{display:inline-flex;align-items:center;gap:4px;min-height:25px;padding:3px 8px;border:1px solid #70d6cb;border-radius:5px;background:#70d6cb;color:#102d2a;font:600 10px system-ui,sans-serif}
    .record-slot .record-section button.record-send:hover:not(:disabled){background:#93e6dd;border-color:#93e6dd}.record-slot .record-section button.record-send:disabled{opacity:.4;cursor:default}
    .record-send sc-icon{width:12px;height:12px;}
    .detail-media{flex:1;min-width:0}.detail-summary{display:flex;align-items:center;gap:7px;min-width:0}.detail-summary>.cover{width:34px;height:34px;flex-shrink:0}
    .player-inline{min-width:0;overflow:hidden;border-radius:5px}.player-widget{height:80px;background:#2c2c2c}.player-widget:empty{height:0}
    .player-status{padding:4px 0;color:#bdb6af;font-size:10px;line-height:1.4}.player-inline[data-state="error"] .player-status,.player-inline[data-state="needs-play"] .player-status{color:#ffd0a9}.detail.has-player>.status{display:none}
    :host{all:initial;--top:60px;--bottom:88px;font:13px/1.45 system-ui,-apple-system,sans-serif;color:#ece9e4;position:fixed;inset:0;z-index:2147483647;isolation:isolate;contain:paint;pointer-events:none;color-scheme:dark}
    .teleport-overlay{pointer-events:auto;position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.2);cursor:pointer;text-align:center}.teleport-message{display:flex;flex-direction:column;align-items:center;gap:9px;max-width:360px;padding:24px 28px;border:1px solid #ffffff30;border-radius:16px;background:#17171bd9;box-shadow:0 12px 40px #0008;color:#fff}.teleport-icon{width:58px;height:58px;filter:invert(1)}.teleport-message strong{font-size:18px;font-weight:700}.teleport-message span{font-size:12px;line-height:1.5;color:#e4e0dc}.teleport-overlay:focus-visible{outline:2px solid #ff996a;outline-offset:-4px}
    *{box-sizing:border-box} [hidden]{display:none!important} button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #ffffff15;background:#ffffff06;border-radius:8px;padding:7px 10px;transition:background .15s,border-color .15s}button:hover{background:#ffffff12;border-color:#ffffff38}button:focus-visible,input:focus-visible,select:focus-visible,.viewport:focus-visible{outline:2px solid #ff996a;outline-offset:2px}button:disabled{opacity:.4}input,select{color:inherit;background:#141416;border:1px solid #ffffff15;border-radius:8px;padding:9px;min-width:0}h2,h3,p{margin:0}h2{font-size:25px;line-height:1.2;letter-spacing:-.7px}h3{font-size:14px}p{color:#a9a5a1}strong{font-weight:550} .launch{pointer-events:auto;position:absolute;right:12px;top:45%;background:#202023ed;color:#d9d4cf;box-shadow:0 4px 20px #0003;padding:11px 12px;border-radius:14px 5px 5px 14px;font-size:12px}
    .shell{pointer-events:auto;position:absolute;top:var(--top);bottom:var(--bottom);right:12px;z-index:2;display:flex;max-width:calc(100vw - 24px);filter:drop-shadow(0 20px 35px #0005);isolation:isolate}.main{pointer-events:auto;position:relative;z-index:2;width:720px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;min-height:0;background:#1b1b1e;border:1px solid #ffffff1f;border-radius:14px;overflow:hidden;isolation:isolate}.eyebrow{font-size:9px;letter-spacing:2px;color:#c39379;font-weight:600}.close{border:0;background:transparent;font-size:22px;line-height:1;padding:3px 6px;color:#aaa;flex:0 0 auto}.cross-icon{display:block;width:15px;height:15px}.toolbar{pointer-events:auto;position:relative;z-index:3;padding:9px 10px 7px;border-bottom:1px solid #ffffff0b;background:#1b1b1e}.toolbar-line{pointer-events:auto;position:relative;z-index:4;display:flex;align-items:center;gap:5px}.search-wrap{position:relative;z-index:5;flex:1;min-width:130px}.toolbar input,.toolbar button,.toolbar select{pointer-events:auto;position:relative;z-index:6}.toolbar input{width:100%;height:28px;padding:7px 29px 7px 9px;font-size:10px}.search-close{position:absolute;top:50%;right:3px;transform:translateY(-50%);width:24px;height:24px;padding:0;font-size:16px}.toolbar select{width:98px;height:28px;flex:0 0 auto;font-size:9px;padding:6px}.status{display:block;min-height:12px;margin-top:4px;color:#96918b;font-size:8px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.small{padding:4px 7px;min-width:28px;min-height:28px}.action-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:4px 7px}.icon-only{width:28px;padding:0}.action-icon{font-size:12px;line-height:1}.sync{width:28px;padding:0;overflow:hidden;font-size:9px;white-space:nowrap}.action-spinner{display:none;width:10px;height:10px;border:2px solid #ffffff35;border-top-color:#f1a078;border-radius:50%;animation:spin .7s linear infinite}.sync.is-loading .action-icon,.sync.is-running .action-icon{display:none}.sync.is-loading .action-spinner,.sync.is-running .action-spinner{display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.viewport{pointer-events:auto;position:relative;z-index:2;flex:1;min-height:80px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#55514d transparent;padding-top:6px;background:#1b1b1e}.canvas{position:relative}.card{position:absolute;overflow:hidden;border-radius:7px;padding:3px;background:transparent;border:1px solid transparent}.card:hover{background:#ffffff05;border-color:#ffffff12}.card.selected{background:#ff915710;border-color:#ffffff55}.card-main{padding:0;border:0;background:none!important;display:block;width:100%;text-align:left}.cover{position:relative;display:block;aspect-ratio:1;background:linear-gradient(140deg,hsl(var(--hue) 23% 28%),hsl(var(--hue) 18% 13%));border-radius:5px;overflow:hidden}.cover-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;color:#ffffff30}.cover img,.cover sc-icon{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.card-copy{display:block;padding:4px 1px 0;min-width:0}.card-copy strong,.artist{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;line-height:1.15}.artist{font-size:9px;color:#98928c;margin-top:2px}.empty{padding:40px 28px;text-align:center;max-width:420px;margin:auto}.empty p{font-size:12px;margin:12px 0 22px;line-height:1.7}.hero-mark{font-size:55px;color:#db9574;margin-bottom:12px}.accent{background:#e99b74!important;color:#221b17!important;border-color:#e99b74!important;font-weight:600;font-size:11px;padding:9px 13px}.detail{pointer-events:auto;position:relative;z-index:3;display:flex;gap:7px;align-items:center;border-top:1px solid #ffffff12;padding:8px 10px;background:#252326}.detail-actions{display:flex;align-items:center;gap:7px;flex:0 0 auto;pointer-events:auto}.detail>.cover{width:34px;height:34px;flex-shrink:0}.detail-copy{flex:1;min-width:0;font-size:11px}.detail-copy>*{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail-copy span{font-size:10px;color:#aaa}.detail .accent{font-size:10px;max-width:110px;padding:6px}.detail .small{padding:4px;min-width:24px}.detail .status{flex:0 1 auto;min-width:0;margin:0}.back-results{margin:6px 10px 0;text-align:left;font-size:10px;color:#e8a581;border:0}.settings{padding:18px;overflow:auto;max-height:55%;background:#242326;border-bottom:1px solid #ffffff15}.settings p{font-size:12px;margin:8px 0 12px}.settings button{font-size:11px;margin:4px}.settings h3:not(:first-child){margin-top:16px}.danger{color:#efa699}.gate{padding:20px 10px}.gate h2{margin:12px 0}.gate p{line-height:1.7}.shell:has(.gate) .settings{max-height:none}
    .toolbar{border-top:1px solid #ffffff12;border-bottom:0}.toolbar .search-close{position:absolute;z-index:7}.toolbar-icon{display:block;width:16px;height:16px;filter:invert(1)}.card.selected{border-color:#ff915755}.detail{border-top:1px solid #ffffff12}.detail .accent{display:inline-flex;align-items:center;justify-content:center;max-width:none;white-space:nowrap;line-height:1}.locate-action{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;padding:4px}.locate-icon{display:block;width:16px;height:16px;filter:invert(1)}
    @media(max-width:759px){.main{width:720px;max-width:calc(100vw - 24px)}.detail-copy{min-width:80px}.toolbar select{width:92px}}
    @media(max-width:480px){.toolbar-line{flex-wrap:wrap}.search-wrap{flex-basis:100%}.toolbar select{flex:1;width:auto;min-width:0}.detail .status{display:none}.detail-copy{min-width:0}.detail.has-player{flex-wrap:wrap}.detail.has-player .detail-media{flex-basis:100%}.detail.has-player .detail-actions{margin-left:auto}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}.action-spinner{animation:none!important}}
  `;
  setInterval(route,500); window.addEventListener('popstate',route); window.addEventListener('resize',layout); route();
})();
