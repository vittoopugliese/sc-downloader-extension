const REASONS = new Set([
  "yes",
  "downloads_did_not_work",
  "confusing_to_use",
  "missing_feature",
  "pricing",
  "no_longer_needed",
  "other",
]);

export const MAX_COMMENT_LENGTH = 2_000;
export const MAX_EMAIL_LENGTH = 254;

function text(value, maximum) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : null;
}

export function validateFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "invalid_body" };
  }
  if (!REASONS.has(value.reason)) return { ok: false, error: "invalid_reason" };

  const comment = text(value.comment ?? "", MAX_COMMENT_LENGTH);
  const email = text(value.email ?? "", MAX_EMAIL_LENGTH);
  const submissionId = text(value.submissionId, 80);
  const locale = text(value.locale ?? "", 35);
  const extensionVersion = text(value.extensionVersion ?? "", 40);
  const turnstileToken = text(value.turnstileToken ?? "", 4_096);

  if (comment === null || email === null || !submissionId || locale === null || extensionVersion === null || turnstileToken === null) {
    return { ok: false, error: "invalid_field" };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_email" };
  }
  return {
    ok: true,
    value: { reason: value.reason, comment, email, submissionId, locale, extensionVersion, turnstileToken },
  };
}

export function clientAddress(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
