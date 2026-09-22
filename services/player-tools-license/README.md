# Player Tools license service

Cloudflare Worker + D1 facade for Lemon Squeezy checkout, activation/recovery,
revocation and the minimal Player Tools funnel. The extension calls only this
service; Lemon credentials never ship in the extension.

## What is implemented

- Checkout creation tied to a pseudonymous installation ID.
- Signed and size-limited Lemon webhook ingestion, limited to the configured
  store, first order item (product/variant), and test or live environment.
- Owner-token webhook claims, retryable overlap handling, semantic order
  upserts and durable full-refund tombstones. Partial refunds are recorded but
  intentionally require manual review.
- Activation/recovery persists the documented sibling `license_key`, `instance`
  and `meta` objects without storing the license key in the extension. A durable,
  leased reservation keyed by license hash and installation ID atomically limits
  a license to two profiles before contacting Lemon. Repeating an active profile
  returns its existing activation; an interrupted persistence can be recovered
  by retrying that same reservation after its lease. Real-provider orphan
  reconciliation remains a release blocker.
- Status reconciliation against Lemon's license and instance records, plus
  refund/revocation propagation. Signed 30-day entitlement receipts remain a
  release blocker.
- A strict event allow-list that rejects track titles, music URLs, emails and keys.
- CORS restricted to the published extension origin.

## Production setup

1. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace every
   `REPLACE_WITH_...` value. Keep the real config free of secrets. The default
   environment is Test Mode; `--env production` has its own D1 binding and
   requires separate live IDs and secrets.
2. Install Wrangler 4, authenticate, create the D1 database, and set its ID in
   the config.
3. Add secrets interactively; never put their values in the config:

   ```text
   wrangler secret put LEMON_API_KEY
   wrangler secret put LEMON_WEBHOOK_SECRET
   ```

4. Apply migrations and validate a dry run before deployment:

   ```text
   wrangler d1 migrations apply sctd-player-tools --remote
   wrangler deploy --dry-run
   wrangler deploy
   ```

5. Configure Lemon Squeezy to send **only** `order_created` and `order_refunded` to
   `https://sctd.vpugliese.online/api/player-tools/webhooks/lemon`.
   Do not enable `license_key_updated` until its reconciliation handler exists.

## Sandbox reconciliation gate

Use provider test mode. A release candidate passes only when all of these are
observed once and the D1 rows agree:

1. `GET /api/player-tools/health` returns `ready`.
2. **Get Pro** opens one secure checkout; cancellation grants nothing.
3. One successful test order creates one deduplicated `order_created` webhook
   and one `purchase_confirmed` event with the same installation ID.
4. Email + license key activates Pro; repeating recovery returns the same
   license/instance. Verify two profiles activate, a third is rejected, and a
   lost provider response can be retried without consuming another reservation.
5. Restarting the service worker and reopening the popup keeps Pro active.
6. A test refund produces `order_refunded`; the next revalidation removes Pro
   but keeps audio preferences and trial history.
7. Invalid origin, signature, product/variant, email and key all fail closed.

Run `npm test` in this directory for request-shape validation. The repository's
`npm run test:player-tools` additionally verifies the extension commerce and
entitlement lifecycle with a simulated provider.
