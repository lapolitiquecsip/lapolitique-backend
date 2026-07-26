-- Résumé « impact citoyen » d'une loi PROMULGUÉE : ce que la loi change concrètement pour
-- les citoyens, formulé à partir de « À partir de maintenant… ». Généré par IA à partir du
-- résumé officiel du dossier. Affiché dans le livre du Journal Officiel.
CREATE TABLE IF NOT EXISTS public.law_citizen_impact (
  dossier_id   TEXT PRIMARY KEY,
  impact       TEXT,
  input_hash   TEXT,               -- évite de régénérer si le résumé source n'a pas changé
  generated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.law_citizen_impact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read law citizen impact" ON public.law_citizen_impact;
CREATE POLICY "Public read law citizen impact" ON public.law_citizen_impact FOR SELECT USING (true);
GRANT SELECT ON public.law_citizen_impact TO anon, authenticated;
