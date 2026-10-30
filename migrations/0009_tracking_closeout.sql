-- M3: the 14-day tracking and the Close-out (docs/PLAN.md 6.8 and 6.9).
-- The nightly scheduled handler queues one tracking check per engagement day
-- into the same outbox the audit and drift jobs use; the SEO Fix Kit engine
-- consumer reads them the same way. The day-7 and day-14 notes are the
-- reviewer's own words, and the Close-out mints the referral code the
-- appraisal form already honours as the waitlist skip for the current month.
CREATE TABLE IF NOT EXISTS tracking_checks (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, day)
);

CREATE INDEX IF NOT EXISTS idx_tracking_checks_engagement
  ON tracking_checks (engagement_id, day);

CREATE TABLE IF NOT EXISTS tracking_notes (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  note TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, day)
);

CREATE TABLE IF NOT EXISTS close_outs (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  receipt_id TEXT,
  referral_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE engagements ADD COLUMN specimen_consent INTEGER NOT NULL DEFAULT 0;
