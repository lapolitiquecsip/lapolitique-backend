-- Assiduité (participation aux votes nominaux) + distinction vote principal / amendement.
ALTER TABLE public.meps
  ADD COLUMN IF NOT EXISTS votes_total        INTEGER,   -- nb total de scrutins nominaux sur la mandature
  ADD COLUMN IF NOT EXISTS votes_participated INTEGER,   -- nb où l'élu a exprimé une position
  ADD COLUMN IF NOT EXISTS attendance_rate    NUMERIC,   -- % de participation aux votes
  ADD COLUMN IF NOT EXISTS votes_synced_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_issues       TEXT;      -- situation judiciaire (comme les candidats)

-- Un scrutin « principal » (vote final sur un texte) vs un amendement/sous-vote.
ALTER TABLE public.mep_votes
  ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT true;
