-- Indicateurs territoriaux de développement durable (ITDD, Insee/SDES) —
-- sélection d'indicateurs, aux niveaux région / département / commune.

CREATE TABLE IF NOT EXISTS public.itdd_indicators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level         TEXT NOT NULL,          -- region | department | commune
  territory_code TEXT NOT NULL,         -- CODGEO
  variable      TEXT NOT NULL,          -- code variable ITDD (ex. esper_vie)
  sub_field     TEXT NOT NULL DEFAULT '', -- sous-champ (ex. homme/femme), '' si aucun
  year          INTEGER NOT NULL,
  value         NUMERIC,
  unit          TEXT,
  label         TEXT,                   -- libellé lisible
  odd           TEXT,                   -- objectif de développement durable
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_itdd_uniq ON public.itdd_indicators (level, territory_code, variable, sub_field, year);
CREATE INDEX IF NOT EXISTS idx_itdd_lookup ON public.itdd_indicators (level, territory_code, variable);

ALTER TABLE public.itdd_indicators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read itdd" ON public.itdd_indicators;
CREATE POLICY "Public read itdd" ON public.itdd_indicators FOR SELECT USING (true);
GRANT SELECT ON public.itdd_indicators TO anon, authenticated;
