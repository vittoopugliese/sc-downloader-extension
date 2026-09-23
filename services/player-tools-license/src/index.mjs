import { MAX_BODY_BYTES, MAX_WEBHOOK_BYTES, validateActivation, validateAdminLicense, validateAdminRelease, validateCheckout, validateEvent, validateStatus, validateTrialConsume, validateTrialStart } from "./validation.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const LEMON_API = "https://api.lemonsqueezy.com/v1";
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const PROVIDER_TIMEOUT_MS = 12_000;
const ACTIVATION_LEASE_MS = 30_000;
const MAX_ACTIVE_PROFILES = 2;
const RECEIPT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const TRIAL_LIMIT = 20;
const TRIAL_GRANT_GRACE_MS = 6 * 60 * 60 * 1000;

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
async function enforceRateLimit(env, bindingName, route, request, _subject = "anonymous") {
  const limiter = env[bindingName];
  if (!limiter?.limit) return true;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  // Installation IDs are client-selected today, so they cannot be the only
  // anti-bypass key. Hash the route/IP pair; verified account subjects can be
  // added as a second limiter when M01 authentication is available.
  const subjectHash = await sha256Hex(`${route}:${ip}`);
  const result = await limiter.limit({ key: subjectHash });
  return result?.success === true;
}
async function health(env) {
  const configured = env.LICENSE_DB && env.LEMON_API_KEY && env.LEMON_WEBHOOK_SECRET && env.ADMIN_TOKEN &&
    env.LEMON_STORE_ID && env.LEMON_PRODUCT_ID && env.LEMON_VARIANT_ID && env.ENTITLEMENT_PRIVATE_JWK &&
    env.ENTITLEMENT_KEY_ID && ["test", "live"].includes(env.LEMON_MODE) && (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN) &&
    env.TRIAL_RATE_LIMITER?.limit && env.LICENSE_RATE_LIMITER?.limit &&
    env.CHECKOUT_RATE_LIMITER?.limit && env.EVENT_RATE_LIMITER?.limit;
  if (!configured) return json(503, { service: "sctd-player-tools-license", status: "not-configured" });
  try {
    const schema = await env.LICENSE_DB.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type='table' AND name IN ('licenses', 'activations', 'webhook_events', 'analytics_events',
        'order_revocations', 'activation_operations', 'trials', 'trial_consumptions')`).first();
    if (Number(schema?.count || 0) !== 8) {
      return json(503, { service: "sctd-player-tools-license", status: "not-migrated", mode: env.LEMON_MODE });
    }
    return json(200, { service: "sctd-player-tools-license", status: "ready", mode: env.LEMON_MODE });
  } catch (error) {
    console.error(JSON.stringify({ message: "player-tools health check failed", error: error instanceof Error ? error.message : String(error) }));
    return json(503, { service: "sctd-player-tools-license", status: "database-unavailable", mode: env.LEMON_MODE });
  }
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
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
async function signReceipt(env, claims) {
  if (!env.ENTITLEMENT_PRIVATE_JWK || !env.ENTITLEMENT_KEY_ID) {
    throw new Error("Entitlement signing is not configured.");
  }
  let jwk;
  try { jwk = JSON.parse(env.ENTITLEMENT_PRIVATE_JWK); }
  catch { throw new Error("Entitlement signing key is invalid."); }
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.d ||
      (jwk.kid && jwk.kid !== env.ENTITLEMENT_KEY_ID)) {
    throw new Error("Entitlement signing key does not match ENTITLEMENT_KEY_ID.");
  }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload));
  return { algorithm: "ES256", keyId: env.ENTITLEMENT_KEY_ID, payload, signature: base64Url(new Uint8Array(signature)) };
}
async function proReceipt(env, activation) {
  const issuedAt = now();
  return signReceipt(env, {
    version: 1, type: "pro", installationId: activation.installationId,
    licenseId: activation.licenseId, instanceId: activation.instanceId,
    capabilities: ["pro"], issuedAt, expiresAt: issuedAt + RECEIPT_LIFETIME_MS,
  });
}
async function trialReceipt(env, trial, grant = null) {
  return signReceipt(env, {
    version: 1, type: "trial", installationId: trial.installation_id,
    startedAt: trial.started_at, expiresAt: trial.expires_at,
    used: trial.used, limit: TRIAL_LIMIT, issuedAt: now(),
    ...(grant ? { grantRequestId: grant.request_id, grantTrackIdentityHash: grant.track_identity_hash,
      graceExpiresAt: grant.consumed_at + TRIAL_GRANT_GRACE_MS } : {}),
  });
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
    const body = await readJsonResponse(response).catch(() => null);
    if (!response.ok) {
      return { ok: false, retryable: response.status === 429 || response.status >= 500, status: response.status, body };
    }
    return { ok: true, body };
  } catch { return { ok: false, retryable: true, status: 0, body: null }; }
  finally { clearTimeout(timeout); }
}
async function lemonApiGet(env, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const target = /^https:\/\//.test(path) ? path : `${LEMON_API}${path}`;
    const response = await fetch(target, { headers: lemonHeaders(env), signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: await readJsonResponse(response) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
async function lemonLicenseInstances(env, licenseId) {
  let path = `/license-key-instances?filter%5Blicense_key_id%5D=${encodeURIComponent(licenseId)}&page%5Bsize%5D=100`;
  const data = [];
  for (let page = 0; page < 20 && path; page += 1) {
    const response = await lemonApiGet(env, path);
    if (!response?.ok) return response || { ok: false, status: 0 };
    if (!Array.isArray(response.body?.data)) return { ok: false, status: 502 };
    data.push(...response.body.data);
    const next = response.body?.links?.next;
    path = typeof next === "string" && next ? next : null;
  }
  if (path) return { ok: false, status: 508 };
  return { ok: true, body: { data } };
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
async function acquireActivationOperation(env, keyHash, installationId, email) {
  const timestamp = now();
  const token = crypto.randomUUID();
  // INSERT ... SELECT is deliberately one statement: D1 serializes writes,
  // so three concurrent profiles can create at most two reservations.
  const inserted = await env.LICENSE_DB.prepare(`INSERT INTO activation_operations
    (license_key_hash, installation_id, state, lease_token, lease_expires_at, created_at, updated_at)
    SELECT ?, ?, 'pending', ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM activation_operations
      WHERE license_key_hash=? AND state IN ('pending', 'active')) < ?
    ON CONFLICT(license_key_hash, installation_id) DO NOTHING`)
    .bind(keyHash, installationId, token, timestamp + ACTIVATION_LEASE_MS, timestamp, timestamp,
      keyHash, MAX_ACTIVE_PROFILES).run();
  if (Number(inserted.meta?.changes || 0) > 0) return { kind: 'owned', token, recover: false };

  const existing = await env.LICENSE_DB.prepare(`SELECT activation_operations.state, activation_operations.lease_expires_at,
      activation_operations.lemon_license_id, activation_operations.lemon_instance_id,
      licenses.status AS license_status, licenses.customer_email, activations.deactivated_at
    FROM activation_operations
    LEFT JOIN licenses ON licenses.lemon_license_id=activation_operations.lemon_license_id
    LEFT JOIN activations ON activations.lemon_instance_id=activation_operations.lemon_instance_id
    WHERE activation_operations.license_key_hash=? AND activation_operations.installation_id=?`)
    .bind(keyHash, installationId).first();
  if (!existing) return { kind: 'seat_limit' };
  if (existing.state === 'active' && existing.lemon_license_id && existing.lemon_instance_id) {
    if (existing.license_status === 'active' && existing.deactivated_at == null) {
      if (String(existing.customer_email || '').toLowerCase() !== String(email || '').toLowerCase()) {
        return { kind: 'credential_mismatch' };
      }
      return { kind: 'active', licenseId: existing.lemon_license_id, instanceId: existing.lemon_instance_id };
    }
    await env.LICENSE_DB.prepare("DELETE FROM activation_operations WHERE license_key_hash=? AND installation_id=?")
      .bind(keyHash, installationId).run();
    return existing.license_status === 'revoked' ? { kind: 'revoked' } : acquireActivationOperation(env, keyHash, installationId, email);
  }
  if (Number(existing.lease_expires_at || 0) > timestamp) return { kind: 'in_progress' };
  const reclaimed = await env.LICENSE_DB.prepare(`UPDATE activation_operations
    SET lease_token=?, lease_expires_at=?, updated_at=?
    WHERE license_key_hash=? AND installation_id=? AND state='pending'
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
    .bind(token, timestamp + ACTIVATION_LEASE_MS, timestamp, keyHash, installationId, timestamp).run();
  return Number(reclaimed.meta?.changes || 0) > 0 ? { kind: 'owned', token, recover: true } : { kind: 'in_progress' };
}
async function releasePendingActivation(env, keyHash, installationId, token) {
  await env.LICENSE_DB.prepare(`DELETE FROM activation_operations
    WHERE license_key_hash=? AND installation_id=? AND state='pending' AND lease_token=?`)
    .bind(keyHash, installationId, token).run();
}

