-- Évaluation contradictoire et double vérification du programme présidentiel.
--
-- Motivation concrète : le verdict « pass Culture = tenu » était FAUX (le crédit des moins
-- de 17 ans a été supprimé par décret du 28/02/2025 — l'extension a été défaite), et il
-- s'appuyait sur un décret de décembre 2021, antérieur à la promesse. Une évaluation en
-- une passe, sans contradiction, produit ce genre d'erreur avec aplomb.
--
-- On stocke désormais les DEUX faces du dossier, pour que le lecteur tranche lui-même
-- quand la réalité est ambiguë, au lieu de subir un verdict péremptoire.
ALTER TABLE public.presidential_program
  ADD COLUMN IF NOT EXISTS arguments_pour TEXT,      -- ce qui plaide pour « tenu »
  ADD COLUMN IF NOT EXISTS arguments_contre TEXT,    -- ce qui plaide contre
  ADD COLUMN IF NOT EXISTS certitudes TEXT,          -- ce qui est établi, quel que soit le verdict
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,   -- une 2e passe a contrôlé le verdict
  ADD COLUMN IF NOT EXISTS confidence TEXT;          -- haute | moyenne | faible

COMMENT ON COLUMN public.presidential_program.certitudes IS
  'Faits établis sur le sujet, à afficher même quand le statut reste indécidable.';
