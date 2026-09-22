import { MAX_BODY_BYTES, MAX_WEBHOOK_BYTES, validateActivation, validateCheckout, validateEvent, validateStatus } from "./validation.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const LEMON_API = "https://api.lemonsqueezy.com/v1";
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const PROVIDER_TIMEOUT_MS = 12_000;

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

async function readJsonResponse(response, limit = MAX_PROVIDER_RESPONSE_BYTES) {
  const declaredValue = response.headers.get("content-length");
  const declared = declaredValue == null ? null : Number(declaredValue);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("Lemon returned an oversized response.");
  }
  if (!response.body) throw new Error("Lemon returned an unreadable response.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || size + value.byteLength > limit) {
        await reader.cancel();
        throw new Error("Lemon returned an oversized response.");
      }
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  const configured = String(env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : null;
}
function cors(origin) {
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "Origin" };
}
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
function matchesWebhookOrder(attributes, env) {
  const item = attributes?.first_order_item;
  const expectedTestMode = String(env.LEMON_MODE || "") === "test";
  return String(attributes?.store_id) === String(env.LEMON_STORE_ID)
    && String(item?.product_id) === String(env.LEMON_PRODUCT_ID)
    && String(item?.variant_id) === String(env.LEMON_VARIANT_ID)
    && typeof attributes?.test_mode === "boolean"
    && attributes.test_mode === expectedTestMode;
}
function isFullRefund(attributes) {
  if (attributes?.refunded === true) return true;
  const total = Number(attributes?.total);
  const refunded = Number(attributes?.refunded_amount);
  return Number.isFinite(total) && total > 0 && Number.isFinite(refunded) && refunded >= total;
}
function providerTimestamp(attributes) {
  const parsed = Date.parse(String(attributes?.updated_at || attributes?.created_at || ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : now();
}
async function lemonLicenseAction(path, fields) {
  // A provider stall must fail as an activation error, never leave the Worker
  // waiting indefinitely or make the extension infer that Pro was granted.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${LEMON_API}/licenses/${path}`, {
      method: "POST", headers: { Accept: "application/json" }, body: new URLSearchParams(fields), signal: controller.signal,
    });
    if (!response.ok) return null;
    return await readJsonResponse(response);
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
async function createCheckout(env, value) {
  const payload = { data: { type: "checkouts", attributes: { checkout_data: { custom: { installation_id: value.installationId } }, product_options: { redirect_url: "https://sctd.vpugliese.online/?view=player-tools" }, checkout_options: { button_color: "#ff5500", dark: true, embed: false, media: false, logo: true } }, relationships: { store: { data: { type: "stores", id: String(env.LEMON_STORE_ID) } }, variant: { data: { type: "variants", id: String(env.LEMON_VARIANT_ID) } } } } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${LEMON_API}/checkouts`, {
      method: "POST", headers: lemonHeaders(env), body: JSON.stringify(payload), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Lemon checkout request failed (${response.status})`);
    const body = await readJsonResponse(response);
    return body?.data?.attributes?.url || null;
  } finally {
    clearTimeout(timeout);
  }
}
function validLicenseActivation(result, email, env) {
  const license = result?.license_key;
  const instance = result?.instance;
  const meta = result?.meta;
  const expiresAt = license?.expires_at ? Date.parse(license.expires_at) : null;
  return Boolean(result?.activated && license?.id && license?.key && instance?.id &&
    license?.status === "active" && (!expiresAt || expiresAt > now()) && matchesProduct(meta, env) &&
    String(meta?.customer_email || "").toLowerCase() === email);
}
async function recordActivation(env, result, email, installationId) {
  const timestamp = now();
  const license = result?.license_key;
  const instance = result?.instance;
  const meta = result?.meta;
  const licenseId = String(license?.id || "");
  const instanceId = String(instance?.id || "");
  const keyHash = await sha256Hex(String(license?.key || ""));
  if (!licenseId || !instanceId) throw new Error("Lemon returned an incomplete license activation.");
  const results = await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(`INSERT INTO licenses (lemon_license_id, lemon_order_id, lemon_customer_id, lemon_key_hash, customer_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(lemon_order_id) DO UPDATE SET lemon_license_id=excluded.lemon_license_id, customer_email=excluded.customer_email,
        lemon_customer_id=excluded.lemon_customer_id, lemon_key_hash=excluded.lemon_key_hash,
        status=CASE WHEN licenses.status='revoked' THEN 'revoked' ELSE 'active' END,
        revoked_at=CASE WHEN licenses.status='revoked' THEN licenses.revoked_at ELSE NULL END,
        updated_at=MAX(licenses.updated_at, excluded.updated_at)`)
      .bind(licenseId, String(meta?.order_id || "") || null, String(meta?.customer_id || "") || null, keyHash, email, timestamp, timestamp),
    env.LICENSE_DB.prepare(`INSERT INTO activations (lemon_instance_id, lemon_license_id, installation_id, activated_at, last_validated_at)
      SELECT ?, ?, ?, ?, ? FROM licenses WHERE lemon_license_id=? AND status='active'
      ON CONFLICT(lemon_instance_id) DO UPDATE SET installation_id=excluded.installation_id, last_validated_at=excluded.last_validated_at, deactivated_at=NULL`)
      .bind(instanceId, licenseId, installationId, timestamp, timestamp, licenseId),
  ]);
  return Number(results?.[1]?.meta?.changes || 0) > 0 ? { licenseId, instanceId } : null;
}
async function activate(env, value) {
  const result = await lemonLicenseAction("activate", { license_key: value.licenseKey, instance_name: value.installationId });
  if (!validLicenseActivation(result, value.email, env)) {
    return null;
  }
  return recordActivation(env, result, value.email, value.installationId);
}
async function restore(env, value) {
  const keyHash = await sha256Hex(value.licenseKey);
  const existing = await env.LICENSE_DB.prepare(`SELECT activations.lemon_instance_id, licenses.lemon_license_id
    FROM licenses JOIN activations USING(lemon_license_id)
    WHERE licenses.lemon_key_hash=? AND licenses.customer_email=? AND licenses.status='active'
      AND activations.installation_id=? AND activations.deactivated_at IS NULL`)
    .bind(keyHash, value.email, value.installationId).first();
  if (existing) return { licenseId: existing.lemon_license_id, instanceId: existing.lemon_instance_id };
  return activate(env, value);
}
async function status(env, value) {
  const activation = await env.LICENSE_DB.prepare(`SELECT licenses.lemon_license_id, licenses.status FROM activations JOIN licenses USING(lemon_license_id)
    WHERE activations.lemon_instance_id = ? AND activations.installation_id = ? AND activations.deactivated_at IS NULL`).bind(value.instanceId, value.installationId).first();
  if (!activation) return { active: false };
  if (activation.status !== "active") return { active: false, reason: "license_revoked" };
  await env.LICENSE_DB.prepare("UPDATE activations SET last_validated_at = ? WHERE lemon_instance_id = ?").bind(now(), value.instanceId).run();
  return { active: true, licenseId: activation.lemon_license_id };
}
async function recordWebhook(env, payload, raw) {
  const eventName = String(payload?.meta?.event_name || "");
  const hash = await sha256Hex(raw);
  const attributes = payload?.data?.attributes || {};
  if (!new Set(["order_created", "order_refunded"]).has(eventName) ||
      payload?.data?.type !== "orders" || !matchesWebhookOrder(attributes, env)) {
    throw Object.assign(new Error("Rejected Lemon webhook outside the configured product or environment."), { code: "invalid_webhook" });
  }
  const timestamp = now();
  const processingToken = crypto.randomUUID();
  await env.LICENSE_DB.prepare(`INSERT INTO webhook_events
    (event_hash, event_name, received_at, payload, processing_started_at)
    VALUES (?, ?, ?, ?, NULL) ON CONFLICT(event_hash) DO NOTHING`)
    .bind(hash, eventName, timestamp, new TextDecoder().decode(raw)).run();
  // Claiming the event makes delivery deduplication safe even when two retries
  // overlap. A failed handler explicitly releases its claim below.
  const claimed = await env.LICENSE_DB.prepare(`UPDATE webhook_events SET processing_started_at=?, processing_token=?,
    processing_attempts=processing_attempts+1, processing_error=NULL
    WHERE event_hash=? AND processed_at IS NULL AND (processing_started_at IS NULL OR processing_started_at < ?)`)
    .bind(timestamp, processingToken, hash, timestamp - 30_000).run();
  if (Number(claimed.meta?.changes || 0) === 0) {
    const state = await env.LICENSE_DB.prepare("SELECT processed_at FROM webhook_events WHERE event_hash=?").bind(hash).first();
    if (state?.processed_at) return { duplicate: true };
    throw Object.assign(new Error("The Lemon webhook is already being processed."), { code: "webhook_in_progress" });
  }
  try {
    const eventAt = providerTimestamp(attributes);
  if (eventName === "order_created") {
    const installationId = String(payload?.meta?.custom_data?.installation_id || "");
    await env.LICENSE_DB.prepare(`INSERT INTO licenses (lemon_license_id, lemon_order_id, lemon_customer_id, customer_email, status, created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?,
        CASE WHEN EXISTS (SELECT 1 FROM order_revocations WHERE lemon_order_id=?) THEN 'revoked' ELSE 'active' END,
        ?, ?, (SELECT revoked_at FROM order_revocations WHERE lemon_order_id=?))
      ON CONFLICT(lemon_order_id) DO UPDATE SET
        customer_email=excluded.customer_email,
        lemon_customer_id=excluded.lemon_customer_id,
        status=CASE WHEN licenses.status='revoked' OR excluded.status='revoked' THEN 'revoked' ELSE 'active' END,
        revoked_at=COALESCE(licenses.revoked_at, excluded.revoked_at),
        updated_at=MAX(licenses.updated_at, excluded.updated_at)`)
      .bind(`order:${payload?.data?.id}`, String(payload?.data?.id || ""), String(attributes.customer_id || "") || null,
        String(attributes.user_email || attributes.customer_email || "").toLowerCase(), String(payload?.data?.id || ""), timestamp, eventAt,
        String(payload?.data?.id || "")).run();
    if (/^[a-zA-Z0-9_-]{16,128}$/.test(installationId)) {
      await env.LICENSE_DB.prepare(`INSERT INTO analytics_events
        (event_id, installation_id, event_name, occurred_at, received_at, extension_version, offer_version, properties)
        VALUES (?, ?, 'purchase_confirmed', ?, ?, 'server', 'provider', ?) ON CONFLICT(event_id) DO NOTHING`)
        .bind(`purchase:${payload?.data?.id}`, installationId, timestamp, timestamp, JSON.stringify({
          currency: String(attributes.currency || "").slice(0, 16),
          total: Number(attributes.total || 0),
        })).run();
    }
  }
  if (eventName === "order_refunded" && isFullRefund(attributes)) {
    const orderId = String(payload?.data?.id || "");
    await env.LICENSE_DB.batch([
      env.LICENSE_DB.prepare(`INSERT INTO order_revocations (lemon_order_id, revoked_at, provider_event_at, reason)
        VALUES (?, ?, ?, 'full_refund') ON CONFLICT(lemon_order_id) DO UPDATE SET
          revoked_at=MIN(order_revocations.revoked_at, excluded.revoked_at),
          provider_event_at=MAX(order_revocations.provider_event_at, excluded.provider_event_at)`)
        .bind(orderId, timestamp, eventAt),
      env.LICENSE_DB.prepare(`UPDATE licenses SET status='revoked', revoked_at=COALESCE(revoked_at, ?),
        updated_at=MAX(updated_at, ?) WHERE lemon_order_id=?`)
        .bind(timestamp, eventAt, orderId),
    ]);
  }
    const completed = await env.LICENSE_DB.prepare(`UPDATE webhook_events SET processed_at=?, processing_error=NULL
      WHERE event_hash=? AND processing_token=? AND processed_at IS NULL`)
      .bind(now(), hash, processingToken).run();
    if (Number(completed.meta?.changes || 0) === 0) {
      throw Object.assign(new Error("The Lemon webhook claim was superseded."), { code: "webhook_claim_lost" });
    }
    return { duplicate: false };
  } catch (error) {
    await env.LICENSE_DB.prepare(`UPDATE webhook_events SET processing_started_at=NULL, processing_token=NULL, processing_error=?
      WHERE event_hash=? AND processing_token=? AND processed_at IS NULL`)
      .bind(String(error instanceof Error ? error.message : error).slice(0, 512), hash, processingToken).run();
    throw error;
  }
}

