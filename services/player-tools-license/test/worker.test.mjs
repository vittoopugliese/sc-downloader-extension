import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.mjs";

const installationId = "installation_1234567890";
const env = {
  ALLOWED_ORIGINS: "chrome-extension://test-extension",
  LEMON_API_KEY: "test-key",
  LEMON_WEBHOOK_SECRET: "test-secret",
  LEMON_STORE_ID: "1",
  LEMON_PRODUCT_ID: "2",
  LEMON_VARIANT_ID: "3",
};

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
  assert.equal(LICENSE_DB.statements.length, 0);
});

test("webhooks reject a validly signed order from another product before writing D1", async () => {
  const LICENSE_DB = db();
  const body = JSON.stringify({
    meta: { event_name: "order_created" }, data: { type: "orders", id: "order-1", attributes: {
      store_id: 1, product_id: 999, variant_id: 3, test_mode: true,
    } },
  });
  const response = await worker.fetch(new Request("https://worker.example/api/player-tools/webhooks/lemon", {
    method: "POST", headers: { "x-signature": await signature(env.LEMON_WEBHOOK_SECRET, body) }, body,
  }), { ...env, LEMON_MODE: "test", LICENSE_DB });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_webhook" });
  assert.equal(LICENSE_DB.statements.length, 0);
});
