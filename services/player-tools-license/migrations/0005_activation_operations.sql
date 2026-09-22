-- A seat is reserved before contacting Lemon. This makes the two-profile
-- limit a D1 invariant rather than a best-effort check after a remote call.
CREATE TABLE IF NOT EXISTS activation_operations (
  license_key_hash TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  lemon_license_id TEXT,
  lemon_instance_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending', 'active')),
  lease_token TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (license_key_hash, installation_id),
  UNIQUE(lemon_instance_id)
);

CREATE INDEX IF NOT EXISTS activation_operations_capacity
  ON activation_operations (license_key_hash, state);

CREATE INDEX IF NOT EXISTS activation_operations_recovery
  ON activation_operations (state, lease_expires_at);
