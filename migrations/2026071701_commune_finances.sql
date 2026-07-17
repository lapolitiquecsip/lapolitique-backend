-- Finances réelles des communes (source : OFGL — Observatoire des Finances et de la Gestion
-- publique Locales, via data.ofgl.fr). Agrégats retraités du budget principal, par commune/an.
CREATE TABLE IF NOT EXISTS public.commune_finances (
  insee_code          TEXT    NOT NULL,
  year                INTEGER NOT NULL,
  indicator           TEXT    NOT NULL,   -- recettes_fonctionnement | depenses_fonctionnement | epargne_brute | depenses_investissement | encours_dette
  montant             NUMERIC,            -- en euros
  euros_par_habitant  NUMERIC,            -- €/hab officiel OFGL
  updated_at          TIMESTAMPTZ DEFAULT now(),
  source_url          TEXT,
  PRIMARY KEY (insee_code, year, indicator)
);

CREATE INDEX IF NOT EXISTS idx_commune_finances_insee ON public.commune_finances (insee_code, year);

ALTER TABLE public.commune_finances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read commune finances" ON public.commune_finances;
CREATE POLICY "Public read commune finances" ON public.commune_finances FOR SELECT USING (true);
GRANT SELECT ON public.commune_finances TO anon, authenticated;
