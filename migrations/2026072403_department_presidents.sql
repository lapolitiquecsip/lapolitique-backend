-- Présidents des conseils départementaux — source officielle : RNE (Répertoire National
-- des Élus, data.gouv), qui identifie la fonction « Président du conseil départemental ».
-- Enrichis ensuite d'une photo, d'une bio (Wikipédia + IA) et de la situation judiciaire,
-- avec une fiche détaillée au même niveau que les eurodéputés / candidats.
CREATE TABLE IF NOT EXISTS public.department_presidents (
  dep_code     TEXT PRIMARY KEY,        -- code département (ex. '02', '2A', '971')
  dep_name     TEXT,
  first_name   TEXT,
  last_name    TEXT,
  full_name    TEXT,
  slug         TEXT,
  birth_date   DATE,
  csp          TEXT,                    -- catégorie socio-professionnelle (RNE)
  party        TEXT,                    -- parti (enrichi via bio, facultatif)
  mandate_since DATE,
  photo_url    TEXT,
  biography    TEXT,
  bio          JSONB,                   -- bio structurée (panneaux)
  legal_issues TEXT,                    -- situation judiciaire (casier-politique, quotidien)
  source_url   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deppres_slug ON public.department_presidents (slug) WHERE slug IS NOT NULL;

ALTER TABLE public.department_presidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read dept presidents" ON public.department_presidents;
CREATE POLICY "Public read dept presidents" ON public.department_presidents FOR SELECT USING (true);
GRANT SELECT ON public.department_presidents TO anon, authenticated;
