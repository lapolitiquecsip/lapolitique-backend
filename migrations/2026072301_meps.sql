-- Députés européens (eurodéputés) — enrichissement de la table meps + historique de votes.
-- Source : Parlement européen (liste officielle + photos) et HowTheyVote.eu (votes nominaux).

ALTER TABLE public.meps
  ADD COLUMN IF NOT EXISTS first_name    TEXT,
  ADD COLUMN IF NOT EXISTS last_name     TEXT,
  ADD COLUMN IF NOT EXISTS slug          TEXT,
  ADD COLUMN IF NOT EXISTS photo_url     TEXT,
  ADD COLUMN IF NOT EXISTS ep_group_code TEXT,
  ADD COLUMN IF NOT EXISTS biography     TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT DEFAULT 'France';

CREATE UNIQUE INDEX IF NOT EXISTS idx_meps_slug ON public.meps (slug) WHERE slug IS NOT NULL;

-- Historique de votes des eurodéputés (votes nominaux du Parlement européen).
CREATE TABLE IF NOT EXISTS public.mep_votes (
  mep_id     TEXT NOT NULL,          -- id officiel du Parlement européen
  vote_id    TEXT NOT NULL,          -- id du scrutin (HowTheyVote)
  title      TEXT,
  reference  TEXT,
  voted_at   TIMESTAMPTZ,
  position   TEXT,                   -- FOR | AGAINST | ABSTENTION | DID_NOT_VOTE
  result     TEXT,                   -- résultat global du scrutin (ADOPTED/REJECTED)
  url        TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (mep_id, vote_id)
);

CREATE INDEX IF NOT EXISTS idx_mep_votes_feed ON public.mep_votes (mep_id, voted_at DESC);

ALTER TABLE public.mep_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read mep votes" ON public.mep_votes;
CREATE POLICY "Public read mep votes" ON public.mep_votes FOR SELECT USING (true);
GRANT SELECT ON public.mep_votes TO anon, authenticated;
