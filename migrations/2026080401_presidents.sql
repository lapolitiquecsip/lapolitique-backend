-- Fiches des présidents de la République (bio structurée détaillée, même niveau que les élus).
CREATE TABLE IF NOT EXISTS public.presidents (
  slug       text PRIMARY KEY,
  full_name  text NOT NULL,
  photo_url  text,
  term       text,                 -- ex. « 2012–2017 »
  party      text,
  bio        jsonb,                 -- bio structurée (mêmes rubriques que les élus)
  summary    text,
  source_url text,
  sort_order int DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.presidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read presidents" ON public.presidents;
CREATE POLICY "Public read presidents" ON public.presidents FOR SELECT USING (true);
GRANT SELECT ON public.presidents TO anon, authenticated;
