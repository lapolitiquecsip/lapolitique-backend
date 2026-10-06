-- ─────────────────────────────────────────────────────────────────────────────
-- Alertes Pro, version 2 : une alerte seulement quand un texte (vote final d'une
-- loi, loi ou décret au Journal officiel) peut concerner le membre.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Analyse de chaque texte, faite une fois : qui est concerné, à quel point.
--    publics / secteurs / ages : vocabulaire fermé (voir alertes-textes.ts).
--    explication : rédigée à partir du résumé officiel ; « extrait » est la phrase
--    du résumé qui la justifie, vérifiée mot pour mot (sinon explication retirée).
create table if not exists public.textes_impacts (
  id          bigserial primary key,
  source      text not null,          -- scrutin_final | decret | loi
  source_id   text not null,
  chambre     text,                   -- AN | SENAT | JO
  titre       text not null,
  resume      text,
  url         text,
  date_texte  timestamptz,
  importance  smallint not null,      -- 1..5
  publics     text[] not null default '{}',
  secteurs    text[] not null default '{}',
  domaines    text[] not null default '{}',
  territoire  text not null default 'national',   -- national, ou code département / région
  explication text,
  extrait     text,
  resultat    jsonb,                  -- vote : pour/contre/abstention, groupes
  analyse_le  timestamptz not null default now(),
  unique (source, source_id)
);
alter table public.textes_impacts enable row level security;
drop policy if exists "textes lisibles" on public.textes_impacts;
create policy "textes lisibles" on public.textes_impacts for select using (true);

-- 2) Données détaillées d'une alerte (résultats du vote, votes des élus suivis).
alter table public.user_notifications add column if not exists donnees jsonb;

-- 3) Profil d'impact du membre (facultatif, données non sensibles) :
--    secteur d'activité, logement, enfants. L'âge, la situation professionnelle,
--    la localisation et les centres d'intérêt existent déjà.
alter table public.user_preferences
  add column if not exists secteur text,
  add column if not exists logement text check (logement in ('locataire', 'proprietaire', 'heberge')),
  add column if not exists enfants text check (enfants in ('aucun', 'petits', 'scolarises', 'etudiants')),
  add column if not exists alertes_textes boolean not null default true,
  -- Suivre un parti ou un candidat peut révéler une opinion politique (RGPD, art. 9) :
  -- consentement explicite horodaté, demandé avant le premier suivi de ce type.
  add column if not exists consentement_suivis timestamptz;
