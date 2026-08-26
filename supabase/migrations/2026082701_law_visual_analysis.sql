-- Données STRUCTURÉES pour l'affichage visuel de l'analyse détaillée d'une loi
-- (essence / avant-après / impacts chiffrés / vote), extraites SANS invention du texte
-- d'analyse premium existant + des chiffres de vote officiels. Une ligne d'analyse premium
-- = une colonne `visual`. Rempli par le script generate-law-visual.
alter table public.legislative_analyses add column if not exists visual jsonb;
