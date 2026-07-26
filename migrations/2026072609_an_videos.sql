-- Fil vidéo de l'Assemblée nationale — flux RSS de la chaîne YouTube officielle (LCP ·
-- Assemblée nationale) : séances publiques, questions au Gouvernement, auditions. Comme pour
-- l'Élysée, on ne stocke que des métadonnées ; la vidéo reste lue chez YouTube via l'embed.
CREATE TABLE IF NOT EXISTS public.an_videos (
  video_id      TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  published_at  TIMESTAMPTZ,
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  description   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_an_videos_date ON public.an_videos (published_at DESC);

ALTER TABLE public.an_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read an videos" ON public.an_videos;
CREATE POLICY "Public read an videos" ON public.an_videos FOR SELECT USING (true);
GRANT SELECT ON public.an_videos TO anon, authenticated;
