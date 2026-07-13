-- Situation juridique des candidats à la présidentielle 2027.
-- Même mécanisme que deputies/senators : colonne texte alimentée par import-legal.ts
-- (scraping casier-politique.fr), affichée dans la fiche candidat.

ALTER TABLE public.presidential_candidates
  ADD COLUMN IF NOT EXISTS legal_issues TEXT;
