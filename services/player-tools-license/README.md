# Player Tools license service

Cloudflare Worker + D1 facade for Lemon Squeezy checkout, activation/recovery,
revocation and the minimal Player Tools funnel. The extension calls only this
service; Lemon credentials never ship in the extension.

## What is implemented

- Checkout creation tied to a pseudonymous installation ID.
- Signed, size-limited and deduplicated Lemon webhook ingestion.
- Idempotent activation/recovery without storing the license key in the extension.
- Status revalidation and refund/revocation propagation to the shared entitlement.
- A strict event allow-list that rejects track titles, music URLs, emails and keys.
- CORS restricted to the published extension origin.

## Production setup

1. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace every
   `REPLACE_WITH_...` value. Keep the real config free of secrets.
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

5. Configure Lemon Squeezy to send `order_created` and `order_refunded` to
   `https://sctd.vpugliese.online/api/player-tools/webhooks/lemon`.

## Sandbox reconciliation gate

Use provider test mode. A release candidate passes only when all of these are
observed once and the D1 rows agree:

1. `GET /api/player-tools/health` returns `ready`.
2. **Get Pro** opens one secure checkout; cancellation grants nothing.
3. One successful test order creates one deduplicated `order_created` webhook
   and one `purchase_confirmed` event with the same installation ID.
4. Email + license key activates Pro; repeating recovery returns the same
   license/instance without a second sale or activation.
5. Restarting the service worker and reopening the popup keeps Pro active.
6. A test refund produces `order_refunded`; the next revalidation removes Pro
   but keeps audio preferences and trial history.
7. Invalid origin, signature, product/variant, email and key all fail closed.

## Testing access

For a manual Pro test without creating an order, set these Worker secrets:

```text
wrangler secret put TEST_PRO_USERNAME
wrangler secret put TEST_PRO_PASSWORD
```

The **Testing access** section in the extension's Activate / restore dialog then
accepts those values. They remain only in the Worker: do not put them in
`wrangler.jsonc`, source code, or the extension. Remove both secrets when the
testing window ends; without them the endpoint fails closed. Use a distinct,
temporary password if this Worker is exposed to production users.

Run `npm test` in this directory for request-shape validation. The repository's
`npm run test:player-tools` additionally verifies the extension commerce and
entitlement lifecycle with a simulated provider.
