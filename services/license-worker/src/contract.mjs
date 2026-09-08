export const ENTITLEMENT_SCHEMA_VERSION = 1;
export const LOOPER_CAPABILITIES = Object.freeze(["looper", "loop_export"]);

const RESTORE_EMAIL_LIMIT = 320;
const LICENSE_KEY_LIMIT = 512;
const INSTALLATION_ID_LIMIT = 128;

function invalid(field, message) {
  return { ok: false, field, message };
}

function nonEmptyString(value, limit) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

export function validateRestoreRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("body", "Expected a JSON object.");
  }
  if (!nonEmptyString(value.purchaseEmail, RESTORE_EMAIL_LIMIT)) {
    return invalid("purchaseEmail", "A purchase email is required.");
  }
  if (!nonEmptyString(value.licenseKey, LICENSE_KEY_LIMIT)) {
    return invalid("licenseKey", "A license key is required.");
  }
  if (!nonEmptyString(value.installationId, INSTALLATION_ID_LIMIT)) {
    return invalid("installationId", "An installation ID is required.");
  }

  return {
    ok: true,
    value: {
      purchaseEmail: value.purchaseEmail.trim(),
      licenseKey: value.licenseKey.trim(),
      installationId: value.installationId.trim(),
    },
  };
}

export function createEntitlement({ licenseId, subject, issuedAt, expiresAt, capabilities = LOOPER_CAPABILITIES }) {
  if (!nonEmptyString(licenseId, 128)) throw new TypeError("licenseId is required");
  if (!nonEmptyString(subject, 128)) throw new TypeError("subject is required");
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new RangeError("issuedAt and expiresAt must be ordered integer timestamps");
  }
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((capability) => !LOOPER_CAPABILITIES.includes(capability))) {
    throw new TypeError("capabilities must be supported Looper capabilities");
  }

  return {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    licenseId,
    subject,
    capabilities: [...new Set(capabilities)],
    issuedAt,
    expiresAt,
  };
}

export function accessFromEntitlement(entitlement, now) {
  if (!entitlement || typeof entitlement !== "object") {
    return { state: "verification_required", canActivateLooper: false, canExportLoop: false };
  }
  const isCurrent = Number.isInteger(entitlement.expiresAt) && entitlement.expiresAt > now;
  const capabilities = Array.isArray(entitlement.capabilities) ? entitlement.capabilities : [];
  const hasLooper = capabilities.includes("looper");
  const hasExport = capabilities.includes("loop_export");

  if (!isCurrent || !hasLooper || !hasExport) {
    return { state: "verification_required", canActivateLooper: false, canExportLoop: false };
  }

  return { state: "active", canActivateLooper: true, canExportLoop: true };
}
