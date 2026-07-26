-- Fil vidéo du Sénat — flux RSS de la chaîne YouTube officielle Public Sénat : séances,
-- questions au Gouvernement, auditions, débats. Métadonnées seulement (lecture via l'embed).
CREATE TABLE IF NOT EXISTS public.senat_videos (
  video_id      TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  published_at  TIMESTAMPTZ,
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  description   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_senat_videos_date ON public.senat_videos (published_at DESC);

ALTER TABLE public.senat_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read senat videos" ON public.senat_videos;
CREATE POLICY "Public read senat videos" ON public.senat_videos FOR SELECT USING (true);
GRANT SELECT ON public.senat_videos TO anon, authenticated;
