import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.mjs";

const installationId = "installation_1234567890";
const env = {
  ALLOWED_ORIGINS: "chrome-extension://test-extension",
  LEMON_API_KEY: "test-key",
  LEMON_WEBHOOK_SECRET: "test-secret",
  LEMON_STORE_ID: "1",
  LEMON_PRODUCT_ID: "2",
  LEMON_VARIANT_ID: "3",
  LEMON_MODE: "test",
  ENTITLEMENT_KEY_ID: "test-p256-1",
  ADMIN_TOKEN: "test-admin-token-with-sufficient-length",
  ENTITLEMENT_PRIVATE_JWK: JSON.stringify({ key_ops: ["sign"], ext: true, kty: "EC",
    x: "POjVy608n7L_eb54dyb3j3hdpyAxGRDKWrPxsOS9T5I", y: "LAmnDD5wB4BRrD_ef7rgC15WV4Fjbw9E89WiiOESZLE",
    crv: "P-256", d: "q2EVMOSYa812n-xfGNUhe8F1RSm6_d4iUdk8jCAh7qs" }),
};

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function db() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values });
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null };
        },
      };
    },
    batch: async (items) => Promise.all(items.map((item) => item.run())),
  };
}
function request(path, body) {
  return new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: { origin: "chrome-extension://test-extension", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function sqliteD1() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of fs.readdirSync(path.join(serviceRoot, "migrations")).sort()) {
    database.exec(fs.readFileSync(path.join(serviceRoot, "migrations", name), "utf8"));
  }
  function wrap(sql) {
    let values = [];
    return {
      bind(...nextValues) { values = nextValues; return this; },
      async run() {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
      async first() { return database.prepare(sql).get(...values) || null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
    };
  }
  return {
    database,
    prepare: wrap,
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
function activationResponse() {
  return {
    activated: true,
    license_key: { id: "license-1", key: "license-key", status: "active", expires_at: null },
    instance: { id: "instance-1", name: installationId },
    meta: { store_id: 1, product_id: 2, variant_id: 3, order_id: 4, customer_id: 5, customer_email: "buyer@example.com" },
  };
}
function managementLicense({ status = "active", disabled = 0 } = {}) {
  return { data: { type: "license-keys", id: "license-1", attributes: {
    store_id: 1, product_id: 2, user_email: "buyer@example.com", status, disabled, expires_at: null,
  } } };
}
function managementLicenseList() {
  return { data: [{ type: "license-keys", id: "license-1", attributes: {
    store_id: 1, customer_id: 5, order_id: 4, product_id: 2,
    user_email: "buyer@example.com", key: "license-key", status: "inactive", disabled: 0,
  } }] };
}
function validationResponse() {
  return new Response(JSON.stringify({ ...activationResponse(), valid: true, activated: undefined, instance: undefined }));
}
function automaticActivationFetch(url) {
  if (String(url).endsWith("/licenses/validate")) return validationResponse();
  if (String(url).endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense()));
  if (String(url).includes("/license-key-instances?")) return new Response(JSON.stringify(managementInstances()));
  if (String(url).includes("/license-keys?filter%5Border_id%5D=4")) {
    return new Response(JSON.stringify(managementLicenseList()), { status: 200 });
  }
  if (String(url).endsWith("/licenses/activate")) {
    return new Response(JSON.stringify(activationResponse()), { status: 200 });
  }
  throw new Error(`unexpected Lemon URL ${url}`);
}
function managementInstances({ present = true } = {}) {
  return { data: present ? [{ type: "license-key-instances", id: "1", attributes: {
    identifier: "instance-1", name: installationId,
  } }] : [] };
}
async function signature(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.sign("HMAC", key, bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}
async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashed), (item) => item.toString(16).padStart(2, "0")).join("");
}

test("test mode accepts both known extension origins and rejects unknown origins", async () => {
  const unpackedOrigin = "chrome-extension://oopghidjdmcbbfkicnlcfjlmifjldmli";
  const priorOrigin = "chrome-extension://hccfkgjcaigahlnmobpjdhcbhkejkack";
  const testRequest = new Request("https://worker.example/api/player-tools/trial/start", {
    method: "POST",
    headers: { origin: unpackedOrigin, "content-type": "application/json" },
    body: JSON.stringify({ installationId }),
  });
  const accepted = await worker.fetch(testRequest, {
    ...env,
    ALLOWED_ORIGINS: `${priorOrigin},${unpackedOrigin}`,
    LICENSE_DB: sqliteD1(),
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("access-control-allow-origin"), unpackedOrigin);

  const priorRequest = new Request("https://worker.example/api/player-tools/trial/start", {
    method: "POST",
    headers: { origin: priorOrigin, "content-type": "application/json" },
    body: JSON.stringify({ installationId }),
  });
  const priorAccepted = await worker.fetch(priorRequest, {
    ...env,
    ALLOWED_ORIGINS: `${priorOrigin},${unpackedOrigin}`,
    LICENSE_DB: sqliteD1(),
  });
  assert.equal(priorAccepted.status, 200);

  const unknown = new Request("https://worker.example/api/player-tools/trial/start", {
    method: "POST",
    headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "content-type": "application/json" },
    body: JSON.stringify({ installationId }),
  });
  const rejected = await worker.fetch(unknown, {
    ...env,
    ALLOWED_ORIGINS: `${priorOrigin},${unpackedOrigin}`,
    LICENSE_DB: sqliteD1(),
  });
  assert.equal(rejected.status, 403);
});
function orderWebhook(eventName, overrides = {}) {
  return {
    meta: { event_name: eventName, custom_data: { installation_id: installationId } },
    data: { type: "orders", id: "4", attributes: {
      store_id: 1,
      customer_id: 5,
      user_email: "buyer@example.com",
      total: 369,
      refunded_amount: 0,
      refunded: false,
      status: "paid",
      test_mode: true,
      created_at: "2026-09-20T10:00:00.000Z",
      updated_at: "2026-09-20T10:00:00.000Z",
      first_order_item: { product_id: 2, variant_id: 3, test_mode: true },
      ...overrides,
    } },
  };
}
async function sendWebhook(LICENSE_DB, payload) {
  const body = JSON.stringify(payload);
  return worker.fetch(new Request("https://worker.example/api/player-tools/webhooks/lemon", {
    method: "POST", headers: { "x-signature": await signature(env.LEMON_WEBHOOK_SECRET, body) }, body,
  }), { ...env, LICENSE_DB });
}

test("a wrong email or product never consumes a remote activation", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  for (const meta of [{ customer_email: "other@example.com" }, { variant_id: 999 }]) {
    const LICENSE_DB = sqliteD1();
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      const value = activationResponse();
      return new Response(JSON.stringify({ ...value, valid: true, meta: { ...value.meta, ...meta } }));
    };
    const result = await worker.fetch(request("/api/player-tools/license/activate", {
      installationId, email: "buyer@example.com", licenseKey: "license-key",
    }), { ...env, LICENSE_DB });
    assert.equal(result.status, 403);
    assert.ok(calls.every(url => url.endsWith("/licenses/validate")));
    assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 0);
  }
});

