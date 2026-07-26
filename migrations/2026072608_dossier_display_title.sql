-- Titre SYNTHÉTISÉ (court, clair, façon presse) d'un dossier législatif, généré par IA à
-- partir du titre officiel long. Affiché à la place du titre officiel dans les listes ; le
-- titre officiel reste sur la fiche. Uniquement pour les titres longs (« quand il le faut »).
CREATE TABLE IF NOT EXISTS public.dossier_display_title (
  dossier_id    TEXT PRIMARY KEY,
  display_title TEXT,
  input_hash    TEXT,           -- n'est régénéré que si le titre officiel change
  generated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.dossier_display_title ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read dossier display title" ON public.dossier_display_title;
CREATE POLICY "Public read dossier display title" ON public.dossier_display_title FOR SELECT USING (true);
GRANT SELECT ON public.dossier_display_title TO anon, authenticated;
