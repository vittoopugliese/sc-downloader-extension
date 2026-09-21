const assert = require("node:assert/strict");
const { create, STORAGE_KEY, OFFER } = require("./player-tools-commerce.js");

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

(async () => {
  let data = {};
  const calls = [];
  const entitlements = [];
  let entitlementConfirmed = false;
  let clock = 1_800_000_000_000;
  let revoked = false;
  const storage = {
    async get() { return structuredClone(data); },
    async set(value) { data = structuredClone(value); },
  };
  let sessionData = {};
  const sessionStorage = {
    async get() { return structuredClone(sessionData); },
    async set(value) { sessionData = structuredClone(value); },
  };
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("/checkout")) return response(200, { checkoutUrl: "https://store.example/checkout/1" });
    if (url.endsWith("/license/restore")) return response(200, { active: true, licenseId: "license-1", instanceId: "instance-1" });
    if (url.endsWith("/license/status")) return revoked
      ? response(403, { active: false, error: "license_revoked" })
      : response(200, { active: true, licenseId: "license-1" });
    if (url.endsWith("/events")) return response(200, { accepted: true });
    return response(404, { error: "not_found" });
  };
  let id = 0;
  const commerce = create({ storage, sessionStorage, request, apiBaseUrl: "https://api.example", now: () => clock,
    version: "1.2.3", randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    access: { async setEntitlement(value) {
      entitlements.push(value);
      entitlementConfirmed = value.status === "active";
    } } });

  const initial = await commerce.getState();
  assert.equal(initial.status, "free");
  assert.deepEqual(initial.offer, OFFER);
  assert.match(data[STORAGE_KEY].installationId, /^[a-zA-Z0-9_-]{16,128}$/);
  const checkout = await commerce.startCheckout("es-AR");
  assert.equal(checkout.status, "pending");
  assert.equal(checkout.checkoutUrl, "https://store.example/checkout/1");
  assert.equal(calls.at(-1).body.locale, "es-AR");

  const active = await commerce.activate({ email: "Buyer@Example.com", licenseKey: " key-1 " });
  assert.equal(active.status, "active");
  assert.equal(data[STORAGE_KEY].activation.instanceId, "instance-1");
  assert.equal(data[STORAGE_KEY].licenseKey, undefined, "license keys are never persisted by the extension");
  assert.equal(entitlements.at(-1).status, "active");

  const callsBeforeTestLogin = calls.length;
  const tested = await commerce.activateTest({ username: "1", password: "1" });
  assert.equal(tested.status, "active");
  assert.equal(tested.licenseId, "test-pro");
  assert.equal(data[STORAGE_KEY].activation.instanceId, "local-test");
  assert.equal(calls.length, callsBeforeTestLogin, "test login stays local");
  entitlementConfirmed = false; // Simulate access state lost or left stale across an extension reload.
  assert.equal((await commerce.getState({ revalidate: true })).status, "active");
  assert.equal(entitlementConfirmed, true, "test Pro state must re-confirm the shared Player Tools entitlement");
  assert.equal(calls.length, callsBeforeTestLogin, "test Pro does not revalidate against the license service");
  await assert.rejects(() => commerce.activateTest({ username: "x", password: "x" }), { code: "test_login_failed" });
  const freeAgain = await commerce.deactivateTest();
  assert.equal(freeAgain.status, "free");
  assert.equal(data[STORAGE_KEY].activation, null);
  assert.equal(entitlements.at(-1).status, "free");

  await commerce.activate({ email: "buyer@example.com", licenseKey: "license-key" });

  clock += 1000;
  assert.equal((await commerce.getState({ revalidate: true })).status, "active");
  assert.equal(data[STORAGE_KEY].activation.lastCheckedAt, clock);
  revoked = true;
  assert.equal((await commerce.getState({ revalidate: true })).status, "revoked");
  assert.equal(entitlements.at(-1).status, "free", "refund/revocation removes Pro without deleting commerce identity");
  revoked = false;
  assert.equal(await commerce.track("player_tools_promo_seen", { surface: "popup", trackUrl: "must-not-leak" }, { once: true }), true);
  assert.equal(await commerce.track("player_tools_promo_seen", { surface: "popup" }, { once: true }), false);
  assert.equal(await commerce.track("paywall_seen", { surface: "popup", cause: "trial-expired" }, { once: true, scope: "session" }), true);
  assert.equal(await commerce.track("paywall_seen", { surface: "popup", cause: "trial-expired" }, { once: true, scope: "session" }), false);
  const event = calls.find((call) => call.url.endsWith("/events"));
  assert.deepEqual(event.body.properties, { surface: "popup" });
  assert.equal(event.body.offer, OFFER.version);
  assert.equal(await commerce.track("unknown_event", {}), false);

  let timeoutData = {};
  let timeoutCalls = 0;
  let timeoutAborted = false;
  const timeoutCommerce = create({
    storage: {
      async get() { return structuredClone(timeoutData); },
      async set(value) { timeoutData = structuredClone(value); },
    },
    requestTimeoutMs: 20,
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
    access: { async setEntitlement() {} },
    request: async (_url, options) => {
      timeoutCalls += 1;
      if (timeoutCalls === 1) {
        options.signal.addEventListener("abort", () => { timeoutAborted = true; });
        return new Promise(() => {});
      }
      return response(200, { checkoutUrl: "https://store.example/checkout/recovered" });
    },
  });
  await assert.rejects(timeoutCommerce.startCheckout("en"), { code: "network-timeout" });
  assert.equal(timeoutAborted, true);
  assert.equal((await timeoutCommerce.startCheckout("en")).checkoutUrl,
    "https://store.example/checkout/recovered", "A timed-out POST must not leave the commerce queue blocked");

  let oversizedData = {};
  let responseCancelled = false;
  const oversizedCommerce = create({
    storage: {
      async get() { return structuredClone(oversizedData); },
      async set(value) { oversizedData = structuredClone(value); },
    },
    maxResponseBytes: 8,
    randomUUID: () => "00000000-0000-4000-8000-000000000100",
    access: { async setEntitlement() {} },
    request: async () => ({
      ok: true, status: 200,
      headers: { get: name => name === "Content-Length" ? "9" : null },
      body: { cancel: async () => { responseCancelled = true; } },
    }),
  });
  await assert.rejects(oversizedCommerce.startCheckout("en"), { code: "response-too-large" });
  assert.equal(responseCancelled, true);

  const broken = create({ storage: { async get() { return { [STORAGE_KEY]: null }; } }, request, access: { setEntitlement() {} } });
  await assert.rejects(broken.getState(), { code: "commerce-state-invalid" });
  console.log("Player Tools commerce lifecycle verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
