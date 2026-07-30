-- Biographie STRUCTURÉE (mêmes rubriques que les candidats/eurodéputés) pour les députés et
-- sénateurs. On conserve `biography` (texte) ; `bio` (jsonb) porte les rubriques détaillées.
alter table public.deputies add column if not exists bio jsonb;
alter table public.senators add column if not exists bio jsonb;
