export const MAX_BODY_BYTES = 32_768;
export const MAX_WEBHOOK_BYTES = 262_144;

function text(value, max) {
  return typeof value === "string" && value.length <= max ? value.trim() : null;
}

export function validateCheckout(value) {
  const installationId = text(value?.installationId, 128);
  const locale = text(value?.locale || "en", 16);
  return installationId && /^[a-zA-Z0-9_-]{16,128}$/.test(installationId)
    ? { ok: true, value: { installationId, locale } }
    : { ok: false, error: "invalid_request" };
}

export function validateActivation(value) {
  const licenseKey = text(value?.licenseKey, 256);
  const email = text(value?.email, 320)?.toLowerCase();
  const installationId = text(value?.installationId, 128);
  if (!licenseKey || !email || !installationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !/^[a-zA-Z0-9_-]{16,128}$/.test(installationId)) {
    return { ok: false, error: "invalid_request" };
  }
  return { ok: true, value: { licenseKey, email, installationId } };
}

export function validateStatus(value) {
  const installationId = text(value?.installationId, 128);
  const instanceId = text(value?.instanceId, 256);
  return installationId && instanceId && /^[a-zA-Z0-9_-]{16,128}$/.test(installationId)
    ? { ok: true, value: { installationId, instanceId } }
    : { ok: false, error: "invalid_request" };
}
