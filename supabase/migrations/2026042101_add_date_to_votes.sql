
-- Migration: Add date_scrutin to deputy_votes for efficient sorting
ALTER TABLE deputy_votes ADD COLUMN IF NOT EXISTS date_scrutin DATE;

-- Populate existing rows (optional but slow, better to re-run sync)
-- UPDATE deputy_votes dv SET date_scrutin = s.date_scrutin FROM scrutins s WHERE dv.scrutin_id = s.id;

-- Index for fast sorting by deputy and date
CREATE INDEX IF NOT EXISTS idx_deputy_votes_date ON deputy_votes(deputy_an_id, date_scrutin DESC);
