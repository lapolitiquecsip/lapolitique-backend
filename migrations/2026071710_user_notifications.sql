-- Fil de notifications de l'utilisateur premium.
-- Périmètre de ce lot : uniquement les VOTES des élus suivis (source fiable et datée).
-- Le champ `type` est volontairement extensible (mandate_change, etc.) pour accueillir
-- d'autres événements plus tard, sans nouvelle migration.
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'vote',   -- 'vote' pour l'instant
  -- L'élu concerné (une des deux colonnes selon la chambre) — FK réelles : la notif
  -- disparaît si l'élu est retiré, pas de référence morte (cf. bug des lois favorites).
  deputy_id    UUID REFERENCES public.deputies(id) ON DELETE CASCADE,
  senator_id   UUID REFERENCES public.senators(id) ON DELETE CASCADE,
  -- Contexte de l'événement (dénormalisé pour un affichage rapide et stable dans le temps,
  -- même si le scrutin est retouché ensuite).
  scrutin_id   TEXT,
  title        TEXT NOT NULL,          -- objet du scrutin
  detail       TEXT,                   -- ex. "A voté POUR"
  position     TEXT,                   -- POUR | CONTRE | ABSTENTION
  event_at     TIMESTAMPTZ,            -- date de l'événement (date du scrutin)
  read         BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Anti-doublon : un même vote ne notifie qu'une fois par utilisateur.
  dedup_key    TEXT NOT NULL,
  UNIQUE (user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notif_feed ON public.user_notifications (user_id, read, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Chaque utilisateur ne voit et ne modifie QUE ses propres notifications.
DROP POLICY IF EXISTS "own notifications read" ON public.user_notifications;
CREATE POLICY "own notifications read" ON public.user_notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own notifications update" ON public.user_notifications;
CREATE POLICY "own notifications update" ON public.user_notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- L'insertion est faite par le job serveur (clé service, qui contourne RLS) : pas de
-- policy INSERT pour les clients, ils ne doivent pas se fabriquer des notifications.
GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
