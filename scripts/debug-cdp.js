const http = require("http");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function sendCommand(webSocketUrl, method, params) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (handler) {
      pending.delete(message.id);
      handler(message);
    }
  });

  const result = await new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({
      id,
      method,
      params,
    }));
  });

  socket.close();
  if (result.result?.exceptionDetails) {
    return result.result.exceptionDetails;
  }
  return result.result?.result?.value ?? result;
}

(async () => {
  const rawExpression = process.argv.slice(2).join(" ");
  const expression = process.env.SCDL_CDP_BASE64 === "1"
    ? Buffer.from(rawExpression, "base64").toString("utf8")
    : rawExpression;
  const port = process.env.SCDL_CDP_PORT || "9223";
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const targetPrefix = process.env.SCDL_CDP_TARGET || "https://soundcloud.com/";
  const targetType = process.env.SCDL_CDP_TYPE || "page";
  const page = targetType === "browser"
    ? await getJson(`http://127.0.0.1:${port}/json/version`)
    : targets.find(
        (target) => target.type === targetType && target.url.startsWith(targetPrefix)
      );

  if (!page) {
    throw new Error("SoundCloud page target not found.");
  }

  const method = process.env.SCDL_CDP_METHOD || "Runtime.evaluate";
  const params = method === "Runtime.evaluate"
    ? { expression, awaitPromise: true, returnByValue: true }
    : JSON.parse(expression || "{}");
  const result = await sendCommand(page.webSocketDebuggerUrl, method, params);
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