test("inactive license updates preserve a lifetime purchase", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const LICENSE_DB = sqliteD1();
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created"))).status, 200);
  assert.equal((await sendWebhook(LICENSE_DB, {
    meta: { event_name: "license_key_updated" },
    data: { type: "license-keys", id: "license-1", attributes: {
      store_id: 1, product_id: 2, status: "inactive", disabled: 0, expires_at: null,
    } },
  })).status, 200);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses").get().status, "active");
});

test("checkout claims reconcile revocations even if a webhook was missed", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const LICENSE_DB = sqliteD1();
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created"))).status, 200);
  globalThis.fetch = async () => new Response(JSON.stringify(managementLicense({ status: "disabled", disabled: 1 })));
  const result = await worker.fetch(request("/api/player-tools/checkout/claim", { installationId }), { ...env, LICENSE_DB });
  assert.equal((await result.json()).active, false);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses").get().status, "revoked");
});

test("unpaid orders cannot auto-activate and provider pagination cannot leak the API key", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const LICENSE_DB = sqliteD1();
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created", { status: "pending" }))).status, 400);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM licenses").get().count, 0);
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created"))).status, 200);
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(url.includes("/license-key-instances?")
      ? { data: [], links: { next: "https://attacker.example/steal" } } : managementLicense()));
  };
  const result = await worker.fetch(request("/api/player-tools/license/status", { installationId, instanceId: "instance-1" }), { ...env, LICENSE_DB });
  assert.equal(result.status, 500);
  assert.ok(calls.every(url => new URL(url).origin === "https://api.lemonsqueezy.com"));
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses").get().status, "active");
});

