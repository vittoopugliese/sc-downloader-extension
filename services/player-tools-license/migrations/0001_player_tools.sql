CREATE TABLE IF NOT EXISTS licenses (
  lemon_license_id TEXT PRIMARY KEY,
  lemon_order_id TEXT UNIQUE,
  lemon_customer_id TEXT,
  lemon_key_hash TEXT UNIQUE,
  customer_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS activations (
  lemon_instance_id TEXT PRIMARY KEY,
  lemon_license_id TEXT NOT NULL REFERENCES licenses(lemon_license_id),
  installation_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  last_validated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  UNIQUE(lemon_license_id, installation_id)
);

CREATE INDEX IF NOT EXISTS activations_installation
  ON activations (installation_id, deactivated_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_hash TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
