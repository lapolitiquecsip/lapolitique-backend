-- Fondation Brique #3 — Référentiel d'enjeux + tag des scrutins par enjeu (les "actes").
-- issues        : référentiel canonique (18 enjeux, mots-clés grand public).
-- scrutin_issues : rattachement scrutin → enjeu (déterministe + LLM en repli), avec confidence.
--                  Le front n'affiche un vote sous un enjeu qu'au-dessus d'un seuil de confidence
--                  (principe : mieux vaut un filtre incomplet qu'un vote mal classé).

-- `issues` existe déjà (référentiel partagé des enjeux, colonnes slug/title/category/proposition/
-- sort_order). On AJOUTE seulement la colonne keywords (les 7 nouveaux enjeux sont insérés par le
-- seed, sans toucher aux propositions des enjeux existants).
CREATE TABLE IF NOT EXISTS public.issues (
  slug        TEXT PRIMARY KEY,
  title       TEXT,
  category    TEXT,
  sort_order  INTEGER
);
ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.scrutin_issues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrutin_id  TEXT NOT NULL,                 -- id du scrutin (comparé en texte à deputy_votes.scrutin_id)
  issue_slug  TEXT NOT NULL REFERENCES public.issues(slug) ON DELETE CASCADE,
  confidence  NUMERIC NOT NULL DEFAULT 0.5,  -- 0..1
  method      TEXT NOT NULL DEFAULT 'keyword', -- 'keyword' | 'llm'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scrutin_id, issue_slug)
);
CREATE INDEX IF NOT EXISTS idx_scrutin_issues_issue ON public.scrutin_issues (issue_slug, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_scrutin_issues_scrutin ON public.scrutin_issues (scrutin_id);

ALTER TABLE public.issues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrutin_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read issues" ON public.issues;
CREATE POLICY "Public read issues" ON public.issues FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public read scrutin_issues" ON public.scrutin_issues;
CREATE POLICY "Public read scrutin_issues" ON public.scrutin_issues FOR SELECT USING (true);

GRANT SELECT ON public.issues         TO anon, authenticated;
GRANT SELECT ON public.scrutin_issues TO anon, authenticated;