test("activation persists Lemon license, instance and metadata from their documented sibling objects", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify(activationResponse()), { status: 200 });
  const LICENSE_DB = db();
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "Buyer@Example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.active, true);
  assert.equal(body.licenseId, "license-1");
  assert.equal(body.instanceId, "instance-1");
  assert.equal(body.receipt.algorithm, "ES256");
  const licenseInsert = LICENSE_DB.statements.find((statement) => statement.sql.includes("INSERT INTO licenses"));
  assert.equal(licenseInsert.values[1], "4");
  assert.equal(licenseInsert.values[2], "5");
  const activationInsert = LICENSE_DB.statements.find((statement) => statement.sql.includes("INSERT INTO activations"));
  assert.equal(activationInsert.values[0], "instance-1");
});

test("activation fails closed for incomplete or mismatched provider responses", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = db();
  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify({ ...activationResponse(), instance: null }), { status: 200 });
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { active: false, error: "activation_failed" });
  assert.ok(LICENSE_DB.statements.some((statement) => /INSERT INTO activation_operations/.test(statement.sql)));
  assert.ok(LICENSE_DB.statements.some((statement) => /DELETE FROM activation_operations/.test(statement.sql)));
});

test("two concurrent profiles reserve the only seats atomically and a third never reaches Lemon", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let providerCalls = 0;
  globalThis.fetch = async (_url, options) => {
    if (_url.endsWith("/licenses/validate")) return validationResponse();
    providerCalls += 1;
    const installation = new URLSearchParams(options.body).get("instance_name");
    return new Response(JSON.stringify({ ...activationResponse(), instance: { id: `instance-${installation}`, name: installation } }), { status: 200 });
  };
  const profiles = ["profile_0000000001", "profile_0000000002", "profile_0000000003"];
  const responses = await Promise.all(profiles.map((profile) => worker.fetch(request("/api/player-tools/license/activate", {
    installationId: profile, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 409]);
  assert.equal(providerCalls, 2);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations WHERE state='active'").get().count, 2);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations WHERE deactivated_at IS NULL").get().count, 2);
});

test("a duplicate activation waits for its durable operation and retry reuses the same seat", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let providerCalls = 0;
  let resolveProvider;
  let resolveProviderStarted;
  const providerResult = new Promise((resolve) => { resolveProvider = resolve; });
  const providerStarted = new Promise((resolve) => { resolveProviderStarted = resolve; });
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    providerCalls += 1;
    resolveProviderStarted();
    await providerResult;
    return new Response(JSON.stringify(activationResponse()), { status: 200 });
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  const first = worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  await providerStarted;
  const duplicate = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { active: false, error: "activation_in_progress" });
  assert.equal(providerCalls, 1);
  resolveProvider();
  assert.equal((await first).status, 200);
  const retry = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(retry.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 1);
});

