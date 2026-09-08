import { clientAddress, validateFeedback } from "./validation.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const RETENTION_DAYS = 180;

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function isHuman(token, request, env) {
  if (!env.TURNSTILE_SECRET) return false;
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: clientAddress(request) }),
  });
  return verification.ok && (await verification.json()).success === true;
}

async function acceptFeedback(request, env) {
  const body = await request.json().catch(() => null);
  const validation = validateFeedback(body);
  if (!validation.ok) return response(400, { error: validation.error });
  if (!(await isHuman(validation.value.turnstileToken, request, env))) {
    return response(403, { error: "verification_failed" });
  }

  const now = Date.now();
  const ip = clientAddress(request);
  const since = now - 60 * 60 * 1_000;
  const rate = await env.FEEDBACK_DB.prepare(
    "SELECT COUNT(*) AS count FROM uninstall_feedback WHERE ip_address = ? AND created_at >= ?"
  ).bind(ip, since).first();
  if (Number(rate?.count || 0) >= 5) return response(429, { error: "rate_limited" });

  const feedback = validation.value;
  const result = await env.FEEDBACK_DB.prepare(
    `INSERT INTO uninstall_feedback
      (submission_id, reason, comment, email, locale, extension_version, ip_address, created_at, delete_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(submission_id) DO NOTHING`
  ).bind(
    feedback.submissionId, feedback.reason, feedback.comment || null, feedback.email || null,
    feedback.locale || null, feedback.extensionVersion || null, ip, now,
    now + RETENTION_DAYS * 24 * 60 * 60 * 1_000
  ).run();
  return response(200, { accepted: true, duplicate: Number(result.meta?.changes || 0) === 0 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return response(200, { service: "sctd-uninstall-feedback", status: env.FEEDBACK_DB && env.TURNSTILE_SECRET ? "ready" : "not-configured" });
    }
    if (request.method === "GET" && url.pathname === "/api/uninstall-feedback/config") {
      return response(200, { turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
    }
    if (request.method === "POST" && url.pathname === "/api/uninstall-feedback") return acceptFeedback(request, env);
    return response(404, { error: "not_found" });
  },
  async scheduled(_event, env) {
    await env.FEEDBACK_DB.prepare("DELETE FROM uninstall_feedback WHERE delete_after <= ?").bind(Date.now()).run();
  },
};
