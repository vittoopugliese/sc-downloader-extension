const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "contact-content.js"), "utf8");
const endpoint = "https://sctd.vpugliese.online/extension-content/contact.json";
const imageUrl = "https://sctd.vpugliese.online/extension-content/images/promo-v1.png";

function fixture(initial) {
  const elements = new Map();
  for (const id of ["contactContent", "contactContentTitle", "contactContentDescription",
    "contactContentLink", "contactContentImage"]) {
    elements.set(id, {
      hidden: true, textContent: "", href: "", alt: "", src: "",
      removeAttribute(name) { this[name] = ""; }
    });
  }
  let saved = initial;
  let nextResponse;
  let requests = 0;
  const context = {
    URL, AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    console: { warn() {} },
    document: { getElementById: (id) => elements.get(id) },
    chrome: { storage: { local: {
      async get() { return { "scdl.contact.content.v1": saved }; },
      async set(value) { saved = value["scdl.contact.content.v1"]; }
    } } },
    async fetch(url) {
      requests++;
      assert.equal(url, endpoint);
      return nextResponse();
    }
  };
  vm.runInNewContext(source, context);
  return {
    api: context.SCContactContent,
    elements,
    setResponse(callback) { nextResponse = callback; },
    get saved() { return saved; },
    get requests() { return requests; }
  };
}

function response(value) {
  const result = new Response(JSON.stringify(value));
  Object.defineProperty(result, "url", { value: endpoint });
  return result;
}

async function run() {
  const first = {
    schemaVersion: 1, revision: "1", enabled: true, title: "News",
    description: "Updates", link: { label: "Read", url: "https://example.com/" },
    image: { url: imageUrl, alt: "Promo" }
  };
  const app = fixture(first);
  let resolveNetwork;
  app.setResponse(() => new Promise((resolve) => { resolveNetwork = resolve; }));
  const pending = app.api.load();
  assert.equal(app.api.load(), pending, "Repeated entry should share one request");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.get("contactContentTitle").textContent, "News", "Saved content should show before the network reply");
  assert.equal(app.elements.get("contactContent").hidden, false);
  assert.equal(app.requests, 1);
  resolveNetwork(response({ schemaVersion: 1, revision: "2", enabled: false }));
  await pending;
  assert.equal(app.elements.get("contactContent").hidden, true);
  assert.equal(app.saved.enabled, false, "Remote disablement must persist");

  app.setResponse(() => response({ schemaVersion: 2, revision: "3", enabled: true, title: "Bad" }));
  await app.api.load();
  assert.equal(app.saved.enabled, false, "Invalid updates must preserve the saved disablement");
  assert.equal(app.elements.get("contactContent").hidden, true);

  const recovered = fixture(app.saved);
  recovered.setResponse(() => { throw new Error("offline"); });
  await recovered.api.load();
  assert.equal(recovered.elements.get("contactContent").hidden, true, "Offline opening must retain disablement");

  assert.equal(app.api.validate({ ...first, link: { label: "Unsafe", url: "javascript:alert(1)" } }).link, undefined);
  assert.equal(app.api.validate({ ...first, image: { url: "https://example.com/promo.png", alt: "Promo" } }).image, undefined);
  assert.equal(app.api.validate({ schemaVersion: 1, revision: "4", enabled: true }), null);
  console.log("Contact runtime checks passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
