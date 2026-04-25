-- Add author column to laws table
ALTER TABLE laws ADD COLUMN IF NOT EXISTS author TEXT;
