-- Add short_title column to events table for AI-generated concise titles
ALTER TABLE events ADD COLUMN IF NOT EXISTS short_title TEXT;
