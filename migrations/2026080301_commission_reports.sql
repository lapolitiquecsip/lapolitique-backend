-- Auditions et travaux de commission (comptes rendus écrits officiels de l'Assemblée) + résumé IA.
-- La source « ce qui a été dit » = le VERBATIM officiel publié par l'AN (open data), résumé par IA.
CREATE TABLE IF NOT EXISTS public.commission_reports (
  ref          text PRIMARY KEY,         -- compteRenduRef (ex. CRCANR5L17S2026PO878313N019)
  organe_ref   text,                      -- organe de la réunion (référence AN)
  commission   text,                      -- nom lisible de la commission (extrait du CR)
  title        text,                      -- objet de la réunion (audition de …, sur …)
  meeting_date date,                      -- date de la réunion
  cr_url       text,                      -- lien vers le compte rendu officiel
  video_url    text,                      -- lien vidéo si disponible
  summary      text,                      -- résumé IA de ce qui a été dit (réservé premium côté front)
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_reports_date ON public.commission_reports (meeting_date DESC);
ALTER TABLE public.commission_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read commission reports" ON public.commission_reports;
CREATE POLICY "Public read commission reports" ON public.commission_reports FOR SELECT USING (true);
GRANT SELECT ON public.commission_reports TO anon, authenticated;
