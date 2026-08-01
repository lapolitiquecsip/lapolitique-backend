-- Données financières par parti (100 % sourcées, curées) :
--  • subventions publiques (aide publique de l'État, décret annuel de répartition) ;
--  • endettement (dettes + produits des comptes CNCCFP, exercice le plus récent publié).
-- Le taux d'endettement affiché = dettes / produits annuels (calculé côté front).
ALTER TABLE public.political_parties
  ADD COLUMN IF NOT EXISTS subventions_eur    bigint,   -- aide publique reçue (€)
  ADD COLUMN IF NOT EXISTS subventions_year   int,      -- millésime de l'aide
  ADD COLUMN IF NOT EXISTS subventions_source text,      -- libellé + source
  ADD COLUMN IF NOT EXISTS dettes_eur         bigint,   -- total des dettes au bilan (€)
  ADD COLUMN IF NOT EXISTS produits_eur       bigint,   -- total des produits de l'exercice (€)
  ADD COLUMN IF NOT EXISTS comptes_year       int,      -- exercice des comptes
  ADD COLUMN IF NOT EXISTS comptes_source     text;      -- libellé + source des comptes
