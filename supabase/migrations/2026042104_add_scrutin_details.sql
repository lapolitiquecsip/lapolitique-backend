
-- Migration: Add summary and dossier_url to scrutins
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS why_it_matters TEXT;
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS dossier_url TEXT;

-- Indexing might not be needed for these large text fields unless searching
