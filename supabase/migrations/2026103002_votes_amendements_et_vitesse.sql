-- Votes des amendements et vitesse des fiches d'élus (30/10/2026).

-- 1. Fiche sénateur : les votes se cherchent par le matricule du Sénat. Sans index, chaque
--    fiche parcourait 1,35 million de lignes (≈ 1,2 s, davantage sur un sénateur sans vote).
create index if not exists legislative_votes_voter_idx on public.legislative_votes (voter_official_id);

-- 2. Amendement ↔ scrutin public de l'Assemblée qui l'a tranché (backend lier-amendements-scrutins.ts).
--    scrutin_id : le scrutin public, avec le vote de chaque député (deputy_votes) ;
--    vote_mode  : 'scrutin_public' | 'main_levee' (sort connu, aucun scrutin public : l'Assemblée
--    ne publie alors aucun décompte par député).
alter table public.amendements_an add column if not exists scrutin_id text;
alter table public.amendements_an add column if not exists vote_mode text;
create index if not exists amendements_an_scrutin_idx on public.amendements_an (scrutin_id);
