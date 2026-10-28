-- M3: the Proof Receipt and the 90-day drift rerun (docs/PLAN.md 6.7 and 6.9).
-- A receipt compares the last two runs of one request's record. The rerun
-- outbox holds drift checks the SEO Fix Kit engine consumer reads the same way
-- it reads the first audit job.
CREATE TABLE IF NOT EXISTS proof_receipts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  before_version INTEGER NOT NULL,
  after_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proof_receipts_request
ON proof_receipts(request_id, id);

CREATE TABLE IF NOT EXISTS appraisal_rerun_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'drift',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appraisal_rerun_jobs_request
ON appraisal_rerun_jobs(request_id, created_at);
