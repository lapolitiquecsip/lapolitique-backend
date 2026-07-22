-- Statut de cycle de vie des pétitions (source : plateforme officielle petitions.assemblee-nationale.fr).
-- Le libellé officiel n'apparaît que pour les pétitions ayant avancé (ex. « Classée par la
-- commission », « Transmise à une commission ») ; sinon la pétition est simplement « Enregistrée »
-- (en recueil de signatures). On stocke le libellé brut : le front en déduit une explication factuelle.
ALTER TABLE public.petitions
  ADD COLUMN IF NOT EXISTS status         TEXT,          -- libellé officiel de la plateforme
  ADD COLUMN IF NOT EXISTS status_checked_at TIMESTAMPTZ; -- dernière vérification du statut
