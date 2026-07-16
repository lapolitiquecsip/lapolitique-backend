-- Fiches détaillées des membres du gouvernement (bio Wikipédia + IA, photo Wikimedia,
-- situation judiciaire), façon fiches candidats. Alimenté par sync-ministers.
CREATE TABLE IF NOT EXISTS public.minister_profiles (
  slug          TEXT PRIMARY KEY,        -- identifiant d'URL (nom normalisé)
  full_name     TEXT NOT NULL,
  normalized_name TEXT,
  ministry_name TEXT,
  title         TEXT,
  photo_url     TEXT,
  summary       TEXT,
  bio           JSONB,
  source_url    TEXT,
  legal_issues  TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.minister_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read minister_profiles" ON public.minister_profiles;
CREATE POLICY "Public read minister_profiles" ON public.minister_profiles FOR SELECT USING (true);
GRANT SELECT ON public.minister_profiles TO anon, authenticated;