test("an idempotent activation never ignores a mismatched email", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let providerCalls = 0;
  globalThis.fetch = async (url) => { if (url.endsWith("/licenses/validate")) return validationResponse(); providerCalls += 1; return new Response(JSON.stringify(activationResponse()), { status: 200 }); };
  const valid = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  assert.equal((await worker.fetch(request("/api/player-tools/license/activate", valid), { ...env, LICENSE_DB })).status, 200);
  const mismatch = await worker.fetch(request("/api/player-tools/license/activate", {
    ...valid, email: "someone-else@example.com",
  }), { ...env, LICENSE_DB });
  assert.equal(mismatch.status, 403);
  assert.deepEqual(await mismatch.json(), { active: false, error: "activation_failed" });
  assert.equal(providerCalls, 1, "credential mismatch must fail locally without another provider effect");
});

test("a D1 interruption after Lemon activation is retried through the original reservation", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  const originalBatch = LICENSE_DB.batch.bind(LICENSE_DB);
  let failPersistence = true;
  LICENSE_DB.batch = async (statements) => {
    if (failPersistence) { failPersistence = false; throw new Error("simulated D1 interruption"); }
    return originalBatch(statements);
  };
  let providerCalls = 0;
  let activationCalls = 0;
  globalThis.fetch = async (url) => {
    providerCalls += 1;
    if (url.endsWith("/licenses/activate")) {
      activationCalls += 1;
      return new Response(JSON.stringify(activationResponse()), { status: 200 });
    }
    if (url.endsWith("/licenses/validate")) {
      return new Response(JSON.stringify({ ...activationResponse(), valid: true, activated: undefined, instance: undefined }), { status: 200 });
    }
    if (url.includes("/license-key-instances?")) return new Response(JSON.stringify(managementInstances()), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  const first = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(first.status, 409);
  assert.deepEqual(await first.json(), { active: false, error: "activation_in_progress" });
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 1);
  LICENSE_DB.database.prepare("UPDATE activation_operations SET lease_expires_at=0 WHERE installation_id=?").run(installationId);
  const retry = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(retry.status, 200);
  assert.equal(providerCalls, 4);
  assert.equal(activationCalls, 1, "recovery must reconcile the orphan instead of activating twice");
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations WHERE state='active'").get().count, 1);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations").get().count, 1);
});

test("status reconciles the local activation against Lemon license and instance records", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    if (url.endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense()), { status: 200 });
    if (url.includes("/license-key-instances?")) return new Response(JSON.stringify(managementInstances()), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  const activation = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(activation.status, 200);
  const response = await worker.fetch(request("/api/player-tools/license/status", { installationId, instanceId: "instance-1" }), { ...env, LICENSE_DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.active, true);
  assert.equal(body.licenseId, "license-1");
  assert.equal(body.instanceId, "instance-1");
  assert.equal(body.receipt.algorithm, "ES256");
  assert.ok(LICENSE_DB.database.prepare("SELECT last_validated_at FROM activations WHERE lemon_instance_id='instance-1'").get().last_validated_at > 0);
});

test("status deactivates only the missing remote instance and preserves the purchase", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    if (url.endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense()), { status: 200 });
    if (url.includes("/license-key-instances?")) return new Response(JSON.stringify(managementInstances({ present: false })), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  const response = await worker.fetch(request("/api/player-tools/license/status", { installationId, instanceId: "instance-1" }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { active: false, error: "license_revoked" });
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_license_id='license-1'").get().status, "active");
  assert.ok(LICENSE_DB.database.prepare("SELECT deactivated_at FROM activations WHERE lemon_instance_id='instance-1'").get().deactivated_at > 0);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 0);
});

test("status never revokes an active local purchase merely because Lemon is unavailable", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    return new Response(JSON.stringify({ errors: [{ title: "temporary" }] }), { status: 500 });
  };
  await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  const response = await worker.fetch(request("/api/player-tools/license/status", { installationId, instanceId: "instance-1" }), { ...env, LICENSE_DB });
  assert.equal(response.status, 500);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_license_id='license-1'").get().status, "active");
});