async function recoverRemoteActivation(env, value, keyHash, operationToken) {
  const validated = await lemonLicenseAction("validate", { license_key: value.licenseKey });
  if (!validated.ok) return validated.retryable ? { kind: 'in_progress' } : null;
  const result = validated.body;
  const licenseId = String(result?.license_key?.id || "");
  if (!result?.valid || !licenseId || !matchesProduct(result.meta, env) ||
      String(result.meta?.customer_email || "").toLowerCase() !== value.email ||
      keyHash !== await sha256Hex(String(result.license_key?.key || ""))) return null;
  const instances = await lemonLicenseInstances(env, licenseId);
  if (!instances.ok) return { kind: 'in_progress' };
  const instance = instances.ok && Array.isArray(instances.body?.data)
    ? instances.body.data.find((item) => item?.type === 'license-key-instances' &&
        String(item?.attributes?.name || '') === value.installationId)
    : null;
  const instanceId = String(instance?.attributes?.identifier || "");
  if (!instanceId) return null;
  const entitlement = await recordActivation(env, {
    activated: true, license_key: result.license_key,
    instance: { id: instanceId, name: value.installationId }, meta: result.meta,
  }, value.email, value.installationId, keyHash, operationToken);
  if (entitlement) return entitlement;
  const local = await env.LICENSE_DB.prepare("SELECT status FROM licenses WHERE lemon_license_id=?").bind(licenseId).first();
  if (local?.status === 'revoked') {
    await releasePendingActivation(env, keyHash, value.installationId, operationToken);
    return { kind: 'revoked' };
  }
  return { kind: 'in_progress' };
}
async function recordActivation(env, result, email, installationId, keyHash, operationToken) {
  const timestamp = now();
  const license = result?.license_key;
  const instance = result?.instance;
  const meta = result?.meta;
  const licenseId = String(license?.id || "");
  const instanceId = String(instance?.id || "");
  const providerKeyHash = await sha256Hex(String(license?.key || ""));
  if (!licenseId || !instanceId) throw new Error("Lemon returned an incomplete license activation.");
  // A refund webhook may arrive before either the order-created webhook or an
  // activation attempt.  The order tombstone is therefore an authority here
  // too; otherwise an activation response could recreate Pro after refund.
  const orderId = String(meta?.order_id || "");
  const results = await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(`INSERT INTO licenses (lemon_license_id, lemon_order_id, lemon_customer_id, lemon_key_hash, customer_email, status, created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM order_revocations WHERE lemon_order_id=?) THEN 'revoked' ELSE 'active' END, ?, ?,
        (SELECT revoked_at FROM order_revocations WHERE lemon_order_id=?))
      ON CONFLICT(lemon_order_id) DO UPDATE SET lemon_license_id=excluded.lemon_license_id, customer_email=excluded.customer_email,
        lemon_customer_id=excluded.lemon_customer_id, lemon_key_hash=excluded.lemon_key_hash,
        status=CASE WHEN licenses.status='revoked' OR EXISTS (SELECT 1 FROM order_revocations WHERE lemon_order_id=excluded.lemon_order_id) THEN 'revoked' ELSE 'active' END,
        revoked_at=COALESCE(licenses.revoked_at, (SELECT revoked_at FROM order_revocations WHERE lemon_order_id=excluded.lemon_order_id)),
        updated_at=MAX(licenses.updated_at, excluded.updated_at)`)
      .bind(licenseId, orderId || null, String(meta?.customer_id || "") || null, providerKeyHash, email, orderId, timestamp, timestamp, orderId),
    env.LICENSE_DB.prepare(`INSERT INTO activations (lemon_instance_id, lemon_license_id, installation_id, activated_at, last_validated_at)
      SELECT ?, ?, ?, ?, ? FROM licenses WHERE lemon_license_id=? AND status='active'
      ON CONFLICT(lemon_license_id, installation_id) DO UPDATE SET
        lemon_instance_id=excluded.lemon_instance_id, activated_at=excluded.activated_at,
        last_validated_at=excluded.last_validated_at, deactivated_at=NULL`)
      .bind(instanceId, licenseId, installationId, timestamp, timestamp, licenseId),
    env.LICENSE_DB.prepare(`UPDATE activation_operations SET state='active', lemon_license_id=?, lemon_instance_id=?,
      lease_token=NULL, lease_expires_at=NULL, updated_at=?
      WHERE license_key_hash=? AND installation_id=? AND state='pending' AND lease_token=?
        AND EXISTS (SELECT 1 FROM licenses WHERE lemon_license_id=? AND status='active')`)
      .bind(licenseId, instanceId, timestamp, keyHash, installationId, operationToken, licenseId),
  ]);
  return Number(results?.[2]?.meta?.changes || 0) > 0 ? { licenseId, instanceId } : null;
}
async function activate(env, value) {
  const keyHash = await sha256Hex(value.licenseKey);
  const revoked = await env.LICENSE_DB.prepare("SELECT 1 AS revoked FROM licenses WHERE lemon_key_hash=? AND status='revoked'")
    .bind(keyHash).first();
  if (revoked) return { kind: 'revoked' };
  const operation = await acquireActivationOperation(env, keyHash, value.installationId, value.email);
  if (operation.kind === 'active') return operation;
  if (operation.kind !== 'owned') return operation;
  if (operation.recover) {
    const recovered = await recoverRemoteActivation(env, value, keyHash, operation.token);
    if (recovered) return recovered;
  }
  const action = await lemonLicenseAction("activate", { license_key: value.licenseKey, instance_name: value.installationId });
  if (!action.ok) {
    if (!action.retryable) await releasePendingActivation(env, keyHash, value.installationId, operation.token);
    return action.retryable ? { kind: 'in_progress' } : { kind: 'failed' };
  }
  const result = action.body;
  if (!validLicenseActivation(result, value.email, env) || keyHash !== await sha256Hex(String(result?.license_key?.key || ""))) {
    await releasePendingActivation(env, keyHash, value.installationId, operation.token);
    return { kind: 'failed' };
  }
  let entitlement;
  try {
    entitlement = await recordActivation(env, result, value.email, value.installationId, keyHash, operation.token);
  } catch (error) {
    // Lemon may already have created the instance. Keep the reservation and
    // report a retryable state instead of asking the client to activate again.
    console.error(JSON.stringify({ message: "activation persistence deferred", error: error instanceof Error ? error.message : String(error) }));
    return { kind: 'in_progress' };
  }
  // If D1 fails after Lemon succeeded, this pending reservation survives. The
  // same profile retries it after the lease; it cannot consume another seat.
  if (entitlement) return entitlement;
  const license = await env.LICENSE_DB.prepare("SELECT status FROM licenses WHERE lemon_license_id=?").bind(String(result.license_key.id)).first();
  if (license?.status === 'revoked') {
    await releasePendingActivation(env, keyHash, value.installationId, operation.token);
    return { kind: 'revoked' };
  }
  return { kind: 'in_progress' };
}
async function restore(env, value) {
  const keyHash = await sha256Hex(value.licenseKey);
  const existing = await env.LICENSE_DB.prepare(`SELECT activations.lemon_instance_id, activations.installation_id,
      licenses.lemon_license_id, licenses.status, licenses.customer_email
    FROM licenses JOIN activations USING(lemon_license_id)
    WHERE licenses.lemon_key_hash=? AND licenses.customer_email=? AND licenses.status='active'
      AND activations.installation_id=? AND activations.deactivated_at IS NULL`)
    .bind(keyHash, value.email, value.installationId).first();
  // Never extend an offline receipt solely from D1.  A missed or delayed
  // webhook must not make restore an alternate revocation bypass.
  if (existing) {
    const active = await reconcileActivation(env, existing);
    return active
      ? { kind: 'active', licenseId: existing.lemon_license_id, instanceId: existing.lemon_instance_id }
      : { kind: 'revoked' };
  }
  return activate(env, value);
}
function activeProviderLicense(resource, activation, env) {
  const attributes = resource?.data?.attributes;
  const expiresAt = attributes?.expires_at ? Date.parse(attributes.expires_at) : null;
  return resource?.data?.type === 'license-keys' && String(resource.data.id) === String(activation.lemon_license_id)
    && String(attributes?.store_id) === String(env.LEMON_STORE_ID)
    && String(attributes?.product_id) === String(env.LEMON_PRODUCT_ID)
    && String(attributes?.user_email || '').toLowerCase() === String(activation.customer_email || '').toLowerCase()
    && attributes?.status === 'active' && (attributes?.disabled === false || Number(attributes?.disabled) === 0)
    && (!expiresAt || expiresAt > now());
}
async function reconcileActivation(env, activation) {
  const license = await lemonApiGet(env, `/license-keys/${encodeURIComponent(activation.lemon_license_id)}`);
  if (!license?.ok) throw new Error('Lemon license reconciliation is temporarily unavailable.');
  const licenseActive = license.ok && activeProviderLicense(license.body, activation, env);
  if (licenseActive) {
    const instances = await lemonLicenseInstances(env, activation.lemon_license_id);
    if (!instances.ok) throw new Error('Lemon instance reconciliation is temporarily unavailable.');
    const instanceActive = instances.ok && Array.isArray(instances.body?.data) && instances.body.data.some((item) =>
      item?.type === 'license-key-instances'
      && String(item?.attributes?.identifier || '') === String(activation.lemon_instance_id)
      && String(item?.attributes?.name || '') === String(activation.installation_id));
    if (!instanceActive) {
      const timestamp = now();
      await env.LICENSE_DB.batch([
        env.LICENSE_DB.prepare("UPDATE activations SET deactivated_at=COALESCE(deactivated_at, ?) WHERE lemon_instance_id=?")
          .bind(timestamp, activation.lemon_instance_id),
        env.LICENSE_DB.prepare("DELETE FROM activation_operations WHERE lemon_instance_id=?")
          .bind(activation.lemon_instance_id),
      ]);
      return false;
    }
  }
  const timestamp = now();
  if (!licenseActive) {
    await env.LICENSE_DB.batch([
      env.LICENSE_DB.prepare("UPDATE licenses SET status='revoked', revoked_at=COALESCE(revoked_at, ?), updated_at=? WHERE lemon_license_id=?")
        .bind(timestamp, timestamp, activation.lemon_license_id),
      env.LICENSE_DB.prepare("UPDATE activations SET deactivated_at=COALESCE(deactivated_at, ?) WHERE lemon_instance_id=?")
        .bind(timestamp, activation.lemon_instance_id),
      env.LICENSE_DB.prepare("DELETE FROM activation_operations WHERE lemon_license_id=?")
        .bind(activation.lemon_license_id),
    ]);
    return false;
  }
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare("UPDATE licenses SET updated_at=? WHERE lemon_license_id=? AND status='active'").bind(timestamp, activation.lemon_license_id),
    env.LICENSE_DB.prepare("UPDATE activations SET last_validated_at=? WHERE lemon_instance_id=? AND deactivated_at IS NULL")
      .bind(timestamp, activation.lemon_instance_id),
  ]);
  return true;
}
async function status(env, value) {
  const activation = await env.LICENSE_DB.prepare(`SELECT licenses.lemon_license_id, licenses.status, licenses.customer_email,
    activations.lemon_instance_id, activations.installation_id FROM activations JOIN licenses USING(lemon_license_id)
    WHERE activations.lemon_instance_id = ? AND activations.installation_id = ? AND activations.deactivated_at IS NULL`).bind(value.instanceId, value.installationId).first();
  if (!activation) return { active: false };
  if (activation.status !== "active") return { active: false, reason: "license_revoked" };
  return await reconcileActivation(env, activation)
    ? { active: true, serverTime: now(), licenseId: activation.lemon_license_id, instanceId: activation.lemon_instance_id,
        receipt: await proReceipt(env, { installationId: activation.installation_id,
          licenseId: activation.lemon_license_id, instanceId: activation.lemon_instance_id }) }
    : { active: false, reason: 'license_revoked' };
}