async function recordEvent(env, event) {
  const result = await env.LICENSE_DB.prepare(`INSERT INTO analytics_events
    (event_id, installation_id, event_name, occurred_at, received_at, extension_version, offer_version, properties)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
    .bind(event.eventId, event.installationId, event.name, event.occurredAt, now(), event.version, event.offer,
      JSON.stringify(event.properties)).run();
  return Number(result.meta?.changes || 0) > 0;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/player-tools/health") return json(200, { service: "sctd-player-tools-license", status: env.LICENSE_DB && env.LEMON_API_KEY && env.LEMON_WEBHOOK_SECRET && env.LEMON_STORE_ID && env.LEMON_PRODUCT_ID && env.LEMON_VARIANT_ID && ["test", "live"].includes(env.LEMON_MODE) && (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN) ? "ready" : "not-configured" });
      if (request.method === "POST" && url.pathname === "/api/player-tools/webhooks/lemon") {
        const raw = await readBody(request, MAX_WEBHOOK_BYTES);
        const signature = request.headers.get("x-signature") || "";
        if (!raw || !env.LEMON_WEBHOOK_SECRET || !equals(signature, await hmacHex(env.LEMON_WEBHOOK_SECRET, raw))) return json(403, { error: "invalid_signature" });
        let payload; try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "invalid_payload" }); }
        const headerEvent = request.headers.get("x-event-name");
        if (headerEvent && headerEvent !== payload?.meta?.event_name) return json(400, { error: "invalid_webhook" });
        try { await recordWebhook(env, payload, raw); }
        catch (error) {
          if (error?.code === "invalid_webhook") return json(400, { error: "invalid_webhook" });
          if (["webhook_in_progress", "webhook_claim_lost"].includes(error?.code)) {
            return json(503, { error: error.code }, { "retry-after": "5" });
          }
          throw error;
        }
        return json(200, { received: true });
      }
      const origin = allowedOrigin(request, env);
      if (!origin) return json(403, { error: "origin_not_allowed" });
      const corsHeaders = cors(origin);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      const raw = await readBody(request, MAX_BODY_BYTES);
      let body; try { body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { body = null; }
      if (request.method === "POST" && url.pathname === "/api/player-tools/checkout") {
        const parsed = validateCheckout(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        const checkoutUrl = await createCheckout(env, parsed.value); return json(200, { checkoutUrl }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/activate") {
        const parsed = validateActivation(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        const entitlement = await activate(env, parsed.value); return entitlement ? json(200, { active: true, ...entitlement }, corsHeaders) : json(403, { active: false, error: "activation_failed" }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/restore") {
        const parsed = validateActivation(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        const entitlement = await restore(env, parsed.value); return entitlement ? json(200, { active: true, ...entitlement }, corsHeaders) : json(403, { active: false, error: "activation_failed" }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/status") {
        const parsed = validateStatus(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        const result = await status(env, parsed.value);
        if (result.reason === "license_revoked") return json(403, { active: false, error: result.reason }, corsHeaders);
        return json(200, result, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/events") {
        const parsed = validateEvent(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        return json(200, { accepted: true, duplicate: !(await recordEvent(env, parsed.value)) }, corsHeaders);
      }
      return json(404, { error: "not_found" }, corsHeaders);
    } catch (error) {
      console.error(JSON.stringify({ message: "player-tools license request failed", error: error instanceof Error ? error.message : String(error) }));
      const origin = allowedOrigin(request, env);
      return json(500, { error: "internal_error" }, origin ? cors(origin) : {});
    }
  },
};
