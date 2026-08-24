-- The leak-audit form collects the site to be audited alongside the email.
-- Without the URL a brief request is not actionable — there is nothing to read.
-- Nullable so existing rows and the Agent Desk signup path stay valid.
ALTER TABLE email_signups ADD COLUMN website TEXT;
