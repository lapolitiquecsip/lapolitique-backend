
-- Migration: Add classification and categorization to scrutins
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS category TEXT;

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_scrutins_type ON scrutins(type);
CREATE INDEX IF NOT EXISTS idx_scrutins_category ON scrutins(category);
CREATE INDEX IF NOT EXISTS idx_scrutins_date ON scrutins(date_scrutin DESC);
