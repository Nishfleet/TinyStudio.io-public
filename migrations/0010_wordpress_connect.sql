-- The WordPress lane (issue #153): one-click connect through WordPress's own
-- application-password approve screen (core since 5.6), the key held
-- encrypted with the WORDPRESS_KEY_ENC_KEY Worker secret, the applier that
-- writes approved correction lines through the core REST API, and per-line
-- undo. The old value of every field is saved before the write; the key and
-- the token are wiped when the engagement closes.
CREATE TABLE IF NOT EXISTS wordpress_connections (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  wp_user_login TEXT,
  password_ciphertext TEXT,
  status TEXT NOT NULL,
  connect_token TEXT NOT NULL,
  connected_at TEXT,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wordpress_connections_status
  ON wordpress_connections (status, changed_at);

CREATE TABLE IF NOT EXISTS wordpress_line_writes (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  had_old INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  charged INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wordpress_line_writes_line
  ON wordpress_line_writes (engagement_id, line_id, created_at);
