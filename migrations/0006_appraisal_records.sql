-- M1c: the Appraisal Record (docs/PLAN.md 6.3). One unguessable record id per
-- request; the static HTML lives in R2 under records/<id>.html and is rendered
-- again, with a higher version, on each state change.
CREATE TABLE IF NOT EXISTS appraisal_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  rendered_at TEXT NOT NULL
);