test("provider authentication and schema errors never revoke local Pro", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  for (const status of [200, 401, 403, 408, 409, 422, 429, 500]) {
    const LICENSE_DB = sqliteD1();
    globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : url.endsWith("/licenses/activate")
      ? new Response(JSON.stringify(activationResponse()), { status: 200 })
      : new Response(JSON.stringify({ errors: [{ title: "provider error" }] }), { status });
    await worker.fetch(request("/api/player-tools/license/activate", {
      installationId, email: "buyer@example.com", licenseKey: "license-key",
    }), { ...env, LICENSE_DB });
    const response = await worker.fetch(request("/api/player-tools/license/status", {
      installationId, instanceId: "instance-1",
    }), { ...env, LICENSE_DB });
    assert.equal(response.status, 500, `provider ${status} is operational, not a revocation`);
    assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_license_id='license-1'").get().status, "active");
    assert.equal(LICENSE_DB.database.prepare("SELECT deactivated_at FROM activations WHERE lemon_instance_id='instance-1'").get().deactivated_at, null);
  }
});

test("instance reconciliation follows pagination", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    if (url.endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense()), { status: 200 });
    if (url.includes("page%5Bnumber%5D=2")) return new Response(JSON.stringify(managementInstances()), { status: 200 });
    if (url.includes("/license-key-instances?")) return new Response(JSON.stringify({ data: [], links: {
      next: "https://api.lemonsqueezy.com/v1/license-key-instances?filter%5Blicense_key_id%5D=license-1&page%5Bnumber%5D=2",
    } }), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  const response = await worker.fetch(request("/api/player-tools/license/status", {
    installationId, instanceId: "instance-1",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 200);
});

test("webhooks reject a validly signed order from another product before writing D1", async () => {
  const LICENSE_DB = db();
  const body = JSON.stringify({
    meta: { event_name: "order_created" }, data: { type: "orders", id: "order-1", attributes: {
      store_id: 1, test_mode: true, first_order_item: { product_id: 999, variant_id: 3, test_mode: true },
    } },
  });
  const response = await worker.fetch(new Request("https://worker.example/api/player-tools/webhooks/lemon", {
    method: "POST", headers: { "x-signature": await signature(env.LEMON_WEBHOOK_SECRET, body) }, body,
  }), { ...env, LEMON_MODE: "test", LICENSE_DB });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_webhook" });
  assert.equal(LICENSE_DB.statements.length, 0);
});

test("order_created activates the generated license and checkout claim returns a signed entitlement", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const LICENSE_DB = sqliteD1();

  const webhook = await sendWebhook(LICENSE_DB, orderWebhook("order_created"));
  assert.equal(webhook.status, 200);
  const activation = LICENSE_DB.database.prepare(`SELECT licenses.lemon_license_id, activations.lemon_instance_id,
    activations.installation_id FROM licenses JOIN activations USING(lemon_license_id)`).get();
  assert.equal(activation.lemon_license_id, "license-1");
  assert.equal(activation.lemon_instance_id, "instance-1");
  assert.equal(activation.installation_id, installationId);

  const claimed = await worker.fetch(request("/api/player-tools/checkout/claim", { installationId }), { ...env, LICENSE_DB });
  assert.equal(claimed.status, 200);
  const body = await claimed.json();
  assert.equal(body.active, true);
  assert.equal(body.pending, false);
  assert.equal(body.licenseId, "license-1");
  assert.equal(body.instanceId, "instance-1");
  assert.equal(body.receipt.algorithm, "ES256");
});

