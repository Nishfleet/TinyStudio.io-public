CREATE TABLE IF NOT EXISTS code_lane_connections (
  request_id TEXT PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  site_folder TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_lane_connections_repo
  ON code_lane_connections (repo_owner, repo_name);

CREATE TABLE IF NOT EXISTS code_lane_pulls (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  pr_number INTEGER,
  pr_url TEXT,
  lines_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_lane_pulls_engagement
  ON code_lane_pulls (engagement_id, created_at);

ALTER TABLE correction_lines ADD COLUMN file_path TEXT;
