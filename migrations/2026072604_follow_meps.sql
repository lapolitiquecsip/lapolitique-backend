-- Permettre de suivre aussi les EURODÉPUTÉS (comme les députés et sénateurs), et recevoir
-- des notifications sur leurs votes. meps.id est un TEXT (identifiant officiel du PE).
ALTER TABLE public.user_follows
  ADD COLUMN IF NOT EXISTS mep_id TEXT REFERENCES public.meps(id) ON DELETE CASCADE;

-- Exactement un élu par ligne de suivi (député, sénateur OU eurodéputé).
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_one_elu;
ALTER TABLE public.user_follows
  ADD CONSTRAINT user_follows_one_elu
  CHECK (num_nonnulls(deputy_id, senator_id, mep_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS user_follows_uniq_mep
  ON public.user_follows (user_id, mep_id) WHERE mep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_follows_mep ON public.user_follows (mep_id);

-- Les notifications peuvent aussi concerner un eurodéputé.
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS mep_id TEXT REFERENCES public.meps(id) ON DELETE CASCADE;