test("an order created outside the extension remains available for manual restore", async () => {
  const LICENSE_DB = sqliteD1();
  const payload = orderWebhook("order_created");
  delete payload.meta.custom_data;
  const webhook = await sendWebhook(LICENSE_DB, payload);
  assert.equal(webhook.status, 200);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_order_id='4'").get().status, "active");
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations").get().count, 0);
});

test("a full refund received before its order remains authoritative through delayed order and activation", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();

  const refund = orderWebhook("order_refunded", {
    refunded: true,
    refunded_amount: 369,
    refunded_at: "2026-09-21T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  });
  assert.equal((await sendWebhook(LICENSE_DB, refund)).status, 200);
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created"))).status, 200);

  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify(activationResponse()), { status: 200 });
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { active: false, error: "license_revoked" });

  const license = LICENSE_DB.database.prepare("SELECT lemon_license_id, status, revoked_at FROM licenses WHERE lemon_order_id='4'").get();
  assert.equal(license.lemon_license_id, "license-1");
  assert.equal(license.status, "revoked");
  assert.ok(license.revoked_at > 0);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations").get().count, 0);
});

test("a partial refund is recorded but does not automatically revoke Pro", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const LICENSE_DB = sqliteD1();
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_created"))).status, 200);
  const partialRefund = orderWebhook("order_refunded", {
    refunded_amount: 100,
    updated_at: "2026-09-21T10:00:00.000Z",
  });
  assert.equal((await sendWebhook(LICENSE_DB, partialRefund)).status, 200);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_order_id='4'").get().status, "active");
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM order_revocations").get().count, 0);
});

test("a refund tombstone blocks activation even when the order-created webhook never arrived", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_refunded", {
    refunded: true, refunded_amount: 369, updated_at: "2026-09-21T10:00:00.000Z",
  }))).status, 200);
  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify(activationResponse()), { status: 200 });
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "license_revoked");
  const license = LICENSE_DB.database.prepare("SELECT status, revoked_at FROM licenses WHERE lemon_order_id='4'").get();
  assert.equal(license.status, "revoked");
  assert.ok(license.revoked_at > 0);
});

test("restore reconciles an existing local activation before issuing another receipt", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/licenses/validate")) return validationResponse();
    if (String(url).endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    if (String(url).endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense({ status: "disabled", disabled: 1 })), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  assert.equal((await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB })).status, 200);
  const restored = await worker.fetch(request("/api/player-tools/license/restore", body), { ...env, LICENSE_DB });
  assert.equal(restored.status, 403);
  assert.equal((await restored.json()).error, "license_revoked");
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_license_id='license-1'").get().status, "revoked");
});

test("processed webhook delivery is idempotent and an overlapping delivery is retried", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = automaticActivationFetch;
  const processedDb = sqliteD1();
  const payload = orderWebhook("order_created");
  assert.equal((await sendWebhook(processedDb, payload)).status, 200);
  assert.equal((await sendWebhook(processedDb, payload)).status, 200);
  assert.equal(processedDb.database.prepare("SELECT processing_attempts FROM webhook_events").get().processing_attempts, 1);
  assert.equal(processedDb.database.prepare("SELECT COUNT(*) AS count FROM analytics_events").get().count, 1);

  const overlappingDb = sqliteD1();
  const raw = JSON.stringify(payload);
  overlappingDb.database.prepare(`INSERT INTO webhook_events
    (event_hash, event_name, received_at, payload, processing_started_at, processing_token, processing_attempts)
    VALUES (?, 'order_created', ?, ?, ?, 'owner-a', 1)`)
    .run(await digest(raw), Date.now(), raw, Date.now());
  const response = await sendWebhook(overlappingDb, payload);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), { error: "webhook_in_progress" });
});

