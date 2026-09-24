const assert = require("node:assert/strict");
const { create, STORAGE_KEY, LICENSE_REVALIDATION_ALARM, OFFER } = require("./player-tools-commerce.js");
const receipts = require("./player-tools-receipts.js");
const TEST_PRIVATE_JWK = { key_ops: ["sign"], ext: true, kty: "EC", crv: "P-256", kid: "test",
  x: "POjVy608n7L_eb54dyb3j3hdpyAxGRDKWrPxsOS9T5I", y: "LAmnDD5wB4BRrD_ef7rgC15WV4Fjbw9E89WiiOESZLE",
  d: "q2EVMOSYa812n-xfGNUhe8F1RSm6_d4iUdk8jCAh7qs" };
const TEST_PUBLIC_JWK = { key_ops: ["verify"], ext: true, kty: "EC", crv: "P-256", kid: "test",
  x: TEST_PRIVATE_JWK.x, y: TEST_PRIVATE_JWK.y };

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function receipt(claims) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("jwk", TEST_PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload));
  return { algorithm: "ES256", keyId: "test", payload, signature: base64Url(signature) };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

(async () => {
  const wrongKeyId = await receipt({ version: 1, type: "pro", installationId: "installation-1234",
    licenseId: "license", instanceId: "instance", issuedAt: 1, expiresAt: 2 });
  wrongKeyId.keyId = "retired-key";
  await assert.rejects(receipts.verify(wrongKeyId, { publicJwk: { keys: [TEST_PUBLIC_JWK] } }),
    { code: "receipt-key-unknown" });
  let data = {};
  const calls = [];
  const entitlements = [];
  const alarmOperations = [];
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
    const pro = async () => ({ active: true, licenseId: "license-1", instanceId: "instance-1",
      receipt: await receipt({ version: 1, type: "pro", installationId: data[STORAGE_KEY].installationId,
        licenseId: "license-1", instanceId: "instance-1", capabilities: ["pro"], issuedAt: clock, expiresAt: clock + 30 * 86400000 }) });
    if (url.endsWith("/license/restore")) return response(200, await pro());
    if (url.endsWith("/checkout/claim")) return response(200, { ...(await pro()), pending: false });
    if (url.endsWith("/license/status")) return revoked
      ? response(403, { active: false, error: "license_revoked" })
      : response(200, await pro());
    if (url.endsWith("/events")) return response(200, { accepted: true });
    return response(404, { error: "not_found" });
  };
  let id = 0;
  const commerce = create({ storage, sessionStorage, request, apiBaseUrl: "https://api.example", now: () => clock,
    entitlementPublicJwk: { keys: [TEST_PUBLIC_JWK] },
    alarms: {
      async create(name, options) { alarmOperations.push({ type: "create", name, options }); },
      async clear(name) { alarmOperations.push({ type: "clear", name }); },
    },
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
  const claimed = await commerce.claimCheckout();
  assert.equal(claimed.status, "active");
  assert.equal(data[STORAGE_KEY].activation.instanceId, "instance-1");

  const active = await commerce.activate({ email: "Buyer@Example.com", licenseKey: " key-1 " });
  assert.equal(active.status, "active");
  assert.equal(data[STORAGE_KEY].activation.instanceId, "instance-1");
  assert.equal(data[STORAGE_KEY].licenseKey, undefined, "license keys are never persisted by the extension");
  assert.equal(entitlements.at(-1).status, "active");
  assert.deepEqual(alarmOperations.at(-1), { type: "create", name: LICENSE_REVALIDATION_ALARM,
    options: { when: clock + 30 * 86400000 } });

  await commerce.activate({ email: "buyer@example.com", licenseKey: "license-key" });

  clock += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await commerce.getState({ revalidate: true })).status, "active");
  assert.equal(data[STORAGE_KEY].activation.lastCheckedAt, clock);
  revoked = true;
  clock += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await commerce.getState({ revalidate: true })).status, "revoked");
  assert.equal(entitlements.at(-1).status, "free", "refund/revocation removes Pro without deleting commerce identity");
  assert.deepEqual(alarmOperations.at(-1), { type: "clear", name: LICENSE_REVALIDATION_ALARM });
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

  let emptyData = {};
  const emptyCommerce = create({
    storage: {
      async get() { return structuredClone(emptyData); },
      async set(value) { emptyData = structuredClone(value); },
    },
    entitlementPublicJwk: TEST_PUBLIC_JWK,
    randomUUID: () => "00000000-0000-4000-8000-000000000101",
    access: { async setEntitlement() { assert.fail("an empty response must never grant Pro"); } },
    request: async () => response(200, {}),
  });
  await assert.rejects(emptyCommerce.activate({ email: "buyer@example.com", licenseKey: "license-key" }),
    { code: "invalid-entitlement" });

  let localIdentity = {}; let syncedIdentity = { [require("./player-tools-commerce.js").IDENTITY_KEY]: "legacy_profile_123456" };
  const identityAccessLevels = [];
  const migratedCommerce = create({
    storage: { async get() { return {}; }, async set() {} },
    identityStorage: {
      async get() { return structuredClone(localIdentity); },
      async set(value) { localIdentity = { ...localIdentity, ...structuredClone(value) }; },
      async setAccessLevel(value) { identityAccessLevels.push(value); },
    },
    legacyIdentityStorage: { async get() { return structuredClone(syncedIdentity); } },
    access: { async setEntitlement() {} },
  });
  await migratedCommerce.getState();
  assert.equal(localIdentity[require("./player-tools-commerce.js").IDENTITY_KEY], "legacy_profile_123456");
  assert.deepEqual(identityAccessLevels.at(-1), { accessLevel: "TRUSTED_CONTEXTS" });

  let guardedData = {}; let statusCalls = 0; let guardedClock = 2_000_000_000_000;
  const guardedCommerce = create({
    storage: { async get() { return structuredClone(guardedData); }, async set(value) { guardedData = structuredClone(value); } },
    identityStorage: { async get() { return {}; }, async set() {} },
    now: () => guardedClock,
    entitlementPublicJwk: { keys: [TEST_PUBLIC_JWK] },
    randomUUID: () => "guardedprofile1234567890",
    access: { async setEntitlement() {} },
    request: async (url) => {
      const result = { active: true, serverTime: guardedClock, licenseId: "guarded-license", instanceId: "guarded-instance",
        receipt: await receipt({ version: 1, type: "pro", installationId: "guardedprofile1234567890",
          licenseId: "guarded-license", instanceId: "guarded-instance", capabilities: ["pro"],
          issuedAt: guardedClock, expiresAt: guardedClock + 30 * 86400000 }) };
      if (url.endsWith("/license/restore")) return response(200, result);
      statusCalls += 1; return response(200, result);
    },
  });
  await guardedCommerce.activate({ email: "buyer@example.com", licenseKey: "license-key" });
  const oldEntitlement = { status: "active", licenseId: "guarded-license", checkedAt: guardedClock,
    expiresAt: guardedData[STORAGE_KEY].activation.receiptExpiresAt, receipt: guardedData[STORAGE_KEY].activation.receipt };
  guardedClock += 31 * 86400000;
  const renewed = await Promise.all(Array.from({ length: 10 }, () => guardedCommerce.ensureEntitlement(oldEntitlement)));
  assert.equal(renewed.every((item) => item.status === "active"), true);
  assert.equal(statusCalls, 1, "concurrent expired guards share one effective renewal");
  const renewedEntitlement = renewed.at(-1).entitlement;
  guardedClock += 10 * 60000;
  assert.equal(await guardedCommerce.validateEntitlement(renewedEntitlement), true);
  guardedClock -= 20 * 60000;
  assert.equal(await guardedCommerce.validateEntitlement(renewedEntitlement), false,
    "a clock rollback beyond tolerance never restores offline Pro");

  const broken = create({ storage: { async get() { return { [STORAGE_KEY]: null }; } }, request, access: { setEntitlement() {} } });
  await assert.rejects(broken.getState(), { code: "commerce-state-invalid" });
  console.log("Player Tools commerce lifecycle verification passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