async function startTrial(env, value) {
  const timestamp = now();
  await env.LICENSE_DB.prepare(`INSERT INTO trials
    (installation_id, started_at, expires_at, used, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(installation_id) DO NOTHING`)
    .bind(value.installationId, timestamp, timestamp + TRIAL_LIFETIME_MS, timestamp, timestamp).run();
  const trial = await env.LICENSE_DB.prepare("SELECT installation_id, started_at, expires_at, used FROM trials WHERE installation_id=?")
    .bind(value.installationId).first();
  const grant = trial.used === TRIAL_LIMIT
    ? await env.LICENSE_DB.prepare(`SELECT request_id, consumed_at, track_identity_hash FROM trial_consumptions
        WHERE installation_id=? ORDER BY consumed_at DESC, request_id DESC LIMIT 1`).bind(value.installationId).first()
    : null;
  return { trial: { startedAt: trial.started_at, expiresAt: trial.expires_at, used: trial.used, limit: TRIAL_LIMIT },
    receipt: await trialReceipt(env, trial, grant) };
}

async function consumeTrial(env, value) {
  const timestamp = now();
  const operationToken = crypto.randomUUID();
  const trackHash = await sha256Hex(value.trackIdentity);
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare(`INSERT INTO trial_consumptions
      (installation_id, request_id, track_identity_hash, operation_token, consumed_at)
      SELECT installation_id, ?, ?, ?, ? FROM trials
      WHERE installation_id=? AND expires_at>? AND used<?
      ON CONFLICT(installation_id, request_id) DO NOTHING`)
      .bind(value.requestId, trackHash, operationToken, timestamp, value.installationId, timestamp, TRIAL_LIMIT),
    env.LICENSE_DB.prepare(`UPDATE trials SET used=used+1, updated_at=?
      WHERE installation_id=? AND EXISTS (
        SELECT 1 FROM trial_consumptions WHERE installation_id=? AND request_id=? AND operation_token=?
      )`)
      .bind(timestamp, value.installationId, value.installationId, value.requestId, operationToken),
  ]);
  const trial = await env.LICENSE_DB.prepare("SELECT installation_id, started_at, expires_at, used FROM trials WHERE installation_id=?")
    .bind(value.installationId).first();
  if (!trial) return { allowed: false, reason: 'trial_not_started' };
  const consumption = await env.LICENSE_DB.prepare(`SELECT request_id, consumed_at, track_identity_hash FROM trial_consumptions
    WHERE installation_id=? AND request_id=?`).bind(value.installationId, value.requestId).first();
  const allowed = Boolean(consumption) && consumption.track_identity_hash === trackHash;
  const finalGrant = trial.used === TRIAL_LIMIT
    ? await env.LICENSE_DB.prepare(`SELECT request_id, consumed_at, track_identity_hash FROM trial_consumptions
        WHERE installation_id=? ORDER BY consumed_at DESC, request_id DESC LIMIT 1`).bind(value.installationId).first()
    : null;
  const reason = allowed ? null : consumption ? 'trial_request_conflict'
    : timestamp >= trial.expires_at ? 'trial_expired' : 'trial_exhausted';
  return { allowed, reason,
    trial: { startedAt: trial.started_at, expiresAt: trial.expires_at, used: trial.used, limit: TRIAL_LIMIT },
    receipt: await trialReceipt(env, trial, finalGrant) };
}

