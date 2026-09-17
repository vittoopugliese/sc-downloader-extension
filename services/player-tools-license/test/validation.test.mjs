import assert from "node:assert/strict";
import test from "node:test";
import { validateActivation, validateCheckout, validateEvent, validateStatus } from "../src/validation.mjs";

const installationId = "installation_1234567890";

test("validates commerce requests", () => {
  assert.equal(validateCheckout({ installationId, locale: "es-AR" }).ok, true);
  assert.equal(validateActivation({ installationId, email: "Buyer@Example.com", licenseKey: "key" }).value.email, "buyer@example.com");
  assert.equal(validateStatus({ installationId, instanceId: "instance-1" }).ok, true);
  assert.equal(validateCheckout({ installationId: "short" }).ok, false);
});

test("accepts only the documented anonymous funnel shape", () => {
  const base = { eventId: "event_123456789012", installationId, name: "checkout_started",
    occurredAt: 1_800_000_000_000, version: "1.2.3", offer: "founder-2026-09", properties: { surface: "popup" } };
  assert.equal(validateEvent(base).ok, true);
  assert.equal(validateEvent({ ...base, name: "track_played" }).ok, false);
  assert.equal(validateEvent({ ...base, properties: { trackUrl: "https://soundcloud.com/private" } }).ok, false);
  assert.equal(validateEvent({ ...base, properties: { count: 10001 } }).ok, false);
});
