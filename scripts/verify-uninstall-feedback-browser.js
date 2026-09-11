const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/api/uninstall-feedback/config") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ turnstileSiteKey: "test-site-key" }));
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": filePath.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=scdTurnstileLoad", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      if (window.turnstile && window.turnstile.nodeType) throw new Error("Turnstile global collides with a DOM element");
      window.turnstile = {
        render(container, options) {
          container.dataset.rendered = "true";
          options.callback("test-token");
          return "test-widget";
        },
        reset() {},
      };
      window.scdTurnstileLoad();
    `,
  }));

  try {
    await page.goto(`http://127.0.0.1:${port}/?view=goodbye`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#feedback-submit")?.disabled === false);
    const result = await page.evaluate(() => ({
      status: document.querySelector("#feedback-status")?.textContent || "",
      rendered: document.querySelector("#turnstile-widget")?.dataset.rendered,
      turnstileApi: typeof window.turnstile?.render,
      submitDisabled: document.querySelector("#feedback-submit")?.disabled,
    }));
    assert.deepEqual(result, {
      status: "",
      rendered: "true",
      turnstileApi: "function",
      submitDisabled: false,
    });
    assert.deepEqual(pageErrors, []);
    console.log("Uninstall feedback browser verification passed.");
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