async function releaseSeat(env, value) {
  const keyHash = await sha256Hex(value.licenseKey);
  const activation = await env.LICENSE_DB.prepare(`SELECT activation_operations.lemon_instance_id,
      activation_operations.lemon_license_id
    FROM activation_operations WHERE license_key_hash=? AND installation_id=? AND state='active'`)
    .bind(keyHash, value.installationId).first();
  if (!activation) return { found: false, released: false, dryRun: value.dryRun };
  if (value.dryRun) return { found: true, released: false, dryRun: true,
    licenseId: activation.lemon_license_id, instanceId: activation.lemon_instance_id };
  const remote = await lemonLicenseAction("deactivate", { license_key: value.licenseKey, instance_id: activation.lemon_instance_id });
  if (!remote.ok) {
    if (remote.retryable) throw new Error("Lemon seat release is temporarily unavailable.");
    throw Object.assign(new Error("Lemon rejected the seat release."), { code: "release_rejected" });
  }
  if (remote.body?.deactivated !== true) throw Object.assign(new Error("Lemon did not confirm the seat release."), { code: "release_rejected" });
  const timestamp = now();
  await env.LICENSE_DB.batch([
    env.LICENSE_DB.prepare("UPDATE activations SET deactivated_at=COALESCE(deactivated_at, ?) WHERE lemon_instance_id=?")
      .bind(timestamp, activation.lemon_instance_id),
    env.LICENSE_DB.prepare("DELETE FROM activation_operations WHERE license_key_hash=? AND installation_id=?")
      .bind(keyHash, value.installationId),
  ]);
  return { found: true, released: true, dryRun: false,
    licenseId: activation.lemon_license_id, instanceId: activation.lemon_instance_id };
}

