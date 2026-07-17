-- Permettre de suivre aussi les SÉNATEURS, pas seulement les députés.
--
-- Choix : une colonne dédiée `senator_id` plutôt qu'un couple générique (type, id).
-- Raison : on conserve les clés étrangères réelles vers `deputies` et `senators`. Un
-- identifiant générique aurait rouvert exactement le trou qui a cassé les favoris de lois
-- (des références orphelines pointant vers des lignes supprimées, impossibles à détecter).
-- Ici, la base garantit qu'un élu suivi existe, et le suivi disparaît avec lui.

ALTER TABLE public.user_follows
  ADD COLUMN IF NOT EXISTS senator_id UUID REFERENCES public.senators(id) ON DELETE CASCADE;

-- deputy_id devient facultatif : une ligne porte soit un député, soit un sénateur.
ALTER TABLE public.user_follows ALTER COLUMN deputy_id DROP NOT NULL;

-- Exactement un des deux doit être renseigné : ni ligne vide, ni ligne ambiguë.
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_one_elu;
ALTER TABLE public.user_follows
  ADD CONSTRAINT user_follows_one_elu
  CHECK (num_nonnulls(deputy_id, senator_id) = 1);

-- Pas de doublon de suivi (un index partiel par type, car NULL n'est pas comparable).
CREATE UNIQUE INDEX IF NOT EXISTS user_follows_uniq_deputy
  ON public.user_follows (user_id, deputy_id) WHERE deputy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_follows_uniq_senator
  ON public.user_follows (user_id, senator_id) WHERE senator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_follows_senator ON public.user_follows (senator_id);
