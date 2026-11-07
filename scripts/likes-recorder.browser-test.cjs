// Likes Explorer mini recorder: pill layout, Rec/Stop through the widget protocol,
// and the chunked upload to the Stem Extractor. The widget is a local fake.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const widgetHtml = `<!doctype html><script>
  const send = (data, transfer) => parent.postMessage(data, 'https://soundcloud.com', transfer || []);
  const emit = (method, value) => parent.postMessage(JSON.stringify({method,value}), 'https://soundcloud.com');
  let timer = null, phase = 0;
  addEventListener('message', event => {
    if (event.source !== parent) return;
    const data = event.data;
    if (typeof data === 'string') {
      const command = JSON.parse(data);
      if (command.method === 'play') emit('play');
      if (command.method === 'pause') emit('pause');
      return;
    }
    if (data?.scdl !== 'widget-record') return;
    if (data.type === 'start') {
      window.lastStart = data;
      send({ scdl: 'widget-record', type: 'started', id: data.id, sampleRate: 48000 });
      timer = setInterval(() => {
        const channels = [new Float32Array(2048), new Float32Array(2048)];
        for (let i = 0; i < 2048; i++) channels[0][i] = channels[1][i] = Math.sin(phase++ / 20) * .5;
        send({ scdl: 'widget-record', type: 'chunk', id: data.id, sampleRate: 48000, channels }, channels.map(c => c.buffer));
      }, 42);
    }
    if (data.type === 'stop') { clearInterval(timer); send({ scdl: 'widget-record', type: 'stopped', id: data.id, limitReached: false }); }
  });
  emit('ready');
