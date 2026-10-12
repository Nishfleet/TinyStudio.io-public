-- M1b: the appraisal request form (docs/PLAN.md 6.2). A request holds one of six
-- monthly places; when the month is full the request goes to the waitlist. Every
-- state change writes an appraisal_events row. The audit job is an outbox row the
-- SEO Fix Kit engine consumer reads.
CREATE TABLE IF NOT EXISTS appraisal_requests (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  business_type TEXT NOT NULL,
  avg_deal_value INTEGER NOT NULL,
  monthly_leads INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  month TEXT NOT NULL,
  referral_code TEXT,
  confirmation_sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (email, site_url, month)
);

CREATE INDEX IF NOT EXISTS idx_appraisal_requests_month
ON appraisal_requests(month);

CREATE TABLE IF NOT EXISTS appraisal_waitlist (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  business_type TEXT NOT NULL,
  avg_deal_value INTEGER NOT NULL,
  monthly_leads INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  month TEXT NOT NULL,
  slot_date TEXT NOT NULL,
  confirmation_sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (email, site_url, month)
);

CREATE TABLE IF NOT EXISTS appraisal_referrals (
  code TEXT PRIMARY KEY,
  referrer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_request_id TEXT,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS appraisal_audit_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appraisal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appraisal_events_request
ON appraisal_events(request_id, id);
