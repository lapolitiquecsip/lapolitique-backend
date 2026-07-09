
-- Migration to add category to scrutins
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS category TEXT;
