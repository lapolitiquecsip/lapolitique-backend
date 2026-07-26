-- Catégorie de domaine des votes du Parlement européen (Ukraine, Environnement, Commerce,
-- Agriculture, Diplomatie, etc.), dérivée de façon DÉTERMINISTE des classifications
-- OFFICIELLES du scrutin (commission responsable, sujets OEIL, concepts EuroVoc, zones
-- géographiques). Permet de filtrer les votes de chaque eurodéputé par domaine.
ALTER TABLE public.mep_votes ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_mep_votes_mep_category ON public.mep_votes (mep_id, category);
CREATE INDEX IF NOT EXISTS idx_mep_votes_vote ON public.mep_votes (vote_id);
