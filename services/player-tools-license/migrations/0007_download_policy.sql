CREATE TABLE IF NOT EXISTS download_settings (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

INSERT INTO download_settings (key, enabled)
VALUES ('all_downloads_activated', 0)
ON CONFLICT(key) DO NOTHING;
