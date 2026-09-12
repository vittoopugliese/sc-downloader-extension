import { MAX_BODY_BYTES, MAX_WEBHOOK_BYTES, validateActivation, validateCheckout, validateStatus } from "./validation.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const LEMON_API = "https://api.lemonsqueezy.com/v1";

function json(status, value, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extra } }); }
function now() { return Date.now(); }

async function readBody(request, limit) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } catch { return null; }
}

function originAllowed(request, env) { return request.headers.get("origin") === env.ALLOWED_ORIGIN; }
function equals(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0; for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
async function hmacHex(secret, bytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function lemonHeaders(env) { return { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${env.LEMON_API_KEY}` }; }
function matchesProduct(meta, env) {
  return String(meta?.store_id) === String(env.LEMON_STORE_ID)
    && String(meta?.product_id) === String(env.LEMON_PRODUCT_ID)
    && String(meta?.variant_id) === String(env.LEMON_VARIANT_ID);
}
async function lemonLicenseAction(path, fields) {
  const response = await fetch(`${LEMON_API}/licenses/${path}`, { method: "POST", headers: { Accept: "application/json" }, body: new URLSearchParams(fields) });
  if (!response.ok) return null;
  return response.json();
}
async function createCheckout(env, value) {
  const payload = { data: { type: "checkouts", attributes: { checkout_data: { custom: { installation_id: value.installationId } }, product_options: { redirect_url: "https://sctd.vpugliese.online/?view=player-tools" }, checkout_options: { button_color: "#ff5500", dark: true, embed: false, media: false, logo: true } }, relationships: { store: { data: { type: "stores", id: String(env.LEMON_STORE_ID) } }, variant: { data: { type: "variants", id: String(env.LEMON_VARIANT_ID) } } } } };
  const response = await fetch(`${LEMON_API}/checkouts`, { method: "POST", headers: lemonHeaders(env), body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Lemon checkout request failed (${response.status})`);
  const body = await response.json();
  return body?.data?.attributes?.url || null;
}
async function recordActivation(env, license, email, installationId) {
  const timestamp = now();
  const licenseId = String(license?.id || "");
  const instanceId = String(license?.instance?.id || "");
  const keyHash = await sha256Hex(String(license?.key || ""));
  if (!licenseId || !instanceId) throw new Error("Lemon returned an incomplete license activation.");
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(`INSERT INTO licenses (lemon_license_id, lemon_order_id, lemon_customer_id, lemon_key_hash, customer_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(lemon_license_id) DO UPDATE SET customer_email=excluded.customer_email, lemon_key_hash=excluded.lemon_key_hash, status='active', updated_at=excluded.updated_at`)
      .bind(licenseId, String(license?.order_id || "") || null, String(license?.customer_id || "") || null, keyHash, email, timestamp, timestamp),
    env.LICENSE_DB.prepare(`INSERT INTO activations (lemon_instance_id, lemon_license_id, installation_id, activated_at, last_validated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lemon_instance_id) DO UPDATE SET installation_id=excluded.installation_id, last_validated_at=excluded.last_validated_at, deactivated_at=NULL`)
      .bind(instanceId, licenseId, installationId, timestamp, timestamp),
  ]);
  return { licenseId, instanceId };
}
async function activate(env, value) {
  const result = await lemonLicenseAction("activate", { license_key: value.licenseKey, instance_name: value.installationId });
  if (!result?.activated || !matchesProduct(result.meta, env) || String(result.meta?.customer_email || "").toLowerCase() !== value.email) {
    return null;
  }
  return recordActivation(env, result.license_key, value.email, value.installationId);
}
async function status(env, value) {
  const activation = await env.LICENSE_DB.prepare(`SELECT licenses.lemon_license_id, licenses.status FROM activations JOIN licenses USING(lemon_license_id)
    WHERE activations.lemon_instance_id = ? AND activations.installation_id = ? AND activations.deactivated_at IS NULL`).bind(value.instanceId, value.installationId).first();
  if (!activation || activation.status !== "active") return { active: false };
  await env.LICENSE_DB.prepare("UPDATE activations SET last_validated_at = ? WHERE lemon_instance_id = ?").bind(now(), value.instanceId).run();
  return { active: true, licenseId: activation.lemon_license_id };
}
async function recordWebhook(env, payload, raw) {
  const eventName = String(payload?.meta?.event_name || "");
  const hash = await sha256Hex(raw);
  const inserted = await env.LICENSE_DB.prepare("INSERT INTO webhook_events (event_hash, event_name, received_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(event_hash) DO NOTHING")
    .bind(hash, eventName, now(), new TextDecoder().decode(raw)).run();
  if (Number(inserted.meta?.changes || 0) === 0) return;
  const attributes = payload?.data?.attributes || {};
  if (eventName === "order_created") {
    await env.LICENSE_DB.prepare(`INSERT INTO licenses (lemon_license_id, lemon_order_id, lemon_customer_id, customer_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(lemon_order_id) DO UPDATE SET customer_email=excluded.customer_email, status='active', updated_at=excluded.updated_at`)
      .bind(`order:${payload?.data?.id}`, String(payload?.data?.id || ""), String(attributes.customer_id || "") || null, String(attributes.user_email || attributes.customer_email || "").toLowerCase(), now(), now()).run();
  }
  if (eventName === "order_refunded") {
    await env.LICENSE_DB.prepare("UPDATE licenses SET status='revoked', revoked_at=?, updated_at=? WHERE lemon_order_id=?")
      .bind(now(), now(), String(payload?.data?.id || "")).run();
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/player-tools/health") return json(200, { service: "sctd-player-tools-license", status: env.LICENSE_DB && env.LEMON_API_KEY && env.LEMON_WEBHOOK_SECRET ? "ready" : "not-configured" });
      if (request.method === "POST" && url.pathname === "/api/player-tools/webhooks/lemon") {
        const raw = await readBody(request, MAX_WEBHOOK_BYTES);
        const signature = request.headers.get("x-signature") || "";
        if (!raw || !env.LEMON_WEBHOOK_SECRET || !equals(signature, await hmacHex(env.LEMON_WEBHOOK_SECRET, raw))) return json(403, { error: "invalid_signature" });
        let payload; try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "invalid_payload" }); }
        await recordWebhook(env, payload, raw);
        return json(200, { received: true });
      }
      if (!originAllowed(request, env)) return json(403, { error: "origin_not_allowed" });
      const raw = await readBody(request, MAX_BODY_BYTES);
      let body; try { body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { body = null; }
      if (request.method === "POST" && url.pathname === "/api/player-tools/checkout") {
        const parsed = validateCheckout(body); if (!parsed.ok) return json(400, { error: parsed.error });
        const checkoutUrl = await createCheckout(env, parsed.value); return json(200, { checkoutUrl });
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/activate") {
        const parsed = validateActivation(body); if (!parsed.ok) return json(400, { error: parsed.error });
        const entitlement = await activate(env, parsed.value); return entitlement ? json(200, { active: true, ...entitlement }) : json(403, { active: false, error: "activation_failed" });
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/status") {
        const parsed = validateStatus(body); if (!parsed.ok) return json(400, { error: parsed.error });
        return json(200, await status(env, parsed.value));
      }
      return json(404, { error: "not_found" });
    } catch (error) {
      console.error(JSON.stringify({ message: "player-tools license request failed", error: error instanceof Error ? error.message : String(error) }));
      return json(500, { error: "internal_error" });
    }
  },
};
