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
  by validating the key and reconciling the existing remote instance before a
  retry can create another one.
- Status reconciliation against Lemon's license and instance records, plus
  refund/revocation propagation. Temporary provider failures do not revoke a
  purchase, and a missing instance deactivates only that profile.
- ES256-signed Pro receipts scoped to installation/license/instance and valid
  for thirty days. The extension verifies the signature and requires an online
  renewal after expiry.
- A D1-authoritative seven-day/twenty-loop trial with idempotent consumption and a signed, six-hour maximum grant for finishing the last active loop.
- Separate Cloudflare rate-limit bindings for trial, license, checkout and event routes. Keys hash route and IP so rotating a client-selected installation ID does not bypass the limit; test/live use distinct namespaces. CORS remains an origin restriction, not authentication.
- An authenticated support command that previews or releases a profile in
  Lemon first and updates D1 only after the provider confirms deactivation.
- A strict event allow-list that rejects track titles, music URLs, emails and keys.
- CORS restricted to the published extension origin.

The current trial subject is still the local installation ID. That prevents ordinary message/storage replay in the official package, but it cannot enforce one trial across reinstallations. Do not describe the trial as reinstall-proof until a server-verifiable account subject is integrated; IP address, a client-declared SoundCloud ID and browser fingerprinting are intentionally not treated as identity.

## Production setup

1. Generate independent test and production signing keys. Keep the
   `.dev.vars.entitlement.*` files private; each contains its matching key ID
   and private JWK. Supply only the matching public JWKS as
   `ENTITLEMENT_PUBLIC_JWK` when packaging that environment:

   ```text
   npm run keys:generate -- p256-test-YYYY-MM test
   npm run keys:generate -- p256-live-YYYY-MM production
   ```
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace every
   `REPLACE_WITH_...` value. Keep the real config free of secrets. The default
   Worker is `sctd-player-tools-license-test` on the test-only route; the
   `production` environment uses a different Worker name, route, D1 binding,
   Lemon IDs and Chrome extension origin. Wrangler does not inherit `vars`,
   secrets declarations or resource bindings into named environments, so keep
   both blocks complete.
3. Run `npm install` in this directory to install Wrangler 4, authenticate, and
   create both D1 databases. Copy only the returned non-secret database IDs to
   the corresponding config blocks:

   ```text
   npx wrangler login
   npx wrangler d1 create sctd-player-tools-test
   npx wrangler d1 create sctd-player-tools-production
   npm run preflight
   npm run preflight -- --env production
   ```
4. Add secrets interactively; never put their values in the config:

   ```text
   npx wrangler secret put LEMON_API_KEY
   npx wrangler secret put LEMON_WEBHOOK_SECRET
   npx wrangler secret put ENTITLEMENT_PRIVATE_JWK
   npx wrangler secret put ADMIN_TOKEN

   npx wrangler secret put LEMON_API_KEY --env production
   npx wrangler secret put LEMON_WEBHOOK_SECRET --env production
   npx wrangler secret put ENTITLEMENT_PRIVATE_JWK --env production
   npx wrangler secret put ADMIN_TOKEN --env production
   ```

5. Apply migrations and validate a dry run before deployment:

   ```text
   npx wrangler d1 migrations apply sctd-player-tools-test --remote
   npm run deploy:dry:test
   npx wrangler deploy

   npx wrangler d1 migrations apply sctd-player-tools-production --remote --env production
   npm run deploy:dry:production
   npx wrangler deploy --env production
   ```

6. Configure separate Lemon Squeezy Test Mode and Live Mode webhooks. Both send
   `order_created`, `order_refunded` and `license_key_updated`. Test sends to
   `https://sctd-test.vpugliese.online/api/player-tools/webhooks/lemon`; live sends to
   `https://sctd.vpugliese.online/api/player-tools/webhooks/lemon`.
   Unknown license IDs and resources outside the configured store/product are
   rejected before mutation. Each webhook uses the secret installed only in its
   matching Worker environment.

`GET /api/player-tools/health` returns `ready` only when required configuration
is present and all eight expected D1 tables exist. It intentionally does not
perform a paid-provider transaction; the sandbox gate below remains required.

When packaging an extension for either environment, explicitly inject both the
matching endpoint and public JWKS. The packager disables the local `1`/`1` test
login and adds the selected API origin to the staged manifest:

```text
PLAYER_TOOLS_API_BASE_URL=https://sctd-test.vpugliese.online/api/player-tools \
ENTITLEMENT_PUBLIC_JWK="$(cat entitlement-public.test.jwk.json)" npm --prefix ../.. run package:extension
```

Use the production endpoint only for the release candidate. Never package a
test endpoint or test public key into the Web Store artifact.

Support can inspect a release without mutation and then apply it:

```text
PLAYER_TOOLS_ADMIN_URL=https://sctd.vpugliese.online/api/player-tools \
PLAYER_TOOLS_ADMIN_TOKEN=... npm run seat:release -- INSTALLATION_ID LICENSE_KEY preview
PLAYER_TOOLS_ADMIN_URL=https://sctd.vpugliese.online/api/player-tools \
PLAYER_TOOLS_ADMIN_TOKEN=... npm run seat:release -- INSTALLATION_ID LICENSE_KEY apply
```

Inspection returns only identifiers and activation timestamps; it never returns
the submitted license key. Reconciliation asks Lemon whether one local seat is
still active before changing D1, so it is the safe first action when support
reports a stale profile:

```text
PLAYER_TOOLS_ADMIN_URL=https://sctd.vpugliese.online/api/player-tools \
PLAYER_TOOLS_ADMIN_TOKEN=... npm run license:admin -- inspect LICENSE_KEY
PLAYER_TOOLS_ADMIN_URL=https://sctd.vpugliese.online/api/player-tools \
PLAYER_TOOLS_ADMIN_TOKEN=... npm run license:admin -- reconcile LICENSE_KEY INSTALLATION_ID
```

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

## Signing-key rotation

Receipts select their verification key by `keyId`; the packaged public value
may be a single JWK or a JWKS containing multiple public keys. Rotate in phases:

1. Generate the next key with a new ID and add its public JWK to the existing
   JWKS without removing the old one.
2. Publish that overlapping JWKS in the extension and wait for the required
   client adoption window.
3. Install the new private JWK and matching `ENTITLEMENT_KEY_ID` in the Worker,
   then deploy. Never switch the signer before supported clients trust it.
4. Keep the old public key for at least the thirty-day maximum receipt lifetime
   after the last old-key receipt was issued. Remove it only in a later package.

An old extension that never received the new public key cannot renew a receipt
signed by it, so forced rotations also require an extension-update policy.

Run `npm test` in this directory for request-shape validation. The repository's
`npm run test:player-tools` additionally verifies the extension commerce and
entitlement lifecycle with a simulated provider.
