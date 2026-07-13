-- Fiches des forces politiques : stats datan (groupes AN) + infos parti enrichies.
-- Une ligne = une "force politique" (parti), reliée aux élus/candidats via `aliases`
-- (sigles de groupes AN, groupes Sénat, noms de parti).

CREATE TABLE IF NOT EXISTS public.political_parties (
  slug         TEXT PRIMARY KEY,        -- identifiant d'URL (ex. "rassemblement-national")
  name         TEXT NOT NULL,           -- nom complet
  abbrev       TEXT,                    -- sigle principal (ex. "RN")
  aliases      TEXT[] NOT NULL DEFAULT '{}', -- toutes les clés qui pointent ici (sigles AN/Sénat, noms)
  color        TEXT,                    -- couleur associée

  -- Statistiques datan (groupe AN, si correspondance) — actualisées quotidiennement
  datan_group_id      TEXT,
  datan_abbrev        TEXT,
  effectif            INTEGER,
  pct_women           NUMERIC,
  avg_age             NUMERIC,
  score_cohesion      NUMERIC,
  score_participation NUMERIC,
  score_majorite      NUMERIC,
  group_start         DATE,
  datan_updated_at    DATE,

  -- Infos parti enrichies (Wikipédia / IA) — mises en cache
  founded      TEXT,                    -- date/année de fondation du parti
  members      TEXT,                    -- nombre d'adhérents
  budget       TEXT,                    -- budget / financement
  leader       TEXT,                    -- dirigeant·e actuel·le
  orientation  TEXT,                    -- positionnement (ex. "Gauche", "Extrême droite")
  headquarters TEXT,                    -- siège
  website      TEXT,                    -- site officiel
  summary      TEXT,                    -- description
  logo_url     TEXT,
  source_url   TEXT,                    -- source (Wikipédia)
  bio          JSONB,                   -- infos structurées additionnelles
  enriched_at  TIMESTAMPTZ,

  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parties_aliases ON public.political_parties USING GIN (aliases);

ALTER TABLE public.political_parties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read parties" ON public.political_parties;
CREATE POLICY "Public read parties" ON public.political_parties FOR SELECT USING (true);
GRANT SELECT ON public.political_parties TO anon, authenticated;