test("webhook event header must agree with the signed body", async () => {
  const LICENSE_DB = sqliteD1();
  const body = JSON.stringify(orderWebhook("order_created"));
  const response = await worker.fetch(new Request("https://worker.example/api/player-tools/webhooks/lemon", {
    method: "POST",
    headers: { "x-signature": await signature(env.LEMON_WEBHOOK_SECRET, body), "x-event-name": "order_refunded" },
    body,
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_webhook" });
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM webhook_events").get().count, 0);
});

test("trial start and consumption are server-authoritative, idempotent and capped", async () => {
  const LICENSE_DB = sqliteD1();
  const start = await worker.fetch(request("/api/player-tools/trial/start", { installationId }), { ...env, LICENSE_DB });
  assert.equal(start.status, 200);
  const initial = await start.json();
  assert.equal(initial.trial.used, 0);
  assert.equal(initial.trial.expiresAt - initial.trial.startedAt, 7 * 24 * 60 * 60 * 1000);
  assert.equal(initial.receipt.algorithm, "ES256");

  for (let index = 0; index < 20; index += 1) {
    const consumed = await worker.fetch(request("/api/player-tools/trial/consume", {
      installationId, requestId: `trial_request_${String(index).padStart(3, "0")}`,
      trackIdentity: `track-${index}`,
    }), { ...env, LICENSE_DB });
    assert.equal(consumed.status, 200);
    assert.equal((await consumed.json()).trial.used, index + 1);
  }
  const replay = await worker.fetch(request("/api/player-tools/trial/consume", {
    installationId, requestId: "trial_request_000", trackIdentity: "track-0",
  }), { ...env, LICENSE_DB });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).trial.used, 20);
  const conflictingReplay = await worker.fetch(request("/api/player-tools/trial/consume", {
    installationId, requestId: "trial_request_000", trackIdentity: "different-track",
  }), { ...env, LICENSE_DB });
  assert.equal(conflictingReplay.status, 409);
  assert.equal((await conflictingReplay.json()).error, "trial_request_conflict");
  const exhausted = await worker.fetch(request("/api/player-tools/trial/consume", {
    installationId, requestId: "trial_request_999", trackIdentity: "track-999",
  }), { ...env, LICENSE_DB });
  assert.equal(exhausted.status, 409);
  assert.equal((await exhausted.json()).error, "trial_exhausted");
});

test("a refund removes active reservations and a repeated activation stays revoked", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let providerCalls = 0;
  globalThis.fetch = async (url) => { if (url.endsWith("/licenses/validate")) return validationResponse(); providerCalls += 1; return new Response(JSON.stringify(activationResponse()), { status: 200 }); };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  assert.equal((await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB })).status, 200);
  assert.equal((await sendWebhook(LICENSE_DB, orderWebhook("order_refunded", {
    refunded: true, refunded_amount: 369, updated_at: "2026-09-22T12:00:00.000Z",
  }))).status, 200);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 0);
  assert.equal((await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB })).status, 403);
  assert.equal(providerCalls, 1, "a known refund must fail before another provider activation");
});

test("support seat release requires admin auth and updates D1 only after Lemon confirms", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify(activationResponse()), { status: 200 });
    if (url.endsWith("/licenses/deactivate")) return new Response(JSON.stringify({ deactivated: true }), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  const activationBody = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  await worker.fetch(request("/api/player-tools/license/activate", activationBody), { ...env, LICENSE_DB });
  const adminRequest = (dryRun, token = env.ADMIN_TOKEN) => new Request("https://worker.example/api/player-tools/admin/release-seat", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ installationId, licenseKey: "license-key", dryRun }),
  });
  assert.equal((await worker.fetch(adminRequest(true, "wrong"), { ...env, LICENSE_DB })).status, 403);
  const preview = await worker.fetch(adminRequest(true), { ...env, LICENSE_DB });
  assert.equal((await preview.json()).dryRun, true);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 1);
  const applied = await worker.fetch(adminRequest(false), { ...env, LICENSE_DB });
  assert.equal((await applied.json()).released, true);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 0);
  assert.ok(LICENSE_DB.database.prepare("SELECT deactivated_at FROM activations WHERE lemon_instance_id='instance-1'").get().deactivated_at > 0);
});

