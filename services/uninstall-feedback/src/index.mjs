import { clientAddress, validateFeedback } from "./validation.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const RETENTION_DAYS = 180;
const MAX_BODY_BYTES = 16_384;
const TURNSTILE_ACTION = "uninstall_feedback";

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function isHuman(token, request, env) {
  if (!env.TURNSTILE_SECRET) return false;
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: clientAddress(request) }),
  });
  if (!verification.ok) return false;
  const result = await verification.json();
  return result.success === true
    && result.hostname === env.ALLOWED_HOSTNAME
    && result.action === TURNSTILE_ACTION;
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let json = "";
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function hashAddress(address, secret) {
  if (!secret) throw new Error("RATE_LIMIT_SALT is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function acceptFeedback(request, env) {
  if (request.headers.get("origin") !== `https://${env.ALLOWED_HOSTNAME}`) {
    return response(403, { error: "origin_not_allowed" });
  }
  const body = await readJsonBody(request);
  const validation = validateFeedback(body);
  if (!validation.ok) return response(400, { error: validation.error });
  if (!(await isHuman(validation.value.turnstileToken, request, env))) {
    return response(403, { error: "verification_failed" });
  }

  const now = Date.now();
  const ip = clientAddress(request);
  const ipHash = await hashAddress(ip, env.RATE_LIMIT_SALT);
  const since = now - 60 * 60 * 1_000;
  const rate = await env.FEEDBACK_DB.prepare(
    "SELECT COUNT(*) AS count FROM uninstall_feedback WHERE ip_hash = ? AND created_at >= ?"
  ).bind(ipHash, since).first();
  if (Number(rate?.count || 0) >= 5) return response(429, { error: "rate_limited" });

  const feedback = validation.value;
  const result = await env.FEEDBACK_DB.prepare(
    `INSERT INTO uninstall_feedback
      (submission_id, reason, comment, email, locale, extension_version, ip_hash, created_at, delete_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(submission_id) DO NOTHING`
  ).bind(
    feedback.submissionId, feedback.reason, feedback.comment || null, feedback.email || null,
    feedback.locale || null, feedback.extensionVersion || null, ipHash, now,
    now + RETENTION_DAYS * 24 * 60 * 60 * 1_000
  ).run();
  return response(200, { accepted: true, duplicate: Number(result.meta?.changes || 0) === 0 });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/uninstall-feedback/health") {
        const ready = env.FEEDBACK_DB && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY
          && env.RATE_LIMIT_SALT && env.ALLOWED_HOSTNAME;
        return response(200, { service: "sctd-uninstall-feedback", status: ready ? "ready" : "not-configured" });
      }
      if (request.method === "GET" && url.pathname === "/api/uninstall-feedback/config") {
        return response(200, { turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
      }
      if (request.method === "POST" && url.pathname === "/api/uninstall-feedback") return await acceptFeedback(request, env);
      return response(404, { error: "not_found" });
    } catch (error) {
      console.error(JSON.stringify({ message: "uninstall feedback request failed", error: error instanceof Error ? error.message : String(error) }));
      return response(500, { error: "internal_error" });
    }
  },
  async scheduled(_event, env) {
    try {
      await env.FEEDBACK_DB.prepare("DELETE FROM uninstall_feedback WHERE delete_after <= ?").bind(Date.now()).run();
    } catch (error) {
      console.error(JSON.stringify({ message: "uninstall feedback cleanup failed", error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  },
};
