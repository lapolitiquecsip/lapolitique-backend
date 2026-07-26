-- Nombre d'initiatives législatives par élu (députés & sénateurs), calculé depuis les
-- dossiers officiels (legislative_dossiers.author_name → liste des initiateurs). Permet de
-- classer les élus selon le nombre de textes déposés — comme le classement d'assiduité.
--   initiative_primary_count : textes où l'élu est l'AUTEUR PRINCIPAL (1er signataire) = « déposés ».
--   initiative_count         : total des textes où l'élu figure parmi les initiateurs (co-signés inclus).
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS initiative_primary_count INTEGER;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS initiative_count INTEGER;
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS initiative_primary_count INTEGER;
ALTER TABLE public.senators ADD COLUMN IF NOT EXISTS initiative_count INTEGER;
