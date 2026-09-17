(function (root) {
  'use strict';
  let stop;
  function cancel() { stop?.(); }
  function locate(permalink, onProgress) {
    cancel();
    return new Promise(resolve => {
      let done = false, advances = 0, height = 0, lastProgress = Date.now(), timer;
      const observed = new Set();
      const started = Date.now(), route = location.pathname;
      const finish = found => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); for (const event of ['wheel','touchstart','keydown','pointerdown']) window.removeEventListener(event, manual, true); stop = null; resolve(found); };
      const manual = event => { if (event.isTrusted) finish(false); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(step, 100); });
      function step() {
        if (done) return;
        if (location.pathname !== route || Date.now()-started > 30000 || Date.now()-lastProgress > 8000 || advances > 40) return finish(false);
        const links = [...document.querySelectorAll('a.soundTitle__title[href]')];
        const previousCount = observed.size; for (const link of links) observed.add(link.href);
        const match = links.find(a => new URL(a.href).origin + new URL(a.href).pathname.replace(/\/$/, '') === permalink);
        if (match) { const card = match.closest('.soundList__item,.sound') || match; card.scrollIntoView({ block: 'center', behavior: 'instant' }); card.animate?.([{ outline: '3px solid #ff793f' }, { outline: '3px solid transparent' }], { duration: 1800 }); finish(true); return; }
        const scroll = document.scrollingElement;
        const nextHeight = scroll.scrollHeight;
        if (nextHeight !== height || observed.size !== previousCount || advances === 0) { height = nextHeight; lastProgress = Date.now(); advances++; scroll.scrollTo({ top: nextHeight, behavior: 'instant' }); onProgress(observed.size); }
        clearTimeout(timer); timer = setTimeout(step, 700);
      }
      stop = () => finish(false);
      for (const event of ['wheel','touchstart','keydown','pointerdown']) window.addEventListener(event, manual, true);
      observer.observe(document.querySelector('.l-main') || document.body, { childList: true, subtree: true }); step();
    });
  }
  root.SCLikesLocator = { locate, cancel };
})(globalThis);
