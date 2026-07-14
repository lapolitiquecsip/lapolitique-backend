-- Enjeux de société + positions des candidats à la présidentielle 2027.
-- Chaque position est SOURCÉE (source_url) ; stance ∈ pour|contre|nuance|inconnu.

CREATE TABLE IF NOT EXISTS public.issues (
  slug        TEXT PRIMARY KEY,
  category    TEXT NOT NULL,          -- Régaliens | Économie & social | Écologie & énergie | International & institutions
  title       TEXT NOT NULL,          -- thème (ex. "Immigration")
  proposition TEXT NOT NULL,          -- formulation Pour/Contre (ex. "Durcir les règles de l'immigration")
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.candidate_positions (
  candidate_slug TEXT NOT NULL,
  issue_slug     TEXT NOT NULL REFERENCES public.issues(slug) ON DELETE CASCADE,
  stance         TEXT NOT NULL,       -- pour | contre | nuance | inconnu
  summary        TEXT,                -- résumé factuel de la position (issu de la source)
  source_url     TEXT,                -- lien source (Wikipédia / programme / déclaration)
  source_type    TEXT,               -- wikipedia | programme | declaration | vote
  updated_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (candidate_slug, issue_slug)
);

CREATE INDEX IF NOT EXISTS idx_positions_issue ON public.candidate_positions (issue_slug);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read issues" ON public.issues;
CREATE POLICY "Public read issues" ON public.issues FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public read positions" ON public.candidate_positions;
CREATE POLICY "Public read positions" ON public.candidate_positions FOR SELECT USING (true);
GRANT SELECT ON public.issues TO anon, authenticated;
GRANT SELECT ON public.candidate_positions TO anon, authenticated;
