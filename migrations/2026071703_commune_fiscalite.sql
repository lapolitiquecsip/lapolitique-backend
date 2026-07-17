-- Fiscalité locale des communes — source : REI (Recensement des Éléments d'Imposition),
-- via data.ofgl.fr. Taux votés et produits réels de la part COMMUNALE.
-- NB : depuis la réforme de 2021, les départements et les régions ne votent plus de taux
-- de taxe foncière / d'habitation (compensés en TVA) : cette table ne concerne donc que
-- les communes, seules collectivités à lever encore ces impôts.
CREATE TABLE IF NOT EXISTS public.commune_fiscalite (
  insee_code   TEXT    NOT NULL,
  year         INTEGER NOT NULL,
  indicator    TEXT    NOT NULL,   -- taux_fb | taux_th | taux_fnb | produit_fb | produit_th | produit_fnb
  valeur       NUMERIC,            -- % pour les taux, euros pour les produits
  updated_at   TIMESTAMPTZ DEFAULT now(),
  source_url   TEXT,
  PRIMARY KEY (insee_code, year, indicator)
);

CREATE INDEX IF NOT EXISTS idx_commune_fiscalite_insee ON public.commune_fiscalite (insee_code, year);

ALTER TABLE public.commune_fiscalite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read commune fiscalite" ON public.commune_fiscalite;
CREATE POLICY "Public read commune fiscalite" ON public.commune_fiscalite FOR SELECT USING (true);
GRANT SELECT ON public.commune_fiscalite TO anon, authenticated;
