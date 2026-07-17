-- Finances réelles des départements (source : OFGL, data.ofgl.fr).
-- Agrégats retraités du budget principal, par département et par exercice.
CREATE TABLE IF NOT EXISTS public.department_finances (
  dep_code            TEXT    NOT NULL,
  year                INTEGER NOT NULL,
  indicator           TEXT    NOT NULL,   -- recettes_fonctionnement | depenses_fonctionnement | epargne_brute | depenses_investissement | encours_dette
  montant             NUMERIC,            -- en euros
  euros_par_habitant  NUMERIC,            -- €/hab officiel OFGL
  entity_note         TEXT,               -- précision quand l'entité budgétaire ≠ département historique
  updated_at          TIMESTAMPTZ DEFAULT now(),
  source_url          TEXT,
  PRIMARY KEY (dep_code, year, indicator)
);

CREATE INDEX IF NOT EXISTS idx_department_finances_code ON public.department_finances (dep_code, year);

ALTER TABLE public.department_finances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read department finances" ON public.department_finances;
CREATE POLICY "Public read department finances" ON public.department_finances FOR SELECT USING (true);
GRANT SELECT ON public.department_finances TO anon, authenticated;
