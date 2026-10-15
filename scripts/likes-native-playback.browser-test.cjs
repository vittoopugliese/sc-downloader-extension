const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body:
      '<header class="header" style="height:48px"></header><main class="l-main"></main><div class="playControls" style="position:fixed;bottom:0;height:48px"><button class="playControl">Play</button><a class="playbackSoundBadge__titleLink" href="/artist/old">Old</a></div>' }));
    await page.route('https://w.soundcloud.com/player/**', route => route.fulfill({ contentType: 'text/html', body: `
      <button>Play</button><script>
        const emit=method=>parent.postMessage(JSON.stringify({method}),'https://soundcloud.com');
        addEventListener('message',e=>{const data=JSON.parse(e.data);if(['play','pause'].includes(data.method))emit(data.method);});
        document.querySelector('button').onclick=()=>emit('play');emit('ready');
      </script>` }));
    await page.goto('https://soundcloud.com/you/likes');
    await page.evaluate(() => {
      window.fixture = { clicks: [], blocked: false, freeze: false, allowed: true, delay: null, routes: [], heldRoutes: new Set(), releaseRoutes: {} };
      window.items = Array.from({ length: 12 }, (_, i) => ({ itemId: String(i+1), title: `Track ${i+1}`, artistName: 'Artist', permalink: `https://soundcloud.com/artist/track-${i+1}` }));
      const badge = document.querySelector('.playbackSoundBadge__titleLink');
      const toggle = document.querySelector('.playControl');
      let started = performance.now();
      function start(id) {
        fixture.clicks.push(id); badge.href = `/artist/track-${id}`; badge.textContent = `Track ${id}`;
        toggle.classList.toggle('playing', !fixture.blocked); started = performance.now();
      }
      toggle.onclick = () => { fixture.clicks.push('toggle'); toggle.classList.toggle('playing'); started = performance.now(); };
      window.renderNative = (id, hero = false) => {
        const card = document.createElement('article'); card.className = hero ? 'fullHero' : 'sound';
        card.innerHTML = `<a class="soundTitle__title" href="/artist/track-${id}">Track ${id}</a><h2 class="soundTitle__username"><a href="/artist">Artist</a></h2><button class="playButton">Play ${id}</button>`;
        card.querySelector('button').onclick = () => start(id);
        document.querySelector('.l-main').replaceChildren(card);
      };
      renderNative('1');
      addEventListener('popstate', () => {
        const id = location.pathname.match(/track-(\d+)$/)?.[1];
        if (!id) return;
        fixture.routes.push(id);
        const render = () => renderNative(id, true);
        if (fixture.heldRoutes.has(id)) fixture.releaseRoutes[id] = render;
        else setTimeout(render, 60);
      });
      // Controlled stand-in for the MAIN-world media bridge. Real bridge/audio
      // integration is exercised separately against SoundCloud's public player.
      document.addEventListener('scdl-looper:command', event => {
        const command = JSON.parse(event.target.getAttribute('data-scdl-looper-command'));
        event.target.setAttribute('data-scdl-looper-response', JSON.stringify({ id: command.id, ok: true, state: {
          available: true, paused: !toggle.classList.contains('playing'),
          currentTimeMs: fixture.freeze ? 0 : performance.now()-started,
          loop: { trackIdentity: `permalink:${badge.href}` },
        }}));
      });
      window.chrome = { i18n: { getUILanguage: () => 'es' }, runtime: {
        onMessage: { addListener: fn => window.notifyExplorer = fn },
        sendMessage: async request => {
          if (!fixture.allowed) return { success: false, code: 'pro-required' };
          if (request.type === 'GET_LIKES_LIBRARY_STATUS') return { success: true, ownerId: '42', sourceUserId: '42', collectionId: 'likes:42', library: { generation: 'g1', revision: 1, count: items.length, complete: true }, collections: [] };
          if (request.type === 'QUERY_LIKES') return { success: true, items: items.slice(request.offset || 0,(request.offset || 0)+request.limit), matchingCount: items.length, indexedCount: items.length, anchor: Math.max(0,items.findIndex(item=>item.itemId===request.trackId)), periods: {}, complete: true };
          if (request.type === 'PLAY_LIKED_TRACK') {
            if (request.trackId === fixture.delay) await new Promise(resolve => fixture.releaseAuth = resolve);
            return { success: true, item: items.find(item=>item.itemId===request.trackId) };
          }
          return { success: true };
        },
      }};
    });
    for (const file of ['likes-explorer-i18n.js','soundcloud-likes-locator.js','likes-player.js','soundcloud-playback.js','likes-explorer.js']) {
      await page.addScriptTag({ path: path.join(__dirname,file) });
    }
    await page.evaluate(() => {
      const play = SCSoundCloudPlayback.play;
      SCSoundCloudPlayback.play = (item,options) => play(item,{ ...options, timeout: 750 });
    });
    const ui = selector => page.locator(`#scdl-likes-explorer ${selector}`);
    const select = id => ui(`.card[data-id="${id}"] .card-main`).click();
    const transfer = async id => { await select(id); await ui('.native-play').click(); };
    const nativeState = state => page.waitForFunction(state => document.querySelector('#scdl-likes-explorer')?.shadowRoot.querySelector('.native-play')?.dataset.state===state,state);
    const previewState = state => page.waitForFunction(state => document.querySelector('#scdl-likes-explorer')?.shadowRoot.querySelector('.player-inline')?.dataset.state===state,state);
    await ui('.launch').click();
    await select('1');
    assert.equal(await ui('.locate-action + .native-play').count(),1,'the new action is beside Teleport');
    assert.notEqual(await ui('.native-play').evaluate(n=>getComputedStyle(n).backgroundColor),await ui('.detail-play').evaluate(n=>getComputedStyle(n).backgroundColor));
    assert.equal(await ui('.native-play').getAttribute('aria-label'),'Usar en Player Tools');

    // Works before ever creating a preview, and never toggles a playing track off.
    await ui('.native-play').click(); await nativeState('playing');
    assert.equal(page.url(),'https://soundcloud.com/you/likes');
    assert.equal(await ui('iframe').count(),0);
    assert.deepEqual(await page.evaluate(()=>fixture.clicks),['1']);
    await ui('.native-play').click(); await nativeState('playing');
    assert.deepEqual(await page.evaluate(()=>fixture.clicks),['1']);
    await page.locator('.playControl').click();
    await ui('.native-play').click(); await nativeState('playing');
    assert.deepEqual(await page.evaluate(()=>fixture.clicks),['1','toggle','toggle']);

    // Preview remains the same frame, paused, after transfer to a different track.
    await ui('.detail-play').click(); await previewState('playing');
    const frame = page.frames().find(frame=>frame.url().startsWith('https://w.soundcloud.com/player/'));
    const frameNode = await ui('iframe').elementHandle();
    await transfer('2'); await nativeState('playing');
    assert.equal(page.url(),'https://soundcloud.com/artist/track-2');
    assert.equal(await frameNode.evaluate(n=>n.isConnected),true);
    assert.equal(page.frames().includes(frame),true);
    assert.equal(await ui('.shell').isVisible(),true);
    assert.equal(await page.locator('.playbackSoundBadge__titleLink').getAttribute('href'),'/artist/track-2');
    await select('1'); await ui('.detail-play').click(); await previewState('playing');
    assert.equal(await page.locator('.playControl').evaluate(n=>n.classList.contains('playing')),false);
    assert.equal(page.frames().includes(frame),true);

    // Old authorization and old SPA views must never start the wrong track.
    await page.evaluate(()=>{fixture.delay='3';});
    await transfer('3'); await page.waitForFunction(()=>!!fixture.releaseAuth);
    await transfer('4'); await nativeState('playing');
    await page.evaluate(()=>fixture.releaseAuth());
    assert.equal(await page.evaluate(()=>fixture.clicks.includes('3')),false);
    await page.evaluate(()=>{fixture.heldRoutes.add('5');fixture.heldRoutes.add('6');});
    await transfer('5'); await page.waitForFunction(()=>!!fixture.releaseRoutes['5']);
    await transfer('6'); await page.waitForFunction(()=>!!fixture.releaseRoutes['6']);
    await page.evaluate(()=>fixture.releaseRoutes['5']());
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>fixture.clicks.includes('5')),false);
    await page.evaluate(()=>fixture.releaseRoutes['6']()); await nativeState('playing');

    // Browser/autoplay blocks and stalled audio are not reported as success.
    await page.evaluate(()=>{fixture.blocked=true;});
    await transfer('7'); await nativeState('needs-play');
    assert.match(await ui('.native-status').innerText(),/Pulsá Play en la barra inferior/);
    await page.locator('.playControl').click();
    await ui('.native-play').click(); await nativeState('playing');
    await page.evaluate(()=>{fixture.blocked=false;fixture.freeze=true;});
    await transfer('8'); await nativeState('needs-play');
    await page.evaluate(()=>{fixture.freeze=false;fixture.heldRoutes.add('9');});
    const beforeWrong = await page.evaluate(()=>fixture.clicks.length);
    await transfer('9'); await nativeState('unavailable');
    assert.equal(await page.evaluate(()=>fixture.clicks.length),beforeWrong,'a stale hero must never receive Play');

    // A preview request supersedes pending native authorization.
    await page.evaluate(()=>{fixture.delay='10';fixture.releaseAuth=null;});
    await transfer('10'); await page.waitForFunction(()=>!!fixture.releaseAuth);
    await select('1'); await ui('.detail-play').click(); await previewState('playing');
    await page.evaluate(()=>fixture.releaseAuth());
    assert.equal(await page.evaluate(()=>fixture.clicks.includes('10')),false);

    // Keep the iframe and all actions inside compact layouts, with status visible.
    await transfer('1'); await nativeState('playing');
    for (const width of [390,760,1024]) {
      await page.setViewportSize({width,height:850}); await page.waitForTimeout(180);
      for (const selector of ['.detail','.native-play','.detail-actions','iframe','.native-status']) {
        const box = await ui(selector).boundingBox();
        assert.ok(box && box.x>=0 && box.x+box.width<=width,`${selector} fits ${width}px`);
      }
      assert.equal((await ui('iframe').boundingBox()).height,80);
      await page.screenshot({path:`test-results/likes-native-${width}.png`});
    }

    // Losing identity cancels a request that has not reached native playback.
    await page.evaluate(()=>{fixture.delay='11';fixture.releaseAuth=null;});
    await transfer('11'); await page.waitForFunction(()=>!!fixture.releaseAuth);
    await page.evaluate(()=>{notifyExplorer({type:'LIKES_IDENTITY_CHANGED'});fixture.releaseAuth();});
    assert.equal(await page.evaluate(()=>fixture.clicks.includes('11')),false);
    assert.equal(await page.locator('#scdl-likes-explorer').count(),0);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Native handoff passed: distinct adjacent button, mounted/off-page tracks, identity and advancing media checks, cancellation, autoplay fallback, persistent preview and compact layouts.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
