ALTER TABLE webhook_events ADD COLUMN processing_started_at INTEGER;
ALTER TABLE webhook_events ADD COLUMN processed_at INTEGER;
ALTER TABLE webhook_events ADD COLUMN processing_error TEXT;

CREATE INDEX IF NOT EXISTS webhook_events_recovery
  ON webhook_events (processed_at, processing_started_at);
