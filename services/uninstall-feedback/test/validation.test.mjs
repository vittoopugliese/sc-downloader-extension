import assert from "node:assert/strict";
import test from "node:test";
import { MAX_COMMENT_LENGTH, validateFeedback } from "../src/validation.mjs";
import worker from "../src/index.mjs";

const valid = {
  reason: "missing_feature", comment: "Please add folders", email: "person@example.com",
  submissionId: "4ca2e6f1-9c80-44ca-b80c-1d4d5f111111", locale: "en-US", extensionVersion: "2026.9.5", turnstileToken: "token",
};

test("accepts bounded optional uninstall feedback", () => {
  const result = validateFeedback(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.comment, "Please add folders");
});

test("rejects unknown reasons, bad email and oversized comments", () => {
  assert.equal(validateFeedback({ ...valid, reason: "tracking" }).ok, false);
  assert.equal(validateFeedback({ ...valid, email: "not-an-email" }).error, "invalid_email");
  assert.equal(validateFeedback({ ...valid, comment: "x".repeat(MAX_COMMENT_LENGTH + 1) }).error, "invalid_field");
});

test("exposes only health and the public Turnstile configuration", async () => {
  const env = { FEEDBACK_DB: {}, TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site-key" };
  const health = await worker.fetch(new Request("https://sctd.vpugliese.online/health"), env);
  assert.deepEqual(await health.json(), { service: "sctd-uninstall-feedback", status: "ready" });
  const config = await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback/config"), env);
  assert.deepEqual(await config.json(), { turnstileSiteKey: "site-key" });
  const missing = await worker.fetch(new Request("https://sctd.vpugliese.online/private"), env);
  assert.equal(missing.status, 404);
});
