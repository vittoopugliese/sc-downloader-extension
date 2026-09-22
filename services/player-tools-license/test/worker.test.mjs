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

test("activation persists Lemon license, instance and metadata from their documented sibling objects", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify(activationResponse()), { status: 200 });
  const LICENSE_DB = db();
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "Buyer@Example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { active: true, licenseId: "license-1", instanceId: "instance-1" });
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
  globalThis.fetch = async () => new Response(JSON.stringify({ ...activationResponse(), instance: null }), { status: 200 });
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { active: false, error: "activation_failed" });
  assert.equal(LICENSE_DB.statements.length, 1);
  assert.match(LICENSE_DB.statements[0].sql, /INSERT INTO activation_operations/);
});

test("two concurrent profiles reserve the only seats atomically and a third never reaches Lemon", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const LICENSE_DB = sqliteD1();
  let providerCalls = 0;
  globalThis.fetch = async (_url, options) => {
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
  const providerResult = new Promise((resolve) => { resolveProvider = resolve; });
  globalThis.fetch = async () => {
    providerCalls += 1;
    await providerResult;
    return new Response(JSON.stringify(activationResponse()), { status: 200 });
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  const first = worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify(activationResponse()), { status: 200 });
  };
  const body = { installationId, email: "buyer@example.com", licenseKey: "license-key" };
  const first = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(first.status, 409);
  assert.deepEqual(await first.json(), { active: false, error: "activation_in_progress" });
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations").get().count, 1);
  LICENSE_DB.database.prepare("UPDATE activation_operations SET lease_expires_at=0 WHERE installation_id=?").run(installationId);
  const retry = await worker.fetch(request("/api/player-tools/license/activate", body), { ...env, LICENSE_DB });
  assert.equal(retry.status, 200);
  assert.equal(providerCalls, 2);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activation_operations WHERE state='active'").get().count, 1);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations").get().count, 1);
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

  globalThis.fetch = async () => new Response(JSON.stringify(activationResponse()), { status: 200 });
  const response = await worker.fetch(request("/api/player-tools/license/activate", {
    installationId, email: "buyer@example.com", licenseKey: "license-key",
  }), { ...env, LICENSE_DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { active: false, error: "activation_failed" });

  const license = LICENSE_DB.database.prepare("SELECT lemon_license_id, status, revoked_at FROM licenses WHERE lemon_order_id='4'").get();
  assert.equal(license.lemon_license_id, "license-1");
  assert.equal(license.status, "revoked");
  assert.ok(license.revoked_at > 0);
  assert.equal(LICENSE_DB.database.prepare("SELECT COUNT(*) AS count FROM activations").get().count, 0);
});

test("a partial refund is recorded but does not automatically revoke Pro", async () => {
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

test("processed webhook delivery is idempotent and an overlapping delivery is retried", async () => {
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
