-- Résultats de vote PAR GROUPE politique du Parlement européen, pour chaque scrutin
-- (source officielle : HowTheyVote, champ stats.by_group). Permet d'afficher, en plus des
-- votes individuels, comment chaque groupe (PPE, S&D, Renew, PFE…) s'est positionné.
CREATE TABLE IF NOT EXISTS public.vote_group_results (
  vote_id     TEXT PRIMARY KEY,
  groups      JSONB,            -- [{ code, label, for, against, abstention, dnv, position }]
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vote_group_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read vote group results" ON public.vote_group_results;
CREATE POLICY "Public read vote group results" ON public.vote_group_results FOR SELECT USING (true);
GRANT SELECT ON public.vote_group_results TO anon, authenticated;
