-- The offer now sells six products (config/offer.json): three one-time Repair
-- sizes, the one-time Website Correction, and the monthly Care and Growth
-- plans. An engagement holds the product the proposal named, and for a monthly
-- plan the subscription id, the plan state and the date the current period
-- ends, so a cancelled plan can close the engagement at period end.
ALTER TABLE engagements ADD COLUMN product_key TEXT;
ALTER TABLE engagements ADD COLUMN subscription_id TEXT;
ALTER TABLE engagements ADD COLUMN plan_status TEXT;
ALTER TABLE engagements ADD COLUMN period_ends_at TEXT;

CREATE INDEX IF NOT EXISTS idx_engagements_plan_status
  ON engagements (plan_status, period_ends_at);
