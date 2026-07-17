-- Publications de l'Élysée (présidence de la République) — source : elysee.fr
-- Flux RSS officiel + rubrique « Conseil des ministres ». Aucune donnée générée :
-- titres, dates et liens proviennent tels quels du site officiel.
CREATE TABLE IF NOT EXISTS public.elysee_publications (
  id            TEXT PRIMARY KEY,           -- hash stable de l'URL
  type          TEXT NOT NULL,              -- conseil_ministres | discours | deplacement | actualite
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  published_at  DATE,
  summary       TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elysee_type_date ON public.elysee_publications (type, published_at DESC);

ALTER TABLE public.elysee_publications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read elysee" ON public.elysee_publications;
CREATE POLICY "Public read elysee" ON public.elysee_publications FOR SELECT USING (true);
GRANT SELECT ON public.elysee_publications TO anon, authenticated;