async function inspectLicense(env, licenseKey) {
  const keyHash = await sha256Hex(licenseKey);
  const license = await env.LICENSE_DB.prepare(`SELECT lemon_license_id, lemon_order_id, status, created_at, updated_at, revoked_at
    FROM licenses WHERE lemon_key_hash=?`).bind(keyHash).first();
  if (!license) return { found: false };
  const activations = await env.LICENSE_DB.prepare(`SELECT installation_id, lemon_instance_id, activated_at, last_validated_at, deactivated_at
    FROM activations WHERE lemon_license_id=? ORDER BY activated_at ASC`).bind(license.lemon_license_id).all();
  return { found: true, license: {
    licenseId: license.lemon_license_id, orderId: license.lemon_order_id, status: license.status,
    createdAt: license.created_at, updatedAt: license.updated_at, revokedAt: license.revoked_at,
  }, activations: activations.results || [] };
}

async function reconcileSeat(env, value) {
  const keyHash = await sha256Hex(value.licenseKey);
  const activation = await env.LICENSE_DB.prepare(`SELECT licenses.lemon_license_id, licenses.status, licenses.customer_email,
    activations.lemon_instance_id, activations.installation_id FROM licenses JOIN activations USING(lemon_license_id)
    WHERE licenses.lemon_key_hash=? AND activations.installation_id=? AND activations.deactivated_at IS NULL`)
    .bind(keyHash, value.installationId).first();
  if (!activation) return { found: false, active: false };
  const active = activation.status === "active" && await reconcileActivation(env, activation);
  return { found: true, active, licenseId: activation.lemon_license_id, instanceId: activation.lemon_instance_id };
}
async function recordWebhook(env, payload, raw) {
  const eventName = String(payload?.meta?.event_name || "");
  const hash = await sha256Hex(raw);
  const attributes = payload?.data?.attributes || {};
  const orderEvent = new Set(["order_created", "order_refunded"]).has(eventName) &&
    payload?.data?.type === "orders" && matchesWebhookOrder(attributes, env);
  const licenseEvent = eventName === "license_key_updated" && payload?.data?.type === "license-keys" &&
    String(attributes?.store_id) === String(env.LEMON_STORE_ID) &&
    String(attributes?.product_id) === String(env.LEMON_PRODUCT_ID);
  if (!orderEvent && !licenseEvent) {
    throw Object.assign(new Error("Rejected Lemon webhook outside the configured product or environment."), { code: "invalid_webhook" });
  }
  if (licenseEvent) {
    const known = await env.LICENSE_DB.prepare("SELECT 1 AS known FROM licenses WHERE lemon_license_id=?")
      .bind(String(payload?.data?.id || "")).first();
    if (!known) throw Object.assign(new Error("Rejected unknown Lemon license update."), { code: "invalid_webhook" });
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
      env.LICENSE_DB.prepare(`UPDATE activations SET deactivated_at=COALESCE(deactivated_at, ?)
        WHERE lemon_license_id IN (SELECT lemon_license_id FROM licenses WHERE lemon_order_id=?)`)
        .bind(timestamp, orderId),
      env.LICENSE_DB.prepare(`DELETE FROM activation_operations
        WHERE lemon_license_id IN (SELECT lemon_license_id FROM licenses WHERE lemon_order_id=?)`)
        .bind(orderId),
    ]);
  }
  if (eventName === "license_key_updated" &&
      (attributes?.status !== "active" || attributes?.disabled === true || Number(attributes?.disabled) === 1)) {
    const licenseId = String(payload?.data?.id || "");
    await env.LICENSE_DB.batch([
      env.LICENSE_DB.prepare("UPDATE licenses SET status='revoked', revoked_at=COALESCE(revoked_at, ?), updated_at=MAX(updated_at, ?) WHERE lemon_license_id=?")
        .bind(timestamp, eventAt, licenseId),
      env.LICENSE_DB.prepare("UPDATE activations SET deactivated_at=COALESCE(deactivated_at, ?) WHERE lemon_license_id=?")
        .bind(timestamp, licenseId),
      env.LICENSE_DB.prepare("DELETE FROM activation_operations WHERE lemon_license_id=?").bind(licenseId),
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
      if (request.method === "GET" && url.pathname === "/api/player-tools/health") return health(env);
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
      if (request.method === "POST" && url.pathname === "/api/player-tools/admin/release-seat") {
        const authorization = request.headers.get("authorization") || "";
        const expected = env.ADMIN_TOKEN ? `Bearer ${env.ADMIN_TOKEN}` : "";
        if (!expected || !equals(authorization, expected)) return json(403, { error: "admin_forbidden" });
        const raw = await readBody(request, MAX_BODY_BYTES);
        let body; try { body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { body = null; }
        const parsed = validateAdminRelease(body); if (!parsed.ok) return json(400, { error: parsed.error });
        try { return json(200, await releaseSeat(env, parsed.value)); }
        catch (error) {
          if (error?.code === "release_rejected") return json(409, { error: error.code });
          throw error;
        }
      }
      if (request.method === "POST" && ["/api/player-tools/admin/inspect-license", "/api/player-tools/admin/reconcile-seat"].includes(url.pathname)) {
        const authorization = request.headers.get("authorization") || "";
        const expected = env.ADMIN_TOKEN ? `Bearer ${env.ADMIN_TOKEN}` : "";
        if (!expected || !equals(authorization, expected)) return json(403, { error: "admin_forbidden" });
        const raw = await readBody(request, MAX_BODY_BYTES);
        let body; try { body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { body = null; }
        const parsed = validateAdminLicense(body, { installation: url.pathname.endsWith("reconcile-seat") });
        if (!parsed.ok) return json(400, { error: parsed.error });
        if (url.pathname.endsWith("inspect-license")) return json(200, await inspectLicense(env, parsed.value.licenseKey));
        return json(200, await reconcileSeat(env, parsed.value));
      }
      const origin = allowedOrigin(request, env);
      if (!origin) return json(403, { error: "origin_not_allowed" });
      const corsHeaders = cors(origin);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      const raw = await readBody(request, MAX_BODY_BYTES);
      let body; try { body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { body = null; }
      if (request.method === "POST" && url.pathname === "/api/player-tools/checkout") {
        const parsed = validateCheckout(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "CHECKOUT_RATE_LIMITER", "checkout", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        const checkoutUrl = await createCheckout(env, parsed.value); return json(200, { checkoutUrl }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/activate") {
        const parsed = validateActivation(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "LICENSE_RATE_LIMITER", "activate", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        const entitlement = await activate(env, parsed.value);
        if (entitlement?.kind === 'active' || (entitlement?.licenseId && entitlement?.instanceId)) return json(200, { active: true, serverTime: now(), licenseId: entitlement.licenseId, instanceId: entitlement.instanceId,
          receipt: await proReceipt(env, { installationId: parsed.value.installationId, licenseId: entitlement.licenseId, instanceId: entitlement.instanceId }) }, corsHeaders);
        if (entitlement?.kind === 'seat_limit') return json(409, { active: false, error: 'seat_limit' }, corsHeaders);
        if (entitlement?.kind === 'in_progress') return json(409, { active: false, error: 'activation_in_progress' }, corsHeaders);
        if (entitlement?.kind === 'revoked') return json(403, { active: false, error: 'license_revoked' }, corsHeaders);
        if (entitlement?.kind === 'credential_mismatch') return json(403, { active: false, error: 'activation_failed' }, corsHeaders);
        return json(403, { active: false, error: "activation_failed" }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/restore") {
        const parsed = validateActivation(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "LICENSE_RATE_LIMITER", "restore", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        const entitlement = await restore(env, parsed.value);
        if (entitlement?.kind === 'active' || (entitlement?.licenseId && entitlement?.instanceId)) return json(200, { active: true, serverTime: now(), licenseId: entitlement.licenseId, instanceId: entitlement.instanceId,
          receipt: await proReceipt(env, { installationId: parsed.value.installationId, licenseId: entitlement.licenseId, instanceId: entitlement.instanceId }) }, corsHeaders);
        if (entitlement?.kind === 'seat_limit') return json(409, { active: false, error: 'seat_limit' }, corsHeaders);
        if (entitlement?.kind === 'in_progress') return json(409, { active: false, error: 'activation_in_progress' }, corsHeaders);
        if (entitlement?.kind === 'revoked') return json(403, { active: false, error: 'license_revoked' }, corsHeaders);
        if (entitlement?.kind === 'credential_mismatch') return json(403, { active: false, error: 'activation_failed' }, corsHeaders);
        return json(403, { active: false, error: "activation_failed" }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/license/status") {
        const parsed = validateStatus(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "LICENSE_RATE_LIMITER", "status", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        const result = await status(env, parsed.value);
        if (result.reason === "license_revoked") return json(403, { active: false, error: result.reason }, corsHeaders);
        return json(200, result, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/trial/start") {
        const parsed = validateTrialStart(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "TRIAL_RATE_LIMITER", "trial-start", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        return json(200, await startTrial(env, parsed.value), corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/trial/consume") {
        const parsed = validateTrialConsume(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "TRIAL_RATE_LIMITER", "trial-consume", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
        const result = await consumeTrial(env, parsed.value);
        return json(result.allowed ? 200 : 409, result.allowed ? result : { ...result, error: result.reason }, corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/player-tools/events") {
        const parsed = validateEvent(body); if (!parsed.ok) return json(400, { error: parsed.error }, corsHeaders);
        if (!(await enforceRateLimit(env, "EVENT_RATE_LIMITER", "events", request, parsed.value.installationId)))
          return json(429, { error: "rate_limited" }, { ...corsHeaders, "retry-after": "60" });
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
