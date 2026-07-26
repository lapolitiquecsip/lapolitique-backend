-- Maires — construits depuis le RNE (elected_officials + elected_mandates, mandate_type
-- = 'mayor'), enrichis d'une photo, d'une bio (Wikidata + Wikipédia + IA, uniquement pour
-- les communes ≥ 5 000 hab.) et de la situation judiciaire. Fiche détaillée par maire au
-- même niveau que les eurodéputés / présidents de département.
CREATE TABLE IF NOT EXISTS public.mayors (
  insee_code    TEXT PRIMARY KEY,        -- code INSEE de la commune
  commune_name  TEXT,
  population    INTEGER,                 -- population (geo.api.gouv.fr), pour le tri/périmètre
  first_name    TEXT,
  last_name     TEXT,
  full_name     TEXT,
  slug          TEXT,
  sex           TEXT,
  birth_date    DATE,
  party         TEXT,
  mandate_since DATE,
  photo_url     TEXT,
  biography     TEXT,
  bio           JSONB,                   -- bio structurée (panneaux)
  legal_issues  TEXT,
  source_url    TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mayors_slug ON public.mayors (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mayors_pop ON public.mayors (population DESC NULLS LAST);

ALTER TABLE public.mayors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read mayors" ON public.mayors;
CREATE POLICY "Public read mayors" ON public.mayors FOR SELECT USING (true);
GRANT SELECT ON public.mayors TO anon, authenticated;
