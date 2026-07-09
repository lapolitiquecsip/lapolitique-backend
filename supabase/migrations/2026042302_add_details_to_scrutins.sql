-- Add more details for the laws modal
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS group_results JSONB;
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS status_detail VARCHAR(255);
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS impact_detail VARCHAR(255);
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS entry_date_detail VARCHAR(255);
