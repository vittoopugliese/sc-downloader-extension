(function (root) {
  'use strict';
  const ORIGIN = 'https://soundcloud.com';
  const CARD = '.soundList__item,.sound,.playableTile,.soundBadge';
  const PLAY = '.playButton,button.sc-button-play';
  function permalink(value) {
    try {
      const url = new URL(value, ORIGIN);
      return url.origin === ORIGIN && !url.username && !url.password
        ? url.origin + url.pathname.replace(/\/$/, '') : null;
    } catch { return null; }
  }
  function currentTrack() {
    const link = document.querySelector('.playbackSoundBadge__titleLink[href]');
    return link ? permalink(link.href) : null;
  }
  function cardPlay(target) {
    for (const link of document.querySelectorAll('a[href]')) {
      if (permalink(link.href) !== target) continue;
      const control = link.closest(CARD)?.querySelector(PLAY);
      if (control) return control;
    }
    return null;
  }
  function mediaState() {
    // The existing MAIN-world bridge also discovers SoundCloud's detached audio.
    const node = document.documentElement, id = `likes-native:${crypto.randomUUID()}`;
    node.setAttribute('data-scdl-looper-command', JSON.stringify({ id, type: 'state' }));
    node.dispatchEvent(new CustomEvent('scdl-looper:command', { bubbles: true }));
    try {
      const response = JSON.parse(node.getAttribute('data-scdl-looper-response') || 'null');
      return response?.id === id && response.ok ? response.state : null;
    } catch { return null; }
  }
  function play(item, { signal, timeout = 15000 } = {}) {
    const target = permalink(item?.permalink);
    if (!target || !/^https:\/\/soundcloud\.com\/[^/]+\/[^/]+$/.test(target)) {
      return Promise.reject(Object.assign(new Error('track-missing'), { code: 'track-missing' }));
    }
    return new Promise((resolve, reject) => {
      let timer, done = false, clicked = false, previousTime = null;
      let route = permalink(location.href), control;
      const started = Date.now(), oldHero = document.querySelector('.fullHero');
      let navigated = false;
      const finish = (phase, error) => {
        if (done) return;
        done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve({ phase, permalink: target });
      };
      const cancel = () => finish(null, Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      function heroPlay() {
        const hero = document.querySelector('.fullHero');
        if (!hero || (navigated && hero === oldHero)) return null;
        // Canonical/OG metadata remains stale during SoundCloud SPA navigation.
        // Check the rendered title and uploader before touching its Play button.
        const title = hero.querySelector('.soundTitle__title')?.textContent.trim();
        const artist = hero.querySelector('.soundTitle__username[href],.soundTitle__username a[href]');
        const expectedArtist = target.slice(0, target.lastIndexOf('/'));
        if (title !== item.title?.trim() || !artist || permalink(artist.href) !== expectedArtist) return null;
        return hero.querySelector(PLAY);
      }
      function step() {
        try {
        if (done) return;
        if (signal?.aborted || permalink(location.href) !== route) { cancel(); return; }
        const selected = currentTrack() === target;
        const playing = !!document.querySelector('.playControls .playControl.playing');
        if (selected && playing) {
          const state = mediaState();
          if (state?.available && !state.paused && state.loop?.trackIdentity === `permalink:${target}` && Number.isFinite(state.currentTimeMs)) {
            if (previousTime !== null && Math.abs(state.currentTimeMs - previousTime) > 25) { finish('playing'); return; }
            previousTime = state.currentTimeMs;
          } else previousTime = null;
        } else {
          previousTime = null;
          if (!clicked) {
            const button = selected ? document.querySelector('.playControls .playControl') : control?.isConnected ? control : heroPlay();
            if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.classList.contains('disabled')) {
              clicked = true; button.click();
            }
          }
        }
        if (Date.now() - started >= timeout) { finish(currentTrack() === target ? 'needs-play' : 'unavailable'); return; }
        timer = setTimeout(step, 120);
        } catch (error) { finish(null, error); }
      }
      try {
        if (currentTrack() !== target) {
          control = cardPlay(target);
          if (!control && route !== target) {
            route = target; navigated = true;
            // SoundCloud handles popstate without replacing this document, so
            // Explorer's shadow DOM, filters and preview iframe stay mounted.
            history.pushState(history.state, '', target);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
          }
        }
        step();
      } catch (error) { finish(null, error); }
    });
  }
  root.SCSoundCloudPlayback = { play, currentTrack };
})(globalThis);
