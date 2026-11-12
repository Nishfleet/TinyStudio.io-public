-- Requests handed over from SEO Fix Kit ("Have it fixed for you") land in the
-- same appraisal_requests table, the same events and the same audit outbox as a
-- request made on tinystudio.io, marked with their source. They are free and do
-- not take one of the six paid appraisal slots, so their month column carries
-- the 'seofixkit' marker instead of a calendar month. The dedupe key is the
-- report id and the email: a replayed request returns the first id and creates
-- nothing new.
ALTER TABLE appraisal_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'web';
ALTER TABLE appraisal_requests ADD COLUMN report_id TEXT;
ALTER TABLE appraisal_requests ADD COLUMN consent_text TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appraisal_requests_report_email
ON appraisal_requests(source, report_id, email);
