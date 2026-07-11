-- Présidentielles 2027 : base de connaissance actualisée sur les candidats déclarés.
-- Remplace la logique « promesses » côté produit.

CREATE TABLE IF NOT EXISTS public.presidential_candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT UNIQUE NOT NULL,
  full_name      TEXT NOT NULL,
  normalized_name TEXT NOT NULL,           -- pour la déduplication (sans accents/casse)
  party          TEXT,                     -- parti / étiquette
  political_side TEXT,                     -- gauche / centre / droite / etc. (couleur de la carte)
  category       TEXT DEFAULT 'Chef de file', -- Président / Ministre / Député / Sénateur / Chef de file
  status         TEXT DEFAULT 'declared',  -- declared (candidat officiel déclaré)
  declared_at    DATE,
  photo_url      TEXT,                     -- Wikimedia Commons
  photo_credit   TEXT,
  summary        TEXT,                     -- accroche courte
  bio            JSONB,                    -- { famille, parents, etudes, parcours, jobs, passions,
                                           --   faits_marquants, sorties_mediatiques, realisations }
  program        TEXT,
  supporters     JSONB DEFAULT '[]'::jsonb,
  source_urls    TEXT[] DEFAULT '{}',
  confidence     NUMERIC,                  -- score de fiabilité de la détection (0-1)
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_normalized ON public.presidential_candidates (normalized_name);
CREATE INDEX IF NOT EXISTS idx_candidates_status   ON public.presidential_candidates (status);
CREATE INDEX IF NOT EXISTS idx_candidates_category ON public.presidential_candidates (category);

CREATE TABLE IF NOT EXISTS public.candidate_news (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES public.presidential_candidates(id) ON DELETE CASCADE,
  date         DATE NOT NULL DEFAULT current_date,
  title        TEXT NOT NULL,
  summary      TEXT,
  news_type    TEXT DEFAULT 'actualite', -- interview / soutien / programme / declaration / actualite
  source_name  TEXT,
  source_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Déduplication du fil : un même lien n'est pas ré-inséré pour un candidat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_news_unique ON public.candidate_news (candidate_id, source_url);
CREATE INDEX IF NOT EXISTS idx_candidate_news_feed ON public.candidate_news (candidate_id, date DESC);

-- Lecture publique (données publiques), écriture réservée au service role (bypass RLS).
ALTER TABLE public.presidential_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read candidates" ON public.presidential_candidates;
CREATE POLICY "Public read candidates" ON public.presidential_candidates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read candidate news" ON public.candidate_news;
CREATE POLICY "Public read candidate news" ON public.candidate_news
  FOR SELECT USING (true);

GRANT SELECT ON public.presidential_candidates, public.candidate_news TO anon, authenticated;
