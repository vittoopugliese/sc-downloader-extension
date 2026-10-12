(function (root) {
  'use strict';
  // SoundCloud's documented widget methods/events, using the postMessage wire
  // format verified against https://w.soundcloud.com/player/api.js (2026-10-09).
  // No remote JavaScript executes in the extension. The visible iframe remains
  // usable when the browser requires a direct click to start playback.
  const ORIGIN = 'https://w.soundcloud.com';
  function create({ container, title, onState, onFinish, readyTimeout = 15000, playTimeout = 4000 }) {
    let frame, ready = false, wantsPlay = false, played = false, phase = 'idle';
    let readyTimer, playTimer;
    function state(next) { phase = next; onState(next); }
    function post(method, value = null) {
      frame?.contentWindow?.postMessage(JSON.stringify({ method, value }), ORIGIN);
    }
    function clearTimers() { clearTimeout(readyTimer); clearTimeout(playTimer); }
    function awaitingPlay() {
      clearTimeout(playTimer);
      playTimer = setTimeout(() => {
        if (wantsPlay && phase !== 'playing') state('needs-play');
      }, playTimeout);
    }
    function receive(event) {
      if (!frame || event.origin !== ORIGIN || event.source !== frame.contentWindow) return;
      let data;
      try { data = typeof event.data === 'string' && event.data.length < 65536 ? JSON.parse(event.data) : null; } catch { return; }
      if (!data || typeof data.method !== 'string') return;
      if (data.method === 'ready') {
        if (ready) return;
        ready = true; clearTimeout(readyTimer);
        for (const name of ['play', 'pause', 'finish', 'error', 'playProgress']) post('addEventListener', name);
        if (wantsPlay) { post('play'); awaitingPlay(); }
        else state('paused');
      } else if (ready && (data.method === 'play' || data.method === 'playProgress')) {
        // Progress also confirms playback if the iframe's initial play event
        // preceded our listener registration.
        if (data.method === 'playProgress' && !wantsPlay) return;
        wantsPlay = true; played = true; clearTimeout(playTimer);
        if (phase !== 'playing') state('playing');
      } else if (ready && data.method === 'pause') {
        wantsPlay = false; clearTimeout(playTimer); state('paused');
      } else if (ready && data.method === 'finish' && played) {
        played = false; wantsPlay = false; clearTimeout(playTimer); state('ended'); onFinish();
      } else if (data.method === 'error') {
        wantsPlay = false; clearTimers(); state('error');
      }
    }
    window.addEventListener('message', receive);
    return {
      load(item) {
        if (!/^\d+$/.test(String(item.itemId))) throw new Error('Invalid widget track');
        clearTimers(); frame?.remove(); ready = false; wantsPlay = true; played = false;
        frame = document.createElement('iframe');
        frame.title = `${title}: ${item.title}`;
        // Keep the widget's 100px layout intact, scaled to an 80px inline player.
        frame.width = '125%'; frame.height = '100';
        frame.style.cssText = 'display:block;width:125%;height:100px;border:0;transform:scale(.8);transform-origin:top left';
        frame.allow = 'autoplay'; frame.setAttribute('scrolling', 'no');
        const url = new URL('/player/', ORIGIN);
        url.search = new URLSearchParams({ url: `https://api.soundcloud.com/tracks/${item.itemId}`, auto_play: 'false',
          visual: 'false', show_artwork: 'true', show_user: 'true', show_related: 'false',
          sharing: 'false', buying: 'false', download: 'false', color: '#e99b74', scdl_likes_player: '1' }).toString();
        frame.src = url.href;
        container.replaceChildren(frame);
        state('loading');
        readyTimer = setTimeout(() => { if (!ready) { wantsPlay = false; state('error'); } }, readyTimeout);
      },
      play() { wantsPlay = true; if (ready) { post('play'); awaitingPlay(); } },
      pause() { wantsPlay = false; clearTimeout(playTimer); if (ready) post('pause'); state('paused'); },
      destroy() {
        clearTimers(); window.removeEventListener('message', receive);
        frame?.remove(); frame = null;
      },
    };
  }
  root.SCLikesPlayer = { create };
})(globalThis);
