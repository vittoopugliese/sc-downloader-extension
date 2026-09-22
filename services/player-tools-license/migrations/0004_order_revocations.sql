-- A refund can arrive before the matching order or activation is stored.
-- Keep a permanent, order-scoped tombstone so delayed events cannot restore Pro.
CREATE TABLE IF NOT EXISTS order_revocations (
  lemon_order_id TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL,
  provider_event_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('full_refund', 'manual'))
);

CREATE INDEX IF NOT EXISTS order_revocations_provider_event
  ON order_revocations (provider_event_at);

-- Claims are owner-scoped so an expired Worker cannot complete or release a
-- claim that a newer delivery has already recovered.
ALTER TABLE webhook_events ADD COLUMN processing_token TEXT;
ALTER TABLE webhook_events ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
