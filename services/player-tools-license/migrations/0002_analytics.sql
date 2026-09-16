CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  extension_version TEXT NOT NULL,
  offer_version TEXT NOT NULL,
  properties TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_events_funnel
  ON analytics_events (event_name, occurred_at);

CREATE INDEX IF NOT EXISTS analytics_events_installation
  ON analytics_events (installation_id, occurred_at);
