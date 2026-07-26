-- Explications pédagogiques des votes du Parlement européen, rédigées par IA (DeepSeek) à
-- partir des métadonnées officielles du scrutin (titre, description, sujets EuroVoc/OEIL,
-- commissions, résultat). Une explication par vote (partagée par tous les eurodéputés).
-- Générées en amont par un job automatisé ; affichées au clic sur un vote (site statique).
CREATE TABLE IF NOT EXISTS public.vote_explanations (
  vote_id      TEXT PRIMARY KEY,        -- id HowTheyVote du scrutin
  title        TEXT,
  reference    TEXT,
  subject      TEXT,                    -- de quoi parle le texte, en une phrase
  explanation  TEXT,                    -- l'enjeu concret expliqué simplement (plusieurs phrases)
  stakes       TEXT,                    -- ce que le vote change concrètement
  bio_v        INTEGER DEFAULT 1,       -- version du schéma (régénération si incrémenté)
  generated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vote_explanations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read vote explanations" ON public.vote_explanations;
CREATE POLICY "Public read vote explanations" ON public.vote_explanations FOR SELECT USING (true);
GRANT SELECT ON public.vote_explanations TO anon, authenticated;
