-- Décrets publiés au Journal Officiel (source DILA/JORF, sans IA).
CREATE TABLE IF NOT EXISTS public.decrees (
  jorf_id     TEXT PRIMARY KEY,
  nor         TEXT,
  title       TEXT NOT NULL,
  nature      TEXT,
  decree_type TEXT,          -- Nomination | Distinction | Réglementaire
  date_publi  DATE NOT NULL,
  source_url  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decrees_date ON public.decrees (date_publi DESC);

ALTER TABLE public.decrees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read decrees" ON public.decrees;
CREATE POLICY "Public read decrees" ON public.decrees FOR SELECT USING (true);
GRANT SELECT ON public.decrees TO anon, authenticated;
