-- Programme présidentiel d'Emmanuel Macron (2022) et son état d'avancement.
--
-- Provenance des colonnes — distinction volontaire et importante :
--   * theme / engagement / source_url : FAITS, extraits du programme officiel
--     « Avec Vous » (24 pages), archivé sur web.archive.org. Non reformulés.
--   * status / justification          : ÉVALUATION GÉNÉRÉE PAR IA (DeepSeek).
--     Ce n'est pas un fait vérifié : le front doit l'afficher comme tel.
CREATE TABLE IF NOT EXISTS public.presidential_program (
  id            TEXT PRIMARY KEY,        -- hash stable de l'engagement
  year          INTEGER NOT NULL,        -- millésime du programme (2022)
  pacte         TEXT,                    -- grande partie du programme
  theme         TEXT,                    -- chapitre
  engagement    TEXT NOT NULL,           -- l'engagement, tiré du document officiel
  source_url    TEXT NOT NULL,           -- PDF officiel archivé
  status        TEXT CHECK (status IN ('tenu','en_cours','partiel','abandonne','non_evaluable')),
  justification TEXT,
  ai_generated  BOOLEAN NOT NULL DEFAULT true,   -- le statut vient d'un modèle, pas d'un humain
  assessed_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presidential_program_year ON public.presidential_program (year, pacte);

ALTER TABLE public.presidential_program ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read presidential program" ON public.presidential_program;
CREATE POLICY "Public read presidential program" ON public.presidential_program FOR SELECT USING (true);
GRANT SELECT ON public.presidential_program TO anon, authenticated;
