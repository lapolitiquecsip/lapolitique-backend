-- Titre synthétisé (le sujet, sans « Décret n°… du … portant … ») pour l'affichage des décrets.
alter table public.decrees add column if not exists display_title text;
