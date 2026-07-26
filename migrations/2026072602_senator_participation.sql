-- Taux de présence des sénateurs, calculé depuis les scrutins publics du Sénat
-- (legislative_votes ↔ legislative_scrutins chamber = SENAT). Participation = positions
-- exprimées (pour/contre/abstention) sur les scrutins où le sénateur figure. Permet de
-- comparer chaque sénateur aux autres, comme les députés (participation_rate) et
-- les eurodéputés (attendance_rate).
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS participation_rate NUMERIC;
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS votes_participated INTEGER;
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS votes_total INTEGER;
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS activity_updated_at TIMESTAMPTZ;