</script>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body: '<header class="header" style="height:48px"></header><main class="l-main"></main>' }));
    await page.route('https://w.soundcloud.com/player/**', route => route.fulfill({ contentType: 'text/html', body: widgetHtml }));
    await page.goto('https://soundcloud.com/you/likes');
    await page.evaluate(() => {
      window.items = Array.from({ length: 40 }, (_, i) => ({ itemId: String(i + 1), title: `Track ${i + 1}`, artistName: 'Artist', artworkUrl: 'https://i1.sndcdn.com/a.jpg', likedAt: '2020-01-01', permalink: `https://soundcloud.com/artist/track-${i + 1}` }));
      window.uploads = [];
      window.chrome = { i18n: { getUILanguage: () => 'es' }, runtime: {
        getURL: path => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`,
        onMessage: { addListener() {} },
        connect({ name }) {
          const upload = { name, messages: [] }; uploads.push(upload);
          const listeners = [];
          return { postMessage(message) {
            upload.messages.push(message);
            if (message.type === 'end') setTimeout(() => listeners.forEach(fn => fn({ success: true })), 20);
          }, onMessage: { addListener: fn => listeners.push(fn) }, onDisconnect: { addListener() {} }, disconnect() {} };
        },
        sendMessage: async request => {
          if (request.type === 'GET_LIKES_LIBRARY_STATUS') return { success: true, ownerId: '42', sourceUserId: '42', collectionId: 'likes:42', library: { generation: 'g1', revision: 1, count: items.length, complete: true }, collections: [] };
          if (request.type === 'QUERY_LIKES') return { success: true, items: items.slice(request.offset || 0, (request.offset || 0) + request.limit), matchingCount: items.length, indexedCount: items.length, anchor: -1, periods: {}, complete: true };
          if (request.type === 'PLAY_LIKED_TRACK') return { success: true, item: { ...items.find(item => item.itemId === request.trackId), artworkUrl: undefined } };
          return { success: true, images: {} };
        },
      } };
    });
    for (const file of ['icons.js', 'likes-explorer-i18n.js', 'soundcloud-likes-locator.js', 'likes-player.js', 'soundcloud-playback.js',
      'player-tools-i18n.js', 'record-core.js', 'record-ui.js', 'widget-record-source.js', 'likes-explorer.js']) {
      await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const ui = selector => page.locator(`#scdl-likes-explorer ${selector}`);
    await ui('.launch').click();
    await ui('.card-main').first().waitFor();
    await ui('.card[data-id="2"] .card-main').click();
    assert.equal(await ui('.record-slot').isVisible(), false, 'no pill before a track plays');
    await ui('.detail-play').click();
    await page.waitForFunction(() => document.querySelector('#scdl-likes-explorer').shadowRoot.querySelector('.player-inline')?.dataset.state === 'playing');
    await ui('.record-slot').waitFor({ state: 'visible' });

    // Full width, below the buttons.
    const box = await page.evaluate(() => {
      const root = document.querySelector('#scdl-likes-explorer').shadowRoot;
      const rect = node => node.getBoundingClientRect();
      return { detail: rect(root.querySelector('.detail')), actions: rect(root.querySelector('.detail-actions')), pill: rect(root.querySelector('.record-slot')),
        stage: rect(root.querySelector('.record-stage')) };
    });
    assert.ok(box.pill.top >= box.actions.bottom, 'the pill sits under the buttons');
    assert.ok(box.pill.width >= box.detail.width - 24, 'the pill takes the full width');
    assert.ok(box.stage.height >= 20 && box.stage.height <= 28, `mini waveform (${box.stage.height}px)`);
    assert.ok(box.pill.height <= 34, `one-line recorder (${box.pill.height}px)`);
    assert.ok(box.detail.height <= 125, `compact detail (${box.detail.height}px)`);
    assert.equal(await ui('.record-send').textContent(), 'Enviar al Stem Extractor', 'Spanish copy');
    assert.equal(await ui('.record-send').isDisabled(), true);
    assert.equal(await ui('.open-track').count(), 0);

    await ui('.record-start').click();
    await page.waitForFunction(() => document.querySelector('#scdl-likes-explorer').shadowRoot.querySelector('#scdl-record-pill').dataset.recording === 'true');
    const start = await page.frames().find(frame => frame.url().startsWith('https://w.soundcloud.com/player/')).evaluate(() => window.lastStart);
    assert.equal(start.maxSeconds, 120); assert.match(start.moduleUrl, /^chrome-extension:\/\/[a-p]{32}\/scripts\/record-processor\.js$/);
    await page.waitForTimeout(700);
    await ui('.record-stop').click();
    await page.waitForFunction(() => !document.querySelector('#scdl-likes-explorer').shadowRoot.querySelector('.record-send').disabled);
    const time = await ui('.record-time').textContent();
    assert.match(time, /^00:00\.[3-9]\d\d$|^00:01\.\d{3}$/, `take duration shown (${time})`);

    // Edison zoom still works in the pill.
    const canvas = ui('.record-canvas');
    await canvas.hover(); await page.mouse.wheel(0, -300);
    assert.equal(await canvas.evaluate(node => node.classList.contains('is-zoomed')), true);
    await ui('.detail').screenshot({ path: 'test-results/likes-recorder.png' });

    await ui('.record-send').click();
    await page.waitForFunction(() => uploads[0]?.messages.at(-1)?.type === 'end');
    const upload = await page.evaluate(() => {
      const [begin, ...rest] = uploads[0].messages;
      const chunks = rest.filter(message => message.type === 'chunk');
      const bytes = chunks.reduce((sum, message) => sum + atob(message.data).length, 0);
      const head = atob(chunks[0].data).slice(0, 12);
      return { name: uploads[0].name, begin, bytes, head };
    });
    assert.equal(upload.name, 'stem-recording-upload');
    assert.equal(upload.bytes, upload.begin.size, 'all WAV bytes are sent');
    assert.match(upload.head, /^RIFF.{4}WAVE$/s);
    assert.equal(upload.begin.title, 'Track 2 (grabación)');
    assert.equal(upload.begin.trackUrl, 'https://soundcloud.com/artist/track-2');
    assert.equal(upload.begin.artworkUrl, 'https://i1.sndcdn.com/a.jpg');
    await page.waitForFunction(() => !document.querySelector('#scdl-likes-explorer').shadowRoot.querySelector('.record-send').disabled);

    // Another selection keeps the take visible; playing another track keeps it too.
    await ui('.card[data-id="5"] .card-main').click();
    assert.equal(await ui('.record-slot').isVisible(), true, 'a finished take stays in view');
    assert.deepEqual(errors, []);
    console.log('Likes recorder UI passed: pill layout, Spanish copy, Rec/Stop over the widget, zoom and chunked Stem Extractor upload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
