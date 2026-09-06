const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".playwright-profile");
const targetUrl =
  process.argv[2] ||
  process.env.SCDL_LIVE_TRACK_URL ||
  "https://soundcloud.com/forss/flickermood";
const debugPort = process.env.SCDL_CDP_PORT || "9223";

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function attachDiagnostics(page) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("SCDL")) {
      console.log(`[page:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => console.error(`[page:error] ${error.message}`));
  page.on("requestfailed", (request) => {
    console.error(
      `[network:failed] ${request.method()} ${redactUrl(request.url())} ${request.failure()?.errorText || ""}`
    );
  });
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    viewport: null,
  });

  context.on("page", attachDiagnostics);
  for (const existingPage of context.pages()) attachDiagnostics(existingPage);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log(`Live browser ready at ${targetUrl}`);
  console.log(`Persistent profile: ${profile}`);
  console.log(`CDP diagnostics: SCDL_CDP_PORT=${debugPort} node scripts/debug-cdp.js "document.title"`);
  console.log("Close the browser or press Ctrl+C in this terminal to stop it.");

  const stop = async () => {
    await context.close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise((resolve) => context.once("close", resolve));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
