# Database download toggle

The D1 database bound as `LICENSE_DB` stores `download_settings.all_downloads_activated`
(a row with `key = 'all_downloads_activated'`, integer column `enabled`).

- `0` (default): download only tracks whose refreshed SoundCloud metadata has
  `downloadable: true` and does not report `has_downloads_left: false`.
- `1`: use the existing download flow for all tracks, including stream downloads.

The stream conversion code and original-to-stream fallback remain in place in
both modes. Restricted mode checks eligibility; it does **not** force the original
file as the output. Selecting MP3 still downloads the stream of an eligible track.
In-memory Player Tools rendering (pads, slices, piano) uses a separate playback
resolver and remains available independently of download eligibility.

The extension reads `POST /api/player-tools/download-policy` on the same service
and environment as `SCPlayerToolsCommerce.API_BASE_URL`. Packaging already sets
that base URL through `PLAYER_TOOLS_API_BASE_URL`, so no second URL needs updating.
The endpoint uses the existing origin allowlist and does not require a Pro license.
It exposes no write operation.

The client stores the flag and its check time in `chrome.storage.local`, scoped to
the service URL, for five minutes when restricted (`false`) and seven days when
unrestricted (`true`). Opening the popup reads this shared policy and
shows a notice when only artist-enabled downloads with remaining quota are allowed.
Downloads use the same policy: repeated tracks, popup openings, and service-worker
restarts do not cause additional backend requests while that result is fresh. Concurrent
reads share one request. With no fresh result, the first popup opening or download
refreshes it; there is no background polling.

Missing settings, malformed values, network errors, timeouts, and an unavailable
service produce a restricted result, also stored for five minutes to avoid repeated
requests. An expired unrestricted result is not reused on failure. Consequently,
activation and recovery from an unsuccessful check are observed on the first use
after the five-minute window expires. Disabling an already enabled policy can take
up to seven days to appear. Existing stored results use these same windows based
on their original check time. If local storage is unavailable, caching lasts only for
the current worker lifetime. A policy change does not cancel an audio file already
being built or saved.

Bulk collection enumeration counts ineligible tracks as unavailable and records
that the returned SoundCloud metadata was checked. The queue reuses that snapshot
instead of fetching the same track metadata again. Existing queues without the
marker still refresh each track, and an expired-media retry always refreshes and
rechecks permission. Previously skipped tracks need a new collection scan after
enabling unrestricted downloads.

## Deployment

From `services/player-tools-license`, apply the migration and deploy the Worker
to the environment used by the extension. Local code changes alone do not modify
the remote database or deploy the endpoint.

```sh
# Test environment
npx wrangler d1 migrations apply LICENSE_DB --remote
npx wrangler deploy

# Production environment
npx wrangler d1 migrations apply LICENSE_DB --remote --env production
npx wrangler deploy --env production
```

For production, first finish the existing production service configuration and
use its API base URL when packaging the extension. The checked-in development
extension currently points to the test service.

In the D1 SQL console of that environment:

```sql
-- Restricted mode
UPDATE download_settings SET enabled = 0 WHERE key = 'all_downloads_activated';

-- Existing full download flow
UPDATE download_settings SET enabled = 1 WHERE key = 'all_downloads_activated';

SELECT key, enabled FROM download_settings WHERE key = 'all_downloads_activated';
```

Validation: `node scripts/verify-download-policy.js`, `npm test`, and
`npm --prefix services/player-tools-license test`.
