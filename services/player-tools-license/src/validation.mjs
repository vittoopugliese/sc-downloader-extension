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

export function validateTrialStart(value) {
  const installationId = text(value?.installationId, 128);
  return installationId && /^[a-zA-Z0-9_-]{16,128}$/.test(installationId)
    ? { ok: true, value: { installationId } }
    : { ok: false, error: "invalid_request" };
}

export function validateTrialConsume(value) {
  const installationId = text(value?.installationId, 128);
  const requestId = text(value?.requestId, 128);
  const trackIdentity = text(value?.trackIdentity, 1024);
  return installationId && requestId && trackIdentity &&
      /^[a-zA-Z0-9_-]{16,128}$/.test(installationId)
    ? { ok: true, value: { installationId, requestId, trackIdentity } }
    : { ok: false, error: "invalid_request" };
}

export function validateAdminRelease(value) {
  const installationId = text(value?.installationId, 128);
  const licenseKey = text(value?.licenseKey, 256);
  if (!installationId || !licenseKey || !/^[a-zA-Z0-9_-]{16,128}$/.test(installationId)) {
    return { ok: false, error: "invalid_request" };
  }
  return { ok: true, value: { installationId, licenseKey, dryRun: value?.dryRun === true } };
}

const EVENT_NAMES = new Set([
  "player_tools_promo_seen", "player_tools_opened", "player_tools_value_reached",
  "pro_feature_attempted", "paywall_seen", "checkout_started", "license_activated",
  "download_job_completed",
]);
const EVENT_PROPERTIES = new Set(["surface", "locale", "plan", "trialState", "origin", "category", "feature", "cause", "result", "type", "count"]);

export function validateEvent(value) {
  const eventId = text(value?.eventId, 128);
  const installationId = text(value?.installationId, 128);
  const name = text(value?.name, 64);
  const version = text(value?.version, 32);
  const offer = text(value?.offer, 64);
  const occurredAt = value?.occurredAt;
  if (!eventId || !/^[a-zA-Z0-9_-]{16,128}$/.test(installationId || "") || !EVENT_NAMES.has(name) ||
      !Number.isSafeInteger(occurredAt) || occurredAt < 0 || !version || !offer ||
      !value.properties || Array.isArray(value.properties) || typeof value.properties !== "object") {
    return { ok: false, error: "invalid_request" };
  }
  const properties = {};
  for (const [key, item] of Object.entries(value.properties)) {
    if (!EVENT_PROPERTIES.has(key)) return { ok: false, error: "invalid_request" };
    if (key === "count") {
      if (!Number.isSafeInteger(item) || item < 0 || item > 10000) return { ok: false, error: "invalid_request" };
    } else if (typeof item !== "string" || item.length > 64) return { ok: false, error: "invalid_request" };
    properties[key] = item;
  }
  return { ok: true, value: { eventId, installationId, name, occurredAt, version, offer, properties } };
}
