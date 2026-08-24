CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'agent-self-serve',
  page_path TEXT NOT NULL DEFAULT '/',
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_email_created_at
ON agent_runs(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_ip_hash_created_at
ON agent_runs(ip_hash, created_at DESC);
