-- Explication pédagogique de chaque proposition d'un candidat : définit le jargon (C3S, CVAE…),
-- explique le POURQUOI, et met en contexte avec des chiffres NATIONAUX vérifiés (INSEE/officiels).
-- Générée par explain-proposals.ts (deepseek-chat, grounded sur des chiffres curés vérifiés).
alter table public.candidate_proposals add column if not exists explanation text;
