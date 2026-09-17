(function () {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'popup-control-btn'; button.textContent = '♡  Likes Explorer ↗';
  button.title = 'Likes Explorer';
  button.style.cssText = 'margin:8px 16px 12px;width:calc(100% - 32px);font-size:12px';
  const container = document.querySelector('#downloadPanel') || document.querySelector('.container') || document.body;
  container.append(button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const tabs = await chrome.tabs.query({ url: 'https://soundcloud.com/*', currentWindow: true });
      const tab = tabs.find(t => t.active) || tabs[0];
      if (tab) {
        if (new URL(tab.url).pathname.replace(/\/$/,'') === '/you/likes') { await chrome.tabs.update(tab.id,{active:true}); await chrome.tabs.sendMessage(tab.id,{type:'OPEN_LIKES_EXPLORER'},{frameId:0}); }
        else await chrome.tabs.update(tab.id,{url:'https://soundcloud.com/you/likes#scdl-explore',active:true});
      } else await chrome.tabs.create({url:'https://soundcloud.com/you/likes#scdl-explore'});
      window.close();
    } catch { button.disabled = false; button.textContent = SCLikesText('retry'); }
  });
})();
