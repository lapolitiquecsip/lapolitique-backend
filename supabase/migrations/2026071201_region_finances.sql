-- Finances des régions 2012-2024 (source OFGL) — pour le graphique d'évolution
-- sur la fiche de chaque région dans la partie « politique locale ».

CREATE TABLE IF NOT EXISTS public.region_finances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_code       TEXT NOT NULL,
  region_name       TEXT,
  year              INTEGER NOT NULL,
  indicator         TEXT NOT NULL,   -- epargne_brute, encours_dette, depenses_fonctionnement, ...
  montant_millions  NUMERIC,
  euros_par_habitant NUMERIC,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_finances_uniq ON public.region_finances (region_code, year, indicator);
CREATE INDEX IF NOT EXISTS idx_region_finances_region ON public.region_finances (region_code);

ALTER TABLE public.region_finances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read region finances" ON public.region_finances;
CREATE POLICY "Public read region finances" ON public.region_finances FOR SELECT USING (true);
GRANT SELECT ON public.region_finances TO anon, authenticated;
