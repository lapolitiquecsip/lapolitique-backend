-- Brique #4 — Fil d'actualité générique par ENTITÉ (ministères, départements ; extensible
-- régions/communes). Modèle générique réutilisable : chaque ligne = 1 actu résumée (résumé
-- court + lien, jamais le texte intégral → droit d'auteur respecté), rattachée à une entité.
-- Alimenté quotidiennement par des flux gratuits (RSS officiels + Google News), filtrés par
-- heuristique puis résumés par DeepSeek. `content` (bucket grossier) sera migré ici à terme.

CREATE TABLE IF NOT EXISTS public.entity_feed (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,                       -- 'ministry' | 'department' | 'region' | 'commune' | ...
  entity_id    TEXT NOT NULL,                       -- slug de la fiche (aligné sur les routes front)
  source_name  TEXT NOT NULL,                       -- 'Le Monde', 'Ministère de l'Intérieur', 'Google News'…
  source_kind  TEXT NOT NULL DEFAULT 'google_news', -- 'official_rss' | 'google_news'
  url          TEXT NOT NULL,                        -- lien de l'article (clé de déduplication)
  title        TEXT NOT NULL,                        -- titre reformulé, factuel
  summary      TEXT,                                 -- résumé court (≤ 40 mots)
  topic        TEXT,                                 -- slug d'enjeu (nullable ; tagué plus tard, cf. brique #3)
  news_type    TEXT,                                 -- annonce | decision | travaux | evenement | actualite…
  image_url    TEXT,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, url)
);
CREATE INDEX IF NOT EXISTS idx_entity_feed_lookup
  ON public.entity_feed (entity_type, entity_id, published_at DESC NULLS LAST);

-- Registre curé des flux par entité : salles de presse RSS officielles + repli Google News.
CREATE TABLE IF NOT EXISTS public.entity_feed_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  entity_name  TEXT NOT NULL,                        -- nom lisible (sert aux requêtes Google News + désambiguïsation)
  feed_url     TEXT NOT NULL,
  source_name  TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'google_news',  -- 'official_rss' | 'google_news'
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, feed_url)
);
CREATE INDEX IF NOT EXISTS idx_entity_feed_sources_active
  ON public.entity_feed_sources (active, entity_type);

ALTER TABLE public.entity_feed         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_feed_sources ENABLE ROW LEVEL SECURITY;

-- Lecture publique (front anon) ; écriture réservée à la service-role des scripts.
DROP POLICY IF EXISTS "Public read entity_feed" ON public.entity_feed;
CREATE POLICY "Public read entity_feed" ON public.entity_feed FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public read entity_feed_sources" ON public.entity_feed_sources;
CREATE POLICY "Public read entity_feed_sources" ON public.entity_feed_sources FOR SELECT USING (true);

GRANT SELECT ON public.entity_feed         TO anon, authenticated;
GRANT SELECT ON public.entity_feed_sources TO anon, authenticated;
