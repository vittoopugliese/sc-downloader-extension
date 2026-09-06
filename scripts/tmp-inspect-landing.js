(async () => {
  const targets = await fetch('http://127.0.0.1:9333/json/list').then(response => response.json());
  const page = targets.find(target => target.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onopen = () => socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `JSON.stringify({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        offenders: [...document.querySelectorAll('body *')]
          .map(element => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              className: String(element.className || '').slice(0, 80),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width)
            };
          })
          .filter(item => item.right > innerWidth + 1 || item.left < 0)
          .slice(0, 40)
      })`,
      returnByValue: true
    }
  }));
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    console.log(message.result.result.value);
    socket.close();
  };
})();
