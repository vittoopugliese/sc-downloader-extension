const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const widgetHtml = `<!doctype html><button id="play">Play</button><script>
  const listeners = new Set(); window.commands = []; window.blocked = false;
  window.emit = (method, value) => parent.postMessage(JSON.stringify({method,value}), 'https://soundcloud.com');
  addEventListener('message', event => {
    if (event.source !== parent) return;
    const data = JSON.parse(event.data); commands.push(data);
    if (data.method === 'addEventListener') listeners.add(data.value);
    if (data.method === 'play' && !blocked) emit('play');
    if (data.method === 'pause') emit('pause');
  });
  document.querySelector('button').onclick = () => emit('play');
  emit('ready');
</script>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body: '<header class="header" style="height:48px"></header><main class="l-main"></main><div class="playControls" style="position:fixed;bottom:0;height:48px"><button class="playControl playing">Native play</button></div>' }));
    await page.route('https://w.soundcloud.com/player/**', route => route.fulfill({ contentType: 'text/html', body: widgetHtml }));
    await page.goto('https://soundcloud.com/you/likes');
    await page.evaluate(() => {
      document.querySelector('.playControl').onclick = event => event.currentTarget.classList.toggle('playing');
      window.calls = []; window.allowed = true; window.delayTrack = null; window.savedView = null;
      window.items = Array.from({ length: 300 }, (_, i) => ({ itemId: String(i + 1), title: `Track ${i + 1}`, artistName: i % 2 ? 'Other' : 'Selected artist', artworkUrl: null, likedAt: '2020-01-01', permalink: `https://soundcloud.com/artist/track-${i + 1}` }));
      window.chrome = { i18n: { getUILanguage: () => 'es' }, runtime: {
        onMessage: { addListener: listener => window.notifyExplorer = listener },
        sendMessage: async request => {
          calls.push(request);
          if (!allowed) return { success: false, code: 'pro-required' };
          if (request.type === 'GET_LIKES_LIBRARY_STATUS') return { success: true, ownerId: '42', sourceUserId: '42', collectionId: 'likes:42', library: { generation: 'g1', revision: 1, count: items.length, complete: true }, collections: [], view: savedView };
          if (request.type === 'QUERY_LIKES') {
            if (request.generation && request.generation !== 'g1') return {success:false,code:'stale-generation'};
            const results = items.filter(item => !request.query || `${item.title} ${item.artistName}`.toLowerCase().includes(request.query.toLowerCase()));
            return { success: true, items: results.slice(request.offset || 0, (request.offset || 0) + request.limit), matchingCount: results.length, indexedCount: items.length, anchor: results.findIndex(item => item.itemId === request.trackId), periods: { '2020-01': { count: items.length } }, complete: true };
          }
          if (request.type === 'PLAY_LIKED_TRACK') {
            if (request.trackId === delayTrack) await new Promise(resolve => window.releaseTrack = resolve);
            return { success: true, item: items.find(item => item.itemId === request.trackId) };
          }
          if (request.type === 'SAVE_LIKES_VIEW') savedView = request;
          return { success: true, images: {} };
        },
      }};
    });
    for (const file of ['likes-explorer-i18n.js', 'soundcloud-likes-locator.js', 'likes-player.js', 'soundcloud-playback.js', 'likes-explorer.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
    const ui = selector => page.locator(`#scdl-likes-explorer ${selector}`);
    const state = value => page.waitForFunction(value => document.querySelector('#scdl-likes-explorer')?.shadowRoot.querySelector('.player-inline')?.dataset.state === value, value);
    const selectTrack = async id => { await ui(`.card[data-id="${id}"] .card-main`).click(); };
    const playTrack = async id => { await selectTrack(id); await ui('.detail-play').click(); };
    const widget = () => page.frames().find(frame => frame.url().startsWith('https://w.soundcloud.com/player/'));
    await ui('.launch').click();
    await ui('.card-main').first().waitFor();
    assert.equal(await ui('.card-play').count(), 0, 'the grid only selects tracks');
    assert.equal(await ui('.player-dock').count(), 0, 'there is no separate player card');
    await selectTrack('1');
    assert.equal(await ui('iframe').count(), 0, 'selection does not create a player');
    assert.equal(await page.evaluate(() => calls.filter(call=>call.type==='PLAY_LIKED_TRACK').length), 0);
    await ui('.toolbar input').fill('Selected artist');
    await page.waitForFunction(() => calls.some(call => call.type === 'QUERY_LIKES' && call.query === 'Selected artist'));
    await playTrack('1');
    await state('playing');
    assert.equal(await page.locator('.playControl').getAttribute('class'), 'playControl', 'native player pauses when widget starts');
    assert.equal(await ui('iframe').count(), 1);
    assert.equal(await ui('.detail .detail-media iframe').count(), 1, 'the iframe replaces the internal title/artwork');
    assert.equal(await ui('.detail-summary').isVisible(), false);
    assert.equal((await ui('iframe').boundingBox()).height, 80);
    const originalFrame = widget();
    await ui('.toolbar input').fill('Other');
    await page.waitForFunction(() => calls.some(call => call.type === 'QUERY_LIKES' && call.query === 'Other'));
    await selectTrack('2');
    assert.equal(await ui('.detail-summary').isVisible(), true);
    assert.equal(await ui('.player-inline').isVisible(), false);
    assert.equal(widget(), originalFrame, 'selecting another track never reloads the current audio');
    assert.equal(await ui('.detail-play').innerText(), '▶ Reproducir');
    assert.equal(await page.evaluate(() => calls.filter(call=>call.type==='PLAY_LIKED_TRACK').length), 1);
    await ui('.detail-play').click(); await state('playing');
    assert.match(await ui('iframe').getAttribute('src'), /tracks%2F2/);
    assert.equal(await ui('.toolbar input').inputValue(), 'Other');
    assert.equal(await ui('iframe').count(), 1, 'one live player after changing tracks');
    const finishedFrame = widget();
    const playsBeforeFinish = await page.evaluate(() => calls.filter(call=>call.type==='PLAY_LIKED_TRACK').length);
    await widget().evaluate(() => emit('finish'));
    await state('ended');
    assert.equal(widget(), finishedFrame);
    assert.equal(await page.evaluate(() => calls.filter(call=>call.type==='PLAY_LIKED_TRACK').length), playsBeforeFinish, 'finish never starts another track');
    await ui('.detail-play').click(); await state('playing');
    await ui('.detail-play').click(); await state('paused');
    await widget().evaluate(() => emit('playProgress',{currentPosition:1500}));
    assert.equal(await ui('.player-inline').getAttribute('data-state'), 'paused', 'late progress must not undo pause');
    await widget().evaluate(() => window.blocked = true);
    await ui('.detail-play').click(); await state('needs-play');
    assert.match(await ui('.player-status').innerText(), /Pulsá Play/);
    await widget().locator('#play').click(); await state('playing');

    // Only the current widget's exact origin and source may change player state.
    await page.evaluate(() => {
      window.postMessage(JSON.stringify({method:'error'}), location.origin);
      window.dispatchEvent(new MessageEvent('message', {origin:'https://w.soundcloud.com',source:window,data:JSON.stringify({method:'error'})}));
    });
    assert.equal(await ui('.player-inline').getAttribute('data-state'), 'playing');
    const firstFrame = widget();
    await ui('.search-close').click();
    assert.equal(await ui('.shell').isVisible(), false);
    assert.equal(await ui('.player-inline').isVisible(), false);
    await ui('.launch').click();
    assert.equal(widget(), firstFrame, 'closing/reopening never reloads the iframe');

    // The detail row has no separate Open button: the native-play button covers it.
    assert.equal(await ui('.open-track').count(), 0);

    // A slow authorization for A must not start A after a later click on B.
    await ui('.toolbar input').fill(''); await ui('.toolbar select').first().selectOption('');
    await page.waitForTimeout(250);
    await ui('.viewport').evaluate(node => {node.scrollTop = 0;}); await page.waitForTimeout(150);
    await page.evaluate(() => window.delayTrack = '3');
    await playTrack('3');
    await page.waitForFunction(() => typeof releaseTrack === 'function');
    await playTrack('4'); await state('playing');
    await page.evaluate(() => releaseTrack());
    assert.match(await ui('iframe').getAttribute('src'), /tracks%2F4/);
    await widget().evaluate(() => emit('error')); await state('error');
    await ui('.detail-play').click(); await state('playing');
    await page.locator('.playControl').click(); await state('paused');
    await ui('.detail-play').click(); await state('playing');
    assert.equal(await page.locator('.playControl').getAttribute('class'), 'playControl');

    // Identity changes cancel an authorization that has not returned yet.
    await page.evaluate(() => {window.delayTrack='6';window.releaseTrack=null;});
    await playTrack('6');
    await page.waitForFunction(() => typeof releaseTrack === 'function');
    await page.evaluate(() => notifyExplorer({type:'LIKES_IDENTITY_CHANGED'}));
    await page.evaluate(() => releaseTrack());
    assert.equal(await ui('iframe').count(), 0);
    await ui('.launch').click();
    await ui('.toolbar input').fill(''); await ui('.toolbar select').first().selectOption('');
    await page.waitForTimeout(250);
    await ui('.viewport').evaluate(node => {node.scrollTop = 0;}); await page.waitForTimeout(150);
    await playTrack('4'); await state('playing');

    // Compact layouts, including the native widget's manual Play fallback.
    for (const width of [390, 760, 1024]) {
      await page.setViewportSize({width,height:800}); await page.waitForTimeout(180);
      for (const selector of ['.main','.detail','.player-inline','iframe','.detail-actions','.toolbar .sync','.toolbar .icon-only']) {
        const box = await ui(selector).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, `${selector} fits ${width}px`);
      }
      assert.equal((await ui('iframe').boundingBox()).height, 80);
      assert.equal(await ui('.detail-summary').isVisible(), false);
      if (width === 390) await page.screenshot({ path: 'test-results/likes-playback-mobile.png' });
    }
    await page.setViewportSize({width:1360,height:960});
    await page.screenshot({ path: 'test-results/likes-playback-desktop.png' });
    await page.evaluate(() => history.pushState({}, '', '/artist/track'));
    await page.waitForTimeout(550);
    assert.equal(await ui('.player-inline').isVisible(), true, 'SPA navigation keeps active playback');
    await page.evaluate(() => { allowed = false; notifyExplorer({type:'LIKES_IDENTITY_CHANGED'}); });
    assert.equal(await page.locator('#scdl-likes-explorer iframe').count(), 0, 'identity changes stop audio');
    assert.equal(errors.length, 0, errors.join('\n'));

    // The widget remains usable after a loading timeout, without late autoplay.
    await page.route('https://w.soundcloud.com/player/**', route => route.fulfill({contentType:'text/html',body:'<button>Manual Play</button>'}));
    await page.evaluate(() => {
      window.timeoutStates=[];
      const container=document.createElement('div');container.id='timeout-widget';document.body.append(container);
      window.timeoutPlayer=SCLikesPlayer.create({container,title:'Timeout test',onState:phase=>timeoutStates.push(phase),onFinish:()=>{},readyTimeout:50});
      timeoutPlayer.load({itemId:'293',title:'Test'});
    });
    await page.waitForFunction(()=>timeoutStates.includes('error'));
    await widget().evaluate(()=>{
      window.commands=[];
      addEventListener('message',event=>commands.push(JSON.parse(event.data).method));
      parent.postMessage(JSON.stringify({method:'ready'}),'https://soundcloud.com');
    });
    await page.waitForFunction(()=>timeoutStates.includes('paused'));
    assert.equal(await widget().evaluate(()=>commands.includes('play')),false);
    await page.evaluate(()=>timeoutPlayer.destroy());
    assert.equal(await page.locator('#timeout-widget iframe').count(),0);
    console.log('Likes playback: select-then-play only, compact inline widget, no automatic advance, autoplay fallback, stale requests, origin checks, new-tab intent, persistent audio and responsive layout passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
