import assert from "node:assert/strict";
import test from "node:test";
import {
  LOOPER_CAPABILITIES,
  accessFromEntitlement,
  createEntitlement,
  validateRestoreRequest,
} from "../src/contract.mjs";

test("restore requests require bounded email, license key and installation ID", () => {
  assert.deepEqual(validateRestoreRequest(null), {
    ok: false,
    field: "body",
    message: "Expected a JSON object.",
  });
  assert.equal(validateRestoreRequest({ purchaseEmail: "buyer@example.com", licenseKey: "key" }).field, "installationId");

  const restored = validateRestoreRequest({
    purchaseEmail: " buyer@example.com ",
    licenseKey: " key-123 ",
    installationId: " install-123 ",
  });
  assert.deepEqual(restored, {
    ok: true,
    value: {
      purchaseEmail: "buyer@example.com",
      licenseKey: "key-123",
      installationId: "install-123",
    },
  });
});

test("a current complete entitlement is the only source of active Looper access", () => {
  const entitlement = createEntitlement({
    licenseId: "license-1",
    subject: "installation-1",
    issuedAt: 1_000,
    expiresAt: 2_000,
  });
  assert.deepEqual(entitlement.capabilities, LOOPER_CAPABILITIES);
  assert.deepEqual(accessFromEntitlement(entitlement, 1_999), {
    state: "active",
    canActivateLooper: true,
    canExportLoop: true,
  });
  assert.deepEqual(accessFromEntitlement(entitlement, 2_000), {
    state: "verification_required",
    canActivateLooper: false,
    canExportLoop: false,
  });
  assert.throws(
    () => createEntitlement({ licenseId: "license-1", subject: "install-1", issuedAt: 2_000, expiresAt: 2_000 }),
    /ordered integer timestamps/
  );
});
