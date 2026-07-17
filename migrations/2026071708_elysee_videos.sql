-- Fil vidéo de la présidence — source : chaîne YouTube OFFICIELLE de l'Élysée.
--
-- Choix de périmètre assumé : uniquement la chaîne officielle. Les interviews sur les
-- chaînes privées (TF1, BFM…) sont sous droits et leurs lecteurs bloquent souvent
-- l'intégration : on ne les republie pas. L'embed d'une vidéo YouTube officielle est,
-- lui, prévu pour ça.
CREATE TABLE IF NOT EXISTS public.elysee_videos (
  video_id      TEXT PRIMARY KEY,          -- identifiant YouTube
  title         TEXT NOT NULL,
  published_at  TIMESTAMPTZ,
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  description   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elysee_videos_date ON public.elysee_videos (published_at DESC);

ALTER TABLE public.elysee_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read elysee videos" ON public.elysee_videos;
CREATE POLICY "Public read elysee videos" ON public.elysee_videos FOR SELECT USING (true);
GRANT SELECT ON public.elysee_videos TO anon, authenticated;