test("reactivating a released profile replaces the stale Lemon instance everywhere", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let generation = 1;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/licenses/validate")) return validationResponse();
    if (url.endsWith("/licenses/activate")) return new Response(JSON.stringify({
      ...activationResponse(), instance: { id: `instance-${generation}`, name: installationId },
    }), { status: 200 });
    if (url.endsWith("/licenses/deactivate")) return new Response(JSON.stringify({ deactivated: true }), { status: 200 });
    if (url.endsWith("/license-keys/license-1")) return new Response(JSON.stringify(managementLicense()), { status: 200 });
    if (url.includes("/license-key-instances?")) return new Response(JSON.stringify({ data: [{
      type: "license-key-instances", id: "2", attributes: { identifier: "instance-2", name: installationId },
    }] }), { status: 200 });
    throw new Error(`unexpected Lemon URL ${url}`);
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  assert.equal((await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB })).status, 200);
  const release = new Request("https://worker.example/api/player-tools/admin/release-seat", {
    method: "POST", headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ installationId, licenseKey: "license-key", dryRun: false }),
  });
  assert.equal((await worker.fetch(release, { ...env, LICENSE_DB })).status, 200);
  generation = 2;
  const reactivated = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(reactivated.status, 200);
  assert.equal((await reactivated.json()).instanceId, "instance-2");
  const activation = LICENSE_DB.database.prepare("SELECT lemon_instance_id, deactivated_at FROM activations WHERE installation_id=?").get(installationId);
  assert.equal(activation.lemon_instance_id, "instance-2");
  assert.equal(activation.deactivated_at, null);
  assert.equal(LICENSE_DB.database.prepare("SELECT lemon_instance_id FROM activation_operations WHERE installation_id=?").get(installationId).lemon_instance_id, "instance-2");
  assert.equal((await worker.fetch(request("/api/player-tools/license/status", {
    installationId, instanceId: "instance-2",
  }), { ...env, LICENSE_DB })).status, 200);
});

test("public rate limiting returns a uniform retryable response before remote effects", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let providerCalls = 0;
  globalThis.fetch = async (url) => { if (url.endsWith("/licenses/validate")) return validationResponse(); providerCalls += 1; return new Response(JSON.stringify(activationResponse()), { status: 200 }); };
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB: sqliteD1(), LICENSE_RATE_LIMITER: { async limit() { return { success: false }; } } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), { error: "rate_limited" });
  assert.equal(providerCalls, 0);
});

test("admin inspection exposes activation state without returning the license key", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify(activationResponse()), { status: 200 });
  await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  const admin = new Request("https://worker.example/api/player-tools/admin/inspect-license", {
    method: "POST", headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ licenseKey: "license-key" }),
  });
  const response = await worker.fetch(admin, { ...env, LICENSE_DB });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.found, true);
  assert.equal(result.license.licenseId, "license-1");
  assert.equal(result.activations.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /license-key/);
});

test("a known disabled license update revokes every local activation", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  globalThis.fetch = async (url) => url.endsWith("/licenses/validate") ? validationResponse() : new Response(JSON.stringify(activationResponse()), { status: 200 });
  await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  const update = {
    meta: { event_name: "license_key_updated" },
    data: { type: "license-keys", id: "license-1", attributes: {
      store_id: 1, product_id: 2, status: "inactive", disabled: 1,
      updated_at: "2026-09-22T13:00:00.000Z",
    } },
  };
  assert.equal((await sendWebhook(LICENSE_DB, update)).status, 200);
  assert.equal(LICENSE_DB.database.prepare("SELECT status FROM licenses WHERE lemon_license_id='license-1'").get().status, "revoked");
  assert.ok(LICENSE_DB.database.prepare("SELECT deactivated_at FROM activations WHERE lemon_instance_id='instance-1'").get().deactivated_at > 0);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 0);
});
