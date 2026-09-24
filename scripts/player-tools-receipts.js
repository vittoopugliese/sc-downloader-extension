/* Verification for server-issued ES256 access receipts. The source tree uses
 * the Test Mode public key; the packager replaces it with the selected
 * environment's public JWK. Private signing material never enters the extension. */
(function (root) {
  "use strict";
  const PACKAGED_ENTITLEMENT_PUBLIC_JWK = Object.freeze({"keys":[{"kty":"EC","x":"5GzHukBSSLNF68uaBVAPv1j7cTortu1O78FnobWhDb4","y":"qRiRyTjbXx1gLiDSYEEsgDHY7FHw_eKLrefAA9kfxQ0","crv":"P-256","kid":"p256-test-2026-09"}]});

  function bytes(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid receipt encoding.");
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function claims(receipt) {
    if (!receipt || receipt.algorithm !== "ES256" || typeof receipt.keyId !== "string" ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(receipt.keyId) ||
        typeof receipt.payload !== "string" || typeof receipt.signature !== "string") {
      throw new Error("Licensing returned an invalid signed receipt.");
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes(receipt.payload)));
    if (!parsed || parsed.version !== 1 || !["pro", "trial"].includes(parsed.type) ||
        !Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt)) {
      throw new Error("Licensing returned invalid receipt claims.");
    }
    return parsed;
  }

  function verificationKey(configured, keyId) {
    const keys = Array.isArray(configured?.keys) ? configured.keys : configured ? [configured] : [];
    const matches = keys.filter((key) => key?.kty === "EC" && key?.crv === "P-256" && key?.kid === keyId &&
      typeof key.x === "string" && typeof key.y === "string" && !key.d);
    if (matches.length !== 1) {
      throw Object.assign(new Error("The entitlement receipt uses an unknown signing key."), { code: "receipt-key-unknown" });
    }
    return matches[0];
  }

  async function verify(receipt, options = {}) {
    const configured = options.publicJwk || PACKAGED_ENTITLEMENT_PUBLIC_JWK;
    if (!configured) throw Object.assign(new Error("Entitlement verification is not configured."), { code: "receipt-key-missing" });
    const parsed = claims(receipt);
    const publicJwk = verificationKey(configured, receipt.keyId);
    const key = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      bytes(receipt.signature), new TextEncoder().encode(receipt.payload));
    if (!valid) throw Object.assign(new Error("The entitlement receipt signature is invalid."), { code: "receipt-invalid" });
    if (options.installationId && parsed.installationId !== options.installationId) {
      throw Object.assign(new Error("The entitlement receipt belongs to another installation."), { code: "receipt-installation-mismatch" });
    }
    return parsed;
  }

  root.SCPlayerToolsReceipts = { verify, claims, verificationKey };
  if (typeof module !== "undefined") module.exports = root.SCPlayerToolsReceipts;
})(globalThis);
