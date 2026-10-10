(function () {
  const button = document.getElementById('likesExplorerBtn');
  if (!button) return;
  const title = document.querySelector('.likes-explorer-title');
  const detail = document.querySelector('.likes-explorer-detail');
  if (globalThis.SCLikesText) {
    title.textContent = SCLikesText('title');
    detail.textContent = SCLikesText('tagline');
    button.textContent = `${SCLikesText('open')} ↗`;
    button.title = SCLikesText('title');
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const tabs = await chrome.tabs.query({ url: 'https://soundcloud.com/*', currentWindow: true });
      const isLikes = tab => /^\/(?:you|[^/]+)\/likes\/?$/.test(new URL(tab.url).pathname);
      const tab = tabs.find(t => t.active && isLikes(t)) || tabs.find(isLikes);
      if (tab) {
        await chrome.tabs.update(tab.id,{active:true});
        await chrome.tabs.sendMessage(tab.id,{type:'OPEN_LIKES_EXPLORER'},{frameId:0});
      } else await chrome.tabs.create({url:'https://soundcloud.com/you/likes#scdl-explore'});
      window.close();
    } catch { button.disabled = false; button.textContent = SCLikesText('retry'); }
  });
})();
