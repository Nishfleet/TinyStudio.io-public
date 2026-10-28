CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  record_id TEXT,
  status TEXT NOT NULL,
  checkout_session_id TEXT,
  kickoff_note TEXT,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagements_request
  ON engagements (request_id);

CREATE INDEX IF NOT EXISTS idx_engagements_status
  ON engagements (status, changed_at);

CREATE TABLE IF NOT EXISTS engagement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_engagement
  ON engagement_events (engagement_id, created_at);

CREATE INDEX IF NOT EXISTS idx_engagement_events_request
  ON engagement_events (request_id, created_at);

CREATE TABLE IF NOT EXISTS engagement_payments (
  payment_id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  webhook_id TEXT,
  product_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT NOT NULL,
  role TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_payments_engagement
  ON engagement_payments (engagement_id, created_at);

CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  webhook_id TEXT PRIMARY KEY,
  event_type TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dodo_webhook_events_created
  ON dodo_webhook_events (created_at);

CREATE TABLE IF NOT EXISTS correction_lines (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fault_id TEXT,
  fault_title TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  legal_copy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  reviewer TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  recorded_version INTEGER,
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_correction_lines_engagement
  ON correction_lines (engagement_id, status, created_at);

CREATE TABLE IF NOT EXISTS correction_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_correction_reviews_line
  ON correction_reviews (line_id, created_at);

ALTER TABLE appraisal_records ADD COLUMN faults_json TEXT;
ALTER TABLE appraisal_records ADD COLUMN review_json TEXT;
