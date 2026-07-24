-- Bio STRUCTURÉE des eurodéputés (rubriques : parcours, études, famille, parents, jobs,
-- positions, publications, controverses, chronologie…), pour un affichage en panneaux
-- comme les fiches candidats/ministres. Générée à partir de Wikipédia, ancrée et neutre.
ALTER TABLE public.meps
  ADD COLUMN IF NOT EXISTS bio JSONB;
