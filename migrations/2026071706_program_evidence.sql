-- Ancrage factuel de l'avancement du programme présidentiel.
--
-- Jusqu'ici le statut reposait sur la mémoire du modèle (connaissance ~2024, donc
-- potentiellement périmée). Désormais, chaque évaluation est adossée à des PREUVES
-- tirées de nos propres tables : scrutins de l'Assemblée et dossiers législatifs réels.
--
-- `evidence` : tableau JSON des faits réellement utilisés pour trancher, avec leur lien
-- officiel. C'est ce qui permet au lecteur de vérifier lui-même, plutôt que de croire l'IA.
ALTER TABLE public.presidential_program
  ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '[]'::jsonb;

-- Nombre de preuves retenues : permet au front de distinguer une évaluation étayée
-- d'une évaluation sans aucun élément factuel.
ALTER TABLE public.presidential_program
  ADD COLUMN IF NOT EXISTS evidence_count INTEGER DEFAULT 0;
