(function (root) {
  'use strict';
  let stop;
  function cancel() { stop?.(); }
  const CARD = '.soundList__item,.sound,.playableTile,.soundBadge';
  function gridNextTop(main, scroll, advances) {
    const cards = new Set([...main.querySelectorAll(`${CARD},a.soundTitle__title[href]`)].map(node => node.closest(CARD) || node));
    let lastRowTop = scroll.scrollTop;
    for (const card of cards) {
      if (!card.getClientRects().length) continue;
      lastRowTop = Math.max(lastRowTop, Math.round(card.getBoundingClientRect().top + scroll.scrollTop));
    }
    // Use an absolute frontier: retained rows must not increase the next jump,
    // and unchanged DOM while loading must not trigger another advance.
    if (!cards.size && advances === 0) lastRowTop += scroll.clientHeight * 0.75;
    return Math.min(lastRowTop, scroll.scrollHeight - scroll.clientHeight);
  }
  function locate(permalink, onProgress) {
    cancel();
    return new Promise(resolve => {
      let done = false, advances = 0, height = 0, lastProgress = Date.now(), timer, mutationTimer;
      const observed = new Set();
      const main = document.querySelector('.l-main') || document.body;
      const started = Date.now(), route = location.pathname;
      const finish = found => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); clearTimeout(mutationTimer); for (const event of ['wheel','touchstart','keydown','pointerdown']) window.removeEventListener(event, manual, true); stop = null; resolve(found); };
      const manual = event => { if (event.isTrusted) finish(false); };
      const observer = new MutationObserver(() => { if (!mutationTimer) mutationTimer = setTimeout(() => { mutationTimer = null; step(); }, 100); });
      function step() {
        if (done) return;
        if (location.pathname !== route || Date.now()-started > 30000 || Date.now()-lastProgress > 8000 || advances > 40) return finish(false);
        // Grid and list use different title/cover classes. Identity is the URL.
        const links = [...main.querySelectorAll('a[href]')];
        const previousCount = observed.size; for (const link of links) observed.add(link.href);
        const match = links.find(a => new URL(a.href).origin + new URL(a.href).pathname.replace(/\/$/, '') === permalink);
        if (match) { const card = match.closest(CARD) || match; card.scrollIntoView({ block: 'center', behavior: 'instant' }); card.animate?.([{ outline: '3px solid #ff793f' }, { outline: '3px solid transparent' }], { duration: 1800 }); finish(true); return; }
        const scroll = document.scrollingElement;
        const nextHeight = scroll.scrollHeight;
        const grid = !!document.querySelector('.collectionSection__action .listDisplayToggle__badgeToggle.sc-button-selected');
        const nextTop = grid ? gridNextTop(main,scroll,advances) : nextHeight;
        if (grid ? nextTop > scroll.scrollTop : nextHeight !== height || observed.size !== previousCount || advances === 0) {
          height = nextHeight; lastProgress = Date.now(); advances++;
          scroll.scrollTo({ top: nextTop, behavior: 'instant' }); onProgress(observed.size);
        }
        clearTimeout(timer); timer = setTimeout(step, 700);
      }
      stop = () => finish(false);
      for (const event of ['wheel','touchstart','keydown','pointerdown']) window.addEventListener(event, manual, true);
      observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] }); step();
    });
  }
  root.SCLikesLocator = { locate, cancel };
})(globalThis);
