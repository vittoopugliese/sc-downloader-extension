CREATE TABLE IF NOT EXISTS uninstall_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  comment TEXT,
  email TEXT,
  locale TEXT,
  extension_version TEXT,
  ip_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS uninstall_feedback_rate_limit
  ON uninstall_feedback (ip_address, created_at);
CREATE INDEX IF NOT EXISTS uninstall_feedback_expiry
  ON uninstall_feedback (delete_after);
