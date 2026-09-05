-- Garde-fou : une loi PROMULGUÉE ne doit jamais être rétrogradée par un autre sync.
--
-- Problème : le sync législatif horaire (Assemblée/Sénat) ré-importe les dossiers encore présents
-- dans les flux open data et écrase status_code/status_label/current_chamber avec l'état de la
-- navette (« adopté par le Sénat »…), défaisant la promotion « promulgated » posée par le sync JORF.
-- La liste force déjà « Promulguée » (elle lit promulgated_laws) et le front masque le chip, mais on
-- corrige la source : la présence d'une ligne dans promulgated_laws (= publication JO réelle) fait foi.
--
-- Un trigger BEFORE UPDATE garde le statut promulgué tant qu'une publication JORF est liée au dossier.
-- Il laisse passer : la promotion elle-même (NEW déjà 'promulgated') et le déclassement d'un orphelin
-- (plus aucune ligne promulgated_laws → 'awaiting_jorf_verification' de la vérification JORF).

CREATE OR REPLACE FUNCTION public.keep_promulgated_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_code IS DISTINCT FROM 'promulgated'
     AND EXISTS (SELECT 1 FROM public.promulgated_laws pl WHERE pl.dossier_id = NEW.id) THEN
    NEW.status_code := 'promulgated';
    NEW.status_label := 'Promulguée';
    NEW.current_chamber := 'JORF';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_promulgated_status ON public.legislative_dossiers;
CREATE TRIGGER trg_keep_promulgated_status
  BEFORE UPDATE ON public.legislative_dossiers
  FOR EACH ROW EXECUTE FUNCTION public.keep_promulgated_status();

-- Correction immédiate des dossiers actuellement écrasés (aide à mourir, PLFSS…).
UPDATE public.legislative_dossiers d
   SET status_code = 'promulgated', status_label = 'Promulguée', current_chamber = 'JORF',
       updated_at = now()
 WHERE EXISTS (SELECT 1 FROM public.promulgated_laws pl WHERE pl.dossier_id = d.id)
   AND d.status_code IS DISTINCT FROM 'promulgated';
