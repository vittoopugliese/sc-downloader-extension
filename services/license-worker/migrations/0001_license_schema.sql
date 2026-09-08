-- E5B private foundation. Raw payment credentials, email addresses, license keys,
-- installation IDs and webhook bodies are intentionally not stored in D1.

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_license_ref TEXT NOT NULL UNIQUE,
  provider_order_ref TEXT UNIQUE,
  license_key_digest TEXT NOT NULL UNIQUE,
  product_variant TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'refunded', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  installation_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  UNIQUE (license_id, installation_digest)
);

CREATE INDEX IF NOT EXISTS activations_active_by_license
  ON activations (license_id, deactivated_at, last_seen_at);

CREATE TABLE IF NOT EXISTS provider_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  outcome TEXT,
  PRIMARY KEY (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS checkout_pairings (
  id TEXT PRIMARY KEY,
  pairing_token_digest TEXT NOT NULL UNIQUE,
  installation_digest TEXT NOT NULL,
  provider_checkout_ref TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'paid', 'expired', 'cancelled')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
