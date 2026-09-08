import assert from "node:assert/strict";
import test from "node:test";
import { MAX_COMMENT_LENGTH, validateFeedback } from "../src/validation.mjs";
import worker from "../src/index.mjs";

const valid = {
  reason: "missing_feature", comment: "Please add folders", email: "person@example.com",
  submissionId: "4ca2e6f1-9c80-44ca-b80c-1d4d5f111111", locale: "en-US", extensionVersion: "2026.9.5", turnstileToken: "token",
};

function createDatabase({ count = 0, insertChanges = 1 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            first: async () => ({ count }),
            run: async () => ({ meta: { changes: sql.startsWith("INSERT") ? insertChanges : 1 } }),
          };
        },
      };
    },
  };
}

async function postFeedback(database, options = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: options.human ?? true,
    hostname: options.hostname ?? "sctd.vpugliese.online",
    action: options.action ?? "uninstall_feedback",
  }), { status: 200 });
  try {
    return await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.9",
        origin: "https://sctd.vpugliese.online",
      },
      body: JSON.stringify({ ...valid, ...options.feedback }),
    }), {
      FEEDBACK_DB: database,
      TURNSTILE_SECRET: "secret",
      RATE_LIMIT_SALT: "test-rate-limit-secret",
      ALLOWED_HOSTNAME: "sctd.vpugliese.online",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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
  const env = {
    FEEDBACK_DB: {},
    TURNSTILE_SECRET: "secret",
    TURNSTILE_SITE_KEY: "site-key",
    RATE_LIMIT_SALT: "rate-limit-secret",
    ALLOWED_HOSTNAME: "sctd.vpugliese.online",
  };
  const health = await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback/health"), env);
  assert.deepEqual(await health.json(), { service: "sctd-uninstall-feedback", status: "ready" });
  const config = await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback/config"), env);
  assert.deepEqual(await config.json(), { turnstileSiteKey: "site-key" });
  const missing = await worker.fetch(new Request("https://sctd.vpugliese.online/private"), env);
  assert.equal(missing.status, 404);
});

test("stores verified feedback and reports an idempotent duplicate", async () => {
  const acceptedDatabase = createDatabase();
  const accepted = await postFeedback(acceptedDatabase);
  assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false });
  assert.equal(acceptedDatabase.calls.length, 2);
  assert.match(acceptedDatabase.calls[1].sql, /^INSERT INTO uninstall_feedback/);
  assert.match(acceptedDatabase.calls[1].values[6], /^[a-f0-9]{64}$/);
  assert.notEqual(acceptedDatabase.calls[1].values[6], "203.0.113.9");

  const duplicate = await postFeedback(createDatabase({ insertChanges: 0 }));
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });
});

test("rejects bots and limits a source address before inserting", async () => {
  const botDatabase = createDatabase();
  const bot = await postFeedback(botDatabase, { human: false });
  assert.deepEqual(await bot.json(), { error: "verification_failed" });
  assert.equal(botDatabase.calls.length, 0);

  const limitedDatabase = createDatabase({ count: 5 });
  const limited = await postFeedback(limitedDatabase);
  assert.deepEqual(await limited.json(), { error: "rate_limited" });
  assert.equal(limitedDatabase.calls.length, 1);
});

test("rejects requests from another origin and mismatched Turnstile metadata", async () => {
  const database = createDatabase();
  const wrongHostname = await postFeedback(database, { hostname: "attacker.example" });
  assert.equal(wrongHostname.status, 403);
  assert.deepEqual(await wrongHostname.json(), { error: "verification_failed" });

  const wrongAction = await postFeedback(database, { action: "login" });
  assert.equal(wrongAction.status, 403);
  assert.deepEqual(await wrongAction.json(), { error: "verification_failed" });

  const response = await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify(valid),
  }), {
    ALLOWED_HOSTNAME: "sctd.vpugliese.online",
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
});

test("rejects oversized request bodies before verification", async () => {
  const response = await worker.fetch(new Request("https://sctd.vpugliese.online/api/uninstall-feedback", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://sctd.vpugliese.online" },
    body: JSON.stringify({ ...valid, padding: "x".repeat(17_000) }),
  }), {
    ALLOWED_HOSTNAME: "sctd.vpugliese.online",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_body" });
});

test("scheduled cleanup removes feedback after the documented retention deadline", async () => {
  const database = createDatabase();
  await worker.scheduled({}, { FEEDBACK_DB: database });
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].sql, /^DELETE FROM uninstall_feedback/);
  assert.equal(typeof database.calls[0].values[0], "number");
});
