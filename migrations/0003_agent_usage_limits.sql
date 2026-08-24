CREATE TABLE IF NOT EXISTS agent_usage_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_usage_limits_updated_at
ON agent_usage_limits(updated_at DESC);
