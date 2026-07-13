-- Explications concrètes, affaire par affaire, des dossiers judiciaires.
-- Générées par DeepSeek (script explain-legal), mises en cache par titre d'affaire
-- normalisé (une affaire partagée par plusieurs personnes n'est expliquée qu'une fois).

CREATE TABLE IF NOT EXISTS public.legal_case_explanations (
  case_key    TEXT PRIMARY KEY,          -- titre d'affaire normalisé (sans accents/casse)
  title       TEXT NOT NULL,             -- titre d'affaire d'origine
  explanation TEXT NOT NULL,             -- résumé factuel en langage simple
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.legal_case_explanations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read legal explanations" ON public.legal_case_explanations;
CREATE POLICY "Public read legal explanations" ON public.legal_case_explanations FOR SELECT USING (true);
GRANT SELECT ON public.legal_case_explanations TO anon, authenticated;
