-- Répartition du budget de l'État par PROGRAMME (à l'intérieur de chaque mission).
-- Source : PLF 2026 « budget vert » (data.economie.gouv), montants en crédits de paiement.
CREATE TABLE IF NOT EXISTS public.state_budget_programmes (
  mission_name   TEXT NOT NULL,
  programme_num  TEXT NOT NULL,
  programme_name TEXT NOT NULL,
  amount_2026    NUMERIC,
  fiscal_year    INTEGER NOT NULL DEFAULT 2026,
  source_url     TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (mission_name, programme_num, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_budget_programmes_mission ON public.state_budget_programmes (mission_name);

ALTER TABLE public.state_budget_programmes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read budget programmes" ON public.state_budget_programmes;
CREATE POLICY "Public read budget programmes" ON public.state_budget_programmes FOR SELECT USING (true);
GRANT SELECT ON public.state_budget_programmes TO anon, authenticated;
