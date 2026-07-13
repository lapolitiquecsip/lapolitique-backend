-- Députés européens français (source officielle : Parlement européen).
CREATE TABLE IF NOT EXISTS public.meps (
  id             TEXT PRIMARY KEY,        -- identifiant MEP du Parlement européen
  full_name      TEXT NOT NULL,
  national_party TEXT,                    -- parti national (ex. "Rassemblement national")
  ep_group       TEXT,                    -- groupe au Parlement européen
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.meps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read meps" ON public.meps;
CREATE POLICY "Public read meps" ON public.meps FOR SELECT USING (true);
GRANT SELECT ON public.meps TO anon, authenticated;
