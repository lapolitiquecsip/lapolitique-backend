-- Séries temporelles par parti : résultats électoraux + évolution des adhérents.
-- kind : 'adherents' | 'presidentielle' | 'legislatives' | 'europeennes' | 'senatoriales'
CREATE TABLE IF NOT EXISTS public.party_history (
  party_slug TEXT NOT NULL REFERENCES public.political_parties(slug) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  year       INTEGER NOT NULL,
  value      NUMERIC,          -- % de voix, ou nombre d'adhérents
  label      TEXT,             -- précision (ex. "1er tour", "sièges")
  source     TEXT,             -- 'wikidata' | 'wikipedia'
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (party_slug, kind, year, label)
);

CREATE INDEX IF NOT EXISTS idx_party_history_lookup ON public.party_history (party_slug, kind, year);

ALTER TABLE public.party_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read party history" ON public.party_history;
CREATE POLICY "Public read party history" ON public.party_history FOR SELECT USING (true);
GRANT SELECT ON public.party_history TO anon, authenticated;
