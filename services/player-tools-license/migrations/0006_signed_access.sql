-- Server-authoritative trial state for one locally generated Chrome-profile
-- installation ID. Replays with that ID receive the existing window and usage
-- count. A reinstall can generate a new ID because the product deliberately
-- has no account requirement or browser fingerprinting.
CREATE TABLE IF NOT EXISTS trials (
  installation_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 20),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_consumptions (
  installation_id TEXT NOT NULL REFERENCES trials(installation_id),
  request_id TEXT NOT NULL,
  track_identity_hash TEXT NOT NULL,
  operation_token TEXT NOT NULL UNIQUE,
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, request_id)
);

CREATE INDEX IF NOT EXISTS trial_consumptions_installation
  ON trial_consumptions (installation_id, consumed_at);
